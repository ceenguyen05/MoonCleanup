// Driver of the r187 feature-verification matrix (M0-W2-T07). Not part of the app bundle: run it by hand against a
// running dev server.
//
//   node run-matrix.mjs --lane gpu|ci --backend webgpu|webgl2 --rows 1,2,3|all --out <dir> [--port 5181] [--preset medium] [--extra "&k=v"]
//
// Lane `gpu` is headed Chrome on the real GPU, lane `ci` headless SwiftShader. Per row it loads
// `?scene=verify&row=<n>&capture=1`, steps frames, screenshots every variant, lets the page measure its named regions
// and evaluate its verdict, and writes `row-<n>-<backend>.json` plus one PNG per variant into <out>.
// Playwright comes from tools/screenshots (no new dependency).

/* global window */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");
const { chromium } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const lane = args.lane ?? "gpu";
const backend = args.backend ?? "webgpu";
const port = args.port ?? "5181";
const preset = args.preset ?? "medium";
const extra = args.extra ?? "";
const out = path.resolve(args.out ?? "verify-out");
fs.mkdirSync(out, { recursive: true });
const rowIds =
  args.rows === undefined || args.rows === "all"
    ? Array.from({ length: 15 }, (_, i) => i + 1)
    : args.rows.split(",").map(Number);

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
          "--disable-frame-rate-limit",
        ],
      };

const browser = await chromium.launch(launch);
const summary = [];
for (const rowId of rowIds) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  const warnings = [];
  const infos = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !t.startsWith("Failed to load resource")) errors.push(t.slice(0, 600));
    else if (m.type() === "warning") warnings.push(t.slice(0, 300));
    else if (t.startsWith("[render]") || t.startsWith("[verify]")) infos.push(t.slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`.slice(0, 600)));
  const url = `http://localhost:${port}/?scene=verify&row=${rowId}&backend=${backend}&preset=${preset}&capture=1${extra}`;
  const result = { row: rowId, backend, lane, url, measures: [], verdict: "FAIL", notes: [] };
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 90000 });
    for (let i = 0; i < 60; i++) {
      const state = await page.evaluate(() => ({
        ready: window.__mcVerify?.ready ?? false,
        error: window.__mcVerify?.error ?? null,
      }));
      if (state.ready || state.error !== null) break;
      await page.evaluate(() => window.__mcStep(5, 1 / 60));
      await page.waitForTimeout(50);
    }
    const meta = await page.evaluate(() => ({
      error: window.__mcVerify?.error ?? null,
      variants: window.__mcVerify?.variants ?? [],
      settle: window.__mcVerify?.settleFrames ?? 10,
      info: window.__mcInfo(),
    }));
    result.info = meta.info;
    for (const variant of meta.variants) {
      await page.evaluate((v) => window.__mcVerify.setVariant(v), variant);
      await page.evaluate((n) => window.__mcStep(n, 1 / 60), meta.settle);
      await page.waitForTimeout(100);
      await page.evaluate(() => window.__mcStep(2, 1 / 60));
      const file = `row-${rowId}-${backend}-${variant}.png`;
      const buf = await page.screenshot({ path: path.join(out, file) });
      const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
      const measure = await page.evaluate((u) => window.__mcVerify.measure(u), dataUrl);
      measure.file = file;
      measure.drawCalls = (await page.evaluate(() => window.__mcInfo())).drawCalls;
      result.measures.push(measure);
    }
    if (meta.error !== null && result.measures.length === 0) {
      result.measures.push(await page.evaluate(() => window.__mcVerify.measure(null)));
    }
    const verdict = await page.evaluate((m) => window.__mcVerify.evaluate(m), result.measures);
    result.verdict = verdict.verdict;
    result.notes = verdict.notes;
  } catch (e) {
    result.verdict = "FAIL";
    result.notes.push(`FAIL driver: ${String(e.message).slice(0, 300)}`);
  }
  if (errors.length > 0 && result.verdict === "PASS") {
    result.verdict = "FAIL";
    result.notes.push(`FAIL ${errors.length} console error(s) during the run`);
  }
  result.errors = errors.slice(0, 12);
  result.warnings = [...new Set(warnings)].slice(0, 8);
  result.infos = infos.slice(0, 6);
  fs.writeFileSync(path.join(out, `row-${rowId}-${backend}.json`), JSON.stringify(result, null, 1));
  summary.push(`row ${String(rowId).padStart(2)} ${backend.padEnd(7)} ${result.verdict}`);
  console.log(`--- row ${rowId} ${backend}: ${result.verdict}`);
  for (const n of result.notes) console.log("   " + n);
  for (const e of result.errors.slice(0, 4)) console.log("   ERR " + e);
  await page.close();
}
await browser.close();
console.log(summary.join("\n"));
