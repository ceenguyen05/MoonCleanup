import { describe, expect, it } from "vitest";
import { laneLaunch, parseArgs, portsFor, sceneUrl } from "./harness";
import { captureFileName, cropFileName, pngSize } from "./naming";

describe("naming (visual-target 6.6 examples)", () => {
  const base = { tier: "A", preset: "high", backend: "webgpu", hud: "nohud" } as const;
  it("matches the spec examples", () => {
    expect(
      captureFileName({ ...base, scene: "S02", tod: "noon", width: 1920, height: 1080, dpr: 1, scale: "floor" }),
    ).toBe("S02-noon-tierA-high-webgpu-1920x1080@1-nohud-floor.png");
    expect(
      captureFileName({
        ...base,
        scene: "S01a",
        tod: "dawn",
        tier: "B",
        preset: "medium",
        hud: "hud",
        width: 1920,
        height: 1080,
        dpr: 1,
        scale: "floor",
      }),
    ).toBe("S01a-dawn-tierB-medium-webgpu-1920x1080@1-hud-floor.png");
    expect(captureFileName({ ...base, scene: "S12", tod: "noon", hud: "hud", width: 2560, height: 1600, dpr: 2 })).toBe(
      "S12-noon-tierA-high-webgpu-2560x1600@2-hud.png",
    );
    expect(
      captureFileName({
        ...base,
        scene: "S03",
        tod: "noon",
        width: 1920,
        height: 1080,
        dpr: 1,
        scale: "floor",
        variant: "10m",
      }),
    ).toBe("S03-noon-tierA-high-webgpu-1920x1080@1-nohud-floor-10m.png");
    expect(
      captureFileName({
        ...base,
        scene: "S02",
        tod: "noon",
        tier: "C",
        preset: "low",
        backend: "webgl2",
        width: 1920,
        height: 1080,
        dpr: 1,
        scale: "floor",
      }),
    ).toBe("S02-noon-tierC-low-webgl2-1920x1080@1-nohud-floor.png");
    expect(cropFileName("S02-noon-tierA-high-webgpu-1920x1080@1-nohud-floor.png", "edge", 812, 604)).toBe(
      "crop/S02-noon-tierA-high-webgpu-1920x1080@1-nohud-floor-edge-x812y604.png",
    );
  });
  it("PNG size = CSS x DPR", () => {
    expect(pngSize(1280, 800, 2)).toEqual({ width: 2560, height: 1600 });
    expect(pngSize(1280, 720, 1.5)).toEqual({ width: 1920, height: 1080 });
  });
});

describe("harness helpers", () => {
  it("builds scene URLs with the documented params", () => {
    const u = new URL(
      sceneUrl("http://localhost:5178/", {
        scene: "S02",
        tod: "noon",
        tier: "A",
        preset: "high",
        backend: "webgl2",
        cssWidth: 1920,
        cssHeight: 1080,
        dpr: 2,
        hud: "nohud",
        seed: "vt-standard-01",
        view: 3,
        stepFrames: 64,
      }),
    );
    expect(Object.fromEntries(u.searchParams)).toEqual({
      scene: "s02",
      variant: "noon",
      backend: "webgl2",
      preset: "high",
      dpr: "2",
      tier: "A",
      tod: "noon",
      seed: "vt-standard-01",
      hud: "0",
      view: "3",
      capture: "1",
    });
  });
  it("maps tod to the scene's own knobs, S12 to hud-test, S01a to view a", () => {
    const base = {
      tier: "A",
      preset: "high",
      backend: "webgpu",
      cssWidth: 1920,
      cssHeight: 1080,
      dpr: 1,
      hud: "nohud",
      seed: "x",
    } as const;
    const q = (scene: string, tod: "dawn" | "noon" | "night-near") =>
      Object.fromEntries(new URL(sceneUrl("http://h/", { ...base, scene, tod })).searchParams);
    expect(q("S01", "dawn")).toMatchObject({ scene: "s01", time: "dawn" });
    expect(q("S01", "noon")).toMatchObject({ scene: "s01", time: "noon" });
    expect(q("S01a", "dawn")).toMatchObject({ scene: "s01", time: "dawn", view: "a" });
    expect(q("S05", "dawn")).toMatchObject({ scene: "s05", sun: "4" });
    expect(q("S12", "noon")).toMatchObject({ scene: "hud-test" });
  });
  it("fails loudly for an unsupported scene or tod", () => {
    const base = {
      tier: "A",
      preset: "high",
      backend: "webgpu",
      cssWidth: 1,
      cssHeight: 1,
      dpr: 1,
      hud: "nohud",
      seed: "x",
    } as const;
    expect(() => sceneUrl("http://h/", { ...base, scene: "S03", tod: "dawn" })).toThrow(/does not support tod/);
    expect(() => sceneUrl("http://h/", { ...base, scene: "S99", tod: "noon" })).toThrow(/not in the harness registry/);
    expect(() => sceneUrl("http://h/", { ...base, scene: "S99", tod: "noon", allowUnverifiedTod: true })).not.toThrow();
  });
  it("lanes: ci is headless software WebGL2, gpu is headed Chrome", () => {
    expect(laneLaunch("ci")).toMatchObject({ headless: true, forcedBackend: "webgl2" });
    expect(laneLaunch("ci").args).toContain("--use-angle=swiftshader");
    expect(laneLaunch("gpu")).toMatchObject({ headless: false, channel: "chrome" });
  });
  it("ports follow the agent offset scheme", () => {
    expect(portsFor(5)).toEqual({ client: 5178, server: 2572 });
  });
  it("parseArgs", () => {
    const a = parseArgs(
      ["S01,S02", "--lane", "gpu", "--port-offset=5", "--turntable", "--out", "/c/x/y"],
      {},
      {
        platform: "win32",
        cwd: "C:\repo",
      },
    );
    expect(a).toMatchObject({
      lane: "gpu",
      scenes: ["S01", "S02"],
      mode: "turntable",
      baseUrl: "http://localhost:5178/",
    });
  });
});
