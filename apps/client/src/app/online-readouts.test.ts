import { describe, expect, it } from "vitest";
import { PlotState, STANDARD_GRID_PARAMS, type ContractId } from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { MoonRoomSim, createRoomDustLedger, createSimConfig, type SimWorld } from "@moon-cleanup/sim";
import { createPlotGrid } from "@moon-cleanup/world";
import { FLAT_GROUND } from "../gameplay";
import { OnlineReadouts, nearParcelCountOf, type OnlinePose } from "./online-readouts";
import { hasReadouts } from "./readout-link";

const CONTRACT = "00000000-0000-4000-8000-0000000000AB";

describe("online read-outs", () => {
  const data = loadGameData();
  const grid = createPlotGrid(STANDARD_GRID_PARAMS);
  const config = createSimConfig(data, { tickHz: 20, snapshotHz: 10 });
  const ledger = createRoomDustLedger(grid, data, { tickHz: 20 });
  let pose: OnlinePose | null = null;
  const ro = new OnlineReadouts({
    contractId: CONTRACT,
    data,
    config,
    grid,
    ledger,
    pose: () => pose,
    toolCode: () => 0,
    toolParam: () => 0,
  });

  it("places the same Near Parcels and outposts as the server's MoonRoomSim (lower-cased id)", () => {
    const world: SimWorld = { grid, ground: FLAT_GROUND };
    const sim = new MoonRoomSim({
      data,
      world,
      ledger: createRoomDustLedger(grid, data, { tickHz: 20 }),
      contractId: CONTRACT.toLowerCase() as ContractId,
      shiftType: "private",
      tickHz: 20,
      snapshotHz: 10,
    });
    expect(ro.nearParcelCount).toBe(sim.nearParcelCount);
    expect(nearParcelCountOf(data)).toBeGreaterThan(0);
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < sim.nearParcelCount; k++) {
      expect(ro.nearParcel(k, a)).toBe(false);
      sim.nearParcel(k, b);
      expect(a).toEqual(b);
    }
    expect(ro.outpostCount).toBe(sim.outpostCount);
    const o = { id: "", x: 0, y: 0, z: 0 };
    expect(ro.outpost(0, o)).toBe(true);
    expect(o).toEqual({ id: "Boreal", x: 0, y: 1, z: 0 });
  });

  it("marks the parcel nearest to an avatar on a Near Parcel collectible.found event", () => {
    const r = config.moonRadiusM;
    const d = ro.parcelDirs;
    const pos = new Float64Array([0, r, 0, d[3]! * r, d[4]! * r, d[5]! * r]);
    ro.noteEvents([{ name: "collectible.found", payload: { tick: 1, kind: "survey_point", id: "survey.x" } }], pos, 2);
    expect(ro.collectedMask).toBe(0);
    ro.noteEvents(
      [{ name: "collectible.found", payload: { tick: 2, kind: "stray_cargo", id: "near_parcel" } }],
      pos,
      2,
    );
    expect(ro.collectedMask).toBe(2);
    expect(ro.nearParcel(1, { x: 0, y: 0, z: 0 })).toBe(true);
  });

  it("Plot Card from the mirror ledger at the own pose; hop from the predictor; no lamp / quotes", () => {
    const card = {
      plotId: 0 as never,
      state: 0 as PlotState,
      remainingPct: 0,
      terrainId: null as string | null,
      creditedSlot: 0 as number | null,
      countsTowardShine: true,
      shinePctPerPlot: 0,
    };
    expect(ro.pickPlot(0, card)).toBe(false);
    const r = config.moonRadiusM;
    pose = {
      px: 0,
      py: r,
      pz: 0,
      fx: 1,
      fy: 0,
      fz: 0,
      heightAboveGround: 0,
      hopCharges: 0,
      hopMaxCharges: 0,
      hopRechargeTicks: 0,
    };
    expect(ro.pickPlot(0, card, 0)).toBe(true);
    expect(card.plotId).toBe(grid.plotAt({ x: 0, y: 1, z: 0 }));
    expect(card.state).toBe(ledger.state[card.plotId]);
    expect(card.creditedSlot).toBeNull();
    expect(card.shinePctPerPlot).toBeCloseTo(100 / grid.count, 12);
    const hop = { bursts: 9, max: 9, recharge01: 1 };
    expect(ro.hopReadout(0, hop)).toBe(true);
    expect(hop).toEqual({ bursts: 0, max: 0, recharge01: 0 });
    expect(ro.quotePriceLm(0, "gear.holster_rig")).toBe(-1);
  });

  it("Schema nearParcelsCollected: late-join mask, absent field keeps the fallback, invalid values ignored", () => {
    const fresh = new OnlineReadouts({
      contractId: CONTRACT,
      data,
      config,
      grid,
      ledger,
      pose: () => null,
      toolCode: () => 0,
      toolParam: () => 0,
    });
    const out = { x: 0, y: 0, z: 0 };
    // Absent field (older server): no change, events still mark the nearest parcel.
    fresh.noteState({ shine: 0 });
    fresh.noteState(null);
    expect(fresh.authoritativeMask).toBe(false);
    const r = config.moonRadiusM;
    const d = fresh.parcelDirs;
    const near = { name: "collectible.found", payload: { tick: 1, kind: "stray_cargo", id: "near_parcel" } };
    fresh.noteEvents([near], new Float64Array([d[9]! * r, d[10]! * r, d[11]! * r]), 1);
    expect(fresh.collectedMask).toBe(0b1000);
    // Invalid values are counted and ignored.
    for (const v of [-1, 256, 1.5, "5", Number.NaN]) fresh.noteState({ nearParcelsCollected: v });
    expect(fresh.stats.maskInvalid).toBe(5);
    expect(fresh.authoritativeMask).toBe(false);
    // Late-join first state: the mask replaces the guesses (bits 0, 2, 5) without any event.
    fresh.noteState({ nearParcelsCollected: 0b100101 });
    expect(fresh.authoritativeMask).toBe(true);
    expect(fresh.collectedMask).toBe(0b100101);
    const flags = Array.from({ length: fresh.nearParcelCount }, (_, k) => fresh.nearParcel(k, out));
    expect(flags).toEqual([true, false, true, false, false, true].slice(0, fresh.nearParcelCount));
    // Bits at or above the parcel count are dropped; an unchanged mask is not recounted.
    fresh.noteState({ nearParcelsCollected: 0xff });
    expect(fresh.collectedMask).toBe((1 << fresh.nearParcelCount) - 1);
    const masks = fresh.stats.masks;
    fresh.noteState({ nearParcelsCollected: 0xff });
    expect(fresh.stats.masks).toBe(masks);
    // Authoritative: events are skipped, never guessed.
    fresh.noteState({ nearParcelsCollected: 0 });
    fresh.noteEvents([near], new Float64Array([d[0]! * r, d[1]! * r, d[2]! * r]), 1);
    expect(fresh.collectedMask).toBe(0);
    expect(fresh.stats.skipped).toBe(1);
  });

  it("Landing Apron plots equal the server MoonRoomSim's (same grid and game data)", () => {
    const sim = new MoonRoomSim({
      data,
      world: { grid, ground: FLAT_GROUND },
      ledger: createRoomDustLedger(grid, data, { tickHz: 20 }),
      contractId: CONTRACT.toLowerCase() as ContractId,
      shiftType: "private",
      tickHz: 20,
      snapshotHz: 10,
    });
    expect(sim.apronPlotCount).toBeGreaterThan(0);
    expect(ro.apronPlotCount).toBe(sim.apronPlotCount);
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < sim.apronPlotCount; k++) {
      expect(ro.apronPlot(k, a)).toBe(true);
      expect(sim.apronPlot(k, b)).toBe(true);
      expect(a).toEqual(b);
    }
    expect(ro.apronPlot(ro.apronPlotCount, a)).toBe(false);
  });

  it("a host exposing readouts + setReadoutRequest passes the ReadoutLink guard", () => {
    const host = { kind: "remote", readouts: ro, setReadoutRequest: () => undefined } as never;
    expect(hasReadouts(host)).toBe(true);
  });
});
