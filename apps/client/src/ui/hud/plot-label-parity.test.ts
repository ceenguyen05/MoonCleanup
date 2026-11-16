import { describe, expect, it } from "vitest";
import { STANDARD_GRID_PARAMS, type PlotId } from "@moon-cleanup/shared";
import { createPlotGrid } from "@moon-cleanup/world";
import { plotLabel } from "./plot-label";

describe("plotLabel parity with IcoPlotGrid", () => {
  const grid = createPlotGrid(STANDARD_GRID_PARAMS);
  const label = (id: number) => `${grid.chunkOf(id as PlotId)}-${grid.localIndexOf(id as PlotId)}`;

  it("matches chunkOf/localIndexOf on a deterministic sample plus edges and poles", () => {
    const ids = new Set<number>([
      0,
      1,
      127,
      128,
      16 * 128,
      grid.count - 1,
      STANDARD_GRID_PARAMS.northPolePlotId,
      STANDARD_GRID_PARAMS.southPolePlotId,
    ]);
    let s = 12345;
    for (let n = 0; n < 2000; n++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      ids.add(s % grid.count);
    }
    for (let d = 0; d < 10; d++) ids.add(d * 128 * 128 + 5 * 128 + 17);
    for (const id of ids) expect(plotLabel(id)).toBe(label(id));
  });
});
