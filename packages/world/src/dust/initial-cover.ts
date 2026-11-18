// Initial dust cover recipe (M1 Landing Apron cover, owner decision 2026-11-18). Pure and environment-agnostic.
//
// A cover plot starts with dust on only part of its owned texels, at its own dust level; every other owned texel starts
// blank (0). Blank texels are NOT removed dust: they never count as removal, contributions, Opened or Polished
// progress, and they are never a source of milligrams. The remaining texels hold 16 x level, as on any plot.
//
// Recipe (DUST_INIT_REVISION 1). For cover plot p with per-mille share s (1 .. 999):
//   1. owned texels of p = the ledger ownership mask (nearest-centre rule, WDS section 4.3);
//   2. key(ix) = coarse << 20 | fine << 10 | ix, with ix = b * 32 + a,
//        coarse = top 10 bits of mixPlotHash(p, (a >> 2) | (b >> 2) << 8 | 1 << 16)   (3.2 m patches)
//        fine   = top 10 bits of mixPlotHash(p, (a >> 1) | (b >> 1) << 8 | 2 << 16)   (1.6 m sub-patches)
//      (mixPlotHash = FNV-1a 32 of the 8 LE bytes, as ./ledger; keys are unique because ix is in the low bits);
//   3. K = max(1, floor((owned * s + 500) / 1000)) (round half up; never 0, so a cover plot can never be polished
//      without being cleaned);
//   4. the K owned texels with the LARGEST keys are dusty.
// Mass: a dusty texel has the areal density of a fully covered plot of the same level, so mgPerUnit is the full plot's
// floor(mass(level, area) / (16 x level x owned)) and the cover holds about s / 1000 of that plot's mass (never the full
// plot mass squeezed into the dusty texels). Thresholds use initialUnits = 16 x level x K.
//
// Changing anything above changes ledger bytes of cover plots: bump DUST_INIT_REVISION and record the change.
// Revision 0 is the uniform world (every owned texel at the class level); saves written by revision-0 builds load
// through the restore clamp (installLedger): stored texels outside the cover become 0 and dusty ones are clamped to
// 16 x level, which never mints removal credit or a Stamp (see docs/agent-reports/M1-apron-cover.md).

import { FNV1A_32_OFFSET_BASIS, FNV1A_32_PRIME } from "@moon-cleanup/shared";

/** FNV-1a 32 of (plot u32 LE, value u32 LE), unsigned: the same function as ./ledger `mixPlotHash` (no import cycle). */
function mixPlotHash(plot: number, value: number): number {
  let h = FNV1A_32_OFFSET_BASIS | 0;
  h = Math.imul(h ^ (plot & 0xff), FNV1A_32_PRIME);
  h = Math.imul(h ^ ((plot >>> 8) & 0xff), FNV1A_32_PRIME);
  h = Math.imul(h ^ ((plot >>> 16) & 0xff), FNV1A_32_PRIME);
  h = Math.imul(h ^ (plot >>> 24), FNV1A_32_PRIME);
  h = Math.imul(h ^ (value & 0xff), FNV1A_32_PRIME);
  h = Math.imul(h ^ ((value >>> 8) & 0xff), FNV1A_32_PRIME);
  h = Math.imul(h ^ ((value >>> 16) & 0xff), FNV1A_32_PRIME);
  h = Math.imul(h ^ (value >>> 24), FNV1A_32_PRIME);
  return h >>> 0;
}

/** Revision of the initial dust recipe (0 = uniform world before the Landing Apron cover). */
export const DUST_INIT_REVISION = 1;

/** One group of plots with an initial partial cover. */
export interface DustCoverSpec {
  /** Plot ids (duplicates are ignored). */
  readonly plots: readonly number[];
  /** Dust level of the dusty texels (integer 1 .. LEDGER_MAX_DUST_LEVEL). */
  readonly level: number;
  /** Share of the owned texels that start dusty, in per mille (integer 1 .. 1000; 1000 = full cover). */
  readonly permille: number;
}

/** Sort key of texel (a, b) of `plot` (recipe step 2): larger keys become dusty first. */
export function coverKey(plot: number, a: number, b: number): number {
  const coarse = mixPlotHash(plot, (a >> 2) | ((b >> 2) << 8) | (1 << 16)) >>> 22;
  const fine = mixPlotHash(plot, (a >> 1) | ((b >> 1) << 8) | (2 << 16)) >>> 22;
  return (coarse << 20) | (fine << 10) | (b * 32 + a);
}

/** Dusty texels of a cover plot with `owned` owned texels (recipe step 3). */
export function coverTexelTarget(owned: number, permille: number): number {
  if (owned <= 0) return 0;
  const k = Math.floor((owned * permille + 500) / 1000);
  return k < 1 ? 1 : k > owned ? owned : k;
}
