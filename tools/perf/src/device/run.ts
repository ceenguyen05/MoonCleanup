// `device-report`: starts the client dev server on a free local port, runs a short backend x preset matrix in a real
// (headed) browser, and writes one anonymised JSON + Markdown. No network use beyond loopback. Everything it starts
// (server, browser) is stopped on exit, on error and on Ctrl-C.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { DEFAULT_CAMERA_PATH, PAGE_NAME_SHIM, chromeArgs, oneRun, type CaptureOptions } from "../capture/runner";
import {
  DEVICE_REPORT_SCHEMA,
  collectSecrets,
  findLeaks,
  isSoftwareRenderer,
  newAnonymousId,
  renderDeviceMarkdown,
  scrubDeep,
  type DeviceCell,
  type DeviceReport,
  type WebGpuProbe,
} from "./report";
import { computeVerdict, formatVerdict } from "./verdict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERF_DIR = path.resolve(HERE, "../..");
const REPO_ROOT = path.resolve(PERF_DIR, "../..");
const CLIENT_DIR = path.join(REPO_ROOT, "apps/client");
export const DEFAULT_REPORT_DIR = path.join(PERF_DIR, "results/device-reports");

export type Channel = "chrome" | "msedge" | "chromium";

export interface DeviceReportOptions {
  readonly channel: Channel;
  readonly headless: boolean;
  readonly warmupS: number;
  readonly captureS: number;
  readonly includeLook: boolean;
  readonly outDir: string;
  readonly verdict: boolean;
  readonly seed: string;
  /** Explicit render scale for every cell (`--scale`); default is each preset's spec ceiling. */
  readonly scale?: number;
  /** Optional `scene:backend:preset` filter list (smoke runs), e.g. `bench:webgl2:low`. */
  readonly only?: readonly string[];
}

export const PRESETS = ["low", "medium", "high"] as const;
export const BACKENDS = ["webgpu", "webgl2"] as const;

/**
 * Spec dynres scale ceiling per preset (mirrors packages/shared/src/render/quality.ts `dynres.scaleMax`; a unit test
 * guards against drift). The floor/ceiling row is measured at this scale unless `--scale` pins one explicitly.
 */
export const PRESET_SCALE_CEIL = { low: 0.75, medium: 0.85, high: 1.0 } as const;

/** Scale actually requested for a cell: the explicit `--scale` override, else the preset's spec ceiling. */
export function scaleFor(preset: (typeof PRESETS)[number], override?: number): number {
  return override ?? PRESET_SCALE_CEIL[preset];
}

/** Report label for the scale mode, matching what `scaleFor` did. */
export function scaleModeLabel(override?: number): string {
  return override === undefined ? "preset spec ceiling (low 0.75, medium 0.85, high 1.00)" : `pinned ${override}`;
}

export type PlanCell = { scene: string; backend: "webgpu" | "webgl2"; preset: (typeof PRESETS)[number] };

export function matrixPlan(includeLook: boolean, only?: readonly string[]): PlanCell[] {
  const scenes = includeLook ? ["bench", "s01"] : ["bench"];
  const cells: PlanCell[] = [];
  for (const scene of scenes)
    for (const backend of BACKENDS)
      for (const preset of PRESETS) {
        if (only === undefined || only.includes(`${scene}:${backend}:${preset}`))
          cells.push({ scene, backend, preset });
      }
  return cells;
}

/** Rough wall time (s) of the matrix: per cell warm-up + capture + about 6 s of page load. */
export function estimateSeconds(o: Pick<DeviceReportOptions, "warmupS" | "captureS" | "includeLook" | "only">): number {
  return matrixPlan(o.includeLook, o.only).length * (o.warmupS + o.captureS + 6) + 30;
}

// ---------------------------------------------------------------- process management

const cleanups: (() => Promise<void> | void)[] = [];
let cleaning: Promise<void> | null = null;

export function runCleanups(): Promise<void> {
  cleaning ??= (async () => {
    for (const fn of cleanups.splice(0).reverse()) {
      try {
        await fn();
      } catch {
        /* best effort */
      }
    }
  })();
  return cleaning;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function startClient(): Promise<{ url: string }> {
  const port = await freePort();
  const req = createRequire(path.join(CLIENT_DIR, "package.json"));
  let viteBin: string;
  try {
    viteBin = path.join(path.dirname(req.resolve("vite/package.json")), "bin/vite.js");
  } catch {
    throw new Error("vite not found: run `pnpm install` at the repo root first");
  }
  const child = spawn(process.execPath, [viteBin, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: CLIENT_DIR,
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, DO_NOT_TRACK: "1", BROWSER: "none" },
  });
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-2000);
  });
  cleanups.push(() => killTree(child));
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`client dev server exited (${child.exitCode}): ${stderr.trim()}`);
    try {
      const res = await fetch(url);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("client dev server did not start within 90 s");
    await new Promise((r) => setTimeout(r, 500));
  }
  return { url };
}

async function launch(
  channel: Channel,
  headless: boolean,
  warnings: string[],
): Promise<{ browser: Browser; channel: string }> {
  const args = chromeArgs("high-performance");
  if (channel !== "chromium") {
    try {
      return { browser: await chromium.launch({ channel, headless, args }), channel };
    } catch (e) {
      warnings.push(
        `Could not launch installed ${channel} (${(e as Error).message.split("\n")[0]}); fell back to Playwright's bundled Chromium.`,
      );
    }
  }
  try {
    return { browser: await chromium.launch({ headless, args }), channel: "chromium (bundled)" };
  } catch (e) {
    throw new Error(
      `No browser could be launched. Install Chrome, or run \`pnpm exec playwright install chromium\`. (${(e as Error).message.split("\n")[0]})`,
    );
  }
}

// ---------------------------------------------------------------- in-page probes (plain strings: no tsx __name wrapper)

const PROBE_SCRIPT = `(async () => {
  const out = { available: false, adapter: null, limits: {}, features: [], timestampQuery: false, error: null,
    screen: [screen.width, screen.height], dpr: window.devicePixelRatio };
  try {
    if (!navigator.gpu) { out.error = 'navigator.gpu is undefined'; return out; }
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!a) { out.error = 'requestAdapter returned null'; return out; }
    out.available = true;
    const i = a.info || {};
    out.adapter = { vendor: String(i.vendor || ''), architecture: String(i.architecture || ''), device: String(i.device || ''), description: String(i.description || '') };
    for (const k in a.limits) { const v = a.limits[k]; if (typeof v === 'number') out.limits[k] = v; }
    out.features = Array.from(a.features || []).map(String).sort();
    out.timestampQuery = out.features.includes('timestamp-query');
  } catch (e) { out.error = String(e && e.message || e).slice(0, 160); }
  return out;
})()`;

interface RawProbe extends WebGpuProbe {
  readonly screen: [number, number];
  readonly dpr: number;
}

async function probeBrowser(ctx: BrowserContext, baseUrl: string): Promise<RawProbe> {
  const page = await ctx.newPage();
  const probeUrl = `${baseUrl}__probe`;
  await page.route(probeUrl, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>probe</title>" }),
  );
  await page.goto(probeUrl);
  const raw = (await page.evaluate(PROBE_SCRIPT)) as RawProbe;
  await page.close();
  return raw;
}

interface Detected {
  readonly backend: string;
  readonly tier: string;
  readonly preset: string;
  readonly gpu: string;
}

async function detect(page: Page, baseUrl: string, seed: string): Promise<Detected | null> {
  // No ?preset= / ?backend=: whatever the game's own tier detector picks.
  await page.goto(`${baseUrl}?scene=bench&perf=1&seed=${seed}`, { waitUntil: "load" });
  await page.waitForFunction(() => (window as unknown as { __mcReady?: boolean }).__mcReady === true, undefined, {
    timeout: 180_000,
  });
  return (await page.evaluate(
    "(() => { const i = window.__mcInfo && window.__mcInfo(); return i ? { backend: i.backend, tier: i.tier, preset: i.preset, gpu: i.gpu } : null; })()",
  )) as Detected | null;
}

// ---------------------------------------------------------------- the run

const empty = (
  scene: string,
  backend: "webgpu" | "webgl2",
  preset: (typeof PRESETS)[number],
  status: "failed" | "skipped",
  note: string,
): DeviceCell => ({
  scene,
  backendRequested: backend,
  backendActual: null,
  presetRequested: preset,
  presetActual: null,
  renderScale: null,
  dpr: null,
  status,
  note,
  terrainSource: null,
  frameMs: null,
  fps: null,
  gpuMs: null,
  gpuTimingSource: null,
  cpuTotalMsP95: null,
  draws: null,
  tris: null,
});

export async function runDeviceReport(
  o: DeviceReportOptions,
): Promise<{ jsonPath: string; mdPath: string; report: DeviceReport }> {
  const warnings: string[] = [];
  const plan = matrixPlan(o.includeLook, o.only);
  console.log(
    `[device-report] ${plan.length} cells, about ${Math.round((estimateSeconds(o) / 60) * 10) / 10} min. Nothing is uploaded; output stays on this machine.`,
  );
  const onSigint = (): void => {
    console.log("\n[device-report] interrupted, cleaning up");
    void runCleanups().then(() => process.exit(130));
  };
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigint);
  try {
    console.log("[device-report] starting client dev server on a free local port");
    const { url } = await startClient();
    const { browser, channel } = await launch(o.channel, o.headless, warnings);
    cleanups.push(() => browser.close());
    const version = browser.version();

    const newCtx = async (): Promise<BrowserContext> => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(PAGE_NAME_SHIM);
      return ctx;
    };

    const probeCtx = await newCtx();
    const probe = await probeBrowser(probeCtx, url);
    await probeCtx.close();
    console.log(
      `[device-report] WebGPU ${probe.available ? `available: ${probe.adapter?.description || probe.adapter?.device || probe.adapter?.vendor || "adapter"}` : `unavailable (${probe.error ?? "unknown"})`}; timestamp-query ${probe.timestampQuery ? "yes" : "no"}`,
    );

    console.log("[device-report] detecting the game's own tier/preset (also warms the dev server)");
    const detCtx = await newCtx();
    const detPage = await detCtx.newPage();
    let detected: Detected | null = null;
    try {
      detected = await detect(detPage, url, o.seed);
    } catch (e) {
      warnings.push(`Tier detection run failed: ${(e as Error).message.split("\n")[0]}`);
    }
    await detCtx.close();

    const rendererString = detected?.gpu ?? probe.adapter?.description ?? "";
    const software = isSoftwareRenderer(rendererString) || isSoftwareRenderer(probe.adapter?.description ?? "");
    if (software) {
      warnings.push(
        "The GPU renderer looks like a SOFTWARE rasteriser (SwiftShader/llvmpipe). Numbers below do not describe your GPU and every verdict row is INVALID. Run headed with an installed Chrome/Edge (--channel chrome) on a machine with a GPU driver.",
      );
      console.log(`[device-report] WARNING: software renderer detected (${rendererString}). Results will be INVALID.`);
    }
    if (o.headless) warnings.push("Ran headless: frame pacing may differ from a visible window.");

    const cells: DeviceCell[] = [];
    let n = 0;
    for (const p of plan) {
      n++;
      const label = `${p.scene} ${p.backend} ${p.preset}`;
      if (p.backend === "webgpu" && !probe.available) {
        cells.push(empty(p.scene, p.backend, p.preset, "skipped", "WebGPU unavailable"));
        console.log(`[device-report] [${n}/${plan.length}] ${label}: skipped (WebGPU unavailable)`);
        continue;
      }
      const copts: CaptureOptions = {
        url,
        milestone: "device",
        scene: p.scene,
        seed: o.seed,
        tier: "B",
        preset: p.preset,
        backend: p.backend,
        adapter: "high-performance",
        runs: 1,
        warmupS: o.warmupS,
        captureS: o.captureS,
        outDir: "",
        cameraPath: DEFAULT_CAMERA_PATH.spec,
        cameraPathId: DEFAULT_CAMERA_PATH.id,
        realDevice: false,
        headless: o.headless,
        extraQuery: `scale=${scaleFor(p.preset, o.scale)}`,
        readyTimeoutMs: 60_000,
      };
      const ctx = await newCtx();
      try {
        const page = await ctx.newPage();
        const run = await oneRun(page, copts);
        const m = run.metrics;
        const gpuMeasured = run.last.gpu.measured && m.gpuRenderMsP50 !== null && m.gpuRenderMsP95 !== null;
        cells.push({
          scene: p.scene,
          backendRequested: p.backend,
          backendActual: run.last.env.backend,
          presetRequested: p.preset,
          presetActual: run.last.env.preset,
          renderScale: run.last.env.renderScale,
          dpr: run.last.env.dpr,
          status: "ok",
          note: null,
          terrainSource: run.terrainSource,
          frameMs: { p50: m.frameMsP50, p95: m.frameMsP95, p99: m.frameMsP99 },
          fps: m.fps,
          gpuMs: gpuMeasured ? { p50: m.gpuRenderMsP50 as number, p95: m.gpuRenderMsP95 as number } : null,
          gpuTimingSource: run.last.gpu.source,
          cpuTotalMsP95: m.cpuTotalMsP95,
          draws: m.drawCalls,
          tris: m.triangles,
        });
        console.log(
          `[device-report] [${n}/${plan.length}] ${label}: ${m.fps.toFixed(1)} fps, frame p95 ${m.frameMsP95.toFixed(1)} ms (${run.last.env.backend}, scale ${run.last.env.renderScale.toFixed(2)})`,
        );
        if (p.scene === "bench" && run.terrainSource !== null && run.terrainSource !== "real") {
          warnings.push(
            `bench ${p.backend} ${p.preset} used terrain source "${run.terrainSource}", not the real terrain.`,
          );
        }
      } catch (e) {
        const msg = (e as Error).message.split("\n")[0] ?? "error";
        cells.push(empty(p.scene, p.backend, p.preset, "failed", msg.slice(0, 120)));
        console.log(`[device-report] [${n}/${plan.length}] ${label}: FAILED (${msg.slice(0, 100)})`);
      } finally {
        await ctx.close().catch(() => undefined);
      }
    }

    const secrets = collectSecrets({
      username: safe(() => os.userInfo().username),
      hostname: safe(() => os.hostname()),
      homedir: safe(() => os.homedir()),
      cwd: process.cwd(),
      tmpdir: safe(() => os.tmpdir()),
    });
    const cpus = os.cpus();
    const draft: DeviceReport = {
      kind: "device-report",
      schema: DEVICE_REPORT_SCHEMA,
      id: newAnonymousId(),
      createdAt: new Date().toISOString(),
      system: {
        os: `${os.type()} ${os.release()} (${os.arch()})`,
        cpu: cpus[0]?.model.trim() ?? "unknown",
        cores: cpus.length,
        ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      },
      browser: { name: "Chromium-based", version, channel, headless: o.headless },
      display: { screen: probe.screen, viewport: [1920, 1080], dpr: Math.round(probe.dpr * 100) / 100 },
      gpu: {
        rendererString,
        softwareRenderer: software,
        webgpu: {
          available: probe.available,
          adapter: probe.adapter,
          limits: probe.limits,
          features: probe.features,
          timestampQuery: probe.timestampQuery,
          error: probe.error,
        },
      },
      detector: detected === null ? null : { backend: detected.backend, tier: detected.tier, preset: detected.preset },
      capture: { warmupS: o.warmupS, captureS: o.captureS, scaleMode: scaleModeLabel(o.scale), seed: o.seed },
      cells,
      warnings,
    };
    const report = scrubDeep(draft, secrets);
    let md = renderDeviceMarkdown(report);
    if (o.verdict) md += `\n## Provisional tier comparison\n\n${formatVerdict(computeVerdict(report))}\n`;
    const json = `${JSON.stringify(report, null, 2)}\n`;
    const leaks = [...findLeaks(json, secrets), ...findLeaks(md, secrets)];
    if (leaks.length > 0) throw new Error(`refusing to write: output still contains ${[...new Set(leaks)].join(", ")}`);
    mkdirSync(o.outDir, { recursive: true });
    const jsonPath = path.join(o.outDir, `${report.id}.json`);
    const mdPath = path.join(o.outDir, `${report.id}.md`);
    writeFileSync(jsonPath, json);
    writeFileSync(mdPath, md);
    return { jsonPath, mdPath, report };
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
    await runCleanups();
  }
}

function safe(fn: () => string): string | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
