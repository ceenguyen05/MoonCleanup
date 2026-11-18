// Unobstructed real Solo scrub capture (M1-W3-T07 final). Headless Chrome on the real GPU, WebGPU Medium, 1280x720 DPR1.
//   node capture-unobstructed.mjs --out <dir> [--port 5311] [--query "?preset=medium&dynres=off&hud=0"] [--pitch 160]
//     [--dpr 1] [--clip x,y,w,h]   (zoomed look-check: --dpr 2 --clip 440,330,400,300)
// The HUD/UI host (#mc-ui) and the dev overlay (#mc-overlay) are hidden with injected CSS, the Induction checklist is
// marked done in localStorage (no DOT subtitle over the avatar), the camera goes third person (V), and the look pitches
// down so the custodian and the dust contact are in frame. Bursts: stationary scrub, sweep-walk (W), strafe scrub (D).
/* global window, document, localStorage */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const { chromium } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const port = args.port ?? "5311";
const out = path.resolve(args.out ?? "solo-out");
const query = args.query ?? "?preset=medium&dynres=off&hud=0";
const pitchPx = Number(args.pitch ?? 160);
const dpr = Number(args.dpr ?? 1);
const clip = args.clip ? (([x, y, width, height]) => ({ x, y, width, height }))(args.clip.split(",").map(Number)) : null;
fs.mkdirSync(out, { recursive: true });
const induction = JSON.parse(fs.readFileSync(path.join(repo, "packages/game-data/data/onboarding.json"), "utf8"))
  .induction.map((s) => s.id);

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist"],
});
const log = { console: [], snaps: {} };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
  await page.addInitScript((ids) => {
    try {
      localStorage.setItem("mc.onboarding.induction.v1", JSON.stringify(ids));
    } catch {
      /* ignore */
    }
    const css = "#mc-ui,#mc-overlay{display:none!important}";
    const add = () => {
      const s = document.createElement("style");
      s.textContent = css;
      document.head.appendChild(s);
    };
    if (document.head) add();
    else document.addEventListener("DOMContentLoaded", add);
  }, induction);
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") log.console.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => log.console.push(`pageerror: ${String(e).slice(0, 300)}`));
  await page.goto(`http://localhost:${port}/${query}`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => window.__mcReady === true, undefined, { timeout: 240_000 });
  await page.waitForFunction(() => window.__mcGameplay?.()?.predicted === true, undefined, { timeout: 120_000 });
  await page.waitForTimeout(5000);
  const snap = () => page.evaluate(() => window.__mcGameplay());
  const info = () =>
    page.evaluate(() => {
      const i = typeof window.__mcInfo === "function" ? window.__mcInfo() : window.__mcInfo;
      return i ? { backend: i.backend, gpu: i.gpu, ft: i.frameTimeAvgMs, p95: i.frameTimeP95Ms, dpr: i.dpr } : null;
    });
  log.info = await info();
  await page.mouse.move(640, 360);
  await page.mouse.click(640, 360);
  await page.waitForTimeout(800);
  await page.keyboard.press("KeyV");
  await page.waitForTimeout(800);
  // Pitch the look down (pointer-locked relative motion).
  for (let k = 0; k < 8; k++) {
    await page.mouse.move(640, 360 + (pitchPx * (k + 1)) / 8);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(1200);
  log.pointerLocked = await page.evaluate(() => document.pointerLockElement !== null);
  log.snaps.start = await snap();

  let n = 0;
  const series = [];
  const burst = async (tag, count, gapMs) => {
    for (let k = 0; k < count; k++) {
      const name = `${tag}-${String(n++).padStart(3, "0")}.png`;
      await page.screenshot({ path: path.join(out, name), type: "png", ...(clip ? { clip } : {}) });
      series.push({ name, t: Date.now() });
      if (gapMs > 0) await page.waitForTimeout(gapMs);
    }
  };
  await burst("idle", 2, 200);
  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(1200);
  await burst("scrub", 16, 0);
  log.snaps.midScrub = await snap();
  await page.mouse.up({ button: "left" });
  await burst("scrub-end", 6, 100);
  await page.keyboard.down("KeyW");
  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(700);
  await burst("walkscrub", 12, 0);
  await page.mouse.up({ button: "left" });
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(600);
  await page.keyboard.down("KeyD");
  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(700);
  await burst("strafescrub", 12, 0);
  await page.mouse.up({ button: "left" });
  await page.keyboard.up("KeyD");
  await burst("end", 3, 150);
  log.snaps.end = await snap();
  log.info2 = await info();
  log.series = series;
} catch (e) {
  log.error = String(e);
} finally {
  fs.writeFileSync(path.join(out, "solo.json"), JSON.stringify(log, null, 1));
  await browser.close();
}
console.log(
  JSON.stringify(
    { error: log.error, pointerLocked: log.pointerLocked, info: log.info, info2: log.info2, console: log.console.slice(0, 12) },
    null,
    1,
  ),
);
