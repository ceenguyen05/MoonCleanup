import {
  QUALITY_PRESETS,
  type ClientModule,
  type ClientModuleId,
  type FrameInfo,
  type ViewportSize,
} from "@moon-cleanup/shared";
import { describe, expect, it, vi } from "vitest";
import {
  FRAME_STEP_IDS,
  FrameLoop,
  MAX_FRAME_DT_S,
  MODULE_UPDATE_ORDER,
  spanName,
  type PerformanceLike,
} from "./frame-loop";
import type { FrameCallback, FrameScheduler } from "./renderer-host";
import { RenderScale, clampScale } from "./render-scale";
import { cameraDepthRange } from "./scene-roots";
import { ViewportTracker, drawingBufferSize, effectiveDpr } from "./viewport";

function fakeScheduler() {
  let callback: FrameCallback | null = null;
  const scheduler: FrameScheduler = {
    start: (next) => {
      callback = next;
    },
    stop: () => {
      callback = null;
    },
  };
  return { scheduler, tick: (timeMs: number) => callback?.(timeMs), running: () => callback !== null };
}

function fakePerformance() {
  const calls: string[] = [];
  let now = 0;
  const performance: PerformanceLike = {
    now: () => (now += 0.25),
    mark: (name) => calls.push(`mark ${name}`),
    measure: (name, start) => calls.push(`measure ${name} from ${start}`),
    clearMarks: () => undefined,
    clearMeasures: () => undefined,
  };
  return { performance, calls };
}

function fakeModule(id: ClientModuleId, log: string[], withResize = false): ClientModule {
  return {
    id,
    init: () => undefined,
    update: () => {
      log.push(id);
    },
    ...(withResize
      ? { resize: (viewport: ViewportSize) => log.push(`resize:${id}:${String(viewport.widthCssPx)}`) }
      : {}),
    dispose: () => undefined,
  };
}

const getQuality = () => QUALITY_PRESETS.low;

describe("FrameLoop", () => {
  it("calls input, sim and the modules in module-boundaries section 4 order, whatever the registration order", () => {
    const log: string[] = [];
    const { scheduler, tick } = fakeScheduler();
    const { performance } = fakePerformance();
    // Registration (init) order, deliberately not the update order.
    const ids: ClientModuleId[] = [
      "render",
      "visuals",
      "terrain",
      "animation",
      "gameplay",
      "net",
      "audio",
      "ui",
      "debug",
    ];
    const loop = new FrameLoop({
      modules: ids.map((id) => fakeModule(id, log)),
      scheduler,
      getQuality,
      performance,
      input: () => log.push("input"),
      simPredict: () => log.push("sim"),
    });
    loop.start();
    tick(0);
    expect(log).toEqual([...FRAME_STEP_IDS]);
    expect(FRAME_STEP_IDS.filter((id) => id !== "input" && id !== "sim")).toEqual([...MODULE_UPDATE_ORDER]);
    expect(loop.frameCount).toBe(1);
  });

  it("wraps every existing step in a mc:<module>:update span and records its duration", () => {
    const log: string[] = [];
    const { scheduler, tick } = fakeScheduler();
    const { performance, calls } = fakePerformance();
    const loop = new FrameLoop({
      modules: [fakeModule("render", log), fakeModule("net", log)],
      scheduler,
      getQuality,
      performance,
    });
    loop.start();
    tick(0);
    expect(spanName("render")).toBe("mc:render:update");
    expect(calls).toEqual([
      "mark mc:net:update:start",
      "measure mc:net:update from mc:net:update:start",
      "mark mc:render:update:start",
      "measure mc:render:update from mc:render:update:start",
    ]);
    expect(loop.lastStepMs("render")).toBe(0.25);
    expect(loop.lastStepMs("audio")).toBe(0);

    calls.length = 0;
    loop.setSpansEnabled(false);
    tick(16);
    expect(calls).toEqual([]);
    expect(loop.lastStepMs("net")).toBe(0.25);
  });

  it("reports dt in seconds, clamped, and reuses one FrameInfo with the live quality and sim clock", () => {
    const { scheduler, tick } = fakeScheduler();
    const { performance } = fakePerformance();
    const seen: FrameInfo[] = [];
    const dts: number[] = [];
    const ticks: number[] = [];
    const clock = { alpha: 0, simTick: 0 };
    let quality: (typeof QUALITY_PRESETS)["low" | "high"] = QUALITY_PRESETS.low;
    const render: ClientModule = {
      id: "render",
      init: () => undefined,
      update: (frame) => {
        seen.push(frame);
        dts.push(frame.dt);
        ticks.push(frame.simTick);
      },
      dispose: () => undefined,
    };
    const loop = new FrameLoop({
      modules: [render],
      scheduler,
      getQuality: () => quality,
      performance,
      simClock: clock,
      simPredict: () => {
        clock.simTick += 1;
        clock.alpha = 0.5;
      },
    });
    loop.start();
    tick(1000);
    tick(1016);
    quality = QUALITY_PRESETS.high;
    tick(6016);
    expect(dts[0]).toBe(0);
    expect(dts[1]).toBeCloseTo(0.016, 6);
    expect(dts[2]).toBe(MAX_FRAME_DT_S);
    expect(loop.frame.time).toBeCloseTo(0.016 + MAX_FRAME_DT_S, 6);
    expect(seen[0]).toBe(seen[2]);
    expect(loop.frame.quality).toBe(QUALITY_PRESETS.high);
    // The render step sees the tick the sim phase of the same frame produced.
    expect(ticks).toEqual([1, 2, 3]);
    expect(loop.frame.alpha).toBe(0.5);
    const stats = loop.frameTimeStats();
    expect(stats.samples).toBe(2);
    expect(stats.avgMs).toBeCloseTo((16 + 5000) / 2, 3);
    expect(stats.p95Ms).toBe(5000);
  });

  it("polls the viewport first and resizes modules in registration order only on a change", () => {
    const log: string[] = [];
    const { scheduler, tick } = fakeScheduler();
    const { performance } = fakePerformance();
    const element = { clientWidth: 800, clientHeight: 600 };
    const viewport = new ViewportTracker({ element, getDeviceDpr: () => 2, getDprCap: () => 1.5 });
    const loop = new FrameLoop({
      modules: [fakeModule("ui", log, true), fakeModule("render", log, true)],
      scheduler,
      getQuality,
      performance,
      viewport,
    });
    loop.start();
    tick(0);
    tick(16);
    element.clientWidth = 1024;
    tick(32);
    expect(log).toEqual([
      "resize:render:800",
      "resize:ui:800",
      "render",
      "ui",
      "render",
      "ui",
      "resize:render:1024",
      "resize:ui:1024",
      "render",
      "ui",
    ]);
    expect(viewport.current.dpr).toBe(1.5);
  });

  it("manual mode advances only through step(), one frame per display frame, then resolves after presenting", async () => {
    const { scheduler, tick } = fakeScheduler();
    const { performance } = fakePerformance();
    const dts: number[] = [];
    const render: ClientModule = {
      id: "render",
      init: () => undefined,
      update: (frame) => dts.push(frame.dt),
      dispose: () => undefined,
    };
    const loop = new FrameLoop({ modules: [render], scheduler, getQuality, performance });
    await expect(loop.step(1, 1 / 60)).rejects.toThrow("manual");
    loop.start();
    loop.setManual(true);
    tick(0);
    tick(500);
    expect(dts).toEqual([]);

    let resolved = false;
    const done = loop.step(2, 1 / 60).then(() => {
      resolved = true;
    });
    await expect(loop.step(1, 1 / 60)).rejects.toThrow("already");
    tick(1000);
    tick(1900);
    await Promise.resolve();
    expect(dts).toEqual([1 / 60, 1 / 60]);
    expect(resolved).toBe(false);
    tick(2000);
    await done;
    expect(resolved).toBe(true);
    tick(2100);
    expect(dts).toHaveLength(2);
    expect(loop.frame.time).toBeCloseTo(2 / 60, 9);
  });

  it("whenFrameCount resolves at the requested frame; stop() releases the scheduler", async () => {
    const { scheduler, tick, running } = fakeScheduler();
    const { performance } = fakePerformance();
    const loop = new FrameLoop({ modules: [], scheduler, getQuality, performance });
    loop.start();
    const reached = vi.fn();
    void loop.whenFrameCount(2).then(reached);
    tick(0);
    await Promise.resolve();
    expect(reached).not.toHaveBeenCalled();
    tick(16);
    await Promise.resolve();
    expect(reached).toHaveBeenCalledTimes(1);
    loop.stop();
    expect(running()).toBe(false);
  });

  it("routes a throwing step to onError and still runs the later steps; without onError it propagates", () => {
    const log: string[] = [];
    const { scheduler, tick } = fakeScheduler();
    const { performance, calls } = fakePerformance();
    const broken: ClientModule = {
      id: "gameplay",
      init: () => undefined,
      update: () => {
        throw new Error("boom");
      },
      dispose: () => undefined,
    };
    const onError = vi.fn();
    new FrameLoop({
      modules: [broken, fakeModule("render", log)],
      scheduler,
      getQuality,
      performance,
      onError,
    }).start();
    tick(0);
    expect(onError).toHaveBeenCalledWith("gameplay", expect.any(Error));
    expect(log).toEqual(["render"]);
    expect(calls).toContain("measure mc:gameplay:update from mc:gameplay:update:start");

    new FrameLoop({ modules: [broken], scheduler, getQuality, performance }).start();
    expect(() => tick(0)).toThrow("boom");
  });

  it("rejects two modules with the same id", () => {
    const { scheduler } = fakeScheduler();
    const { performance } = fakePerformance();
    expect(
      () =>
        new FrameLoop({ modules: [fakeModule("net", []), fakeModule("net", [])], scheduler, getQuality, performance }),
    ).toThrow("twice");
  });
});

describe("viewport, render scale and camera range", () => {
  it("caps the canvas DPR per preset and floors the drawing buffer", () => {
    expect(effectiveDpr(2, QUALITY_PRESETS.low.dprCap)).toBe(1);
    expect(effectiveDpr(2, QUALITY_PRESETS.high.dprCap)).toBe(1.5);
    expect(effectiveDpr(1.25, QUALITY_PRESETS.ultra.dprCap)).toBe(1.25);
    expect(effectiveDpr(Number.NaN, 2)).toBe(1);
    expect(drawingBufferSize(1280, 1.5)).toBe(1920);
    expect(drawingBufferSize(333, 1.5)).toBe(499);
    expect(drawingBufferSize(0, 1)).toBe(1);
  });

  it("ViewportTracker reports size, DPR and cap changes once, and ignores a hidden element", () => {
    const element = { clientWidth: 0, clientHeight: 0 };
    let deviceDpr = 2;
    let cap = 1;
    const tracker = new ViewportTracker({ element, getDeviceDpr: () => deviceDpr, getDprCap: () => cap });
    expect(tracker.poll()).toBe(false);
    element.clientWidth = 1920;
    element.clientHeight = 1080;
    expect(tracker.poll()).toBe(true);
    expect(tracker.current).toEqual({ widthCssPx: 1920, heightCssPx: 1080, dpr: 1 });
    expect(tracker.poll()).toBe(false);
    cap = 1.5;
    expect(tracker.poll()).toBe(true);
    expect(tracker.current.dpr).toBe(1.5);
    deviceDpr = 1;
    expect(tracker.poll()).toBe(true);
    expect(tracker.current.dpr).toBe(1);
    element.clientWidth = 0;
    expect(tracker.poll()).toBe(false);
    expect(tracker.current.widthCssPx).toBe(1920);
  });

  it("ViewportTracker with an observer reads the element only after a notification", () => {
    const element = { clientWidth: 640, clientHeight: 360 };
    let notify: () => void = () => undefined;
    const disconnect = vi.fn();
    const tracker = new ViewportTracker({
      element,
      getDeviceDpr: () => 1,
      getDprCap: () => 1,
      observe: (onResize) => {
        notify = onResize;
        return { disconnect };
      },
    });
    expect(tracker.poll()).toBe(true);
    element.clientWidth = 1280;
    expect(tracker.poll()).toBe(false);
    notify();
    expect(tracker.poll()).toBe(true);
    expect(tracker.current.widthCssPx).toBe(1280);
    tracker.dispose();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("RenderScale rests at the preset ceiling, clamps requests and honours pins", () => {
    const scale = new RenderScale(QUALITY_PRESETS.medium.dynres);
    expect(scale.current).toBe(0.85);
    expect(scale.set(0.1)).toBe(0.6);
    expect(scale.set(2)).toBe(0.85);
    scale.setRange(QUALITY_PRESETS.high.dynres);
    expect(scale.current).toBe(1);
    scale.setPin("floor");
    expect(scale.current).toBe(0.75);
    expect(scale.set(1)).toBe(0.75);
    expect(scale.pinned).toBe(true);
    expect(clampScale(Number.NaN, QUALITY_PRESETS.low.dynres)).toBe(0.75);
  });

  it("camera depth range follows rendering-pipeline section 4", () => {
    expect(cameraDepthRange(true)).toEqual({ near: 0.05, far: 30_000 });
    expect(cameraDepthRange(false)).toEqual({ near: 0.1, far: 6_000 });
  });
});
