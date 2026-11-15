// Browser check of ?scene=dust fed by the Solo host (M1-W3-T02b). Usage: node dust-feed-check.mjs <repo> <outDir> [port]
/* global window */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [repo, outDir, port = "5191"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const { chromium } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);
const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist"],
});
const result = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  const view = process.env.VIEW ?? "top";
  await page.bringToFront();
  await page.goto(`http://localhost:${port}/?scene=dust&perf=1&preset=medium&view=${view}`);
  await page.waitForFunction(() => window.__mcDustFeed !== undefined, null, { timeout: 60_000 });
  const t0 = Date.now();
  await sleep(Number(process.env.PLAY_MS ?? 40_000));
  const s1 = await page.evaluate(async () => {
    const f = window.__mcDustFeed;
    await f.checkpoint();
    const h = await f.hash();
    return { stats: f.stats(), hash: h, viewHash: f.viewHash(), info: window.__mcLook?.info?.().dustFeed ?? null };
  });
  result.beforeCrash = { ms: Date.now() - t0, ...s1, atlas: await page.evaluate(() => window.__mcLook?.info?.().dustAtlas) };
  await page.screenshot({ path: path.join(outDir, `dust-feed-${view}-live.png`) });
  // Unsaved play, then a worker crash: the view must roll back with the worker (rebuild path).
  await sleep(6_000);
  const pre = await page.evaluate(() => window.__mcDustFeed.viewHash());
  await page.evaluate(() => {
    window.__mcDustFeed.sweep(false);
    window.__mcDustFeed.crashWorker();
  });
  await sleep(5_000);
  const s2 = await page.evaluate(async () => {
    const f = window.__mcDustFeed;
    const h = await f.hash();
    return { stats: f.stats(), hash: h, viewHash: f.viewHash() };
  });
  result.afterCrash = { viewHashBeforeCrash: pre, ...s2 };
  await page.screenshot({ path: path.join(outDir, `dust-feed-${view}-after-crash.png`) });
  await page.evaluate(() => window.__mcDustFeed.sweep(true));
  await sleep(8_000);
  const s3 = await page.evaluate(async () => {
    const f = window.__mcDustFeed;
    const h = await f.hash();
    return { stats: f.stats(), hash: h, viewHash: f.viewHash() };
  });
  result.afterResume = s3;
  await page.screenshot({ path: path.join(outDir, `dust-feed-${view}-resumed.png`) });
  result.logs = logs.slice(0, 40);
  await page.close();

  // Fallback: the seeded scenario with &solo=0.
  const p2 = await browser.newPage({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1 });
  await p2.bringToFront();
  await p2.goto(`http://localhost:${port}/?scene=dust&perf=1&preset=medium&view=${view}&solo=0&warm=600`);
  await sleep(15_000);
  result.solo0 = await p2.evaluate(() => ({
    hooks: window.__mcDustFeed !== undefined,
    feed: window.__mcLook?.info?.().dustFeed ?? null,
    atlas: window.__mcLook?.info?.().dustAtlas ?? null,
  }));
  await p2.screenshot({ path: path.join(outDir, `dust-feed-${view}-solo0-scenario.png`) });
} finally {
  await browser.close();
  fs.writeFileSync(path.join(outDir, "dust-feed-check.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
