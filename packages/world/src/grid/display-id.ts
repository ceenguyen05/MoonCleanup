// Player-facing plot ids, "Plot {chunkId}-{localIndex}" (WDS section 2.4, naming bible). UI-only: allocates strings.

import { PLOT_DISPLAY_ID_PATTERN } from "@moon-cleanup/shared";
import type { PlotDisplayId, PlotGrid, PlotId } from "@moon-cleanup/shared";

/** "Plot 41-207" for the plot `id` of `grid`. */
export function formatPlotDisplayId(grid: PlotGrid, id: PlotId): string {
  return `Plot ${grid.chunkOf(id)}-${grid.localIndexOf(id)}`;
}

/** Decodes "Plot 41-207" (no grid bounds check); null if the text does not match the pattern. */
export function parsePlotDisplayId(text: string): PlotDisplayId | null {
  const match = PLOT_DISPLAY_ID_PATTERN.exec(text);
  if (!match) return null;
  return { chunkId: Number(match[1]), localIndex: Number(match[2]) };
}

/** PlotId named by a display id on `grid`, or null if the text is malformed or names no plot of this grid. */
export function plotIdFromDisplayId(grid: PlotGrid, text: string): PlotId | null {
  const parsed = parsePlotDisplayId(text);
  if (!parsed) return null;
  try {
    return grid.plotAtChunkLocal(parsed.chunkId, parsed.localIndex);
  } catch {
    return null;
  }
}
