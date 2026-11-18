import {
  CloseCode,
  MESSAGE_CATALOG,
  PROTOCOL_VERSION,
  type EventBus,
  type HelloPayload,
  type NetStatusEvent,
} from "@moon-cleanup/shared";
import {
  ENTITY_KIND_AVATAR,
  FrameWriter,
  PONG_BODY_BYTES,
  REC_DELTA,
  REC_FULL,
  SAMPLE_NONE,
  SlotTable,
  StrokeChainBuffer,
  createEntityState,
  createSelfState,
  encodeSnapshotRaw,
  readPingBody,
  snapshotSliceCount,
  writePongBody,
  writeSnapshotSlice,
} from "@moon-cleanup/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyJoinRefusal,
  connectionStateOf,
  createRoomSession,
  equippedToolOf,
  retryAfterMs,
  rosterOf,
  seatHoldReconnectPolicy,
  type AccessTokenSource,
  type ConsumeReservationFn,
  type ReconnectPolicy,
  type RoomConnection,
  type RoomSessionOptions,
} from "./room-session";
import type { InflateJob, InflateWorkerPort } from "./inflate-worker-core";
import type { SeatReservation } from "./session";

const CONTRACT = "0190a5b4-1111-4222-8333-444455556666";
const PLOTS = 20_000;
const HEALTH = { ok: true, service: "moon", env: "local", build: "dev", protocolVersion: PROTOCOL_VERSION, uptimeS: 1 };
const HELLO: HelloPayload = { serverProtocol: PROTOCOL_VERSION, serverBuild: "dev", simTickHz: 20, snapshotHz: 10 };
const RESERVATION = { name: "shift", sessionId: "s1", roomId: "r1", processId: "p1" };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const identityInflate = (data: Uint8Array, max: number): Uint8Array | null => (data.length > max ? null : data.slice());
const flush = async (): Promise<void> => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};

class FakeRoom implements RoomConnection {
  readonly handlers = new Map<string | number, (p: never) => void>();
  dropCb: ((code: number) => void) | undefined;
  reconnectCb: (() => void) | undefined;
  leaveCb: ((code: number) => void) | undefined;
  readonly sent: { type: string; payload: unknown }[] = [];
  readonly bytes: { type: number; body: Uint8Array }[] = [];
  left: boolean[] = [];
  onMessage(type: string | number, cb: (p: never) => void): void {
    this.handlers.set(type, cb);
  }
  onDrop(cb: (code: number) => void): void {
    this.dropCb = cb;
  }
  onReconnect(cb: () => void): void {
    this.reconnectCb = cb;
  }
  onLeave(cb: (code: number) => void): void {
    this.leaveCb = cb;
  }
  send(type: string, payload: unknown): void {
    this.sent.push({ type, payload });
  }
  sendBytes(type: number, body: Uint8Array): void {
    this.bytes.push({ type, body: body.slice() });
  }
  leave(consented?: boolean): void {
    this.left.push(consented === true);
    this.leaveCb?.(4000);
  }
  deliver(type: string | number, payload: unknown): void {
    const h = this.handlers.get(type) ?? this.handlers.get("*");
    (h as ((p: unknown) => void) | undefined)?.(payload);
  }
}

/** Server-side FRAME bodies (type byte stripped, as `client.sendBytes` delivers them). */
class FrameSource {
  private readonly writer = new FrameWriter();
  private readonly table = new SlotTable();
  body(tick: number, keyframe: boolean, x: number): Uint8Array {
    const w = this.writer;
    if (keyframe) this.table.reset();
    w.begin(tick, 0, 1, keyframe);
    w.writeSelf(createSelfState());
    if (keyframe) w.slotAssign(this.table, 0, 1000, ENTITY_KIND_AVATAR);
    const e = createEntityState();
    e.slot = 0;
    e.rec = keyframe ? REC_FULL : REC_DELTA;
    e.px = x;
    w.writeEntity(this.table, e);
    const n = w.finish();
    return w.buffer.slice(1, n);
  }
}

function snapshotBodies(): Uint8Array[] {
  const raw = encodeSnapshotRaw({
    plotCount: PLOTS,
    plotStates: new Uint8Array(Math.ceil(PLOTS / 4)),
    openedRemaining: new Uint8Array(0),
    ledgers: [],
    logs: [],
  });
  if (raw === null) throw new Error("snapshot");
  const out: Uint8Array[] = [];
  for (let i = 0; i < snapshotSliceCount(raw.length); i++) {
    const buf = new Uint8Array(4200);
    const n = writeSnapshotSlice(raw, i, 1, buf);
    out.push(buf.slice(1, n));
  }
  return out;
}

interface Rig {
  t: number;
  readonly seen: NetStatusEvent[];
  readonly rooms: FakeRoom[];
  readonly consumed: { reservation: SeatReservation; policy: ReconnectPolicy }[];
  readonly joins: { auth: string; body: unknown }[];
  joinAnswers: (() => Response)[];
  consumeError: unknown;
  readonly tokens: boolean[];
  advance(ms: number): Promise<void>;
}

function rig(overrides: Partial<RoomSessionOptions> = {}, healthAnswers: (() => Response)[] = []) {
  const r: Rig = {
    t: 0,
    seen: [],
    rooms: [],
    consumed: [],
    joins: [],
    joinAnswers: [],
    consumeError: undefined,
    tokens: [],
    async advance(ms: number) {
      for (let done = 0; done < ms; done += 250) {
        r.t += 250;
        vi.advanceTimersByTime(250);
        await flush();
      }
    },
  };
  const events = { emit: (_n: string, p: unknown) => void r.seen.push(p as NetStatusEvent), on: () => () => {} };
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/healthz")) return (healthAnswers.shift() ?? (() => json(HEALTH)))();
    expect(u).toBe(`http://srv/v1/contracts/${CONTRACT}/join`);
    const headers = init?.headers as Record<string, string>;
    r.joins.push({ auth: headers["authorization"] ?? "", body: JSON.parse(String(init?.body)) });
    return (r.joinAnswers.shift() ?? (() => json({ reservation: RESERVATION, role: "holder" })))();
  });
  const auth: AccessTokenSource = {
    getAccessToken: async (force) => {
      r.tokens.push(force);
      return force ? "token-2" : "token-1";
    },
  };
  const consume: ConsumeReservationFn = async (_ws, reservation, policy) => {
    r.consumed.push({ reservation, policy });
    if (r.consumeError !== undefined) throw r.consumeError;
    const room = new FakeRoom();
    r.rooms.push(room);
    return room;
  };
  const session = createRoomSession({
    httpUrl: "http://srv/",
    wsUrl: "ws://srv",
    clientBuild: "test",
    contractId: CONTRACT,
    auth,
    plotCount: PLOTS,
    inflate: identityInflate,
    events: events as unknown as EventBus,
    expectDustSnapshot: false,
    consume,
    fetch: fetchFn as unknown as typeof fetch,
    now: () => r.t,
    ...overrides,
  });
  return { r, session, fetchFn };
}

const frames = new FrameSource();

/** A FRAME body (type byte stripped) that carries one stroke chain, i.e. dust the snapshot of an earlier tick lacks. */
function strokeFrameBody(tick: number): Uint8Array {
  const w = new FrameWriter();
  const strokes = new StrokeChainBuffer(4, 1);
  strokes.addChain(5, 0, 0, 100, 100, 20, 1000, 0, 0, tick, 1);
  w.begin(tick, 0, 1, false);
  w.writeSelf(createSelfState());
  w.writeStrokes(strokes, 0, tick);
  return w.buffer.slice(1, w.finish());
}

/** A snapshot worker the test answers by hand (identity inflate, like the rig's `identityInflate`). */
class ManualPort implements InflateWorkerPort {
  readonly jobs: InflateJob[] = [];
  terminated = false;
  onmessage: InflateWorkerPort["onmessage"] = null;
  onerror: InflateWorkerPort["onerror"] = null;
  postMessage(job: InflateJob): void {
    this.jobs.push(job);
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(index: number): void {
    const job = this.jobs[index]!;
    this.onmessage?.({ data: { id: job.id, out: job.data.slice() } });
  }
}

async function joinFully(r: Rig, session: ReturnType<typeof createRoomSession>, tick = 100): Promise<FakeRoom> {
  session.start();
  await flush();
  const room = r.rooms.at(-1)!;
  room.deliver("hello", HELLO);
  room.deliver(MESSAGE_CATALOG.FRAME.id, frames.body(tick, true, 1));
  return room;
}

describe("room session: pure helpers", () => {
  it("maps REST join refusals to retry or the close-code family", () => {
    expect(classifyJoinRefusal(400, "BAD_REQUEST", null)).toMatchObject({ failure: { reason: "protocol_mismatch" } });
    expect(classifyJoinRefusal(401, "UNAUTHORIZED", null)).toMatchObject({ failure: { reason: "auth_invalid" } });
    expect(classifyJoinRefusal(403, "FORBIDDEN", null)).toMatchObject({
      failure: { reason: "forbidden", retryable: false },
    });
    expect(classifyJoinRefusal(404, null, null)).toMatchObject({ failure: { reason: "contract_unavailable" } });
    expect(classifyJoinRefusal(409, "ROOM_FULL", null)).toMatchObject({ failure: { reason: "room_full", code: 4105 } });
    expect(classifyJoinRefusal(409, "CONTRACT_BUSY", null).kind).toBe("retry");
    expect(classifyJoinRefusal(429, "RATE_LIMITED", "12")).toMatchObject({
      failure: { reason: "rate_limited", code: 4104, retryAfterMs: 12_000 },
    });
    expect(classifyJoinRefusal(503, "AT_CAPACITY", "20")).toMatchObject({
      failure: { reason: "at_capacity", code: 4105, retryAfterMs: 20_000 },
    });
    expect(classifyJoinRefusal(503, "RETRY_LATER", "5").kind).toBe("retry");
    expect(classifyJoinRefusal(502, null, null).kind).toBe("retry");
    expect(retryAfterMs("abc")).toBe(30_000);
    expect(retryAfterMs("999999")).toBe(3_600_000);
  });

  it("SDK reconnection policy is 0.5, 1, 2, 4, 8 s and covers the 60 s seat hold", () => {
    const p = seatHoldReconnectPolicy();
    const delays = Array.from({ length: p.maxRetries }, (_, i) =>
      Math.min(p.maxDelayMs, Math.max(p.minDelayMs, 2 ** (i + 1) * p.delayMs)),
    );
    expect(delays.slice(0, 6)).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
    expect(delays.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(60_000);
  });

  it("reads the own equippedTool from Schema state defensively", () => {
    const state = { players: new Map([["s1", { equippedTool: 4 }]]) };
    expect(equippedToolOf(state, "s1")).toBe(4);
    expect(equippedToolOf(state, "s2")).toBe(-1);
    expect(equippedToolOf(null, "s1")).toBe(-1);
    expect(equippedToolOf({ players: {} }, "s1")).toBe(-1);
    expect(equippedToolOf({ players: new Map([["s1", { equippedTool: 1.5 }]]) }, "s1")).toBe(-1);
    expect(equippedToolOf({ players: new Map([["s1", { equippedTool: 300 }]]) }, "s1")).toBe(-1);
  });

  it("mirrors phases into net.status states", () => {
    expect(connectionStateOf("idle")).toBe("asleep");
    expect(connectionStateOf("joining")).toBe("connecting");
    expect(connectionStateOf("resyncing")).toBe("connected");
    expect(connectionStateOf("reconnecting")).toBe("lost");
    expect(connectionStateOf("failed")).toBe("lost");
  });
});

describe("room session: adapter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is inert until started: no fetch, no timer", async () => {
    const { session, fetchFn } = rig();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(session.phase).toBe("idle");
    session.dispose();
  });

  it("wakes through the Render waking page, joins by REST + reservation, sends ready, pings and reports RTT", async () => {
    const waking = () => new Response("<html>waking</html>", { status: 200 });
    const { r, session } = rig({ wakeProbe: true }, [waking, waking]);
    session.start();
    await flush();
    expect(session.phase).toBe("waking");
    await r.advance(6250);
    expect(session.phase).toBe("joining");
    expect(r.joins).toHaveLength(1);
    expect(r.joins[0]).toEqual({
      auth: "Bearer token-1",
      body: { protocolVersion: PROTOCOL_VERSION, clientBuild: "test" },
    });
    expect(r.consumed[0]!.reservation).toMatchObject(RESERVATION);
    const room = r.rooms[0]!;
    room.deliver("hello", HELLO);
    room.deliver(MESSAGE_CATALOG.FRAME.id, frames.body(200, true, 1));
    expect(session.phase).toBe("joined");
    expect(room.sent.filter((m) => m.type === "ready")).toHaveLength(1);
    await r.advance(250);
    const ping = room.bytes.find((b) => b.type === MESSAGE_CATALOG.PING.id)!;
    expect(ping.body.byteLength).toBe(4);
    const pong = new Uint8Array(PONG_BODY_BYTES);
    writePongBody({ clientTimeMs: readPingBody(ping.body), serverTick: 210 }, pong);
    r.t += 80;
    room.deliver(MESSAGE_CATALOG.PONG.id, pong);
    expect(r.seen.map((e) => e.state)).toEqual(expect.arrayContaining(["waking", "connecting", "connected"]));
    expect(r.seen.at(-1)?.rttMs).toBeGreaterThan(0);
    session.dispose();
    expect(room.left).toEqual([true]);
  });

  it("waits for the dust snapshot when the server streams one", async () => {
    const { r, session } = rig({ expectDustSnapshot: true });
    const room = await joinFully(r, session);
    expect(session.phase).toBe("joining");
    for (const s of snapshotBodies()) room.deliver(MESSAGE_CATALOG.DUST_SNAPSHOT.id, s);
    expect(session.phase).toBe("joined");
    expect(session.core.stats.snapshotsApplied).toBe(1);
    session.dispose();
  });

  it("accepts a join response with or without extra fields (no join ticket dependency)", async () => {
    const { r, session } = rig();
    r.joinAnswers.push(() =>
      json({ reservation: { ...RESERVATION, extra: 1 }, role: "staff", joinTicket: "x".repeat(20) }),
    );
    await joinFully(r, session);
    expect(session.phase).toBe("joined");
    session.dispose();
  });

  it("401 refreshes the token once and retries; a second 401 fails auth_invalid", async () => {
    const a = rig();
    a.r.joinAnswers.push(() => json({ error: "UNAUTHORIZED" }, 401));
    a.session.start();
    await flush();
    expect(a.r.tokens).toEqual([false, true]);
    expect(a.r.joins.map((j) => j.auth)).toEqual(["Bearer token-1", "Bearer token-2"]);
    expect(a.session.phase).toBe("joining");
    a.session.dispose();

    const b = rig();
    b.r.joinAnswers.push(
      () => json({ error: "UNAUTHORIZED" }, 401),
      () => json({ error: "UNAUTHORIZED" }, 401),
    );
    b.session.start();
    await flush();
    expect(b.session.failure).toMatchObject({ reason: "auth_invalid", retryable: true });
    b.session.dispose();
  });

  it("fails on 403 / ROOM_FULL / AT_CAPACITY and retries CONTRACT_BUSY with backoff", async () => {
    for (const [res, reason] of [
      [() => json({ error: "FORBIDDEN" }, 403), "forbidden"],
      [() => json({ error: "ROOM_FULL" }, 409), "room_full"],
      [() => json({ error: "AT_CAPACITY" }, 503, { "retry-after": "20" }), "at_capacity"],
    ] as const) {
      const { r, session } = rig();
      r.joinAnswers.push(res);
      session.start();
      await flush();
      expect(session.failure?.reason).toBe(reason);
      await r.advance(10_000);
      expect(r.joins).toHaveLength(1); // ticker stopped, no retry storm
      session.dispose();
    }
    const busy = rig();
    busy.r.joinAnswers.push(() => json({ error: "CONTRACT_BUSY" }, 409));
    busy.session.start();
    await flush();
    expect(busy.session.phase).toBe("connecting");
    await busy.r.advance(1250);
    expect(busy.r.joins).toHaveLength(2);
    expect(busy.session.phase).toBe("joining");
    busy.session.dispose();
  });

  it("handles close codes 4100, 4104, 4105 and 4106", async () => {
    const cases = [
      [CloseCode.PROTOCOL_MISMATCH, "protocol_mismatch", false],
      [CloseCode.RATE_LIMITED, "rate_limited", true],
      [CloseCode.ROOM_FULL, "room_full", true],
      [CloseCode.DUPLICATE_SESSION, "duplicate_session", false],
    ] as const;
    for (const [code, reason, retryable] of cases) {
      const { r, session } = rig();
      const room = await joinFully(r, session);
      room.leaveCb?.(code);
      expect(session.failure).toMatchObject({ reason, code, retryable });
      expect(r.seen.at(-1)).toMatchObject({ state: "lost", closeCode: code });
      session.dispose();
    }
    // Rejected by the server during the WebSocket join (for example 4105 from onJoin / matchmaking).
    const { r, session } = rig();
    r.consumeError = { code: CloseCode.ROOM_FULL };
    session.start();
    await flush();
    expect(session.failure?.reason).toBe("room_full");
    session.dispose();
  });

  it("4102 kicked and 4103 banned are verdicts: not retryable; a ban at join does not re-join", async () => {
    for (const [code, reason] of [
      [CloseCode.KICKED, "kicked"],
      [CloseCode.BANNED, "banned"],
    ] as const) {
      const { r, session } = rig();
      const room = await joinFully(r, session);
      room.deliver(MESSAGE_CATALOG.KICK_NOTICE.id, { by: "holder", reasonCode: "griefing" });
      expect(session.kickNotice).toEqual({ by: "holder", reasonCode: "griefing" });
      room.leaveCb?.(code);
      expect(session.failure).toMatchObject({ reason, code, retryable: false });
      session.dispose();
    }
    const { r, session } = rig();
    r.consumeError = { code: CloseCode.BANNED };
    session.start();
    await flush();
    await flush();
    expect(session.failure).toMatchObject({ reason: "banned", retryable: false });
    expect(r.consumed).toHaveLength(1);
    expect(r.joins).toHaveLength(1);
    session.dispose();
  });

  it("sendKick sends the KickPayload (ban flag only when set) and the roster follows Schema patches", async () => {
    const { r, session } = rig();
    expect(session.sendKick("p", "other")).toBe(false);
    const room = await joinFully(r, session);
    const seen: number[] = [];
    session.onRoster((x) => seen.push(x.length));
    expect(session.sendKick("00000000-0000-4000-8000-000000000001", "griefing")).toBe(true);
    expect(session.sendKick("00000000-0000-4000-8000-000000000002", "other", true)).toBe(true);
    const kicks = room.sent.filter((s) => s.type === MESSAGE_CATALOG.KICK.id).map((s) => s.payload);
    expect(kicks[0]).toEqual({ playerId: "00000000-0000-4000-8000-000000000001", reasonCode: "griefing" });
    expect(kicks[1]).toMatchObject({ ban: true });
    expect(rosterOf(null, "s")).toEqual([]);
    const players = new Map([
      ["s", { playerId: "b", displayName: "B", role: "holder", connected: true }],
      ["t", { playerId: "a", displayName: "A", role: "staff", connected: false }],
    ]);
    const roster = rosterOf({ players }, "s");
    expect(roster.map((e) => e.playerId)).toEqual(["a", "b"]);
    expect(roster[1]).toMatchObject({ self: true, role: "holder" });
    expect(roster[0]).toMatchObject({ connected: false });
    expect(seen).toEqual([]);
    session.dispose();
  });

  it("a 4101 from onAuth refreshes the token and retries once", async () => {
    const { r, session } = rig();
    r.consumeError = { code: CloseCode.AUTH_INVALID };
    session.start();
    await flush();
    expect(r.tokens).toContain(true);
    expect(r.consumed).toHaveLength(2);
    expect(session.failure?.reason).toBe("auth_invalid"); // second 4101: no loop
    r.consumeError = undefined;
    session.retry();
    await flush();
    expect(session.phase).toBe("joining");
    session.dispose();
  });

  it("matchmaking errors and network failures retry with a new reservation", async () => {
    const { r, session } = rig();
    r.consumeError = { code: 4212 };
    session.start();
    await flush();
    expect(session.phase).toBe("connecting");
    r.consumeError = undefined;
    await r.advance(1250);
    expect(session.phase).toBe("joining");
    expect(r.joins).toHaveLength(2);
    session.dispose();
  });

  it("review S1: a timed-out attempt that fails late is counted once, not twice", async () => {
    let rejectLate: ((e: unknown) => void) | undefined;
    const hanging: ConsumeReservationFn = () =>
      new Promise((_resolve, reject) => {
        rejectLate = reject;
      });
    const { r, session } = rig({
      consume: hanging,
      wakeProbe: false,
      sessionConfig: { maxConnectAttempts: 1, connectTimeoutMs: 2000 },
    });
    session.start();
    await flush();
    expect(session.phase).toBe("connecting");
    // The core times the attempt out (failure 1 of 1 allowed) and schedules a retry.
    await r.advance(2500);
    expect(session.phase).toBe("connecting");
    // The same attempt now rejects late: before the fix this counted failure 2 and failed `connect_failed`.
    rejectLate?.({ code: 4212 });
    await flush();
    expect(session.phase).toBe("connecting");
    expect(session.failure).toBeNull();
    session.dispose();
  });

  it("drop -> SDK reconnect in place -> resync keyframe -> joined", async () => {
    const { r, session } = rig();
    const room = await joinFully(r, session);
    r.t += 1000;
    room.dropCb?.(1006);
    expect(session.phase).toBe("reconnecting");
    expect(r.seen.at(-1)?.state).toBe("lost");
    await r.advance(3000);
    expect(r.joins).toHaveLength(1); // the SDK reconnects, not a new REST join
    room.reconnectCb?.();
    expect(session.phase).toBe("resyncing");
    room.deliver(MESSAGE_CATALOG.FRAME.id, frames.body(160, false, 2)); // not a keyframe: dropped
    expect(session.phase).toBe("resyncing");
    room.deliver(MESSAGE_CATALOG.FRAME.id, frames.body(162, true, 2));
    expect(session.phase).toBe("joined");
    expect(session.core.stats.reconnects).toBe(1);
    session.dispose();
  });

  it("the seat is lost after the 60 s hold and the room is left", async () => {
    const { r, session } = rig();
    const room = await joinFully(r, session);
    room.dropCb?.(1006);
    await r.advance(61_000);
    expect(session.failure?.reason).toBe("seat_lost");
    expect(room.left).toEqual([true]);
    session.dispose();
  });

  it("4001 server shutdown rejoins through REST with restore", async () => {
    const { r, session } = rig();
    const room = await joinFully(r, session);
    room.leaveCb?.(4001);
    await flush();
    expect(r.joins).toHaveLength(2);
    expect(session.phase).toBe("joining");
    session.dispose();
  });

  it("a join finishing after dispose leaves the room; leave() is consented", async () => {
    const a = rig();
    a.session.start();
    a.session.dispose();
    await flush();
    expect(a.r.rooms.every((room) => room.left.length === 1)).toBe(true);

    const b = rig();
    const room = await joinFully(b.r, b.session);
    b.session.leave();
    expect(b.session.phase).toBe("closed");
    expect(room.left).toEqual([true]);
    b.session.dispose();
  });

  it("drops oversized or non-binary bytes, counts unknown types, forwards dust messages with their id byte", async () => {
    const seen: number[] = [];
    const { r, session } = rig({ handlers: { onBytes: (m) => void seen.push(m[0]!, m.byteLength) } });
    const room = await joinFully(r, session);
    room.deliver(MESSAGE_CATALOG.FRAME.id, new Uint8Array(5000));
    room.deliver(MESSAGE_CATALOG.FRAME.id, "nope");
    expect(session.stats.inboundDropped).toBe(2);
    room.deliver("mystery", {});
    expect(session.stats.unknown).toBe(1);
    room.deliver("hello", { serverProtocol: "x" });
    expect(session.stats.controlInvalid).toBe(1);
    room.deliver(MESSAGE_CATALOG.DUST_LOG.id, new Uint8Array([1, 2, 3]));
    expect(seen).toEqual([MESSAGE_CATALOG.DUST_LOG.id, 4]);
    session.dispose();
  });

  it("HELLO saveArchived:true fires onSaveArchived once; a plain HELLO does not", async () => {
    let n = 0;
    const { r, session } = rig({ handlers: { onSaveArchived: () => void n++ } });
    session.start();
    await flush();
    const room = r.rooms.at(-1)!;
    room.deliver("hello", HELLO);
    expect(n).toBe(0);
    room.deliver("hello", { ...HELLO, saveArchived: true });
    expect(n).toBe(1);
    session.dispose();
  });

  it("snapshot inflate in a worker: later FRAMEs wait behind it and apply after the snapshot, in order", async () => {
    const calls: string[] = [];
    const port = new ManualPort();
    const { r, session } = rig({
      expectDustSnapshot: true,
      inflateWorker: () => port,
      handlers: {
        onFrame: (v) => void calls.push(`F${v.serverTick}`),
        onDustSnapshot: () => void calls.push("S"),
      },
    });
    const room = await joinFully(r, session);
    await vi.waitFor(() => expect(session.dustOffload).not.toBeNull()); // loaded on demand
    expect(calls).toEqual(["F100"]);
    for (const b of snapshotBodies()) room.deliver(MESSAGE_CATALOG.DUST_SNAPSHOT.id, b);
    expect(port.jobs).toHaveLength(1);
    expect(session.core.stats.snapshotsApplied).toBe(0);
    room.deliver(MESSAGE_CATALOG.FRAME.id, frames.body(102, false, 3));
    room.deliver(MESSAGE_CATALOG.FRAME.id, frames.body(104, false, 4));
    expect(calls).toEqual(["F100"]); // held behind the inflating snapshot
    expect(session.dustOffload?.held).toBe(2);
    expect(session.phase).toBe("joining");
    port.answer(0);
    expect(calls).toEqual(["F100", "S", "F102", "F104"]);
    expect(session.phase).toBe("joined");
    expect(session.core.stats.snapshotsApplied).toBe(1);
    expect(session.dustOffload).toMatchObject({ offloaded: 1, replayed: 2 });
    session.dispose();
    expect(port.terminated).toBe(true);
  });

  it("a paced snapshot that missed FRAME dust asks for a fresh one after the server's 2 s limit (one resync request)", async () => {
    const port = new ManualPort();
    const { r, session } = rig({ expectDustSnapshot: true, inflateWorker: () => port });
    const room = await joinFully(r, session);
    await vi.waitFor(() => expect(session.dustOffload).not.toBeNull());
    const parts = snapshotBodies();
    expect(parts.length).toBeGreaterThan(1);
    room.deliver(MESSAGE_CATALOG.DUST_SNAPSHOT.id, parts[0]);
    room.deliver(MESSAGE_CATALOG.FRAME.id, strokeFrameBody(102)); // applied now, newer than snapshot version 1
    for (const b of parts.slice(1)) room.deliver(MESSAGE_CATALOG.DUST_SNAPSHOT.id, b);
    port.answer(0);
    expect(session.core.stats.snapshotsApplied).toBe(1);
    expect(session.dustOffload?.gaps).toBe(1);
    const visibility = (): unknown[] => room.sent.filter((m) => m.type === "visibility").map((m) => m.payload);
    await r.advance(1500);
    expect(visibility()).toEqual([]);
    await r.advance(1000);
    expect(visibility()).toEqual([{ hidden: false }]); // the resync request: keyframe + fresh snapshot
    expect(session.phase).toBe("resyncing");
    expect(session.stats.dustGapResyncs).toBe(1);
    session.dispose();
  });

  it("a snapshot without a gap sends no resync; a failing worker factory falls back to the sync inflater", async () => {
    const { r, session } = rig({
      expectDustSnapshot: true,
      inflateWorker: () => {
        throw new Error("no workers here");
      },
    });
    const room = await joinFully(r, session);
    for (const b of snapshotBodies()) room.deliver(MESSAGE_CATALOG.DUST_SNAPSHOT.id, b);
    expect(session.phase).toBe("joined");
    expect(session.dustOffload).toBeNull(); // no worker: no offload, the session inflates inline
    await r.advance(5000);
    expect(room.sent.filter((m) => m.type === "visibility")).toEqual([]);
    expect(session.stats.dustGapResyncs).toBe(0);
    session.dispose();
  });

  it("the offload is off without a Worker, with a custom inflate, or with inflateWorker false", () => {
    expect(rig().session.dustOffload).toBeNull();
    expect(rig({ inflateWorker: false }).session.dustOffload).toBeNull();
  });

  it("feeds the interpolation buffer; updateInterpolation is a no-op outside the room", async () => {
    const { r, session } = rig();
    session.updateInterpolation();
    expect(session.interpolation.started).toBe(false);
    const room = await joinFully(r, session);
    await r.advance(250);
    const ping = room.bytes.find((b) => b.type === MESSAGE_CATALOG.PING.id)!;
    const pong = new Uint8Array(PONG_BODY_BYTES);
    writePongBody({ clientTimeMs: readPingBody(ping.body), serverTick: 104 }, pong);
    r.t += 60;
    room.deliver(MESSAGE_CATALOG.PONG.id, pong);
    room.deliver(MESSAGE_CATALOG.FRAME.id, frames.body(102, false, 3));
    r.t += 300;
    session.updateInterpolation();
    expect(session.interpolation.started).toBe(true);
    expect(session.interpolation.sample(0)).not.toBe(SAMPLE_NONE);
    expect(session.sendInput(new Uint8Array(11))).toBe(true);
    session.dispose();
    expect(session.sendInput(new Uint8Array(11))).toBe(false);
  });
});
