import type { PlotFrame, UnitDirection } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { createStrokeSource, DEFAULT_STROKE_SOURCE } from "./strokes";
import { runS6 } from "./s6-restart";
import type { ContestGrid, DustContestTarget } from "./target";

/** Flat single-plot fake: plot 0 centred at +X, east = -Z, north = +Y. Enough to check determinism and ranges. */
const grid: ContestGrid = {
  params: { radiusM: 2000 } as ContestGrid["params"],
  plotAt: () => 0 as ReturnType<ContestGrid["plotAt"]>,
  centerDirection: () => ({ x: 1, y: 0, z: 0 }) as UnitDirection,
  frame: () =>
    ({
      normal: { x: 1, y: 0, z: 0 },
      east: { x: 0, y: 0, z: -1 },
      north: { x: 0, y: 1, z: 0 },
    }) as unknown as PlotFrame,
  toPlotLocal: (_id, d, out) => Object.assign(out, { u: Math.round(-d.z * 2_000_000), v: Math.round(d.y * 2_000_000) }),
};

const make = (botIndex: number, seed = 7) =>
  createStrokeSource(grid, { ...DEFAULT_STROKE_SOURCE, seed, botIndex, clusterPlot: 0, actorSlot: botIndex });

describe("dust-contest stroke source", () => {
  it("is reproducible per seed and differs per bot", () => {
    const a = make(0);
    const b = make(0);
    const c = make(1);
    const sa = Array.from({ length: 50 }, (_, t) => a(t + 1));
    expect(sa).toEqual(Array.from({ length: 50 }, (_, t) => b(t + 1)));
    expect(sa).not.toEqual(Array.from({ length: 50 }, (_, t) => c(t + 1)));
    expect(make(0, 8)(1)).not.toEqual(make(0, 7)(1));
  });

  it("emits short continuous segments with the configured tool", () => {
    const s = make(2);
    let prevEnd: [number, number] | null = null;
    for (let t = 1; t <= 200; t++) {
      const r = s(t);
      if (prevEnd) {
        expect(Math.abs(r.startUMm - prevEnd[0])).toBeLessThanOrEqual(2);
        expect(Math.abs(r.startVMm - prevEnd[1])).toBeLessThanOrEqual(2);
      }
      prevEnd = [r.endUMm, r.endVMm];
      expect(r.widthCm).toBe(60);
      expect(r.actorSlot).toBe(2);
    }
  });
});

describe("S6", () => {
  it("reports unsupported when the target cannot persist", async () => {
    const target = { simTickHz: 20 } as unknown as DustContestTarget;
    const r = await runS6(target, { grid, seed: 1, simSeconds: 1, clusterPlot: 0 });
    expect(r.supported).toBe(false);
  });
});
