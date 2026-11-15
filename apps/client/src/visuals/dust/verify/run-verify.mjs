// Driver of the dust replay browser check (M1-W3-T02). Not part of the app bundle: run it by hand against a running
// client dev server (pnpm --filter @moon-cleanup/client exec vite --port 5188 --strictPort).
//
//   node run-verify.mjs --lane gpu|ci --backends webgpu,webgl2 --presets medium,high --out <dir> [--port 5188]
//        [--frames 1800] [--pace flat|raf] [--prep 0] [--gpu 1]
//
// Lane `gpu` is headed Chrome on the real GPU, lane `ci` headless SwiftShader. Per cell it opens the verify page,
// waits for `window.__dustVerify` and writes `<lane>-<backend>-<preset>-<pace>.json` into <out>. Exit code 1 when a
// cell fails (see the verdict rule below), ran on another backend than asked, or errored. Playwright comes from
// tools/screenshots.

/* global window */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../../..");
const { chromium } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const lane = args.lane ?? "gpu";
const port = args.port ?? "5188";
const frames = args.frames ?? "1800";
const pace = args.pace ?? "flat";
const backends = (args.backends ?? "webgpu,webgl2").split(",");
const presets = (args.presets ?? "medium,high").split(",");
const out = path.resolve(args.out ?? "dust-verify-out");
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
          "--enable-unsafe-webgpu",
          "--enable-features=Vulkan,WebGPU",
          "--ignore-gpu-blocklist",
          "--enable-precise-memory-info",
        ],
      };

const ms = (s) =>
  `${s.p50.toFixed(3)}/${s.p99.toFixed(3)}/${s.max.toFixed(3)} ms, mean ${s.mean.toFixed(3)} (n ${s.n})`;

const browser = await chromium.launch(launch);
let failed = false;
for (const backend of backends) {
  for (const preset of presets) {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    const messages = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") messages.push(`${m.type()}: ${m.text().slice(0, 400)}`);
    });
    page.on("pageerror", (e) => messages.push(`pageerror: ${String(e).slice(0, 400)}`));
    // Cross-origin isolation gives the page a 5 us clock instead of 100 us (timings only).
    await page.route("**/verify/index.html*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "cross-origin-opener-policy": "same-origin",
          "cross-origin-embedder-policy": "require-corp",
        },
      });
    });
    const prep =
      (args.prep === undefined ? "" : `&prep=${args.prep}`) + (args.gpu === undefined ? "" : `&gpu=${args.gpu}`);
    const query = `backend=${backend}&preset=${preset}&frames=${frames}&pace=${pace}${prep}`;
    const url = `http://localhost:${port}/src/visuals/dust/verify/index.html?${query}`;
    let result;
    try {
      await page.goto(url, { waitUntil: "load", timeout: 120_000 });
      await page.waitForFunction(() => window.__dustVerify !== undefined, undefined, { timeout: 600_000 });
      result = await page.evaluate(() => window.__dustVerify);
    } catch (e) {
      result = { error: String(e).slice(0, 600) };
    }
    result.lane = lane;
    result.console = messages.slice(0, 20);
    fs.writeFileSync(
      path.join(out, `${lane}-${backend}-${preset}-${pace}${args.gpu === "1" ? "-gpu" : ""}.json`),
      JSON.stringify(result, null, 1),
    );
    // Tolerance (lead ruling 2026-11-14): R, G and B exact; A (berm lip) within 1 per texel. The page applies it per
    // texel (`withinTolerance`); the number of A texels that differ is always printed.
    const exact = result.error === undefined && result.bytesDiffering === 0 && result.backend === backend;
    const ok = result.error === undefined && result.backend === backend && result.withinTolerance === true;
    if (!ok) failed = true;
    const verdict = exact
      ? "PASS exact"
      : ok
        ? `PASS (RGB exact; A within 1, ${result.aTexelsDiffering} texels differ)`
        : "FAIL";
    console.log(
      `${lane} ${backend} ${preset} ${pace}: ${verdict} ` +
        (result.error !== undefined
          ? result.error
          : `ran on ${result.backend}; ${result.bytesDiffering} of ${result.bytesCompared} bytes differ ` +
            `(RGB ${result.rgbBytesDiffering}, A ${result.aTexelsDiffering}, A over 1: ${result.aTexelsOver1}; ` +
            `max delta ${result.maxDelta}); strokes ${result.strokes}, draws ${result.tileStrokeDraws}, ` +
            `rebuilds ${result.rebuilds}, passes ${result.passes}; frame() p50/p99/max ${ms(result.atlasFrameMs)}; ` +
            `flush strokes ${ms(result.flushStrokeMs)}; flush rebuild ${ms(result.flushRebuildMs)}; ` +
            `frame() + flush, all frames ${ms(result.totalMs)}; frames with work ${ms(result.totalWorkMs)}`),
    );
    if (result.error === undefined) {
      console.log(
        `  tail: flush > 1 ms in ${result.flushOver1ms} frames (${result.flushOver1msWithHeapDrop} with a heap drop, ` +
          `${result.flushOver1msWithSlowControl} with a slow control); control ${ms(result.controlMs)}, ` +
          `> 1 ms in ${result.controlOver1ms} frames; worst: ${JSON.stringify(result.flushOutliers.slice(0, 3))}`,
      );
      if (result.gpuTimestamps) {
        console.log(
          `  GPU ms: stroke frames ${ms(result.gpuStrokeMs)}; rebuild-finish frames ${ms(result.gpuRebuildMs)}`,
        );
      }
    }
    if (result.flushHeapBytesPerPass !== undefined && result.flushHeapBytesPerPass.length > 0) {
      const list = (values) => values.map((v) => v.toFixed(0)).join(" / ");
      console.log(
        `  heap B per pass, 5 windows of 200: flush ${list(result.flushHeapBytesPerPass)}; ` +
          `control ${list(result.controlHeapBytesPerPass)}`,
      );
    }
    if (messages.length > 0) console.log(`  console: ${messages.slice(0, 6).join(" | ")}`);
    await page.close();
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
