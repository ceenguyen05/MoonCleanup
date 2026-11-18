// W3-T05 terrain visual: third-person contact + clean trail on the real GPU (off-screen headed Chrome, WebGPU Medium).
// Usage: node terrain-visual.cjs <port> <outDir> [ground]
const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const req = createRequire("C:/Users/caseyn/Downloads/BroswerMoonSweeper/tools/screenshots/package.json");
const { chromium } = req("@playwright/test");
const [port, outDir, ground = "terrain"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const ARGS = [
  "--window-position=-32000,-32000",
  "--window-size=1280,720",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan,WebGPU",
  "--ignore-gpu-blocklist",
];
const W = 1600;
const H = 900;
const mouse = { x: W / 2, y: H / 2 };
async function moveBy(page, dx, dy, steps = 20) {
  const x0 = mouse.x;
  const y0 = mouse.y;
  for (let i = 1; i <= steps; i++) {
    mouse.x = x0 + (dx * i) / steps;
    mouse.y = y0 + (dy * i) / steps;
    await page.mouse.move(mouse.x, mouse.y);
    await page.waitForTimeout(20);
  }
}
const snap = (page) =>
  page.evaluate(() => {
    const g = window.__mcGameplay?.();
    const look = window.__mcLook?.info?.();
    return { pose: g?.pose, strokes: g?.strokes, dust: g?.dust, feed: look?.dustFeed, atlas: look?.dustAtlas };
  });
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: false, args: ARGS });
  const out = { errors: [], shots: {} };
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await ctx.addInitScript("globalThis.__name = globalThis.__name || function (f) { return f; };");
    await ctx.addInitScript(`(() => { const log = (globalThis.__lockLog = []); const t = () => Math.round(performance.now());
      document.addEventListener("pointerlockerror", () => log.push(["lockerror", t(), document.hasFocus()]));
      document.addEventListener("pointerlockchange", () => log.push(["lockchange", t(), !!document.pointerLockElement]));
      addEventListener("blur", () => log.push(["blur", t()])); addEventListener("focus", () => log.push(["focus", t()]));
      document.addEventListener("mousedown", (e) => log.push(["mousedown", t(), document.hasFocus(), e.target && e.target.tagName, document.elementFromPoint(e.clientX, e.clientY)?.tagName])); })();`);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => out.errors.push(String(e).slice(0, 300)));
    page.on("console", (m) => m.type() === "error" && out.errors.push(m.text().slice(0, 300)));
    await page.goto(`http://127.0.0.1:${port}/?perf=1&audio=0&preset=medium&ground=${ground}`, { waitUntil: "commit", timeout: 180000 });
    await page.waitForFunction(() => window.__mcReady === true && window.__mcGameplay?.().pose != null, null, { timeout: 360000 });
    await page.waitForTimeout(10000);
    out.lockTries = 0;
    for (let i = 0; i < 6; i++) {
      out.lockTries++;
      await page.mouse.click(W / 2, H / 2);
      const ok = await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 4000 }).then(() => true, () => false);
      if (ok) break;
      await page.waitForTimeout(1500);
    }
    out.noLock = !(await page.evaluate(() => !!document.pointerLockElement));
    if (out.noLock) {
      out.lockLogBeforeFront = await page.evaluate(() => globalThis.__lockLog.slice(-20));
      await page.bringToFront();
      await page.waitForTimeout(500);
      await page.mouse.click(W / 2, H / 2);
      out.lockAfterFront = await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 4000 }).then(() => true, () => false);
      out.noLock = !out.lockAfterFront;
    }
    out.lockLog = await page.evaluate(() => globalThis.__lockLog.slice(-30));
    await page.waitForTimeout(800);
    out.mode0 = (await snap(page)).pose?.mode;
    if (out.mode0 !== "third") {
      await page.keyboard.press("v");
      await page.waitForTimeout(800);
    }
    out.mode1 = (await snap(page)).pose?.mode;
    await page.screenshot({ path: path.join(outDir, `v-${ground}-third-idle.png`) });
    // Scrub: forward, then a strafe, then a turning arc.
    await page.mouse.down();
    await page.keyboard.down("w");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(outDir, `v-${ground}-third-scrubwalk.png`) });
    await page.waitForTimeout(2500);
    await page.keyboard.up("w");
    await page.keyboard.down("a");
    await page.waitForTimeout(2500);
    await page.keyboard.up("a");
    await page.screenshot({ path: path.join(outDir, `v-${ground}-third-scrubstrafe.png`) });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outDir, `v-${ground}-third-scrubstill.png`) });
    await page.mouse.up();
    await page.waitForTimeout(500);
    out.afterScrub = await snap(page);
    // Swing the camera round to look back along the trail, a bit higher.
    await moveBy(page, 1100, -60);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, `v-${ground}-third-trail.png`) });
    await moveBy(page, 600, 120);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, `v-${ground}-third-trail2.png`) });
    out.end = await snap(page);
    await ctx.close();
  } catch (e) {
    out.failure = String(e).slice(0, 500); try { const pg = browser.contexts()[0]?.pages()[0]; if (pg) { await pg.screenshot({ path: path.join(outDir, `v-${ground}-failure.png`) }); out.atFailure = await pg.evaluate(() => ({ ready: window.__mcReady, hasGp: typeof window.__mcGameplay, err: document.documentElement.dataset.mcError ?? null, body: document.body.innerText.slice(0, 400) })); } } catch {}
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(outDir, `v-${ground}.json`), JSON.stringify(out, null, 2));
    console.log(JSON.stringify({ mode0: out.mode0, mode1: out.mode1, errors: out.errors, failure: out.failure, feed: out.end?.feed, strokes: out.end?.strokes }, null, 1));
  }
})();
