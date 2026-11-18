// RenderModule flow with a fake runtime: no GPU, no DOM. `navigator.gpu` is the mocked `env.gpu`.
import type { EventBus, EventMap, QualitySettings, ServiceRegistry } from "@moon-cleanup/shared";
import type { WebGPURenderer } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";
import type { GpuAdapterLike, GpuLike } from "./backend";
import { FrameLoop } from "./frame-loop";
import { installHarnessHooks, type HarnessHookTarget } from "./harness-hooks";
import { RenderModule, RenderUnsupportedError, type RenderRuntime, type RenderServices } from "./module";
import type { FramePipelineLike } from "./pipeline";
import { DEFAULT_MAX_DEVICE_LOSSES, type DeviceLossInfo, type FrameCallback } from "./renderer-host";

interface FakeRenderer {
  id: number;
  forceWebGL: boolean;
  lose: ((info: DeviceLossInfo) => void) | null;
  loop: FrameCallback | null;
  disposed: boolean;
  size: string;
  toneMapping: string;
}
interface FakePipeline extends FramePipelineLike {
  rendererId: number;
  renders: number;
  scale: number;
  disposed: boolean;
}

const LOSS: DeviceLossInfo = { api: "WebGPU", message: "lost", reason: "unknown" };

function createBus() {
  const emitted: { name: string; payload: unknown }[] = [];
  const bus: EventBus = {
    emit: (name, payload) => {
      emitted.push({ name, payload });
    },
    on: () => () => undefined,
  };
  const of = <K extends keyof EventMap>(name: K): EventMap[K][] =>
    emitted.filter((entry) => entry.name === name).map((entry) => entry.payload as EventMap[K]);
  return { bus, of };
}

function createRegistry(): ServiceRegistry<RenderServices> {
  const services = new Map<string, unknown>();
  return {
    get: <K extends keyof RenderServices & string>(key: K) => {
      if (!services.has(key)) throw new Error(`missing service ${key}`);
      return services.get(key) as RenderServices[K];
    },
    has: (key) => services.has(key),
    register: (key, service) => {
      if (services.has(key)) throw new Error(`duplicate service ${key}`);
      services.set(key, service);
    },
  };
}

interface Scenario {
  readonly search?: string;
  /** Adapter `navigator.gpu` returns; `undefined` means the browser has no WebGPU. */
  readonly adapter?: GpuAdapterLike | null;
  readonly webgl2?: boolean;
  readonly webglRenderer?: string;
  /** Backend each created renderer reports, by creation index. Default: follows `forceWebGL`. */
  readonly startedBackends?: readonly ("webgpu" | "webgpu-compat" | "webgl2")[];
  readonly reversedDepth?: boolean;
  readonly initFails?: boolean;
  /** Clock of the dynamic-resolution controller (ms). */
  readonly now?: () => number;
}

function setup(scenario: Scenario = {}) {
  const renderers: FakeRenderer[] = [];
  const pipelines: FakePipeline[] = [];
  const logs: string[] = [];
  /** What the fake renderer's tracker reports (`RenderRuntime.readInfo`); tests change `pipelines` between frames. */
  const info = { pipelines: 5 };
  const asReal = (renderer: FakeRenderer) => renderer as unknown as WebGPURenderer;
  const asFake = (renderer: WebGPURenderer) => renderer as unknown as FakeRenderer;

  const runtime: RenderRuntime<WebGPURenderer, HTMLCanvasElement> = {
    driver: {
      create: ({ forceWebGL }) => {
        const renderer: FakeRenderer = {
          id: renderers.length,
          forceWebGL,
          lose: null,
          loop: null,
          disposed: false,
          size: "",
          toneMapping: "",
        };
        renderers.push(renderer);
        return asReal(renderer);
      },
      init: () => (scenario.initFails === true ? Promise.reject(new Error("no context")) : Promise.resolve()),
      readBackend: (renderer) => {
        const fake = asFake(renderer);
        return scenario.startedBackends?.[fake.id] ?? (fake.forceWebGL ? "webgl2" : "webgpu");
      },
      onDeviceLost: (renderer, handler) => {
        asFake(renderer).lose = handler;
      },
      setAnimationLoop: (renderer, callback) => {
        asFake(renderer).loop = callback;
      },
      dispose: (renderer) => {
        asFake(renderer).disposed = true;
      },
    },
    canvases: {
      create: () => ({}) as HTMLCanvasElement,
      mount: () => undefined,
      unmount: () => undefined,
    },
    probeFeatures: () => ({
      gpuTiming: true,
      float32Filterable: false,
      textureCompressionBc: true,
      reversedDepth: scenario.reversedDepth ?? true,
    }),
    applyViewport: (renderer, viewport) => {
      asFake(renderer).size = `${String(viewport.widthCssPx)}x${String(viewport.heightCssPx)}@${String(viewport.dpr)}`;
    },
    applyToneMapping: (renderer, toneMapping) => {
      asFake(renderer).toneMapping = toneMapping;
    },
    createPipeline: (renderer) => {
      const pipeline: FakePipeline = {
        rendererId: asFake(renderer).id,
        renders: 0,
        scale: 0,
        disposed: false,
        render() {
          this.renders += 1;
        },
        setRenderScale(scale) {
          this.scale = scale;
        },
        setStages: () => undefined,
        dispose() {
          this.disposed = true;
        },
      };
      pipelines.push(pipeline);
      return pipeline;
    },
    readStats: (_renderer, out) => {
      out.drawCalls = 7;
      out.triangles = 140;
    },
    readInfo: (_renderer, out) => {
      out.pipelines = info.pipelines;
      out.textureBytes = 1000;
      out.geometryBytes = 500;
      out.totalBytes = 1500;
    },
  };

  const gpu: GpuLike | null =
    scenario.adapter === undefined ? null : { requestAdapter: () => Promise.resolve(scenario.adapter ?? null) };
  const container = { clientWidth: 1280, clientHeight: 720 } as HTMLElement;
  const module = new RenderModule({
    container,
    search: scenario.search ?? "",
    log: (line) => logs.push(line),
    env: {
      gpu,
      probeWebGl2: () => ({ supported: scenario.webgl2 ?? true, renderer: scenario.webglRenderer ?? "" }),
      getDeviceDpr: () => 2,
      observeResize: null,
      runtime,
      hostDelay: () => Promise.resolve(),
      cheaperDefault: false,
      ...(scenario.now === undefined ? {} : { now: scenario.now }),
    },
  });
  const { bus, of } = createBus();
  const services = createRegistry();
  const init = () => module.init({ services, events: bus });
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const frame = (quality: QualitySettings) => ({ dt: 1 / 60, time: 0, alpha: 0, simTick: 0, quality });
  const last = <T>(items: readonly T[]): T => {
    const item = items[items.length - 1];
    if (item === undefined) throw new Error("empty");
    return item;
  };
  return { module, services, of, logs, info, renderers, pipelines, init, flush, frame, last, container };
}

const RTX: GpuAdapterLike = { info: { vendor: "nvidia", description: "NVIDIA GeForce RTX 4060 Laptop GPU" } };
const IRIS: GpuAdapterLike = { info: { vendor: "intel", description: "Intel(R) Iris(R) Xe Graphics" } };

describe("RenderModule boot", () => {
  it("discrete GPU on WebGPU: Tier A, High, event + log + services", async () => {
    const { module, services, of, logs, renderers, pipelines, init } = setup({ adapter: RTX });
    await init();

    expect(renderers).toHaveLength(1);
    expect(renderers[0]?.forceWebGL).toBe(false);
    expect(of("render.backendSelected")).toEqual([{ backend: "webgpu", tier: "A", forced: false }]);
    const quality = services.get("quality");
    expect(quality.current.preset).toBe("high");
    expect(quality.recommendedPreset).toBe("high");
    expect(quality.capabilities).toMatchObject({ gpuClass: "discrete", gpuTiming: true, reversedDepth: true });
    expect(of("quality.changed")).toEqual([{ settings: quality.current, previous: null, source: "detect" }]);
    expect(services.get("renderer")).toBe(module);
    expect(module.backend).toBe("webgpu");
    expect(module.tier).toBe("A");
    expect(services.get("sceneRoots").camera.far).toBe(30_000);
    expect(logs.join("\n")).toMatch(/\[render\] backend=webgpu tier=A preset=high/);

    // HDR pipeline bound, AgX, DPR capped per tier preset (High: 1.5 of the device's 2), render scale ceiling.
    expect(pipelines).toHaveLength(1);
    expect(renderers[0]?.toneMapping).toBe("agx");
    expect(renderers[0]?.size).toBe("1280x720@1.5");
    expect(pipelines[0]?.scale).toBe(1);
    expect(services.get("sceneRoots").camera.aspect).toBeCloseTo(1280 / 720, 6);
  });

  it("integrated GPU on WebGPU: Tier B, Medium, DPR cap 1", async () => {
    const { services, of, renderers, pipelines, init } = setup({ adapter: IRIS });
    await init();
    expect(of("render.backendSelected")).toEqual([{ backend: "webgpu", tier: "B", forced: false }]);
    expect(services.get("quality").current.preset).toBe("medium");
    expect(renderers[0]?.size).toBe("1280x720@1");
    // An integrated GPU starts at the floor of the preset's range; the controller probes upward (M0-W3-T08).
    expect(pipelines[0]?.scale).toBe(0.75);
  });

  it("compatibility-mode device: webgpu-compat, Tier B defaults to Low", async () => {
    const { services, of, init } = setup({ adapter: IRIS, startedBackends: ["webgpu-compat"] });
    await init();
    expect(of("render.backendSelected")).toEqual([{ backend: "webgpu-compat", tier: "B", forced: false }]);
    expect(services.get("quality").current.preset).toBe("low");
    expect(services.get("quality").maxPreset).toBe("high");
  });

  it("no navigator.gpu: WebGL2, Tier C, Low, classified from the WebGL renderer string", async () => {
    const { services, of, renderers, init } = setup({
      webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)",
    });
    await init();
    expect(renderers[0]?.forceWebGL).toBe(true);
    expect(of("render.backendSelected")).toEqual([{ backend: "webgl2", tier: "C", forced: false }]);
    expect(services.get("quality").current.preset).toBe("low");
    expect(services.get("quality").capabilities.gpuClass).toBe("discrete");
  });

  it("?backend=webgl2 forces WebGL2 on a WebGPU machine and says so", async () => {
    const { of, renderers, logs, init } = setup({ adapter: RTX, search: "?backend=webgl2" });
    await init();
    expect(renderers[0]?.forceWebGL).toBe(true);
    expect(of("render.backendSelected")).toEqual([{ backend: "webgl2", tier: "C", forced: true }]);
    expect(logs.join("\n")).toContain("forced=true reason=override");
  });

  it("reports the backend that actually started when three falls back by itself", async () => {
    const { of, init } = setup({ adapter: RTX, startedBackends: ["webgl2"] });
    await init();
    expect(of("render.backendSelected")).toEqual([{ backend: "webgl2", tier: "C", forced: false }]);
  });

  it("?preset= wins (source url), clamped to the backend; ?dpr= replaces the device DPR; ?scale=floor pins", async () => {
    const { services, of, renderers, pipelines, init } = setup({
      search: "?backend=webgl2&preset=ultra&dpr=1&scale=floor",
    });
    await init();
    expect(services.get("quality").current.preset).toBe("high");
    expect(of("quality.changed")[0]?.source).toBe("url");
    expect(renderers[0]?.size).toBe("1280x720@1");
    expect(pipelines[0]?.scale).toBe(0.75);
  });

  it("without reversed-Z the camera uses the fallback depth range", async () => {
    const { services, init } = setup({ reversedDepth: false });
    await init();
    const camera = services.get("sceneRoots").camera;
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(6_000);
  });

  it("throws RenderUnsupportedError without WebGPU and WebGL2, and when no backend starts", async () => {
    const none = setup({ webgl2: false });
    await expect(none.init()).rejects.toBeInstanceOf(RenderUnsupportedError);
    expect(none.renderers).toHaveLength(0);

    const failing = setup({ adapter: RTX, initFails: true });
    await expect(failing.init()).rejects.toBeInstanceOf(RenderUnsupportedError);
    expect(failing.renderers[0]?.disposed).toBe(true);
  });
});

describe("RenderModule dynamic resolution", () => {
  const WEBGL_RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)";

  /** Runs `seconds` of frames `frameMs` apart on the injected clock. */
  function runFrames(
    ctx: ReturnType<typeof setup>,
    clock: { t: number },
    seconds: number,
    frameMs: number,
    each?: () => void,
  ): void {
    const quality = ctx.services.get("quality");
    for (let elapsed = 0; elapsed < seconds * 1000; elapsed += frameMs) {
      clock.t += frameMs;
      each?.();
      ctx.module.update({ ...ctx.frame(quality.current), dt: frameMs / 1000 });
    }
  }

  it("steps the scale down toward the floor while frames miss the budget, through the pipeline", async () => {
    const clock = { t: 1000 };
    const ctx = setup({ webglRenderer: WEBGL_RTX, now: () => clock.t });
    await ctx.init();
    expect(ctx.services.get("quality").current.preset).toBe("low");
    expect(ctx.pipelines[0]?.scale).toBe(0.75);
    expect(ctx.module.dynamicResolution).toMatchObject({ enabled: true, pinned: false, scaleMin: 0.5, scaleMax: 0.75 });

    runFrames(ctx, clock, 2.2, 60);
    expect(ctx.pipelines[0]?.scale).toBe(0.65);
    expect(ctx.module.renderScale).toBe(0.65);
    runFrames(ctx, clock, 8, 60);
    expect(ctx.pipelines[0]?.scale).toBe(0.5);
    const state = ctx.module.dynamicResolution;
    expect(state.scale).toBe(0.5);
    expect(state.signal).toBe("interval");
    // 60 fps on every preset (frame-target.ts), not the contract's 30.
    expect(state.targetMs).toBeCloseTo(1000 / 60, 3);
    expect(state.targetFps).toBe(60);
    expect(state.p90Ms).toBe(60);
    expect(state.steps).toBe(3);
  });

  it("keeps the scale while the budget is met with a GPU signal that shows no headroom", async () => {
    const clock = { t: 0 };
    const ctx = setup({ search: "?fps=contract", webglRenderer: WEBGL_RTX, now: () => clock.t });
    await ctx.init();
    runFrames(ctx, clock, 12, 33.3, () => ctx.module.reportGpuFrameMs(26));
    expect(ctx.pipelines[0]?.scale).toBe(0.75);
    expect(ctx.module.dynamicResolution.signal).toBe("gpu");
    expect(ctx.module.dynamicResolution.targetMs).toBe(28);
  });

  it("steers on reported GPU time when it is fresh, even at a vsync-locked interval", async () => {
    const clock = { t: 0 };
    const ctx = setup({ webglRenderer: WEBGL_RTX, now: () => clock.t });
    await ctx.init();
    runFrames(ctx, clock, 2.2, 33.3, () => ctx.module.reportGpuFrameMs(40));
    expect(ctx.pipelines[0]?.scale).toBe(0.65);
    expect(ctx.module.dynamicResolution.signal).toBe("gpu");
  });

  it("?scale=1 pins 1.0 on Low (outside the preset range) and switches the controller off", async () => {
    const clock = { t: 0 };
    const ctx = setup({ webglRenderer: WEBGL_RTX, search: "?scale=1", now: () => clock.t });
    await ctx.init();
    expect(ctx.services.get("quality").current.preset).toBe("low");
    expect(ctx.pipelines[0]?.scale).toBe(1);
    expect(ctx.module.dynamicResolution).toMatchObject({ enabled: false, pinned: true, scale: 1 });
    runFrames(ctx, clock, 6, 80);
    expect(ctx.pipelines[0]?.scale).toBe(1);
    expect(ctx.module.setRenderScale(0.5)).toBe(1);
    // A preset change keeps the pin.
    ctx.services.get("quality").setPreset("medium", "user");
    runFrames(ctx, clock, 1, 80);
    expect(ctx.pipelines[0]?.scale).toBe(1);
  });

  it("?scale=0.67 pins a fixed fraction; capture mode pins the ceiling", async () => {
    const fixed = setup({ adapter: IRIS, search: "?scale=0.67" });
    await fixed.init();
    expect(fixed.pipelines[0]?.scale).toBe(0.67);

    const clock = { t: 0 };
    const capture = setup({ adapter: IRIS, search: "?capture=1", now: () => clock.t });
    await capture.init();
    expect(capture.pipelines[0]?.scale).toBe(0.85);
    runFrames(capture, clock, 6, 80);
    expect(capture.pipelines[0]?.scale).toBe(0.85);
    expect(capture.module.dynamicResolution.enabled).toBe(false);
  });

  it("?dynres=off holds the starting scale; setRenderScale still works and clamps to the preset range", async () => {
    const clock = { t: 0 };
    const ctx = setup({ adapter: IRIS, search: "?dynres=off", now: () => clock.t });
    await ctx.init();
    // Off: no floor start either, the preset's ceiling is the resting scale.
    expect(ctx.pipelines[0]?.scale).toBe(0.85);
    runFrames(ctx, clock, 6, 80);
    expect(ctx.pipelines[0]?.scale).toBe(0.85);
    expect(ctx.module.setRenderScale(0.8)).toBe(0.8);
    expect(ctx.pipelines[0]?.scale).toBe(0.8);
    expect(ctx.module.setRenderScale(0.1)).toBe(0.75);
    expect(ctx.module.setRenderScale(4)).toBe(0.85);
  });

  it("setDynamicResolution(false) freezes the scale; a preset change restarts the controller on the new range", async () => {
    const clock = { t: 0 };
    const ctx = setup({ webglRenderer: WEBGL_RTX, now: () => clock.t });
    await ctx.init();
    ctx.module.setDynamicResolution(false);
    runFrames(ctx, clock, 6, 80);
    expect(ctx.pipelines[0]?.scale).toBe(0.75);
    ctx.module.setDynamicResolution(true);
    runFrames(ctx, clock, 2.2, 80);
    expect(ctx.pipelines[0]?.scale).toBe(0.65);

    ctx.services.get("quality").setPreset("medium", "user");
    runFrames(ctx, clock, 0.1, 20);
    expect(ctx.pipelines[0]?.scale).toBe(0.85);
    expect(ctx.module.dynamicResolution).toMatchObject({ scaleMin: 0.75, scaleMax: 0.85 });
  });

  it("an integrated GPU starts at the floor and probes upward once the budget is met", async () => {
    const clock = { t: 0 };
    const ctx = setup({ search: "?fps=contract", adapter: IRIS, now: () => clock.t });
    await ctx.init();
    expect(ctx.pipelines[0]?.scale).toBe(0.75);
    // Vsync-locked 30 fps: budget met, no measurable headroom -> a probe after the hold, kept because frames stay on budget.
    runFrames(ctx, clock, 12, 1000 / 30);
    expect(ctx.pipelines[0]?.scale).toBe(0.8);
  });

  it("reads the frame loop's dt, not the jittery wall clock; a wall-clock stall is dropped", async () => {
    const clock = { t: 0 };
    const ctx = setup({ search: "?fps=contract", webglRenderer: WEBGL_RTX, now: () => clock.t });
    await ctx.init();
    const quality = ctx.services.get("quality");
    // dt says 33.3 ms (on budget) while the wall clock between updates swings 20..47 ms: no step.
    for (let i = 0; i < 300; i++) {
      clock.t += i % 2 === 0 ? 20 : 46.6;
      ctx.module.update({ ...ctx.frame(quality.current), dt: 1 / 30 });
    }
    expect(ctx.pipelines[0]?.scale).toBe(0.75);
    expect(ctx.module.dynamicResolution.p90Ms).toBeCloseTo(33.33, 1);
    // A 3 s stall (dt is clamped to 0.1 s by the loop) is not load.
    clock.t += 3000;
    ctx.module.update({ ...ctx.frame(quality.current), dt: 0.1 });
    expect(ctx.pipelines[0]?.scale).toBe(0.75);
  });
});

describe("RenderModule frames, quality changes and device loss", () => {
  it("renders through the pipeline and applies a preset change on the next frame", async () => {
    const { module, services, renderers, pipelines, init, frame } = setup({ adapter: RTX });
    await init();
    const quality = services.get("quality");
    module.update(frame(quality.current));
    module.update(frame(quality.current));
    expect(pipelines[0]?.renders).toBe(2);
    expect(module.framesRendered).toBe(2);

    quality.setPreset("low", "user");
    module.update(frame(quality.current));
    expect(pipelines[0]?.scale).toBe(0.75);
    // The lower DPR cap arrives through the viewport poll of the frame loop.
    expect(module.viewportSource.poll()).toBe(true);
    module.resize(module.viewport);
    expect(renderers[0]?.size).toBe("1280x720@1");
  });

  it("device loss: stops drawing, recreates the renderer, rebuilds the pipeline and notifies listeners", async () => {
    const { module, services, of, renderers, pipelines, init, flush, frame } = setup({ adapter: RTX });
    await init();
    const quality = services.get("quality");
    const recreated = vi.fn();
    module.onRecreated(recreated);

    renderers[0]?.lose?.(LOSS);
    expect(module.renderer).toBeNull();
    expect(pipelines[0]?.disposed).toBe(true);
    // A frame while recovering must not throw or draw.
    module.update(frame(quality.current));
    expect(pipelines[0]?.renders).toBe(0);

    await flush();
    expect(renderers).toHaveLength(2);
    expect(renderers[0]?.disposed).toBe(true);
    expect(module.renderer).toBe(renderers[1]);
    expect(pipelines).toHaveLength(2);
    expect(pipelines[1]?.rendererId).toBe(1);
    expect(renderers[1]?.toneMapping).toBe("agx");
    expect(renderers[1]?.size).toBe("1280x720@1.5");
    expect(recreated).toHaveBeenCalledTimes(1);
    expect(module.lossCount).toBe(1);
    // Same backend and tier: the selection event is not repeated, the preset is kept.
    expect(of("render.backendSelected")).toHaveLength(1);
    expect(quality.current.preset).toBe("high");

    module.update(frame(quality.current));
    expect(pipelines[1]?.renders).toBe(1);
  });

  it("drops one preset after the second loss", async () => {
    const { services, renderers, init, flush } = setup({ adapter: RTX });
    await init();
    renderers[0]?.lose?.(LOSS);
    await flush();
    renderers[1]?.lose?.(LOSS);
    await flush();
    expect(renderers).toHaveLength(3);
    expect(services.get("quality").current.preset).toBe("medium");
  });

  it("a recreated renderer on another backend re-announces the selection and re-clamps the preset", async () => {
    const { services, of, renderers, init, flush } = setup({
      adapter: RTX,
      search: "?preset=ultra",
      startedBackends: ["webgpu", "webgl2"],
    });
    await init();
    expect(services.get("quality").current.preset).toBe("ultra");
    renderers[0]?.lose?.({ api: "WebGPU", message: "adapter removed", reason: "unknown" });
    await flush();
    expect(of("render.backendSelected")).toEqual([
      { backend: "webgpu", tier: "A", forced: false },
      { backend: "webgl2", tier: "C", forced: false },
    ]);
    expect(services.get("quality").current.preset).toBe("high");
    expect(services.get("quality").current.shadows.cascades).toBe(3);
  });

  it("dispose releases the pipeline and the renderer", async () => {
    const { module, renderers, pipelines, init } = setup({ adapter: RTX });
    await init();
    module.dispose();
    module.dispose();
    expect(pipelines[0]?.disposed).toBe(true);
    expect(renderers[0]?.disposed).toBe(true);
    expect(module.renderer).toBeNull();
  });
});

describe("frame loop + harness hooks on the module", () => {
  it("capture mode: fixed-step warm-up, then __mcReady, __mcStep and __mcInfo", async () => {
    const { module, services, renderers, pipelines, init } = setup({ adapter: RTX, search: "?capture=1" });
    await init();
    const quality = services.get("quality");
    const loop = new FrameLoop<RenderServices>({
      modules: [module],
      scheduler: module.scheduler,
      getQuality: () => quality.current,
      viewport: module.viewportSource,
    });
    loop.start();
    const tick = (timeMs: number) => renderers[0]?.loop?.(timeMs);
    expect(renderers[0]?.loop).not.toBeNull();

    const target: HarnessHookTarget = {};
    const installed = installHarnessHooks(target, { loop, renderer: module, quality, capture: true });
    expect(target.__mcReady).toBe(false);
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
      tick(i * 16);
    }
    await installed;
    expect(target.__mcReady).toBe(true);
    expect(pipelines[0]?.renders).toBe(3);

    const stepped = target.__mcStep?.(2, 1 / 60);
    tick(100);
    tick(116);
    tick(132);
    await stepped;
    expect(pipelines[0]?.renders).toBe(5);
    expect(loop.frame.time).toBeCloseTo(5 / 60, 9);

    expect(target.__mcInfo?.()).toMatchObject({
      backend: "webgpu",
      tier: "A",
      preset: "high",
      dpr: 1.5,
      renderScale: 1,
      drawCalls: 7,
      triangles: 140,
      texPoolMB: 0,
      lossCount: 0,
    });
  });

  it("live mode: ready after the warm-up frames; __mcStep refuses", async () => {
    const { module, services, renderers, init } = setup({ adapter: IRIS });
    await init();
    const quality = services.get("quality");
    const loop = new FrameLoop<RenderServices>({
      modules: [module],
      scheduler: module.scheduler,
      getQuality: () => quality.current,
    });
    loop.start();
    const target: HarnessHookTarget = {};
    const installed = installHarnessHooks(target, { loop, renderer: module, quality, capture: false });
    for (let i = 0; i < 3; i++) renderers[0]?.loop?.(i * 16);
    await installed;
    expect(target.__mcReady).toBe(true);
    await expect(target.__mcStep?.(1, 1 / 60)).rejects.toThrow("capture");
  });
});

describe("RenderModule render infra (M1-W2-T03)", () => {
  function frames(ctx: ReturnType<typeof setup>, clock: { t: number }, count: number, frameMs = 1000 / 60): void {
    const quality = ctx.services.get("quality");
    for (let i = 0; i < count; i++) {
      clock.t += frameMs;
      ctx.module.update({ ...ctx.frame(quality.current), dt: frameMs / 1000 });
    }
  }

  it("warm-up: sources on, ready when the pipeline count stands still, runtime creations counted", async () => {
    const clock = { t: 0 };
    const ctx = setup({ adapter: RTX, now: () => clock.t });
    await ctx.init();
    const { module, info, logs } = ctx;
    expect(module.pipelineWarmup.phase).toBe("warming");
    const source = vi.fn();
    module.addWarmupSource(source);
    expect(source).toHaveBeenLastCalledWith(true);
    let ready = false;
    void module.whenPipelinesReady().then(() => {
      ready = true;
    });

    // Pipelines appear over the first frames, then the count stands still.
    for (const count of [9, 14, 14, 14]) {
      info.pipelines = count;
      frames(ctx, clock, 1);
      expect(module.pipelineWarmup.phase).toBe("warming");
    }
    frames(ctx, clock, 1);
    expect(module.pipelineWarmup).toMatchObject({ phase: "ready", reason: "boot", pipelinesAtReady: 14, completed: 1 });
    expect(module.pipelineWarmup.pipelinesReadyMs).toBeCloseTo(5 * (1000 / 60), 3);
    expect(source).toHaveBeenLastCalledWith(false);
    await ctx.flush();
    expect(ready).toBe(true);
    expect(logs.some((line) => line.includes("pipelines ready: reason=boot"))).toBe(true);

    // A pipeline created during play is a budget failure: counted and warned about.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    info.pipelines = 16;
    frames(ctx, clock, 2);
    expect(module.pipelineWarmup.pipelinesAfterWarmup).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();

    // A preset change warms up again and clears the count; resolved promises are immediate when nothing is warming.
    ctx.services.get("quality").setPreset("medium", "user");
    info.pipelines = 21;
    frames(ctx, clock, 1);
    expect(module.pipelineWarmup).toMatchObject({ phase: "warming", reason: "preset" });
    expect(source).toHaveBeenLastCalledWith(true);
    frames(ctx, clock, 4);
    expect(module.pipelineWarmup).toMatchObject({ phase: "ready", completed: 2, pipelinesAfterWarmup: 0 });
    expect(source).toHaveBeenLastCalledWith(false);
    await expect(module.whenPipelinesReady()).resolves.toBeUndefined();
  });

  it("new post stages and requestWarmup start a warm-up; a removed source is not called again", async () => {
    const clock = { t: 0 };
    const ctx = setup({ adapter: RTX, now: () => clock.t });
    await ctx.init();
    frames(ctx, clock, 5);
    expect(ctx.module.pipelineWarmup.phase).toBe("ready");
    const source = vi.fn();
    const off = ctx.module.addWarmupSource(source);
    expect(source).not.toHaveBeenCalled();
    ctx.module.setPipelineStages({ hdr: null });
    expect(ctx.module.pipelineWarmup).toMatchObject({ phase: "warming", reason: "stages" });
    expect(source).toHaveBeenCalledWith(true);
    frames(ctx, clock, 5);
    expect(ctx.module.pipelineWarmup.phase).toBe("ready");
    off();
    source.mockClear();
    ctx.module.requestWarmup();
    expect(ctx.module.pipelineWarmup).toMatchObject({ phase: "warming", reason: "request" });
    expect(source).not.toHaveBeenCalled();
  });

  it("holdWarmup: Clock In waits for content still loading; the late pipelines are not runtime creations", async () => {
    const clock = { t: 0 };
    const ctx = setup({ adapter: RTX, now: () => clock.t });
    await ctx.init();
    const { module, info } = ctx;
    const release = module.holdWarmup();
    let ready = false;
    void module.whenPipelinesReady().then(() => {
      ready = true;
    });
    info.pipelines = 29;
    frames(ctx, clock, 30);
    await ctx.flush();
    expect(module.pipelineWarmup).toMatchObject({ phase: "warming", holds: 1 });
    expect(ready).toBe(false);
    release();
    release();
    info.pipelines = 37;
    frames(ctx, clock, 4);
    await ctx.flush();
    expect(module.pipelineWarmup).toMatchObject({ phase: "ready", holds: 0, pipelinesAtReady: 37, completed: 1 });
    expect(ready).toBe(true);
    frames(ctx, clock, 3);
    expect(module.pipelineWarmup.pipelinesAfterWarmup).toBe(0);
  });

  it("holdWarmup: a hold dropped by the held time-out does not block later warm-ups; its late release is a no-op", async () => {
    const clock = { t: 0 };
    const ctx = setup({ adapter: RTX, now: () => clock.t });
    await ctx.init();
    const { module } = ctx;
    const leaked = module.holdWarmup();
    frames(ctx, clock, 1, 61_000);
    expect(module.pipelineWarmup).toMatchObject({ phase: "ready", timedOut: true, holds: 0 });
    const second = module.holdWarmup();
    leaked();
    expect(module.pipelineWarmup.holds).toBe(1);
    second();
    frames(ctx, clock, 5);
    expect(module.pipelineWarmup).toMatchObject({ phase: "ready", timedOut: false, holds: 0 });
  });

  it("device loss mid-warm-up restarts the warm-up clock: the first new frame does not time it out", async () => {
    const clock = { t: 0 };
    const ctx = setup({ adapter: RTX, now: () => clock.t });
    await ctx.init();
    const { module, info, renderers } = ctx;
    info.pipelines = 9;
    frames(ctx, clock, 1);
    expect(module.pipelineWarmup.phase).toBe("warming");
    // Recovery takes longer than the warm-up time cap (8 s) and than the loss happened while warming.
    renderers[0]?.lose?.(LOSS);
    clock.t += 9000;
    await ctx.flush();
    expect(module.renderer).toBe(renderers[1]);
    info.pipelines = 4;
    frames(ctx, clock, 1);
    expect(module.pipelineWarmup).toMatchObject({ phase: "warming", timedOut: false });
    frames(ctx, clock, 5);
    expect(module.pipelineWarmup).toMatchObject({ phase: "ready", timedOut: false, pipelinesAtReady: 4 });
    expect(module.pipelineWarmup.lastMs).toBeLessThan(1000);
  });

  it("whenPipelinesReady resolves after a fatal renderer error instead of hanging", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ctx = setup({ adapter: RTX });
    await ctx.init();
    let ready = false;
    void ctx.module.whenPipelinesReady().then(() => {
      ready = true;
    });
    for (let i = 0; i <= DEFAULT_MAX_DEVICE_LOSSES; i++) {
      ctx.renderers[i]?.lose?.(LOSS);
      await ctx.flush();
    }
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[render] fatal"));
    expect(ready).toBe(true);
    await expect(ctx.module.whenPipelinesReady()).resolves.toBeUndefined();
    error.mockRestore();
    warn.mockRestore();
  });

  it("draw budget: last frame against the preset's ceiling, reset on a preset change", async () => {
    const clock = { t: 0 };
    const ctx = setup({ adapter: RTX, now: () => clock.t });
    await ctx.init();
    frames(ctx, clock, 3);
    expect(ctx.module.drawBudget).toMatchObject({
      drawCalls: 7,
      triangles: 140,
      budgetDrawCalls: 600,
      over: false,
      frames: 3,
      overFrames: 0,
    });
    ctx.services.get("quality").setPreset("medium", "user");
    frames(ctx, clock, 1);
    expect(ctx.module.drawBudget).toMatchObject({ budgetDrawCalls: 350, budgetTriangles: 1_500_000, frames: 1 });
  });

  it("memory ledger: the scene pass target follows viewport and render scale; three's tracker is read per frame", async () => {
    const clock = { t: 0 };
    const ctx = setup({ adapter: RTX, search: "?dynres=off", now: () => clock.t });
    await ctx.init();
    const { module } = ctx;
    const expected = (): number => {
      const v = module.viewport;
      const s = module.renderScale;
      return Math.floor(v.widthCssPx * v.dpr * s) * Math.floor(v.heightCssPx * v.dpr * s) * 12;
    };
    expect(module.memory.bytesIn("renderTargets")).toBe(expected());
    const before = module.memory.bytesIn("renderTargets");
    // 0 clamps to the preset's floor.
    const applied = module.setRenderScale(0);
    expect(module.renderScale).toBe(applied);
    expect(module.memory.bytesIn("renderTargets")).toBe(expected());
    expect(module.memory.bytesIn("renderTargets")).toBeLessThanOrEqual(before);
    expect(module.memory.list()[0]).toMatchObject({ owner: "render", category: "renderTargets" });
    frames(ctx, clock, 1);
    expect(module.rendererInfo).toMatchObject({ textureBytes: 1000, geometryBytes: 500, totalBytes: 1500 });
    module.dispose();
    expect(module.memory.totals.entries).toBe(0);
  });

  it("steers Medium to 60 fps: 14 ms GPU budget, pace guard on, ?fps=contract restores 28 ms", async () => {
    const clock = { t: 0 };
    const ctx = setup({ adapter: IRIS, now: () => clock.t });
    await ctx.init();
    expect(ctx.services.get("quality").current.preset).toBe("medium");
    expect(ctx.pipelines[0]?.scale).toBe(0.75);
    // 20 ms of GPU time and 30 fps: inside the contract's 28 ms / 33 ms, over the 60 fps goal. At the floor already:
    // it stays there and raises the floor hint instead of climbing.
    const quality = ctx.services.get("quality");
    for (let t = 0; t < 14_000; t += 1000 / 30) {
      clock.t += 1000 / 30;
      ctx.module.reportGpuFrameMs(20);
      ctx.module.update({ ...ctx.frame(quality.current), dt: 1 / 30 });
    }
    const state = ctx.module.dynamicResolution;
    expect(state).toMatchObject({ scale: 0.75, signal: "gpu", targetMs: 14, targetFps: 60, floorHint: true });
    expect(state.paceTargetMs).toBeCloseTo(1000 / 30, 1);

    const contract = setup({ adapter: IRIS, search: "?fps=contract", now: () => clock.t });
    await contract.init();
    for (let t = 0; t < 14_000; t += 1000 / 30) {
      clock.t += 1000 / 30;
      contract.module.reportGpuFrameMs(20);
      contract.module.update({ ...contract.frame(quality.current), dt: 1 / 30 });
    }
    expect(contract.module.dynamicResolution).toMatchObject({ targetMs: 28, targetFps: 30 });
    expect(contract.module.dynamicResolution.scale).toBeGreaterThan(0.75);
  });
});
