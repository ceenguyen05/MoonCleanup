// M1-W6-T02 purchases: Promotions Board nodes (Dust Cells, Densifier, ...), suit gear, Rebate pricing, replays and
// race resolution. Prices and effects come from game-data; the tests read them from the same tables.
import { describe, expect, test } from "vitest";
import { loadGameData } from "@moon-cleanup/game-data";
import { MVP_SCOPE, type RequestId, type RoomSimEvent } from "@moon-cleanup/shared";
import { createSimConfig, discountedPriceLm, PURCHASE_RACE_WINDOW_S, toolCodeOf, type MoonRoomSim } from "../../src";
import { flatWorld, makeSim, PLAYER } from "../support/world";

const data = loadGameData();
const cfg = createSimConfig(data);
const node = (id: string) => data["promotions-board"].nodes.find((n) => n.id === id)!;
const costs = (id: string) => node(id).levels.map((l) => l.costLm);
let reqN = 0;
const rid = (): RequestId => `00000000-0000-4000-8000-${(++reqN).toString(16).padStart(12, "0")}` as RequestId;
const buy = (sim: MoonRoomSim, slot: number, itemId: string, requestId = rid()) =>
  sim.applyIntent(slot, { kind: "purchase", requestId, itemId });

function twoPlayers(walletLm: number): { sim: MoonRoomSim; events: RoomSimEvent[] } {
  const sim = makeSim(flatWorld(), { walletLm });
  sim.addActor(0, PLAYER);
  sim.addActor(1, { ...PLAYER, displayName: "Other" });
  const events: RoomSimEvent[] = [];
  sim.onEvent((e) => events.push(e));
  return { sim, events };
}

describe("Promotions Board purchases", () => {
  test("Dust Cell levels I..III raise every member's Cell, then max_level; prices from game-data", () => {
    const id = "node.dust_cell_desk_duster";
    const total = costs(id).reduce((a, b) => a + b, 0);
    const { sim, events } = twoPlayers(total + 7);
    const code = toolCodeOf(cfg, "tool.desk_duster");
    const tool = cfg.tools[code]!;
    for (let level = 1; level <= 3; level++) {
      expect(buy(sim, level % 2, id)).toMatchObject({ ok: true });
      // Cell I/II/III capacity = base x levelMult (progression section 5), on both members.
      for (const s of [0, 1]) expect(sim.toolState(s).cellLevel[code]).toBe(level);
      expect(Math.round(tool.cellBaseGrams * cfg.cellLevelMult[level - 1]!)).toBeGreaterThan(tool.cellBaseGrams);
      // Different members alternate here, so step past the race window between levels.
      for (let t = 0; t < Math.ceil(PURCHASE_RACE_WINDOW_S * cfg.tickHz); t++) sim.step(cfg.stepMs);
    }
    expect(sim.wallet).toBe(7);
    expect(buy(sim, 0, id)).toMatchObject({ ok: false, code: "max_level" });
    const done = events.filter((e) => e.name === "purchase.completed").map((e) => e.payload);
    expect(done.map((p) => [p.itemId, p.level, p.priceLm])).toEqual(costs(id).map((c, k) => [id, k + 1, c]));
    expect(sim.snapshot().shift.sharedUpgrades[id]).toBe(3);
  });

  test("prerequisites: secondaries need their root; buying the root grants unlock.granted for them", () => {
    const { sim, events } = twoPlayers(100_000);
    expect(buy(sim, 0, "node.scour")).toMatchObject({ ok: false, code: "prereq_missing" });
    expect(buy(sim, 0, "node.densifier")).toMatchObject({ ok: false, code: "prereq_missing" });
    expect(sim.wallet).toBe(100_000);
    expect(buy(sim, 0, "node.broad_strokes")).toMatchObject({ ok: true });
    const unlocks = events.filter((e) => e.name === "unlock.granted").map((e) => e.payload);
    // Telescoping Pole also needs Broad Strokes I but is not in the MVP slice, so it is not announced.
    expect(unlocks).toEqual([
      { tick: sim.tick, kind: "node", unlockId: "node.scour", viaItemId: "node.broad_strokes" },
    ]);
    expect(buy(sim, 0, "node.scour")).toMatchObject({ ok: true });
    expect(sim.wallet).toBe(100_000 - costs("node.broad_strokes")[0]! - costs("node.scour")[0]!);
  });

  test("Densifier adds its capacity bonus to every member's Cells", () => {
    const { sim } = twoPlayers(100_000);
    expect(buy(sim, 0, "node.dust_cell_desk_duster")).toMatchObject({ ok: true });
    expect(buy(sim, 0, "node.densifier")).toMatchObject({ ok: true });
    for (const s of [0, 1]) expect(sim.toolState(s).cellCapacityBonus).toBeCloseTo(0.2, 9);
  });

  test("insufficient funds and unknown or out-of-slice nodes change nothing", () => {
    const { sim, events } = twoPlayers(costs("node.dust_cell_lane_broom")[0]! - 1);
    const before = sim.stateHash();
    expect(buy(sim, 0, "node.dust_cell_lane_broom")).toMatchObject({ ok: false, code: "insufficient_funds" });
    expect(buy(sim, 0, "node.telescoping_pole")).toMatchObject({ ok: false, code: "unknown_item" });
    expect(buy(sim, 0, "node.nope")).toMatchObject({ ok: false, code: "unknown_item" });
    expect(sim.stateHash()).toBe(before);
    expect(events.every((e) => e.name === "purchase.rejected")).toBe(true);
    expect(sim.counters.intentsRejected).toBe(3);
  });

  test("every MVP node is buyable to its top level from the hub with enough Lumens; wallet never negative", () => {
    const { sim } = twoPlayers(1_000_000);
    let spent = 0;
    // Data order satisfies every MVP prerequisite (roots come before their secondaries).
    for (let pass = 0; pass < 3; pass++) {
      for (const id of MVP_SCOPE.boardNodeIds) {
        const r = buy(sim, 0, id);
        if (r?.ok) spent += costs(id)[sim.snapshot().shift.sharedUpgrades[id]! - 1]!;
      }
    }
    for (const id of MVP_SCOPE.boardNodeIds)
      expect(sim.snapshot().shift.sharedUpgrades[id], id).toBe(node(id).levels.length);
    expect(sim.wallet).toBe(1_000_000 - spent);
    expect(sim.wallet).toBeGreaterThanOrEqual(0);
  });
});

describe("race resolution and replays", () => {
  test("a different member buying the same node inside the window gets pending_other, not the next level", () => {
    const { sim } = twoPlayers(10_000);
    const id = "node.dust_cell_crescent_squeegee";
    expect(buy(sim, 0, id)).toMatchObject({ ok: true });
    expect(buy(sim, 1, id)).toMatchObject({ ok: false, code: "pending_other" });
    expect(sim.snapshot().shift.sharedUpgrades[id]).toBe(1);
    // The same member may buy level after level.
    expect(buy(sim, 0, id)).toMatchObject({ ok: true });
    for (let t = 0; t < Math.ceil(PURCHASE_RACE_WINDOW_S * cfg.tickHz); t++) sim.step(cfg.stepMs);
    expect(buy(sim, 1, id)).toMatchObject({ ok: true });
    expect(sim.snapshot().shift.sharedUpgrades[id]).toBe(3);
  });

  test("the same request applied twice charges once and returns the same outcome", () => {
    const { sim, events } = twoPlayers(10_000);
    const req = rid();
    const first = buy(sim, 0, "node.dust_cell_bristle_broom", req);
    const again = buy(sim, 0, "node.dust_cell_bristle_broom", req);
    expect(again).toEqual(first);
    expect(sim.wallet).toBe(10_000 - costs("node.dust_cell_bristle_broom")[0]!);
    expect(events.filter((e) => e.name === "purchase.completed")).toHaveLength(1);
    // A different actor reusing the id is a different request.
    expect(buy(sim, 1, "gear.crown_lamp", req)).toMatchObject({ ok: true });
  });

  test("identical intent logs give identical hashes (determinism)", () => {
    const run = () => {
      const { sim } = twoPlayers(5_000);
      const log: unknown[] = [];
      reqN = 1000;
      for (let t = 0; t < 60; t++) {
        if (t % 7 === 0) log.push(buy(sim, t % 2, MVP_SCOPE.boardNodeIds[t % MVP_SCOPE.boardNodeIds.length]!));
        sim.step(cfg.stepMs);
      }
      return { hash: sim.stateHash(), log, wallet: sim.wallet };
    };
    expect(run()).toEqual(run());
  });
});

describe("suit gear purchases", () => {
  test("MVP caps: Crown Lamp and Holster Rig to their MVP level, Hop Pack not sold", () => {
    const { sim } = twoPlayers(100_000);
    for (const [line, cap] of Object.entries(MVP_SCOPE.suitGearMaxLevel)) {
      for (let k = 0; k < cap; k++) expect(buy(sim, 0, line)).toMatchObject({ ok: true });
      expect(buy(sim, 0, line)).toMatchObject({ ok: false, code: "max_level" });
    }
    expect(buy(sim, 0, "gear.hop_pack")).toMatchObject({ ok: false, code: "unknown_item" });
  });

  test("Hop Pack (when sold) raises every avatar's burst count; gear survives a checkpoint", () => {
    const sim = makeSim(flatWorld(), { walletLm: 3_000, gearLevelCaps: { "gear.hop_pack": 1 } });
    sim.addActor(0, PLAYER);
    expect(buy(sim, 0, "gear.hop_pack")).toMatchObject({ ok: true, walletAfter: 500 });
    expect(sim.avatar(0).hopMaxCharges).toBe(cfg.hopBurstsByLevel[1]);
    const fresh = makeSim(flatWorld());
    fresh.addActor(0, PLAYER);
    expect(fresh.restoreCheckpoint(sim.captureCheckpoint()).ok).toBe(true);
    expect(fresh.stateHash()).toBe(sim.stateHash());
    expect(fresh.avatar(0).hopMaxCharges).toBe(cfg.hopBurstsByLevel[1]);
  });
});

describe("Rebate pricing", () => {
  test("discounts tools and Dust Cells, not other nodes; whole Lumens", () => {
    expect(discountedPriceLm(450, 0.05)).toBe(428);
    expect(discountedPriceLm(450, 0)).toBe(450);
    expect(discountedPriceLm(450, 2)).toBe(0);
    const all = data["promotions-board"].nodes.map((n) => n.id);
    const sim = makeSim(flatWorld(), {
      walletLm: 100_000,
      sharedUpgrades: { "node.rate_review": 1, "node.rebate": 1 },
      purchasableNodeIds: all,
    });
    sim.addActor(0, PLAYER);
    const events: RoomSimEvent[] = [];
    sim.onEvent((e) => events.push(e));
    buy(sim, 0, "node.dust_cell_crescent_squeegee");
    buy(sim, 0, "node.broad_strokes");
    buy(sim, 0, "tool.crescent_squeegee");
    const prices = events.filter((e) => e.name === "purchase.completed").map((e) => e.payload.priceLm);
    const sq = data.tools.tools.find((t) => t.id === "tool.crescent_squeegee")!.priceLm;
    expect(prices).toEqual([
      Math.round(costs("node.dust_cell_crescent_squeegee")[0]! * 0.95),
      costs("node.broad_strokes")[0]!,
      Math.round(sq * 0.95),
    ]);
  });
});

describe("Holster gating (owner decision 2026-11-15)", () => {
  const sq = toolCodeOf(cfg, "tool.crescent_squeegee");
  const duster = toolCodeOf(cfg, "tool.desk_duster");
  const step = (sim: MoonRoomSim, ticks: number, buttons = 0) => {
    for (let t = 0; t < ticks; t++) {
      sim.applyInput(0, { seq: t + 1, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons, toolParam: 0 });
      sim.step(cfg.dt);
    }
  };

  test("without a Rig one tool: a bought tool replaces it and is equipped; the Rig adds a slot", () => {
    const { sim } = twoPlayers(10_000);
    expect(sim.toolState(0).toolCode).toBe(duster);
    expect(buy(sim, 0, "tool.crescent_squeegee")).toMatchObject({ ok: true });
    expect(sim.toolState(0).toolCode).toBe(sq);
    // One slot: holster keys do nothing; slot 1 does not exist.
    sim.applyIntent(0, { kind: "select_tool", slot: 1 });
    expect(sim.toolState(0).toolCode).toBe(sq);
    // The other member owns it (Standard Issue) but keeps the Desk Duster in hand; the Desk hands it over for free.
    expect(sim.toolState(1).toolCode).toBe(duster);
    const before = sim.wallet;
    expect(buy(sim, 1, "tool.crescent_squeegee")).toMatchObject({ ok: true, walletAfter: before });
    expect(sim.toolState(1).toolCode).toBe(sq);
    // Holster Rig L1: two slots, filled with the owned tools; holster keys now swap.
    expect(buy(sim, 0, "gear.holster_rig")).toMatchObject({ ok: true });
    sim.applyIntent(0, { kind: "select_tool", slot: 0 });
    expect(sim.toolState(0).toolCode).toBe(duster);
    step(sim, cfg.holsterSwapTicks + 2);
    sim.applyIntent(0, { kind: "select_tool", slot: 1 });
    expect(sim.toolState(0).toolCode).toBe(sq);
  });

  test("the holster survives a checkpoint (same hash, same slots)", () => {
    const { sim } = twoPlayers(10_000);
    buy(sim, 0, "tool.crescent_squeegee");
    buy(sim, 0, "gear.holster_rig");
    step(sim, 5);
    const fresh = makeSim(flatWorld());
    fresh.addActor(0, PLAYER);
    fresh.addActor(1, { ...PLAYER, displayName: "Other" });
    expect(fresh.restoreCheckpoint(sim.captureCheckpoint()).ok).toBe(true);
    expect(fresh.stateHash()).toBe(sim.stateHash());
    fresh.applyIntent(0, { kind: "select_tool", slot: 0 });
    expect(fresh.toolState(0).toolCode).toBe(duster);
  });
});
