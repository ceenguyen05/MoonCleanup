import { OFFSCREEN_CHROME_ARGS } from "../../../offscreen-chrome-args.mjs";
// Driver of the light / sky browser checks (M1-W2-T02). Not part of the app bundle: run it by hand against a running
// client dev server (pnpm --filter @moon-cleanup/client exec vite --port 5262 --strictPort).
//
//   node run-light-sky.mjs --out <dir> [--port 5262] [--backends webgpu,webgl2] [--preset medium]
//        [--parts cycle,p5,term,phase,s06,bloom] [--uncapped 1]
//
// cycle  `?scene=moon` ground view at fixed day-clock times (dawn, morning, noon, dusk, terminator, midnight) plus a
//        clock-off control: capture, `__mcLook.info()`, frame interval and GPU ms -> cycle-<backend>.json
// p5     sunset to night at x60 (visual-target P5), sampled for 20 s: ground luma, star count, EV100 and key mode per
//        sample; largest luma step and star-count step between samples -> p5-<backend>.json
// term   the same samples at x2 through the terminator band (sun +1.7 to -1.1 degrees) -> term-<backend>.json
// phase  S01 with the physical Earth phase (`earthfull=0`): lit fraction measured on the disk against the geometry, and
//        the angle between the lit side and the sun (VT-M1-11) -> phase-<backend>.json
// s06    night scene with the Crown Lamp hook: frame / GPU ms and the probe lumas -> s06-<backend>.json
// bloom  bloom on / off difference on sunlit ground (VT-M1-29) -> bloom-<backend>.json
//
// Headed Chrome on the real GPU, 1280 x 720, DPR 1. Playwright and pngjs come from tools/screenshots.

/* global window, document, requestAnimationFrame */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../../..");
const { chromium } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);
const { PNG } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/pngjs/lib/png.js")).href
).then((m) => m.default ?? m);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const port = args.port ?? "5262";
const backends = (args.backends ?? "webgpu,webgl2").split(",");
const preset = args.preset ?? "medium";
const parts = new Set((args.parts ?? "cycle,p5,term,phase,s06,bloom").split(","));
const out = path.resolve(args.out ?? "light-sky-out");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: [
    ...OFFSCREEN_CHROME_ARGS,
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,WebGPU",
    "--ignore-gpu-blocklist",
    // --uncapped 1: frame times below the display interval become measurable (not how the game runs).
    ...(args.uncapped === "1" ? ["--disable-frame-rate-limit", "--disable-gpu-vsync"] : []),
  ],
});

async function open(query) {
  const url = `http://localhost:${port}/?${query}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const messages = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") messages.push(`${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => messages.push(`pageerror: ${String(e).slice(0, 300)}`));
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForFunction(() => window.__mcLook !== undefined && window.__mcLook.isReady() === true, undefined, {
    timeout: 180_000,
  });
  return { page, messages, url };
}

/** Frame interval over 180 frames and the debug module's GPU window, after a settle. */
async function perf(page, settleMs = 2500) {
  await page.waitForTimeout(settleMs);
  await page.evaluate(() => window.__mcStatsReset?.());
  await page.waitForTimeout(3000);
  return page.evaluate(async () => {
    const times = [];
    let last = performance.now();
    await new Promise((done) => {
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (times.length >= 180) done(null);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    times.sort((a, b) => a - b);
    const stats = window.__mcStats?.() ?? null;
    return {
      frameMs: { p50: times[90], p95: times[171], max: times[179] },
      gpu: stats?.gpu ?? null,
      cpuTotalMs: stats?.cpuTotalMs ?? null,
      visualsCpuMs: stats?.cpuMs?.["visuals"] ?? stats?.cpuMs ?? null,
      draws: stats?.render?.drawCalls ?? null,
      triangles: stats?.render?.triangles ?? null,
      renderScale: stats?.env?.renderScale ?? null,
      backend: stats?.env?.backend ?? null,
      gpuName: stats?.env?.gpu ?? null,
      canvas: document.querySelector("canvas")?.width ?? null,
    };
  });
}

const luma = (d, i) => d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722;

function meanLuma(png, x0, y0, x1, y1) {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, n++) sum += luma(png.data, y * png.width + x);
  return sum / Math.max(1, n);
}

/** Stars by the VT-M1-12 rule: local maxima at least 12 luma above their 5 x 5 median, inside rows [y0, y1). */
function countStars(png, y0, y1) {
  const { width: w, data } = png;
  let count = 0;
  const win = new Float32Array(25);
  for (let y = Math.max(2, y0); y < Math.min(png.height - 2, y1); y++) {
    for (let x = 2; x < w - 2; x++) {
      const c = luma(data, y * w + x);
      if (c < 12) continue;
      let isMax = true;
      let k = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const v = luma(data, (y + dy) * w + x + dx);
          win[k++] = v;
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx !== 0 || dy !== 0)) {
            // Strict on one side so a flat two-pixel peak counts once.
            if (v > c || (v === c && (dy < 0 || (dy === 0 && dx < 0)))) isMax = false;
          }
        }
      }
      if (!isMax) continue;
      const sorted = Array.from(win).sort((a, b) => a - b);
      if (c - sorted[12] >= 12) count++;
    }
  }
  return count;
}

const shot = async (page, name) => {
  const buffer = await page.screenshot({ path: path.join(out, `${name}.png`) });
  return PNG.sync.read(buffer);
};
const lookInfo = (page) => page.evaluate(() => window.__mcLook.info());
const write = (name, data) => fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(data, null, 2));

for (const backend of backends) {
  const base = `solo=0&preset=${preset}&backend=${backend}`;

  if (parts.has("cycle")) {
    const rows = [];
    const cells = [
      { name: "control-sun14", query: "" },
      { name: "t0058-dawn", query: "&tod=58&todrate=0" },
      { name: "t0450-morning", query: "&tod=450&todrate=0" },
      { name: "t0900-noon", query: "&tod=900&todrate=0" },
      { name: "t1742-dusk", query: "&tod=1742&todrate=0" },
      { name: "t1800-terminator", query: "&tod=1800&todrate=0" },
      { name: "t2700-midnight", query: "&tod=2700&todrate=0" },
    ];
    // --cyclecells control,noon: only the cells whose name contains one of the words.
    const only = args.cyclecells === undefined ? null : args.cyclecells.split(",");
    for (const cell of cells) {
      if (only !== null && !only.some((word) => cell.name.includes(word))) continue;
      const { page, messages, url } = await open(`scene=moon&view=ground&${base}${cell.query}`);
      const p = await perf(page);
      const info = await lookInfo(page);
      const png = await shot(page, `cycle-${backend}-${cell.name}`);
      const row = {
        name: cell.name,
        url,
        sunEl: info.state.sunElevationDeg,
        sunAz: info.state.sunAzimuthDeg,
        keyMode: info.keyMode,
        ev100: info.ev100,
        dayClock: info.dayClock,
        groundLuma: meanLuma(png, 0, 400, 1280, 720),
        skyLuma: meanLuma(png, 0, 0, 1280, 60),
        stars: countStars(png, 80, 300),
        ...p,
        console: messages.slice(0, 6),
      };
      rows.push(row);
      console.log(
        `cycle ${backend} ${cell.name}: el=${row.sunEl.toFixed(2)} mode=${row.keyMode} ev=${row.ev100.toFixed(2)} ground=${row.groundLuma.toFixed(1)} stars=${row.stars} frame p50=${p.frameMs.p50.toFixed(1)} p95=${p.frameMs.p95.toFixed(1)} gpu=${JSON.stringify(p.gpu?.renderMs)} measured=${p.gpu?.measured} scale=${p.renderScale} ${messages[0] ?? ""}`,
      );
      await page.close();
    }
    write(`cycle-${backend}${args.tag === undefined ? "" : `-${args.tag}`}`, rows);
  }

  // P5 at x60 (the spec's time-lapse) and a x2 pass through the terminator band, which x60 crosses in a quarter second.
  for (const run of [
    { part: "p5", startS: 1680, rate: 60, seconds: 20 },
    { part: "term", startS: 1775, rate: 2, seconds: 32 },
  ]) {
    if (!parts.has(run.part)) continue;
    // --query a=b&c=d: extra scene parameters for this pass (A/B of a terrain or look switch).
    const extra = args.query === undefined ? "" : `&${args.query}`;
    const { page, messages } = await open(
      `scene=moon&view=ground&${base}&tod=${run.startS}&todrate=0&dynres=0${extra}`,
    );
    await page.waitForTimeout(2500);
    await page.evaluate((rate) => window.__mcLook.set({ dayRate: rate }), run.rate);
    const samples = [];
    const t0 = Date.now();
    let previous = null;
    let worstLuma = { step: 0, at: 0 };
    let worstStars = { step: 0, at: 0 };
    for (let i = 0; Date.now() - t0 < run.seconds * 1000; i++) {
      const info = await lookInfo(page);
      const png = PNG.sync.read(await page.screenshot());
      const s = {
        wallS: (Date.now() - t0) / 1000,
        timeS: info.dayClock.timeS,
        sunEl: info.state.sunElevationDeg,
        keyMode: info.keyMode,
        ev100: info.ev100,
        scriptedEv100: info.dayClock.scriptedEv100,
        mLim: info.dayClock.limitingMagnitude,
        groundLuma: meanLuma(png, 0, 400, 1280, 720),
        groundMaxLuma: meanLuma(png, 0, 345, 1280, 375),
        stars: countStars(png, 80, 300),
      };
      if (previous !== null) {
        const dl = Math.abs(s.groundLuma - previous.groundLuma);
        if (dl > worstLuma.step) worstLuma = { step: dl, at: s.timeS, dtS: s.wallS - previous.wallS };
        const ds = Math.abs(s.stars - previous.stars);
        if (ds > worstStars.step) worstStars = { step: ds, at: s.timeS, dtS: s.wallS - previous.wallS };
      }
      if (i % 8 === 0 || (previous !== null && previous.keyMode !== s.keyMode)) {
        fs.writeFileSync(
          path.join(out, `${run.part}-${backend}-${String(Math.round(s.timeS)).padStart(4, "0")}.png`),
          PNG.sync.write(png),
        );
      }
      samples.push(s);
      previous = s;
      await page.waitForTimeout(100);
    }
    write(`${run.part}-${backend}`, { samples, worstLuma, worstStars, console: messages.slice(0, 6) });
    const lumas = samples.map((s) => s.groundLuma.toFixed(0)).join(" ");
    const stars = samples.map((s) => s.stars).join(" ");
    console.log(
      `${run.part} ${backend}: samples=${samples.length} worst ground luma step=${worstLuma.step.toFixed(1)} at t=${worstLuma.at.toFixed(0)} worst star step=${worstStars.step} at t=${worstStars.at.toFixed(0)} end ev=${previous?.ev100} mode=${previous?.keyMode}
  ground: ${lumas}
  stars: ${stars}
  ${messages[0] ?? ""}`,
    );
    await page.close();
  }

  // --parts cells --cells "name|query;name|query": ad-hoc frozen captures with the look info and the ground luma.
  if (parts.has("cells")) {
    const rows = [];
    for (const cell of (args.cells ?? "").split(";").filter((c) => c !== "")) {
      const [name, query] = cell.split("|");
      const { page, messages } = await open(`${query}&${base}&dynres=0`);
      await page.waitForTimeout(3000);
      const info = await lookInfo(page);
      const png = await shot(page, `cell-${backend}-${name}`);
      const row = {
        name,
        query,
        keyMode: info.keyMode,
        ev100: info.ev100,
        dayClock: info.dayClock,
        sunEl: info.state.sunElevationDeg,
        groundLuma: meanLuma(png, 0, 400, 1280, 720),
        nearLuma: meanLuma(png, 440, 600, 840, 700),
        console: messages.filter((m) => !m.includes("powerPreference") && !m.includes("preload")).slice(0, 4),
      };
      rows.push(row);
      console.log(
        `cell ${backend} ${name}: mode=${row.keyMode} ev=${row.ev100.toFixed(2)} el=${row.sunEl.toFixed(3)} keyLux=${info.dayClock.keyLux.toFixed(1)} floorLux=${info.dayClock.floorLux.toFixed(1)} ground=${row.groundLuma.toFixed(1)} near=${row.nearLuma.toFixed(1)} ${row.console[0] ?? ""}`,
      );
      await page.close();
    }
    write(`cells-${backend}-${args.tag ?? "adhoc"}`, rows);
  }

  if (parts.has("phase")) {
    const rows = [];
    for (const tod of [58, 900, 1742, 2250, 2700]) {
      const { page, messages } = await open(`scene=s01&view=a&${base}&earthfull=0&tod=${tod}&todrate=0`);
      await page.waitForTimeout(2500);
      const info = await lookInfo(page);
      const geo = await page.evaluate(() => {
        const look = window.__mcLook;
        const i = look.info();
        const rad = Math.PI / 180;
        const dir = (az, el) => [
          Math.cos(el * rad) * Math.cos(az * rad),
          Math.sin(el * rad),
          Math.cos(el * rad) * Math.sin(az * rad),
        ];
        const e = dir(i.state.earthAzimuthDeg, i.state.earthElevationDeg);
        const s = dir(i.state.sunAzimuthDeg, i.state.sunElevationDeg);
        const c = i.camera.position;
        const R = 1e5;
        const centre = look.project(c[0] + e[0] * R, c[1] + e[1] * R, c[2] + e[2] * R);
        const toward = look.project(
          c[0] + (e[0] + 0.03 * s[0]) * R,
          c[1] + (e[1] + 0.03 * s[1]) * R,
          c[2] + (e[2] + 0.03 * s[2]) * R,
        );
        const radiusPx =
          (720 / 2) * (Math.tan((i.state.earthDiameterDeg / 2) * rad) / Math.tan((i.camera.vfovDeg / 2) * rad));
        return { centre, toward, radiusPx };
      });
      const png = await shot(page, `phase-${backend}-t${String(tod).padStart(4, "0")}`);
      // Lit pixels of the disk: above a quarter of the brightest disk pixel.
      const cx = geo.centre.x;
      const cy = geo.centre.y;
      const r = geo.radiusPx;
      let peak = 0;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) {
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) peak = Math.max(peak, luma(png.data, y * png.width + x));
        }
      }
      let lit = 0;
      let disk = 0;
      let mx = 0;
      let my = 0;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) {
        for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
          if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
          disk++;
          if (luma(png.data, y * png.width + x) > Math.max(24, peak * 0.25)) {
            lit++;
            mx += x + 0.5 - cx;
            my += y + 0.5 - cy;
          }
        }
      }
      const sunDx = geo.toward.x - cx;
      const sunDy = geo.toward.y - cy;
      const cos = lit === 0 ? null : (mx * sunDx + my * sunDy) / (Math.hypot(mx, my) * Math.hypot(sunDx, sunDy) || 1);
      const row = {
        tod,
        sunEl: info.state.sunElevationDeg,
        expected: info.dayClock.earthLitFraction,
        measured: disk === 0 ? null : lit / disk,
        diskPx: disk,
        radiusPx: r,
        centre: geo.centre,
        peakLuma: peak,
        litSideToSunDeg: cos === null ? null : (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI,
        centroidOffsetPx: lit === 0 ? 0 : Math.hypot(mx, my) / lit,
        console: messages.slice(0, 4),
      };
      rows.push(row);
      console.log(
        `phase ${backend} t=${tod}: expected=${row.expected.toFixed(3)} measured=${row.measured?.toFixed(3)} peak=${peak.toFixed(0)} litSideToSun=${row.litSideToSunDeg?.toFixed(1)} deg (offset ${row.centroidOffsetPx.toFixed(1)} px) visible=${geo.centre.visible}`,
      );
      await page.close();
    }
    write(`phase-${backend}`, rows);
  }

  if (parts.has("s06")) {
    const rows = [];
    // The last two cells split the cost of the night lights: no Crown Lamp, and no local light at all.
    for (const view of ["pool", "wide", "pool&off=lamp", "pool&off=lamp,flood,glow"]) {
      const { page, messages, url } = await open(`scene=s06&view=${view}&${base}`);
      const p = await perf(page);
      const info = await lookInfo(page);
      const probes = await page.evaluate(() => window.__mcLook.probes());
      const png = await shot(page, `s06-${backend}-${view.replace(/[^a-z]+/g, "-")}`);
      const lumas = {};
      for (const [name, probe] of Object.entries(probes)) {
        if (!probe.px.visible) continue;
        const x = Math.round(probe.px.x);
        const y = Math.round(probe.px.y);
        lumas[name] = meanLuma(
          png,
          Math.max(0, x - 8),
          Math.max(0, y - 8),
          Math.min(1280, x + 8),
          Math.min(720, y + 8),
        );
      }
      rows.push({
        view,
        url,
        keyMode: info.keyMode,
        ev100: info.ev100,
        lumas,
        stars: countStars(png, 80, 300),
        ...p,
        console: messages.slice(0, 6),
      });
      console.log(
        `s06 ${backend} ${view}: lumas=${JSON.stringify(lumas)} frame p50=${p.frameMs.p50.toFixed(1)} p95=${p.frameMs.p95.toFixed(1)} gpu=${JSON.stringify(p.gpu?.renderMs)} measured=${p.gpu?.measured} scale=${p.renderScale} ${messages[0] ?? ""}`,
      );
      await page.close();
    }
    write(`s06-${backend}`, rows);
  }

  if (parts.has("bloom")) {
    const rows = [];
    for (const scene of ["scene=s05&view=wide", "scene=moon&view=ground&tod=900&todrate=0"]) {
      const frames = [];
      for (const knob of ["", "&bloom=off"]) {
        const { page } = await open(`${scene}&${base}&dynres=0${knob}`);
        await page.waitForTimeout(3000);
        const tag = `bloom-${backend}-${scene.includes("s05") ? "s05" : "moon"}${knob === "" ? "-on" : "-off"}`;
        frames.push(await shot(page, tag));
        await page.close();
      }
      const [a, b] = frames;
      let max = 0;
      let sum = 0;
      let over2 = 0;
      const n = a.width * a.height;
      // Ground = the lower 55 % of the frame in both views.
      let gMax = 0;
      let gSum = 0;
      let gN = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(luma(a.data, i) - luma(b.data, i));
        max = Math.max(max, d);
        sum += d;
        if (d > 2) over2++;
        if (Math.floor(i / a.width) > a.height * 0.45) {
          gMax = Math.max(gMax, d);
          gSum += d;
          gN++;
        }
      }
      const row = {
        scene,
        frameMaxDiff: max,
        frameMeanDiff: sum / n,
        over2Fraction: over2 / n,
        groundMaxDiff: gMax,
        groundMeanDiff: gSum / gN,
      };
      rows.push(row);
      console.log(
        `bloom ${backend} ${scene}: ground mean diff=${row.groundMeanDiff.toFixed(3)} max=${gMax.toFixed(1)} frame mean=${row.frameMeanDiff.toFixed(3)} max=${max.toFixed(1)} over2=${(row.over2Fraction * 100).toFixed(3)} %`,
      );
    }
    write(`bloom-${backend}`, rows);
  }
}

await browser.close();
