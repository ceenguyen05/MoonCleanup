// Remote room session (M1-W4-T01b): the Colyseus adapter over the pure `ClientSession` state machine and the
// `InterpolationBuffer` of @moon-cleanup/protocol.
//
// SOLO FIRST (ADR-0031): nothing here runs, allocates or is imported by the SDK at module load. The composition root
// creates a RoomSession only when the player opens a remote room; solo play never constructs one. The Colyseus SDK
// is loaded with a dynamic import inside the default transport, so it is not part of the solo critical path.
//
// Flow (netcode.md sections 9, 10, 12):
//   start() -> waking (GET /healthz every 3 s, 3 s timeout) -> connecting (POST /v1/contracts/:id/join with the
//   Bearer access token; the response's `reservation` is consumed with `consumeSeatReservation`) -> joining (hello +
//   keyframe FRAME [+ DUST_SNAPSHOT]) -> `ready` -> joined.
//   Drops on 1001/1005/1006/4010 are reconnected in place by the SDK (seat hold, backoff 0.5, 1, 2, 4, 8 s within
//   60 s; `driveReconnect: false`); 4001 rejoins with restore; every other close code goes through `classifyClose`
//   (4100 protocol_mismatch, 4104 rate_limited 30 s, 4105 room_full, 4106 duplicate_session, ...).
//   The join response is read for `reservation` (and `role`) only; it never depends on a join ticket.
//
// Hot path: bytes messages arrive from the SDK without their type byte; the adapter writes the id and the body into
// one reused scratch buffer and hands the session a cached view of that exact length (no allocation per message
// after warm-up). Interpolation is advanced once per render frame by `updateInterpolation()`.

import {
  ApiErrorBodySchema,
  Channel,
  CloseCode,
  Direction,
  HealthResponseSchema,
  HelloPayloadSchema,
  MESSAGE_CATALOG,
  MessageStatus,
  OUTBOUND_MAX_BYTES,
  PAYLOAD_SCHEMAS,
  PROTOCOL_VERSION,
  SeatReservationSchema,
  type EventBus,
  type NetConnectionState,
  type NetStatusEvent,
} from "@moon-cleanup/shared";
import {
  ClientSession,
  IO_NOW,
  InterpolationBuffer,
  PING_BODY_BYTES,
  RECONNECT_BACKOFF,
  SESSION_BYTES_HANDLED,
  SESSION_BYTES_UNHANDLED,
  writePingBody,
  type ConnectMode,
  type DecodedSnapshot,
  type FrameView,
  type Inflate,
  type SessionConfig,
  type SessionFailure,
  type SessionHost,
  type SessionPhase,
} from "@moon-cleanup/protocol";
import type { DustOffload, DustOffloadStats } from "./dust-offload";
import { inflateRaw } from "./inflate-raw";
import type { InflateWorkerPort } from "./inflate-worker-core";
import { PROBE_TIMEOUT_MS, type SeatReservation } from "./session";

/** Session tick period (drives probes, retries, pings and resync deadlines; also while the tab is hidden). */
export const ROOM_SESSION_TICK_MS = 250;
/** REST join route (rest contract `contractJoin`). */
export const CONTRACT_JOIN_PATH = "/v1/contracts/:id/join";
/** Fallback wait when a 429 / 503 refusal carries no usable `retry-after`. */
export const DEFAULT_RETRY_AFTER_MS = 30_000;
/** Seat hold the SDK reconnection must cover (SEAT_HOLD_S). */
export const SEAT_HOLD_MS = 60_000;
/** The core's default connect timeout (SessionConfig.connectTimeoutMs). */
export const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;

/** Access tokens (backend contract): never logged, never put in a URL. */
export interface AccessTokenSource {
  /** The current access token; refreshed first when `forceRefresh` (after a 401). `null` = signed out. */
  getAccessToken(forceRefresh: boolean): Promise<string | null>;
}

/** The part of a Colyseus SDK room the adapter uses. */
export interface RoomConnection {
  onMessage(type: string | number, callback: (payload: never) => void): unknown;
  onDrop(callback: (code: number) => void): unknown;
  onReconnect(callback: () => void): unknown;
  onLeave(callback: (code: number) => void): unknown;
  send(type: string, payload: unknown): void;
  sendBytes(type: number, bytes: Uint8Array): void;
  leave(consented?: boolean): unknown;
  /** This client's session id (Schema `players` key). Optional so plain test fakes still satisfy the port. */
  readonly sessionId?: string;
  /** Schema state patches (Colyseus `room.onStateChange`): the session reads its own `PlayerInfo` from them. */
  onStateChange?(callback: (state: never) => void): unknown;
}

/**
 * Own `PlayerInfo.equippedTool` from a decoded `ShiftState` (players keyed by sessionId), or -1 when absent. Reads
 * only through `players.get` so it works on the SDK's reflected MapSchema and on plain test maps; never throws.
 */
export function equippedToolOf(state: unknown, sessionId: string): number {
  if (typeof state !== "object" || state === null) return -1;
  const players = (state as { players?: unknown }).players;
  if (typeof players !== "object" || players === null) return -1;
  const get = (players as { get?: unknown }).get;
  if (typeof get !== "function") return -1;
  const info: unknown = (get as (k: string) => unknown).call(players, sessionId);
  if (typeof info !== "object" || info === null) return -1;
  const tool = (info as { equippedTool?: unknown }).equippedTool;
  return typeof tool === "number" && Number.isInteger(tool) && tool >= 0 && tool <= 255 ? tool : -1;
}

/** SDK reconnection settings (Colyseus `room.reconnection`): delay = clamp(2^attempt * delayMs, min, max). */
export interface ReconnectPolicy {
  readonly delayMs: number;
  readonly minDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxRetries: number;
}

/** Opens the room for a reservation. Rejects with `{ code }` when the server refuses the join (for example 4101). */
export type ConsumeReservationFn = (
  wsUrl: string,
  reservation: SeatReservation,
  policy: ReconnectPolicy,
) => Promise<RoomConnection>;

/** Backoff 0.5, 1, 2, 4, 8, 8, ... s with enough retries to cover the seat hold (netcode.md 9.2). */
export function seatHoldReconnectPolicy(holdMs = SEAT_HOLD_MS): ReconnectPolicy {
  const { baseMs, maxMs } = RECONNECT_BACKOFF;
  let total = 0;
  let retries = 0;
  while (total < holdMs && retries < 64) {
    total += Math.min(maxMs, baseMs * 2 ** retries);
    retries++;
  }
  return { delayMs: baseMs / 2, minDelayMs: baseMs, maxDelayMs: maxMs, maxRetries: retries };
}

/** Real transport: Colyseus SDK, loaded on demand (never on the solo path). */
export const colyseusConsume: ConsumeReservationFn = async (wsUrl, reservation, policy) => {
  const { ColyseusSDK } = await import("@colyseus/sdk");
  const sdk = new ColyseusSDK(wsUrl);
  const room = await sdk.consumeSeatReservation(reservation);
  const r = room.reconnection;
  r.enabled = true;
  r.minUptime = 0; // a drop during the join is restarted by the session, not refused by the SDK
  r.delay = policy.delayMs;
  r.minDelay = policy.minDelayMs;
  r.maxDelay = policy.maxDelayMs;
  r.maxRetries = policy.maxRetries;
  return room as unknown as RoomConnection;
};

// ---- REST join refusal mapping -----------------------------------------------------------------------------------

export type JoinRefusal = { readonly kind: "retry" } | { readonly kind: "fail"; readonly failure: SessionFailure };

const RETRY: JoinRefusal = { kind: "retry" };
const failure = (
  reason: SessionFailure["reason"],
  code: number,
  retryable: boolean,
  retryAfterMs = 0,
): JoinRefusal => ({
  kind: "fail",
  failure: { reason, code, retryable, retryAfterMs },
});

/** `retry-after` seconds to ms (0 .. 1 h), or the fallback. */
export function retryAfterMs(header: string | null, fallbackMs = DEFAULT_RETRY_AFTER_MS): number {
  if (header === null) return fallbackMs;
  const s = Number(header);
  return Number.isFinite(s) && s >= 0 ? Math.min(3600, s) * 1000 : fallbackMs;
}

/**
 * Non-2xx answer of `POST /v1/contracts/:id/join` (rest contract `API_ERROR_STATUS`, security.md section 5).
 * Transient refusals retry with the session's backoff; the rest fail with the matching close-code family.
 */
export function classifyJoinRefusal(status: number, error: string | null, retryAfter: string | null): JoinRefusal {
  switch (status) {
    case 400:
      return failure("protocol_mismatch", CloseCode.PROTOCOL_MISMATCH, false); // join options refused: update
    case 401:
      return failure("auth_invalid", CloseCode.AUTH_INVALID, true);
    case 403:
      return failure("forbidden", 0, false);
    case 404:
      return failure("contract_unavailable", CloseCode.CONTRACT_UNAVAILABLE, false);
    case 409:
      return error === "ROOM_FULL" ? failure("room_full", CloseCode.ROOM_FULL, true) : RETRY; // CONTRACT_BUSY
    case 429:
      return failure("rate_limited", CloseCode.RATE_LIMITED, true, retryAfterMs(retryAfter));
    case 503:
      return error === "AT_CAPACITY"
        ? failure("at_capacity", CloseCode.ROOM_FULL, true, retryAfterMs(retryAfter))
        : RETRY; // RETRY_LATER, draining instance
    default:
      return RETRY;
  }
}

/** net.status mirror of a session phase (events/catalog `NetConnectionState`). */
export function connectionStateOf(phase: SessionPhase): NetConnectionState {
  switch (phase) {
    case "idle":
      return "asleep";
    case "waking":
      return "waking";
    case "connecting":
    case "joining":
      return "connecting";
    case "joined":
    case "resyncing":
      return "connected";
    default:
      return "lost";
  }
}

// ---- session -----------------------------------------------------------------------------------------------------

export interface RoomSessionHandlers {
  onPhase?(phase: SessionPhase, previous: SessionPhase): void;
  /** A FRAME was applied (the view is reused: read it now). Feeds Self reconciliation. */
  onFrame?(view: FrameView, keyframe: boolean): void;
  onSlotsReset?(): void;
  onDustSnapshot?(snapshot: DecodedSnapshot): void;
  /** A bytes message the session does not consume (DUST_LEDGER, DUST_LOG, DUST_CHECK), id byte first. Valid only during the call. */
  onBytes?(message: Uint8Array): void;
  /** A validated server control message other than `hello` (error, shutdown_notice, sim_events, ...). */
  onControl?(type: string, payload: unknown): void;
  /** Own Schema `equippedTool` changed (also once after each (re)join when known). Feeds prediction's tool. */
  onEquippedTool?(toolCode: number): void;
}

export interface RoomSessionOptions {
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly clientBuild: string;
  readonly contractId: string;
  readonly auth: AccessTokenSource;
  /** World plot count (bounds plot ids in the decoders). */
  readonly plotCount: number;
  /** DUST_SNAPSHOT inflate. Default: the synchronous raw inflater of ./inflate-raw (online rooms only). */
  readonly inflate?: Inflate;
  /**
   * Off-main-thread DUST_SNAPSHOT inflate (DustOffload). Undefined: a module worker is spawned (dynamic import, on
   * `start()`) when `Worker` exists and no custom `inflate` is given. A factory supplies the port (tests); false turns
   * the offload off. Without a worker the synchronous inflater runs, exactly as before.
   */
  readonly inflateWorker?: (() => InflateWorkerPort | null) | false;
  readonly events?: EventBus;
  readonly handlers?: RoomSessionHandlers;
  /** Probe /healthz before joining (default true; false for a local dev server). */
  readonly wakeProbe?: boolean;
  /** False while the server does not stream DUST_SNAPSHOT yet (M1 ShiftRoom before W3-T01). Default true. */
  readonly expectDustSnapshot?: boolean;
  readonly consume?: ConsumeReservationFn;
  readonly fetch?: typeof fetch;
  /** Monotonic clock in ms (default `performance.now`). */
  readonly now?: () => number;
  /** Extra `ClientSession` tuning (tests). */
  readonly sessionConfig?: Partial<Omit<SessionConfig, "plotCount" | "inflate" | "interpolation" | "driveReconnect">>;
}

export interface RoomSessionStats {
  /** Inbound bytes messages that were not Uint8Array or larger than OUTBOUND_MAX_BYTES. */
  inboundDropped: number;
  /** Dust gap resyncs requested (FRAME dust arrived during a paced snapshot's transfer) and gaps given up on. */
  dustGapResyncs: number;
  dustGapAccepted: number;
  /** Control messages that failed their schema (hello included). */
  controlInvalid: number;
  /** Messages of an unknown type. */
  unknown: number;
}

export interface RoomSession {
  readonly phase: SessionPhase;
  readonly failure: SessionFailure | null;
  /** The protocol state machine (stats, view, table, clock). */
  readonly core: ClientSession;
  /** Remote entities; sample after `updateInterpolation()`. */
  readonly interpolation: InterpolationBuffer;
  readonly stats: RoomSessionStats;
  /** Dust inflate offload counters (worker use, hold-back depth); null when the offload is off. */
  readonly dustOffload: DustOffloadStats | null;
  /** Cold-start progress 0 .. 0.95 for the waking overlay. */
  wakeFraction(): number;
  /** Starts (or restarts after failed / closed). */
  start(): void;
  /** Same as start; the UI calls it after a retryable failure (respecting `failure.retryAfterMs`). */
  retry(): void;
  /** Leaves on purpose (consented). */
  leave(): void;
  /** Tab visibility (hidden-tab rules of netcode.md 7). */
  setHidden(hidden: boolean): void;
  /** Advances the remote-entity timeline; call once per render frame while in the room. */
  updateInterpolation(): void;
  /** Sends one encoded INPUT body (without the type byte). False when not in the room. */
  sendInput(body: Uint8Array): boolean;
  /**
   * Sends one encoded DUST_REQUEST body (without the type byte; `RemoteDust.nextRequest` output from index 1). False
   * when not joined. The caller paces it (server bucket RATE_LIMITS.dustRequest).
   */
  sendDustRequest(body: Uint8Array): boolean;
  /** Last own Schema `equippedTool` seen, or -1 before the first state patch. */
  readonly equippedTool: number;
  dispose(): void;
}

// Pure-annotated so an unused import of this module tree-shakes completely (no eager calls at module load).
const EMPTY: Readonly<Record<string, never>> = /* @__PURE__ */ Object.freeze({});
const VISIBLE = /* @__PURE__ */ Object.freeze({ hidden: false });
const HIDDEN = /* @__PURE__ */ Object.freeze({ hidden: true });

interface SafeParser {
  safeParse(value: unknown): { success: boolean; data?: unknown };
}

// The catalog-derived handler tables are built on first use (the first `bind`), not at module load: importing this
// module (or the net barrel) runs no top-level code, so the solo entry chunk carries no eager work and the bundler can
// tree-shake it. Built once, then reused for every bind.
let s2cBytesIds: readonly number[] | null = null;
let s2cControl: readonly (readonly [string, SafeParser])[] | null = null;

/** Active server-to-client bytes message ids (lazy, cached). */
function s2cBytesIdsTable(): readonly number[] {
  s2cBytesIds ??= Object.values(MESSAGE_CATALOG).flatMap((m) =>
    m.channel === Channel.Bytes && m.direction === Direction.ServerToClient && m.status === MessageStatus.Active
      ? [m.id]
      : [],
  );
  return s2cBytesIds;
}

/** Active server-to-client control messages other than HELLO, with their payload schema (lazy, cached). */
function s2cControlTable(): readonly (readonly [string, SafeParser])[] {
  s2cControl ??= Object.entries(MESSAGE_CATALOG).flatMap(([name, m]) => {
    if (m.channel !== Channel.Control || m.direction !== Direction.ServerToClient) return [];
    if (m.status !== MessageStatus.Active || m.id === MESSAGE_CATALOG.HELLO.id) return [];
    const schema = (PAYLOAD_SCHEMAS as Partial<Record<string, SafeParser>>)[name];
    return schema === undefined ? [] : [[m.id, schema] as const];
  });
  return s2cControl;
}

function closeCodeOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") return code;
  }
  return null;
}

/** Wait after a lossy paced snapshot before asking for another (the server sends one snapshot per seat per 2 s). */
export const DUST_GAP_RESYNC_DELAY_MS = 2100;
/** Gap resyncs in a row before the gap is accepted (a paced snapshot can be lossy again). */
export const DUST_GAP_MAX_RESYNCS = 2;

export function createRoomSession(options: RoomSessionOptions): RoomSession {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const consume = options.consume ?? colyseusConsume;
  const now = options.now ?? (() => performance.now());
  const handlers = options.handlers ?? {};
  const httpBase = options.httpUrl.replace(/\/+$/, "");
  const joinUrl = `${httpBase}${CONTRACT_JOIN_PATH.replace(":id", encodeURIComponent(options.contractId))}`;
  const policy = seatHoldReconnectPolicy(options.sessionConfig?.holdMs ?? SEAT_HOLD_MS);
  const stats: RoomSessionStats = {
    inboundDropped: 0,
    dustGapResyncs: 0,
    dustGapAccepted: 0,
    controlInvalid: 0,
    unknown: 0,
  };

  let room: RoomConnection | null = null;
  let equippedTool = -1;
  let attempt = 0;
  let disposed = false;
  let ticker: ReturnType<typeof setInterval> | undefined;
  /** A forced token refresh was already spent in this join cycle (security: retry 4101/401 once). */
  let authRefreshUsed = false;
  let lastEmitted: NetConnectionState | null = null;
  /** When the current connect attempt was launched (same instant as the core's own attempt clock). */
  let launchedAt = 0;
  const connectTimeoutMs = options.sessionConfig?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  /**
   * Review S1 (M1-review2): the core times an attempt out itself (tick -> onConnectFailed). A late failure of that
   * same attempt must not be counted again, so it is reported only while the attempt is inside the timeout. Past the
   * timeout the core has counted it already, or will on its next tick: exactly one count either way.
   */
  const lateFailure = (): boolean => now() - launchedAt > connectTimeoutMs;

  const pingBody = new Uint8Array(PING_BODY_BYTES);
  const scratch = new Uint8Array(OUTBOUND_MAX_BYTES + 1);
  const views: (Uint8Array | undefined)[] = [];
  const viewOf = (len: number): Uint8Array => {
    let v = views[len];
    if (v === undefined) {
      v = scratch.subarray(0, len);
      views[len] = v;
    }
    return v;
  };

  const interpolation = new InterpolationBuffer();

  // Off-main-thread snapshot inflate (online rooms only): hold-back queue in front of the protocol session.
  const syncInflate = options.inflate ?? inflateRaw;
  const workerFactory = options.inflateWorker;
  const offloadWanted =
    workerFactory !== false &&
    (workerFactory !== undefined || (options.inflate === undefined && typeof Worker !== "undefined"));
  // The offload and the worker client load on demand (dynamic import on start()), so the entry chunk carries none of
  // them (solo never starts a room session). A loaded offload becomes active at the next connection (`bind`), never in
  // the middle of a snapshot transfer, so the session and the offload always see a whole snapshot.
  let offload: DustOffload | null = null;
  let readyOffload: DustOffload | null = null;
  let workerRequested = false;
  /** A snapshot is part-way through the session's own assembler (slices dispatched without the offload). */
  let directSlices = false;
  const activate = (): void => {
    if (offload === null && readyOffload !== null && !directSlices) offload = readyOffload;
  };
  const ensureWorker = (): void => {
    if (!offloadWanted || workerRequested || disposed) return;
    workerRequested = true;
    const clientModule = typeof workerFactory === "function" ? null : import("./inflate-worker-client");
    void Promise.all([import("./dust-offload"), clientModule])
      .then(([m, c]) => {
        if (disposed) return;
        let port: InflateWorkerPort | null = null;
        try {
          port = typeof workerFactory === "function" ? workerFactory() : (c?.createInflateWorker() ?? null);
        } catch {
          // no worker (blocked, unsupported): the synchronous inflater runs
        }
        if (port === null) return;
        const o = new m.DustOffload({ deliver: (message, at) => dispatch(message, at), inflate: syncInflate });
        o.attach(port);
        readyOffload = o;
        activate();
      })
      .catch(() => undefined);
  };

  // A paced snapshot (server sends slices over several frames) misses the FRAME dust of its own transfer window.
  // Client-only repair: ask for a fresh snapshot (ClientSession.requestSnapshotResync) once the server's 2 s snapshot
  // limit has passed, at most DUST_GAP_MAX_RESYNCS times in a row.
  let hiddenNow = false;
  let gapResyncs = 0;
  let gapTimer: ReturnType<typeof setTimeout> | undefined;
  const onSnapshotInstalled = (): void => {
    if (offload === null) return;
    if (!offload.takeGap()) {
      gapResyncs = 0;
      return;
    }
    if (gapResyncs >= DUST_GAP_MAX_RESYNCS) {
      stats.dustGapAccepted++;
      gapResyncs = 0;
      return;
    }
    gapResyncs++;
    if (gapTimer !== undefined) clearTimeout(gapTimer);
    gapTimer = setTimeout(() => {
      gapTimer = undefined;
      if (disposed || hiddenNow || !core.inRoom) return;
      if (core.requestSnapshotResync(now())) stats.dustGapResyncs++;
    }, DUST_GAP_RESYNC_DELAY_MS);
  };

  const emitStatus = (): void => {
    if (options.events === undefined) return;
    const state = connectionStateOf(core.phase);
    const clock = core.clock;
    const event: NetStatusEvent = {
      state,
      previous: lastEmitted,
      closeCode: core.phase === "failed" && core.failure !== null && core.failure.code !== 0 ? core.failure.code : null,
      rttMs: clock.hasEstimate ? Math.round(clock.rttMs) : null,
    };
    lastEmitted = state;
    options.events.emit("net.status", event);
  };

  const stopTicker = (): void => {
    if (ticker !== undefined) clearInterval(ticker);
    ticker = undefined;
  };
  const startTicker = (): void => {
    if (ticker === undefined) ticker = setInterval(() => core.tick(now()), ROOM_SESSION_TICK_MS);
  };

  /** Forgets the current room (and any attempt in flight); a consented leave cancels SDK reconnection. */
  const dropRoom = (): void => {
    attempt++;
    const r = room;
    room = null;
    offload?.reset();
    directSlices = false;
    if (gapTimer !== undefined) clearTimeout(gapTimer);
    gapTimer = undefined;
    if (r !== null) void r.leave(true);
  };

  /** One bytes message into the protocol session (directly, or replayed by the offload with its arrival time). */
  const dispatch = (message: Uint8Array, at: number): void => {
    core.io[IO_NOW] = at;
    if (offload === null && message[0] === MESSAGE_CATALOG.DUST_SNAPSHOT.id) directSlices = true;
    const result = core.onBytes(message);
    if (result === SESSION_BYTES_UNHANDLED) handlers.onBytes?.(message);
    else if (result === SESSION_BYTES_HANDLED && message[0] === MESSAGE_CATALOG.PONG.id) emitStatus();
  };

  const ingest = (id: number, body: unknown): void => {
    if (!(body instanceof Uint8Array) || body.byteLength > OUTBOUND_MAX_BYTES) {
      stats.inboundDropped++;
      return;
    }
    scratch[0] = id;
    scratch.set(body, 1);
    const message = viewOf(body.byteLength + 1);
    if (offload !== null) offload.push(message, now());
    else dispatch(message, now());
  };

  const bind = (r: RoomConnection): void => {
    activate();
    r.onMessage(MESSAGE_CATALOG.HELLO.id, (payload: unknown) => {
      if (room !== r) return;
      const hello = HelloPayloadSchema.safeParse(payload);
      if (!hello.success) {
        stats.controlInvalid++;
        return;
      }
      core.onHello(now(), hello.data);
    });
    for (const id of s2cBytesIdsTable()) {
      r.onMessage(id, (body: unknown) => {
        if (room === r) ingest(id, body);
      });
    }
    for (const [type, schema] of s2cControlTable()) {
      r.onMessage(type, (payload: unknown) => {
        if (room !== r) return;
        const parsed = schema.safeParse(payload);
        if (!parsed.success) {
          stats.controlInvalid++;
          return;
        }
        handlers.onControl?.(type, parsed.data);
      });
    }
    r.onMessage("*", () => {
      stats.unknown++;
    });
    equippedTool = -1;
    const sid = r.sessionId;
    if (sid !== undefined && r.onStateChange !== undefined) {
      // One map lookup per Schema patch (frame ticks only, 10 Hz); the handler fires on change only.
      r.onStateChange((state: unknown) => {
        if (room !== r) return;
        const tool = equippedToolOf(state, sid);
        if (tool < 0 || tool === equippedTool) return;
        equippedTool = tool;
        handlers.onEquippedTool?.(tool);
      });
    }
    r.onDrop((code) => {
      if (room === r) core.onClosed(now(), code);
    });
    r.onReconnect(() => {
      if (room === r) core.onConnected(now());
    });
    r.onLeave((code) => {
      if (room !== r) return;
      room = null;
      core.onClosed(now(), code);
    });
  };

  /** POST join, once more after a forced token refresh on 401. */
  const requestSeat = async (gen: number): Promise<SeatReservation | JoinRefusal | null> => {
    let force = false;
    for (;;) {
      const token = await options.auth.getAccessToken(force);
      if (gen !== attempt || disposed) return null;
      if (token === null) return failure("auth_invalid", 0, true);
      const res = await doFetch(joinUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: options.clientBuild }),
      });
      if (gen !== attempt || disposed) return null;
      if (res.ok) {
        const body = (await res.json()) as { reservation?: unknown } | null;
        const parsed = SeatReservationSchema.safeParse(body?.reservation);
        return parsed.success ? (parsed.data as SeatReservation) : RETRY;
      }
      if (res.status === 401 && !authRefreshUsed) {
        authRefreshUsed = true;
        force = true;
        continue;
      }
      let error: string | null = null;
      try {
        const parsed = ApiErrorBodySchema.safeParse(await res.json());
        if (parsed.success) error = parsed.data.error;
      } catch {
        error = null; // HTML or empty body (host error page)
      }
      return classifyJoinRefusal(res.status, error, res.headers.get("retry-after"));
    }
  };

  const join = async (gen: number): Promise<void> => {
    let seat: SeatReservation | JoinRefusal | null;
    try {
      seat = await requestSeat(gen);
    } catch {
      seat = RETRY; // network, CORS, non-JSON 200 (waking page)
    }
    if (seat === null || gen !== attempt || disposed) return;
    if ("kind" in seat) {
      if (seat.kind === "fail") core.onJoinRejected(now(), seat.failure);
      else if (!lateFailure()) core.onConnectFailed(now());
      return;
    }
    let r: RoomConnection;
    try {
      r = await consume(options.wsUrl, seat, policy);
    } catch (error) {
      if (gen !== attempt || disposed || lateFailure()) return;
      const code = closeCodeOf(error);
      // Our codes (4100-4199) are verdicts; matchmaking errors (expired reservation, 42xx) retry with a new seat.
      if (code !== null && code >= 4100 && code <= 4199) core.onClosed(now(), code);
      else core.onConnectFailed(now());
      return;
    }
    if (gen !== attempt || disposed) {
      void r.leave(true);
      return;
    }
    room = r;
    // onConnected first (phase joining), then bind: both run before the SDK dispatches the next socket message.
    core.onConnected(now());
    bind(r);
  };

  const probe = async (): Promise<void> => {
    let ok = false;
    let serverProtocol = PROTOCOL_VERSION;
    try {
      const res = await doFetch(`${httpBase}/healthz`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (res.ok) {
        const parsed = HealthResponseSchema.safeParse(await res.json());
        if (parsed.success) {
          ok = true;
          serverProtocol = parsed.data.protocolVersion;
        }
      }
    } catch {
      ok = false; // Render waking page, CORS failure, timeout or non-JSON
    }
    if (!disposed) core.onHealth(now(), ok, serverProtocol);
  };

  const host: SessionHost = {
    probeHealth: () => void probe(),
    connect: (mode: ConnectMode) => {
      dropRoom();
      if (mode === "reconnect") {
        // Never raised: the SDK reconnects in place (driveReconnect false). Defensive: count it as a failed attempt.
        core.onConnectFailed(now());
        return;
      }
      launchedAt = now();
      void join(attempt); // "join" and "restore" use the same REST join; the server restores from the save
    },
    sendReady: () => room?.send(MESSAGE_CATALOG.READY.id, EMPTY),
    // No dedicated keyframe request exists: `visibility {hidden:false}` asks for keyframe + snapshot (netcode.md 7).
    // While hidden, the resync happens when the tab is shown again.
    requestResync: () => {
      if (!core.hidden) room?.send(MESSAGE_CATALOG.VISIBILITY.id, VISIBLE);
    },
    sendPing: () => {
      if (room === null) return;
      writePingBody(Math.floor(now()), pingBody);
      room.sendBytes(MESSAGE_CATALOG.PING.id, pingBody);
    },
    sendVisibility: (hidden) => room?.send(MESSAGE_CATALOG.VISIBILITY.id, hidden ? HIDDEN : VISIBLE),
    onPhase: (phase, previous) => {
      if (phase === "failed" || phase === "closed") {
        stopTicker();
        dropRoom();
        if (
          phase === "failed" &&
          core.failure?.reason === "auth_invalid" &&
          core.failure.code === CloseCode.AUTH_INVALID &&
          !authRefreshUsed
        ) {
          // 4101 from onAuth (ticket expired or token rejected): refresh the token and retry once (netcode.md 12).
          authRefreshUsed = true;
          queueMicrotask(() => {
            if (disposed || core.phase !== "failed") return;
            void options.auth.getAccessToken(true).then(() => {
              if (!disposed && core.phase === "failed") {
                core.retry(now());
                startTicker();
              }
            });
          });
        }
      } else if (
        (phase === "waking" || phase === "connecting") &&
        (previous === "joining" || previous === "joined" || previous === "resyncing" || previous === "reconnecting")
      ) {
        dropRoom(); // the old connection is useless: a fresh join (or restore) follows
      } else if (phase === "joined") {
        authRefreshUsed = false;
      }
      emitStatus();
      handlers.onPhase?.(phase, previous);
    },
    onFrame: (view, keyframe) => {
      offload?.noteFrame(view.serverTick, view.strokes.chainCount > 0 || view.dustPlots.count > 0);
      handlers.onFrame?.(view, keyframe);
    },
    onSlotsReset: () => handlers.onSlotsReset?.(),
    onDustSnapshot: (snapshot) => {
      handlers.onDustSnapshot?.(snapshot);
      directSlices = false;
      activate();
      onSnapshotInstalled();
    },
  };

  const core = new ClientSession(host, {
    ...options.sessionConfig,
    plotCount: options.plotCount,
    inflate: (data, maxBytes) => (offload !== null ? offload.inflate(data, maxBytes) : syncInflate(data, maxBytes)),
    wakeProbe: options.wakeProbe ?? true,
    expectDustSnapshot: options.expectDustSnapshot ?? true,
    interpolation,
    driveReconnect: false,
  });

  const begin = (): void => {
    if (disposed) return;
    ensureWorker();
    authRefreshUsed = false;
    startTicker();
    core.start(now());
  };

  return {
    get phase() {
      return core.phase;
    },
    get failure() {
      return core.failure;
    },
    core,
    interpolation,
    stats,
    get dustOffload() {
      return offload === null ? null : offload.stats;
    },
    wakeFraction: () => core.wakeFraction(now()),
    start: begin,
    retry: begin,
    leave() {
      if (disposed) return;
      core.leave();
    },
    setHidden(hidden) {
      if (disposed) return;
      hiddenNow = hidden;
      core.onVisibility(now(), hidden);
    },
    updateInterpolation() {
      if (room === null || !core.inRoom) return;
      interpolation.io[IO_NOW] = now();
      interpolation.update();
    },
    sendInput(body) {
      if (room === null || !core.inRoom) return false;
      room.sendBytes(MESSAGE_CATALOG.INPUT.id, body);
      return true;
    },
    sendDustRequest(body) {
      if (room === null || core.phase !== "joined") return false;
      room.sendBytes(MESSAGE_CATALOG.DUST_REQUEST.id, body);
      return true;
    },
    get equippedTool() {
      return equippedTool;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopTicker();
      dropRoom();
      offload?.dispose();
      if (readyOffload !== offload) readyOffload?.dispose();
    },
  };
}
