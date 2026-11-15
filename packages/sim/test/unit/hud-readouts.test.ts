// HUD read-outs (M1-W6-T02 follow-up): quoted prices (Rebate, Repeat Requisition, Roost growth), Hop Pack and Crown
// Lamp read-outs, compass outposts and the plot pick for the Plot Card. All are pure reads: the state hash never moves.
import { describe, expect, test } from "vitest";
import { loadGameData } from "@moon-cleanup/game-data";
import {
  INPUT_BUTTON_MASK as M,
  PlotState,
  type PlotId,
  type RequestId,
  type RoomSimEvent,
} from "@moon-cleanup/shared";
import {
  BOREAL_STAND_IN_OUTPOSTS,
  createSimConfig,
  HopReadout,
  LampReadout,
  OutpostReadout,
  PlotCardData,
  type MoonRoomSim,
} from "../../src";
import { flatWorld, makeSim, makeWorldLedger, PLAYER } from "../support/world";

const data = loadGameData();
const cfg = createSimConfig(data);
let reqN = 0;
const rid = (): RequestId => `00000000-0000-4000-8000-${(++reqN).toString(16).padStart(12, "0")}` as RequestId;
const buy = (sim: MoonRoomSim, slot: number, itemId: string) =>
  sim.applyIntent(slot, { kind: "purchase", requestId: rid(), itemId });

function priced(sim: MoonRoomSim): { prices: number[] } {
  const prices: number[] = [];
  sim.onEvent((e: RoomSimEvent) => {
    if (e.name === "purchase.completed") prices.push((e.payload as { priceLm: number }).priceLm);
  });
  return { prices };
}

describe("quotePriceLm matches what the purchase charges", () => {
  test("Repeat Requisition: second copy of a tier >= min tool is quoted and charged at the repeat price", () => {
    const tool = cfg.tools.find((t) => t.cleans && t.tier >= cfg.repeatRequisitionMinTier && t.priceLm > 0);
    expect(tool).toBeDefined();
    const sim = makeSim(flatWorld(), { walletLm: 10_000_000 });
    sim.addActor(0, PLAYER);
    sim.addActor(1, { ...PLAYER, displayName: "Other" });
    const { prices } = priced(sim);
    const h0 = sim.stateHash();
    expect(sim.copiesBoughtOf(tool!.code)).toBe(0);
    const q0 = sim.quotePriceLm(0, tool!.id);
    expect(q0).toBe(tool!.priceLm);
    expect(sim.stateHash()).toBe(h0);
    expect(buy(sim, 0, tool!.id)).toMatchObject({ ok: true });
    expect(prices[0]).toBe(q0);
    expect(sim.copiesBoughtOf(tool!.code)).toBe(1);
    expect(sim.quotePriceLm(0, tool!.id)).toBe(-1); // carried
    const q1 = sim.quotePriceLm(1, tool!.id);
    expect(q1).toBe(Math.round(tool!.priceLm * cfg.repeatRequisitionFrac));
    expect(buy(sim, 1, tool!.id)).toMatchObject({ ok: true });
    expect(prices[1]).toBe(q1);
    expect(sim.copiesBoughtOf(99)).toBe(0);
  });

  test("board nodes (Rebate on Cells), suit gear and Roosts quote the charged price; -1 when not buyable", () => {
    const sim = makeSim(flatWorld(), { walletLm: 10_000_000 });
    sim.addActor(0, PLAYER);
    const { prices } = priced(sim);
    const items = ["node.dust_cell_desk_duster", "node.dust_cell_desk_duster", "gear.crown_lamp", "robot.sandpiper"];
    for (const id of items) {
      const q = sim.quotePriceLm(0, id);
      expect(q).toBeGreaterThan(0);
      expect(buy(sim, 0, id)).toMatchObject({ ok: true });
      expect(prices.at(-1)).toBe(q);
    }
    expect(sim.quotePriceLm(0, "node.nope")).toBe(-1);
    expect(sim.quotePriceLm(0, "node.densifier") === -1 || sim.quotePriceLm(0, "node.densifier") > 0).toBe(true);
  });
});

describe("Hop Pack and Crown Lamp read-outs", () => {
  test("no gear: zero bursts and an unlit lamp; buying gear and toggling the lamp shows up", () => {
    const sim = makeSim(flatWorld(), { walletLm: 10_000_000 });
    sim.addActor(0, PLAYER);
    const hop = new HopReadout();
    const lamp = new LampReadout();
    expect(sim.hopReadout(3, hop)).toBe(false);
    expect(sim.lampReadout(3, lamp)).toBe(false);
    expect(sim.hopReadout(0, hop)).toBe(true);
    expect(hop).toMatchObject({ bursts: 0, max: 0, recharge01: 0 });
    expect(sim.lampReadout(0, lamp)).toBe(true);
    expect(lamp).toMatchObject({ level: 0, switchedOn: false, lit: false });

    expect(buy(sim, 0, "gear.crown_lamp")).toMatchObject({ ok: true });
    sim.applyInput(0, { seq: 1, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: M.lampCycle, toolParam: 0 } as never);
    sim.step(cfg.dt);
    sim.lampReadout(0, lamp);
    expect(lamp).toMatchObject({ level: 1, switchedOn: true, lit: true });
  });

  test("Hop Pack owned (restored gear): bursts, max and refill progress after a hop", () => {
    const sim = makeSim(flatWorld(), { suitGear: { "gear.hop_pack": 1 } });
    sim.addActor(0, PLAYER);
    const hop = new HopReadout();
    sim.step(cfg.dt);
    sim.hopReadout(0, hop);
    const max = cfg.hopBurstsByLevel[1]!;
    expect(max).toBeGreaterThan(0);
    expect(hop).toMatchObject({ bursts: max, max, recharge01: 0 });
    const h0 = sim.stateHash();
    sim.hopReadout(0, hop);
    expect(sim.stateHash()).toBe(h0);
    // Jump, burst in the air, then land and let the refill run part-way.
    let seq = 1;
    const press = (buttons: number) => {
      sim.applyInput(0, { seq: seq++, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons, toolParam: 0 } as never);
      sim.step(cfg.dt);
    };
    press(M.jump);
    for (let k = 0; k < 6; k++) press(0);
    press(M.hopPack);
    let minBursts = max;
    let sawPartial = false;
    for (let k = 0; k < 400 && !sawPartial; k++) {
      press(0);
      sim.hopReadout(0, hop);
      minBursts = Math.min(minBursts, hop.bursts);
      expect(hop.recharge01).toBeGreaterThanOrEqual(0);
      expect(hop.recharge01).toBeLessThan(1);
      if (hop.recharge01 > 0) sawPartial = true;
    }
    expect(minBursts).toBeLessThan(max);
    expect(sawPartial).toBe(true);
  });
});

describe("compass outposts", () => {
  test("default: Outpost Boreal at the pole, home and visited", () => {
    const sim = makeSim(flatWorld());
    expect(sim.outpostCount).toBe(BOREAL_STAND_IN_OUTPOSTS.length);
    const o = new OutpostReadout();
    expect(sim.outpost(0, o)).toBe(true);
    expect(o).toMatchObject({ id: "Boreal", x: 0, y: 1, z: 0, home: true, visited: true });
    expect(sim.outpost(1, o)).toBe(false);
  });

  test("custom list: normalised directions, only the home outpost is visited", () => {
    const sim = makeSim(flatWorld(), {
      outposts: [
        { id: "Boreal", x: 0, y: 2, z: 0 },
        { id: "Austral", x: 0, y: -3, z: 0 },
      ],
    });
    const o = new OutpostReadout();
    expect(sim.outpost(1, o)).toBe(true);
    expect(o).toMatchObject({ id: "Austral", x: 0, y: -1, z: 0, home: false, visited: false });
  });
});

describe("plot pick for the Plot Card", () => {
  test("plotIdAt and pickPlot resolve the plot ahead of the avatar on the real ledger without moving the hash", () => {
    const ledger = makeWorldLedger();
    const world = flatWorld();
    const sim = makeSim(world, { ledger });
    sim.addActor(0, PLAYER);
    sim.step(cfg.dt);
    const h0 = sim.stateHash();
    const a = sim.avatar(0);
    const under = sim.plotIdAt(a.px, a.py, a.pz);
    expect(under).toBe(world.grid.plotAt({ x: a.px, y: a.py, z: a.pz }));
    expect(sim.plotIdAt(0, 0, 0)).toBe(-1);

    const card = new PlotCardData();
    expect(sim.pickPlot(0, card, 0)).toBe(true);
    expect(card.plotId).toBe(under);
    expect(card.shinePctPerPlot).toBeCloseTo(100 / world.grid.count, 12);
    expect(card.countsTowardShine).toBe(card.state === PlotState.Polished || card.state === PlotState.Empty);

    // Far ahead along the facing lands on another plot.
    expect(sim.pickPlot(0, card, 60)).toBe(true);
    const k = 60;
    const r = Math.hypot(a.px, a.py, a.pz);
    const s = (r - a.heightAboveGround) / r;
    expect(card.plotId).toBe(
      world.grid.plotAt(
        (() => {
          const x = a.px * s + a.fx * k;
          const y = a.py * s + a.fy * k;
          const z = a.pz * s + a.fz * k;
          const l = Math.hypot(x, y, z);
          return { x: x / l, y: y / l, z: z / l };
        })(),
      ),
    );
    expect(card.plotId).not.toBe(under);
    // Default distance (tool reticle) works too; inactive slots are refused.
    expect(sim.pickPlot(0, card)).toBe(true);
    expect(sim.pickPlot(4, card)).toBe(false);
    expect(sim.stateHash()).toBe(h0);
  });

  test("stand-in ledger: pick fails cleanly (no per-plot state)", () => {
    const sim = makeSim(flatWorld());
    sim.addActor(0, PLAYER);
    expect(sim.pickPlot(0, new PlotCardData(), 0)).toBe(false);
    expect(sim.plotCard(0 as PlotId, new PlotCardData())).toBe(false);
  });
});
