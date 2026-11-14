// @contract config/common.schema v1.2
// @consumers packages/game-data (validates every data file, M1), packages/sim (reads validated tables),
//   tools/balance-sim; every per-table `config/<name>.schema.ts` builds on these
//
// Building blocks shared by every balance/content table. Specification: docs/design/progression-and-economy.md
// section 21 (rules list). Reference mode (docs/design/REFERENCE_TARGET.md): tables and fields marked
// "(optional section 24)" are not part of the baseline and have no schema; there are no milestone gate fields.
//
// v0: file-level `schemaVersion`, dot-namespaced ids, the effect shape, the list of baseline table files.
// v1 (additive): id namespaces per table, unit-suffixed number schemas, `TokenSchema`, `ParamsSchema`,
// `CostLevelSchema`, and the `prefixedId` / `uniqueIdArray` schema factories used by the per-table schemas.
// v1.1 (docs + additive constants): effect semantics written down (see `NumericEffectSchema`, `CostLevelSchema`);
// `NUMERIC_EFFECT_OPS`. Contract wave v1.1 also changes robots, economy, movement, vehicles, logistics, traits,
// promotions-board (`anyOf` prereqs), pacing-targets and bundle; `GAME_DATA_SCHEMA_VERSION` stays 1 (additive).
// v1.2 (no change in this file): contract wave v1.2 makes `albatross.rateM2ps`, `economy.trickComboMult`,
// `assayCounter.pourS`, `fieldGate.baleChuteFaces`, `movement.carryUnits` and pacing `milestone` required.
// `GAME_DATA_SCHEMA_VERSION` stays 1: the only data source (packages/game-data) already supplies every field.

import { z } from "zod";

/** Every data file carries `"schemaVersion": 1`. */
export const GAME_DATA_SCHEMA_VERSION = 1;
export const GameDataSchemaVersionSchema = z.literal(GAME_DATA_SCHEMA_VERSION);

/**
 * A dot-namespaced game-data id: lower-case snake_case segments joined by dots, at least two segments
 * (`tool.lane_broom`, `tool.desk_duster`). Ids are never reused; a removed id needs an explicit mapping in game-data.
 */
export const GameDataIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9][a-z0-9_]*)+$/);
export type GameDataId = z.infer<typeof GameDataIdSchema>;

/**
 * First id segment per kind of record. Placeable structures (build pieces, machines, power and logistics pieces,
 * Motor Pool parts) share `piece` so one placed thing has one id in every table that describes it.
 */
export const GAME_DATA_ID_PREFIXES = {
  tool: "tool",
  trait: "trait",
  material: "material",
  terrain: "terrain",
  trick: "trick",
  node: "node",
  department: "department",
  suitGear: "gear",
  vehicle: "vehicle",
  vehicleUpgrade: "vehicle_upgrade",
  robot: "robot",
  piece: "piece",
  finish: "finish",
  survey: "survey",
  onboarding: "onboarding",
  achievement: "achievement",
  pacing: "pacing",
} as const;
export type GameDataIdPrefix = (typeof GAME_DATA_ID_PREFIXES)[keyof typeof GAME_DATA_ID_PREFIXES];

/** A `GameDataIdSchema` whose first segment is `prefix` (`prefixedId("tool")` accepts `tool.lane_broom`). */
export function prefixedId(prefix: GameDataIdPrefix) {
  return GameDataIdSchema.refine((id) => id.startsWith(`${prefix}.`), {
    message: `id must start with "${prefix}."`,
  });
}

/** Lower-camel or snake token used for enum-like strings that game-data owns (tabs, triggers, policies, units). */
export const TokenSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-zA-Z0-9_]*$/);

/** Id of a stat that an effect, achievement or target reads (`walkMps`, `cellCapacityKg`). */
export const StatIdSchema = z.string().min(1).max(64);

/** Unit-suffixed number fields (section 21: `priceLm`, `widthM`, `durationS`, `frac`, `mult`, ...). */
export const NonNegativeNumberSchema = z.number().nonnegative();
export const PositiveNumberSchema = z.number().positive();
/** A 0..1 fraction (`...Frac`). */
export const FracSchema = z.number().min(0).max(1);
/** A multiplier (`...Mult`); always positive. */
export const MultSchema = z.number().positive();
/** A whole amount of Lumens (`priceLm`, `costLm`, rewards); 0 means free. */
export const LmAmountSchema = z.int().nonnegative();
export const CountSchema = z.int().nonnegative();
export const PositiveCountSchema = z.int().positive();
/** An angle in degrees, 0..90 (`...Deg`). */
export const ElevationDegSchema = z.number().min(0).max(90);

/** Free numeric/boolean parameters for records whose extra fields section 21 leaves open (`{id, priceLm, ...}`). */
export const ParamsSchema = z.record(TokenSchema, z.union([z.number(), z.boolean()]));
export type Params = z.infer<typeof ParamsSchema>;

/** Operators of a numeric effect. */
export const NUMERIC_EFFECT_OPS = ["add", "mul", "set"] as const;
export type NumericEffectOp = (typeof NUMERIC_EFFECT_OPS)[number];

/**
 * A numeric effect on a stat. Semantics (the sim and balance-sim must agree):
 * - Only the highest owned level of a line or node is active; it replaces the lower levels, so each level lists the
 *   full value at that level (Dust Cell III `mul 2.5`, not an extra `mul` on top of I and II).
 * - Across all active levels of all lines and nodes, effects on one stat combine as
 *   `((set ?? base) + sum of add values) * product of mul values`: `add` values sum, `mul` values multiply.
 * - `set` replaces the base value before adds and muls apply; data must not give one stat two active `set` effects.
 */
export const NumericEffectSchema = z.strictObject({
  /** Stat id the effect changes. */
  stat: StatIdSchema,
  op: z.enum(NUMERIC_EFFECT_OPS),
  value: z.number(),
});
export type NumericEffect = z.infer<typeof NumericEffectSchema>;

/** Id of a feature in `features.json`: one snake_case word group (`overflow_former`, `punch_list`). */
export const FeatureIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
export type FeatureId = z.infer<typeof FeatureIdSchema>;

/** A qualitative behaviour switch. `featureId` must exist in `features.json` (checked by `GameDataBundleSchema`). */
export const FlagEffectSchema = z.strictObject({
  op: z.literal("flag"),
  featureId: FeatureIdSchema,
});
export type FlagEffect = z.infer<typeof FlagEffectSchema>;

/** An upgrade or node effect (progression-and-economy.md section 21). */
export const EffectSchema = z.union([NumericEffectSchema, FlagEffectSchema]);
export type Effect = z.infer<typeof EffectSchema>;

/**
 * One purchasable level of a line or node: its price and what it changes. No gate fields (reference mode). Owning
 * level N activates level N's `effects` and deactivates levels below N (see `NumericEffectSchema`). Because a level
 * replaces the lower ones, a `flag` effect is repeated on every higher level that keeps it on.
 */
export const CostLevelSchema = z.strictObject({
  costLm: LmAmountSchema,
  effects: z.array(EffectSchema),
});
export type CostLevel = z.infer<typeof CostLevelSchema>;

/** An array of `{id}` records whose ids are unique (duplicate ids are reported at the second occurrence). */
export function uniqueIdArray<T extends z.ZodType<{ id: string }>>(item: T) {
  return z.array(item).superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((entry, index) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({ code: "custom", message: `duplicate id "${entry.id}"`, path: [index, "id"] });
      }
      seen.add(entry.id);
    });
  });
}

/** An array of distinct strings (id lists such as `upgradeLineIds`). */
export function uniqueStringArray<T extends z.ZodType<string>>(item: T) {
  return z.array(item).superRefine((items, ctx) => {
    const seen = new Set<string>();
    items.forEach((entry, index) => {
      if (seen.has(entry)) ctx.addIssue({ code: "custom", message: `duplicate "${entry}"`, path: [index] });
      seen.add(entry);
    });
  });
}

/**
 * Baseline data files in `packages/game-data/data/` (section 21 rows not marked optional). Each has a
 * `<name>.schema.ts`; `GAME_DATA_TABLE_SCHEMAS` maps every entry to its schema.
 */
export const GAME_DATA_TABLES = [
  "world",
  "economy",
  "movement",
  "tools",
  "traits",
  "dust-cells",
  "promotions-board",
  "suit-gear",
  "vehicles",
  "vehicle-upgrades",
  "robots",
  "caps",
  "logistics",
  "production",
  "power",
  "build-pieces",
  "plot-bonus",
  "collectibles",
  "onboarding",
  "achievements",
  "moderation",
  "features",
  "pacing-targets",
] as const;
export type GameDataTable = (typeof GAME_DATA_TABLES)[number];
