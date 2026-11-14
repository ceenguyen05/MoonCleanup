// The packages/world GP(128,0) grid for harness runs: `--grid prototypes/dust-sim/p2-stroke-atlas-ledger/grid.ts`.
// Production code is consumed read-only by relative import of the source barrels (prototypes/README.md rule 1).
import { STANDARD_GRID_PARAMS } from "../../../packages/shared/src/index";
import { createPlotGrid, type IcoPlotGrid } from "../../../packages/world/src/index";

let cached: IcoPlotGrid | null = null;

export function createGrid(): IcoPlotGrid {
  cached ??= createPlotGrid(STANDARD_GRID_PARAMS);
  return cached;
}
