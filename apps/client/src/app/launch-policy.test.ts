import { describe, expect, it } from "vitest";
import {
  integratedGpuPreset,
  launchSearch,
  planScene,
  wantsAudio,
  wantsHostDustFeed,
  wantsSoloHost,
  wantsTimestampQueries,
} from "./launch-policy";

describe("wantsSoloHost / wantsAudio", () => {
  it("starts the Solo host for the game launch and the hello world, not for harness scenes or capture", () => {
    for (const search of ["", "?scene=smoke", "?scene=hud-test", "?perf=1"]) expect(wantsSoloHost(search)).toBe(true);
    for (const search of ["?scene=bench", "?scene=s01", "?scene=verify", "?capture=1", "?capture=1&scene=nope"]) {
      expect(wantsSoloHost(search)).toBe(false);
    }
  });
  it("lets ?solo=0|1 override the default", () => {
    expect(wantsSoloHost("?solo=0")).toBe(false);
    expect(wantsSoloHost("?scene=s01&solo=1")).toBe(true);
  });
  it("starts the host for the dust scene (fed by it) unless ?solo=0 or capture", () => {
    expect(wantsSoloHost("?scene=dust")).toBe(true);
    expect(wantsHostDustFeed("?scene=dust")).toBe(true);
    expect(wantsHostDustFeed("?scene=DUST&warm=0")).toBe(true);
    for (const search of ["?scene=dust&solo=0", "?scene=dust&capture=1", "?scene=s01", "", "?solo=1"]) {
      expect(wantsHostDustFeed(search)).toBe(false);
    }
    expect(wantsHostDustFeed("?scene=dust&capture=1&solo=1")).toBe(true);
  });
  it("registers audio unless ?audio=0 or capture mode", () => {
    expect(wantsAudio("")).toBe(true);
    expect(wantsAudio("?scene=s01")).toBe(true);
    expect(wantsAudio("?audio=0")).toBe(false);
    expect(wantsAudio("?capture=1")).toBe(false);
  });
});

describe("planScene", () => {
  it("keeps the smoke mesh for hello world, smoke, hud-test and unknown ids", () => {
    for (const search of ["", "?scene=smoke", "?scene=hud-test", "?scene=nope"]) {
      expect(planScene(search).smokeScene).toBe(true);
    }
  });
  it("hands bench, verify and the visuals scenes their own stage", () => {
    for (const id of ["bench", "verify", "s01", "s02", "s03", "s05", "s06", "typical", "dust", "S01"]) {
      expect(planScene(`?scene=${id}`).smokeScene).toBe(false);
    }
  });
  it("routes S02, S03 and the typical worksite through the visuals module (M0-W3-T08)", () => {
    for (const id of ["s01", "s02", "s03", "typical"]) expect(planScene(`?scene=${id}`).unrouted).toBe(false);
  });
});

describe("wantsTimestampQueries", () => {
  const base = { perfEnabled: true, search: "", hasNavigatorGpu: true };
  it("asks only for the WebGPU path", () => {
    expect(wantsTimestampQueries(base)).toBe(true);
    expect(wantsTimestampQueries({ ...base, search: "?backend=webgl2" })).toBe(false);
    expect(wantsTimestampQueries({ ...base, hasNavigatorGpu: false })).toBe(false);
    expect(wantsTimestampQueries({ ...base, perfEnabled: false })).toBe(false);
  });
});

describe("integratedGpuPreset", () => {
  it("drops an integrated GPU to Low unless the choice is explicit", () => {
    expect(integratedGpuPreset({ gpuClass: "integrated", current: "medium", explicit: false })).toBe("low");
    expect(integratedGpuPreset({ gpuClass: "integrated", current: "high", explicit: false })).toBe("low");
    expect(integratedGpuPreset({ gpuClass: "integrated", current: "low", explicit: false })).toBeNull();
    expect(integratedGpuPreset({ gpuClass: "integrated", current: "high", explicit: true })).toBeNull();
    expect(integratedGpuPreset({ gpuClass: "discrete", current: "high", explicit: false })).toBeNull();
    expect(integratedGpuPreset({ gpuClass: "unknown", current: "medium", explicit: false })).toBeNull();
  });
});

describe("launchSearch (security review N8)", () => {
  const crafted = "?scene=bench&terrainBase=https://attacker.example/&terrain=https://attacker.example/&perf=1";
  it("drops terrainBase and terrain in production builds and keeps every other param", () => {
    const out = new URLSearchParams(launchSearch(crafted, true));
    expect(out.has("terrainBase")).toBe(false);
    expect(out.has("terrain")).toBe(false);
    expect(out.get("scene")).toBe("bench");
    expect(out.get("perf")).toBe("1");
    expect(launchSearch("?terrain=x", true)).toBe("");
  });
  it("passes the search through unchanged in dev builds or when nothing is removed", () => {
    expect(launchSearch(crafted, false)).toBe(crafted);
    expect(launchSearch("?scene=s01&preset=low", true)).toBe("?scene=s01&preset=low");
    expect(launchSearch("", true)).toBe("");
  });
});
