// Does the production GPU-timing feed deliver on this machine? Reads `__mcDynres().signal` ("gpu" = fresh timestamp
// reports, "interval" = none) every second for 15 s, with and without the no-vsync launch flags of the frame-time drivers.
//   MC_BASE=http://localhost:4183/ node gpu-timing-probe.mjs [--query "scene=typical&preset=low&backend=webgpu"]
/* global window -- browser global, used only inside page.evaluate callbacks */
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const { chromium } = await import(
  pathToFileURL(path.join(REPO, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);
const BASE = process.env.MC_BASE ?? "http://localhost:4183/";
const qi = process.argv.indexOf("--query");
const query = qi > 0 ? process.argv[qi + 1] : "scene=typical&preset=low&backend=webgpu";
const base = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist"];
for (const [name, flags] of [
  ["vsync", base],
  ["novsync", [...base, "--disable-frame-rate-limit", "--disable-gpu-vsync"]],
  ["plain", []],
]) {
  const browser = await chromium.launch({ headless: false, channel: "chrome", args: flags });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const warn = [];
  page.on("console", (m) => (m.type() === "warning" || m.type() === "error") && warn.push(m.text().slice(0, 160)));
  await page.goto(`${BASE}?${query}`);
  await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 240000 });
  const feature = await page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter();
    return a
      ? { timestampQuery: a.features.has("timestamp-query"), vendor: a.info?.vendor, arch: a.info?.architecture }
      : null;
  });
  const seq = [];
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    seq.push(
      await page.evaluate(() => {
        const d = window.__mcDynres();
        return `${d.signal}:${d.p90Ms.toFixed(1)}`;
      }),
    );
  }
  console.log(JSON.stringify({ launch: name, feature, signals: seq, warnings: warn.slice(0, 6) }));
  await browser.close();
}
