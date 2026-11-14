import { describe, expect, it } from "vitest";
import type { ModuleContext } from "@moon-cleanup/shared";
import type { RenderServices } from "../render";
import { DebugModule, type DebugHookTarget } from "./module";

interface FakeEl {
  id: string;
  hidden: boolean;
  textContent: string;
  style: Record<string, string>;
  removed: boolean;
  setAttribute(): void;
  remove(): void;
}

function fakeEnv() {
  const els: FakeEl[] = [];
  const listeners = new Map<string, (e: unknown) => void>();
  const doc = {
    body: { appendChild: (e: FakeEl) => els.push(e) },
    createElement: (): FakeEl => {
      const el: FakeEl = {
        id: "",
        hidden: false,
        textContent: "",
        style: {},
        removed: false,
        setAttribute: () => undefined,
        remove() {
          el.removed = true;
        },
      };
      return el;
    },
  };
  const win = {
    document: doc,
    navigator: { userAgent: "test" },
    addEventListener: (t: string, l: (e: unknown) => void) => listeners.set(t, l),
    removeEventListener: (t: string) => listeners.delete(t),
  } as unknown as Window & DebugHookTarget;
  return { els, listeners, win, doc: doc as unknown as Document };
}

function fakeCtx(): ModuleContext<RenderServices> {
  const renderer = {
    backend: "webgl2",
    tier: "C",
    renderScale: 1,
    framesRendered: 1,
    lossCount: 0,
    viewport: { widthCssPx: 10, heightCssPx: 10, dpr: 1 },
    renderer: null,
    readStats(out: { drawCalls: number; triangles: number }) {
      out.drawCalls = 7;
      out.triangles = 99;
    },
  };
  const services = {
    renderer,
    quality: { current: { preset: "low" }, capabilities: { gpuDescription: "fake", gpuTiming: false } },
    uiStore: { getState: () => ({ session: { rttMs: 12, conn: "open" } }) },
    sceneRoots: {},
  } as Record<string, unknown>;
  return {
    services: { get: (k: string) => services[k], has: (k: string) => k in services, register: () => undefined },
    events: {},
  } as unknown as ModuleContext<RenderServices>;
}

describe("DebugModule GPU timing", () => {
  it("reports render + compute GPU ms to the renderer service so dynres can steer on them", async () => {
    const { win, doc } = fakeEnv();
    const reported: number[] = [];
    const ctx = fakeCtx();
    const renderer = ctx.services.get("renderer") as unknown as Record<string, unknown>;
    renderer.backend = "webgpu";
    renderer.reportGpuFrameMs = (ms: number) => reported.push(ms);
    renderer.renderer = {
      info: {
        render: { drawCalls: 1, triangles: 1, timestamp: 11.5 },
        compute: { timestamp: 2 },
        memory: { geometries: 0, textures: 0, total: 0, texturesSize: 0 },
      },
      resolveTimestampsAsync: () => Promise.resolve(),
    };
    (ctx.services.get("quality") as unknown as { capabilities: { gpuTiming: boolean } }).capabilities.gpuTiming = true;

    let t = 0;
    const mod = new DebugModule({
      getLoop: () => ({ lastStepMs: () => 1 }),
      win,
      doc,
      now: () => (t += 1),
      gpuResolveEvery: 1,
    });
    mod.init(ctx);
    mod.update({ dt: 0.016, time: 0, alpha: 0, simTick: 0, quality: {} } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reported).toEqual([13.5]);
    mod.dispose();
  });
});

describe("DebugModule", () => {
  it("installs hooks, toggles with F3, exports stats and disposes cleanly", () => {
    const { els, listeners, win, doc } = fakeEnv();
    let t = 0;
    const mod = new DebugModule({ getLoop: () => ({ lastStepMs: () => 1 }), win, doc, now: () => (t += 1) });
    mod.init(fakeCtx());
    expect(typeof win.__mcStats).toBe("function");
    expect(els[0]?.hidden).toBe(true);

    listeners.get("keydown")?.({ key: "F3", preventDefault: () => undefined });
    expect(els[0]?.hidden).toBe(false);

    const frame = { dt: 0.016, time: 0, alpha: 0, simTick: 0, quality: {} } as never;
    for (let i = 0; i < 5; i++) mod.update(frame);
    const snap = win.__mcStats?.();
    expect(snap?.render.drawCalls).toBe(7);
    expect(snap?.gpu.measured).toBe(false);
    expect(snap?.net.rttMs).toBe(12);
    expect(els[0]?.textContent).toContain("CPU only");

    mod.dispose();
    expect(els[0]?.removed).toBe(true);
    expect(win.__mcStats).toBeUndefined();
    expect(listeners.size).toBe(0);
  });
});
