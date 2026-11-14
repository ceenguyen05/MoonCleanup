// Grid module for the harness CLI (`--grid prototypes/dust-sim/p1-scalar-procedural/grid.ts`): the production GP(128,0) plot grid of
// packages/world, read-only by relative import of the source barrels.
import { STANDARD_GRID_PARAMS } from "../../../packages/shared/src/index";
import { createPlotGrid, type IcoPlotGrid } from "../../../packages/world/src/index";

export function createGrid(): IcoPlotGrid {
  return createPlotGrid(STANDARD_GRID_PARAMS);
}
