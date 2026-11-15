/* global window, document, getComputedStyle, requestAnimationFrame */ // page.evaluate bodies run in the browser
// Solo gameplay smoke (M1): node solo-smoke.mjs <baseUrl> <query> [soakSec] [backend: webgl2|webgpu]
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
const [base, query, soakArg = "60", backend = "webgl2"] = process.argv.slice(2);
const soak = Number(soakArg);
const args =
  backend === "webgl2"
    ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
    : ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist"];
args.push("--enable-precise-memory-info", "--js-flags=--expose-gc");
const browser = await chromium.launch({ headless: true, args });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const out = { query, backend, console: [], requests: [], steps: {} };
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type())) out.console.push(`${m.type()}: ${m.text()}`.slice(0, 300));
});
page.on("pageerror", (e) => out.console.push("pageerror: " + String(e).slice(0, 300)));
page.on("request", (r) => out.requests.push(r.url().replace(base, "/")));
await page.goto(`${base}?${query}`);
await page
  .waitForFunction(() => window.__mcReady === true || typeof window.__mcStats === "function", null, { timeout: 60000 })
  .catch(() => (out.steps.ready = "timeout"));
await page.waitForTimeout(3000); // allow lazy chunks (no explicit gameplay-ready signal exists; see report)
out.steps.info = await page.evaluate(() => {
  try {
    return window.__mcInfo?.();
  } catch (e) {
    return String(e);
  }
});
out.steps.launcher = await page.evaluate(() => {
  const e = document.querySelector('[data-testid="online-launcher"]');
  if (!e) return "missing";
  const r = e.getBoundingClientRect();
  return {
    w: r.width,
    h: r.height,
    visible: r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden",
  };
});
// canvas profile helper: column luminance profile + total
const prof = () =>
  page.evaluate(async () => {
    const c = document.querySelector("canvas");
    const w = 240,
      h = 135;
    const t = document.createElement("canvas");
    t.width = w;
    t.height = h;
    const g = t.getContext("2d");
    await new Promise((r) => requestAnimationFrame(() => r()));
    g.drawImage(c, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const cols = new Array(w).fill(0);
    let sum = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const l = d[i] + d[i + 1] + d[i + 2];
        cols[x] += l;
        sum += l;
      }
    return { cols, sum };
  });
const shift = (a, b) => {
  let best = 0,
    bs = Infinity;
  for (let s = -30; s <= 30; s++) {
    let e = 0,
      n = 0;
    for (let x = 35; x < 205; x++) {
      const d = a[x] - b[x + s];
      e += d * d;
      n++;
    }
    if (e / n < bs) {
      bs = e / n;
      best = s;
    }
  }
  return best;
};
await page.mouse.move(480, 270);
await page.mouse.click(480, 270);
await page.waitForTimeout(500);
out.steps.pointerLock = await page.evaluate(() => document.pointerLockElement !== null);
// key press -> next frames
const p0 = await prof();
await page.keyboard.down("w");
await page.evaluate(
  () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now())))),
);
const p2 = await prof();
await page.waitForTimeout(800);
const p3 = await prof();
await page.keyboard.up("w");
out.steps.walk = {
  sumBefore: p0.sum,
  sumAfter2Frames: p2.sum,
  sumAfter800ms: p3.sum,
  changed2f: p0.sum !== p2.sum || p0.cols.some((v, i) => v !== p2.cols[i]),
  changed800: p0.cols.some((v, i) => v !== p3.cols[i]),
};
// mouse right
await page.waitForTimeout(400);
const q0 = await prof();
for (let i = 0; i < 10; i++) await page.mouse.move(480 + (i + 1) * 12, 270, { steps: 1 });
await page.waitForTimeout(400);
const q1 = await prof();
// content moving left on screen (negative shift of q1 relative to q0 means features moved left) => camera turned right
out.steps.mouseRight = {
  colShift: shift(q0.cols, q1.cols),
  note: "shift s: q0[x]~q1[x+s]; s>0 => content moved LEFT => camera turned RIGHT",
  changed: q0.cols.some((v, i) => v !== q1.cols[i]),
  pointerLocked: out.steps.pointerLock,
};
// hold tool
const s0 = await prof();
await page.mouse.down();
await page.waitForTimeout(1500);
const s1 = await prof();
await page.mouse.up();
out.steps.tool = { changed: s0.cols.some((v, i) => v !== s1.cols[i]), sumDelta: s1.sum - s0.sum };
// soak
const stats = () =>
  page.evaluate(() => {
    window.gc?.();
    const s = window.__mcStats?.();
    return s
      ? {
          heap: s.memory.jsHeapBytes,
          p50: s.frameMs.p50,
          p95: s.frameMs.p95,
          fps: s.fps,
          frames: s.frames,
          draw: s.render.drawCalls,
          env: s.env,
        }
      : null;
  });
out.steps.stats0 = await stats();
await page.keyboard.down("w");
await page.keyboard.down("d");
const marks = [];
for (let t = 0; t < soak; t += 15) {
  await page.waitForTimeout(15000);
  marks.push({ t: t + 15, ...(await stats()), env: undefined });
}
await page.keyboard.up("w");
await page.keyboard.up("d");
out.steps.soak = marks;
out.steps.snap = (await page.screenshot({ type: "png" })).length;
mkdirSync("tools/screenshots/output/solo-smoke", { recursive: true });
await page.screenshot({ path: `tools/screenshots/output/solo-smoke/${query.replace(/\W+/g, "_")}_${backend}.png` });
await browser.close();
const chunks = out.requests.filter((u) => /online|colyseus|net/i.test(u));
out.onlineChunks = chunks;
writeFileSync(
  `tools/screenshots/output/solo-smoke/${query.replace(/\W+/g, "_")}_${backend}.json`,
  JSON.stringify(out, null, 1),
);
console.log(JSON.stringify({ ...out, requests: out.requests.length }, null, 1));
