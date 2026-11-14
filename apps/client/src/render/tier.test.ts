import { QUALITY_PRESETS, type EventMap } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import gpuClassData from "./gpu-classes.json";
import { QualityController, type RenderCapabilities } from "./quality-service";
import {
  clampPresetToBackend,
  classifyGpu,
  defaultPresetFor,
  maxPresetFor,
  presetBelow,
  resolveQuality,
  tierFor,
  type GpuClassTable,
} from "./tier";
import { parseRenderUrlOptions } from "./url-options";

const table = gpuClassData as GpuClassTable;
const classify = (description: string, vendor = "") => classifyGpu([description], vendor, table);

describe("classifyGpu (gpu-classes.json, rendering-pipeline 2.3)", () => {
  it.each([
    ["Intel(R) UHD Graphics 620", "integrated"],
    ["ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)", "integrated"],
    ["Intel(R) Arc(TM) 140V GPU (16GB)", "integrated"],
    ["Intel(R) Arc(TM) Graphics", "integrated"],
    ["AMD Radeon(TM) Graphics", "integrated"],
    ["AMD Radeon 780M Graphics", "integrated"],
    ["AMD Radeon(TM) Vega 8 Graphics", "integrated"],
    ["ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)", "integrated"],
    ["NVIDIA GeForce RTX 4060 Laptop GPU", "discrete"],
    ["NVIDIA GeForce RTX 4070 Laptop GPU", "discrete"],
    ["NVIDIA GeForce GTX 1650", "discrete"],
    ["AMD Radeon RX 6600M", "discrete"],
    ["AMD Radeon RX 580 Series", "discrete"],
    ["Intel(R) Arc(TM) A770 Graphics", "discrete"],
    ["ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)", "discrete"],
    ["NVIDIA GeForce RTX 4070 Ti SUPER", "ultra"],
    ["NVIDIA GeForce RTX 5080", "ultra"],
    ["AMD Radeon RX 7900 XTX", "ultra"],
    ["AMD Radeon RX 7800 XT", "ultra"],
    ["Some Future GPU 9000", "unknown"],
    ["", "unknown"],
  ])("%s -> %s", (description, expected) => {
    expect(classify(description)).toBe(expected);
  });

  it("uses the first description that matches, then the vendor", () => {
    expect(classifyGpu(["intel gen-12lp", "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU)"], "intel", table)).toBe(
      "discrete",
    );
    // Chrome often masks the device: only the vendor is left.
    expect(classifyGpu(["", ""], "NVIDIA", table)).toBe("discrete");
    expect(classifyGpu(["gen-12lp"], "intel", table)).toBe("integrated");
    expect(classifyGpu([], "matrox", table)).toBe("unknown");
  });
});

describe("tier and default preset (rendering-pipeline 2.2 / 2.3)", () => {
  it("Tier C is any device on webgl2; unknown GPUs are Tier B", () => {
    expect(tierFor("webgl2", "ultra")).toBe("C");
    expect(tierFor("webgl2", "integrated")).toBe("C");
    expect(tierFor("webgpu", "discrete")).toBe("A");
    expect(tierFor("webgpu", "ultra")).toBe("A");
    expect(tierFor("webgpu-compat", "discrete")).toBe("A");
    expect(tierFor("webgpu", "integrated")).toBe("B");
    expect(tierFor("webgpu", "unknown")).toBe("B");
  });

  it("defaults follow the table", () => {
    expect(defaultPresetFor("B", "webgpu", "integrated")).toBe("medium");
    expect(defaultPresetFor("B", "webgpu-compat", "integrated")).toBe("low");
    expect(defaultPresetFor("C", "webgl2", "discrete")).toBe("low");
    expect(defaultPresetFor("A", "webgpu", "discrete")).toBe("high");
    expect(defaultPresetFor("A", "webgpu", "ultra")).toBe("ultra");
    // Ultra is hidden off the core backend.
    expect(defaultPresetFor("A", "webgpu-compat", "ultra")).toBe("high");
  });

  it("Ultra is offered on webgpu only", () => {
    expect(maxPresetFor("webgpu")).toBe("ultra");
    expect(maxPresetFor("webgpu-compat")).toBe("high");
    expect(maxPresetFor("webgl2")).toBe("high");
    expect(clampPresetToBackend("ultra", "webgl2")).toBe("high");
    expect(clampPresetToBackend("medium", "webgl2")).toBe("medium");
    expect(presetBelow("high")).toBe("medium");
    expect(presetBelow("low")).toBeNull();
  });
});

describe("resolveQuality", () => {
  it("is the contract table unchanged on webgpu", () => {
    expect(resolveQuality("ultra", "webgpu")).toEqual(QUALITY_PRESETS.ultra);
    expect(resolveQuality("medium", "webgpu")).toEqual(QUALITY_PRESETS.medium);
  });

  it("applies the non-core backend rules: max High, max 3 cascades, mip-chain exposure", () => {
    const onWebGl = resolveQuality("ultra", "webgl2");
    expect(onWebGl.preset).toBe("high");
    expect(onWebGl.shadows.cascades).toBe(3);
    expect(onWebGl.post.exposureSource).toBe("mip-chain");
    expect(onWebGl.post.toneMapping).toBe("agx");
    expect(resolveQuality("medium", "webgpu-compat").post.exposureSource).toBe("mip-chain");
    expect(resolveQuality("low", "webgl2").shadows.cascades).toBe(2);
  });

  it("returns the same frozen object for the same inputs and never touches the contract constant", () => {
    const first = resolveQuality("high", "webgl2");
    expect(resolveQuality("high", "webgl2")).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.post.ao)).toBe(true);
    expect(QUALITY_PRESETS.high.post.exposureSource).toBe("histogram");
  });
});

describe("QualityController", () => {
  const capabilities = (backend: RenderCapabilities["backend"]): RenderCapabilities => ({
    backend,
    tier: backend === "webgl2" ? "C" : "A",
    gpuClass: "discrete",
    gpuDescription: "",
    gpuTiming: false,
    float32Filterable: false,
    textureCompressionBc: false,
    reversedDepth: true,
  });

  function create(backend: RenderCapabilities["backend"], initialPreset: "low" | "medium" | "high" | "ultra") {
    const emitted: EventMap["quality.changed"][] = [];
    const controller = new QualityController({
      events: {
        emit: (name, payload) => {
          if (name === "quality.changed") emitted.push(payload as EventMap["quality.changed"]);
        },
      },
      capabilities: capabilities(backend),
      recommendedPreset: "ultra",
      initialPreset,
      initialSource: "detect",
    });
    return { controller, emitted };
  }

  it("emits the first choice with previous null and clamps to the backend", () => {
    const { controller, emitted } = create("webgl2", "ultra");
    expect(controller.current.preset).toBe("high");
    expect(controller.maxPreset).toBe("high");
    expect(controller.recommendedPreset).toBe("high");
    expect(emitted).toEqual([{ settings: controller.current, previous: null, source: "detect" }]);
  });

  it("emits only real changes, steps down to Low and stops there", () => {
    const { controller, emitted } = create("webgpu", "medium");
    controller.setPreset("medium", "user");
    expect(emitted).toHaveLength(1);
    const before = controller.current;
    expect(controller.stepDown("detect")).toBe(true);
    expect(emitted[1]).toEqual({ settings: controller.current, previous: before, source: "detect" });
    expect(controller.current.preset).toBe("low");
    expect(controller.stepDown("detect")).toBe(false);
    expect(emitted).toHaveLength(2);
  });

  it("rebind re-resolves the active preset against a new backend", () => {
    const { controller, emitted } = create("webgpu", "ultra");
    controller.rebind(capabilities("webgl2"), "low");
    expect(controller.current.preset).toBe("high");
    expect(controller.maxPreset).toBe("high");
    expect(controller.recommendedPreset).toBe("low");
    expect(emitted).toHaveLength(2);
  });
});

describe("parseRenderUrlOptions", () => {
  it("reads the harness parameters", () => {
    expect(parseRenderUrlOptions("?scene=smoke&backend=WebGL2&preset=high&dpr=1.5&scale=floor&capture=1")).toEqual({
      backend: "webgl2",
      preset: "high",
      dpr: 1.5,
      scale: "floor",
      dynres: null,
      scene: "smoke",
      capture: true,
    });
  });

  it("drops unknown values and clamps dpr", () => {
    expect(parseRenderUrlOptions("backend=webgpu-compat&preset=epic&dpr=abc&scale=mid&capture=0")).toEqual({
      backend: null,
      preset: null,
      dpr: null,
      scale: null,
      dynres: null,
      scene: null,
      capture: false,
    });
    expect(parseRenderUrlOptions("?dpr=9").dpr).toBe(4);
    expect(parseRenderUrlOptions("?dpr=0").dpr).toBe(0.5);
    expect(parseRenderUrlOptions("?dpr=").dpr).toBeNull();
    expect(parseRenderUrlOptions("").backend).toBeNull();
  });

  it("?scale= takes a named end or a fixed number (clamped to 0.25..1); ?dynres= is a switch", () => {
    expect(parseRenderUrlOptions("?scale=ceil").scale).toBe("ceil");
    expect(parseRenderUrlOptions("?scale=1").scale).toBe(1);
    expect(parseRenderUrlOptions("?scale=0.67").scale).toBe(0.67);
    expect(parseRenderUrlOptions("?scale=3").scale).toBe(1);
    expect(parseRenderUrlOptions("?scale=0.1").scale).toBe(0.25);
    expect(parseRenderUrlOptions("?scale=").scale).toBeNull();
    expect(parseRenderUrlOptions("?dynres=off").dynres).toBe(false);
    expect(parseRenderUrlOptions("?dynres=on").dynres).toBe(true);
    expect(parseRenderUrlOptions("?dynres=maybe").dynres).toBeNull();
  });
});
