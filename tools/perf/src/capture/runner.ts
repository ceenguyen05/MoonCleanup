// Playwright capture runner: headed Chrome on a chosen adapter, scripted camera path, warm-up discarded, N runs,
// every frame interval recorded in-page, HUD snapshots every second. Writes JSON + Markdown.
// Requires a running client (`pnpm --filter @moon-cleanup/client dev` on port 5173+N) with the debug module registered.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { compareClient } from "../budgets";
import { describeMachine } from "../machine";
import type { CaptureResult, HardwareTierLetter, PerfSnapshot, RunMetrics } from "../schema";
import { renderSummary, aggregateRuns } from "../summary";
import { orbitPath, ORBIT_PATH_ID, reduceRun } from "./reduce";

export type AdapterFlag = "high-performance" | "low-power" | "default";

export interface CaptureOptions {
  readonly url: string;
  readonly milestone: string;
  readonly scene: string;
  readonly seed: string;
  readonly tier: HardwareTierLetter;
  readonly preset: string;
  readonly backend: "webgpu" | "webgl2" | "auto";
  readonly adapter: AdapterFlag;
  readonly runs: number;
  readonly warmupS: number;
  readonly captureS: number;
  readonly outDir: string;
  /** Path spec JSON; default is the built-in orbit. */
  readonly cameraPath: unknown;
  readonly cameraPathId: string;
  /** `true` only when the machine is a real device of `tier`. Default false: provisional. */
  readonly realDevice: boolean;
  readonly headless: boolean;
  /** Extra URL query (`a=b&c=d`), e.g. `scale=ceil&dpr=0.89&terrainBase=...`. */
  readonly extraQuery?: string;
  /** Playwright viewport (default 1920x1080, DPR 1). */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Page readiness timeout (default 120 s); the device report uses a short one so a broken scene cannot eat the budget. */
  readonly readyTimeoutMs?: number;
}

interface McWindow {
  __mcReady?: boolean;
  __mcStats?: () => PerfSnapshot;
  __mcStatsReset?: () => void;
  __mcCameraPath?: (spec: unknown) => void;
  __mcFrames?: { buf: Float64Array; n: number; on: boolean };
}

export const PAGE_NAME_SHIM = "globalThis.__name = globalThis.__name || function (f) { return f; };";

/** Only local clients: production is never a test target. */
export function assertLocalUrl(url: string): void {
  const host = new URL(url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") {
    throw new Error(`perf captures target a local client only (got host "${host}")`);
  }
}

export function chromeArgs(adapter: AdapterFlag): string[] {
  const args = [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,WebGPU",
    "--ignore-gpu-blocklist",
    "--disable-frame-rate-limit",
  ];
  // Chrome GPU-selection switches; the adapter that actually ran is reported in the snapshot (env.gpu).
  if (adapter === "high-performance") args.push("--force_high_performance_gpu");
  if (adapter === "low-power") args.push("--force_low_power_gpu");
  return args;
}

export function captureUrl(o: CaptureOptions): string {
  const u = new URL(o.url);
  u.searchParams.set("scene", o.scene);
  u.searchParams.set("preset", o.preset);
  u.searchParams.set("seed", o.seed);
  u.searchParams.set("perf", "1");
  if (o.backend !== "auto") u.searchParams.set("backend", o.backend);
  if (o.extraQuery !== undefined) {
    for (const [k, v] of new URLSearchParams(o.extraQuery)) u.searchParams.set(k, v);
  }
  return u.toString();
}

export async function oneRun(
  page: Page,
  o: CaptureOptions,
): Promise<{ metrics: RunMetrics; last: PerfSnapshot; terrainSource: string | null }> {
  const readyTimeout = o.readyTimeoutMs ?? 120_000;
  // The dev server transforms modules on first request and a heavy page can miss the default 30 s `load` event while
  // the app is still booting. Readiness is the app's own __mcReady hook (waited below), so only wait for the response
  // to commit, allow the full ready budget, and retry the navigation once.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(captureUrl(o), { waitUntil: "commit", timeout: readyTimeout });
      break;
    } catch (err) {
      if (attempt >= 2) throw err;
      console.log(`[perf] goto failed (${err instanceof Error ? err.message.split("\n")[0] : "error"}); retrying once`);
    }
  }
  await page.waitForFunction(() => (window as unknown as McWindow).__mcReady === true, undefined, {
    timeout: readyTimeout,
  });
  if (o.scene === "bench") {
    // Bench v1 loads the baked terrain asynchronously: wait for the scene, not only for __mcReady.
    await page.waitForFunction(
      () => (window as unknown as { __mcBench?: { ready: boolean } }).__mcBench?.ready === true,
      undefined,
      { timeout: readyTimeout },
    );
  }
  let terrainSource: string | null = null;
  if (o.scene === "bench") {
    const src = await page.evaluate(
      () =>
        (window as unknown as { __mcBench?: { stats(): { terrainSource: string } } }).__mcBench?.stats().terrainSource,
    );
    terrainSource = src ?? null;
    console.log(`[perf] bench terrainSource=${String(src)}`);
  }
  await page.waitForFunction(() => typeof (window as unknown as McWindow).__mcStats === "function", undefined, {
    timeout: 5_000,
  });
  await page.evaluate((spec) => (window as unknown as McWindow).__mcCameraPath?.(spec), o.cameraPath);
  await page.waitForTimeout(o.warmupS * 1000);
  // Warm-up over: drop its statistics and start the in-page frame recorder (preallocated, no growth during the run).
  await page.evaluate((seconds) => {
    const w = window as unknown as McWindow;
    w.__mcStatsReset?.();
    const rec = { buf: new Float64Array(Math.ceil(seconds * 400)), n: 0, on: true };
    w.__mcFrames = rec;
    let prev = performance.now();
    const tick = (t: number): void => {
      if (!rec.on) return;
      if (rec.n < rec.buf.length) rec.buf[rec.n++] = t - prev;
      prev = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, o.captureS);
  const snapshots: PerfSnapshot[] = [];
  for (let s = 0; s < o.captureS; s++) {
    await page.waitForTimeout(1000);
    snapshots.push(await page.evaluate(() => (window as unknown as McWindow).__mcStats?.() as PerfSnapshot));
  }
  const frames = await page.evaluate(() => {
    const rec = (window as unknown as McWindow).__mcFrames;
    if (rec === undefined) return [];
    rec.on = false;
    return Array.from(rec.buf.subarray(1, rec.n));
  });
  return {
    metrics: reduceRun(frames, snapshots),
    last: snapshots[snapshots.length - 1] as PerfSnapshot,
    terrainSource,
  };
}

export async function runCapture(
  o: CaptureOptions,
): Promise<{ jsonPath: string; mdPath: string; result: CaptureResult }> {
  assertLocalUrl(o.url);
  const browser = await chromium.launch({
    channel: "chrome",
    headless: o.headless,
    args: chromeArgs(o.adapter),
  });
  const runs: RunMetrics[] = [];
  let last: PerfSnapshot | null = null;
  try {
    const version = browser.version();
    for (let i = 0; i < o.runs; i++) {
      const context = await browser.newContext({
        viewport: o.viewport ?? { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      });
      // tsx/esbuild keepNames wraps named functions in `__name(...)`, which does not exist in the page when a
      // function is serialised through page.evaluate. A plain-string init script defines the no-op helper.
      await context.addInitScript(PAGE_NAME_SHIM);
      const page = await context.newPage();
      const run = await oneRun(page, o);
      runs.push(run.metrics);
      last = run.last;
      await context.close();
    }
    if (last === null) throw new Error("no runs executed");
    const result: CaptureResult = {
      kind: "client-capture",
      createdAt: new Date().toISOString(),
      milestone: o.milestone,
      scene: o.scene,
      seed: o.seed,
      cameraPath: o.cameraPathId,
      tier: o.tier,
      preset: o.preset,
      backend: last.env.backend,
      warmupS: o.warmupS,
      captureS: o.captureS,
      machine: describeMachine(`Chrome ${version}`, last.env.gpu || "unknown", o.adapter),
      provisional: !o.realDevice,
      gpuTimingSource: last.gpu.source,
      runs,
      aggregate: aggregateRuns(runs),
      lastSnapshot: last,
    };
    const dir = path.join(o.outDir, o.milestone);
    mkdirSync(dir, { recursive: true });
    const stem = `${o.scene}-tier${o.tier}-${o.preset}-${result.backend}-${result.createdAt.replace(/[:.]/g, "-")}`;
    const jsonPath = path.join(dir, `${stem}.json`);
    const mdPath = path.join(dir, `${stem}.md`);
    writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(mdPath, renderSummary(result, compareClient(result)));
    return { jsonPath, mdPath, result };
  } finally {
    await browser.close();
  }
}

export const DEFAULT_CAMERA_PATH = { id: ORBIT_PATH_ID, spec: orbitPath() };
