// The bench's look seam (M0-W3-T07 follow-up): `?look=` parsing, the scene driving an injected look, and both real looks
// building / switching preset / disposing without a GPU.

import { describe, expect, it } from "vitest";
import { vec4 } from "three/tsl";
import { Vector3, type PerspectiveCamera } from "three/webgpu";
import { QUALITY_PRESETS, type FrameInfo, type QualitySettings } from "@moon-cleanup/shared";
import type { RenderRendererService } from "../module";
import type { RenderQualityService } from "../quality-service";
import { createSceneRoots } from "../scene-roots";
import { BenchScene, type BenchHookTarget } from "./bench-scene";
import { createBenchLook } from "./look-factory";
import { parseBenchOptions } from "./options";
import { BENCH_DEFAULT_LOOK, parseBenchLook, type LookProvider } from "./look";
import type { PipelineStages } from "../pipeline";

function fakeRenderer(installed: (PipelineStages | null)[]): RenderRendererService {
  return {
    backend: "webgl2",
    tier: "B",
    renderScale: 1,
    renderer: null,
    onRecreated: () => () => undefined,
    setPipelineStages: (stages: PipelineStages | null) => {
      installed.push(stages);
    },
    readStats: (out: { drawCalls: number; triangles: number }) => {
      out.drawCalls = 0;
      out.triangles = 0;
    },
  } as unknown as RenderRendererService;
}

function fakeQuality(settings: QualitySettings): RenderQualityService {
  return { current: settings, capabilities: { reversedDepth: true } } as unknown as RenderQualityService;
}

function frame(settings: QualitySettings): FrameInfo {
  return { dt: 1 / 60, time: 1, alpha: 0, simTick: 0, quality: settings } as unknown as FrameInfo;
}

describe("?look= option", () => {
  it("defaults to the visuals rig, v0 is selectable, junk falls back", () => {
    expect(BENCH_DEFAULT_LOOK).toBe("visuals");
    expect(parseBenchLook("?scene=bench")).toBe("visuals");
    expect(parseBenchLook("?look=v0")).toBe("v0");
    expect(parseBenchLook("?look=V0")).toBe("v0");
    expect(parseBenchLook("?look=visuals")).toBe("visuals");
    expect(parseBenchLook("?look=nope")).toBe("visuals");
    expect(parseBenchOptions("?look=v0").look).toBe("v0");
    expect(parseBenchOptions("?scene=bench").look).toBe("visuals");
  });
});

describe("BenchScene on a LookProvider", () => {
  it("builds the look from ?look=, applies the preset once, updates it per frame and disposes it", () => {
    const calls: string[] = [];
    const ids: string[] = [];
    let ownsSky = true;
    const fake: LookProvider = {
      id: "visuals",
      get ownsSky() {
        return ownsSky;
      },
      keyDirection: new Vector3(0, 1, 0),
      applyQuality: (s) => calls.push(`apply:${s.preset}`),
      update: () => calls.push("update"),
      postPasses: () => ["scene", "fake"],
      cascadeCount: () => 3,
      dispose: () => calls.push("dispose"),
    };
    const installed: (PipelineStages | null)[] = [];
    const roots = createSceneRoots();
    const target: BenchHookTarget = {};
    const settings = QUALITY_PRESETS.medium;
    const scene = new BenchScene({
      roots,
      renderer: fakeRenderer(installed),
      quality: fakeQuality(settings),
      search: "?scene=bench&terrain=standin&look=v0",
      log: () => undefined,
      target,
      lookFactory: (id) => {
        ids.push(id);
        return fake;
      },
    });
    expect(ids).toEqual(["v0"]);
    scene.update(frame(settings));
    scene.update(frame(settings));
    expect(calls).toEqual(["apply:medium", "update", "update"]);
    const stats = scene.stats();
    expect(stats.look).toBe("visuals");
    expect(stats.cascades).toBe(3);
    expect(stats.postPasses).toEqual(["scene", "fake"]);
    const sky = roots.sky.getObjectByName("mc:bench-sky");
    expect(sky?.visible).toBe(false);
    ownsSky = false;
    scene.dispose();
    expect(calls[calls.length - 1]).toBe("dispose");
    expect(target.__mcBench).toBeUndefined();
  }, 60_000);
});

describe("visuals look: star layer and Low anti-aliasing", () => {
  it("moves the star mesh to the post-resolve layer on TRAA presets and back into the sky group otherwise", () => {
    const installed: (PipelineStages | null)[] = [];
    const roots = createSceneRoots();
    const look = createBenchLook("visuals", { roots, renderer: fakeRenderer(installed) });
    const inSky = (): boolean => roots.sky.getObjectByName("mc:star-field") !== undefined;

    look.applyQuality(QUALITY_PRESETS.high);
    expect(inSky()).toBe(false);
    look.applyQuality(QUALITY_PRESETS.medium);
    expect(inSky()).toBe(true);
    look.applyQuality(QUALITY_PRESETS.ultra);
    expect(inSky()).toBe(false);
    look.applyQuality(QUALITY_PRESETS.low);
    expect(inSky()).toBe(true);
    look.dispose();
    expect(inSky()).toBe(false);
  });

  it("?stars=scene keeps the stars in the scene pass on a TRAA preset", () => {
    const roots = createSceneRoots();
    const look = createBenchLook("visuals", { roots, renderer: fakeRenderer([]), search: "?stars=scene" });
    look.applyQuality(QUALITY_PRESETS.high);
    expect(roots.sky.getObjectByName("mc:star-field")).toBeDefined();
    look.dispose();
  });

  it("Low builds the FXAA display stage by default; ?aa=none drops it", () => {
    const build = (search: string): readonly string[] => {
      const installed: (PipelineStages | null)[] = [];
      const roots = createSceneRoots();
      const look = createBenchLook("visuals", { roots, renderer: fakeRenderer(installed), search });
      look.applyQuality(QUALITY_PRESETS.low);
      const stages = installed[installed.length - 1];
      stages?.display?.(vec4(0, 0, 0, 1) as never, {} as never);
      const passes = look.postPasses().slice();
      look.dispose();
      return passes;
    };
    expect(build("")).toEqual(["fxaa"]);
    expect(build("?aa=none")).toEqual([]);
  });
});

describe.each(["visuals", "v0"] as const)("real look %s", (id) => {
  it("constructs, rebuilds on a preset change, updates, and disposes with its pipeline stages released", () => {
    const installed: (PipelineStages | null)[] = [];
    const roots = createSceneRoots();
    const look = createBenchLook(id, { roots, renderer: fakeRenderer(installed) });
    expect(look.id).toBe(id);
    expect(look.ownsSky).toBe(id === "visuals");
    expect(look.keyDirection.length()).toBeCloseTo(1, 5);
    look.applyQuality(QUALITY_PRESETS.medium);
    expect(look.cascadeCount()).toBe(QUALITY_PRESETS.medium.shadows.cascades);
    look.update(frame(QUALITY_PRESETS.medium), roots.camera as PerspectiveCamera);
    look.applyQuality(QUALITY_PRESETS.ultra);
    expect(look.cascadeCount()).toBe(QUALITY_PRESETS.ultra.shadows.cascades);
    expect(installed.filter((s) => s !== null)).toHaveLength(2);
    const lightsBefore = roots.scene.children.length;
    expect(lightsBefore).toBeGreaterThan(0);
    look.dispose();
    expect(installed[installed.length - 1]).toBeNull();
    expect(roots.scene.children.some((c) => c.name.startsWith("mc:key-light") || c.name === "mc:bench-sun-light")).toBe(
      false,
    );
  });
});
