import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { CAMERA_PATHS, summarizePath } from "./camera-paths";
import {
  DEFAULT_SEED,
  FIXED_DT,
  TURNTABLE_TODS,
  TURNTABLE_VIEWS,
  laneLaunch,
  portsFor,
  parseArgs,
  sceneUrl,
  type McHooks,
  type McInfo,
  type SceneRequest,
} from "./harness";
import { generateIndexMd, measureImage, probeRois, type RawProbes, type RoiSpec } from "./measure";
import { decodePng, type Img } from "./measure/image";
import { captureFileName, pngSize, sidecarName, type Backend, type Preset, type Tier, type Tod } from "./naming";
import { resolveScene, todSetup, verifyTodApplied } from "./scenes/registry";
import { buildClient, detectServeMode, startPreview, type ServeInfo } from "./serve";
import { sidecarExtras, type LookInfoLike } from "./sidecar";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging adds the McHooks members
  interface Window extends McHooks {}
}

function commitHash(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function treeDirty(): boolean | null {
  try {
    return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
  } catch {
    return null;
  }
}

async function waitReady(page: Page, timeoutMs: number): Promise<void> {
  // Explicit readiness signal, never a fixed sleep.
  await page.waitForFunction(() => window.__mcReady === true, undefined, { timeout: timeoutMs });
}

async function readInfo(page: Page): Promise<McInfo> {
  return page.evaluate(() => {
    const i = window.__mcInfo;
    return (typeof i === "function" ? i() : i) ?? {};
  });
}

async function readLook(page: Page): Promise<LookInfoLike | null> {
  return page.evaluate(() => window.__mcLook?.info?.() ?? null);
}

async function readProbes(page: Page, dpr: number): Promise<RawProbes> {
  return page.evaluate((k) => {
    const lookdev = window.__mcLookdev?.probes?.() ?? null;
    return {
      dpr: k,
      lookdev: lookdev === null ? null : { chips: lookdev.chips, lines: lookdev.lines },
      look: window.__mcLook?.probes?.() ?? null,
    };
  }, dpr);
}

export interface CaptureContext {
  readonly lane: string;
  readonly serve: ServeInfo | null;
  readonly readyTimeoutMs?: number;
}

export interface CaptureResult {
  readonly pngPath: string;
  readonly jsonPath: string;
  readonly img: Img;
}

/** Screenshot the page as it is now and write PNG + sidecar (knobs, camera, sun, EV100, Earth phase, ROI measures). */
export async function captureCurrent(
  page: Page,
  baseUrl: string,
  r: SceneRequest,
  outDir: string,
  cc: CaptureContext,
): Promise<CaptureResult> {
  const png = await page.screenshot({ type: "png" }); // lossless, native pixels = CSS size x DPR
  const info = await readInfo(page);
  const look = await readLook(page);
  const probes = await readProbes(page, r.dpr);
  const size = pngSize(r.cssWidth, r.cssHeight, r.dpr);
  const backend: Backend = info.backend ?? r.backend;
  const name = captureFileName({ ...r, backend, width: size.width, height: size.height });
  mkdirSync(outDir, { recursive: true });
  const pngPath = join(outDir, name);
  const jsonPath = join(outDir, sidecarName(name));
  writeFileSync(pngPath, png);
  const img = decodePng(png);
  if (img.width !== size.width || img.height !== size.height) {
    throw new Error(`PNG is ${img.width}x${img.height}, expected ${size.width}x${size.height} (CSS x DPR)`);
  }

  // Time of day: the client ignores `?tod=`, so the registry maps it to scene knobs and the sun is verified here.
  const resolved = resolveScene(r.scene);
  let todApplied: string;
  if (resolved === null) {
    todApplied = "unverified (scene not in the harness registry, --allow-unverified-tod)";
  } else {
    const { setup } = todSetup(r.scene, r.tod);
    verifyTodApplied(r.scene, r.tod, setup, look?.state?.sunElevationDeg ?? null);
    todApplied = resolved.entry.todAgnostic
      ? "not applicable (DOM page, no world sun)"
      : `verified: sun elevation ${look?.state?.sunElevationDeg?.toFixed(2)} deg, expected ${setup.sunElevationDeg}`;
  }

  const roiSpecs: RoiSpec[] = probeRois(probes);
  const extras = sidecarExtras(info, look, new URL(sceneUrl(baseUrl, r)).searchParams.get("view"));
  const sidecar = {
    scene: r.scene,
    tod: r.tod,
    todApplied,
    tier: r.tier,
    preset: r.preset,
    backend,
    requestedBackend: r.backend,
    dpr: r.dpr,
    width: size.width,
    height: size.height,
    hud: r.hud,
    seed: r.seed,
    lane: cc.lane,
    commit: commitHash(),
    treeDirty: treeDirty(),
    serve: cc.serve,
    url: sceneUrl(baseUrl, r),
    browser: page.context().browser()?.version() ?? "unknown",
    gpu: info.gpu ?? null,
    frameTimeSample: { avgMs: info.frameTimeAvgMs ?? null, p95Ms: info.frameTimeP95Ms ?? null },
    drawCalls: info.drawCalls ?? null,
    triangles: info.triangles ?? null,
    texPoolMB: info.texPoolMB ?? null, // placeholder until the client reports it
    placeholderAssets: info.placeholderAssets ?? [],
    ...extras,
    stepFrames: r.stepFrames ?? null,
    view: r.view ?? null,
    lookdevFacts: await page.evaluate(() => window.__mcLookdev?.probes?.().facts ?? null),
    roiSpecs,
    measure: measureImage(png, img, undefined, roiSpecs),
  };
  writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2) + "\n");
  return { pngPath, jsonPath, img };
}

async function openScene(page: Page, baseUrl: string, r: SceneRequest, timeoutMs: number): Promise<void> {
  await page.setViewportSize({ width: r.cssWidth, height: r.cssHeight });
  await page.goto(sceneUrl(baseUrl, r));
  await waitReady(page, timeoutMs);
}

export async function captureOne(
  page: Page,
  baseUrl: string,
  r: SceneRequest,
  outDir: string,
  lane: string,
  cc: Partial<CaptureContext> = {},
): Promise<CaptureResult> {
  await openScene(page, baseUrl, r, cc.readyTimeoutMs ?? 120_000);
  if (r.stepFrames)
    await page.evaluate(([n, dt]) => window.__mcStep?.(n as number, dt as number), [r.stepFrames, FIXED_DT]);
  return captureCurrent(page, baseUrl, r, outDir, { lane, serve: cc.serve ?? null, ...cc });
}

/** Lossless PNG sequence at fixed dt (1/60 s): advance one frame, read it back, repeat. */
export async function captureSequence(
  page: Page,
  baseUrl: string,
  r: SceneRequest,
  outDir: string,
  frames: number,
  readyTimeoutMs = 120_000,
): Promise<string[]> {
  await openScene(page, baseUrl, { ...r, stepFrames: r.stepFrames ?? 0 }, readyTimeoutMs);
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < frames; i++) {
    await page.evaluate((dt) => window.__mcStep?.(1, dt), FIXED_DT);
    const f = join(outDir, `${r.scene}-${r.tod}-${String(i).padStart(5, "0")}.png`);
    writeFileSync(f, await page.screenshot({ type: "png" }));
    files.push(f);
  }
  return files;
}

/**
 * Stepped camera path (visual-target 6.3): `frames` positions along the path, each `settle` fixed-dt frames after the view
 * change. Writes one PNG + sidecar per position and `<path>-...pathreport.json` with the frame-to-frame summary.
 */
export async function capturePath(
  page: Page,
  baseUrl: string,
  pathId: string,
  r: SceneRequest,
  outDir: string,
  frames: number,
  cc: CaptureContext,
  settle = 2,
): Promise<string> {
  const path = CAMERA_PATHS[pathId];
  if (path === undefined)
    throw new Error(`unknown camera path "${pathId}" (known: ${Object.keys(CAMERA_PATHS).join(", ")})`);
  const req: SceneRequest = { ...r, scene: path.scene, tod: path.tod, stepFrames: 0 };
  await openScene(page, baseUrl, req, cc.readyTimeoutMs ?? 120_000);
  const imgs: Img[] = [];
  const files: string[] = [];
  for (let i = 0; i < frames; i++) {
    const t = frames === 1 ? 0 : i / (frames - 1);
    const view = path.view(t);
    await page.evaluate((v) => window.__mcLook?.setView?.(v), view);
    await page.evaluate(([n, dt]) => window.__mcStep?.(n as number, dt as number), [settle, FIXED_DT]);
    const res = await captureCurrent(
      page,
      baseUrl,
      { ...req, variant: `${path.id}-f${String(i).padStart(2, "0")}` },
      outDir,
      cc,
    );
    imgs.push(res.img);
    files.push(res.pngPath);
  }
  const summary = summarizePath(imgs);
  const reportPath = join(outDir, `${path.id}-${path.tod}-${req.tier}-${req.preset}.pathreport.json`);
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        path: path.id,
        scene: path.scene,
        tod: path.tod,
        checks: path.checks,
        durationS: path.durationS,
        stepped: { frames, settleFramesPerPosition: settle, dt: FIXED_DT },
        note: "stepped keyframes, not a 30 s real-time run; the ground-spike ratio is a LOD-pop proxy, the verdict needs the frames viewed",
        serve: cc.serve,
        files,
        summary,
      },
      null,
      2,
    ) + "\n",
  );
  return reportPath;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), process.env);
  const f = args.flags;
  const launch = laneLaunch(args.lane);

  // Serving: attach to --url (dev server or any static host), or --preview: build (--build) and run `vite preview` ourselves.
  let preview: Awaited<ReturnType<typeof startPreview>> | null = null;
  let baseUrl = args.baseUrl;
  let how: ServeInfo["how"] = "external";
  if (f["preview"]) {
    if (f["build"]) await buildClient();
    preview = await startPreview(portsFor(Number(f["port-offset"] ?? process.env["MC_PORT_OFFSET"] ?? 0)).client);
    baseUrl = preview.url;
    how = "preview-started";
  }
  const serve: ServeInfo = { mode: await detectServeMode(baseUrl), url: baseUrl, how };
  if (serve.mode === "unreachable") {
    await preview?.stop();
    throw new Error(`client not reachable at ${baseUrl}`);
  }
  console.log(`serving: ${serve.mode} (${serve.how}) ${serve.url}`);

  const browser = await chromium.launch({
    headless: launch.headless,
    args: launch.args,
    ...(launch.channel ? { channel: launch.channel } : {}),
  });
  const dpr = Number(f["dpr"] ?? 1);
  const allowUnverifiedTod = f["allow-unverified-tod"] === "true";
  const base: Omit<SceneRequest, "scene" | "tod"> = {
    tier: (f["tier"] ?? "A") as Tier,
    preset: (f["preset"] ?? "high") as Preset,
    backend: (launch.forcedBackend ?? f["backend"] ?? "webgpu") as Backend,
    cssWidth: Number(f["width"] ?? 1920) / 1,
    cssHeight: Number(f["height"] ?? 1080) / 1,
    dpr,
    hud: (f["hud"] ?? "nohud") as SceneRequest["hud"],
    seed: f["seed"] ?? DEFAULT_SEED,
    ...(f["scale"] ? { scale: f["scale"] as "floor" | "ceil" } : {}),
    ...(args.mode === "stepped" ? { stepFrames: Number(f["step"]) } : {}),
    ...(allowUnverifiedTod ? { allowUnverifiedTod } : {}),
  };
  const context = await browser.newContext({ deviceScaleFactor: dpr });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  const tods = (f["tod"] ?? "noon").split(",") as Tod[];
  const cc: CaptureContext = { lane: args.lane, serve };
  try {
    if (f["path"]) {
      const report = await capturePath(
        page,
        baseUrl,
        f["path"],
        { ...base, scene: "S01", tod: "dawn" },
        args.out,
        Number(f["frames"] ?? 12),
        cc,
      );
      console.log(`path report: ${report}`);
    } else {
      for (const scene of args.scenes) {
        if (args.mode === "turntable") {
          for (const tod of TURNTABLE_TODS) {
            for (let view = 0; view < TURNTABLE_VIEWS; view++) {
              await captureOne(
                page,
                baseUrl,
                { ...base, scene, tod, view, variant: `view${view}` },
                args.out,
                args.lane,
                cc,
              );
            }
          }
        } else {
          for (const tod of tods) await captureOne(page, baseUrl, { ...base, scene, tod }, args.out, args.lane, cc);
        }
      }
    }
  } finally {
    await browser.close();
    await preview?.stop();
  }
  generateIndexMd(args.out);
  if (consoleErrors.length) console.warn(`console errors during capture:\n${consoleErrors.join("\n")}`);
  console.log(`captures written to ${args.out} (index.md generated)`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/capture.ts")) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
