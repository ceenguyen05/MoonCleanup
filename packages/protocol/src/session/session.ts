// Client session state machine (netcode.md sections 9, 10, 12; M1-W4-T01). Pure TypeScript: no transport, no timers,
// no clock of its own. The transport adapter (apps/client/src/net, Colyseus SDK) feeds it events and executes the
// commands it raises through `SessionHost`; a fixed-interval `tick(nowMs)` (for example every 250 ms, also while the
// tab is hidden) drives every deadline, so the machine is fully deterministic under test.
//
// Phases
//   idle        nothing started
//   waking      Render cold start (about one minute): `GET /healthz` probes every `probeIntervalMs` until our JSON
//               answers; `wakeFraction(now)` feeds the progress bar; gives up after `wakeBudgetMs` (failed)
//   connecting  joining the room; failures retry with backoff 1, 2, 4, 8 s; after `wakeAfterFailures` consecutive
//               failures with the wake probe enabled it goes back to waking (the instance may have restarted)
//   joining     in the room, waiting for hello + keyframe FRAME + blocking DUST_SNAPSHOT (any order); then `ready`
//               is sent once and the phase becomes joined (netcode.md 9.1)
//   joined      steady state: FRAMEs are applied in order; duplicates and older frames are dropped
//   resyncing   in the room, entity table untrusted: non-keyframe FRAMEs are dropped until a keyframe arrives (and,
//               when a snapshot is expected, until the DUST_SNAPSHOT is assembled). Entered on a FRAME decode error,
//               after a stall of `stallResyncMs`, on a tab becoming visible, and after a seat-hold reconnect
//   reconnecting connection dropped after the first ready: seat held for `holdMs` (60 s); attempts with backoff
//               0.5, 1, 2, 4, 8 s through `host.connect("reconnect")` (or by the SDK when `reconnect.drive` is false;
//               the adapter then reports `onConnected` / `onConnectFailed`); the hold running out is failed(seat_lost)
//   failed      terminal until `retry(now)`; `failure` says why, whether a retry makes sense and how long to wait
//   closed      left on purpose (4000 or `leave()`)
//
// Messages are whole catalog messages (the id byte first), as FrameReader and SnapshotAssembler expect. Compression is
// injected (`inflate`). The hot path (`onFrame`) takes its clock from `io[IO_NOW]` (a Float64Array store, not a call
// argument) and allocates nothing.
//
// Keyframe contract [R, for server-engineer and contracts-architect]: after join, after a resync request and after a
// reconnect the client resets its SlotTable and decodes from empty, so the server's keyframe FRAME must re-send every
// slot assignment and FULL records for every entity in interest, starting from an empty client table. There is no
// dedicated "request keyframe" message in the catalog: `host.requestResync` is meant to send `visibility {hidden:
// false}` (idempotent; the server answers with keyframe FRAME + fresh DUST_SNAPSHOT, netcode.md 7), one per second at most.

import {
  CloseCode,
  FOREIGN_CLOSE_CODES,
  FRAME_FLAG_BIT,
  FRAME_HEADER_BYTES,
  MESSAGE_CATALOG,
  PROTOCOL_VERSION,
  SDK_RECONNECT_CLOSE_CODES,
  type HelloPayload,
} from "@moon-cleanup/shared";
import { decodePong, type PongTarget } from "../codec/ping";
import { FRAME_OK, FrameReader } from "../codec/frame-reader";
import { FrameView, SlotTable } from "../codec/frame-state";
import {
  DUST_SNAPSHOT_ID,
  SnapshotAssembler,
  decodeSnapshotStream,
  type DecodedSnapshot,
  type Inflate,
} from "../codec/dust-messages";
import { IO_NOW, type InterpolationBuffer } from "../interpolation/interpolation-buffer";
import { ClockSync } from "../interpolation/clock-sync";
import { CONNECT_BACKOFF, RECONNECT_BACKOFF, backoffDelayMs, type BackoffOptions } from "./backoff";

export type SessionPhase =
  "idle" | "waking" | "connecting" | "joining" | "joined" | "resyncing" | "reconnecting" | "failed" | "closed";

/** What `host.connect` is asked to do. */
export type ConnectMode = "join" | "reconnect" | "restore";

export type ResyncReason = "decode" | "snapshot" | "stall" | "visible" | "timeout";

export type FailureReason =
  | "protocol_mismatch"
  | "auth_invalid"
  | "kicked"
  | "banned"
  | "rate_limited"
  | "room_full"
  /** REST join refused with 503 AT_CAPACITY (instance at MAX_ROOMS / MAX_CLIENTS; same UI family as 4105). */
  | "at_capacity"
  /** REST join refused with 403 (not a member of the Contract, or banned from it). */
  | "forbidden"
  | "duplicate_session"
  | "idle_timeout"
  | "contract_unavailable"
  | "server_error"
  | "wake_timeout"
  | "connect_failed"
  | "join_timeout"
  | "seat_lost"
  | "resync_failed"
  | "closed_unexpected";

export interface SessionFailure {
  readonly reason: FailureReason;
  /** The WebSocket close code that caused it, or 0. */
  readonly code: number;
  /** True when `retry(now)` (possibly after a token refresh or `retryAfterMs`) can succeed. */
  readonly retryable: boolean;
  readonly retryAfterMs: number;
}

/** Commands the session raises; the transport adapter executes them. */
export interface SessionHost {
  /** `GET /healthz`; answer with `onHealth`. */
  probeHealth(): void;
  /** Open a connection (new join, seat-reservation reconnect, or rejoin with restore); answer with onConnected / onConnectFailed. */
  connect(mode: ConnectMode): void;
  /** Send the `ready` control message (once per join). */
  sendReady(): void;
  /** Ask for a keyframe FRAME + DUST_SNAPSHOT (see the keyframe contract above). */
  requestResync(reason: ResyncReason): void;
  /** Send a PING stamped with the adapter's clock (`writePingBody`). */
  sendPing(): void;
  /** Send the `visibility` control message. */
  sendVisibility(hidden: boolean): void;
  onPhase?(phase: SessionPhase, previous: SessionPhase): void;
  /** A frame was decoded and applied (the view is reused: read it now). */
  onFrame?(view: FrameView, keyframe: boolean): void;
  /** The entity table and interpolation rings were cleared (join, resync, reconnect). */
  onSlotsReset?(): void;
  /** A complete DUST_SNAPSHOT was decoded; rebuild the dust field from it. */
  onDustSnapshot?(snapshot: DecodedSnapshot): void;
}

export interface SessionConfig {
  /** Plot count of the world grid (bounds plot ids in decoders). */
  plotCount: number;
  /** Inflate of the snapshot stream (server zlib / client fflate). */
  inflate: Inflate;
  /** Probe /healthz before connecting (false for a local server: connect at once). */
  wakeProbe?: boolean;
  protocolVersion?: number;
  /** Optional remote-entity buffer: reset, configured and fed by the session. */
  interpolation?: InterpolationBuffer;
  clock?: ClockSync;
  /** Health probe period (3 s) and total wake budget (150 s); expected wake time for the progress bar (60 s). */
  probeIntervalMs?: number;
  wakeBudgetMs?: number;
  wakeExpectedMs?: number;
  connectTimeoutMs?: number;
  maxConnectAttempts?: number;
  wakeAfterFailures?: number;
  connectBackoff?: BackoffOptions;
  reconnectBackoff?: BackoffOptions;
  /** Seat hold (SEAT_HOLD_S = 60 s). */
  holdMs?: number;
  /** Reconnects longer than this expect a fresh DUST_SNAPSHOT (netcode.md 9.2: 10 s). */
  snapshotAfterMs?: number;
  /**
   * Whether join, resync and long reconnects wait for a DUST_SNAPSHOT before `ready` (default true, netcode.md 9.1).
   * False only for a server build that does not stream dust yet (the M1 ShiftRoom before the ledger, W3-T01): the
   * keyframe FRAME alone then completes the join.
   */
  expectDustSnapshot?: boolean;
  /** false: the SDK reconnects by itself; the session only waits for onConnected / onConnectFailed. */
  driveReconnect?: boolean;
  joinTimeoutMs?: number;
  resyncMinIntervalMs?: number;
  resyncTimeoutMs?: number;
  resyncMaxAttempts?: number;
  /** A frame arriving after this silence (visible tab) forces a resync. */
  stallResyncMs?: number;
  /** No frame for this long flags `signalLost`. */
  signalLostMs?: number;
  pingIntervalMs?: number;
  random?: () => number;
}

export interface SessionStats {
  framesApplied: number;
  framesDuplicate: number;
  framesStale: number;
  framesAwaitingKeyframe: number;
  framesInvalid: number;
  framesIgnored: number;
  /** Frames the server skipped between two applied frames (statistics; hidden-tab 1 Hz frames count too). */
  framesGapEstimate: number;
  resyncs: number;
  snapshotsApplied: number;
  snapshotsInvalid: number;
  snapshotSlicesInvalid: number;
  pongsInvalid: number;
  reconnects: number;
}

// ---- return codes ----------------------------------------------------------------------------------------------------

export const SESSION_FRAME_APPLIED = 0;
export const SESSION_FRAME_DUPLICATE = 1;
export const SESSION_FRAME_STALE = 2;
export const SESSION_FRAME_AWAITING_KEYFRAME = 3;
export const SESSION_FRAME_INVALID = 4;
export const SESSION_FRAME_IGNORED = 5;

export const SESSION_BYTES_HANDLED = 0;
/** Not a session message (DUST_LEDGER, DUST_LOG, DUST_CHECK, ...): the adapter decodes it. */
export const SESSION_BYTES_UNHANDLED = 1;
export const SESSION_BYTES_DROPPED = 2;

// ---- close code classification ---------------------------------------------------------------------------------------

export type CloseAction =
  | { readonly kind: "closed" }
  | { readonly kind: "reconnect" }
  | { readonly kind: "restore" }
  | { readonly kind: "fail"; readonly failure: SessionFailure };

const fail = (reason: FailureReason, code: number, retryable: boolean, retryAfterMs = 0): CloseAction => ({
  kind: "fail",
  failure: { reason, code, retryable, retryAfterMs },
});

/** netcode.md section 12, "client behaviour" column. */
export function classifyClose(code: number): CloseAction {
  if (code === FOREIGN_CLOSE_CODES.CONSENTED || code === FOREIGN_CLOSE_CODES.NORMAL_CLOSURE) return { kind: "closed" };
  if ((SDK_RECONNECT_CLOSE_CODES as readonly number[]).includes(code)) return { kind: "reconnect" };
  switch (code) {
    case FOREIGN_CLOSE_CODES.SERVER_SHUTDOWN:
      return { kind: "restore" };
    case FOREIGN_CLOSE_CODES.WITH_ERROR:
      return fail("server_error", code, true);
    case FOREIGN_CLOSE_CODES.FAILED_TO_RECONNECT:
      return fail("seat_lost", code, true);
    case CloseCode.PROTOCOL_MISMATCH:
      return fail("protocol_mismatch", code, false);
    case CloseCode.AUTH_INVALID:
      return fail("auth_invalid", code, true);
    case CloseCode.KICKED:
      return fail("kicked", code, false, 15 * 60_000);
    case CloseCode.BANNED:
      return fail("banned", code, false);
    case CloseCode.RATE_LIMITED:
      return fail("rate_limited", code, true, 30_000);
    case CloseCode.ROOM_FULL:
      return fail("room_full", code, true);
    case CloseCode.DUPLICATE_SESSION:
      return fail("duplicate_session", code, false);
    case CloseCode.IDLE_TIMEOUT:
      return fail("idle_timeout", code, true);
    case CloseCode.CONTRACT_UNAVAILABLE:
      return fail("contract_unavailable", code, false);
    default:
      return fail("closed_unexpected", code, true);
  }
}

const KEYFRAME_FLAG = 1 << FRAME_FLAG_BIT.keyframe;
const FRAME_ID = MESSAGE_CATALOG.FRAME.id;
const PONG_ID = MESSAGE_CATALOG.PONG.id;

export class ClientSession {
  phase: SessionPhase = "idle";
  failure: SessionFailure | null = null;
  readonly stats: SessionStats = {
    framesApplied: 0,
    framesDuplicate: 0,
    framesStale: 0,
    framesAwaitingKeyframe: 0,
    framesInvalid: 0,
    framesIgnored: 0,
    framesGapEstimate: 0,
    resyncs: 0,
    snapshotsApplied: 0,
    snapshotsInvalid: 0,
    snapshotSlicesInvalid: 0,
    pongsInvalid: 0,
    reconnects: 0,
  };
  /** Input cell: `io[IO_NOW]` = the adapter's local clock in ms, written before `onFrame` / `onPong`. */
  readonly io = new Float64Array(2);
  readonly clock: ClockSync;
  readonly table = new SlotTable();
  /** The last decoded frame (reused). */
  readonly view = new FrameView();
  readonly hello: { serverProtocol: number; simTickHz: number; snapshotHz: number; received: boolean } = {
    serverProtocol: 0,
    simTickHz: 20,
    snapshotHz: 10,
    received: false,
  };
  /** Sim ticks between two frames, from the hello. */
  frameIntervalTicks = 2;
  /** False while a DUST_SNAPSHOT is awaited: the adapter must ignore frame stroke/plot sections then. */
  dustReady = false;
  /** No frame for `signalLostMs` while in the room and visible. */
  signalLost = false;
  /** serverTick of the last applied frame. */
  lastTick = 0;
  hidden = false;

  private readonly host: SessionHost;
  private readonly cfg: Required<Omit<SessionConfig, "interpolation" | "clock" | "random">>;
  private readonly interpolation: InterpolationBuffer | null;
  private readonly random: () => number;
  private readonly reader = new FrameReader();
  private readonly assembler = new SnapshotAssembler();
  private readonly pong: PongTarget = { clientTimeMs: 0, serverTick: 0 };

  private awaitingKeyframe = false;
  private keyframeApplied = false;
  private snapshotDone = false;
  private readySent = false;
  private haveTick = false;
  private lastFrameAt = 0;
  private everReady = false;

  // connect / wake bookkeeping
  private joinMode: ConnectMode = "join";
  private wakeStartedAt = 0;
  private wakeAttempts = 0;
  private probeInFlight = false;
  private nextProbeAt = 0;
  private connectFailures = 0;
  private attemptInFlight = false;
  private attemptStartedAt = 0;
  private attemptPending = false;
  private nextAttemptAt = 0;
  private joinStartedAt = 0;
  // reconnect
  private reconnectDeadline = 0;
  private disconnectedAt = 0;
  // resync
  private lastResyncAt = -Infinity;
  private resyncAttempts = 0;
  private resyncPending = false;
  private resyncReason: ResyncReason = "decode";
  // ping
  private nextPingAt = 0;
  private pingBurst = 0;

  constructor(host: SessionHost, config: SessionConfig) {
    this.host = host;
    this.cfg = {
      plotCount: config.plotCount,
      inflate: config.inflate,
      wakeProbe: config.wakeProbe ?? true,
      protocolVersion: config.protocolVersion ?? PROTOCOL_VERSION,
      probeIntervalMs: config.probeIntervalMs ?? 3000,
      wakeBudgetMs: config.wakeBudgetMs ?? 150_000,
      wakeExpectedMs: config.wakeExpectedMs ?? 60_000,
      connectTimeoutMs: config.connectTimeoutMs ?? 15_000,
      maxConnectAttempts: config.maxConnectAttempts ?? 8,
      wakeAfterFailures: config.wakeAfterFailures ?? 2,
      connectBackoff: config.connectBackoff ?? CONNECT_BACKOFF,
      reconnectBackoff: config.reconnectBackoff ?? RECONNECT_BACKOFF,
      holdMs: config.holdMs ?? 60_000,
      snapshotAfterMs: config.snapshotAfterMs ?? 10_000,
      expectDustSnapshot: config.expectDustSnapshot ?? true,
      driveReconnect: config.driveReconnect ?? true,
      joinTimeoutMs: config.joinTimeoutMs ?? 45_000,
      resyncMinIntervalMs: config.resyncMinIntervalMs ?? 1000,
      resyncTimeoutMs: config.resyncTimeoutMs ?? 4000,
      resyncMaxAttempts: config.resyncMaxAttempts ?? 5,
      stallResyncMs: config.stallResyncMs ?? 5000,
      signalLostMs: config.signalLostMs ?? 1000,
      pingIntervalMs: config.pingIntervalMs ?? 2000,
    };
    this.interpolation = config.interpolation ?? null;
    this.clock = config.clock ?? config.interpolation?.clock ?? new ClockSync();
    this.random = config.random ?? (() => 0.5);
  }

  /** True while inside the room (joining, joined, resyncing). */
  get inRoom(): boolean {
    return this.phase === "joining" || this.phase === "joined" || this.phase === "resyncing";
  }

  /** Wake progress 0 .. 0.95 against the expected cold-start time (UI progress bar). */
  wakeFraction(nowMs: number): number {
    if (this.phase !== "waking") return 0;
    return Math.min(0.95, Math.max(0, nowMs - this.wakeStartedAt) / this.cfg.wakeExpectedMs);
  }

  wakeElapsedMs(nowMs: number): number {
    return this.phase === "waking" ? Math.max(0, nowMs - this.wakeStartedAt) : 0;
  }

  wakeProbeCount(): number {
    return this.wakeAttempts;
  }

  // ---- lifecycle -------------------------------------------------------------------------------------------------------

  /** Starts from idle, failed or closed. */
  start(nowMs: number): void {
    if (this.phase !== "idle" && this.phase !== "failed" && this.phase !== "closed") return;
    this.failure = null;
    this.connectFailures = 0;
    this.joinMode = "join";
    this.everReady = false;
    this.beginWakeOrConnect(nowMs);
  }

  /** Alias of `start` after a failure (the adapter refreshes the token first for `auth_invalid`). */
  retry(nowMs: number): void {
    this.start(nowMs);
  }

  /** The player left on purpose. */
  leave(): void {
    this.setPhase("closed");
  }

  private beginWakeOrConnect(nowMs: number): void {
    if (this.cfg.wakeProbe) {
      this.enterWaking(nowMs);
    } else {
      this.enterConnecting(nowMs);
    }
  }

  private enterWaking(nowMs: number): void {
    if (this.phase !== "waking") {
      this.wakeStartedAt = nowMs;
      this.wakeAttempts = 0;
    }
    this.attemptInFlight = false;
    this.attemptPending = false;
    this.probeInFlight = false;
    this.nextProbeAt = nowMs;
    this.setPhase("waking");
    this.launchProbe(nowMs);
  }

  private launchProbe(nowMs: number): void {
    this.probeInFlight = true;
    this.wakeAttempts++;
    this.nextProbeAt = nowMs + this.cfg.probeIntervalMs;
    this.host.probeHealth();
  }

  /** Answer to `probeHealth`: `ok` = our JSON arrived (not the Render waking page, not a CORS or network failure). */
  onHealth(nowMs: number, ok: boolean, serverProtocol = this.cfg.protocolVersion): void {
    if (this.phase !== "waking") return;
    this.probeInFlight = false;
    if (!ok) {
      return;
    }
    if (serverProtocol !== this.cfg.protocolVersion) {
      this.failWith({
        reason: "protocol_mismatch",
        code: CloseCode.PROTOCOL_MISMATCH,
        retryable: false,
        retryAfterMs: 0,
      });
      return;
    }
    this.enterConnecting(nowMs);
  }

  private enterConnecting(nowMs: number): void {
    this.setPhase("connecting");
    this.launchConnect(nowMs, this.joinMode);
  }

  private launchConnect(nowMs: number, mode: ConnectMode): void {
    this.attemptInFlight = true;
    this.attemptPending = false;
    this.attemptStartedAt = nowMs;
    this.host.connect(mode);
  }

  /** The connection opened. */
  onConnected(nowMs: number): void {
    if (this.phase === "reconnecting") {
      this.attemptInFlight = false;
      this.stats.reconnects++;
      const away = nowMs - this.disconnectedAt;
      this.beginAwaitKeyframe(away > this.cfg.snapshotAfterMs);
      this.resyncAttempts = 0;
      this.lastResyncAt = nowMs; // the server sends the keyframe by itself after a seat-reservation reconnect
      this.setPhase("resyncing");
      return;
    }
    if (this.phase !== "connecting") return;
    this.attemptInFlight = false;
    this.connectFailures = 0;
    this.joinStartedAt = nowMs;
    this.hello.received = false;
    this.readySent = false;
    this.beginAwaitKeyframe(true);
    this.lastResyncAt = nowMs;
    this.resyncAttempts = 0;
    this.pingBurst = 4;
    this.nextPingAt = nowMs;
    this.setPhase("joining");
  }

  /** A connection attempt failed (refused, timed out, rejected without one of our close codes). */
  onConnectFailed(nowMs: number): void {
    if (this.phase === "reconnecting") {
      this.attemptInFlight = false;
      this.connectFailures++;
      // The first wait (0.5 s) was taken when the connection dropped; after failure n wait delay(n): 1, 2, 4, 8 s.
      this.nextAttemptAt = nowMs + backoffDelayMs(this.cfg.reconnectBackoff, this.connectFailures, this.random);
      return;
    }
    if (this.phase !== "connecting") return;
    this.attemptInFlight = false;
    this.connectFailures++;
    if (
      this.cfg.wakeProbe &&
      this.connectFailures >= this.cfg.wakeAfterFailures &&
      this.connectFailures % this.cfg.wakeAfterFailures === 0
    ) {
      this.enterWaking(nowMs);
      return;
    }
    if (this.connectFailures > this.cfg.maxConnectAttempts) {
      this.failWith({ reason: "connect_failed", code: 0, retryable: true, retryAfterMs: 0 });
      return;
    }
    this.attemptPending = true;
    this.nextAttemptAt = nowMs + backoffDelayMs(this.cfg.connectBackoff, this.connectFailures - 1, this.random);
  }

  /**
   * The join was refused before any connection opened (REST seat reservation: 401 after a token refresh, 403, 404,
   * ROOM_FULL, AT_CAPACITY, RATE_LIMITED, ...). Transient refusals (CONTRACT_BUSY, RETRY_LATER, network) are
   * `onConnectFailed` instead, which retries with backoff.
   */
  onJoinRejected(nowMs: number, failure: SessionFailure): void {
    void nowMs;
    if (this.phase !== "connecting") return;
    this.failWith(failure);
  }

  /** The connection closed with `code`. */
  onClosed(nowMs: number, code: number): void {
    if (this.phase === "idle" || this.phase === "failed" || this.phase === "closed") return;
    const action = classifyClose(code);
    if (action.kind === "closed") {
      this.setPhase("closed");
      return;
    }
    if (action.kind === "fail") {
      this.failWith(action.failure);
      return;
    }
    // reconnect / restore
    if (this.phase === "reconnecting" || (this.phase === "connecting" && this.attemptInFlight)) {
      this.onConnectFailed(nowMs);
      return;
    }
    if (this.phase === "waking") return;
    if (action.kind === "restore") {
      // SIGTERM drain: the instance is going away; rejoin with restore once it answers again.
      this.joinMode = "restore";
      this.everReady = false;
      this.connectFailures = 0;
      this.beginWakeOrConnect(nowMs);
      return;
    }
    if (this.everReady && this.inRoom) {
      this.disconnectedAt = nowMs;
      this.reconnectDeadline = nowMs + this.cfg.holdMs;
      this.connectFailures = 0;
      this.attemptInFlight = false;
      this.nextAttemptAt = nowMs + backoffDelayMs(this.cfg.reconnectBackoff, 0, this.random);
      this.setPhase("reconnecting");
      return;
    }
    // dropped while still joining: start the join over
    this.attemptInFlight = false;
    this.setPhase("connecting");
    this.onConnectFailed(nowMs);
  }

  // ---- messages --------------------------------------------------------------------------------------------------------

  /** The server's first control message. */
  onHello(nowMs: number, hello: HelloPayload): void {
    if (!this.inRoom) return;
    if (hello.serverProtocol !== this.cfg.protocolVersion) {
      this.failWith({
        reason: "protocol_mismatch",
        code: CloseCode.PROTOCOL_MISMATCH,
        retryable: false,
        retryAfterMs: 0,
      });
      return;
    }
    this.hello.serverProtocol = hello.serverProtocol;
    this.hello.simTickHz = hello.simTickHz;
    this.hello.snapshotHz = hello.snapshotHz;
    this.hello.received = true;
    this.frameIntervalTicks = Math.max(1, Math.round(hello.simTickHz / hello.snapshotHz));
    this.clock.configure(hello.simTickHz);
    this.interpolation?.configure(hello.simTickHz, hello.snapshotHz);
    this.pingBurst = Math.max(this.pingBurst, 4);
    this.nextPingAt = nowMs;
    this.checkReady();
  }

  /** Dispatches a bytes-channel message by its id. FRAME, DUST_SNAPSHOT and PONG are the session's; others are not. */
  onBytes(message: Uint8Array): number {
    if (message.byteLength === 0) return SESSION_BYTES_DROPPED;
    const id = message[0];
    if (id === FRAME_ID)
      return this.onFrame(message) === SESSION_FRAME_INVALID ? SESSION_BYTES_DROPPED : SESSION_BYTES_HANDLED;
    if (id === DUST_SNAPSHOT_ID) {
      return this.onSnapshotSlice(message) ? SESSION_BYTES_HANDLED : SESSION_BYTES_DROPPED;
    }
    if (id === PONG_ID) return this.onPong(message) ? SESSION_BYTES_HANDLED : SESSION_BYTES_DROPPED;
    return SESSION_BYTES_UNHANDLED;
  }

  /**
   * One FRAME. Write the local clock to `io[IO_NOW]` first. Returns SESSION_FRAME_*. Zero allocation.
   */
  onFrame(message: Uint8Array): number {
    if (!this.inRoom) {
      this.stats.framesIgnored++;
      return SESSION_FRAME_IGNORED;
    }
    const now = this.io[IO_NOW] ?? 0;
    if (message.byteLength < FRAME_HEADER_BYTES) {
      this.stats.framesInvalid++;
      return SESSION_FRAME_INVALID;
    }
    const wireTick =
      (message[1] ?? 0) | ((message[2] ?? 0) << 8) | ((message[3] ?? 0) << 16) | ((message[4] ?? 0) << 24) | 0;
    if (this.awaitingKeyframe) {
      if (((message[8] ?? 0) & KEYFRAME_FLAG) === 0) {
        this.stats.framesAwaitingKeyframe++;
        return SESSION_FRAME_AWAITING_KEYFRAME;
      }
      this.table.reset();
    } else {
      if (this.haveTick) {
        const d = (wireTick - (this.lastTick | 0)) | 0;
        if (d === 0) {
          this.stats.framesDuplicate++;
          return SESSION_FRAME_DUPLICATE;
        }
        if (d < 0) {
          this.stats.framesStale++;
          return SESSION_FRAME_STALE;
        }
      }
      if (this.phase === "joined" && !this.hidden && now - this.lastFrameAt > this.cfg.stallResyncMs) {
        // Long stall: deltas and slots can no longer be trusted. Drop this frame and ask for a keyframe.
        this.beginResync(now, "stall");
        this.stats.framesAwaitingKeyframe++;
        return SESSION_FRAME_AWAITING_KEYFRAME;
      }
    }
    const err = this.reader.decode(message, this.view, this.table, this.cfg.plotCount);
    if (err !== FRAME_OK) {
      this.stats.framesInvalid++;
      if (this.awaitingKeyframe) this.requestResyncThrottled(now, "decode");
      else this.beginResync(now, "decode");
      return SESSION_FRAME_INVALID;
    }
    const view = this.view;
    if (this.haveTick && !this.awaitingKeyframe) {
      const missed = Math.floor(((view.serverTick - this.lastTick) | 0) / this.frameIntervalTicks) - 1;
      if (missed > 0) this.stats.framesGapEstimate += missed;
    }
    this.lastTick = view.serverTick;
    this.haveTick = true;
    this.lastFrameAt = now;
    this.signalLost = false;
    const wasAwaiting = this.awaitingKeyframe;
    if (wasAwaiting) {
      this.awaitingKeyframe = false;
      this.keyframeApplied = true;
      this.resyncAttempts = 0;
      this.resyncPending = false;
    }
    const interp = this.interpolation;
    if (interp !== null) {
      interp.io[IO_NOW] = now;
      interp.ingest(view);
    }
    this.stats.framesApplied++;
    this.host.onFrame?.(view, view.keyframe);
    if (wasAwaiting) this.checkReady();
    return SESSION_FRAME_APPLIED;
  }

  /** One DUST_SNAPSHOT slice. Returns false when it was dropped as invalid. */
  onSnapshotSlice(message: Uint8Array): boolean {
    if (!this.inRoom) {
      this.stats.framesIgnored++;
      return false;
    }
    const now = this.io[IO_NOW] ?? 0;
    const result = this.assembler.add(message);
    if (result === "invalid") {
      this.stats.snapshotSlicesInvalid++;
      return false;
    }
    if (result === "pending") return true;
    const deflated = this.assembler.take();
    const snapshot = deflated === null ? null : decodeSnapshotStream(deflated, this.cfg.inflate, this.cfg.plotCount);
    if (snapshot === null) {
      this.stats.snapshotsInvalid++;
      this.requestResyncThrottled(now, "snapshot");
      return false;
    }
    this.stats.snapshotsApplied++;
    this.snapshotDone = true;
    this.dustReady = true;
    this.host.onDustSnapshot?.(snapshot);
    this.checkReady();
    return true;
  }

  /** One PONG (full message). Write the local clock to `io[IO_NOW]` first. */
  onPong(message: Uint8Array): boolean {
    if (!decodePong(message, this.pong)) {
      this.stats.pongsInvalid++;
      return false;
    }
    this.clock.onPong(this.io[IO_NOW] ?? 0, this.pong.clientTimeMs, this.pong.serverTick);
    return true;
  }

  /** Tab hidden or shown. Showing it again resyncs (netcode.md 7: keyframe FRAME + fresh DUST_SNAPSHOT). */
  onVisibility(nowMs: number, hidden: boolean): void {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (!this.inRoom) return;
    this.host.sendVisibility(hidden);
    if (hidden) {
      this.signalLost = false;
      return;
    }
    this.stats.resyncs++;
    this.beginAwaitKeyframe(true);
    this.lastResyncAt = nowMs;
    this.resyncAttempts = 1;
    this.resyncPending = false;
    if (this.phase === "joined") this.setPhase("resyncing");
  }

  // ---- deadlines -------------------------------------------------------------------------------------------------------

  /** Drives probes, retries, timeouts, pings and resync retries. Call at a fixed interval with the local clock. */
  tick(nowMs: number): void {
    switch (this.phase) {
      case "waking":
        if (nowMs - this.wakeStartedAt > this.cfg.wakeBudgetMs) {
          this.failWith({ reason: "wake_timeout", code: 0, retryable: true, retryAfterMs: 0 });
        } else if (!this.probeInFlight && nowMs >= this.nextProbeAt) {
          this.launchProbe(nowMs);
        } else if (
          this.probeInFlight &&
          nowMs - (this.nextProbeAt - this.cfg.probeIntervalMs) > this.cfg.probeIntervalMs
        ) {
          // The probe timed out without an answer (3 s timeout in the adapter, or a lost callback): count it as a miss.
          this.probeInFlight = false;
        }
        break;
      case "connecting":
        if (this.attemptInFlight && nowMs - this.attemptStartedAt > this.cfg.connectTimeoutMs) {
          this.onConnectFailed(nowMs);
        } else if (this.attemptPending && !this.attemptInFlight && nowMs >= this.nextAttemptAt) {
          this.launchConnect(nowMs, this.joinMode);
        }
        break;
      case "reconnecting":
        if (nowMs > this.reconnectDeadline) {
          this.failWith({ reason: "seat_lost", code: 0, retryable: true, retryAfterMs: 0 });
        } else if (this.cfg.driveReconnect) {
          if (this.attemptInFlight && nowMs - this.attemptStartedAt > this.cfg.connectTimeoutMs) {
            this.onConnectFailed(nowMs);
          } else if (!this.attemptInFlight && nowMs >= this.nextAttemptAt) {
            this.launchConnect(nowMs, "reconnect");
          }
        }
        break;
      case "joining":
        if (nowMs - this.joinStartedAt > this.cfg.joinTimeoutMs) {
          this.failWith({ reason: "join_timeout", code: 0, retryable: true, retryAfterMs: 0 });
          return;
        }
        this.tickInRoom(nowMs);
        break;
      case "joined":
      case "resyncing":
        this.tickInRoom(nowMs);
        break;
      default:
        break;
    }
  }

  private tickInRoom(nowMs: number): void {
    if (nowMs >= this.nextPingAt) {
      this.host.sendPing();
      if (this.pingBurst > 0) {
        this.pingBurst--;
        this.nextPingAt = nowMs + 500; // PING limit is 2/s (netcode.md 11)
      } else {
        this.nextPingAt = nowMs + this.cfg.pingIntervalMs;
      }
    }
    if (this.awaitingKeyframe || !this.snapshotDone) {
      if (this.resyncPending && nowMs - this.lastResyncAt >= this.cfg.resyncMinIntervalMs) {
        this.sendResync(nowMs, this.resyncReason);
      } else if (this.phase === "resyncing" && nowMs - this.lastResyncAt >= this.cfg.resyncTimeoutMs) {
        if (this.resyncAttempts >= this.cfg.resyncMaxAttempts) {
          this.failWith({ reason: "resync_failed", code: 0, retryable: true, retryAfterMs: 0 });
          return;
        }
        this.sendResync(nowMs, "timeout");
      }
    }
    if (
      !this.hidden &&
      this.phase === "joined" &&
      !this.signalLost &&
      nowMs - this.lastFrameAt > this.cfg.signalLostMs
    ) {
      this.signalLost = true;
    }
  }

  // ---- internals -------------------------------------------------------------------------------------------------------

  private beginAwaitKeyframe(wantSnapshot: boolean): void {
    const expectSnapshot = wantSnapshot && this.cfg.expectDustSnapshot;
    this.awaitingKeyframe = true;
    this.keyframeApplied = false;
    this.haveTick = false;
    this.snapshotDone = !expectSnapshot;
    this.dustReady = !expectSnapshot;
    this.table.reset();
    this.interpolation?.resetAll();
    this.host.onSlotsReset?.();
  }

  /**
   * Asks the server for a fresh keyframe + DUST_SNAPSHOT on purpose (the client noticed it missed dust, for example a
   * paced snapshot whose transfer window dropped FRAME strokes). Same state machine as a stall resync: the phase goes
   * to `resyncing`, frames are dropped until a keyframe, the request is rate limited and retried. The server allows
   * one snapshot per seat per 2 s, so callers space requests accordingly. False (nothing done) when not in the room or
   * while the tab is hidden (showing the tab resyncs by itself).
   */
  requestSnapshotResync(nowMs: number): boolean {
    if (!this.inRoom || this.hidden) return false;
    this.beginResync(nowMs, "snapshot");
    return true;
  }

  /** Frame-driven resync (decode error, stall): enters resyncing and asks for a keyframe. */
  private beginResync(nowMs: number, reason: ResyncReason): void {
    if (!this.inRoom) return;
    this.stats.resyncs++;
    this.beginAwaitKeyframe(true);
    this.resyncAttempts = 0;
    if (this.phase === "joined") this.setPhase("resyncing");
    this.requestResyncThrottled(nowMs, reason);
  }

  private requestResyncThrottled(nowMs: number, reason: ResyncReason): void {
    if (nowMs - this.lastResyncAt >= this.cfg.resyncMinIntervalMs) this.sendResync(nowMs, reason);
    else {
      this.resyncPending = true;
      this.resyncReason = reason;
    }
  }

  private sendResync(nowMs: number, reason: ResyncReason): void {
    this.resyncPending = false;
    this.lastResyncAt = nowMs;
    this.resyncAttempts++;
    this.host.requestResync(reason);
  }

  private checkReady(): void {
    if (!this.keyframeApplied || !this.snapshotDone) return;
    if (this.phase === "joining") {
      if (!this.hello.received) return;
      if (!this.readySent) {
        this.readySent = true;
        this.host.sendReady();
      }
      this.everReady = true;
      this.setPhase("joined");
    } else if (this.phase === "resyncing") {
      this.setPhase("joined");
    }
  }

  private failWith(failure: SessionFailure): void {
    this.failure = failure;
    this.attemptInFlight = false;
    this.attemptPending = false;
    this.probeInFlight = false;
    this.setPhase("failed");
  }

  private setPhase(next: SessionPhase): void {
    if (this.phase === next) return;
    const previous = this.phase;
    this.phase = next;
    this.host.onPhase?.(next, previous);
  }
}
