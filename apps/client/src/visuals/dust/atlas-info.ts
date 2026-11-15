// Dust tile atlas stats for `__mcLook.info().dustAtlas` (visual QA of `?scene=dust`). Plain field reads of the atlas
// bookkeeping when a tool asks; nothing here runs in a frame.

import type { LookDustAtlasInfo } from "../lookdev/hooks";
import { FRAME_EDGE_MM, atlasHeight, atlasWidth } from "./replay-batch";
import type { DustTileAtlas } from "./tile-atlas";

/** What the stats read of a `DustTileAtlas`. */
export type DustAtlasStatsSource = Pick<
  DustTileAtlas,
  | "layout"
  | "slots"
  | "tilesResident"
  | "rebuildBacklog"
  | "rebuilds"
  | "evictions"
  | "strokesReplayed"
  | "tileStrokeDraws"
  | "liveOverflows"
  | "fCpuMs"
  | "maxCpuMs"
>;

export function readDustAtlasInfo(atlas: DustAtlasStatsSource, preset: string): LookDustAtlasInfo {
  const layout = atlas.layout;
  return {
    preset,
    widthPx: atlasWidth(layout),
    heightPx: atlasHeight(layout),
    slotPx: layout.slotPx,
    slots: atlas.slots,
    // One tile frame (25.6 m) across one slot.
    texelCm: FRAME_EDGE_MM / layout.slotPx / 10,
    tilesResident: atlas.tilesResident,
    rebuildBacklog: atlas.rebuildBacklog,
    rebuilds: atlas.rebuilds,
    evictions: atlas.evictions,
    strokesReplayed: atlas.strokesReplayed,
    tileStrokeDraws: atlas.tileStrokeDraws,
    liveOverflows: atlas.liveOverflows,
    cpuMsLast: atlas.fCpuMs,
    cpuMsMax: atlas.maxCpuMs,
  };
}
