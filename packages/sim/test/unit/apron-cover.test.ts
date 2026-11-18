// Landing Apron cover through the common factory (M1 apron cover): every host (Solo worker, server room, online
// mirror, Solo dust view) builds its ledger with createRoomDustLedger, so they share one initial world.
import { describe, expect, test } from "vitest";
import { loadGameData } from "@moon-cleanup/game-data";
import { DUST_INIT_REVISION } from "@moon-cleanup/world";
import { createRoomDustLedger, landingApronCover } from "../../src/index";
import { makeSim, makeWorldLedger, testWorld } from "../support/world";

describe("Landing Apron cover (createRoomDustLedger)", () => {
  test("the factory's Apron plots are the sim's Apron plots, at the game-data level and share", () => {
    const world = testWorld();
    const data = loadGameData();
    const ledger = makeWorldLedger();
    const sim = makeSim(world, { ledger });
    const spec = landingApronCover(world.grid as never, data);
    expect(DUST_INIT_REVISION).toBe(1);
    expect(spec).toHaveLength(1);
    expect(spec[0]!.level).toBe(data.world.landingApron.dustLevel);
    expect(spec[0]!.permille).toBe(Math.round(data.world.landingApron.coverageFrac * 1000));
    expect(spec[0]!.plots.length).toBe(sim.apronPlotCount);
    let partial = 0;
    for (let p = 0; p < ledger.plotCount; p++) {
      if (!ledger.hasPartialCover(p)) continue;
      partial++;
      expect(sim.isApronPlot(p)).toBe(true);
      expect(ledger.levelOf[p]).toBe(data.world.landingApron.dustLevel);
    }
    expect(partial).toBe(sim.apronPlotCount);
  });

  test("two independently built ledgers (authority and mirror) start byte-identical on every Apron plot", () => {
    const world = testWorld();
    const data = loadGameData();
    const a = createRoomDustLedger(world.grid as never, data, { tickHz: 20 });
    const b = createRoomDustLedger(world.grid as never, data, { tickHz: 20, zeroEvents: true, strokeLog: false });
    const full = new Uint8Array(1024).fill(255);
    for (const p of landingApronCover(world.grid as never, data)[0]!.plots) {
      a.installLedger(p, full, 0, 0);
      b.installLedger(p, full, 0, 0);
      expect(a.ledgerHash(p)).toBe(b.ledgerHash(p));
      expect(a.initial[a.slotOf[p]!]).toBe(b.initial[b.slotOf[p]!]);
      expect(a.initial[a.slotOf[p]!]).toBe(16 * 2 * a.coverTexelCount(p));
    }
  });
});
