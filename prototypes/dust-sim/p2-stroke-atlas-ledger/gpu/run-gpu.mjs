// T06 GPU lane runner: serves gpu/ and the recordings on 127.0.0.1 (random port, closed at the end), opens Chrome
// through Playwright with WebGPU, replays every recording and writes one JSON per run.
//   node prototypes/dust-sim/p2-stroke-atlas-ledger/gpu/run-gpu.mjs <recordingsDir> <outDir> [--headless] [--only name]
// Nothing is left running: the browser and the server are closed in a finally block.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const recDir = path.resolve(process.argv[2]);
const outDir = path.resolve(process.argv[3]);
const headless = process.argv.includes("--headless");
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt > 0 ? process.argv[onlyAt + 1] : "";
mkdirSync(outDir, { recursive: true });

const { chromium } = await import(
  pathToFileURL(path.join(root, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);

const TYPES = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".bin": "application/octet-stream",
};
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const rel = decodeURIComponent(url.pathname);
  const file = rel.startsWith("/rec/") ? path.join(recDir, rel.slice(5)) : path.join(here, rel.slice(1));
  const base = rel.startsWith("/rec/") ? recDir : here;
  if (!path.resolve(file).startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    // Cross-origin isolation: performance.now() resolves 5 us instead of 100 us.
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
    "cache-control": "no-store",
  });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.idle + c.times.user + c.times.sys + c.times.irq + c.times.nice;
  }
  return { idle, total };
}

const flags = [
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan,WebGPU",
  "--ignore-gpu-blocklist",
  // Timestamp queries are rounded to 100 us by default; this is a measurement run.
  "--disable-dawn-features=timestamp_quantization",
  "--enable-webgpu-developer-features",
];
let browser = null;
try {
  browser = await chromium.launch({ headless, channel: "chrome", args: flags });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 300)));
  await page.goto(`http://127.0.0.1:${port}/replay.html`);
  await page.waitForFunction(() => globalThis.dustGpu !== undefined, null, { timeout: 30000 });
  const info = await page.evaluate(() => globalThis.dustGpu.adapterInfo());
  info.browserVersion = browser.version();
  info.headless = headless;
  info.launchFlags = flags;
  writeFileSync(path.join(outDir, "adapter.json"), JSON.stringify(info, null, 1));
  console.log(JSON.stringify({ adapter: info }));
  if (!info.webgpu) throw new Error("WebGPU is not available in this browser: GPU lane NOT RUN");

  const recs = readdirSync(recDir).filter(
    (d) => existsSync(path.join(recDir, d, "meta.json")) && (only === "" || d === only),
  );
  for (const rec of recs) {
    const runs = [
      { path: "fragment", pace: "flat" },
      { path: "compute", pace: "flat" },
      { path: "fragment", pace: "raf", maxFrames: 1800 },
      { path: "compute", pace: "raf", maxFrames: 1800 },
    ];
    for (const opt of runs) {
      const name = `${rec}.${opt.path}.${opt.pace}`;
      const before = cpuTimes();
      let result;
      try {
        result = await page.evaluate(([b, o]) => globalThis.dustGpu.runReplay(b, o), [`/rec/${rec}`, opt]);
      } catch (e) {
        result = { label: rec, path: opt.path, pace: opt.pace, failed: String(e).slice(0, 600) };
      }
      const after = cpuTimes();
      const dt = after.total - before.total;
      result.machineLoadPct = dt > 0 ? +(100 * (1 - (after.idle - before.idle) / dt)).toFixed(1) : null;
      result.recording = rec;
      writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(result, null, 1));
      console.log(
        JSON.stringify({
          run: name,
          failed: result.failed,
          load: result.machineLoadPct,
          passes: result.passes,
          gpuPassMs: result.gpuPassMs,
          jsEncodeMs: result.jsEncodeMs,
          compare: result.compare,
          errors: result.errors,
        }),
      );
    }
  }
  if (consoleErrors.length)
    writeFileSync(path.join(outDir, "console-errors.json"), JSON.stringify(consoleErrors, null, 1));
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
