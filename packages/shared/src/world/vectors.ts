// @contract world/vectors v1
// @consumers packages/world (ledger and hash unit tests), apps/client/src/terrain and apps/server/src/world (same
//   code, same vectors), tools/balance-sim (threshold arithmetic)
//
// Small golden vectors for the integer arithmetic fixed by world/dust. They are NOT the V1 ledger vectors of
// WDS section 4.5b (`packages/world/test/vectors/ledger-v1.json`, owned by terrain-dust-engineer); they pin only the
// formulas this contracts package defines. Changing a vector is a DUST_MODEL_VERSION change.

/** Per-texel removal r = floor((depth16 * C + A/2) / A), raised to 1 when C >= LEDGER_MIN_COVERAGE_MM2 (and r was 0). */
export interface LedgerRemovalVector {
  readonly name: string;
  readonly depth16: number;
  /** Coverage C of the texel in square millimetres, 0 .. 640,000. */
  readonly coverageMm2: number;
  readonly removalUnits: number;
}

export const LEDGER_REMOVAL_VECTORS: readonly LedgerRemovalVector[] = [
  { name: "no coverage", depth16: 80, coverageMm2: 0, removalUnits: 0 },
  {
    name: "desk duster crossing a texel (WDS 4.5: 18.75 % of 80 units = 15)",
    depth16: 80,
    coverageMm2: 120_000,
    removalUnits: 15,
  },
  { name: "just below the minimum-removal coverage", depth16: 16, coverageMm2: 9_999, removalUnits: 0 },
  { name: "minimum-removal coverage raises 0 to 1", depth16: 16, coverageMm2: 10_000, removalUnits: 1 },
  { name: "half coverage rounds down at .5", depth16: 16, coverageMm2: 320_000, removalUnits: 8 },
  { name: "thin deep pass", depth16: 255, coverageMm2: 100_000, removalUnits: 40 },
  { name: "full coverage, depth 5 (80 units)", depth16: 80, coverageMm2: 640_000, removalUnits: 80 },
  { name: "full coverage, Crater Floor depth 13 (208 units)", depth16: 208, coverageMm2: 640_000, removalUnits: 208 },
  { name: "full coverage, Charge (255)", depth16: 255, coverageMm2: 640_000, removalUnits: 255 },
];

/** Opened / Polished integer thresholds for a plot with `ownedTexels` texels of dust level `level` (initial = 16 * level * texels). */
export interface PlotThresholdVector {
  readonly name: string;
  readonly level: number;
  readonly ownedTexels: number;
  readonly initialUnits: number;
  /** Opened once removed units >= this: ceil(initialUnits / 1000). */
  readonly openedRemovedUnits: number;
  /** Polished once remaining units <= this: floor(initialUnits / 100). */
  readonly polishedRemainingUnits: number;
}

export const PLOT_THRESHOLD_VECTORS: readonly PlotThresholdVector[] = [
  {
    name: "Highland, 479 texels",
    level: 5,
    ownedTexels: 479,
    initialUnits: 38_320,
    openedRemovedUnits: 39,
    polishedRemainingUnits: 383,
  },
  {
    name: "Mare, 479 texels",
    level: 8,
    ownedTexels: 479,
    initialUnits: 61_312,
    openedRemovedUnits: 62,
    polishedRemainingUnits: 613,
  },
  {
    name: "Crater Floor, 479 texels",
    level: 13,
    ownedTexels: 479,
    initialUnits: 99_632,
    openedRemovedUnits: 100,
    polishedRemainingUnits: 996,
  },
  {
    name: "exact multiple of 1000",
    level: 5,
    ownedTexels: 200,
    initialUnits: 16_000,
    openedRemovedUnits: 16,
    polishedRemainingUnits: 160,
  },
  {
    name: "one over a multiple rounds Opened up",
    level: 1,
    ownedTexels: 63,
    initialUnits: 1_008,
    openedRemovedUnits: 2,
    polishedRemainingUnits: 10,
  },
  { name: "tiny plot", level: 5, ownedTexels: 1, initialUnits: 80, openedRemovedUnits: 1, polishedRemainingUnits: 0 },
];

/** Ledger drift hash (LEDGER_HASH_ALGORITHM) of a generated 1,024-byte ledger. */
export interface LedgerHashVector {
  readonly name: string;
  /** zeros: all 0; ramp: byte k = k & 0xff; corners: byte 0 = 208, byte 1023 = 80, rest 0. */
  readonly pattern: "zeros" | "ramp" | "corners";
  readonly hash: number;
}

export const LEDGER_HASH_VECTORS: readonly LedgerHashVector[] = [
  { name: "all zero", pattern: "zeros", hash: 521_235_909 },
  { name: "byte ramp", pattern: "ramp", hash: 2_214_824_389 },
  { name: "corners", pattern: "corners", hash: 2_618_210_469 },
];

/** Chunk drift hash term mix(plotId, hash) = fnv1a-32 over (plotId u32 LE, hash u32 LE). */
export interface ChunkMixVector {
  readonly plotId: number;
  readonly hash: number;
  readonly mix: number;
}

export const CHUNK_MIX_VECTORS: readonly ChunkMixVector[] = [
  { plotId: 0, hash: 0, mix: 2_615_243_109 },
  { plotId: 163_841, hash: 521_235_909, mix: 3_979_217_640 },
  { plotId: 1_234, hash: 2_214_824_389, mix: 3_293_349_774 },
];

/** FNV-1a 32-bit of the ASCII string "foobar" (published reference value 0xbf9cf968), a check of the algorithm itself. */
export const FNV1A_32_FOOBAR = 0xbf9c_f968;
