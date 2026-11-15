// Selling dust (M1-W6-T02; progression-and-economy sections 2 and 10, game-feel section 3.6):
//
//   Assay Counter: hold E within reach of a free pour slot (logistics `assayCounter.pourSlots`). The Cell drains
//     linearly: a full Cell takes `assayCounter.pourS` x Quick Pour (board `pourTimeMult`). Poured grams are sold as
//     they drain, so the Lumens tick up live; `cargo.sold` closes each pour with its total.
//   Receiving Gate (Dump Plate): a loose Dust Puck / Puck Stack that reaches a Gate's plate is sold on arrival.
//     Despawned pucks (cargo `pendingGateGrams`, already value-weighted) are sold into the first Gate.
//   Railshot: every `railshotEveryKg` sold at the outpost fires `railshot.fired` (event only in MVP).
//
// Price = material `lmPerKg` x (1 + board `payoutBonus`). Lumens stay whole: each seller carries a micro-Lumen
// remainder, so splitting a sale into ticks pays what the unsplit sale pays (floor of the running total).
//
// Every number comes from game-data except the reach / plate radii below, which are interaction geometry from the
// feel spec (no data table carries them yet), and the stand-in outpost layout (no outpost layout exists yet).

import type { GameData } from "@moon-cleanup/game-data";

/** Hold-E reach to an Assay Counter pour slot (game-feel section 3.6: "within 2.5 m"). */
export const ASSAY_POUR_REACH_M = 2.5;
/** A loose puck within this distance of a Receiving Gate is on its Dump Plate. */
export const DUMP_PLATE_RADIUS_M = 2;
/** Entity ids of outpost services (sell points) start here, far above cargo ids. */
export const SERVICE_ENTITY_ID_BASE = 0x7fff0000;
/** Board stats read by selling. */
export const STAT_PAYOUT_BONUS = "payoutBonus";
export const STAT_POUR_TIME_MULT = "pourTimeMult";
/** Material sold by pours and Gates (raw regolith dust). */
export const DUST_MATERIAL_ID = "material.regolith_dust";

export type SellPointKind = "assay_counter" | "receiving_gate";

/** One outpost service that buys dust: a unit direction from the Moon centre (ground position along it). */
export interface SellPoint {
  readonly kind: SellPointKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Stand-in Outpost Boreal layout until the outpost layout lands (world / visuals): the Assay Counter on the pole pad
 * and four Receiving Gates 15 m north, east, south and west of it.
 */
export function borealStandInSellPoints(moonRadiusM: number): readonly SellPoint[] {
  const d = 15 / moonRadiusM;
  const unit = (x: number, y: number, z: number): SellPoint => {
    const l = Math.sqrt(x * x + y * y + z * z);
    return { kind: "receiving_gate", x: x / l, y: y / l, z: z / l };
  };
  return [{ kind: "assay_counter", x: 0, y: 1, z: 0 }, unit(0, 1, -d), unit(d, 1, 0), unit(0, 1, d), unit(-d, 1, 0)];
}

/** Selling numbers of one build, from game-data. */
export interface SellRules {
  readonly dustLmPerKg: number;
  readonly pourSlots: number;
  readonly pourS: number;
  readonly railshotEveryGrams: number;
}

export function createSellRules(data: GameData): SellRules {
  const dust = data.economy.materials.find((m) => m.id === DUST_MATERIAL_ID);
  if (!dust) throw new Error(`game-data has no ${DUST_MATERIAL_ID}`);
  return {
    dustLmPerKg: dust.lmPerKg,
    pourSlots: data.logistics.assayCounter.pourSlots,
    pourS: data.logistics.assayCounter.pourS,
    railshotEveryGrams: data.logistics.railshotEveryKg * 1000,
  };
}

/**
 * Micro-Lumens for `grams` of a material at `lmPerKg` x `payoutMult` (LM per kg = 1000 uLM per gram), rounded to a
 * whole micro-Lumen so a sale split into ticks adds up to the unsplit sale (error under 1 uLM per tick).
 */
export function saleMicroLm(grams: number, lmPerKg: number, payoutMult: number): number {
  const v = Math.round(grams * lmPerKg * payoutMult * 1000);
  return v > 0 ? v : 0;
}

/** Grams one pour tick drains from a Cell of `capGrams`: a full Cell takes `pourS` (at least 1 g per tick). */
export function pourGramsPerTick(capGrams: number, pourS: number, tickHz: number): number {
  const ticks = pourS * tickHz;
  return ticks <= 1 ? capGrams : Math.max(1, Math.ceil(capGrams / ticks));
}
