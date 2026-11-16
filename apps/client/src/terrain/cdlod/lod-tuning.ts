// LOD tuning of the CDLOD terrain for presets with leaf level 8 (Low / Medium / High; Ultra's leaf 9 keeps 12 m).
//
// Leaf range 16 m instead of the selector default 20 m (M1-W2-T01 round 4): the terrain pass is vertex-bound on the
// UHD 620 floor device, and the ground view drew 54 nodes of 33^2 vertices. 14 m measured -1.5 ms GPU at Medium; 16 m
// keeps every level at least 1.3 node edges of range (the selection tests hold the band and neighbour invariants).
// The procedural detail fades scale with the leaf range, so each term still ends at the same grid spacing.

/** Range of the leaf level (level 8) before the preset's range multiplier, metres. */
export const TERRAIN_LEAF_RANGE_M = 16;
/** Leaf range the detail fades (`DETAIL_FADES_M`) and far-normal distances were written for. */
export const DETAIL_REFERENCE_LEAF_RANGE_M = 20;

/** Leaf range for a preset's leaf level, or `undefined` for the selector default (leaf 9 and up: 12 m). */
export function leafRangeFor(leafLevel: number): number | undefined {
  return leafLevel === 8 ? TERRAIN_LEAF_RANGE_M : undefined;
}
