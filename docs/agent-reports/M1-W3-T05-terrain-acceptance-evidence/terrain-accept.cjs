// W3-T05 terrain acceptance: real-GPU (installed Chrome, off-screen headed) flat vs terrain game, Medium.
// Usage: node terrain-accept.cjs <port> <outDir> <lanes comma list, e.g. flat,terrain,flat,terrain> [preset] [scale] [w] [h]
const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const repo = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const req = createRequire(repo + "/tools/screenshots/package.json");
const { chromium } = req("@playwright/test");

const [port, outDir, lanesArg, preset = "medium", scale = "0.75", w = "1920", h = "1080"] = process.argv.slice(2);
const lanes = lanesArg.split(",");
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
  "--disable-frame-rate-limit",
];

function pct(a, p) {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function summ(frames) {
  return {
    n: frames.length,
    p50: pct(frames, 50),
    p95: pct(frames, 95),
    p99: pct(frames, 99),
    max: frames.length ? Math.max(...frames) : null,
    fps: frames.length ? (1000 * frames.length) / frames.reduce((a, b) => a + b, 0) : null,
    over33: frames.filter((f) => f > 33.4).length,
  };
}

async function record(page, seconds) {
  await page.evaluate((s) => {
    window.__mcStatsReset?.();
    const rec = { buf: new Float64Array(Math.ceil(s * 400)), n: 0, on: true };
    window.__accFrames = rec;
    let prev = performance.now();
    const tick = (t) => {
      if (!rec.on) return;
      if (rec.n < rec.buf.length) rec.buf[rec.n++] = t - prev;
      prev = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, seconds);
  const snaps = [];
  for (let i = 0; i < seconds; i++) {
    await page.waitForTimeout(1000);
    snaps.push(await page.evaluate(() => window.__mcStats?.() ?? null));
  }
  const frames = await page.evaluate(() => {
    const r = window.__accFrames;
    r.on = false;
    return Array.from(r.buf.subarray(1, r.n));
  });
  const gpu = snaps.map((s) => s?.gpu?.renderMs?.p50).filter((x) => typeof x === "number" && x > 0);
  const gpu95 = snaps.map((s) => s?.gpu?.renderMs?.p95).filter((x) => typeof x === "number" && x > 0);
  const draws = snaps.map((s) => s?.render?.drawCalls).filter((x) => typeof x === "number");
  const cpu = snaps.map((s) => s?.cpuTotalMs?.p50).filter((x) => typeof x === "number");
  const cpu95 = snaps.map((s) => s?.cpuTotalMs?.p95).filter((x) => typeof x === "number");
  const heap = snaps.map((s) => s?.memory?.jsHeapBytes).filter((x) => typeof x === "number");
  return {
    frame: summ(frames),
    gpuRenderP50Median: pct(gpu, 50),
    gpuRenderP95Median: pct(gpu95, 50),
    gpuWindows: gpu.length,
    drawsMax: draws.length ? Math.max(...draws) : null,
    drawsMedian: pct(draws, 50),
    cpuP50Median: pct(cpu, 50),
    cpuP95Median: pct(cpu95, 50),
    heapStartMB: heap.length ? heap[0] / 1048576 : null,
    heapEndMB: heap.length ? heap[heap.length - 1] / 1048576 : null,
    cpuSplitLast: snaps.at(-1)?.cpuMs ?? null,
    env: snaps.at(-1)?.env ?? null,
  };
}

const info = (page) =>
  page.evaluate(() => {
    const look = window.__mcLook?.info?.() ?? null;
    return {
      game: window.__mcGameplay?.() ?? null,
      dustFeed: look?.dustFeed ?? null,
      dustAtlas: look?.dustAtlas ?? null,
      terrain: window.__mcTerrain?.info?.() ?? null,
      harness: window.__mcInfo?.() ?? null,
      dynres: window.__mcDynres?.() ?? null,
      fatal: document.documentElement.dataset.mcError ?? null,
    };
  });

const mouse = { x: 0, y: 0 };
async function moveTo(page, x, y) {
  mouse.x = x;
  mouse.y = y;
  await page.mouse.move(x, y);
}
async function turn(page, px) {
  const steps = 25;
  const x0 = mouse.x;
  for (let i = 1; i <= steps; i++) {
    await moveTo(page, x0 + (px * i) / steps, mouse.y);
    await page.waitForTimeout(25);
  }
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: false, args: ARGS });
  const results = { browser: browser.version(), preset, scale, viewport: [Number(w), Number(h)], runs: [] };
  try {
    for (let li = 0; li < lanes.length; li++) {
      const ground = lanes[li];
      const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
      await ctx.addInitScript("globalThis.__name = globalThis.__name || function (f) { return f; };");
      const page = await ctx.newPage();
      const run = { lane: ground, i: li, errors: [], warnings: [] };
      page.on("pageerror", (e) => run.errors.push(String(e).slice(0, 400)));
      page.on("console", (m) => {
        if (m.type() === "error") run.errors.push(m.text().slice(0, 400));
        else if (m.type() === "warning" && run.warnings.length < 40) run.warnings.push(m.text().slice(0, 200));
      });
      try {
        const url = `http://127.0.0.1:${port}/?perf=1&audio=0&preset=${preset}&scale=${scale}&ground=${ground}`;
        run.url = url;
        const t0 = Date.now();
        await page.goto(url, { waitUntil: "commit", timeout: 180000 });
        await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 180000 });
        await page.waitForFunction(() => typeof window.__mcGameplay === "function" && window.__mcGameplay().pose !== null, null, {
          timeout: 180000,
        });
        await page.waitForFunction(() => window.__mcGameplay().worker?.tick > 20, null, { timeout: 120000 }).catch(() => {});
        run.readyS = (Date.now() - t0) / 1000;
        await page.waitForTimeout(10000); // pipeline compile / streaming warm-up
        run.before = await info(page);
        await page.screenshot({ path: path.join(outDir, `${li}-${ground}-idle.png`) });
        // Pointer lock for real input.
        mouse.x = Number(w) / 2;
        mouse.y = Number(h) / 2;
        run.lockTries = 0;
        for (let i = 0; i < 6; i++) {
          run.lockTries++;
          await page.mouse.click(Number(w) / 2, Number(h) / 2);
          const ok = await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 4000 }).then(() => true, () => false);
          if (ok) break;
          await page.waitForTimeout(1500);
        }
        run.noLock = !(await page.evaluate(() => !!document.pointerLockElement));
        await page.waitForTimeout(1500);
        run.idle = await record(page, 10);
        // Scrub while walking (tool held + W), then measure under the same load.
        await page.mouse.down();
        await page.keyboard.down("w");
        await page.waitForTimeout(1500);
        run.scrubWalk = await record(page, 12);
        await page.screenshot({ path: path.join(outDir, `${li}-${ground}-scrub.png`) });
        await page.keyboard.up("w");
        await page.waitForTimeout(1500);
        // Scrub in place with a strafe for a wide clean patch.
        await page.keyboard.down("d");
        await page.waitForTimeout(2500);
        await page.keyboard.up("d");
        await page.mouse.up();
        await page.waitForTimeout(1500);
        run.afterScrub = await info(page);
        // Turn round (about 180 degrees) to see the trail.
        await turn(page, 2000);
        await page.waitForTimeout(2500);
        await page.screenshot({ path: path.join(outDir, `${li}-${ground}-trail.png`) });
        run.afterTurn = await info(page);
        // Look down at the feet / contact.
        for (let i = 1; i <= 5; i++) await moveTo(page, mouse.x, mouse.y + 40);
        run.yawAfterTurn = run.afterTurn?.game?.pose?.yawRad;
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(outDir, `${li}-${ground}-down.png`) });
        // Walk away 40+ m with the tool held to exercise the lookup re-centre on terrain.
        await page.mouse.down();
        await page.keyboard.down("w");
        await page.waitForTimeout(1000);
        run.longWalk = await record(page, 20);
        await page.keyboard.up("w");
        await page.mouse.up();
        await page.waitForTimeout(1500);
        await turn(page, 2000);
        await page.waitForTimeout(2500);
        await page.screenshot({ path: path.join(outDir, `${li}-${ground}-trail2.png`) });
        run.end = await info(page);
      } catch (e) {
        run.failure = String(e).slice(0, 600);
        try {
          await page.screenshot({ path: path.join(outDir, `${li}-${ground}-failure.png`) });
          run.atFailure = await info(page);
        } catch {}
      } finally {
        await ctx.close();
      }
      results.runs.push(run);
      fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
      const brief = (m) =>
        m ? `frame p50 ${m.frame.p50?.toFixed(1)} p95 ${m.frame.p95?.toFixed(1)} fps ${m.frame.fps?.toFixed(1)} gpu ${m.gpuRenderP50Median?.toFixed(2)}/${m.gpuRenderP95Median?.toFixed(2)} cpu ${m.cpuP50Median?.toFixed(2)}/${m.cpuP95Median?.toFixed(2)} draws ${m.drawsMax}` : "n/a";
      console.log(`[${li}] ${ground} ready ${run.readyS}s errors ${run.errors.length} ${run.failure ?? ""}`);
      console.log(`   idle  ${brief(run.idle)}`);
      console.log(`   scrub ${brief(run.scrubWalk)}`);
      console.log(`   long  ${brief(run.longWalk)}`);
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
