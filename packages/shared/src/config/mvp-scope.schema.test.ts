import { describe, expect, it } from "vitest";
import { MVP_SCOPE, MvpScopeSchema } from "./mvp-scope.schema";

describe("MVP scope", () => {
  it("parses and round-trips", () => {
    const parsed = MvpScopeSchema.parse(MVP_SCOPE);
    expect(parsed).toEqual(MVP_SCOPE);
    expect(MvpScopeSchema.parse(JSON.parse(JSON.stringify(MVP_SCOPE)))).toEqual(MVP_SCOPE);
  });

  it("has the counts of scope-tiers section 1", () => {
    expect(MVP_SCOPE.toolIds).toHaveLength(4);
    expect(MVP_SCOPE.boardNodeIds).toHaveLength(10);
    expect(MVP_SCOPE.vehicleIds).toEqual(["vehicle.trundle"]);
    expect(MVP_SCOPE.robotIds).toEqual(["robot.sandpiper"]);
    expect(MVP_SCOPE.achievementIds).toHaveLength(3);
    expect(MVP_SCOPE.roostCap).toBe(3);
    expect(MVP_SCOPE.nearParcelCount).toBe(6);
  });

  it("rejects wrong prefixes, duplicates, empty lists and unknown keys", () => {
    const bad: unknown[] = [
      { ...MVP_SCOPE, toolIds: ["vehicle.trundle"] },
      { ...MVP_SCOPE, toolIds: ["tool.desk_duster", "tool.desk_duster"] },
      { ...MVP_SCOPE, boardNodeIds: [] },
      { ...MVP_SCOPE, suitGearMaxLevel: { "tool.x": 1 } },
      { ...MVP_SCOPE, roostCap: 0 },
      { ...MVP_SCOPE, extra: 1 },
    ];
    for (const value of bad) expect(MvpScopeSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });
});
