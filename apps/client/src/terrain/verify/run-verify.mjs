// Driver of the terrain browser checks (M1-W2-T01). Not part of the app bundle: run it by hand against a running
// client dev server (pnpm --filter @moon-cleanup/client exec vite --port 5193 --strictPort).
//
//   node run-verify.mjs --out <dir> [--port 5193] [--lane gpu|ci] [--backends webgpu,webgl2] [--twin 1] [--shots 1]
//        [--preset medium] [--views ground,pad,fence,rim,high,orbit] [--paths p2,p4]
//
// --twin 1   height-twin readback (10,000 seeded points, +-2 cm) per backend -> twin-<backend>.json
// --shots 1  `?scene=moon` captures per view (and path frames) with `__mcTerrain.info()` -> <name>.png + shots.json
// Lane `gpu` is headed Chrome on the real GPU, lane `ci` headless SwiftShader. Playwright comes from tools/screenshots.

/* global window, document, requestAnimationFrame */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OFFSCREEN_CHROME_ARGS } from "../../offscreen-chrome-args.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");
const { chromium } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const lane = args.lane ?? "gpu";
const port = args.port ?? "5193";
const backends = (args.backends ?? "webgpu,webgl2").split(",");
const preset = args.preset ?? "medium";
const views = (args.views ?? "ground,pad,fence,rim,high,orbit").split(",").filter((v) => v !== "");
const paths = (args.paths ?? "").split(",").filter((v) => v !== "");
const out = path.resolve(args.out ?? "terrain-verify-out");
fs.mkdirSync(out, { recursive: true });

const launch =
  lane === "ci"
    ? {
        headless: true,
        args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
      }
    : {
        headless: false,
        channel: "chrome",
        args: [
          ...OFFSCREEN_CHROME_ARGS,
          "--enable-unsafe-webgpu",
          "--enable-features=Vulkan,WebGPU",
          "--ignore-gpu-blocklist",
          // --uncapped 1: frame times below the display interval become measurable (not how the game runs).
          ...(args.uncapped === "1" ? ["--disable-frame-rate-limit", "--disable-gpu-vsync"] : []),
        ],
      };

const browser = await chromium.launch(launch);
let failed = false;

async function open(url, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const messages = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") messages.push(`${m.type()}: ${m.text().slice(0, 600)}`);
  });
  page.on("pageerror", (e) => messages.push(`pageerror: ${String(e).slice(0, 600)}`));
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  return { page, messages };
}

if (args.twin === "1") {
  for (const backend of backends) {
    const part = args.part ?? "full";
    const url = `http://localhost:${port}/src/terrain/verify/index.html?backend=${backend}&part=${part}${args.dump === "1" ? "&dump=1" : ""}`;
    const { page, messages } = await open(url, 400, 300);
    let result;
    try {
      await page.waitForFunction(() => window.__terrainVerify !== undefined, undefined, { timeout: 300_000 });
      result = await page.evaluate(() => window.__terrainVerify);
    } catch (e) {
      result = { error: String(e).slice(0, 600), pass: false };
    }
    if (typeof result.shader === "string") {
      fs.writeFileSync(path.join(out, `twin-${backend}-${part}.shader.txt`), result.shader);
      delete result.shader;
    }
    result.lane = lane;
    result.console = messages.slice(0, 12);
    fs.writeFileSync(
      path.join(out, `twin-${backend}${part === "full" ? "" : `-${part}`}.json`),
      JSON.stringify(result, null, 2),
    );
    const ok = result.pass === true && result.backend === backend;
    if (!ok) failed = true;
    console.log(
      `twin ${backend} ${part}: ${ok ? "PASS" : "FAIL"} ran=${result.backend} max=${result.maxErrorM} p99=${result.p99ErrorM} over2cm=${result.over2cm} ${result.error ?? ""} ${messages[0] ?? ""}`,
    );
    await page.close();
  }
}

if (args.shots === "1") {
  const shots = [];
  const cells = [
    ...views.map((view) => ({ name: `${view}${args.tag ?? ""}`, query: `view=${view}` })),
    ...paths.flatMap((p) =>
      (p === "p2" ? [0, 5, 10, 15, 20] : [0, 7.5, 15, 22.5, 30]).map((ft) => ({
        name: `${p}-t${String(ft).replace(".", "_")}`,
        query: `fly=${p}&ft=${ft}`,
      })),
    ),
  ];
  for (const backend of backends.slice(0, 1)) {
    for (const cell of cells) {
      const extra = args.query === undefined ? "" : `&${args.query}`;
      const url = `http://localhost:${port}/?scene=moon&solo=0&preset=${preset}&backend=${backend}&${cell.query}${extra}`;
      const { page, messages } = await open(url, 1280, 720);
      let info;
      try {
        await page.waitForFunction(() => window.__mcTerrain?.info().ready === true, undefined, { timeout: 120_000 });
        // Let the selection, shadows and exposure settle, then sample frame times.
        await page.waitForTimeout(2500);
        await page.evaluate(() => window.__mcStatsReset?.());
        await page.waitForTimeout(Number(args.settle ?? 2000));
        info = await page.evaluate(async () => {
          const times = [];
          let last = performance.now();
          await new Promise((done) => {
            const tick = () => {
              const now = performance.now();
              times.push(now - last);
              last = now;
              if (times.length >= 120) done();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          times.sort((a, b) => a - b);
          return {
            ...window.__mcTerrain.info(),
            frameMs: { p50: times[60], p95: times[114], max: times[119] },
            dynres: window.__mcDynres?.() ?? null,
            mc: window.__mcInfo?.() ?? null,
            stats: window.__mcStats?.() ?? null,
            canvas: document.querySelector("canvas")?.width,
          };
        });
        await page.screenshot({ path: path.join(out, `${cell.name}.png`) });
      } catch (e) {
        info = { error: String(e).slice(0, 600) };
        failed = true;
        await page.screenshot({ path: path.join(out, `${cell.name}-error.png`) }).catch(() => undefined);
      }
      shots.push({ name: cell.name, url, info, console: messages.slice(0, 12) });
      console.log(
        `shot ${cell.name}: nodes=${info.nodes} shadow=${info.shadowPerCascade} scale=${info.dynres?.scale ?? info.mc?.renderScale} tris=${info.triangles} select p95=${info.selectMs?.p95?.toFixed?.(3)} frame p50=${info.frameMs?.p50?.toFixed?.(1)} ${info.error ?? ""} ${messages[0] ?? ""}`,
      );
      await page.close();
    }
  }
  fs.writeFileSync(path.join(out, "shots.json"), JSON.stringify(shots, null, 2));
}

// --motion p2,p4: steps the camera path at 60 frames per second of path time over windows of the path and compares
// consecutive frames. A LOD pop is a frame whose change is far above its neighbours. Writes motion-<path>.json and the
// frames of the worst step.
if (args.motion !== undefined) {
  const { PNG } = await import(
    pathToFileURL(path.join(repo, "tools/screenshots/node_modules/pngjs/lib/png.js")).href
  ).then((m) => m.default ?? m);
  for (const name of args.motion.split(",")) {
    const duration = name === "p2" ? 20 : 30;
    const windows =
      args.windows !== undefined
        ? args.windows.split(",").map(Number)
        : name === "p2"
          ? [1, 6, 12, 17]
          : [2, 10, 18, 26];
    const frames = Number(args.frames ?? 45);
    const extra = args.query === undefined ? "" : `&${args.query}`;
    const url = `http://localhost:${port}/?scene=moon&solo=0&preset=${preset}&backend=${backends[0]}&dynres=0&fly=${name}&ft=0${extra}`;
    const { page, messages } = await open(url, 960, 540);
    await page.waitForFunction(() => window.__mcTerrain?.info().ready === true, undefined, { timeout: 120_000 });
    await page.waitForTimeout(2000);
    const steps = [];
    let worst = null;
    for (const start of windows) {
      let previous = null;
      for (let f = 0; f < frames; f++) {
        const tt = Math.min(duration, start + f / 60);
        await page.evaluate((v) => window.__mcTerrain.setFlyTime(v), tt);
        // Two rendered frames per step: the temporal filter settles on the new camera.
        await page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
        );
        const png = PNG.sync.read(await page.screenshot());
        if (previous !== null) {
          let changed = 0;
          let sum = 0;
          const n = png.width * png.height;
          for (let i = 0; i < n; i++) {
            const a = png.data[i * 4] * 0.299 + png.data[i * 4 + 1] * 0.587 + png.data[i * 4 + 2] * 0.114;
            const b =
              previous.data[i * 4] * 0.299 + previous.data[i * 4 + 1] * 0.587 + previous.data[i * 4 + 2] * 0.114;
            const d = Math.abs(a - b);
            sum += d;
            if (d > 24) changed++;
          }
          const step = { t: tt, meanAbsLuma: sum / n, changedFraction: changed / n };
          steps.push(step);
          if (worst === null || step.changedFraction > worst.step.changedFraction)
            worst = { step, a: previous, b: png };
        }
        previous = png;
      }
    }
    const sorted = steps.map((s) => s.changedFraction).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const summary = {
      path: name,
      preset,
      backend: backends[0],
      steps: steps.length,
      changedFraction: { median, p95, max: sorted[sorted.length - 1] },
      worstAtS: worst?.step.t,
      worstOverMedian: worst === null || median === 0 ? null : worst.step.changedFraction / median,
      console: messages.filter((m) => m.startsWith("error") || m.startsWith("pageerror")).slice(0, 6),
    };
    fs.writeFileSync(
      path.join(out, `motion-${name}${args.tag ?? ""}.json`),
      JSON.stringify({ summary, steps }, null, 2),
    );
    if (worst !== null) {
      fs.writeFileSync(path.join(out, `motion-${name}-worst-a.png`), PNG.sync.write(worst.a));
      fs.writeFileSync(path.join(out, `motion-${name}-worst-b.png`), PNG.sync.write(worst.b));
    }
    console.log(`motion ${name}: ${JSON.stringify(summary)}`);
    await page.close();
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
