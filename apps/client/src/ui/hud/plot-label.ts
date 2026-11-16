// Player-facing plot label for the Plot Card: the naming-bible form "{chunk}-{local}" (the card string adds "Plot "),
// derived arithmetically from the plot id so the UI needs no plot grid (same maths as IcoPlotGrid.chunkOf / localIndexOf,
// packages/world/src/grid/plot-grid.ts). Runs only when the card's plot changes (<= 10 Hz), never per frame.

import { STANDARD_GRID_PARAMS } from "@moon-cleanup/shared";

export interface PlotLabelParams {
  readonly gridM: number;
  readonly poleChunkId: number;
  readonly northPolePlotId: number;
  readonly southPolePlotId: number;
}

const CHUNK_EDGE = 16;

/** "41-207" for plot `id`; poles read "{poleChunk}-0" / "{poleChunk}-1". Falls back to the plain number when out of range. */
export function plotLabel(id: number, params: PlotLabelParams = STANDARD_GRID_PARAMS): string {
  if (!Number.isInteger(id) || id < 0) return String(id);
  const m = params.gridM;
  const m2 = m * m;
  if (id === params.northPolePlotId) return `${params.poleChunkId}-0`;
  if (id === params.southPolePlotId) return `${params.poleChunkId}-1`;
  if (id >= 10 * m2) return String(id);
  const d = Math.floor(id / m2);
  const rem = id - d * m2;
  const i = Math.floor(rem / m);
  const j = rem % m;
  const perEdge = m / CHUNK_EDGE;
  const chunk = d * perEdge * perEdge + Math.floor(i / CHUNK_EDGE) * perEdge + Math.floor(j / CHUNK_EDGE);
  const local = (i % CHUNK_EDGE) * CHUNK_EDGE + (j % CHUNK_EDGE);
  return `${chunk}-${local}`;
}

/** Raw numeric labels (what the readout writer sends today) are replaced by the derived form; real labels pass through. */
export function resolvePlotLabel(label: string, plotId: number | null): string {
  if (plotId !== null && /^\d*$/.test(label)) return plotLabel(plotId);
  return label;
}
