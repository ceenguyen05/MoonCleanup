// RemoteRoomHost over an OnlineRoom (M1-W4-T06). LAZY CHUNK: imported only by online-room.ts, which only
// online-launch.ts loads with a dynamic `import()`. Solo never constructs or bundles it into the entry path.
//
// The app publishes this host through the `roomHost` service while an online room is open, so gameplay, UI and debug
// bind to the same RoomHost surface as in solo (client/room-host contract). Inputs go to OnlineRoom.sendInput (wire +
// own-avatar prediction); frames are the raw protocol FRAME messages the server sent (same layout as the Solo worker's
// frames, type byte first), handed out from a fixed pool of 3 buffers with refcounted `release()`.

import {
  ContractIdSchema,
  FRAME_MAX_BYTES,
  MESSAGE_CATALOG,
  type ContractId,
  type ControlIntent,
  type RemoteRoomHost,
  type RoomHostCloseReason,
  type RoomHostFrame,
  type RoomHostState,
  type RoomSimEvent,
  type ShiftStateView,
  type ShiftType,
  type SimInputCommand,
  type Unsubscribe,
} from "@moon-cleanup/shared";
import type { OnlineRoom } from "./online-room";

/** Frame buffers in the pool (the contract's "fixed pool"; same depth as the Solo host). */
export const REMOTE_FRAME_POOL = 3;
/** Automatic retries of a retryable failure (token refresh, capacity) before the host stays `failed`. */
export const REMOTE_MAX_AUTO_RETRIES = 3;
/** Retry delay when the failure carries no `retryAfterMs`. */
export const REMOTE_RETRY_DEFAULT_MS = 2000;

const FRAME_ID = MESSAGE_CATALOG.FRAME.id;

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
  intentsDropped: number;
  autoRetries: number;
}

export class RemoteRoomHostImpl implements RemoteRoomHost {
  readonly kind = "remote" as const;
  readonly contractId: ContractId;
  readonly shiftType: ShiftType;
  readonly simTickHz: number;
  readonly stats: RemoteRoomHostStats = { framesEmitted: 0, framesDropped: 0, intentsDropped: 0, autoRetries: 0 };
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
    this.refresh();
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

  /** No control-intent send exists on RoomSession yet (net owner); counted, never thrown. */
  sendIntent(intent: ControlIntent): void {
    void intent;
    this.stats.intentsDropped++;
  }

  onFrame(listener: (frame: RoomHostFrame) => void): Unsubscribe {
    return add(this.frameListeners, listener);
  }

  /** Registered, not yet fed: no Schema -> ShiftStateView adapter exists (open item in the T06 report). */
  onShiftState(listener: (state: ShiftStateView) => void): Unsubscribe {
    return add(this.shiftListeners, listener);
  }

  /** Registered, not yet fed: `sim_events` control messages are not routed into RoomSimEvents yet (open item). */
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
      this.room.leave();
      this.room.dispose();
      this.refresh();
    }
    return Promise.resolve();
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

export function createRemoteRoomHost(room: OnlineRoom, contractId: string, shiftType?: ShiftType): RemoteRoomHostImpl {
  return new RemoteRoomHostImpl(room, contractId, shiftType);
}
