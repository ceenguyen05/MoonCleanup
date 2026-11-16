// The ShiftRoom's dust ledger (M1-W4-T03): the room builds the same ledger the Solo host builds (createRoomDustLedger),
// `plot.opened` / `plot.polished` reach the sim events sink (and so the wire `sim_events` batches), the dirty list is
// emptied per tick, and the 6-player tick stays inside the budget with the real ledger.
import {
  MAX_PLAYERS_PER_ROOM,
  STANDARD_GRID_PARAMS,
  type ContractId,
  type IntentResult,
  type PlayerId,
  type RequestId,
  type WireSimEvent,
} from "@moon-cleanup/shared";
import { encodeInput, type MutableInput } from "@moon-cleanup/protocol";
import { loadGameData } from "@moon-cleanup/game-data";
import { createPlotGrid, WorldDustLedger } from "@moon-cleanup/world";
import { MoonRoomSim, SIM_CHECKPOINT_META_MAX_BYTES, createRoomDustLedger, type SimWorld } from "@moon-cleanup/sim";
import { ROOM_SIM_META_MAX_BYTES } from "@moon-cleanup/db";
import { describe, expect, it } from "vitest";
import { ShiftCore, type ShiftSink } from "./shift-core";
import { SHIFT_LEDGER_HEADROOM_SLOTS, createShiftLedger } from "./shift-ledger";
import { percentiles } from "./shift-room";
import { MemoryShiftDustStore, SHIFT_RESTORED_WALLET_MAX_LM, ShiftDustPersistence } from "./shift-persistence";
import { nearParcelsMask } from "./shift-state";

const CONTRACT = "00000000-0000-4000-8000-0000000000c7" as ContractId;
const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: { heightAtXYZ: () => 0 } };
/** The tick budget of the server env default (apps/server/src/ops/env.ts TICK_BUDGET_MS). */
const TICK_BUDGET_MS = 3.5;
const SWEEP = 1 << 3;

function player(i: number) {
  return {
    playerId: `00000000-0000-4000-8000-0000000000${(0xa0 + i).toString(16)}` as PlayerId,
    displayName: `Bot${i}`,
    role: i === 0 ? ("holder" as const) : ("staff" as const),
  };
}

function inputBody(seq: number, buttons: number, yaw: number): Uint8Array {
  const a: MutableInput = { seq, moveX: 0, moveY: 127, yaw, pitch: 0, buttons, toolParam: 128 };
  const buf = new Uint8Array(32);
  const n = encodeInput(buf, a);
  return buf.slice(1, n);
}

function eventSink(out: WireSimEvent[]): ShiftSink {
  return {
    frame() {},
    events(batch) {
      for (const e of batch) out.push(e);
    },
  };
}

/** Drives `ticks` ticks with every seat sweeping forward; returns the events seen. */
function drive(core: ShiftCore, seats: number, ticks: number, from = 0): WireSimEvent[] {
  const events: WireSimEvent[] = [];
  const sink = eventSink(events);
  for (let t = from; t < from + ticks; t++) {
    for (let s = 0; s < seats; s++) core.receiveInput(s, inputBody(t + 1, SWEEP, (s * 1000 + t * 40) & 0xffff), t * 50);
    core.step(sink);
  }
  return events;
}

describe("ShiftCore dust ledger (same ledger as the Solo host)", () => {
  it("builds a real WorldDustLedger with the Solo host's headroom and hands it to the sim", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    expect(core.ledger).toBeInstanceOf(WorldDustLedger);
    expect(core.ledger.plotCount).toBe(grid.count);
    expect(core.ledger.ledgerCount).toBe(0);
    expect(core.ledgerPoolGrowths).toBe(0);
    // Same construction as createRoomDustLedger: identical levels and areas (compared through the world hash of a
    // fresh ledger of each).
    const solo = createRoomDustLedger(grid, data, { tickHz: 20 });
    expect(core.ledger.worldHash()).toBe(solo.worldHash());
    expect(createShiftLedger(data, world, 20).worldHash()).toBe(solo.worldHash());
    expect(SHIFT_LEDGER_HEADROOM_SLOTS).toBe(1024);
  });

  it("refuses a world whose grid is not the packages/world IcoPlotGrid", () => {
    const fake = { grid: { ...grid, count: grid.count } as unknown as SimWorld["grid"], ground: world.ground };
    expect(() => createShiftLedger(data, fake, 20)).toThrow(TypeError);
  });

  it("emits plot.opened for the plots a sweeping seat touches, once each, credited to the sweeper", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    core.addSeat(player(0), 0);
    const events = drive(core, 1, 120);
    const opened = events.filter((e) => e.name === "plot.opened");
    expect(opened.length).toBeGreaterThan(0);
    const ids = new Set<number>();
    for (const e of opened) {
      if (e.name !== "plot.opened") continue;
      expect(ids.has(e.payload.plotId)).toBe(false);
      ids.add(e.payload.plotId);
      expect(e.payload.creditedSlot).toBe(0);
    }
    // The sim counted exactly what it emitted (the room always has a listener: `onSimEvent`).
    expect(core.sim.counters.plotsOpened).toBe(opened.length);
    expect(core.ledger.ledgerCount).toBeGreaterThan(0);
    // The queues are drained by the sim and the dirty list by the core: nothing carries over to the next tick.
    expect(core.ledger.openedQueueCount).toBe(0);
    expect(core.ledger.polishedQueueCount).toBe(0);
    expect(core.ledger.dirtyPlotCount).toBe(0);
    expect(core.ledgerPoolGrowths).toBe(0);
  });

  it("matches a bare MoonRoomSim on a createRoomDustLedger ledger fed the same inputs (opened plots and dust hash)", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    core.addSeat(player(0), 0);
    drive(core, 1, 160);

    const ledger = createRoomDustLedger(grid, data, { tickHz: 20, initialLedgerSlots: SHIFT_LEDGER_HEADROOM_SLOTS });
    const bare = new MoonRoomSim({
      data,
      world,
      ledger,
      contractId: CONTRACT,
      shiftType: "private",
      tickHz: 20,
      snapshotHz: 10,
    });
    bare.addActor(0, player(0));
    bare.onEvent(() => undefined);
    const cmd = { seq: 0, moveX: 0, moveY: 127, yaw: 0, pitch: 0, buttons: SWEEP, toolParam: 128 };
    for (let t = 0; t < 160; t++) {
      cmd.seq = t + 1;
      cmd.yaw = (0 * 1000 + t * 40) & 0xffff;
      bare.applyInput(0, cmd);
      bare.step(bare.config.dt);
    }
    expect(core.sim.counters.plotsOpened).toBe(bare.counters.plotsOpened);
    expect(core.ledger.worldHash()).toBe(ledger.worldHash());
    expect(core.sim.stateHash()).toBe(bare.stateHash());
  });

  it("measures the 6-player tick with the real ledger inside TICK_BUDGET_MS and with no ledger pool growth", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) core.addSeat(player(i), 0);
    const sink: ShiftSink = { frame() {}, events() {} };
    const bodies = Array.from({ length: 4096 }, (_, k) => inputBody(k + 1, k % 40 < 30 ? SWEEP : 1, (k * 97) & 0xffff));
    for (let t = 0; t < 400; t++) {
      for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) core.receiveInput(s, bodies[t]!, t * 50);
      core.step(sink);
    }
    const N = 1200;
    const ring = new Float64Array(N);
    const heapBefore = process.memoryUsage().heapUsed;
    for (let t = 400; t < 400 + N; t++) {
      const start = performance.now();
      for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) core.receiveInput(s, bodies[t]!, t * 50);
      core.step(sink);
      ring[t - 400] = performance.now() - start;
    }
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;
    const p = percentiles(ring, N);
    console.info(
      `[shift tick + ledger] 6 players, ${N} ticks: p50 ${p.p50.toFixed(3)} ms, p95 ${p.p95.toFixed(3)} ms, max ${p.max.toFixed(3)} ms, heap delta ${(heapDelta / 1024).toFixed(0)} KiB, ledgers ${core.ledger.ledgerCount}, opened ${core.sim.counters.plotsOpened}, polished ${core.sim.counters.plotsPolished}, pool growths ${core.ledgerPoolGrowths}`,
    );
    expect(p.p95).toBeLessThanOrEqual(TICK_BUDGET_MS);
    expect(core.ledgerPoolGrowths).toBe(0);
    expect(core.sim.counters.plotsOpened).toBeGreaterThan(0);
  });
});

describe("ShiftDustPersistence sliced encode", () => {
  it("encodes the dirty chunks in slices with a yield between them, loses nothing and round-trips", async () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    for (let s = 0; s < 3; s++) core.addSeat(player(s), 0);
    drive(core, 3, 120);
    for (let c = 0; c < 4; c++) core.ledger.setChunkDirty(c);
    const dirty = core.ledger.dirtyChunkCount;
    expect(dirty).toBeGreaterThanOrEqual(4);
    const store = new MemoryShiftDustStore();
    const sliced = new ShiftDustPersistence(store, core.ledger, CONTRACT, 0, 0, undefined, 0);
    const done = sliced.save(0, 120);
    // The first slice ran synchronously: at least one chunk is already encoded (its mark cleared), the rest is queued.
    expect(core.ledger.dirtyChunkCount).toBeLessThan(dirty);
    await done;
    expect(core.ledger.dirtyChunkCount).toBe(0);
    expect(sliced.counters.encodeSlices).toBe(dirty);
    expect(sliced.counters.chunksWritten).toBe(dirty);
    const restored = createShiftLedger(data, world, 20);
    const again = new ShiftDustPersistence(store, restored, CONTRACT, 0, 0);
    expect((await again.restore())?.ok).toBe(true);
    expect(restored.worldHash()).toBe(core.ledger.worldHash());
  });

  it("a stroke between slices re-marks its chunk (kept for the next save)", async () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    core.addSeat(player(0), 0);
    drive(core, 1, 80);
    for (let c = 0; c < 3; c++) core.ledger.setChunkDirty(c);
    const p = new ShiftDustPersistence(new MemoryShiftDustStore(), core.ledger, CONTRACT, 0, 0, undefined, 0);
    const done = p.save(0, 80);
    core.ledger.setChunkDirty(0); // chunk 0 was encoded in slice one; a later stroke marks it again
    await done;
    expect(core.ledger.isChunkDirty(0)).toBe(true);
  });
});

describe("ShiftDustPersistence room header state", () => {
  it("writes a header-only checkpoint when only the wallet changed, restores it, and stays quiet when nothing changed", async () => {
    const store = new MemoryShiftDustStore();
    const ledger = createShiftLedger(data, world, 20);
    let wallet = 100;
    const p = new ShiftDustPersistence(store, ledger, CONTRACT, 0, 0);
    expect(await p.restore()).toBeNull();
    p.setStateProvider(() => ({ walletLm: wallet, nearParcelsMask: 0 }));
    // Baseline = the starting wallet: no dirty chunk, no state change -> nothing written, even past the 30 s interval.
    p.maybeSave(31_000, 10);
    await p.save(31_000, 10);
    expect(store.saves).toBe(0);
    wallet = 140;
    p.maybeSave(62_000, 20);
    await p.save(62_000, 20); // chained behind the maybeSave write
    expect(store.saves).toBe(1);
    expect(p.counters.chunksWritten).toBe(0);
    await p.save(63_000, 21); // unchanged now
    expect(store.saves).toBe(1);

    const again = new ShiftDustPersistence(store, createShiftLedger(data, world, 20), CONTRACT, 0, 0);
    await again.restore();
    expect(again.restoredState).toEqual({ walletLm: 140, nearParcelsMask: 0 });
  });

  it("review B1: a collected Near Parcel stays collected across a room restart (no leave/rejoin Lumens farm)", async () => {
    const store = new MemoryShiftDustStore();
    const dir = { x: 0, y: 0, z: 0 };
    const opts = { data, world, contractId: CONTRACT, shiftType: "private" as const, simTickHz: 20 };
    new ShiftCore(opts, 0).sim.nearParcel(0, dir);
    const parcelLm = data.collectibles.strayCargo.find((c) => c.size === "near_parcel")!.lm;
    expect(parcelLm).toBeGreaterThan(0);

    /** One room lifetime as ShiftRoom wires it: restore, build the core from the header, 4 seats (slot 3 spawns on
     * the parcel), a few ticks, final checkpoint on dispose. */
    async function roomLifetime(): Promise<{ core: ShiftCore; found: number; p: ShiftDustPersistence }> {
      const ledger = createShiftLedger(data, world, 20);
      const p = new ShiftDustPersistence(store, ledger, CONTRACT, 0, 0);
      await p.restore();
      const r = p.restoredState;
      const core = new ShiftCore(
        {
          ...opts,
          ledger,
          spawnDirection: dir,
          ...(r == null ? {} : { walletLm: r.walletLm, nearParcelsCollected: r.nearParcelsMask ?? 0 }),
        },
        0,
      );
      p.setStateProvider(() => ({ walletLm: core.sim.wallet, nearParcelsMask: nearParcelsMask(core.sim) }));
      for (let i = 0; i < 4; i++) core.addSeat(player(i), 0);
      const events: WireSimEvent[] = [];
      for (let t = 0; t < 5; t++) core.step(eventSink(events));
      await p.close(1_000, 5);
      return { core, p, found: events.filter((e) => e.name === "collectible.found").length };
    }

    const first = await roomLifetime();
    expect(first.found).toBe(1);
    expect(first.core.sim.wallet).toBe(parcelLm);
    expect(first.core.sim.nearParcel(0, dir)).toBe(true);

    const second = await roomLifetime(); // everyone left, the room was disposed, a player rejoins
    expect(second.p.restoredState).toEqual({ walletLm: parcelLm, nearParcelsMask: 1 });
    expect(second.found).toBe(0); // no second payout
    expect(second.core.sim.wallet).toBe(parcelLm);
    expect(second.core.sim.nearParcel(0, dir)).toBe(true);
  });

  it("skips (and logs) a legacy wallet stored without a parcel mask, and clamps an absurd wallet", async () => {
    const store = new MemoryShiftDustStore();
    await store.save(CONTRACT, [], 1, { walletLm: 900 }); // legacy room-v1 shape: no nearParcelsMask
    const warnings: string[] = [];
    const logger = { warn: (_o: object, msg: string) => void warnings.push(msg) };
    const legacy = new ShiftDustPersistence(store, createShiftLedger(data, world, 20), CONTRACT, 0, 0, logger);
    await legacy.restore();
    expect(legacy.restoredState).toBeNull();
    expect(warnings.some((m) => m.includes("wallet restore skipped"))).toBe(true);
    // The next checkpoint rewrites the header in the current shape (wallet differs from the stored legacy one).
    legacy.setStateProvider(() => ({ walletLm: 0, nearParcelsMask: 0 }));
    await legacy.save(31_000, 2);
    expect(await store.loadState(CONTRACT)).toEqual({ walletLm: 0, nearParcelsMask: 0 });

    await store.save(CONTRACT, [], 3, { walletLm: Number.MAX_SAFE_INTEGER * 4, nearParcelsMask: 0x1ff });
    const huge = new ShiftDustPersistence(store, createShiftLedger(data, world, 20), CONTRACT, 0, 0, logger);
    await huge.restore();
    expect(huge.restoredState).toEqual({ walletLm: SHIFT_RESTORED_WALLET_MAX_LM, nearParcelsMask: 0xff });
  });

  it("review N1: tools and suit gear bought survive a room restart through the sim META section", async () => {
    expect(ROOM_SIM_META_MAX_BYTES).toBe(SIM_CHECKPOINT_META_MAX_BYTES); // the db bound mirrors the sim bound
    const store = new MemoryShiftDustStore();
    const opts = { data, world, contractId: CONTRACT, shiftType: "private" as const, simTickHz: 20 };
    const items = ["tool.crescent_squeegee", "gear.holster_rig"];
    const warnings: string[] = [];
    const logger = { warn: (_o: object, msg: string) => void warnings.push(msg) };

    /** One room lifetime wired exactly like ShiftRoom.onCreate / onDispose. */
    async function roomLifetime(): Promise<{ core: ShiftCore; p: ShiftDustPersistence; results: IntentResult[] }> {
      const ledger = createShiftLedger(data, world, 20);
      const p = new ShiftDustPersistence(store, ledger, CONTRACT, 0, 0, logger);
      await p.restore();
      const r = p.restoredState;
      const core = new ShiftCore(
        {
          ...opts,
          ledger,
          ...(r == null
            ? { walletLm: 100_000 }
            : { walletLm: r.walletLm, nearParcelsCollected: r.nearParcelsMask ?? 0 }),
        },
        0,
      );
      if (r?.simMeta !== undefined) expect(core.restoreSharedMeta(r.simMeta).ok).toBe(true);
      p.setStateProvider(
        () => ({ walletLm: core.sim.wallet, nearParcelsMask: nearParcelsMask(core.sim) }),
        () => core.captureSharedMeta(),
      );
      core.addSeat(player(0), 0);
      core.step(eventSink([]));
      const results: IntentResult[] = [];
      items.forEach((itemId, k) =>
        results.push(core.sim.applyIntent(0, { kind: "purchase", requestId: `n1-${k}` as RequestId, itemId })),
      );
      for (let t = 0; t < 3; t++) core.step(eventSink([]));
      await p.close(1_000, core.sim.tick);
      return { core, p, results };
    }

    const first = await roomLifetime();
    expect(first.results.map((x) => x?.ok)).toEqual([true, true]);
    const spent = 100_000 - first.core.sim.wallet;
    expect(spent).toBeGreaterThan(0);
    expect((await store.loadState(CONTRACT))?.simMeta?.bytes.byteLength ?? 0).toBeGreaterThan(0);

    const second = await roomLifetime(); // everyone left, the room was disposed, the Holder rejoins
    expect(warnings).toEqual([]);
    // Everything bought is still owned: re-buying is refused and costs nothing; the wallet is the one left after spending.
    expect(second.results.map((x) => x?.ok)).toEqual([false, false]);
    const codes = second.results.map((x) => (x && !x.ok ? x.code : null));
    expect(codes).toEqual(["already_owned", "max_level"]);
    expect(second.core.sim.wallet).toBe(100_000 - spent);
    expect(second.core.sim.tick).toBeGreaterThan(first.core.sim.tick); // the sun clock continues from the save
  });

  it("a refused sim META section leaves the room on the header wallet and parcels (logged, nothing re-paid)", async () => {
    const store = new MemoryShiftDustStore();
    await store.save(CONTRACT, [], 1, {
      walletLm: 70,
      nearParcelsMask: 1,
      simMeta: { version: 1, bytes: Uint8Array.of(1, 2, 3) },
    });
    const p = new ShiftDustPersistence(store, createShiftLedger(data, world, 20), CONTRACT, 0, 0);
    await p.restore();
    const r = p.restoredState!;
    const core = new ShiftCore(
      {
        data,
        world,
        contractId: CONTRACT,
        shiftType: "private",
        simTickHz: 20,
        walletLm: r.walletLm,
        nearParcelsCollected: 1,
      },
      0,
    );
    const res = core.restoreSharedMeta(r.simMeta!);
    expect(res.ok).toBe(false);
    expect(core.sim.wallet).toBe(70);
    expect(core.sim.nearParcel(0, { x: 0, y: 0, z: 0 })).toBe(true);
    core.addSeat(player(0), 0);
    expect(() => core.restoreSharedMeta(r.simMeta!)).toThrow(); // never mid-shift
  });

  it("captures the header state before the first chunk is encoded (a crash can lose a payout, never double it)", async () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20 }, 0);
    for (let c = 0; c < 3; c++) core.ledger.setChunkDirty(c);
    const dirtyAtStart = core.ledger.dirtyChunkCount;
    const p = new ShiftDustPersistence(new MemoryShiftDustStore(), core.ledger, CONTRACT, 0, 0, undefined, 0);
    await p.restore();
    let wallet = 5;
    const seenDirty: number[] = [];
    p.setStateProvider(() => {
      seenDirty.push(core.ledger.dirtyChunkCount);
      return { walletLm: wallet, nearParcelsMask: 0 };
    });
    wallet = 6;
    seenDirty.length = 0;
    await p.save(31_000, 1);
    // Read once, before any chunk was encoded (none of the dirty marks cleared yet).
    expect(seenDirty[0]).toBe(dirtyAtStart);
  });

  it("restores a stored wallet into the sim", async () => {
    const core = new ShiftCore(
      { data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20, walletLm: 321 },
      0,
    );
    expect(core.sim.wallet).toBe(321);
  });
});
