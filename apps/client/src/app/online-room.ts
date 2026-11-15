// Online (remote) room wiring of the composition root (M1-W4-T04 hooks). LAZY CHUNK: only `online-launch.ts` imports
// this file, with a dynamic `import()`, when a remote room is opened. Solo play never loads it, so the solo path pays
// no bundle, construction, per-frame or allocation cost for netcode (ADR-0031, CLAUDE.md "solo first").
//
// What it wires (net report M1-W4-T04-T06, "Hooks needed outside my paths"):
//   RoomSession.onDustSnapshot -> RemoteDust.installSnapshot          (expectDustSnapshot: true)
//   RoomSession.onFrame        -> RemoteDust.applyFrame + OwnAvatarPredictor.start (keyframe) / reconcile (every FRAME)
//   RoomSession.onBytes        -> RemoteDust.applyBytes                (DUST_LEDGER / DUST_CHECK)
//   sendInput(cmd)             -> INPUT (current + previous for redundancy) + OwnAvatarPredictor.predict
//   RoomSession.onEquippedTool -> setEquippedTool(code) -> OwnAvatarPredictor.setTool (own Schema PlayerInfo.equippedTool)
//   a 500 ms poll              -> RemoteDust.nextRequest() via RoomSession.sendDustRequest, at most one per
//                                 DUST_REQUEST_SPACING_MS
// The dust view is fed from the mirror's ledger (`MirrorDustFeed`, clearDirty false: the feed drains the dirty list).

import {
  DUST_REQUEST_MAX_PLOTS,
  MESSAGE_CATALOG,
  PlotState,
  STANDARD_GRID_PARAMS,
  type EventBus,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import {
  createStrokeRecordOut,
  encodeInput,
  expandStrokeChain,
  INPUT_MAX_BYTES,
  type DecodedSnapshot,
  type FrameView,
  type StrokeRecordOut,
} from "@moon-cleanup/protocol";
import { createRoomDustLedger, createSimConfig, type SimConfig, type SimGround } from "@moon-cleanup/sim";
import { loadGameData } from "@moon-cleanup/game-data";
import { createPlotGrid, type IcoPlotGrid, type WorldDustLedger } from "@moon-cleanup/world";
import {
  OwnAvatarPredictor,
  RemoteDust,
  colyseusConsume,
  createRoomSession,
  type AccessTokenSource,
  type ConsumeReservationFn,
  type PredictInput,
  type RoomConnection,
  type RoomSession,
  type RoomSessionOptions,
} from "../net";
import type { DustFeedPort } from "../visuals";

export { RemoteRoomHostImpl, createRemoteRoomHost, type RemoteRoomHostStats } from "./remote-room-host";
export { RemoteAvatarFeed, createRemoteAvatarFeed } from "./remote-avatars";

const FRAME_MESSAGE_ID = MESSAGE_CATALOG.FRAME.id;

/**
 * Wraps a room connection so every FRAME body is also handed to `tap` (after the session's own handler ran). Used by
 * the RemoteRoomHost to hand the raw protocol FRAME to RoomHost frame listeners; everything else is delegated as is.
 */
export function tapFrames(conn: RoomConnection, tap: (body: Uint8Array) => void): RoomConnection {
  const onStateChange = conn.onStateChange;
  return {
    ...(conn.sessionId !== undefined ? { sessionId: conn.sessionId } : {}),
    onMessage: (type, callback) =>
      type !== FRAME_MESSAGE_ID
        ? conn.onMessage(type, callback)
        : conn.onMessage(type, (payload: never) => {
            callback(payload);
            const body: unknown = payload;
            if (body instanceof Uint8Array) tap(body);
          }),
    onDrop: (callback) => conn.onDrop(callback),
    onReconnect: (callback) => conn.onReconnect(callback),
    onLeave: (callback) => conn.onLeave(callback),
    send: (type, payload) => conn.send(type, payload),
    sendBytes: (type, bytes) => conn.sendBytes(type, bytes),
    leave: (consented) => conn.leave(consented),
    ...(onStateChange !== undefined ? { onStateChange: (callback) => onStateChange.call(conn, callback) } : {}),
  };
}

/**
 * Client spacing of DUST_REQUESTs. The server's bucket is 0.5/s with burst 1 (RATE_LIMITS.dustRequest), measured on
 * arrival: 2 s plus 500 ms of jitter margin so a slow first and a fast second message never land closer than 2 s.
 */
export const DUST_REQUEST_SPACING_MS = 2500;
/** How often the controller checks whether a DUST_REQUEST is due. */
export const DUST_REQUEST_POLL_MS = 500;
/** Ledger slots allocated up front (same headroom as the server room, `SHIFT_LEDGER_HEADROOM_SLOTS`). */
const MIRROR_LEDGER_SLOTS = 1024;
/** Default rates until `hello` says otherwise (the mirror ledger's dust levels depend on the tick rate). */
const DEFAULT_TICK_HZ = 20;
const DEFAULT_SNAPSHOT_HZ = 10;

/** Who consumes the mirror's dust (the visuals `DustTileAtlas` satisfies it; same shape as sim-host `DustViewTarget`). */
export interface MirrorDustTarget {
  onStroke(anchor: number, sU: number, sV: number, eU: number, eV: number, widthCm: number, depth16: number): void;
  onLedgerZero(plot: number, texelIndex: number): void;
  onPolished(plot: number): void;
  rebuildAll(): void;
}

/**
 * The visuals DustFeedPort over the online mirror ledger. Event time (frame and bytes handlers) only queues work; the
 * target is fed from `pump()` (once per rendered frame by the dust scene) except live strokes, which go straight
 * through like the Solo view does. Allocation-free per frame.
 */
export class MirrorDustFeed implements DustFeedPort {
  readonly grid: IcoPlotGrid;
  readonly ledger: WorldDustLedger;
  readonly sitePlot: number;
  readonly stats = { strokesForwarded: 0, rebuilds: 0, polishedForwarded: 0, zeroEventsForwarded: 0 };
  private target: MirrorDustTarget | null = null;
  private needRebuild = false;
  private readonly rec: StrokeRecordOut = createStrokeRecordOut();
  private readonly forward = (r: StrokeRecordOut): void => {
    this.stats.strokesForwarded++;
    this.target?.onStroke(r.anchor, r.startUMm, r.startVMm, r.endUMm, r.endVMm, r.widthCm, r.depth16);
  };

  constructor(grid: IcoPlotGrid, ledger: WorldDustLedger, sitePlot: number) {
    this.grid = grid;
    this.ledger = ledger;
    this.sitePlot = sitePlot;
  }

  bind(target: MirrorDustTarget | null): void {
    this.target = target;
    target?.rebuildAll();
  }

  /** After a snapshot or an installed ledger: every resident tile is rebuilt on the next pump. */
  invalidate(): void {
    this.needRebuild = true;
    this.ledger.clearZeroEvents();
    this.ledger.clearDirtyPlots();
  }

  /** A FRAME the mirror just applied: its strokes go to the target (they are already in the ledger). */
  onFrameApplied(view: FrameView, framesEvery: number): void {
    if (this.target === null || this.needRebuild) return;
    const s = view.strokes;
    for (let i = 0; i < s.chainCount; i++) expandStrokeChain(s, i, framesEvery, this.rec, this.forward);
  }

  pump(): void {
    const l = this.ledger;
    const target = this.target;
    if (this.needRebuild) {
      this.needRebuild = false;
      this.stats.rebuilds++;
      target?.rebuildAll();
      l.clearZeroEvents();
      l.clearDirtyPlots();
      return;
    }
    const nz = l.zeroEventCount;
    if (target !== null) for (let k = 0; k < nz; k++) target.onLedgerZero(l.zeroEventPlotAt(k), l.zeroEventTexelAt(k));
    this.stats.zeroEventsForwarded += target === null ? 0 : nz;
    l.clearZeroEvents();
    // The mirror empties the Polished queue itself (RemoteDust.drain), so Polished plots are found on the dirty list.
    const nd = l.dirtyPlotCount;
    for (let k = 0; k < nd; k++) {
      const p = l.dirtyPlotAt(k);
      if (l.state[p] === PlotState.Polished && target !== null) {
        target.onPolished(p);
        this.stats.polishedForwarded++;
      }
    }
    l.clearDirtyPlots();
  }

  info(): Readonly<Record<string, number | boolean>> {
    return { online: true, ...this.stats };
  }
}

export interface OnlineRoomOptions {
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly clientBuild: string;
  readonly contractId: string;
  readonly auth: AccessTokenSource;
  readonly events?: EventBus;
  /** Site plot the dust scene centres on (only read by the dust scene). */
  readonly sitePlot?: number;
  /** Ground for prediction; default flat (the server room is flat until terrain hands the sim its height cube). */
  readonly ground?: SimGround;
  /** Probe /healthz before joining (default true; false for a local dev server). */
  readonly wakeProbe?: boolean;
  /** Test seams. */
  readonly consume?: ConsumeReservationFn;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly setInterval?: (fn: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  readonly sessionConfig?: RoomSessionOptions["sessionConfig"];
  /** Called for problems the room cannot recover from itself (the app routes them to the error boundary). */
  readonly onProblem?: (source: string, error: unknown) => void;
}

export interface OnlineRoomStats {
  framesApplied: number;
  keyframes: number;
  snapshotsInstalled: number;
  snapshotsRefused: number;
  bytesApplied: number;
  bytesIgnored: number;
  inputsSent: number;
  inputsDropped: number;
  dustRequestsSent: number;
  lastCorrectionM: number;
}

/** One online room: session, dust mirror, own-avatar predictor and the mirror's dust feed. */
export class OnlineRoom {
  readonly session: RoomSession;
  readonly dust: RemoteDust;
  readonly predictor: OwnAvatarPredictor;
  readonly feed: MirrorDustFeed;
  readonly config: SimConfig;
  readonly stats: OnlineRoomStats = {
    framesApplied: 0,
    keyframes: 0,
    snapshotsInstalled: 0,
    snapshotsRefused: 0,
    bytesApplied: 0,
    bytesIgnored: 0,
    inputsSent: 0,
    inputsDropped: 0,
    dustRequestsSent: 0,
    lastCorrectionM: 0,
  };
  private readonly framesEvery: number;
  private readonly now: () => number;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly timer: unknown;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private readonly requestBuf = new Uint8Array(4 + DUST_REQUEST_MAX_PLOTS * 4);
  private readonly inputBuf = new Uint8Array(INPUT_MAX_BYTES);
  /** Exact-length INPUT bodies (type byte stripped) for one and two inputs: built once. */
  private readonly inputBody1: Uint8Array;
  private readonly inputBody2: Uint8Array;
  private readonly prev: { -readonly [K in keyof SimInputCommand]: SimInputCommand[K] } = {
    seq: 0,
    moveX: 0,
    moveY: 0,
    yaw: 0,
    pitch: 0,
    buttons: 0,
    toolParam: 0,
  };
  private hasPrev = false;
  /** Raw FRAME bodies (RemoteRoomHost frames); null when no host is attached. */
  frameTap: ((body: Uint8Array) => void) | null = null;
  /** Phase or mirror readiness changed (RemoteRoomHost state). */
  statusListener: (() => void) | null = null;
  private readonly predictIn: PredictInput = { seq: 0, moveX: 0, moveY: 0, yaw: 0, buttons: 0 };
  private disposed = false;

  constructor(options: OnlineRoomOptions) {
    const data = loadGameData();
    const grid = createPlotGrid(STANDARD_GRID_PARAMS);
    this.now = options.now ?? (() => performance.now());
    this.config = createSimConfig(data, { tickHz: DEFAULT_TICK_HZ, snapshotHz: DEFAULT_SNAPSHOT_HZ });
    this.framesEvery = DEFAULT_TICK_HZ / DEFAULT_SNAPSHOT_HZ;
    const ledger = createRoomDustLedger(grid, data, {
      tickHz: DEFAULT_TICK_HZ,
      initialLedgerSlots: MIRROR_LEDGER_SLOTS,
      zeroEvents: true,
    });
    // clearDirty false: MirrorDustFeed.pump drains the dirty list (it finds Polished plots there).
    this.dust = new RemoteDust(ledger, { framesEvery: this.framesEvery, clearDirty: false });
    this.feed = new MirrorDustFeed(grid, ledger, options.sitePlot ?? 0);
    this.predictor = new OwnAvatarPredictor(this.config, options.ground ?? { heightAtXYZ: () => 0 });
    this.inputBody1 = this.inputBuf.subarray(1, 12);
    this.inputBody2 = this.inputBuf.subarray(1, 22);

    const baseConsume = options.consume ?? colyseusConsume;
    const consume: ConsumeReservationFn = async (wsUrl, reservation, policy) =>
      tapFrames(await baseConsume(wsUrl, reservation, policy), (body) => this.frameTap?.(body));
    const onProblem = options.onProblem ?? (() => undefined);
    this.session = createRoomSession({
      httpUrl: options.httpUrl,
      wsUrl: options.wsUrl,
      clientBuild: options.clientBuild,
      contractId: options.contractId,
      auth: options.auth,
      plotCount: grid.count,
      expectDustSnapshot: true,
      ...(options.events !== undefined ? { events: options.events } : {}),
      ...(options.wakeProbe !== undefined ? { wakeProbe: options.wakeProbe } : {}),
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(options.sessionConfig !== undefined ? { sessionConfig: options.sessionConfig } : {}),
      consume,
      handlers: {
        onDustSnapshot: (s) => this.onSnapshot(s),
        onFrame: (view, keyframe) => this.onFrame(view, keyframe),
        onBytes: (message) => this.onBytes(message),
        onEquippedTool: (tool) => this.setEquippedTool(tool),
        onPhase: (phase) => {
          if (phase === "joined" && this.session.core.hello.received) this.checkRates(onProblem);
          this.statusListener?.();
        },
      },
    });
    const setTimer = options.setInterval ?? ((fn: () => void, ms: number): unknown => setInterval(fn, ms));
    this.clearTimer =
      options.clearInterval ?? ((h: unknown): void => clearInterval(h as ReturnType<typeof setInterval>));
    this.timer = setTimer(() => this.pollDustRequest(), DUST_REQUEST_POLL_MS);
  }

  start(): void {
    this.session.start();
  }

  /** Authoritative equipped tool (Schema `equippedTool`): prediction speed and face-aim follow it. */
  setEquippedTool(toolCode: number): void {
    this.predictor.setTool(toolCode);
  }

  /**
   * Sends the local player's input (with the previous one for loss redundancy) and predicts it at once. Never
   * allocates; inputs while not in the room are dropped (counted) and not predicted.
   */
  sendInput(cmd: SimInputCommand): void {
    const n = this.hasPrev ? encodeInput(this.inputBuf, this.prev, cmd) : encodeInput(this.inputBuf, cmd);
    const sent = this.session.sendInput(n > 12 ? this.inputBody2 : this.inputBody1);
    const p = this.prev;
    p.seq = cmd.seq;
    p.moveX = cmd.moveX;
    p.moveY = cmd.moveY;
    p.yaw = cmd.yaw;
    p.pitch = cmd.pitch;
    p.buttons = cmd.buttons;
    p.toolParam = cmd.toolParam;
    this.hasPrev = true;
    if (!sent) {
      this.stats.inputsDropped++;
      return;
    }
    this.stats.inputsSent++;
    // Predict exactly what went on the wire (axes clamped to +-127 like encodeInput).
    const q = this.predictIn;
    q.seq = cmd.seq & 0xffff;
    q.moveX = cmd.moveX < -127 ? -127 : cmd.moveX > 127 ? 127 : cmd.moveX;
    q.moveY = cmd.moveY < -127 ? -127 : cmd.moveY > 127 ? 127 : cmd.moveY;
    q.yaw = cmd.yaw & 0xffff;
    q.buttons = cmd.buttons & 0xffff;
    this.predictor.predict(q);
  }

  /** Once per rendered frame while in the room: remote-entity interpolation and the correction offset decay. */
  frame(dtMs: number): void {
    this.session.updateInterpolation();
    this.predictor.decay(dtMs);
  }

  setHidden(hidden: boolean): void {
    this.session.setHidden(hidden);
  }

  leave(): void {
    this.session.leave();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer(this.timer);
    this.feed.bind(null);
    this.session.dispose();
  }

  // ---- handlers ----------------------------------------------------------------------------------------------------

  private onSnapshot(s: DecodedSnapshot): void {
    if (this.dust.installSnapshot(s)) {
      this.stats.snapshotsInstalled++;
      this.feed.invalidate();
      this.statusListener?.();
    } else {
      this.stats.snapshotsRefused++;
    }
  }

  private onFrame(view: FrameView, keyframe: boolean): void {
    this.stats.framesApplied++;
    this.dust.applyFrame(view);
    this.feed.onFrameApplied(view, this.framesEvery);
    if (keyframe || !this.predictor.ready) {
      if (keyframe) this.stats.keyframes++;
      this.predictor.start(view.self, view.ackInputSeq);
      return;
    }
    const err = this.predictor.reconcile(view.self, view.ackInputSeq);
    if (err >= 0) this.stats.lastCorrectionM = err;
  }

  private onBytes(message: Uint8Array): void {
    const ledgersBefore = this.dust.stats.ledgers;
    if (this.dust.applyBytes(message)) this.stats.bytesApplied++;
    else this.stats.bytesIgnored++;
    if (this.dust.stats.ledgers !== ledgersBefore) this.feed.invalidate();
  }

  private pollDustRequest(): void {
    if (this.disposed || this.dust.wantedCount === 0) return;
    if (this.session.phase !== "joined") return;
    const t = this.now();
    if (t - this.lastRequestAt < DUST_REQUEST_SPACING_MS) return;
    const n = this.dust.nextRequest(this.requestBuf);
    if (n <= 1) return;
    // Bytes messages travel without their type byte (the SDK adds the id); the SDK copies the body on send.
    if (!this.session.sendDustRequest(this.requestBuf.subarray(1, n))) return;
    this.lastRequestAt = t;
    this.stats.dustRequestsSent++;
  }

  private checkRates(onProblem: (source: string, error: unknown) => void): void {
    const h = this.session.core.hello;
    if (h.simTickHz !== DEFAULT_TICK_HZ || h.snapshotHz !== DEFAULT_SNAPSHOT_HZ) {
      onProblem(
        "online room",
        new Error(
          `server runs ${h.simTickHz} Hz / ${h.snapshotHz} Hz; the client mirror is built for ` +
            `${DEFAULT_TICK_HZ} Hz / ${DEFAULT_SNAPSHOT_HZ} Hz`,
        ),
      );
    }
  }
}

export function createOnlineRoom(options: OnlineRoomOptions): OnlineRoom {
  return new OnlineRoom(options);
}
