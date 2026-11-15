// Capture / test hooks of the screenshot harness and the e2e smoke test (contract: `McHooks` and `McInfo` in
// tools/screenshots/src/harness.ts, M0-W1-T05): `window.__mcReady`, `window.__mcStep(n, dt)`, `window.__mcInfo()`.
//
// The composition root owns `window`; it calls `installHarnessHooks(window, ...)` after it has started the frame
// loop. The shapes are repeated structurally here because apps never import tools.

import type { FrameLoop } from "./frame-loop";
import type { DynamicResolutionState, RenderFrameStats, RenderRendererService } from "./module";
import type { RenderQualityService } from "./quality-service";

/** `McInfo` of the harness: runtime facts for the capture sidecar. */
export interface HarnessInfo {
  readonly backend: string;
  readonly tier: string;
  readonly preset: string;
  readonly gpu: string;
  readonly dpr: number;
  readonly renderScale: number;
  readonly frameTimeAvgMs: number;
  readonly frameTimeP95Ms: number;
  readonly drawCalls: number;
  readonly triangles: number;
  /** Placeholder until the budget-aware asset cache accounts textures (rendering-pipeline.md section 13). */
  readonly texPoolMB: number;
  readonly placeholderAssets: readonly string[];
  readonly lossCount: number;
}

/** The window properties the harness reads. */
export interface HarnessHookTarget {
  __mcReady?: boolean;
  __mcStep?: (n: number, dtSeconds: number) => Promise<void>;
  __mcInfo?: () => HarnessInfo;
  /** Dynamic-resolution read-out (a copy), for capture sidecars and the perf tools (M0-W3-T08). */
  __mcDynres?: () => DynamicResolutionState;
  /** `RenderRendererService.setRenderScale` for sweeps without a reload; returns the scale in effect (a pin wins). */
  __mcRenderScale?: (scale: number) => number;
  /** Render-infra read-out for perf tools: warm-up, draw budget, memory ledger, three's tracker, dynres. Allocates. */
  __mcRender?: () => unknown;
}

/** Frames rendered before `__mcReady`: the first compiles the pipelines, the next ones prove a stable frame. */
export const READY_WARMUP_FRAMES = 3;
/** Fixed step of the warm-up frames in capture mode (the harness's FIXED_DT). */
export const CAPTURE_FIXED_DT_S = 1 / 60;

export interface HarnessHookOptions {
  // Only the loop's stepping surface is used, so any service-type parameter fits.
  readonly loop: Pick<
    FrameLoop,
    "frameCount" | "setManual" | "step" | "whenFrameCount" | "frameTimeStats" | "isManual"
  >;
  readonly renderer: RenderRendererService;
  readonly quality: RenderQualityService;
  /** `?capture=1`: the loop is put into manual mode and only `__mcStep` advances frames after the warm-up. */
  readonly capture: boolean;
  /** Extra readiness the app waits for (asset streaming idle, net state, ...). */
  readonly alsoReady?: () => Promise<void>;
  /** Ids of placeholder assets in the scene, for the sidecar. */
  readonly placeholderAssets?: () => readonly string[];
}

/**
 * Installs the hooks on `target` (the window) and resolves when `__mcReady` has been set. The frame loop must be
 * started already.
 */
export async function installHarnessHooks(target: HarnessHookTarget, options: HarnessHookOptions): Promise<void> {
  const { loop, renderer, quality } = options;
  const stats: RenderFrameStats = { drawCalls: 0, triangles: 0 };

  target.__mcReady = false;
  target.__mcInfo = () => {
    renderer.readStats(stats);
    const times = loop.frameTimeStats();
    return {
      backend: renderer.backend,
      tier: renderer.tier,
      preset: quality.current.preset,
      gpu: quality.capabilities.gpuDescription,
      dpr: renderer.viewport.dpr,
      renderScale: renderer.renderScale,
      frameTimeAvgMs: times.avgMs,
      frameTimeP95Ms: times.p95Ms,
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
      texPoolMB: 0,
      placeholderAssets: options.placeholderAssets?.() ?? [],
      lossCount: renderer.lossCount,
    };
  };
  target.__mcDynres = () => ({ ...renderer.dynamicResolution });
  target.__mcRenderScale = (scale) => renderer.setRenderScale(scale);
  target.__mcRender = () => ({
    warmup: { ...renderer.pipelineWarmup },
    drawBudget: { ...renderer.drawBudget },
    memory: {
      totalBytes: renderer.memory.totals.totalBytes,
      budgetBytes: renderer.memory.totals.budgetBytes,
      overCategories: renderer.memory.totals.overCategories,
      bytes: { ...renderer.memory.totals.bytes },
      entries: renderer.memory.list(),
    },
    rendererInfo: { ...renderer.rendererInfo },
    dynres: { ...renderer.dynamicResolution },
  });
  target.__mcStep = (n, dtSeconds) => {
    if (!loop.isManual) return Promise.reject(new Error("__mcStep needs ?capture=1"));
    return loop.step(n, dtSeconds);
  };

  if (options.alsoReady !== undefined) await options.alsoReady();
  if (options.capture) {
    // Deterministic from the first frame: the warm-up frames use the fixed step too.
    loop.setManual(true);
    await loop.step(READY_WARMUP_FRAMES, CAPTURE_FIXED_DT_S);
  } else {
    await loop.whenFrameCount(loop.frameCount + READY_WARMUP_FRAMES);
  }
  target.__mcReady = true;
}
