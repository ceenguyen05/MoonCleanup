// Derived constants and rate formulas of the MVP pacing model (progression-and-economy.md section 22.2 / 22.3).
// Everything numeric comes from the game-data tables; the few model constants that the doc keeps in prose
// (coverage, prompt time, vehicle unload trip, ...) are collected in MODEL_CONSTANTS and printed in every report.
import type { GameData } from "@moon-cleanup/game-data";

export interface ModelConstants {
  /** Share of the swept width that actually counts (economy section 4). */
  readonly handCoverage: number;
  /** Same for vehicles (section 8). */
  readonly vehicleCoverage: number;
  /** Induction prompts at the start: no sweeping (section 18.2 step 1). */
  readonly promptsS: number;
  /** Walk distance to the Assay Counter from the Landing Apron (section 22.2). */
  readonly apronTripM: number;
  /** Outpost-ground trip distance is `outpostTripBaseM + sqrt(A / pi)`, A = area cleaned off the Apron per player. */
  readonly outpostTripBaseM: number;
  /** Vehicle round trip to the Motor Pool Dump Plate and back, unload included (section 22.2). */
  readonly vehicleTripS: number;
  /** Share of player-swept area that ends Polished and earns a Stamp (section 22.4). */
  readonly polishedFrac: number;
  /** Per-extra-player crowding at one outpost before a Puck Former; the MVP has none (section 19.1). */
  readonly crowding: number;
  /** Near Parcel pick-ups: clock times in minutes and time cost each (section 22.4). */
  readonly parcelTimesMin: readonly number[];
  readonly parcelCollectS: number;
  /** Non-rate purchases wait until wallet >= multiple x cost (6 before `nonRateRelaxAfterH`, 3 after) (section 22.5). */
  readonly nonRateWalletMult: number;
  readonly nonRateWalletMultLate: number;
  readonly nonRateRelaxAfterH: number;
}

export const MODEL_CONSTANTS: ModelConstants = {
  handCoverage: 0.75,
  vehicleCoverage: 0.8,
  promptsS: 60,
  apronTripM: 30,
  outpostTripBaseM: 60,
  vehicleTripS: 100,
  polishedFrac: 0.85,
  crowding: 0.05,
  parcelTimesMin: [15, 25, 32, 40, 48, 55],
  parcelCollectS: 60,
  nonRateWalletMult: 6,
  nonRateWalletMultLate: 3,
  nonRateRelaxAfterH: 4,
};

export interface DustMix {
  readonly shares: readonly { readonly level: number; readonly frac: number }[];
}

export interface WorldModel {
  readonly plotM2: number;
  readonly dustLmPerKg: number;
  readonly kgPerLevel: number;
  readonly apronPlots: number;
  readonly apronPlotM2: number;
  readonly apronMix: DustMix;
  readonly outpostMix: DustMix;
  readonly moonMix: DustMix;
  readonly stampLm: number;
}

export function buildWorldModel(data: GameData): WorldModel {
  const w = data.world;
  const level = new Map(w.terrainClasses.map((t) => [t.id, t.dustLevel]));
  const plotM2 = (4 * Math.PI * w.moonRadiusM ** 2) / w.plotCount;
  const dust = data.economy.materials.find((m) => m.id === "material.regolith_dust");
  if (!dust) throw new Error("economy.json has no material.regolith_dust");
  return {
    plotM2,
    dustLmPerKg: dust.lmPerKg,
    kgPerLevel: w.dustKgPerM2PerLevel,
    apronPlots: w.landingApron.plotsPerOutpost,
    apronPlotM2: plotM2 * w.landingApron.coverageFrac,
    apronMix: { shares: [{ level: w.landingApron.dustLevel, frac: 1 }] },
    outpostMix: {
      shares: w.outpostMix.shares.map((s) => ({ level: level.get(s.terrainId) ?? 0, frac: s.frac })),
    },
    moonMix: { shares: w.terrainClasses.map((t) => ({ level: t.dustLevel, frac: t.plotShareFrac })) },
    stampLm: data.economy.stampBaseLm,
  };
}

/** Mean dust per m^2 of a mix, kg. */
export function kgPerM2(model: WorldModel, mix: DustMix): number {
  return mix.shares.reduce((s, x) => s + x.frac * x.level * model.kgPerLevel, 0);
}

/** Mean passes needed at `depth` levels per pass (economy section 1.1). */
export function passes(mix: DustMix, depth: number): number {
  return mix.shares.reduce((s, x) => s + x.frac * Math.max(1, Math.ceil(x.level / depth)), 0);
}
