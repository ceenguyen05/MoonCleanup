import { describe, expect, it } from "vitest";
import type { ModuleContext } from "@moon-cleanup/shared";
import { GpuTimingModule, GpuTimingPump, gpuTimingMode, type GpuTimedRendererLike } from "./gpu-timing";
import type { RenderServices } from "./module";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function fakeRenderer(renderMs: number, computeMs: number) {
  const calls: string[] = [];
  const renderer: GpuTimedRendererLike = {
    info: { render: { timestamp: renderMs }, compute: { timestamp: computeMs } },
    resolveTimestampsAsync: (type) => {
      calls.push(type);
      return Promise.resolve();
    },
  };
  return { renderer, calls };
}

describe("gpuTimingMode", () => {
  it("uses timestamp queries only on WebGPU with the feature", () => {
    expect(gpuTimingMode("webgpu", true)).toBe("timestamp-query");
    expect(gpuTimingMode("webgpu", false)).toBe("none");
    expect(gpuTimingMode("webgl2", true)).toBe("none");
  });
});

describe("GpuTimingPump", () => {
  it("resolves sparsely and reports render + compute ms to the renderer service", async () => {
    const { renderer, calls } = fakeRenderer(9, 1.5);
    const reported: number[] = [];
    const service = { backend: "webgpu", renderer, reportGpuFrameMs: (ms: number) => reported.push(ms) };
    const pump = new GpuTimingPump({ everyFrames: 4 });
    for (let i = 0; i < 3; i++) pump.update(service, "timestamp-query");
    await flush();
    expect(calls).toEqual([]);
    pump.update(service, "timestamp-query");
    await flush();
    expect(calls).toEqual(["render", "compute"]);
    expect(reported).toEqual([10.5]);
    expect(pump.samples).toBe(1);
    // The next window starts counting again.
    for (let i = 0; i < 4; i++) pump.update(service, "timestamp-query");
    await flush();
    expect(reported).toEqual([10.5, 10.5]);
  });

  it("keeps one request in flight", async () => {
    let release: () => void = () => undefined;
    let calls = 0;
    const renderer: GpuTimedRendererLike = {
      info: { render: { timestamp: 5 }, compute: { timestamp: 0 } },
      resolveTimestampsAsync: () => {
        calls += 1;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    };
    const service = { backend: "webgpu", renderer, reportGpuFrameMs: () => undefined };
    const pump = new GpuTimingPump({ everyFrames: 1 });
    for (let i = 0; i < 10; i++) pump.update(service, "timestamp-query");
    expect(calls).toBe(1);
    release();
    await flush();
    pump.update(service, "timestamp-query");
    expect(calls).toBe(2);
  });

  it("does nothing without timestamp support: no query, no report (dynres keeps the frame interval)", async () => {
    const { renderer, calls } = fakeRenderer(9, 1);
    const reported: number[] = [];
    const service = { backend: "webgl2", renderer, reportGpuFrameMs: (ms: number) => reported.push(ms) };
    const pump = new GpuTimingPump({ everyFrames: 1 });
    for (let i = 0; i < 5; i++) pump.update(service, gpuTimingMode(service.backend, true));
    await flush();
    expect(calls).toEqual([]);
    expect(reported).toEqual([]);
  });

  it("ignores an empty result (timestamp 0) and a renderer that is being recreated", async () => {
    const { renderer } = fakeRenderer(0, 0);
    const reported: number[] = [];
    const service = {
      backend: "webgpu",
      renderer: renderer as unknown,
      reportGpuFrameMs: (ms: number) => reported.push(ms),
    };
    const pump = new GpuTimingPump({ everyFrames: 1 });
    pump.update(service, "timestamp-query");
    await flush();
    expect(reported).toEqual([]);
    pump.update({ ...service, renderer: null }, "timestamp-query");
    await flush();
    expect(reported).toEqual([]);
  });

  it("survives a rejected resolve and keeps going", async () => {
    let fail = true;
    const renderer: GpuTimedRendererLike = {
      info: { render: { timestamp: 4 }, compute: { timestamp: 1 } },
      resolveTimestampsAsync: () => (fail ? Promise.reject(new Error("lost")) : Promise.resolve()),
    };
    const reported: number[] = [];
    const service = { backend: "webgpu", renderer, reportGpuFrameMs: (ms: number) => reported.push(ms) };
    const pump = new GpuTimingPump({ everyFrames: 1 });
    pump.update(service, "timestamp-query");
    await flush();
    expect(reported).toEqual([]);
    fail = false;
    pump.update(service, "timestamp-query");
    await flush();
    expect(reported).toEqual([5]);
  });

  it("stops after dispose", async () => {
    const { renderer, calls } = fakeRenderer(4, 1);
    const service = { backend: "webgpu", renderer, reportGpuFrameMs: () => undefined };
    const pump = new GpuTimingPump({ everyFrames: 1 });
    pump.dispose();
    pump.update(service, "timestamp-query");
    await flush();
    expect(calls).toEqual([]);
  });
});

describe("GpuTimingModule (production hook)", () => {
  function ctxFor(backend: string, gpuTiming: boolean, renderer: unknown, reported: number[]) {
    const services: Record<string, unknown> = {
      renderer: { backend, renderer, reportGpuFrameMs: (ms: number) => reported.push(ms) },
      quality: { capabilities: { gpuTiming } },
    };
    return {
      services: { get: (key: string) => services[key], has: (key: string) => key in services },
      events: {},
    } as unknown as ModuleContext<RenderServices>;
  }

  it("feeds the dynres controller on WebGPU with timestamp-query, without any DOM or window access", async () => {
    const { renderer } = fakeRenderer(8, 2);
    const reported: number[] = [];
    const module = new GpuTimingModule({ everyFrames: 2 });
    expect(module.id).toBe("debug");
    module.init(ctxFor("webgpu", true, renderer, reported));
    module.update();
    module.update();
    await flush();
    expect(reported).toEqual([10]);
    expect(module.samples).toBe(1);
    module.dispose();
    module.update();
  });

  it("is a no-op on WebGL2 or without the feature", async () => {
    for (const [backend, feature] of [
      ["webgl2", true],
      ["webgpu", false],
    ] as const) {
      const { renderer, calls } = fakeRenderer(8, 2);
      const reported: number[] = [];
      const module = new GpuTimingModule({ everyFrames: 1 });
      module.init(ctxFor(backend, feature, renderer, reported));
      for (let i = 0; i < 4; i++) module.update();
      await flush();
      expect(calls).toEqual([]);
      expect(reported).toEqual([]);
    }
  });
});
