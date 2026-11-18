// The sim worker's logic, independent of the worker global so Node tests can drive it over a real MessageChannel.
// Owns: MoonRoomSim + world + the dust ledger (WorldDustLedger, passed to the sim as its `ledger`), the fixed-step
// loop, the input queue, FRAME encoding into the pool of 3 transferable buffers, sim events / shift state posts, local
// checkpoints (sim sections + dirty dust chunks, compressed, one IndexedDB transaction), the sliced dust restore at
// boot, and stats.
// Per tick it allocates nothing of its own; platform objects (MessageEvent, the re-wrapped transferred ArrayBuffer and
// one Uint8Array view per returned buffer) are the floor of transferable messaging.

import {
  MAX_PLAYERS_PER_ROOM,
  STANDARD_GRID_PARAMS,
  type ControlIntent,
  type LocalCheckpointMeta,
  type LocalCheckpointReason,
  type RoomHostState,
  type RoomSimEvent,
  type Tick,
} from "@moon-cleanup/shared";
import { InputBatch, decodeInput, type MutableInput } from "@moon-cleanup/protocol";
import {
  MoonRoomSim,
  bakeCheckOf,
  createRoomDustLedger,
  createSimConfig,
  type MoonRoomSimOptions,
  type SimWorld,
} from "@moon-cleanup/sim";
import {
  DUST_CHUNK_LAYOUT_MAX_BYTES,
  DUST_RESTORE_SLICE_BUDGET_MS,
  DustChunkEncoder,
  DustRestoreJob,
  GroundHeight,
  HeightCube,
  createPlotGrid,
  encodeDustChunks,
  type EncodedDustChunk,
  type IcoPlotGrid,
  type WorldDustLedger,
} from "@moon-cleanup/world";
import { loadGameData } from "@moon-cleanup/game-data";
import { FixedStepClock } from "./fixed-step";
import { InputQueue } from "./input-queue";
import {
  FRAME_BUF_BYTES,
  FRAME_TRAILER_OFFSET,
  FRAME_TRAILER_TAG,
  INPUT_BUF_BYTES,
  SIM_HOST_PROTOCOL_VERSION,
  type FromWorkerControl,
  type RestoredFrom,
  type SimHostBootConfig,
  type SimHostEndpoint,
  type SimWorkerStats,
  type ToWorkerControl,
} from "./messages";
import { SampleRing } from "./sample-ring";
import { ReadoutSampler } from "./readouts";
import { writeToolTelemetry } from "./tool-telemetry";
import {
  openCheckpointStore,
  isQuotaError,
  type CheckpointStore,
  type DustChunkWrite,
  type StoredCheckpoint,
  type StoredDustChunk,
} from "./checkpoint-store";
import {
  decodeSimCheckpoint,
  encodeSimCheckpoint,
  spawnDirectionFor,
  type DecodedSimCheckpoint,
} from "./sim-checkpoint";
import { SimFrameEncoder } from "./sim-frame-encoder";
import { crc32, deflate, gunzip, gzip, hasCompressionStreams, inflateCapped } from "./save-envelope";

export interface WorkerScheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Wall clock for `savedAtMs` (never used by the sim). */
  wallNow(): number;
}

export const defaultScheduler: WorkerScheduler = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  wallNow: () => Date.now(),
};

const SELF: number = 0;

/**
 * Ledger slots kept free before play (and again after a restore), so touching a new plot does not grow the ledger
 * pool on the tick path. One slot is about 1.3 kB; a ledger is freed when its plot is Polished, so this is the number
 * of plots that can be partly cleaned at once before the first (counted) growth.
 */
export const SOLO_LEDGER_HEADROOM_SLOTS = 1024;
let sharedGrid: IcoPlotGrid | undefined;

function standardGrid(): IcoPlotGrid {
  return (sharedGrid ??= createPlotGrid(STANDARD_GRID_PARAMS));
}

function buildWorld(cfg: SimHostBootConfig): SimWorld {
  const grid = standardGrid();
  if (cfg.world.kind === "flat") return { grid, ground: { heightAtXYZ: () => 0 } };
  const cube = new HeightCube(cfg.world.cube, cfg.world.layout);
  return { grid, ground: new GroundHeight(cube, cfg.world.ground) };
}

/**
 * Lets queued messages and timers run, then continues. A MessageChannel task is used where it exists: a zero
 * timeout is clamped to 4 ms in browsers (and to the 15.6 ms timer tick of Node on Windows), which would make a
 * sliced restore several times longer than its work.
 */
function yieldToEvents(sched: WorkerScheduler): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof MessageChannel !== "function") {
      sched.setTimeout(resolve, 0);
      return;
    }
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export class SimWorkerCore {
  private cfg: SimHostBootConfig | null = null;
  private sim: MoonRoomSim | null = null;
  /** The sim's dust ledger (the local authoritative dust state of the Solo Shift). */
  private ledger: WorldDustLedger | null = null;
  private readonly dustEncoder = new DustChunkEncoder();
  private bakeCheck = 0;
  /**
   * True until a checkpoint has written the whole dust state into this store: the next checkpoint then writes every
   * non-pristine chunk and deletes all other rows. False afterwards: checkpoints write dirty chunks only.
   */
  private dustReplaceAll = true;
  private poolGrowthsAtBoot = 0;
  private dustChunksWritten = 0;
  private dustRawBytesWritten = 0;
  private dustChunksOversize = 0;
  private dustRestoreChunks = 0;
  private dustRestoreRejected = 0;
  private dustRestoreLedgers = 0;
  private dustRestorePolished = 0;
  private dustRestoreRepairs = 0;
  private dustRestoreMs = 0;
  private dustRestoreSlices = 0;
  private dustRestoreSliceMaxMs = 0;
  private readonly ckptCaptureMs = new SampleRing(32);
  private ckptCaptureLastMs = 0;
  private readonly nowFn = (): number => this.sched.now();
  private store: CheckpointStore | null = null;
  private clock: FixedStepClock | null = null;
  private timer: unknown = null;
  private state: RoomHostState = "booting";
  private readonly queue = new InputQueue();
  private readonly batch = new InputBatch();
  private readonly input: MutableInput = { seq: 0, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 0 };
  private readonly encoder = new SimFrameEncoder();
  private readonly freeFrames: ArrayBuffer[] = [];
  private readonly intents: ControlIntent[] = [];
  private readonly events: RoomSimEvent[] = [];
  private readonly evMsg = { t: "ev" as const, list: this.events };
  private readonly xfer: Transferable[] = [];
  private readonly ssSig = new Float64Array(1 + MAX_PLAYERS_PER_ROOM * 4);
  private readonly ssScratch = new Float64Array(1 + MAX_PLAYERS_PER_ROOM * 4);
  private ssPosted = false;
  /** `pause`/`suspend` checkpoints still in flight, and a `resume` that arrived while they were. */
  private pausesPending = 0;
  private resumeWanted = false;
  // checkpoints
  private generation = 0;
  private lastSavedHash = -1;
  private ticksToCheckpoint = 0;
  private ckptChain: Promise<unknown> = Promise.resolve();
  // stats
  private readonly tickMs = new SampleRing(512);
  private readonly frameBytes = new SampleRing(256);
  private readonly ckptMs = new SampleRing(32);
  private framesSent = 0;
  private framesSkipped = 0;
  private checkpoints = 0;
  private lastStatsMs = 0;
  private readonly loopFn = (): void => this.loop();
  /** A `dustsync` arrived before the sim existed. */
  private dustSyncWanted = false;
  /** HUD read-outs of the own avatar (10 Hz, only on change; see readouts.ts). */
  private readonly readouts = new ReadoutSampler();
  /** Scratch for the private tool-telemetry trailer block (tool-telemetry.ts). */
  private readonly teleF64 = new Float64Array(1);
  private readonly teleU8 = new Uint8Array(this.teleF64.buffer);
  /** `encoder.strokesDropped` when the last dust state was posted (a change means the view missed strokes). */
  private dropsSeen = 0;
  private dustStatesPosted = 0;

  constructor(
    private readonly out: SimHostEndpoint,
    private readonly sched: WorkerScheduler = defaultScheduler,
  ) {}

  /** Entry for every message the worker receives. */
  handle(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      if (data.byteLength === INPUT_BUF_BYTES) this.onInput(data);
      else if (data.byteLength === FRAME_BUF_BYTES) this.freeFrames.push(data);
      return;
    }
    const m = data as ToWorkerControl;
    switch (m.t) {
      case "boot":
        void this.boot(m.cfg, m.frames);
        return;
      case "step":
        for (let i = 0; i < m.n && this.sim !== null && this.state === "running"; i++) this.tickOnce();
        return;
      case "intent":
        this.intents.push(m.intent);
        return;
      case "ckpt":
        void this.checkpoint(m.id, m.reason);
        return;
      case "pause":
      case "suspend":
        this.stopLoop();
        // The state turns paused only after the checkpoint, so a `resume` arriving meanwhile is remembered (B1).
        this.pausesPending++;
        this.resumeWanted = false;
        void this.checkpoint(m.id, m.t === "pause" ? "pause" : "handoff").then(() => {
          if (--this.pausesPending > 0) return;
          if (this.resumeWanted) {
            this.resumeWanted = false;
            if (this.state === "running") this.startLoop();
            return;
          }
          this.setState(m.t === "pause" ? "paused" : "suspended");
        });
        return;
      case "resume":
        if (this.pausesPending > 0) {
          this.resumeWanted = true;
        } else if (this.state === "paused" || this.state === "suspended") {
          this.setState("running");
          this.startLoop();
        }
        return;
      case "close":
        this.stopLoop();
        void (m.finalCheckpoint ? this.checkpoint(-1, "clock_out") : Promise.resolve()).then(() => {
          this.store?.close();
          this.setState("closed");
          this.post({ t: "closed", id: m.id });
        });
        return;
      case "hash":
        this.post({ t: "stats", stats: this.stats() });
        this.post({
          t: "hash",
          id: m.id,
          tick: this.sim?.tick ?? 0,
          hash: this.sim?.stateHash() ?? 0,
          dustHash: this.ledger?.worldHash() ?? 0,
        });
        return;
      case "dustsync":
        // Before the sim exists the request waits for the end of boot (the boot message is handled asynchronously).
        if (this.sim === null) this.dustSyncWanted = true;
        else this.postDustState("request");
        return;
      case "ro_req":
        this.readouts.request(m.seq, m.inspecting, m.itemIds);
        return;
      case "crash":
        throw new Error("sim-host: crash requested (test hook)");
    }
  }

  private post(m: FromWorkerControl, transfer?: Transferable[]): void {
    this.out.postMessage(m, transfer ?? []);
  }

  private setState(s: RoomHostState): void {
    this.state = s;
    this.post({ t: "state", state: s });
  }

  private async boot(cfg: SimHostBootConfig, frames: readonly ArrayBuffer[]): Promise<void> {
    try {
      if (cfg.protocolVersion !== SIM_HOST_PROTOCOL_VERSION) throw new Error("sim-host protocol mismatch");
      this.cfg = cfg;
      for (const f of frames) this.freeFrames.push(f);
      this.setState("loading");
      this.store = await openCheckpointStore(cfg.store, cfg.dbName, () =>
        this.post({ t: "warn", warning: "unavailable" }),
      );
      const data = loadGameData();
      const world = buildWorld(cfg);
      const ledger = createRoomDustLedger(standardGrid(), data, {
        tickHz: cfg.tickHz,
        initialLedgerSlots: SOLO_LEDGER_HEADROOM_SLOTS,
      });
      this.bakeCheck = bakeCheckOf(cfg.bakeHash);
      let dustRows: readonly StoredDustChunk[] = [];
      let restoredFrom: RestoredFrom = "none";
      let opts: Partial<MoonRoomSimOptions> = {
        walletLm: cfg.fresh.walletLm,
        spawnDirection: cfg.fresh.spawnDirection,
      };
      // A save that cannot be read never stops the game: report it and start fresh (the next checkpoint replaces it).
      let decoded: DecodedSimCheckpoint | null = null;
      let source: RestoredFrom = "none";
      if (cfg.restore) {
        try {
          const stored = await this.store.load(cfg.contractId);
          const raw = stored ?? (cfg.restoreBytes ? this.wrapMemory(cfg.restoreBytes) : null);
          if (raw) {
            const bytes = raw.codec === "gzip" ? await gunzip(new Uint8Array(raw.bytes)) : new Uint8Array(raw.bytes);
            decoded = decodeSimCheckpoint(bytes);
            source = stored ? "local" : "memory";
            this.generation = decoded.header.generation;
            const legacy = decoded.legacy;
            if (legacy) {
              // Version 0 save: only tick, wallet and pose can be rebuilt through the constructor options.
              const me = legacy.players.find((p) => p.slot === SELF);
              const radius = createSimConfig(data, { tickHz: cfg.tickHz }).moonRadiusM;
              opts = {
                startTick: decoded.header.simTick,
                walletLm: legacy.walletLm,
                spawnDirection: me ? spawnDirectionFor(SELF, { x: me.px, y: me.py, z: me.pz }, radius) : undefined,
              };
              restoredFrom = source;
            } else {
              // The dust of this checkpoint: rows of the same store, or the host's copies next to its header copy.
              dustRows = stored ? await this.store.loadDustChunks(cfg.contractId) : (cfg.restoreDust ?? []);
            }
          }
        } catch (e) {
          decoded = null;
          dustRows = [];
          restoredFrom = "none";
          opts = { walletLm: cfg.fresh.walletLm, spawnDirection: cfg.fresh.spawnDirection };
          this.post({ t: "restore_failed", reason: `save unreadable: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
      // Dust first (in slices), then the sim sections: Dust Cells and plots must come from the same checkpoint.
      let dustProblem = "";
      if (decoded?.sim && dustRows.length > 0) {
        dustProblem = await this.restoreDust(ledger, dustRows, decoded.header.generation);
      }
      const sim = new MoonRoomSim({
        data,
        world,
        ledger,
        contractId: cfg.contractId,
        shiftType: cfg.shiftType,
        tickHz: cfg.tickHz,
        ...opts,
      });
      sim.addActor(SELF, cfg.player);
      if (decoded?.sim) {
        // Current format: the sim validates everything before it changes anything; a rejection leaves the fresh sim,
        // and a fresh sim gets a fresh moon (the dust that was just restored belongs to the rejected save).
        const res = sim.restoreCheckpoint(decoded.sim);
        if (res.ok) {
          restoredFrom = source;
          if (dustProblem !== "") this.post({ t: "restore_failed", reason: dustProblem });
        } else {
          ledger.reset();
          this.post({ t: "restore_failed", reason: `save rejected: ${res.code} (${res.detail})` });
        }
      }
      // Rows in the store describe this ledger only when everything came out of that store unharmed. Otherwise the
      // first checkpoint rewrites the whole dust state (and removes rows of the save that was not used).
      this.dustReplaceAll = !(restoredFrom === "local" && decoded?.sim != null && dustProblem === "");
      // Headroom for new plots, so the ledger pool does not grow on the tick path.
      ledger.reserve(ledger.ledgerCount + SOLO_LEDGER_HEADROOM_SLOTS);
      this.poolGrowthsAtBoot = ledger.poolGrowths;
      this.ledger = ledger;
      sim.onEvent((e) => this.events.push(e));
      this.sim = sim;
      this.lastSavedHash = restoredFrom === "none" ? -1 : sim.stateHash();
      this.ticksToCheckpoint = Math.round(cfg.checkpointIntervalS * sim.config.tickHz);
      this.clock = new FixedStepClock({ tickHz: sim.config.tickHz });
      this.queue.reset();
      this.encoder.reset();
      this.post({
        t: "ready",
        tick: sim.tick,
        simTickHz: sim.config.tickHz,
        generation: this.generation,
        restoredFrom,
        storeKind: this.store.kind,
      });
      this.postShiftStateIfChanged();
      if (this.dustSyncWanted) this.postDustState("request");
      this.setState("running");
      this.startLoop();
    } catch (e) {
      this.post({ t: "fatal", message: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Restores stored dust chunk rows into `ledger` before the sim starts. The rows are untrusted (the player's disk):
   * inflate is capped, and the restore job checks structure before a chunk changes anything and recounts every
   * ledger. The job runs in slices of DUST_RESTORE_SLICE_BUDGET_MS with a yield between them, so the worker keeps
   * answering messages during a large restore. Returns "" or a description of the chunks that could not be restored
   * (those chunks stay untouched; the others are installed).
   */
  private async restoreDust(
    ledger: WorldDustLedger,
    rows: readonly StoredDustChunk[],
    generation: number,
  ): Promise<string> {
    const t0 = this.sched.now();
    const payloads: Uint8Array[] = [];
    let unreadable = 0;
    for (const row of rows) {
      // Header and chunks are written in one transaction, so a newer row cannot exist; never apply one if it does.
      if (!(row.generation <= generation)) continue;
      try {
        const bytes = new Uint8Array(row.bytes);
        payloads.push(row.codec === "deflate" ? await inflateCapped(bytes, DUST_CHUNK_LAYOUT_MAX_BYTES) : bytes);
      } catch {
        unreadable++;
      }
    }
    const job = new DustRestoreJob(ledger, payloads, this.bakeCheck);
    let slices = 0;
    let sliceMax = 0;
    for (;;) {
      const s0 = this.sched.now();
      const done = job.run(DUST_RESTORE_SLICE_BUDGET_MS, this.nowFn);
      const ms = this.sched.now() - s0;
      slices++;
      if (ms > sliceMax) sliceMax = ms;
      if (done) break;
      await yieldToEvents(this.sched);
    }
    const r = job.result;
    this.dustRestoreChunks = r.chunksRestored;
    this.dustRestoreRejected = r.chunksRejected + unreadable;
    this.dustRestoreLedgers = r.ledgersRestored;
    this.dustRestorePolished = r.polishedRestored;
    this.dustRestoreRepairs =
      r.texelsRepaired + r.headerMismatches + r.stateMismatches + r.logsDropped + r.recordsSkipped;
    this.dustRestoreMs = this.sched.now() - t0;
    this.dustRestoreSlices = slices;
    this.dustRestoreSliceMaxMs = sliceMax;
    // A restore replays no event: the restore job leaves the Opened / Polished queues as they were (empty), and the
    // sim empties them again when it takes the ledger. The dirty-plot list is the host's.
    ledger.clearDirtyPlots();
    if (this.dustRestoreRejected === 0) return "";
    const first = r.firstError ? `${r.firstError.code} (${r.firstError.detail})` : "compressed data unreadable";
    return `dust chunks: ${this.dustRestoreRejected} of ${rows.length} unreadable, first: ${first}`;
  }

  private wrapMemory(bytes: ArrayBuffer): StoredCheckpoint {
    const gz = new Uint8Array(bytes, 0, 2);
    return {
      contractId: this.cfg!.contractId,
      generation: 0,
      parentGeneration: 0,
      simTick: 0,
      savedAtMs: 0,
      codec: gz[0] === 0x1f && gz[1] === 0x8b ? "gzip" : "raw",
      bytes,
    };
  }

  private onInput(buf: ArrayBuffer): void {
    if (decodeInput(new Uint8Array(buf), this.batch)) {
      for (let i = 0; i < this.batch.count; i++) this.queue.push(this.batch.inputs[i as 0 | 1]);
    }
    this.xfer.length = 0;
    this.xfer[0] = buf;
    this.out.postMessage(buf, this.xfer);
    this.xfer.length = 0;
  }

  // ---- loop ---------------------------------------------------------------------------------------------------------

  private startLoop(): void {
    if (!this.clock || this.cfg?.clock !== "realtime") return;
    this.clock.start(this.sched.now());
    this.lastStatsMs = this.sched.now();
    this.schedule();
  }

  private stopLoop(): void {
    this.clock?.stop();
    if (this.timer !== null) this.sched.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (!this.clock?.running) return;
    this.timer = this.sched.setTimeout(this.loopFn, this.clock.delayMs(this.sched.now()));
  }

  private loop(): void {
    this.timer = null;
    const clock = this.clock;
    if (!clock?.running || this.state !== "running") return;
    const n = clock.due(this.sched.now());
    for (let i = 0; i < n; i++) this.tickOnce();
    const now = this.sched.now();
    const every = this.cfg?.statsIntervalMs ?? 0;
    if (every > 0 && now - this.lastStatsMs >= every) {
      this.lastStatsMs = now;
      this.post({ t: "stats", stats: this.stats() });
    }
    this.schedule();
  }

  /** One fixed step: input, intents, step, strokes, frame, events, shift state, checkpoint cadence. */
  tickOnce(): void {
    const sim = this.sim;
    if (!sim) return;
    const t0 = this.sched.now();
    try {
      this.queue.nextForTick(this.input);
      sim.applyInput(SELF, this.input);
      for (let i = 0; i < this.intents.length; i++) sim.applyIntent(SELF, this.intents[i]!);
      this.intents.length = 0;
      sim.step(sim.config.dt);
    } catch (e) {
      this.stopLoop();
      this.setState("failed");
      this.post({ t: "fatal", message: e instanceof Error ? e.message : String(e) });
      return;
    }
    // The sim reads and empties the ledger's Opened / Polished queues itself (Stamp payout, `plot.opened`,
    // `plot.polished`); the host must not. The dirty-plot list feeds `dust.plots` of the FRAME encoder, which does not
    // read it yet, so it is emptied here every tick and never grows; that consumer reads it right above this line.
    const ledger = this.ledger;
    if (ledger !== null) ledger.clearDirtyPlots();
    this.encoder.collectStrokes(sim);
    // Strokes the frame encoder could not keep never reach the main-thread ledger view: resync it with the whole dust
    // state (which contains every stroke still pending, so those are forgotten). Only after a long main-thread stall.
    if (this.encoder.strokesDropped !== this.dropsSeen && this.dustStatesPosted > 0) this.postDustState("dropped");
    this.sendFrame(sim);
    if (this.events.length > 0) {
      this.xfer.length = 0;
      this.out.postMessage(this.evMsg, this.xfer);
      this.events.length = 0;
    }
    this.postShiftStateIfChanged();
    const ro = this.readouts.sample(sim, SELF, this.sched.now());
    if (ro !== null) {
      this.xfer.length = 0;
      this.out.postMessage(ro, this.xfer);
    }
    if (this.ticksToCheckpoint > 0 && sim.tick % this.ticksToCheckpoint === 0) {
      const dustDirty = ledger !== null && ledger.dirtyChunkCount > 0;
      if (dustDirty || sim.stateHash() !== this.lastSavedHash) void this.checkpoint(-1, "timer");
    }
    this.tickMs.push(this.sched.now() - t0);
  }

  private sendFrame(sim: MoonRoomSim): void {
    const buf = this.freeFrames.pop();
    if (buf === undefined) {
      this.framesSkipped++;
      return;
    }
    const u8 = new Uint8Array(buf);
    const len = this.encoder.encode(sim, SELF, this.queue.lastConsumedSeq, this.queue.length, u8);
    if (len === 0) {
      this.freeFrames.push(buf);
      return;
    }
    const tick = sim.tick - 1;
    u8[FRAME_TRAILER_OFFSET] = len & 0xff;
    u8[FRAME_TRAILER_OFFSET + 1] = len >>> 8;
    u8[FRAME_TRAILER_OFFSET + 2] = FRAME_TRAILER_TAG;
    u8[FRAME_TRAILER_OFFSET + 3] = 0;
    u8[FRAME_TRAILER_OFFSET + 4] = tick & 0xff;
    u8[FRAME_TRAILER_OFFSET + 5] = (tick >>> 8) & 0xff;
    u8[FRAME_TRAILER_OFFSET + 6] = (tick >>> 16) & 0xff;
    u8[FRAME_TRAILER_OFFSET + 7] = (tick >>> 24) & 0xff;
    writeToolTelemetry(u8, this.teleF64, this.teleU8, sim, SELF, this.input.seq);
    this.frameBytes.push(len);
    this.framesSent++;
    this.xfer.length = 0;
    this.xfer[0] = buf;
    this.out.postMessage(buf, this.xfer);
    this.xfer.length = 0;
  }

  /**
   * Posts the whole dust ledger (every non-pristine chunk, uncompressed, transferred) for the main-thread ledger view.
   * Rare: when a view attaches, after a reboot, and after the frame encoder dropped strokes. Strokes of this tick that
   * are not sent yet are part of it, so the encoder forgets them.
   */
  private postDustState(reason: "request" | "dropped"): void {
    const sim = this.sim;
    const ledger = this.ledger;
    if (sim === null || ledger === null) return;
    this.dustSyncWanted = false;
    const encoded = encodeDustChunks(ledger, this.bakeCheck, false, this.dustEncoder);
    const chunks: ArrayBuffer[] = [];
    for (const c of encoded) chunks.push(toArrayBuffer(c.payload));
    this.encoder.dropPendingStrokes();
    this.dropsSeen = this.encoder.strokesDropped;
    this.dustStatesPosted++;
    this.post({ t: "dust", tick: sim.tick, bakeCheck: this.bakeCheck, chunks, reason }, chunks.slice());
  }

  private postShiftStateIfChanged(): void {
    const sim = this.sim;
    if (!sim) return;
    const s = this.ssScratch;
    s[0] = sim.wallet;
    for (let a = 0; a < MAX_PLAYERS_PER_ROOM; a++) {
      const av = sim.avatar(a);
      const t = sim.toolState(a);
      s[1 + a * 4] = av.active ? 1 : 0;
      s[2 + a * 4] = av.active ? t.owned : 0;
      s[3 + a * 4] = av.active ? t.toolCode : 0;
      s[4 + a * 4] = av.active ? t.holsterSlot : 0;
    }
    let same = this.ssPosted;
    for (let i = 0; same && i < s.length; i++) if (s[i] !== this.ssSig[i]) same = false;
    if (same) return;
    this.ssSig.set(s);
    this.ssPosted = true;
    const snap = sim.snapshot();
    this.post({ t: "ss", view: { ...snap.shift, tick: Math.max(0, sim.tick - 1) as Tick } });
  }

  // ---- checkpoints --------------------------------------------------------------------------------------------------

  private checkpoint(id: number, reason: LocalCheckpointReason): Promise<void> {
    const run = this.ckptChain.then(() => this.writeCheckpoint(id, reason));
    this.ckptChain = run.catch(() => undefined);
    return run;
  }

  private async writeCheckpoint(id: number, reason: LocalCheckpointReason): Promise<void> {
    const sim = this.sim;
    const cfg = this.cfg;
    const store = this.store;
    const ledger = this.ledger;
    if (!sim || !cfg || !store || !ledger) {
      this.post({ t: "ckpt", id, reason, meta: null, error: "not booted", bytes: null, dust: null });
      return;
    }
    const t0 = this.sched.now();
    const parentGeneration = this.generation;
    const generation = parentGeneration + 1;
    const replaceAll = this.dustReplaceAll;
    let captured: EncodedDustChunk[] = [];
    try {
      // ---- Capture: synchronous, between two ticks, so sim sections and dust chunks are one instant of the game.
      const hash = sim.stateHash();
      const raw = encodeSimCheckpoint(sim, {
        grid: STANDARD_GRID_PARAMS,
        bakeHash: cfg.bakeHash,
        originId: cfg.originId,
        generation,
        parentGeneration,
      });
      const simTick = sim.tick;
      // Dirty chunks only, or every non-pristine chunk when the store does not hold this ledger's rows yet.
      captured = encodeDustChunks(ledger, this.bakeCheck, !replaceAll, this.dustEncoder);
      // The dirty marks are cleared HERE, not after the write: ticks keep running while the bytes are compressed and
      // written, and a stroke that lands in a captured chunk meanwhile must mark it for the next checkpoint. Clearing
      // after the write would erase that mark and lose the stroke on reload. A failed write puts the marks back.
      if (replaceAll) {
        // A full save covers every chunk: a dirty chunk without content is covered by the delete of the old rows.
        for (let c = 0; c < ledger.chunkCount; c++) ledger.clearChunkDirty(c);
      } else {
        for (let k = 0; k < captured.length; k++) ledger.clearChunkDirty(captured[k]!.chunkId);
      }
      this.ckptCaptureLastMs = this.sched.now() - t0;
      this.ckptCaptureMs.push(this.ckptCaptureLastMs);

      // ---- Compress and write: asynchronous, ticks run in between.
      const useGzip = hasCompressionStreams();
      const packed = useGzip ? await gzip(raw) : raw;
      const bytes = toArrayBuffer(packed);
      const chunks: StoredDustChunk[] = [];
      let rawBytes = 0;
      let oversize = 0;
      for (const c of captured) {
        const body = useGzip ? await deflate(c.payload) : c.payload;
        chunks.push({
          chunkId: c.chunkId,
          generation,
          codec: useGzip ? "deflate" : "raw",
          rawSize: c.payload.length,
          bytes: toArrayBuffer(body),
          // CRC32 of the uncompressed payload: the checkpoint sync (apps/client/src/sync) uploads it without an inflate.
          crc32: crc32(c.payload),
        });
        rawBytes += c.payload.length;
        if (c.oversize) oversize++;
      }
      const savedAtMs = this.sched.wallNow();
      // One transaction: the header and its dust chunks are stored together or not at all.
      await store.save(
        {
          contractId: cfg.contractId,
          generation,
          parentGeneration,
          simTick,
          savedAtMs,
          codec: useGzip ? "gzip" : "raw",
          bytes,
        },
        { replaceAll, chunks },
      );
      this.dustReplaceAll = false;
      this.dustChunksWritten += chunks.length;
      this.dustRawBytesWritten += rawBytes;
      this.dustChunksOversize += oversize;
      this.generation = generation;
      this.lastSavedHash = hash;
      this.checkpoints++;
      this.ckptMs.push(this.sched.now() - t0);
      const meta: LocalCheckpointMeta = {
        contractId: cfg.contractId,
        generation,
        parentGeneration,
        simTick: simTick as Tick,
        savedAtMs: Math.max(0, Math.round(savedAtMs)),
        bytes: Math.max(1, bytes.byteLength),
      };
      // Without IndexedDB the host keeps the copies a crash reboot restores from: the header and the chunk rows.
      let copy: ArrayBuffer | null = null;
      let dust: DustChunkWrite | null = null;
      const transfer: Transferable[] = [];
      if (store.kind === "memory") {
        copy = bytes.slice(0);
        transfer.push(copy);
        const copies: StoredDustChunk[] = [];
        for (const c of chunks) {
          const b = c.bytes.slice(0);
          copies.push({ ...c, bytes: b });
          transfer.push(b);
        }
        dust = { replaceAll, chunks: copies };
      }
      this.post({ t: "ckpt", id, reason, meta, error: null, bytes: copy, dust }, transfer);
    } catch (e) {
      // Nothing was stored: the captured chunks still differ from their rows.
      for (let k = 0; k < captured.length; k++) ledger.setChunkDirty(captured[k]!.chunkId);
      if (isQuotaError(e)) this.post({ t: "warn", warning: "quota" });
      this.post({
        t: "ckpt",
        id,
        reason,
        meta: null,
        error: e instanceof Error ? e.message : String(e),
        bytes: null,
        dust: null,
      });
    }
  }

  // ---- stats --------------------------------------------------------------------------------------------------------

  stats(): SimWorkerStats {
    const c = this.queue.counters;
    return {
      tick: this.sim?.tick ?? 0,
      ticks: this.tickMs.count,
      tickP50Ms: this.tickMs.percentile(50),
      tickP95Ms: this.tickMs.percentile(95),
      tickMaxMs: this.tickMs.max,
      ticksDropped: this.clock?.ticksDropped ?? 0,
      framesSent: this.framesSent,
      framesSkippedNoBuffer: this.framesSkipped,
      frameBytesP95: this.frameBytes.percentile(95),
      strokesDropped: this.encoder.strokesDropped,
      inputsConsumed: c.consumed,
      inputsSubstituted: c.substituted,
      inputsStarved: c.starved,
      inputsDoubleStepped: c.doubleStepped,
      inputsDropped: c.droppedLate + c.droppedFull,
      checkpoints: this.checkpoints,
      checkpointP95Ms: this.ckptMs.percentile(95),
      checkpointCaptureP95Ms: this.ckptCaptureMs.percentile(95),
      checkpointCaptureMaxMs: this.ckptCaptureMs.max,
      checkpointCaptureLastMs: this.ckptCaptureLastMs,
      dustChunksWritten: this.dustChunksWritten,
      dustRawBytesWritten: this.dustRawBytesWritten,
      dustChunksOversize: this.dustChunksOversize,
      dustRestoreChunks: this.dustRestoreChunks,
      dustRestoreRejected: this.dustRestoreRejected,
      dustRestoreLedgers: this.dustRestoreLedgers,
      dustRestorePolished: this.dustRestorePolished,
      dustRestoreRepairs: this.dustRestoreRepairs,
      dustRestoreMs: this.dustRestoreMs,
      dustRestoreSlices: this.dustRestoreSlices,
      dustRestoreSliceMaxMs: this.dustRestoreSliceMaxMs,
      ledgers: this.ledger?.ledgerCount ?? 0,
      ledgerPoolGrowths: (this.ledger?.poolGrowths ?? 0) - this.poolGrowthsAtBoot,
      plotsOpened: this.sim?.counters.plotsOpened ?? 0,
      plotsPolished: this.sim?.counters.plotsPolished ?? 0,
    };
  }
}
