// The real renderer: three r187 `WebGPURenderer` (WebGPU backend with automatic WebGL2 fallback, or WebGL2 forced).
// docs/architecture/rendering-pipeline.md section 2.1 step 6 and section 4; API per docs/vendor/three-r187
// (WebGPURenderer.html.md, manual/webgpurenderer.html, migration guide: `await renderer.init()` then `render()`).
//
// This file and pipeline.ts / scene-roots.ts / smoke-scene.ts are the only render files that import three.

import { HalfFloatType, WebGPURenderer } from "three/webgpu";
import { readStartedBackend } from "./backend";
import type { CanvasMount, RendererDriver } from "./renderer-host";

export interface ThreeDriverOptions {
  /**
   * Enables GPU timestamp queries (`timestamp-query` / the WebGL2 timer extension) for the perf HUD and the
   * dynamic-resolution controller. Off by default: resolving queries costs CPU every frame.
   */
  readonly trackTimestamp?: boolean;
}

/** Driver the RendererHost uses to create, initialise and release `WebGPURenderer` instances. */
export function createThreeDriver(options: ThreeDriverOptions = {}): RendererDriver<WebGPURenderer, HTMLCanvasElement> {
  return {
    create({ canvas, forceWebGL }) {
      const renderer = new WebGPURenderer({
        canvas,
        forceWebGL,
        // Anti-aliasing is a post step (SMAA / TRAA, section 8.1), never MSAA on the default framebuffer.
        antialias: false,
        // Reversed-Z (section 4). The WebGL2 backend needs EXT_clip_control and reports back when it is missing.
        reversedDepthBuffer: true,
        // The canvas is the bottom layer of the page; the DOM UI sits above it. Opaque is cheaper to composite and
        // avoids the premultiplied-alpha pitfalls of r185.
        alpha: false,
        depth: true,
        stencil: false,
        // HDR working buffers on every preset (section 8.2).
        outputBufferType: HalfFloatType,
        powerPreference: "high-performance",
        trackTimestamp: options.trackTimestamp === true,
      });
      // Black clear, no gradient (VT-M0-01). The sky is drawn by visuals/sky, not by a background colour.
      renderer.setClearColor(0x000000, 1);
      return renderer;
    },

    async init(renderer) {
      await renderer.init();
    },

    readBackend(renderer) {
      return readStartedBackend(renderer.backend);
    },

    onDeviceLost(renderer, handler) {
      // Replaces three's default handler (which only logs and stops rendering): the host recreates the renderer.
      renderer.onDeviceLost = (info) => {
        handler({ api: info.api, message: info.message, reason: info.reason });
      };
    },

    setAnimationLoop(renderer, callback) {
      // Async only because it would initialise an uninitialised renderer; ours is initialised already.
      renderer.setAnimationLoop(callback).catch(() => undefined);
    },

    dispose(renderer) {
      renderer.dispose().catch(() => undefined);
    },
  };
}

/** Creates canvases inside `container` (as its first child, below the DOM UI) and swaps them on recreation. */
export function createCanvasMount(container: HTMLElement): CanvasMount<HTMLCanvasElement> {
  return {
    create() {
      const canvas = container.ownerDocument.createElement("canvas");
      canvas.dataset["mcCanvas"] = "main";
      // The canvas fills its container; its drawing-buffer size is set by the renderer (CSS size x capped DPR).
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      return canvas;
    },
    mount(canvas, previous) {
      if (previous !== null && previous.parentNode !== null) previous.replaceWith(canvas);
      else container.prepend(canvas);
    },
    unmount(canvas) {
      canvas.remove();
    },
  };
}

export interface WebGl2Probe {
  readonly supported: boolean;
  /** `WEBGL_debug_renderer_info` unmasked renderer, else `gl.RENDERER`; empty when unsupported. */
  readonly renderer: string;
}

/**
 * Checks WebGL2 on a throwaway canvas (never the game canvas: asking it for a `webgl2` context would rule out
 * WebGPU on it) and reads the GPU description for the tier classifier. The probe context is released at once.
 */
export function probeWebGl2(ownerDocument: Document): WebGl2Probe {
  let gl: WebGL2RenderingContext | null = null;
  try {
    const canvas = ownerDocument.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    gl = canvas.getContext("webgl2");
  } catch {
    gl = null;
  }
  if (gl === null) return { supported: false, renderer: "" };

  let renderer = "";
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const value: unknown = gl.getParameter(info === null ? gl.RENDERER : info.UNMASKED_RENDERER_WEBGL);
    renderer = typeof value === "string" ? value : "";
  } catch {
    renderer = "";
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return { supported: true, renderer };
}

export interface ProbedFeatures {
  readonly gpuTiming: boolean;
  readonly float32Filterable: boolean;
  readonly textureCompressionBc: boolean;
  readonly reversedDepth: boolean;
}

/**
 * Capability flags of an initialised renderer (section 2.1 table). `hasFeature` takes WebGPU feature names on both
 * backends; the WebGL2 backend maps them to its extensions (three `GLFeatureName`).
 */
export function probeFeatures(renderer: WebGPURenderer): ProbedFeatures {
  return {
    gpuTiming: renderer.hasFeature("timestamp-query"),
    float32Filterable: renderer.hasFeature("float32-filterable"),
    textureCompressionBc: renderer.hasFeature("texture-compression-bc"),
    reversedDepth: renderer.reversedDepthBuffer,
  };
}
