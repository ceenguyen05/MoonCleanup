// LocalRoomHost (client/room-host v1): the main-thread side of the Solo sim worker (ADR-0031).
// - `sendInput` echoes synchronously to `onInputEcho` listeners (prediction applies it in the very next rendered
//   frame), encodes it with packages/protocol into a pooled 12-byte buffer and transfers it; never waits, never throws.
// - Frames arrive as transferred buffers from the worker's pool of 3; listeners get a pooled RoomHostFrame and the
//   buffer goes back on `release()` (deferred until every listener ran; auto-released when nobody listens).
// - Worker crash or fatal error: one reboot from the newest local checkpoint; a second failure ends in `failed`.
// - Instrumentation (E13/E14): input -> authoritative ack latency, host cost per message, worker tick timings.

import {
  SOLO_LOCAL_CHECKPOINT_INTERVAL_S,
  type ActorJoinInfo,
  type ContractId,
  type ControlIntent,
  type LocalCheckpointMeta,
  type LocalCheckpointReason,
  type LocalRoomHost,
  type RoomHostCloseReason,
  type RoomHostFrame,
  type RoomHostState,
  type RoomSimEvent,
  type SaveEventMap,
  type ShiftStateView,
  type ShiftType,
  type SimInputCommand,
  type Tick,
  type Unsubscribe,
} from "@moon-cleanup/shared";
import { encodeInput } from "@moon-cleanup/protocol";
import {
  FRAME_BUF_BYTES,
  FRAME_POOL_SIZE,
  FRAME_TRAILER_OFFSET,
  FRAME_TRAILER_TAG,
  INPUT_BUF_BYTES,
  SIM_HOST_PROTOCOL_VERSION,
  type FromWorkerControl,
  type SimHostBootConfig,
  type SimHostClockMode,
  type SimHostStoreKind,
  type SimHostWorldConfig,
  type SimWorkerStats,
  type ToWorkerControl,
} from "./messages";
import { SampleRing } from "./sample-ring";
import { HostReadouts } from "./readouts";
import { FrameTimeline, type FrameTimelineSample } from "./frame-timeline";
import type { StoredDustChunk } from "./checkpoint-store";

/** What the host needs from a Worker (a real Worker, or a MessagePort-backed fake in Node tests). */
export interface SimWorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  terminate(): void;
}

export interface LocalRoomHostOptions {
  readonly contractId: ContractId;
  readonly shiftType?: ShiftType;
  readonly player: ActorJoinInfo;
  readonly world: SimHostWorldConfig;
  /** Creates the worker (called again for a crash reboot). */
  readonly spawnWorker: () => SimWorkerLike;
  readonly clock?: SimHostClockMode;
  readonly store?: SimHostStoreKind;
  readonly dbName?: string;
  /** Restore the newest local checkpoint (default true). */
  readonly restore?: boolean;
  readonly tickHz?: number;
  readonly checkpointIntervalS?: number;
  readonly bakeHash?: string;
  readonly originId?: string;
  readonly fresh?: SimHostBootConfig["fresh"];
  readonly statsIntervalMs?: number;
  /** Save events this module emits (save.checkpointed, save.restored, save.storage_warning). */
  readonly onSaveEvent?: <K extends keyof SaveEventMap>(name: K, payload: SaveEventMap[K]) => void;
  /**
   * Called when the stored save could not be restored (unreadable, unsupported or rejected by the sim) and the host
   * started a fresh game instead; also when the save was restored but some of its dust chunks were unreadable (reason
   * starts with "dust chunks": those plots are untouched again). The app routes it to the error boundary.
   */
  readonly onRestoreProblem?: (reason: string) => void;
  /** Called once when the host is disposed (the factory releases its Web Lock here). */
  readonly onDispose?: () => void;
  /** Time source for instrumentation (default performance.now). */
  readonly now?: () => number;
}

/** Main-thread measurements (ms). */
export interface SimHostStats {
  readonly framesReceived: number;
  readonly framesDroppedNoListener: number;
  /** sendInput -> first frame acking that seq (authoritative result on screen next render). */
  readonly ackLatencyP50Ms: number;
  readonly ackLatencyP95Ms: number;
  readonly ackLatencyMaxMs: number;
  /** Host-own cost per handled message / sendInput, excluding listener time. */
  readonly hostCostP95Ms: number;
  readonly hostCostMaxMs: number;
  readonly inputsSent: number;
  readonly inputPoolMisses: number;
  readonly reboots: number;
  readonly worker: SimWorkerStats | null;
}

const ZERO_HASH = "0".repeat(64);
const ZERO_ORIGIN = "0".repeat(32);
const ACK_RING = 128;

/** The worker's whole dust state, handed to `onDustState` listeners (the main-thread ledger view). */
export interface SimDustState {
  /** Sim tick the state was captured after. */
  readonly tick: number;
  readonly bakeCheck: number;
  /** Uncompressed packages/world dust chunk payloads (every non-pristine chunk). */
  readonly chunks: readonly ArrayBuffer[];
  readonly reason: "request" | "dropped";
}

const EMPTY_BYTES = new Uint8Array(0);

class PooledFrame implements RoomHostFrame {
  tick = 0 as Tick;
  ackInputSeq = 0;
  bytes: ArrayBuffer = new ArrayBuffer(0);
  /** Byte view of `bytes` (the one the host built when the buffer arrived; valid until release). */
  view: Uint8Array = EMPTY_BYTES;
  byteLength = 0;
  held = false;
  dispatching = false;
  releaseRequested = false;
  constructor(private readonly host: LocalRoomHostImpl) {}
  release(): void {
    if (!this.held) return;
    if (this.dispatching) {
      this.releaseRequested = true;
      return;
    }
    this.held = false;
    this.host.returnFrame(this);
  }
}

export class LocalRoomHostImpl implements LocalRoomHost {
  readonly kind = "local" as const;
  readonly contractId: ContractId;
  simTickHz: number;
  private stateValue: RoomHostState = "booting";
  private generationValue = 0;
  private worker: SimWorkerLike | null = null;
  private readonly opts: LocalRoomHostOptions;
  private readonly now: () => number;
  private readonly inputPool: ArrayBuffer[] = [];
  private readonly framePool: PooledFrame[] = [];
  private readonly xfer: Transferable[] = [];
  private readonly frameListeners: ((f: RoomHostFrame) => void)[] = [];
  private readonly shiftListeners: ((s: ShiftStateView) => void)[] = [];
  private readonly eventListeners: ((e: RoomSimEvent) => void)[] = [];
  private readonly stateListeners: ((s: RoomHostState) => void)[] = [];
  private readonly echoListeners: ((cmd: SimInputCommand) => void)[] = [];
  private readonly dustListeners: ((state: SimDustState) => void)[] = [];
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private memoryCheckpoint: ArrayBuffer | null = null;
  /** Dust chunk rows that go with `memoryCheckpoint` (newest row per chunk id), kept only without IndexedDB. */
  private readonly memoryDust = new Map<number, StoredDustChunk>();
  private reboots = 0;
  private disposed = false;
  private lastShiftState: ShiftStateView | null = null;
  /**
   * Cached HUD read-outs of the worker (Hop gauge, Crown Lamp, Plot Card, price quotes), answered synchronously; a
   * `SimReadoutSource` of the app (readouts.ts). Empty until `setReadoutRequest` was called and the worker answered.
   */
  readonly readouts = new HostReadouts();
  private readoutInspecting = false;
  private readoutItemIds: readonly string[] = [];
  private readoutRequested = false;
  // instrumentation
  private readonly sentAt = new Float64Array(ACK_RING);
  private readonly sentSeq = new Int32Array(ACK_RING).fill(-1);
  private lastAck = -1;
  private readonly ackLatency = new SampleRing(512);
  private readonly hostCost = new SampleRing(1024);
  private framesReceived = 0;
  private framesDroppedNoListener = 0;
  private inputsSent = 0;
  private inputPoolMisses = 0;
  private workerStats: SimWorkerStats | null = null;
  readonly timeline: FrameTimeline;

  constructor(options: LocalRoomHostOptions) {
    this.opts = options;
    this.contractId = options.contractId;
    this.simTickHz = options.tickHz ?? 20;
    this.now = options.now ?? (() => performance.now());
    this.timeline = new FrameTimeline(this.simTickHz);
    for (let i = 0; i < 8; i++) this.inputPool.push(new ArrayBuffer(INPUT_BUF_BYTES));
    this.boot(options.restore ?? true, null, null, options.world);
  }

  // ---- RoomHost -----------------------------------------------------------------------------------------------------

  get state(): RoomHostState {
    return this.stateValue;
  }

  get generation(): number {
    return this.generationValue;
  }

  /** The newest ShiftStateView (null before the first). */
  get shiftState(): ShiftStateView | null {
    return this.lastShiftState;
  }

  sendInput(cmd: SimInputCommand): void {
    for (let i = 0; i < this.echoListeners.length; i++) this.echoListeners[i]!(cmd);
    const w = this.worker;
    if (!w || this.disposed) return;
    const t0 = this.now();
    let buf = this.inputPool.pop();
    if (buf === undefined) {
      buf = new ArrayBuffer(INPUT_BUF_BYTES);
      this.inputPoolMisses++;
    }
    encodeInput(new Uint8Array(buf), cmd);
    const k = cmd.seq & (ACK_RING - 1);
    this.sentAt[k] = t0;
    this.sentSeq[k] = cmd.seq & 0xffff;
    this.inputsSent++;
    this.xfer.length = 0;
    this.xfer[0] = buf;
    w.postMessage(buf, this.xfer);
    this.xfer.length = 0;
    this.hostCost.push(this.now() - t0);
  }

  sendIntent(intent: ControlIntent): void {
    this.control({ t: "intent", intent });
  }

  onFrame(listener: (frame: RoomHostFrame) => void): Unsubscribe {
    return subscribe(this.frameListeners, listener);
  }

  /**
   * Asks the worker for read-outs: `inspecting` turns the Plot Card read on, `itemIds` are the Desk / Board items to
   * quote. The worker samples at 10 Hz and posts only changes. Cheap to call; the request is kept across a worker reboot.
   */
  setReadoutRequest(inspecting: boolean, itemIds: readonly string[]): void {
    this.readoutInspecting = inspecting;
    this.readoutItemIds = itemIds;
    this.readoutRequested = true;
    this.sendReadoutRequest();
  }

  private sendReadoutRequest(): void {
    if (!this.readoutRequested) return;
    const seq = this.readouts.nextRequest(this.readoutItemIds);
    this.control({ t: "ro_req", seq, inspecting: this.readoutInspecting, itemIds: this.readoutItemIds });
  }

  onShiftState(listener: (state: ShiftStateView) => void): Unsubscribe {
    return subscribe(this.shiftListeners, listener);
  }

  onEvent(listener: (event: RoomSimEvent) => void): Unsubscribe {
    return subscribe(this.eventListeners, listener);
  }

  onStateChange(listener: (state: RoomHostState) => void): Unsubscribe {
    return subscribe(this.stateListeners, listener);
  }

  /** Immediate local echo of every `sendInput` (synchronous, before the worker sees it): prediction glue hook. */
  onInputEcho(listener: (cmd: SimInputCommand) => void): Unsubscribe {
    return subscribe(this.echoListeners, listener);
  }

  /**
   * The worker's whole dust state, each time it is sent: after `requestDustState()`, after a worker reboot (asked for
   * automatically while anyone listens) and after the frame encoder dropped strokes. Main-thread ledger view hook.
   */
  onDustState(listener: (state: SimDustState) => void): Unsubscribe {
    return subscribe(this.dustListeners, listener);
  }

  /** Asks the worker for its whole dust state (answered after the tick in progress, or at the end of boot). */
  requestDustState(): void {
    this.control({ t: "dustsync" });
  }

  /** Bytes of a frame this host delivered, without a new view (valid until the frame is released). */
  frameBytes(frame: RoomHostFrame): Uint8Array {
    return frame instanceof PooledFrame ? frame.view : new Uint8Array(frame.bytes);
  }

  checkpoint(reason: LocalCheckpointReason): Promise<LocalCheckpointMeta> {
    return this.request<LocalCheckpointMeta>((id) => ({ t: "ckpt", id, reason }));
  }

  pause(): void {
    if (this.stateValue !== "running") return;
    void this.request((id) => ({ t: "pause", id })).catch(() => undefined);
  }

  suspend(): Promise<LocalCheckpointMeta> {
    return this.request<LocalCheckpointMeta>((id) => ({ t: "suspend", id }));
  }

  resume(): void {
    // Also while "running": a pause checkpoint may still be in flight (the worker ignores a resume that has nothing to undo).
    const s = this.stateValue;
    if (s === "running" || s === "paused" || s === "suspended") this.control({ t: "resume" });
  }

  async close(reason: RoomHostCloseReason): Promise<void> {
    if (this.disposed) return;
    const w = this.worker;
    if (w && this.stateValue !== "failed") {
      const finalCheckpoint = reason !== "error" && reason !== "conflict_resolved";
      await Promise.race([
        this.request((id) => ({ t: "close", id, finalCheckpoint })).catch(() => undefined),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    }
    this.dispose("closed");
  }

  // ---- extras (tests, debug, perf capture) --------------------------------------------------------------------------

  /** Manual clock only: runs `n` ticks now. */
  stepManual(n: number): void {
    this.control({ t: "step", n });
  }

  /**
   * Worker sim tick, FNV state hash and dust hash (every ledger and Polished plot); also refreshes `stats().worker`.
   */
  requestHash(): Promise<{ tick: number; hash: number; dustHash: number }> {
    return this.request((id) => ({ t: "hash", id }));
  }

  /** Test hook: makes the worker throw (exercises the crash reboot). */
  crashWorkerForTest(): void {
    this.control({ t: "crash" });
  }

  sampleInterpolation(nowMs: number, out: FrameTimelineSample): FrameTimelineSample {
    return this.timeline.sample(nowMs, out);
  }

  stats(): SimHostStats {
    return {
      framesReceived: this.framesReceived,
      framesDroppedNoListener: this.framesDroppedNoListener,
      ackLatencyP50Ms: this.ackLatency.percentile(50),
      ackLatencyP95Ms: this.ackLatency.percentile(95),
      ackLatencyMaxMs: this.ackLatency.max,
      hostCostP95Ms: this.hostCost.percentile(95),
      hostCostMaxMs: this.hostCost.max,
      inputsSent: this.inputsSent,
      inputPoolMisses: this.inputPoolMisses,
      reboots: this.reboots,
      worker: this.workerStats,
    };
  }

  /** Called by PooledFrame.release(). */
  returnFrame(f: PooledFrame): void {
    const w = this.worker;
    const buf = f.bytes;
    f.bytes = new ArrayBuffer(0);
    f.view = EMPTY_BYTES;
    this.framePool.push(f);
    if (!w || this.disposed || buf.byteLength !== FRAME_BUF_BYTES) return;
    this.xfer.length = 0;
    this.xfer[0] = buf;
    w.postMessage(buf, this.xfer);
    this.xfer.length = 0;
  }

  // ---- internals ----------------------------------------------------------------------------------------------------

  private boot(
    restore: boolean,
    restoreBytes: ArrayBuffer | null,
    restoreDust: StoredDustChunk[] | null,
    world: SimHostWorldConfig,
  ): void {
    const o = this.opts;
    const w = o.spawnWorker();
    this.worker = w;
    w.onmessage = (e) => this.onMessage(e.data);
    w.onerror = () => this.onWorkerFailure("worker error");
    // The worker gets a copy of the cube so a crash reboot can send it again (the host keeps the original).
    const sent: SimHostWorldConfig = world.kind === "cube" ? { ...world, cube: world.cube.slice(0) } : world;
    const frames: ArrayBuffer[] = [];
    for (let i = 0; i < FRAME_POOL_SIZE; i++) frames.push(new ArrayBuffer(FRAME_BUF_BYTES));
    const cfg: SimHostBootConfig = {
      protocolVersion: SIM_HOST_PROTOCOL_VERSION,
      contractId: o.contractId,
      shiftType: o.shiftType ?? "solo",
      player: o.player,
      world: sent,
      clock: o.clock ?? "realtime",
      store: o.store ?? "auto",
      dbName: o.dbName ?? "moon-cleanup-solo",
      restore,
      restoreBytes,
      restoreDust,
      tickHz: o.tickHz,
      checkpointIntervalS: o.checkpointIntervalS ?? SOLO_LOCAL_CHECKPOINT_INTERVAL_S,
      bakeHash: o.bakeHash ?? ZERO_HASH,
      originId: o.originId ?? ZERO_ORIGIN,
      fresh: o.fresh ?? { walletLm: undefined, spawnDirection: undefined },
      statsIntervalMs: o.statsIntervalMs ?? 1000,
    };
    const transfer: Transferable[] = [...frames];
    if (sent.kind === "cube") transfer.push(sent.cube);
    if (restoreBytes) transfer.push(restoreBytes);
    if (restoreDust) for (const c of restoreDust) transfer.push(c.bytes);
    w.postMessage({ t: "boot", cfg, frames } satisfies ToWorkerControl, transfer);
    // A rebooted worker restored an older checkpoint: a ledger view listening must get the new dust state.
    if (this.dustListeners.length > 0) this.control({ t: "dustsync" });
  }

  private onWorkerFailure(message: string): void {
    if (this.disposed) return;
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error(`sim worker failed: ${message}`));
    this.pending.clear();
    const world = this.opts.world;
    if (this.reboots >= 1) {
      this.dispose("failed");
      return;
    }
    this.reboots++;
    this.setState("booting");
    // The worker gets copies: the host keeps its own for the next checkpoint merge.
    const copy = this.memoryCheckpoint ? this.memoryCheckpoint.slice(0) : null;
    let dust: StoredDustChunk[] | null = null;
    if (copy) {
      dust = [];
      for (const c of this.memoryDust.values()) dust.push({ ...c, bytes: c.bytes.slice(0) });
      dust.sort((a, b) => a.chunkId - b.chunkId);
    }
    this.boot(true, copy, dust, world);
  }

  private onMessage(data: unknown): void {
    const t0 = this.now();
    let listenerMs = 0;
    if (data instanceof ArrayBuffer) {
      if (data.byteLength === INPUT_BUF_BYTES) {
        if (this.inputPool.length < 32) this.inputPool.push(data);
      } else if (data.byteLength === FRAME_BUF_BYTES) {
        listenerMs = this.onFrameBuffer(data, t0);
      }
      this.hostCost.push(this.now() - t0 - listenerMs);
      return;
    }
    const m = data as FromWorkerControl;
    switch (m.t) {
      case "state":
        this.setState(m.state);
        break;
      case "ready":
        // A rebooted worker knows no request: ask again (the cache restarts with it).
        if (this.readoutRequested) this.sendReadoutRequest();
        this.simTickHz = m.simTickHz;
        this.generationValue = m.generation;
        if (m.restoredFrom !== "none") {
          this.opts.onSaveEvent?.("save.restored", {
            contractId: this.contractId,
            atMs: Date.now(),
            generation: m.generation,
            source: "local",
          });
        }
        break;
      case "ev":
        for (const e of m.list) for (const l of this.eventListeners) l(e);
        break;
      case "ro":
        this.readouts.accept(m);
        break;
      case "ss":
        this.lastShiftState = m.view;
        for (const l of this.shiftListeners) l(m.view);
        break;
      case "ckpt": {
        if (m.meta) {
          this.generationValue = m.meta.generation;
          if (m.bytes) this.memoryCheckpoint = m.bytes;
          if (m.dust) {
            if (m.dust.replaceAll) this.memoryDust.clear();
            for (const c of m.dust.chunks) this.memoryDust.set(c.chunkId, c);
          }
          this.opts.onSaveEvent?.("save.checkpointed", {
            contractId: this.contractId,
            atMs: Date.now(),
            generation: m.meta.generation,
            parentGeneration: m.meta.parentGeneration,
            simTick: m.meta.simTick,
            reason: m.reason,
            bytes: m.meta.bytes,
          });
        }
        const p = this.pending.get(m.id);
        if (p) {
          this.pending.delete(m.id);
          if (m.meta) p.resolve(m.meta);
          else p.reject(new Error(m.error ?? "checkpoint failed"));
        }
        break;
      }
      case "stats":
        this.workerStats = m.stats;
        break;
      case "warn":
        this.opts.onSaveEvent?.("save.storage_warning", {
          contractId: this.contractId,
          atMs: Date.now(),
          warning: m.warning,
        });
        break;
      case "restore_failed":
        this.opts.onRestoreProblem?.(m.reason);
        break;
      case "hash":
        this.resolve(m.id, { tick: m.tick, hash: m.hash, dustHash: m.dustHash });
        break;
      case "closed":
        this.resolve(m.id, undefined);
        break;
      case "dust":
        for (const l of this.dustListeners) l(m);
        break;
      case "fatal":
        this.onWorkerFailure(m.message);
        break;
    }
  }

  private onFrameBuffer(buf: ArrayBuffer, t0: number): number {
    const u8 = new Uint8Array(buf);
    if (u8[FRAME_TRAILER_OFFSET + 2] !== FRAME_TRAILER_TAG) return 0;
    const len = (u8[FRAME_TRAILER_OFFSET] ?? 0) | ((u8[FRAME_TRAILER_OFFSET + 1] ?? 0) << 8);
    const tick =
      ((u8[FRAME_TRAILER_OFFSET + 4] ?? 0) |
        ((u8[FRAME_TRAILER_OFFSET + 5] ?? 0) << 8) |
        ((u8[FRAME_TRAILER_OFFSET + 6] ?? 0) << 16) |
        ((u8[FRAME_TRAILER_OFFSET + 7] ?? 0) << 24)) >>>
      0;
    // FRAME header: type u8, serverTick u32, ackInputSeq u16 (LE) -> ack at bytes 5..6.
    const ack = (u8[5] ?? 0) | ((u8[6] ?? 0) << 8);
    this.framesReceived++;
    this.timeline.onFrame(tick, t0);
    if (ack !== this.lastAck) {
      this.lastAck = ack;
      const k = ack & (ACK_RING - 1);
      if (this.sentSeq[k] === ack) {
        this.ackLatency.push(t0 - (this.sentAt[k] ?? t0));
        this.sentSeq[k] = -1;
      }
    }
    const f = this.framePool.pop() ?? new PooledFrame(this);
    f.tick = tick as Tick;
    f.ackInputSeq = ack;
    f.bytes = buf;
    f.view = u8;
    f.byteLength = len;
    f.held = true;
    if (this.frameListeners.length === 0) {
      this.framesDroppedNoListener++;
      f.release();
      return 0;
    }
    const l0 = this.now();
    f.dispatching = true;
    f.releaseRequested = false;
    for (let i = 0; i < this.frameListeners.length; i++) {
      try {
        this.frameListeners[i]!(f);
      } catch (e) {
        queueMicrotask(() => {
          throw e;
        });
      }
    }
    f.dispatching = false;
    if (f.releaseRequested) f.release();
    return this.now() - l0;
  }

  private setState(s: RoomHostState): void {
    if (this.stateValue === s || (this.disposed && s !== "closed" && s !== "failed")) return;
    this.stateValue = s;
    for (const l of this.stateListeners) l(s);
  }

  private control(m: ToWorkerControl): void {
    if (!this.disposed) this.worker?.postMessage(m, []);
  }

  private request<T>(make: (id: number) => ToWorkerControl): Promise<T> {
    if (!this.worker || this.disposed) return Promise.reject(new Error("sim host not running"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.control(make(id));
    });
  }

  private resolve(id: number, value: unknown): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    p.resolve(value);
  }

  private dispose(final: "closed" | "failed"): void {
    if (this.disposed) return;
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error("sim host disposed"));
    this.pending.clear();
    this.setState(final);
    this.disposed = true;
    this.opts.onDispose?.();
  }
}

function subscribe<T>(list: T[], l: T): Unsubscribe {
  list.push(l);
  return () => {
    const k = list.indexOf(l);
    if (k >= 0) list.splice(k, 1);
  };
}
