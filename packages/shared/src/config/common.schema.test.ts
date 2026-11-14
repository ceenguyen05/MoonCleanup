import { describe, expect, it } from "vitest";
import {
  EffectSchema,
  FeatureIdSchema,
  GAME_DATA_TABLES,
  GameDataIdSchema,
  GameDataSchemaVersionSchema,
  NUMERIC_EFFECT_OPS,
} from "./common.schema";

describe("config common schemas v0", () => {
  it("accepts schemaVersion 1 only", () => {
    expect(GameDataSchemaVersionSchema.parse(1)).toBe(1);
    expect(GameDataSchemaVersionSchema.safeParse(2).success).toBe(false);
  });

  it("accepts dot-namespaced ids and rejects others", () => {
    for (const id of ["tool.desk_duster", "tool.lane_broom", "vehicle.carryall", "node.storage.l2"]) {
      expect(GameDataIdSchema.parse(id)).toBe(id);
    }
    for (const id of ["tool", "Tool.desk", "tool.", ".tool", "tool..x", "tool.desk-duster", "tool desk"]) {
      expect(GameDataIdSchema.safeParse(id).success, id).toBe(false);
    }
    expect(FeatureIdSchema.parse("overflow_former")).toBe("overflow_former");
    expect(FeatureIdSchema.safeParse("feature.x").success).toBe(false);
  });

  it("parses and round-trips both effect kinds", () => {
    const effects = [
      { stat: "walkMps", op: "mul", value: 1.1 },
      { op: "flag", featureId: "punch_list" },
    ];
    for (const effect of effects) {
      expect(EffectSchema.parse(JSON.parse(JSON.stringify(effect)))).toEqual(effect);
    }
    expect(EffectSchema.safeParse({ stat: "walkMps", op: "pow", value: 2 }).success).toBe(false);
    for (const op of NUMERIC_EFFECT_OPS) expect(EffectSchema.parse({ stat: "walkMps", op, value: 2 })).toBeTruthy();
    expect(NUMERIC_EFFECT_OPS).toEqual(["add", "mul", "set"]);
    expect(EffectSchema.safeParse({ op: "flag" }).success).toBe(false);
  });

  it("lists baseline tables only (no optional section 24 files)", () => {
    expect(new Set(GAME_DATA_TABLES).size).toBe(GAME_DATA_TABLES.length);
    for (const optional of ["flight-plan", "on-shift-bonus", "performance-reviews", "meta", "shift-docket"]) {
      expect(GAME_DATA_TABLES as readonly string[]).not.toContain(optional);
    }
  });
});
