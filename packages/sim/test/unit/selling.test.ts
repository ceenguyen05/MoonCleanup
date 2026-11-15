// M1-W6-T02 selling: Assay Counter hold-to-pour, Receiving Gate intake (pucks, despawn credit), Railshot, payout bonus,
// Roost purchase. Numbers come from game-data (economy.json, logistics.json, robots.json, promotions-board.json).
import { describe, expect, test } from "vitest";
import { loadGameData } from "@moon-cleanup/game-data";
import {
  INPUT_BUTTON_MASK as M,
  MVP_SCOPE,
  type RequestId,
  type RoomSimEvent,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { actorCellCap, createSimConfig, type MoonRoomSim, type MoonRoomSimOptions, type SellPoint } from "../../src";
import { flatWorld, makeSim, PLAYER } from "../support/world";

const data = loadGameData();
const cfg = createSimConfig(data);
const dustLmPerKg = data.economy.materials.find((m) => m.id === "material.regolith_dust")!.lmPerKg;
const up = { x: 0, y: 1, z: 0 };

/** Where actor 0 spawns with `spawnDirection: up` (probe sim), as a unit direction. */
function spawnPoint(): { x: number; y: number; z: number } {
  const probe = makeSim(flatWorld(), { spawnDirection: up });
  probe.addActor(0, PLAYER);
  const a = probe.avatar(0);
  const l = Math.hypot(a.px, a.py, a.pz);
  return { x: a.px / l, y: a.py / l, z: a.pz / l };
}

function setup(kind: SellPoint["kind"], extra: Partial<MoonRoomSimOptions> = {}) {
  const p = spawnPoint();
  const sim = makeSim(flatWorld(), { spawnDirection: up, sellPoints: [{ kind, ...p }], ...extra });
  sim.addActor(0, PLAYER);
  const events: RoomSimEvent[] = [];
  sim.onEvent((e) => events.push(e));
  return { sim, events };
}

/** Value of the first effect of level I of a board node (a stat effect). */
function firstEffectValue(nodeId: string): number {
  const e = data["promotions-board"].nodes.find((n) => n.id === nodeId)!.levels[0]!.effects[0]!;
  return "value" in e ? e.value : 0;
}

let seq = 0;
function run(sim: MoonRoomSim, ticks: number, buttons: number): void {
  for (let t = 0; t < ticks; t++) {
    const cmd: SimInputCommand = { seq: ++seq & 0xffff, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons, toolParam: 0 };
    sim.applyInput(0, cmd);
    sim.step(cfg.dt);
  }
}

function fillCell(sim: MoonRoomSim, grams?: number): number {
  const t = sim.toolState(0);
  const cap = actorCellCap(cfg, t, t.toolCode);
  (t.cellGrams as Int32Array)[t.toolCode] = grams ?? cap;
  return grams ?? cap;
}

describe("Assay Counter hold-to-pour", () => {
  test("a full Cell drains in pourS, sells at lmPerKg, cargo.pour_started then one cargo.sold", () => {
    const { sim, events } = setup("assay_counter");
    const grams = fillCell(sim);
    const pourTicks = data.logistics.assayCounter.pourS * cfg.tickHz;
    run(sim, pourTicks - 3, M.interact);
    expect(sim.toolState(0).cellGrams[sim.toolState(0).toolCode]).toBeGreaterThan(0);
    run(sim, 3, M.interact);
    expect(sim.toolState(0).cellGrams[sim.toolState(0).toolCode]).toBe(0);
    const expected = Math.floor((grams * dustLmPerKg) / 1000);
    expect(sim.wallet).toBe(expected);
    expect(events.filter((e) => e.name === "cargo.pour_started").map((e) => e.payload)).toMatchObject([
      { actorSlot: 0, pourSlot: 1 },
    ]);
    const sold = events.filter((e) => e.name === "cargo.sold").map((e) => e.payload);
    expect(sold).toMatchObject([{ source: "assay_counter", actorSlot: 0, kg: grams / 1000, lm: expected }]);
  });

  test("Lumens tick up live while pouring; releasing E stops and closes the pour", () => {
    const { sim, events } = setup("assay_counter");
    fillCell(sim);
    run(sim, cfg.tickHz * 2, M.interact);
    const mid = sim.wallet;
    expect(mid).toBeGreaterThan(0);
    run(sim, 3, 0);
    expect(events.filter((e) => e.name === "cargo.sold")).toHaveLength(1);
    const after = sim.wallet;
    run(sim, 20, 0);
    expect(sim.wallet).toBe(after);
  });

  test("out of reach: nothing happens", () => {
    const sim = makeSim(flatWorld(), { spawnDirection: up, sellPoints: [{ kind: "assay_counter", x: 1, y: 0, z: 0 }] });
    sim.addActor(0, PLAYER);
    fillCell(sim, 1000);
    run(sim, 40, M.interact);
    expect(sim.wallet).toBe(0);
  });

  test("Rate Review payout bonus raises sales; Quick Pour shortens the pour", () => {
    const { sim } = setup("assay_counter", { sharedUpgrades: { "node.rate_review": 1, "node.quick_pour": 1 } });
    const grams = fillCell(sim);
    const quick = firstEffectValue("node.quick_pour");
    run(sim, Math.ceil(data.logistics.assayCounter.pourS * quick * cfg.tickHz) + 1, M.interact);
    expect(sim.toolState(0).cellGrams[sim.toolState(0).toolCode]).toBe(0);
    const bonus = firstEffectValue("node.rate_review");
    expect(sim.wallet).toBe(Math.floor(Math.floor(grams * dustLmPerKg * (1 + bonus)) / 1000));
  });
});

describe("Receiving Gate", () => {
  test("a formed puck on the Dump Plate is sold on arrival", () => {
    const { sim, events } = setup("receiving_gate");
    fillCell(sim, 3000);
    run(sim, 1, M.puckForm);
    run(sim, 3, 0);
    const sold = events.filter((e) => e.name === "cargo.sold").map((e) => e.payload);
    expect(sold).toHaveLength(1);
    expect(sold[0]).toMatchObject({ source: "receiving_gate", actorSlot: 0 });
    expect(sim.wallet).toBe(Math.floor((sold[0]!.kg * 1000 * dustLmPerKg) / 1000));
    expect(sim.cargo.loose).toBe(0);
  });

  test("despawn credit (pendingGateGrams) is sold into the first Gate; Railshot every railshotEveryKg", () => {
    const { sim, events } = setup("receiving_gate");
    sim.cargo.pendingGateGrams = data.logistics.railshotEveryKg * 1000 + 500;
    run(sim, 1, 0);
    expect(sim.cargo.pendingGateGrams).toBe(0);
    expect(events.filter((e) => e.name === "railshot.fired")).toHaveLength(1);
    expect(sim.wallet).toBe(Math.floor(((data.logistics.railshotEveryKg * 1000 + 500) * dustLmPerKg) / 1000));
  });
});

describe("Roost purchase", () => {
  test("first Roost from the start, price 4,500 x 1.15^(n-1), cap from MVP_SCOPE, saved", () => {
    const sim = makeSim(flatWorld(), { walletLm: 100_000 });
    sim.addActor(0, PLAYER);
    const events: RoomSimEvent[] = [];
    sim.onEvent((e) => events.push(e));
    const r = data.robots.roost;
    for (let n = 1; n <= MVP_SCOPE.roostCap; n++) {
      const req = `00000000-0000-4000-8000-00000000r${n}`.replace("r", "0") as RequestId;
      expect(sim.applyIntent(0, { kind: "purchase", requestId: req, itemId: "robot.sandpiper" })).toMatchObject({
        ok: true,
      });
    }
    const prices = events.filter((e) => e.name === "purchase.completed").map((e) => e.payload.priceLm);
    expect(prices).toEqual([1, 2, 3].map((n) => Math.round(r.basePriceLm * r.priceGrowthMult ** (n - 1))));
    expect(
      sim.applyIntent(0, {
        kind: "purchase",
        requestId: "00000000-0000-4000-8000-0000000000ff" as RequestId,
        itemId: "robot.sandpiper",
      }),
    ).toMatchObject({ ok: false, code: "cap_reached" });
    expect(sim.snapshot().shift.robotCounts).toEqual({ "robot.sandpiper": MVP_SCOPE.roostCap });
    const fresh = makeSim(flatWorld());
    fresh.addActor(0, PLAYER);
    expect(fresh.restoreCheckpoint(sim.captureCheckpoint()).ok).toBe(true);
    expect(fresh.stateHash()).toBe(sim.stateHash());
    expect(fresh.snapshot().shift.robotCounts).toEqual({ "robot.sandpiper": MVP_SCOPE.roostCap });
  });
});
