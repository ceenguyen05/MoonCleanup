// RemoteRoomHost over an OnlineRoom (M1-W4-T06). LAZY CHUNK: imported only by online-room.ts, which only
// online-launch.ts loads with a dynamic `import()`. Solo never constructs or bundles it into the entry path.
//
// The app publishes this host through the `roomHost` service while an online room is open, so gameplay, UI and debug
// bind to the same RoomHost surface as in solo (client/room-host contract). Inputs go to OnlineRoom.sendInput (wire +
// own-avatar prediction); frames are the raw protocol FRAME messages the server sent (same layout as the Solo worker's
// frames, type byte first), handed out from a fixed pool of 3 buffers with refcounted `release()`.

import {
  BEACON_COUNT,
  ContractIdSchema,
  FRAME_MAX_BYTES,
  MESSAGE_CATALOG,
  STROKE_PLAYER_ACTOR_SLOT_MAX,
  type Beacon,
  type ContractId,
  type ContractRole,
  type ControlIntent,
  type PlayerId,
  type PlayerInfo,
  type PlotId,
  type VehicleInfo,
  type RemoteRoomHost,
  type RoomHostCloseReason,
  type RoomHostFrame,
  type RoomHostState,
  type RoomSimEvent,
  type ShiftStateView,
  type ShiftType,
  type SimInputCommand,
  type Unsubscribe,
  type WireSimEvent,
} from "@moon-cleanup/shared";
import type { OnlineRoom } from "./online-room";

/** Frame buffers in the pool (the contract's "fixed pool"; same depth as the Solo host). */
export const REMOTE_FRAME_POOL = 3;
/** Automatic retries of a retryable failure (token refresh, capacity) before the host stays `failed`. */
export const REMOTE_MAX_AUTO_RETRIES = 3;
/** Retry delay when the failure carries no `retryAfterMs`. */
export const REMOTE_RETRY_DEFAULT_MS = 2000;

const FRAME_ID = MESSAGE_CATALOG.FRAME.id;
const PURCHASE_ID = MESSAGE_CATALOG.PURCHASE.id;
const SELECT_TOOL_ID = MESSAGE_CATALOG.SELECT_TOOL.id;

class PooledFrame implements RoomHostFrame {
  tick = 0;
  ackInputSeq = 0;
  byteLength = 0;
  refs = 0;
  readonly bytes = new ArrayBuffer(FRAME_MAX_BYTES + 1);
  readonly u8 = new Uint8Array(this.bytes);
  readonly release = (): void => {
    if (this.refs > 0) this.refs--;
  };
}

export interface RemoteRoomHostStats {
  framesEmitted: number;
  framesDropped: number;
  intentsSent: number;
  intentsDropped: number;
  eventsEmitted: number;
  autoRetries: number;
  shiftStatesEmitted: number;
  shiftStatesInvalid: number;
}

export class RemoteRoomHostImpl implements RemoteRoomHost {
  readonly kind = "remote" as const;
  readonly contractId: ContractId;
  readonly shiftType: ShiftType;
  readonly simTickHz: number;
  readonly stats: RemoteRoomHostStats = {
    framesEmitted: 0,
    framesDropped: 0,
    intentsSent: 0,
    intentsDropped: 0,
    eventsEmitted: 0,
    autoRetries: 0,
    shiftStatesEmitted: 0,
    shiftStatesInvalid: 0,
  };
  private current: RoomHostState = "booting";
  private closedByUs = false;
  private readonly pool: PooledFrame[] = [];
  private readonly frameListeners: ((frame: RoomHostFrame) => void)[] = [];
  private readonly shiftListeners: ((state: ShiftStateView) => void)[] = [];
  private readonly eventListeners: ((event: RoomSimEvent) => void)[] = [];
  private readonly stateListeners: ((state: RoomHostState) => void)[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly room: OnlineRoom,
    contractId: string,
    shiftType: ShiftType = "private",
  ) {
    this.contractId = ContractIdSchema.parse(contractId);
    this.shiftType = shiftType;
    this.simTickHz = room.config.tickHz;
    for (let i = 0; i < REMOTE_FRAME_POOL; i++) this.pool.push(new PooledFrame());
    room.frameTap = (body) => this.emitFrame(body);
    room.statusListener = () => this.refresh();
    room.shiftStateTap = (state) => this.emitShift(state);
    room.simEventsTap = (events) => this.emitEvents(events);
    this.refresh();
  }

  /** HUD read-outs (Near Parcels, outposts, Plot Card, Hop): ReadoutLink attaches these like the Solo cache. */
  get readouts(): OnlineRoom["readouts"] {
    return this.room.readouts;
  }

  /** Online read-outs are computed on demand on the main thread: nothing to request. */
  setReadoutRequest(inspecting: boolean, itemIds: readonly string[]): void {
    void inspecting;
    void itemIds;
  }

  get state(): RoomHostState {
    return this.current;
  }

  get roomId(): string {
    return this.room.session.core.hello.received ? this.contractId : "";
  }

  get rttMs(): number | null {
    const clock = this.room.session.core.clock;
    return clock.hasEstimate ? clock.rttMs : null;
  }

  sendInput(cmd: SimInputCommand): void {
    this.room.sendInput(cmd);
  }

  /**
   * Control intents as the protocol's v1 control messages on the live connection (`purchase` {requestId, itemId},
   * `select_tool` {slot}); the server's ShiftRoom validates them and queues them on the sim. The purchase outcome comes
   * back as a `purchase.completed` / `purchase.rejected` sim event (onEvent). Dropped (counted, never thrown) while the
   * host is closed or the room is not joined.
   */
  sendIntent(intent: ControlIntent): void {
    const sent =
      !this.closedByUs &&
      (intent.kind === "purchase"
        ? this.room.sendControl(PURCHASE_ID, { requestId: intent.requestId, itemId: intent.itemId })
        : this.room.sendControl(SELECT_TOOL_ID, { slot: intent.slot }));
    if (sent) this.stats.intentsSent++;
    else this.stats.intentsDropped++;
  }

  onFrame(listener: (frame: RoomHostFrame) => void): Unsubscribe {
    return add(this.frameListeners, listener);
  }

  /** Fed from every decoded Schema state of the live connection (`shiftStateViewOf`; first full state included). */
  onShiftState(listener: (state: ShiftStateView) => void): Unsubscribe {
    return add(this.shiftListeners, listener);
  }

  /** Fed from the room's validated `sim_events` batches, one call per event in server order (online only). */
  onEvent(listener: (event: RoomSimEvent) => void): Unsubscribe {
    return add(this.eventListeners, listener);
  }

  onStateChange(listener: (state: RoomHostState) => void): Unsubscribe {
    return add(this.stateListeners, listener);
  }

  close(reason: RoomHostCloseReason): Promise<void> {
    void reason;
    if (!this.closedByUs) {
      this.closedByUs = true;
      if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
      this.room.frameTap = null;
      this.room.statusListener = null;
      this.room.shiftStateTap = null;
      this.room.simEventsTap = null;
      this.room.leave();
      this.room.dispose();
      this.refresh();
    }
    return Promise.resolve();
  }

  /** True while the host is `failed` with no automatic retry pending (terminal, or retries exhausted). */
  get gaveUp(): boolean {
    return this.current === "failed" && this.retryTimer === undefined;
  }

  /** Session phase + mirror readiness -> host state; reconnect policy for retryable failures. */
  refresh(): void {
    const next = this.computeState();
    if (next === "failed") this.maybeRetry();
    if (next === this.current) return;
    this.current = next;
    for (const l of [...this.stateListeners]) l(next);
  }

  private computeState(): RoomHostState {
    if (this.closedByUs) return "closed";
    switch (this.room.session.phase) {
      case "idle":
      case "waking":
      case "connecting":
      case "joining":
        return "booting";
      case "joined":
      case "resyncing":
        return this.room.dust.ready ? "running" : "loading";
      case "reconnecting":
        return "loading";
      default:
        // failed, or closed by the server (kick, shutdown): the UI offers Reload / Return.
        return "failed";
    }
  }

  private maybeRetry(): void {
    const failure = this.room.session.failure;
    if (failure === null || !failure.retryable || this.retryTimer !== undefined) return;
    if (this.stats.autoRetries >= REMOTE_MAX_AUTO_RETRIES) return;
    this.stats.autoRetries++;
    const wait = failure.retryAfterMs > 0 ? failure.retryAfterMs : REMOTE_RETRY_DEFAULT_MS;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (!this.closedByUs) this.room.session.retry();
    }, wait);
  }

  /**
   * One decoded Schema state -> a plain ShiftStateView for every listener. Online only, at most once per Schema patch
   * (frame ticks, 10 Hz, and only when something changed); builds nothing while no one listens.
   */
  private emitShift(state: unknown): void {
    if (this.closedByUs || this.shiftListeners.length === 0) return;
    const view = shiftStateViewOf(state, this.room.session.core.view.serverTick, this.contractId, this.shiftType);
    if (view === null) {
      this.stats.shiftStatesInvalid++;
      return;
    }
    this.stats.shiftStatesEmitted++;
    for (const l of [...this.shiftListeners]) l(view);
  }

  /** One validated `sim_events` batch -> every event listener (the wire events are RoomSimEvents; no copy). */
  private emitEvents(events: readonly WireSimEvent[]): void {
    if (this.closedByUs) return;
    this.stats.eventsEmitted += events.length;
    if (this.eventListeners.length === 0) return;
    // A copy: a listener may unsubscribe while the batch is delivered (rare message, not per frame).
    const listeners = [...this.eventListeners];
    for (const e of events) for (const l of listeners) l(e);
  }

  /** One raw FRAME body (type byte stripped by the SDK) -> a pooled RoomHostFrame for every listener. */
  private emitFrame(body: Uint8Array): void {
    const n = this.frameListeners.length;
    if (n === 0) return;
    const len = body.byteLength + 1;
    let frame: PooledFrame | null = null;
    for (let i = 0; i < this.pool.length; i++) {
      const f = this.pool[i]!;
      if (f.refs === 0) {
        frame = f;
        break;
      }
    }
    if (frame === null || len > frame.u8.byteLength) {
      this.stats.framesDropped++;
      return;
    }
    frame.u8[0] = FRAME_ID;
    frame.u8.set(body, 1);
    frame.byteLength = len;
    const view = this.room.session.core.view;
    frame.tick = view.serverTick;
    frame.ackInputSeq = view.ackInputSeq;
    frame.refs = n;
    this.stats.framesEmitted++;
    for (let i = 0; i < n; i++) this.frameListeners[i]?.(frame);
  }
}

function add<T>(list: T[], item: T): Unsubscribe {
  list.push(item);
  return () => {
    const k = list.indexOf(item);
    if (k >= 0) list.splice(k, 1);
  };
}

// ---- Schema -> ShiftStateView adapter (sim/shift-state v1.1, protocol/shift-state-schema v1.1) ------------------------

type Rec = Readonly<Record<string, unknown>>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** An integer in 0..max, else `fallback`. */
function intIn(v: unknown, max: number, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Visits the values of a Schema container: the SDK's reflected MapSchema / ArraySchema (`forEach(value, key)`), a
 * plain Map, a plain array or a plain record (test states). At most `cap` values (the contract's array caps).
 */
function eachValue(v: unknown, cap: number, visit: (value: unknown, key: string) => void): void {
  if (!isRec(v)) return;
  let n = 0;
  const fe = (v as { forEach?: unknown }).forEach;
  if (typeof fe === "function") {
    (fe as (cb: (value: unknown, key: unknown) => void) => void).call(v, (value, key) => {
      if (n++ < cap) visit(value, String(key));
    });
    return;
  }
  for (const key of Object.keys(v)) if (n++ < cap) visit(v[key], key);
}

function levelRecord(v: unknown, max: number): Record<string, number> {
  const out: Record<string, number> = {};
  eachValue(v, 256, (value, key) => {
    const n = intIn(value, max, -1);
    if (n >= 0 && key.length > 0) out[key] = n;
  });
  return out;
}

function stringList(v: unknown): string[] {
  const out: string[] = [];
  eachValue(v, 16, (value) => {
    if (typeof value === "string") out.push(value);
  });
  return out;
}

const ROLES: readonly ContractRole[] = ["holder", "supervisor", "staff", "temp"];
const TYPES: readonly ShiftType[] = ["solo", "private", "open"];

/**
 * A decoded Colyseus `ShiftState` (reflection) -> the plain, read-only `ShiftStateView` both hosts hand the client.
 * Schema maps become arrays (`players` sorted by slot, `vehicles` by entity id) or records; missing or ill-typed
 * scalars fall back to neutral values; `nearParcelsCollected` is copied when it is a u8 and stays absent otherwise
 * (pre-v1.1 server: "unknown"). Returns null for a non-object. Allocates (online only, once per Schema patch).
 */
export function shiftStateViewOf(
  state: unknown,
  tick: number,
  contractId: ContractId,
  shiftType: ShiftType,
): ShiftStateView | null {
  if (!isRec(state)) return null;
  const players: PlayerInfo[] = [];
  eachValue(state["players"], 16, (p) => {
    if (!isRec(p)) return;
    const role = str(p["role"], "staff") as ContractRole;
    players.push({
      playerId: str(p["playerId"], "") as PlayerId,
      displayName: str(p["displayName"], ""),
      slot: intIn(p["slot"], STROKE_PLAYER_ACTOR_SLOT_MAX, 0),
      role: ROLES.includes(role) ? role : "staff",
      tenureLevel: intIn(p["tenureLevel"], 0xffff, 0),
      equippedCosmetics: stringList(p["equippedCosmetics"]),
      connected: p["connected"] === true,
      afk: p["afk"] === true,
      hidden: p["hidden"] === true,
      toolsOwned: intIn(p["toolsOwned"], 0xff, 0),
      equippedTool: intIn(p["equippedTool"], 0xff, 0),
      vehicleIds: stringList(p["vehicleIds"]),
    });
  });
  players.sort((a, b) => a.slot - b.slot);
  const vehicles: VehicleInfo[] = [];
  eachValue(state["vehicles"], 64, (v) => {
    if (!isRec(v)) return;
    vehicles.push({
      entityId: intIn(v["entityId"], 0xffff_ffff, 0),
      type: str(v["type"], ""),
      ownerPlayerId: str(v["ownerPlayerId"], "") as PlayerId,
      upgrades: levelRecord(v["upgrades"], 0xff),
      occupied: v["occupied"] === true,
    });
  });
  vehicles.sort((a, b) => a.entityId - b.entityId);
  const beacons: Beacon[] = [];
  eachValue(state["beacons"], BEACON_COUNT, (b) => {
    if (isRec(b)) beacons.push({ plotId: intIn(b["plotId"], 0xffff_ffff, 0) as PlotId, active: b["active"] === true });
  });
  while (beacons.length < BEACON_COUNT) beacons.push({ plotId: 0 as PlotId, active: false });
  const perm = isRec(state["permissions"]) ? state["permissions"] : {};
  const type = str(state["shiftType"], shiftType) as ShiftType;
  const mask = intIn(state["nearParcelsCollected"], 0xff, -1);
  return {
    contractId: str(state["contractId"], contractId) as ContractId,
    shiftType: TYPES.includes(type) ? type : shiftType,
    protocolVersion: intIn(state["protocolVersion"], 0xffff, 0),
    simTickHz: intIn(state["simTickHz"], 0xff, 0),
    snapshotHz: intIn(state["snapshotHz"], 0xff, 0),
    walletLumens: Math.max(0, num(state["walletLumens"], 0)),
    shinePolished: intIn(state["shinePolished"], 0xffff_ffff, 0),
    plotCount: intIn(state["plotCount"], 0xffff_ffff, 0),
    sharedUpgrades: levelRecord(state["sharedUpgrades"], 0xff),
    suitGear: levelRecord(state["suitGear"], 0xff),
    visitedOutposts: intIn(state["visitedOutposts"], 0xff, 0),
    beacons,
    players,
    vehicles,
    robotCounts: levelRecord(state["robotCounts"], 0xffff),
    permissions: {
      tempCanBuild: perm["tempCanBuild"] === true,
      tempCanSpendShared: perm["tempCanSpendShared"] === true,
      tempCanDriveShared: perm["tempCanDriveShared"] === true,
    },
    fulfilled: state["fulfilled"] === true,
    ...(mask >= 0 ? { nearParcelsCollected: mask } : {}),
    tick: intIn(tick, 0xffff_ffff, 0),
  };
}

export function createRemoteRoomHost(room: OnlineRoom, contractId: string, shiftType?: ShiftType): RemoteRoomHostImpl {
  return new RemoteRoomHostImpl(room, contractId, shiftType);
}
