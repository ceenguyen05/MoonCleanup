import { pathToFileURL } from "node:url";
import path from "node:path";
const REPO = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const { chromium } = await import(pathToFileURL(path.join(REPO, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href);
const OUT = process.argv[2];
const BASE = "http://localhost:5196/";
const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist"],
});
const cases = [
  ["low", "scene=bench&preset=low"],
  ["medium", "scene=bench&preset=medium"],
  ["high", "scene=bench&preset=high"],
  ["low-webgl2", "scene=bench&preset=low&backend=webgl2"],
];
for (const [name, q] of cases) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 300)));
  await page.goto(`${BASE}?${q}&capture=1`);
  await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 240000 });
  await page.evaluate(() => window.__mcStep(8, 1 / 60));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__mcStep(2, 1 / 60));
  const info = await page.evaluate(() => ({ info: window.__mcInfo?.(), bench: window.__mcBench?.stats?.() }));
  await page.screenshot({ path: `${OUT}/smoke-${name}.png` });
  console.log(
    name,
    JSON.stringify({
      backend: info.info?.backend,
      preset: info.info?.preset,
      passes: info.bench?.postPasses,
      draws: info.info?.drawCalls,
      errors,
    }),
  );
  await page.close();
}
await browser.close();
