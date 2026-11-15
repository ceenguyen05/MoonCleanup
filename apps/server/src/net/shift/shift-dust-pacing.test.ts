// Snapshot slice pacing (M1 snapshot-cap review, open mismatch): a deflated snapshot above the socket backpressure
// headroom must reach a slow client WITHOUT closing the socket, a stalled client is still dropped by the existing
// backpressure rule, and nothing here costs the other clients a tick. The socket is modelled by a byte counter that
// drains at a fixed rate; the transport sweep rule is the real `terminateBackpressured`.
import {
  STANDARD_GRID_PARAMS,
  DUST_MESSAGE_SLICE_MAX_BYTES,
  type ContractId,
  type PlayerId,
} from "@moon-cleanup/shared";
import {
  DUST_LEDGER_ID,
  DUST_SNAPSHOT_ID,
  DUST_SNAPSHOT_MAX_SLICES,
  encodeInput,
  type MutableInput,
} from "@moon-cleanup/protocol";
import { loadGameData } from "@moon-cleanup/game-data";
import { createPlotGrid } from "@moon-cleanup/world";
import type { SimWorld } from "@moon-cleanup/sim";
import { describe, expect, it, vi } from "vitest";
import { WS_BULK_SEND_CEILING_BYTES, WS_MAX_BACKPRESSURE_BYTES, WS_SEND_OVERHEAD_BYTES } from "../limits";
import { socketBufferedBytes } from "../socket-buffer";
import { terminateBackpressured } from "../ws-transport";
import { ShiftCore, type ShiftSink } from "./shift-core";
import type { DustSnapshotBuild } from "./shift-dust";

const CONTRACT = "00000000-0000-4000-8000-0000000000e1" as ContractId;
const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: { heightAtXYZ: () => 0 } };
const HZ = 20;
const FRAME_TICKS = 2;

function player(i: number) {
  return {
    playerId: `00000000-0000-4000-8000-0000000000${(0xc0 + i).toString(16)}` as PlayerId,
    displayName: `Bot${i}`,
    role: i === 0 ? ("holder" as const) : ("staff" as const),
  };
}

/** A fabricated snapshot of `count` full slices (the pacing never looks inside a slice). */
function fakeSnapshot(count: number): DustSnapshotBuild {
  const slices: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const body = new Uint8Array(DUST_MESSAGE_SLICE_MAX_BYTES - 1);
    body[0] = i & 0xff; // slice index marker
    slices.push(body);
  }
  return {
    slices,
    rawBytes: count * 8192,
    deflatedBytes: count * DUST_MESSAGE_SLICE_MAX_BYTES,
    ledgers: 0,
    buildMs: 0,
  };
}

/** One client socket: bytes sent add to `bufferedAmount`, `drain` removes them per tick. */
class FakeSocket {
  bufferedAmount = 0;
  peak = 0;
  sliceMarks: number[] = [];
  ledgers = 0;
  frames = 0;
  terminated = false;
  readonly terminate = vi.fn(() => {
    this.terminated = true;
  });
  constructor(readonly drainPerTick: number) {}
  push(n: number): void {
    this.bufferedAmount += n + WS_SEND_OVERHEAD_BYTES;
    this.peak = Math.max(this.peak, this.bufferedAmount);
  }
  drain(): void {
    this.bufferedAmount = Math.max(0, this.bufferedAmount - this.drainPerTick);
  }
}

function setup(sockets: (FakeSocket | undefined)[], slicesInSnapshot: number) {
  const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: HZ }, 0);
  const real = core.dust.buildSnapshot.bind(core.dust);
  // Seat 0 gets the oversized fabricated snapshot; any other seat the real (tiny, pristine moon) one.
  let calls = 0;
  core.dust.buildSnapshot = (px, py, pz, version, sent, radius) => {
    const n = calls++;
    return n === 0 ? fakeSnapshot(slicesInSnapshot) : real(px, py, pz, version, sent, radius);
  };
  const sink: ShiftSink = {
    frame(seat, body) {
      const s = sockets[seat];
      if (s !== undefined) {
        s.push(body.byteLength + 1);
        s.frames++;
      }
    },
    events() {},
    bytes(seat, typeId, body) {
      const s = sockets[seat];
      if (s === undefined) return;
      s.push(body.byteLength + 1);
      if (typeId === DUST_SNAPSHOT_ID) s.sliceMarks.push(body[0]!);
      else if (typeId === DUST_LEDGER_ID) s.ledgers++;
    },
    buffered: (seat) => sockets[seat]?.bufferedAmount ?? 0,
  };
  return { core, sink };
}

function runTicks(core: ShiftCore, sink: ShiftSink, sockets: (FakeSocket | undefined)[], ticks: number) {
  for (let t = 0; t < ticks; t++) {
    core.step(sink);
    // The transport sweep (1 s in production, every tick here: strictly harsher) and the network drain.
    for (const s of sockets) {
      if (s === undefined || s.terminated) continue;
      terminateBackpressured([s], WS_MAX_BACKPRESSURE_BYTES);
      s.drain();
    }
  }
}

describe("DUST_SNAPSHOT slice pacing against the socket buffer", () => {
  it("the ceiling leaves room for the frames and ledgers that keep flowing under the backpressure cap", () => {
    expect(WS_BULK_SEND_CEILING_BYTES).toBeLessThan(WS_MAX_BACKPRESSURE_BYTES);
    expect(WS_MAX_BACKPRESSURE_BYTES - WS_BULK_SEND_CEILING_BYTES).toBeGreaterThanOrEqual(16 * 1024);
    // The old failure: the 64-slice ceiling queued in one tick is above the cap; the paced head is not.
    expect(DUST_SNAPSHOT_MAX_SLICES * DUST_MESSAGE_SLICE_MAX_BYTES).toBeGreaterThan(WS_MAX_BACKPRESSURE_BYTES);
  });

  it("a snapshot above the backpressure cap reaches a slow client complete, in order, without a close", () => {
    const slow = new FakeSocket(6 * 1024); // 120 KB/s: slower than the 261 KB snapshot, so it must be paced
    const sockets = [slow];
    const { core, sink } = setup(sockets, DUST_SNAPSHOT_MAX_SLICES);
    core.addSeat(player(0), 0);
    runTicks(core, sink, sockets, 400);
    expect(slow.terminated).toBe(false);
    expect(slow.terminate).not.toHaveBeenCalled();
    expect(slow.peak).toBeLessThanOrEqual(WS_MAX_BACKPRESSURE_BYTES);
    // Every slice, once, in order.
    expect(slow.sliceMarks).toEqual(Array.from({ length: DUST_SNAPSHOT_MAX_SLICES }, (_, i) => i));
    expect(core.counters.dustSnapshotsSent).toBe(1);
    expect(core.counters.dustSnapshotsPaced).toBe(1);
    // Done: frames still flow and no snapshot is pending.
    expect(slow.frames).toBeGreaterThan(100);
  });

  it("an unconstrained client takes a typical snapshot in one tick, exactly as before", () => {
    const fast = new FakeSocket(1e9);
    const sockets = [fast];
    const { core, sink } = setup(sockets, 6); // about 24 KB
    core.addSeat(player(0), 0);
    runTicks(core, sink, sockets, FRAME_TICKS + 1);
    expect(fast.sliceMarks).toEqual([0, 1, 2, 3, 4, 5]);
    expect(core.counters.dustSnapshotsPaced).toBe(0);
    expect(core.counters.dustSnapshotPauses).toBe(0);
  });

  it("a sink without a buffered() reading still never sends more than the ceiling in one tick", () => {
    const sockets: FakeSocket[] = [new FakeSocket(1e9)];
    const { core, sink } = setup(sockets, DUST_SNAPSHOT_MAX_SLICES);
    delete (sink as { buffered?: unknown }).buffered;
    core.addSeat(player(0), 0);
    let before = 0;
    let perTickMax = 0;
    for (let t = 0; t < 12; t++) {
      core.step(sink);
      perTickMax = Math.max(perTickMax, sockets[0]!.sliceMarks.length - before);
      before = sockets[0]!.sliceMarks.length;
    }
    const perSlice = DUST_MESSAGE_SLICE_MAX_BYTES + WS_SEND_OVERHEAD_BYTES;
    expect(perTickMax).toBeLessThanOrEqual(Math.floor(WS_BULK_SEND_CEILING_BYTES / perSlice));
    expect(sockets[0]!.sliceMarks).toHaveLength(DUST_SNAPSHOT_MAX_SLICES);
  });

  it("a stalled client stops receiving slices at the ceiling and the existing backpressure rule still drops it", () => {
    const stalled = new FakeSocket(0); // never drains
    const sockets = [stalled];
    const { core, sink } = setup(sockets, DUST_SNAPSHOT_MAX_SLICES);
    core.addSeat(player(0), 0);
    runTicks(core, sink, sockets, 20);
    // Slices stop once the bulk ceiling is reached: far fewer than all 64, and the socket is not closed by them.
    const sent = stalled.sliceMarks.length;
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThan(DUST_SNAPSHOT_MAX_SLICES);
    expect(stalled.bufferedAmount).toBeLessThanOrEqual(WS_BULK_SEND_CEILING_BYTES + 4 * 1024);
    expect(stalled.terminated).toBe(false);
    const pausesSoFar = core.counters.dustSnapshotPauses;
    expect(pausesSoFar).toBeGreaterThan(0);
    // The frames keep arriving; once the stalled buffer passes the cap the transport sweep terminates it.
    runTicks(core, sink, sockets, 4000);
    expect(stalled.terminated).toBe(true);
    expect(stalled.terminate).toHaveBeenCalledTimes(1);
    expect(stalled.sliceMarks.length).toBe(sent); // nothing more was pushed meanwhile
  });

  it("a slow snapshot does not delay or alter the other seats' frames", () => {
    const slow = new FakeSocket(0);
    const other = new FakeSocket(1e9);
    const sockets = [slow, other];
    const { core, sink } = setup(sockets, DUST_SNAPSHOT_MAX_SLICES);
    core.addSeat(player(0), 0);
    core.addSeat(player(1), 0);
    runTicks(core, sink, sockets, 100);
    expect(other.frames).toBe(slow.frames);
    expect(other.terminated).toBe(false);
    // The other seat got its own (real) snapshot in full while seat 0 sits paused.
    expect(other.sliceMarks.length).toBeGreaterThan(0);
    expect(core.counters.dustSnapshotsSent).toBe(2);
  });

  it("a resync request supersedes a half-sent snapshot instead of finishing it", () => {
    const slow = new FakeSocket(0);
    const sockets = [slow];
    const { core, sink } = setup(sockets, DUST_SNAPSHOT_MAX_SLICES);
    core.addSeat(player(0), 0);
    runTicks(core, sink, sockets, 10);
    const partial = slow.sliceMarks.length;
    expect(partial).toBeLessThan(DUST_SNAPSHOT_MAX_SLICES);
    core.setHidden(0, false); // resync
    slow.bufferedAmount = 0; // the socket recovered
    runTicks(core, sink, sockets, 60);
    // The new (real, small) snapshot went out after the 2 s minimum interval; the old tail never did.
    expect(core.counters.dustSnapshotsSent).toBe(2);
    expect(slow.sliceMarks.length).toBeLessThan(DUST_SNAPSHOT_MAX_SLICES + partial);
    expect(slow.sliceMarks.slice(partial).every((m, i) => m === i)).toBe(true);
  });
});

describe("ledgers that change while a snapshot is paced out", () => {
  it("are re-sent as DUST_LEDGER after the last slice (the client skips the strokes in between)", () => {
    const sweeper = new FakeSocket(1e9);
    const slow = new FakeSocket(0);
    const sockets = [sweeper, slow];
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: HZ }, 0);
    core.addSeat(player(0), 0);
    const drive = (ticks: number, from: number) => {
      for (let t = from; t < from + ticks; t++) {
        const a: MutableInput = {
          seq: t + 1,
          moveX: 0,
          moveY: 127,
          yaw: (t * 60) & 0xffff,
          pitch: 0,
          buttons: 1 << 3,
          toolParam: 128,
        };
        const buf = new Uint8Array(32);
        const n = encodeInput(buf, a);
        core.receiveInput(0, buf.slice(1, n), t * 50);
        runTicks(core, sink, sockets, 1);
      }
    };
    const sink: ShiftSink = {
      frame: (seat, body) => sockets[seat]?.push(body.byteLength + 1),
      events() {},
      bytes(seat, typeId, body) {
        const s = sockets[seat]!;
        s.push(body.byteLength + 1);
        if (typeId === DUST_SNAPSHOT_ID) s.sliceMarks.push(body[0]!);
        else if (typeId === DUST_LEDGER_ID) s.ledgers++;
      },
      buffered: (seat) => sockets[seat]?.bufferedAmount ?? 0,
    };
    drive(200, 0); // the sweeper opens plots around the spawn
    expect(core.ledger.ledgerCount).toBeGreaterThan(0);
    // The late joiner's snapshot is the real one (marks `sent`, counts the ledgers) with oversized fake slices.
    const real = core.dust.buildSnapshot.bind(core.dust);
    core.dust.buildSnapshot = (px, py, pz, version, sent, radius) => {
      const snap = real(px, py, pz, version, sent, radius);
      return snap === null ? null : { ...snap, slices: fakeSnapshot(40).slices };
    };
    core.addSeat(player(1), 200 * 50);
    drive(30, 200); // the slow seat's snapshot starts and stalls; the sweeper keeps changing ledgers
    expect(slow.sliceMarks.length).toBeGreaterThan(0);
    expect(slow.sliceMarks.length).toBeLessThan(40);
    expect(slow.ledgers).toBe(0);
    slow.bufferedAmount = 0;
    Object.assign(slow, { drainPerTick: 1e9 });
    drive(80, 230);
    expect(slow.sliceMarks).toHaveLength(40);
    expect(core.counters.dustSnapshotCatchUps).toBeGreaterThan(0);
    expect(slow.ledgers).toBeGreaterThanOrEqual(core.counters.dustSnapshotCatchUps);
    expect(slow.terminated).toBe(false);
  });
});

describe("socketBufferedBytes", () => {
  it("reads ws bufferedAmount and uWS getBufferedAmount, and degrades to 0", () => {
    expect(socketBufferedBytes({ ref: { bufferedAmount: 1234 } })).toBe(1234);
    expect(socketBufferedBytes({ ref: { ws: { getBufferedAmount: () => 77 } } })).toBe(77);
    expect(
      socketBufferedBytes({
        ref: {
          ws: {
            getBufferedAmount: () => {
              throw new Error("closed");
            },
          },
        },
      }),
    ).toBe(0);
    expect(socketBufferedBytes(undefined)).toBe(0);
    expect(socketBufferedBytes({})).toBe(0);
    expect(socketBufferedBytes({ ref: null })).toBe(0);
    expect(socketBufferedBytes({ ref: {} })).toBe(0);
  });
});
