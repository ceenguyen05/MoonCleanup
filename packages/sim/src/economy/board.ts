// Promotions Board levels and their effects, as the room sim reads them (progression-and-economy section 6; effect
// semantics in shared/config/common.schema `NumericEffectSchema`).
//
// The board is shared by the shift (ShiftState.sharedUpgrades: node id -> owned level). Only the highest owned level
// of a node is active and it replaces the lower ones; across nodes one stat resolves to
// `((set ?? base) + sum of add) * product of mul`. A `flag` effect is on while an active level lists it.
//
// The sim consumes these stats today: `stampPremiumLevel`, the `golden_handshake_credit` flag (Inspector's Stamp),
// `cellLevel.<toolId>` and `cellCapacityBonus` (Dust Cells) and `purchaseDiscountFrac` (Rebate). Levels are bought in
// play through `purchase` intents (economy/purchase.ts: price, prerequisites, race resolution, M1-W6-T02) or come
// from a restored Contract (`MoonRoomSimOptions.sharedUpgrades`, the checkpoint).

import type { GameData } from "@moon-cleanup/game-data";

/** Stat of the Stamp Premium level (0 = none, 1 .. stampPremiumMult.length). */
export const STAT_STAMP_PREMIUM_LEVEL = "stampPremiumLevel";
/** Feature flag: the Stamp Premium multiplier also applies to robot-credited (Flock) plots. */
export const FLAG_GOLDEN_HANDSHAKE_CREDIT = "golden_handshake_credit";

interface BoardEffect {
  readonly stat?: string;
  readonly op: "add" | "mul" | "set" | "flag";
  readonly value?: number;
  readonly featureId?: string;
}

/** Stat of the Rebate discount on tools, Dust Cells and vehicles (0.05 = 5 % off). */
export const STAT_PURCHASE_DISCOUNT_FRAC = "purchaseDiscountFrac";
/** Prefix of the Dust Cell level stats (`cellLevel.<toolId>`). */
export const STAT_CELL_LEVEL_PREFIX = "cellLevel.";

/** The board table of one build: node ids in data order, their level counts and effects. */
export class PromotionsBoard {
  readonly nodeIds: readonly string[];
  /** Top level per node (index = node index). */
  readonly maxLevels: readonly number[];
  /** List price per node and level (index level - 1), whole Lumens from game-data. */
  readonly levelCostsLm: readonly (readonly number[])[];
  /** True for a Dust Cell line (a level sets a `cellLevel.<toolId>` stat): Rebate discounts it. */
  readonly isCellNode: readonly boolean[];
  private readonly levelEffects: readonly (readonly (readonly BoardEffect[])[])[];
  /**
   * Prerequisites per node, compiled: each entry is a list of alternatives `[nodeIndex, level]` (one for a plain
   * entry, several for `anyOf`). Node index -1 is the hub (Employee Badge, owned from the start).
   */
  private readonly prereqs: readonly (readonly (readonly (readonly [number, number])[])[])[];
  private readonly indexById = new Map<string, number>();

  constructor(data: GameData) {
    const table = data["promotions-board"];
    const nodes = table.nodes;
    this.nodeIds = nodes.map((n) => n.id);
    this.maxLevels = nodes.map((n) => n.levels.length);
    this.levelCostsLm = nodes.map((n) => n.levels.map((l) => l.costLm));
    this.levelEffects = nodes.map((n) => n.levels.map((l) => l.effects as readonly BoardEffect[]));
    this.isCellNode = this.levelEffects.map((lv) =>
      lv.some((effects) => effects.some((e) => e.stat?.startsWith(STAT_CELL_LEVEL_PREFIX) === true)),
    );
    nodes.forEach((n, k) => this.indexById.set(n.id, k));
    // Unknown prerequisite ids cannot pass the schema (cross-checked in shared/config); -2 would never be met.
    const ref = (id: string): number => (id === table.hubId ? -1 : (this.indexById.get(id) ?? -2));
    this.prereqs = nodes.map((n) =>
      n.prereqs.map((p) => ("anyOf" in p ? p.anyOf : [p]).map((a) => [ref(a.nodeId), a.level] as const)),
    );
  }

  /** True when every prerequisite of node `n` is met by `levels` (the hub always is). */
  prereqsMet(levels: ArrayLike<number>, n: number): boolean {
    const entries = this.prereqs[n];
    if (entries === undefined) return false;
    for (const alternatives of entries) {
      let met = false;
      for (const [k, level] of alternatives) {
        if (k === -1 || (k >= 0 && (levels[k] ?? 0) >= level)) {
          met = true;
          break;
        }
      }
      if (!met) return false;
    }
    return true;
  }

  get count(): number {
    return this.nodeIds.length;
  }

  /** Node index of `id`, or -1 for an id this build does not know. */
  indexOf(id: string): number {
    return this.indexById.get(id) ?? -1;
  }

  /** A stat over every active level: `((set ?? base) + sum of add) * product of mul`. */
  stat(levels: ArrayLike<number>, stat: string, base: number): number {
    let set: number | undefined;
    let add = 0;
    let mul = 1;
    for (let n = 0; n < this.levelEffects.length; n++) {
      const level = levels[n] ?? 0;
      if (level <= 0) continue;
      const effects = this.levelEffects[n]![Math.min(level, this.maxLevels[n]!) - 1]!;
      for (const e of effects) {
        if (e.stat !== stat || e.value === undefined) continue;
        if (e.op === "set") set = e.value;
        else if (e.op === "add") add += e.value;
        else if (e.op === "mul") mul *= e.value;
      }
    }
    return ((set ?? base) + add) * mul;
  }

  /** True while an active level lists the `flag` effect `featureId`. */
  flag(levels: ArrayLike<number>, featureId: string): boolean {
    for (let n = 0; n < this.levelEffects.length; n++) {
      const level = levels[n] ?? 0;
      if (level <= 0) continue;
      const effects = this.levelEffects[n]![Math.min(level, this.maxLevels[n]!) - 1]!;
      for (const e of effects) if (e.op === "flag" && e.featureId === featureId) return true;
    }
    return false;
  }

  /** Node levels as a record of the owned nodes (level > 0), in data order (ShiftState.sharedUpgrades). */
  toRecord(levels: ArrayLike<number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (let n = 0; n < this.nodeIds.length; n++) {
      const level = levels[n] ?? 0;
      if (level > 0) out[this.nodeIds[n]!] = level;
    }
    return out;
  }
}
