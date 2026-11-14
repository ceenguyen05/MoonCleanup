import type { RenderBackend } from "@moon-cleanup/shared";
import { describe, expect, it, vi } from "vitest";
import {
  RendererHost,
  type CanvasMount,
  type DeviceLossInfo,
  type FrameCallback,
  type RendererDriver,
} from "./renderer-host";

interface FakeRenderer {
  readonly id: number;
  readonly canvas: FakeCanvas;
  readonly forceWebGL: boolean;
  lose: ((info: DeviceLossInfo) => void) | null;
  loop: FrameCallback | null;
  initialised: boolean;
  disposed: boolean;
}
interface FakeCanvas {
  readonly id: number;
  mounted: boolean;
}

const LOSS: DeviceLossInfo = { api: "WebGPU", message: "GPU process restarted", reason: "unknown" };
const CONTEXT_LOSS: DeviceLossInfo = { api: "WebGL", message: "context lost", reason: null };

function setup(
  options: { backends?: RenderBackend[]; failInitAt?: number; loseDuringInitAt?: number; maxLosses?: number } = {},
) {
  const renderers: FakeRenderer[] = [];
  const canvases: FakeCanvas[] = [];
  const driver: RendererDriver<FakeRenderer, FakeCanvas> = {
    create: ({ canvas, forceWebGL }) => {
      const renderer: FakeRenderer = {
        id: renderers.length,
        canvas,
        forceWebGL,
        lose: null,
        loop: null,
        initialised: false,
        disposed: false,
      };
      renderers.push(renderer);
      return renderer;
    },
    init: async (renderer) => {
      await Promise.resolve();
      if (options.loseDuringInitAt === renderer.id) renderer.lose?.(LOSS);
      if (options.failInitAt === renderer.id) throw new Error("no backend");
      renderer.initialised = true;
    },
    readBackend: (renderer) => options.backends?.[renderer.id] ?? "webgpu",
    onDeviceLost: (renderer, handler) => {
      renderer.lose = handler;
    },
    setAnimationLoop: (renderer, callback) => {
      renderer.loop = callback;
    },
    dispose: (renderer) => {
      renderer.disposed = true;
      renderer.loop = null;
    },
  };
  const mount: CanvasMount<FakeCanvas> = {
    create: () => {
      const canvas = { id: canvases.length, mounted: false };
      canvases.push(canvas);
      return canvas;
    },
    mount: (canvas, previous) => {
      if (previous !== null) previous.mounted = false;
      canvas.mounted = true;
    },
    unmount: (canvas) => {
      canvas.mounted = false;
    },
  };
  let nextFrameId = 1;
  const fallbackFrames = new Map<number, FrameCallback>();
  const host = new RendererHost({
    driver,
    canvases: mount,
    forceWebGL: false,
    delay: () => Promise.resolve(),
    requestFrame: (callback) => {
      fallbackFrames.set(nextFrameId, callback);
      return nextFrameId++;
    },
    cancelFrame: (id) => {
      fallbackFrames.delete(id);
    },
    ...(options.maxLosses === undefined ? {} : { maxLosses: options.maxLosses }),
  });
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const at = (index: number): FakeRenderer => {
    const renderer = renderers[index];
    if (renderer === undefined) throw new Error(`no renderer ${String(index)}`);
    return renderer;
  };
  return { host, renderers, canvases, fallbackFrames, flush, at };
}

describe("RendererHost", () => {
  it("creates, initialises and reads back the backend", async () => {
    const { host, at, canvases } = setup({ backends: ["webgl2"] });
    expect(host.state).toBe("idle");
    await host.start();
    expect(host.state).toBe("ready");
    expect(host.current).toBe(at(0));
    expect(at(0).initialised).toBe(true);
    expect(host.backend).toBe("webgl2");
    expect(host.canvas).toBe(canvases[0]);
    expect(canvases[0]?.mounted).toBe(true);
  });

  it("recreates the renderer on a fresh canvas after a device loss", async () => {
    const { host, at, canvases, flush } = setup();
    await host.start();
    const lost = vi.fn();
    const recreated = vi.fn();
    host.onLost(lost);
    host.onRecreated(recreated);

    at(0).lose?.(LOSS);
    // Synchronously: no renderer to draw with, listeners told.
    expect(host.current).toBeNull();
    expect(host.state).toBe("recovering");
    expect(lost).toHaveBeenCalledWith(LOSS, 1);

    await flush();
    expect(at(0).disposed).toBe(true);
    expect(host.state).toBe("ready");
    expect(host.current).toBe(at(1));
    expect(at(1).initialised).toBe(true);
    expect(host.canvas).toBe(canvases[1]);
    expect(canvases[0]?.mounted).toBe(false);
    expect(canvases[1]?.mounted).toBe(true);
    expect(recreated).toHaveBeenCalledWith({ renderer: at(1), canvas: canvases[1], backend: "webgpu", lossCount: 1 });
    expect(host.lossCount).toBe(1);
  });

  it("handles a WebGL context loss the same way and reports a changed backend", async () => {
    const { host, at, flush } = setup({ backends: ["webgpu", "webgl2"] });
    await host.start();
    const recreated = vi.fn();
    host.onRecreated(recreated);
    at(0).lose?.(CONTEXT_LOSS);
    await flush();
    expect(host.backend).toBe("webgl2");
    expect(recreated.mock.calls[0]?.[0]).toMatchObject({ backend: "webgl2" });
  });

  it("keeps frames ticking through a loss and moves the loop to the new renderer", async () => {
    const { host, at, fallbackFrames, flush } = setup();
    await host.start();
    const frame = vi.fn();
    host.scheduler.start(frame);
    expect(at(0).loop).toBe(frame);

    at(0).lose?.(LOSS);
    // While recovering the callback runs on the fallback frame source.
    expect(fallbackFrames.size).toBe(1);
    // Fire the pending frame the way the browser does: a fired request is consumed, the tick requests the next.
    const [firedId, fire] = [...fallbackFrames.entries()][0] ?? [0, () => undefined];
    fallbackFrames.delete(firedId);
    fire(16);
    expect(frame).toHaveBeenCalledWith(16);
    expect(fallbackFrames.size).toBe(1);

    await flush();
    expect(at(1).loop).toBe(frame);
    expect(fallbackFrames.size).toBe(0);

    host.scheduler.stop();
    expect(at(1).loop).toBeNull();
  });

  it("ignores a late loss report from a renderer that was already replaced", async () => {
    const { host, at, renderers, flush } = setup();
    await host.start();
    at(0).lose?.(LOSS);
    await flush();
    at(0).lose?.(LOSS);
    await flush();
    expect(renderers).toHaveLength(2);
    expect(host.lossCount).toBe(1);
  });

  it("retries when the device is lost while the replacement initialises", async () => {
    const { host, at, renderers, flush } = setup({ loseDuringInitAt: 1 });
    await host.start();
    const recreated = vi.fn();
    host.onRecreated(recreated);
    at(0).lose?.(LOSS);
    await flush();
    expect(renderers).toHaveLength(3);
    expect(at(1).disposed).toBe(true);
    expect(host.current).toBe(at(2));
    expect(host.lossCount).toBe(2);
    expect(recreated).toHaveBeenCalledTimes(1);
  });

  it("gives up after the loss limit and reports a fatal error", async () => {
    const { host, at, renderers, fallbackFrames, flush } = setup({ maxLosses: 1 });
    await host.start();
    const fatal = vi.fn();
    host.onFatal(fatal);
    host.scheduler.start(() => undefined);
    at(0).lose?.(LOSS);
    await flush();
    at(1).lose?.(LOSS);
    await flush();
    expect(renderers).toHaveLength(2);
    expect(host.state).toBe("failed");
    expect(host.current).toBeNull();
    expect(fatal).toHaveBeenCalledTimes(1);
    expect((fatal.mock.calls[0]?.[0] as Error).message).toContain("limit 1");
    // Net, audio and UI keep their frame callback.
    expect(fallbackFrames.size).toBe(1);
  });

  it("reports a fatal error when the replacement cannot start", async () => {
    const { host, at, flush } = setup({ failInitAt: 1 });
    await host.start();
    const fatal = vi.fn();
    host.onFatal(fatal);
    at(0).lose?.(LOSS);
    await flush();
    expect(host.state).toBe("failed");
    expect(at(1).disposed).toBe(true);
    expect((fatal.mock.calls[0]?.[0] as Error).message).toBe("no backend");
  });

  it("start() rejects and disposes the renderer when no backend starts", async () => {
    const { host, at } = setup({ failInitAt: 0 });
    await expect(host.start()).rejects.toThrow("no backend");
    expect(host.state).toBe("failed");
    expect(at(0).disposed).toBe(true);
  });

  it("dispose releases the renderer, the canvas and the loop, and stops recovery", async () => {
    const { host, at, canvases, renderers, fallbackFrames, flush } = setup();
    await host.start();
    host.scheduler.start(() => undefined);
    at(0).lose?.(LOSS);
    host.dispose();
    await flush();
    expect(host.state).toBe("disposed");
    expect(host.current).toBeNull();
    expect(fallbackFrames.size).toBe(0);
    expect(renderers.every((renderer) => renderer.disposed)).toBe(true);
    expect(canvases.every((canvas) => !canvas.mounted)).toBe(true);
  });
});
