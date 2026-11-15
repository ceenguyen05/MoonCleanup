// Off-main-thread DUST_SNAPSHOT inflate with a hold-back queue (online rooms only; solo never constructs this).
//
// The server's ordering rule (apps/server/src/net/shift/shift-dust.ts): a client applies its dust stream IN ARRIVAL
// ORDER, snapshot first, then FRAME strokes / dust.plots / DUST_LEDGER. A worker inflate is asynchronous, so while a
// snapshot is inflating every later message (FRAME, DUST_LEDGER, DUST_CHECK, further slices; not PONG) is copied into a
// queue and replayed IN ORDER, with its original arrival time, right after the snapshot has been applied. The mirror
// therefore reaches the same worldHash as a client that inflated synchronously.
//
// How the session is reused unchanged: the protocol `ClientSession` inflates synchronously inside its own slice
// handler. The offload assembles the slices itself (SnapshotAssembler), sends the deflate stream to the worker, keeps
// copies of the slices, and once the worker answers it feeds those slices to the session; the session's `inflate`
// (`DustOffload.inflate`) then returns the worker's output instead of inflating. If there is no worker, the stream is
// small, the worker errors or times out, the sync decoder runs exactly as before (fallback).
//
// Stale window (paced snapshots, M1-dust-pacing): FRAMEs applied between the first and last slice carry dust the
// snapshot does not include. `noteFrame` records them; `takeGap` reports a lossy window so the caller can resync.
//
// Hot path: when no snapshot is inflating, `push` is one id comparison before the message goes on. `noteFrame` is two
// comparisons. Nothing here allocates per frame.

import { DUST_SNAPSHOT_ID, DUST_SNAPSHOT_MAX_RAW_BYTES, SnapshotAssembler, type Inflate } from "@moon-cleanup/protocol";
import { MESSAGE_CATALOG } from "@moon-cleanup/shared";
import { isInflateResult, type InflateWorkerPort } from "./inflate-worker-core";

const PONG_ID = MESSAGE_CATALOG.PONG.id;

/** A worker that has not answered after this long is abandoned and the stream is inflated synchronously. */
export const OFFLOAD_TIMEOUT_MS = 3000;
/** Deflate streams below this size are inflated inline: the worker round trip would cost more than they do. */
export const OFFLOAD_MIN_DEFLATED_BYTES = 2048;
/** Hold-back queue bound; reaching it ends the hold with a synchronous inflate (never drops a message). */
export const OFFLOAD_MAX_HELD = 512;

export interface DustOffloadOptions {
  /** Delivers one message to the protocol session (and `onBytes` for unhandled ids), stamped with its arrival time. */
  readonly deliver: (message: Uint8Array, at: number) => void;
  /** Synchronous fallback decoder (default for the session: `inflateRaw`). */
  readonly inflate: Inflate;
  readonly timeoutMs?: number;
  readonly minDeflatedBytes?: number;
  readonly maxHeld?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** Clock for the stats only. */
  readonly now?: () => number;
}

export interface DustOffloadStats {
  /** Snapshots whose inflate ran in the worker. */
  offloaded: number;
  /** Snapshots handed to the session for the synchronous inflate (no worker, small stream, or a fallback). */
  inline: number;
  /** Messages queued behind an inflating snapshot (total) and the deepest queue seen. */
  held: number;
  maxHeldDepth: number;
  /** Queued messages replayed after a snapshot applied. */
  replayed: number;
  workerErrors: number;
  timeouts: number;
  /** Queue bound reached: the hold ended with a synchronous inflate. */
  overflows: number;
  /** Worker verdict was "corrupt" (the session then counts the invalid snapshot and resyncs). */
  workerRejected: number;
  /** Snapshots whose transfer window contained FRAME dust the snapshot does not include. */
  gaps: number;
  /** Longest hold (ms) from the last slice to the replay of the queue. */
  maxHoldMs: number;
}

interface Held {
  readonly message: Uint8Array;
  readonly at: number;
}

export class DustOffload {
  readonly stats: DustOffloadStats = {
    offloaded: 0,
    inline: 0,
    held: 0,
    maxHeldDepth: 0,
    replayed: 0,
    workerErrors: 0,
    timeouts: 0,
    overflows: 0,
    workerRejected: 0,
    gaps: 0,
    maxHoldMs: 0,
  };
  private readonly deliver: (message: Uint8Array, at: number) => void;
  private readonly syncInflate: Inflate;
  private readonly timeoutMs: number;
  private readonly minDeflated: number;
  private readonly maxHeld: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly now: () => number;
  private readonly assembler = new SnapshotAssembler();
  private port: InflateWorkerPort | null = null;
  private holding = false;
  private queue: Held[] = [];
  private head = 0;
  /** Copies of the slices of the snapshot being assembled / inflated, in arrival order. */
  private slices: Uint8Array[] = [];
  private sliceVersion = -1;
  private sliceTotal = 0;
  private sliceReceived = 0;
  private jobId = 0;
  private job: { id: number; deflated: Uint8Array; at: number; startedAt: number } | null = null;
  private timer: unknown = undefined;
  /** Worker output for the stream being re-fed to the session: undefined none, null known-corrupt, else the bytes. */
  private verdict: Uint8Array | null | undefined = undefined;
  private staleTick = 0;
  private hasStale = false;
  private gapPending = false;

  constructor(options: DustOffloadOptions) {
    this.deliver = options.deliver;
    this.syncInflate = options.inflate;
    this.timeoutMs = options.timeoutMs ?? OFFLOAD_TIMEOUT_MS;
    this.minDeflated = options.minDeflatedBytes ?? OFFLOAD_MIN_DEFLATED_BYTES;
    this.maxHeld = Math.max(1, options.maxHeld ?? OFFLOAD_MAX_HELD);
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.now = options.now ?? (() => performance.now());
  }

  /** The `inflate` for the protocol session: returns the worker's output for a re-fed stream, else inflates inline. */
  readonly inflate: Inflate = (data, maxBytes) => {
    const v = this.verdict;
    if (v !== undefined) {
      this.verdict = undefined;
      return v === null || v.byteLength > maxBytes ? null : v;
    }
    return this.syncInflate(data, maxBytes);
  };

  get workerAttached(): boolean {
    return this.port !== null;
  }

  /** True while a snapshot is inflating (later dust messages are being held back). */
  get isHolding(): boolean {
    return this.holding;
  }

  /** Messages waiting behind the inflating snapshot. */
  get heldCount(): number {
    return this.queue.length - this.head;
  }

  /** Attaches the worker port (once it exists); null or a second call is ignored. */
  attach(port: InflateWorkerPort | null): void {
    if (port === null || this.port !== null) return;
    this.port = port;
    port.onmessage = (e) => this.onWorkerMessage(e.data);
    port.onerror = () => this.onWorkerFailed(false);
  }

  /** One inbound bytes message (id byte first), in arrival order. `message` may be a reused buffer; it is copied if kept. */
  push(message: Uint8Array, at: number): void {
    if (this.holding) {
      if (message[0] === PONG_ID) {
        this.deliver(message, at); // clock sync is not dust and must not age in the queue
        return;
      }
      this.hold(message, at);
      return;
    }
    if (message[0] === DUST_SNAPSHOT_ID) {
      this.onSlice(message, at);
      return;
    }
    this.deliver(message, at);
  }

  /**
   * Call from the session's `onFrame` host callback. Records FRAME dust (strokes, dust.plots) applied while a
   * snapshot was still being transferred: the snapshot, built earlier, does not include it.
   */
  noteFrame(serverTick: number, hasDust: boolean): void {
    if (!hasDust || this.slices.length === 0) return;
    this.staleTick = serverTick;
    this.hasStale = true;
  }

  /** True once (and clears) when the snapshot just applied had FRAME dust arrive during its transfer. */
  takeGap(): boolean {
    const g = this.gapPending;
    this.gapPending = false;
    return g;
  }

  /** Forgets everything in flight (connection dropped): the next join sends a fresh snapshot. */
  reset(): void {
    this.cancelTimer();
    this.job = null;
    this.holding = false;
    this.queue = [];
    this.head = 0;
    this.slices = [];
    this.sliceVersion = -1;
    this.sliceTotal = 0;
    this.sliceReceived = 0;
    this.verdict = undefined;
    this.hasStale = false;
    this.gapPending = false;
    this.assembler.take();
    this.assembler.version = -1;
    this.assembler.sliceCount = 0;
    this.assembler.received = 0;
  }

  dispose(): void {
    this.reset();
    const p = this.port;
    this.port = null;
    if (p !== null) {
      p.onmessage = null;
      p.onerror = null;
      p.terminate();
    }
  }

  // ---- internals ------------------------------------------------------------------------------------------------------

  private hold(message: Uint8Array, at: number): void {
    if (this.queue.length - this.head >= this.maxHeld) {
      // Bound reached: finish synchronously rather than drop a message, then process this one in order.
      this.stats.overflows++;
      const job = this.job;
      if (job !== null) this.finish(this.syncInflate(job.deflated, DUST_SNAPSHOT_MAX_RAW_BYTES));
      this.push(message, at);
      return;
    }
    this.queue.push({ message: message.slice(), at });
    this.stats.held++;
    const depth = this.queue.length - this.head;
    if (depth > this.stats.maxHeldDepth) this.stats.maxHeldDepth = depth;
  }

  private onSlice(message: Uint8Array, at: number): void {
    const result = this.assembler.add(message);
    if (result === "invalid") {
      this.deliver(message, at); // the session counts it
      return;
    }
    // Mirror the assembler's restart rule (a different version or slice count starts a new snapshot).
    const version = this.assembler.version;
    const total = this.assembler.sliceCount;
    if (version !== this.sliceVersion || total !== this.sliceTotal) {
      this.slices = [];
      this.sliceVersion = version;
      this.sliceTotal = total;
    } else if (this.assembler.received === this.sliceReceived) {
      return; // a duplicate slice: the session's assembler would ignore it too (and the copy list stays bounded)
    }
    this.sliceReceived = this.assembler.received;
    this.slices.push(message.slice());
    if (result === "pending") return;
    const deflated = this.assembler.take();
    const slices = this.slices;
    if (deflated === null || this.port === null || deflated.byteLength < this.minDeflated) {
      this.flushInline(slices, at);
      return;
    }
    this.startJob(deflated, at);
  }

  /** Hands the retained slices to the session; its `inflate` runs inline (no verdict). */
  private flushInline(slices: Uint8Array[], at: number): void {
    this.slices = [];
    this.sliceVersion = -1;
    this.sliceTotal = 0;
    this.sliceReceived = 0;
    this.stats.inline++;
    this.noteGap();
    for (const s of slices) this.deliver(s, at);
  }

  private startJob(deflated: Uint8Array, at: number): void {
    const port = this.port;
    if (port === null) return;
    const id = ++this.jobId;
    this.job = { id, deflated, at, startedAt: this.now() };
    this.holding = true;
    try {
      port.postMessage({ id, data: deflated, maxBytes: DUST_SNAPSHOT_MAX_RAW_BYTES });
    } catch {
      this.onWorkerFailed(false);
      return;
    }
    this.timer = this.setTimer(() => this.onWorkerFailed(true), this.timeoutMs);
  }

  private onWorkerMessage(data: unknown): void {
    const job = this.job;
    if (job === null || !isInflateResult(data) || data.id !== job.id) return;
    if (data.out === null) this.stats.workerRejected++;
    this.stats.offloaded++;
    this.finish(data.out);
  }

  /** Worker error or timeout: the worker is abandoned for good and the stream is inflated inline once. */
  private onWorkerFailed(timeout: boolean): void {
    if (timeout) this.stats.timeouts++;
    else this.stats.workerErrors++;
    const port = this.port;
    this.port = null;
    if (port !== null) {
      port.onmessage = null;
      port.onerror = null;
      try {
        port.terminate();
      } catch {
        // ignore: the worker is already unusable
      }
    }
    const job = this.job;
    if (job === null) return;
    this.finish(this.syncInflate(job.deflated, DUST_SNAPSHOT_MAX_RAW_BYTES));
  }

  /** Re-feeds the snapshot to the session with the inflate result, then replays the held messages in order. */
  private finish(out: Uint8Array | null): void {
    const job = this.job;
    if (job === null) return;
    this.cancelTimer();
    this.job = null;
    const elapsed = this.now() - job.startedAt;
    if (elapsed > this.stats.maxHoldMs) this.stats.maxHoldMs = elapsed;
    const slices = this.slices;
    this.slices = [];
    this.sliceVersion = -1;
    this.sliceTotal = 0;
    this.sliceReceived = 0;
    this.holding = false;
    this.noteGap();
    this.verdict = out;
    try {
      for (const s of slices) this.deliver(s, job.at);
    } finally {
      this.verdict = undefined;
    }
    this.drain();
  }

  private drain(): void {
    while (!this.holding && this.head < this.queue.length) {
      const h = this.queue[this.head++]!;
      this.stats.replayed++;
      this.push(h.message, h.at);
    }
    if (this.head >= this.queue.length) {
      this.queue.length = 0;
      this.head = 0;
    }
  }

  private noteGap(): void {
    if (!this.hasStale) return;
    this.hasStale = false;
    const version = this.assembler.version;
    if (((this.staleTick - version) | 0) > 0) {
      this.gapPending = true;
      this.stats.gaps++;
    }
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }
}
