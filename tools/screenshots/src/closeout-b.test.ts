import { describe, expect, it } from "vitest";
import { parseArgs } from "./harness";
import { resolveScene, todSetup } from "./scenes/registry";
import { sidecarExtras, type LookInfoLike } from "./sidecar";

describe("T05b leftovers", () => {
  it("bare -- (pnpm) does not swallow the scene id", () => {
    expect(parseArgs(["--", "S05", "--lane", "gpu"]).scenes).toEqual(["S05"]);
  });
  it("typical is a registered scene with a verified noon sun", () => {
    expect(resolveScene("typical")?.entry.urlScene).toBe("typical");
    expect(todSetup("typical", "noon").setup.sunElevationDeg).toBe(38);
  });
  it("optional hook fields are copied when a build reports them", () => {
    const look = { shadowMapSize: 2048, particlePool: 512 } as unknown as LookInfoLike;
    const x = sidecarExtras({ dustRingTexelCm: 2.5 }, look, null);
    expect(x.knobs["shadowMapSize"]).toBe(2048);
    expect(x.knobs["dustRingTexelCm"]).toBe(2.5);
    expect(x.knobs["notReported"]).toEqual(["adaptationMultiplier"]);
  });
});
