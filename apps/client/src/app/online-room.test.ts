// Online room wiring (M1-W4-T04 hooks) over a fake Colyseus connection: snapshot -> mirror, FRAME -> mirror and
// predictor, INPUT with redundancy -> predictor, DUST_CHECK mismatch -> DUST_REQUEST at most once per spacing, and the
// mirror dust feed. Plus the solo-first rule: the main-chunk launcher never imports the online chunk statically.
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import {
  BEACON_COUNT,
  INPUT_BUTTON_MASK,
  MESSAGE_CATALOG,
  PROTOCOL_VERSION,
  STANDARD_GRID_PARAMS,
  ShiftStateViewSchema,
  type HelloPayload,
  type ShiftStateView,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import {
  FrameWriter,
  createSelfState,
  decodeDustRequest,
  encodeDustCheck,
  encodeSnapshotRaw,
  snapshotSliceCount,
  writeSnapshotSlice,
} from "@moon-cleanup/protocol";
import { createPlotGrid } from "@moon-cleanup/world";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConsumeReservationFn, RoomConnection } from "../net";
import {
  DUST_REQUEST_SPACING_MS,
  HELD_CONTROLS_MAX,
  MirrorDustFeed,
  OnlineRoom,
  createRemoteRoomHost,
  tapFrames,
} from "./online-room";

const CONTRACT = "0190a5b4-1111-4222-8333-444455556666";
const P1 = "0190a5b4-1111-4222-8333-000000000001";
const P2 = "0190a5b4-1111-4222-8333-000000000002";
const HELLO: HelloPayload = { serverProtocol: PROTOCOL_VERSION, serverBuild: "dev", simTickHz: 20, snapshotHz: 10 };
const PLOTS = createPlotGrid(STANDARD_GRID_PARAMS).count;
const flush = async (): Promise<void> => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};

class FakeRoom implements RoomConnection {
  readonly handlers = new Map<string | number, (p: never) => void>();
  readonly bytes: { type: number; body: Uint8Array }[] = [];
  readonly sent: { type: string; payload: unknown }[] = [];
  readonly sessionId = "s";
  stateCb: ((state: never) => void) | undefined;
  onMessage(type: string | number, cb: (p: never) => void): void {
    this.handlers.set(type, cb);
  }
  onStateChange(cb: (state: never) => void): void {
    this.stateCb = cb;
  }
  patch(state: unknown): void {
    (this.stateCb as ((s: unknown) => void) | undefined)?.(state);
  }
  onDrop(): void {}
  onReconnect(): void {}
  onLeave(): void {}
  send(type: string, payload: unknown): void {
    this.sent.push({ type, payload });
  }
  sendBytes(type: number, body: Uint8Array): void {
    this.bytes.push({ type, body: body.slice() });
  }
  leave(): void {}
  deliver(type: string | number, payload: unknown): void {
    (this.handlers.get(type) as ((p: unknown) => void) | undefined)?.(payload);
  }
}

function frameBody(tick: number, keyframe: boolean, ack: number, px: number): Uint8Array {
  const w = new FrameWriter();
  w.begin(tick, ack, 1, keyframe);
  const self = createSelfState();
  self.px = px;
  w.writeSelf(self);
  const n = w.finish();
  return w.buffer.slice(1, n);
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
  const deflated = new Uint8Array(deflateRawSync(raw, { level: 6 }));
  const out: Uint8Array[] = [];
  for (let i = 0; i < snapshotSliceCount(deflated.length); i++) {
    const buf = new Uint8Array(4200);
    const n = writeSnapshotSlice(deflated, i, 7, buf);
    out.push(buf.slice(1, n));
  }
  return out;
}

function input(seq: number): SimInputCommand {
  return { seq, moveX: 0, moveY: 127, yaw: 0, pitch: 0, buttons: INPUT_BUTTON_MASK.toolPrimary, toolParam: 128 };
}

// Every `OnlineRoom` builds the standard plot grid (163842 plots, ~1.3 s of CPU alone, 2 to 3 s per test): under the
// load of a parallel run the default 5 s timeout was hit about once in ten runs, so the budget is explicit.
const ROOM_TEST_TIMEOUT_MS = 60_000;

describe("online room wiring", { timeout: ROOM_TEST_TIMEOUT_MS }, () => {
  let t = 0;
  let poll: (() => void) | null = null;
  let rooms: FakeRoom[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
    poll = null;
    rooms = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function joined(): Promise<{ room: OnlineRoom; conn: FakeRoom }> {
    const consume: ConsumeReservationFn = () => {
      const r = new FakeRoom();
      rooms.push(r);
      return Promise.resolve(r);
    };
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ reservation: { name: "shift", sessionId: "s", roomId: "r", processId: "p" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const room = new OnlineRoom({
      httpUrl: "http://srv",
      wsUrl: "ws://srv",
      clientBuild: "test",
      contractId: CONTRACT,
      auth: { getAccessToken: () => Promise.resolve("token") },
      wakeProbe: false,
      consume,
      fetch: fetchFn as unknown as typeof fetch,
      now: () => t,
      setInterval: (fn) => {
        poll = fn;
        return 1;
      },
      clearInterval: () => {
        poll = null;
      },
    });
    room.start();
    await flush();
    const conn = rooms.at(-1)!;
    conn.deliver("hello", HELLO);
    conn.deliver(MESSAGE_CATALOG.FRAME.id, frameBody(100, true, 0, 1));
    for (const s of snapshotBodies()) conn.deliver(MESSAGE_CATALOG.DUST_SNAPSHOT.id, s);
    await flush();
    return { room, conn };
  }

  it("snapshot fills the mirror, the keyframe starts prediction, frames reconcile, inputs are predicted", async () => {
    const { room, conn } = await joined();
    expect(room.session.phase).toBe("joined");
    expect(room.dust.ready).toBe(true);
    expect(room.stats.snapshotsInstalled).toBe(1);
    expect(room.predictor.ready).toBe(true);
    expect(room.stats.keyframes).toBe(1);

    room.sendInput(input(1));
    room.sendInput(input(2));
    const inputs = conn.bytes.filter((b) => b.type === MESSAGE_CATALOG.INPUT.id);
    // Body without the type byte: count + 10 B per input; the second message carries the previous input too.
    expect(inputs.map((b) => b.body.length)).toEqual([11, 21]);
    expect(inputs[1]!.body[0]).toBe(2);
    expect(room.stats.inputsSent).toBe(2);
    const predictedZ = room.predictor.state.pz;

    conn.deliver(MESSAGE_CATALOG.FRAME.id, frameBody(102, false, 1, 1));
    expect(room.predictor.stats.reconciles).toBe(1);
    expect(room.predictor.stats.replayed).toBe(1); // input 2 is replayed on top of the ack of input 1
    expect(Number.isFinite(predictedZ)).toBe(true);
    expect(room.stats.framesApplied).toBe(2);
    room.frame(16);
    room.dispose();
    expect(poll).toBeNull();
  });

  it("a DUST_CHECK mismatch sends one DUST_REQUEST per spacing, without its type byte", async () => {
    const { room, conn } = await joined();
    const out = new Uint8Array(64);
    const n = encodeDustCheck(
      { mode: "detail", chunkId: 0, plots: [{ plotId: 5 as never, ledgerVersion: 1, hash: 1 }] },
      out,
    );
    expect(n).toBeGreaterThan(0);
    conn.deliver(MESSAGE_CATALOG.DUST_CHECK.id, out.slice(1, n));
    expect(room.dust.wantedCount).toBe(1);
    const requests = (): Uint8Array[] =>
      conn.bytes.filter((b) => b.type === MESSAGE_CATALOG.DUST_REQUEST.id).map((b) => b.body);

    t = 10_000;
    poll?.();
    poll?.();
    expect(requests()).toHaveLength(1);
    const msg = new Uint8Array(requests()[0]!.length + 1);
    msg[0] = MESSAGE_CATALOG.DUST_REQUEST.id;
    msg.set(requests()[0]!, 1);
    expect(decodeDustRequest(msg, PLOTS)).toEqual({ kind: "plots", plotIds: [5] });

    t += DUST_REQUEST_SPACING_MS - 1;
    poll?.();
    expect(requests()).toHaveLength(1);
    t += 1;
    poll?.();
    expect(requests()).toHaveLength(2);
    expect(room.stats.dustRequestsSent).toBe(2);
    room.dispose();
  });

  it("own Schema equippedTool drives the predictor's tool, once per change; others' entries are ignored", async () => {
    const { room, conn } = await joined();
    const setTool = vi.spyOn(room.predictor, "setTool");
    const state = (own: number, other: number): unknown => ({
      players: new Map([
        ["s", { equippedTool: own }],
        ["x", { equippedTool: other }],
      ]),
    });
    conn.patch(state(2, 0));
    conn.patch(state(2, 1)); // only another player's tool changed
    conn.patch(state(3, 1));
    conn.patch({ players: new Map() }); // own entry gone (leaving): no call
    expect(setTool.mock.calls).toEqual([[2], [3]]);
    expect(room.session.equippedTool).toBe(3);
    room.dispose();
  });

  it("late join: the first Schema state's nearParcelsCollected marks parcels; finds then wait for the mask", async () => {
    const { room, conn } = await joined();
    const ro = room.readouts;
    expect(ro.collectedMask).toBe(0);
    // Older server: no field -> nothing changes, the event fallback stays in charge.
    conn.patch({ players: new Map([["s", { equippedTool: 0 }]]) });
    expect(ro.authoritativeMask).toBe(false);
    // First full state of a late joiner on a v1.1 server: parcels 0, 2 and 5 were collected before the join.
    conn.patch({ players: new Map([["s", { equippedTool: 0 }]]), nearParcelsCollected: 0b100101 });
    expect(ro.authoritativeMask).toBe(true);
    expect(ro.collectedMask).toBe(0b100101);
    const out = { x: 0, y: 0, z: 0 };
    expect([0, 1, 2, 3, 4, 5].map((k) => ro.nearParcel(k, out))).toEqual([true, false, true, false, false, true]);
    // A find event no longer guesses (the next patch carries the authoritative bit).
    room.onSimEvents({
      events: [{ name: "collectible.found", payload: { tick: 9, kind: "stray_cargo", id: "near_parcel" } }],
    });
    expect(ro.collectedMask).toBe(0b100101);
    expect(ro.stats.skipped).toBe(1);
    conn.patch({ players: new Map([["s", { equippedTool: 0 }]]), nearParcelsCollected: 0b100111 });
    expect(ro.nearParcel(1, out)).toBe(true);
    // The session's own Schema handling still runs through the tapped onStateChange.
    expect(room.session.equippedTool).toBe(0);
    room.dispose();
  });

  it("stale room: a late state or FRAME from a left connection never reaches the read-outs or the host", async () => {
    const { room, conn } = await joined();
    const host = createRemoteRoomHost(room, CONTRACT);
    const views: ShiftStateView[] = [];
    host.onShiftState((s) => views.push(s));
    let frames = 0;
    host.onFrame((f) => {
      frames++;
      f.release();
    });
    conn.patch({ nearParcelsCollected: 0b1 });
    conn.deliver(MESSAGE_CATALOG.FRAME.id, frameBody(104, false, 0, 1));
    expect(room.readouts.collectedMask).toBe(1);
    expect([views.length, frames]).toEqual([1, 1]);
    room.leave(); // the session leaves the (tapped) connection
    conn.patch({ nearParcelsCollected: 0b11 }); // queued patch the SDK dispatches after leave
    conn.deliver(MESSAGE_CATALOG.FRAME.id, frameBody(106, false, 0, 1));
    expect(room.readouts.collectedMask).toBe(1);
    expect([views.length, frames]).toEqual([1, 1]);
    room.dispose();
  });

  it("stale room: a late state after dispose is ignored", async () => {
    const { room, conn } = await joined();
    room.dispose();
    conn.patch({ nearParcelsCollected: 0b111 });
    expect(room.readouts.collectedMask).toBe(0);
    expect(room.readouts.authoritativeMask).toBe(false);
  });

  it("RemoteRoomHost: Schema state -> valid ShiftStateView, mask copied (absent on an older server)", async () => {
    const { room, conn } = await joined();
    const host = createRemoteRoomHost(room, CONTRACT);
    const views: ShiftStateView[] = [];
    // No listener yet: nothing is built.
    conn.patch({ nearParcelsCollected: 0 });
    expect(host.stats.shiftStatesEmitted).toBe(0);
    host.onShiftState((s) => views.push(s));
    const schemaLike = {
      contractId: CONTRACT,
      shiftType: "private",
      protocolVersion: PROTOCOL_VERSION,
      simTickHz: 20,
      snapshotHz: 10,
      walletLumens: 12.5,
      shinePolished: 3,
      plotCount: PLOTS,
      sharedUpgrades: new Map([["node.broad_strokes", 2]]),
      suitGear: new Map<string, number>(),
      visitedOutposts: 1,
      beacons: [{ plotId: 4, active: true }],
      players: new Map([
        ["x", { playerId: P2, displayName: "Bob", slot: 1, role: "staff", equippedCosmetics: [], equippedTool: 1 }],
        ["s", { playerId: P1, displayName: "Ann", slot: 0, role: "holder", toolsOwned: 3, equippedTool: 0 }],
      ]),
      vehicles: new Map(),
      robotCounts: new Map([["robot.sandpiper", 2]]),
      permissions: { tempCanBuild: true, tempCanSpendShared: false, tempCanDriveShared: false },
      fulfilled: false,
      nearParcelsCollected: 0b100101,
    };
    conn.patch(schemaLike);
    expect(views).toHaveLength(1);
    const v = views[0]!;
    expect(ShiftStateViewSchema.safeParse(v).success).toBe(true);
    expect(v.nearParcelsCollected).toBe(0b100101);
    expect(v.players.map((p) => p.displayName)).toEqual(["Ann", "Bob"]);
    expect(v.beacons).toHaveLength(BEACON_COUNT);
    expect(v.beacons[0]).toEqual({ plotId: 4, active: true });
    expect(v.sharedUpgrades).toEqual({ "node.broad_strokes": 2 });
    expect(v.robotCounts).toEqual({ "robot.sandpiper": 2 });
    expect(v.tick).toBe(room.session.core.view.serverTick);
    // Pre-v1.1 server: the field stays absent ("unknown").
    const { nearParcelsCollected: _omit, ...older } = schemaLike;
    void _omit;
    conn.patch(older);
    expect("nearParcelsCollected" in views[1]!).toBe(false);
    expect(ShiftStateViewSchema.safeParse(views[1]).success).toBe(true);
    // After close nothing is emitted.
    await host.close("clock_out");
    conn.patch(schemaLike);
    expect(views).toHaveLength(2);
  });

  it("RemoteRoomHost: sendIntent sends purchase / select_tool controls; sim_events feed onEvent; dropped when left", async () => {
    const { room, conn } = await joined();
    const host = createRemoteRoomHost(room, CONTRACT);
    const events: string[] = [];
    host.onEvent((e) => events.push(e.name));
    const requestId = "0190a5b4-1111-4222-8333-0000000000aa" as never;
    host.sendIntent({ kind: "purchase", requestId, itemId: "tool.lane_broom" as never });
    host.sendIntent({ kind: "select_tool", slot: 2 });
    const controls = (): unknown[] =>
      conn.sent.filter((m) => m.type === MESSAGE_CATALOG.PURCHASE.id || m.type === MESSAGE_CATALOG.SELECT_TOOL.id);
    expect(controls()).toEqual([
      { type: MESSAGE_CATALOG.PURCHASE.id, payload: { requestId, itemId: "tool.lane_broom" } },
      { type: MESSAGE_CATALOG.SELECT_TOOL.id, payload: { slot: 2 } },
    ]);
    expect(host.stats.intentsSent).toBe(2);
    // A validated sim_events batch through the session's control path reaches every onEvent listener in order.
    conn.deliver(MESSAGE_CATALOG.SIM_EVENTS.id, {
      events: [
        {
          name: "purchase.completed",
          payload: { tick: 9, actorSlot: 0, itemId: "tool.lane_broom", priceLm: 5, walletAfter: 1 },
        },
        { name: "collectible.found", payload: { tick: 9, kind: "stray_cargo", id: "near_parcel" } },
      ],
    });
    expect(events).toEqual(["purchase.completed", "collectible.found"]);
    expect(host.stats.eventsEmitted).toBe(2);
    room.leave();
    host.sendIntent({ kind: "select_tool", slot: 1 });
    expect(controls()).toHaveLength(2);
    expect([host.stats.intentsDropped, room.stats.controlsDropped]).toEqual([1, 1]);
    await host.close("clock_out");
    room.onSimEvents({ events: [{ name: "collectible.found", payload: { tick: 10 } }] });
    expect(events).toHaveLength(2);
  });

  it("controls issued while resyncing are held, flushed in order once joined, and dropped if the session closes", async () => {
    const { room, conn } = await joined();
    const controls = (): unknown[] =>
      conn.sent.filter((m) => m.type === MESSAGE_CATALOG.PURCHASE.id || m.type === MESSAGE_CATALOG.SELECT_TOOL.id);
    expect(room.session.core.requestSnapshotResync(t)).toBe(true);
    expect(room.session.phase).toBe("resyncing");
    expect(room.sendControl(MESSAGE_CATALOG.SELECT_TOOL.id, { slot: 3 })).toBe(true);
    expect(room.sendControl(MESSAGE_CATALOG.PURCHASE.id, { requestId: "r1", itemId: "tool.lane_broom" })).toBe(true);
    expect(controls()).toHaveLength(0); // nothing on a possibly dead socket yet
    expect(room.stats.controlsHeld).toBe(2);
    // Bounded: beyond the cap the call is refused visibly (false, counted).
    for (let i = 0; i < HELD_CONTROLS_MAX - 2; i++) room.sendControl(MESSAGE_CATALOG.SELECT_TOOL.id, { slot: 1 });
    expect(room.sendControl(MESSAGE_CATALOG.SELECT_TOOL.id, { slot: 1 })).toBe(false);
    expect(room.stats.controlsDropped).toBe(1);
    // The keyframe + snapshot end the resync: held controls go out in order.
    conn.deliver(MESSAGE_CATALOG.FRAME.id, frameBody(110, true, 0, 1));
    for (const s of snapshotBodies()) conn.deliver(MESSAGE_CATALOG.DUST_SNAPSHOT.id, s);
    expect(room.session.phase).toBe("joined");
    expect(controls()).toHaveLength(HELD_CONTROLS_MAX);
    expect(controls()[0]).toEqual({ type: MESSAGE_CATALOG.SELECT_TOOL.id, payload: { slot: 3 } });
    expect(controls()[1]).toEqual({
      type: MESSAGE_CATALOG.PURCHASE.id,
      payload: { requestId: "r1", itemId: "tool.lane_broom" },
    });
    expect(room.stats.controlsSent).toBe(HELD_CONTROLS_MAX);
    // Held controls are not sent twice, and a closing session drops what is still held.
    expect(room.session.core.requestSnapshotResync(t + 5000)).toBe(true);
    expect(room.sendControl(MESSAGE_CATALOG.SELECT_TOOL.id, { slot: 2 })).toBe(true);
    room.leave();
    expect(controls()).toHaveLength(HELD_CONTROLS_MAX);
    expect(room.stats.controlsDropped).toBe(2);
    room.dispose();
  });

  it("DUST_REQUEST is not sent (nor counted) when the session is not joined", async () => {
    const { room, conn } = await joined();
    const out = new Uint8Array(64);
    const n = encodeDustCheck(
      { mode: "detail", chunkId: 0, plots: [{ plotId: 5 as never, ledgerVersion: 1, hash: 1 }] },
      out,
    );
    conn.deliver(MESSAGE_CATALOG.DUST_CHECK.id, out.slice(1, n));
    room.leave();
    t = 10_000;
    poll?.();
    expect(conn.bytes.filter((b) => b.type === MESSAGE_CATALOG.DUST_REQUEST.id)).toHaveLength(0);
    expect(room.stats.dustRequestsSent).toBe(0);
    expect(room.session.sendDustRequest(new Uint8Array(4))).toBe(false);
    room.dispose();
  });

  it("the mirror feed rebuilds after a snapshot and forwards Polished plots from the dirty list", async () => {
    const { room } = await joined();
    const calls: string[] = [];
    room.feed.bind({
      onStroke: () => calls.push("stroke"),
      onLedgerZero: () => calls.push("zero"),
      onPolished: (p) => calls.push(`polished:${p}`),
      rebuildAll: () => calls.push("rebuild"),
    });
    expect(calls).toEqual(["rebuild"]);
    room.feed.invalidate();
    room.feed.pump();
    expect(calls).toEqual(["rebuild", "rebuild"]);
    room.dust.ledger.installPolished(42);
    room.feed.pump();
    expect(calls).toContain("polished:42");
    expect(room.dust.ledger.dirtyPlotCount).toBe(0);
    expect(room.feed).toBeInstanceOf(MirrorDustFeed);
    room.dispose();
  });
});

describe("tapFrames stale-room guard", () => {
  it("a replaced connection (live() false) and a connection whose onLeave fired never feed the taps", () => {
    const states: unknown[] = [];
    const bodies: Uint8Array[] = [];
    let current = 1;
    const make = (gen: number): { fake: FakeRoom; tapped: RoomConnection; leaveCb: (code: number) => void } => {
      const fake = new FakeRoom();
      let leaveCb: (code: number) => void = () => undefined;
      (fake as { onLeave: (cb: (code: number) => void) => void }).onLeave = (cb) => {
        leaveCb = cb;
      };
      const tapped = tapFrames(
        fake,
        (b) => bodies.push(b),
        (s) => states.push(s),
        () => gen === current,
      );
      const sessionStates: unknown[] = [];
      tapped.onStateChange?.((s: never) => sessionStates.push(s));
      tapped.onMessage(MESSAGE_CATALOG.FRAME.id, () => undefined);
      tapped.onLeave(() => undefined);
      return { fake, tapped, leaveCb: (c) => leaveCb(c) };
    };
    const first = make(1);
    first.fake.patch({ a: 1 });
    first.fake.deliver(MESSAGE_CATALOG.FRAME.id, new Uint8Array(2));
    expect([states.length, bodies.length]).toEqual([1, 1]);
    current = 2; // reconnect with a new seat: the second connection replaces the first
    const second = make(2);
    first.fake.patch({ a: 2 }); // late patch of the replaced room
    first.fake.deliver(MESSAGE_CATALOG.FRAME.id, new Uint8Array(2));
    expect([states.length, bodies.length]).toEqual([1, 1]);
    second.fake.patch({ b: 1 });
    expect(states).toEqual([{ a: 1 }, { b: 1 }]);
    second.leaveCb(4000); // server closed it
    second.fake.patch({ b: 2 });
    expect(states).toHaveLength(2);
  });
});

describe("solo first", () => {
  it("only online-launch.ts loads the online chunk, with a dynamic import; boot.ts and modules.ts never import it", () => {
    const read = (f: string): string => readFileSync(new URL(f, import.meta.url), "utf8");
    const launch = read("./online-launch.ts");
    expect(launch).toContain('await import("./online-room")');
    expect(launch).not.toMatch(/^import (?!type)[^;]*"\.\/online-room"/m);
    for (const f of ["./boot.ts", "./modules.ts"]) {
      expect(read(f)).not.toMatch(/from "\.\/online-room"/);
      expect(read(f)).not.toMatch(/^import (?!type)[^;]*"\.\/online-launch"[^;]*OnlineRoom\b/m);
    }
  });
});
