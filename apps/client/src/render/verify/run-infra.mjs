import { OFFSCREEN_CHROME_ARGS } from "../../offscreen-chrome-args.mjs";
// Driver of the render-infra browser checks (M1-W2-T03). Not part of the app bundle: run it by hand against a running
// client dev server (pnpm --filter @moon-cleanup/client exec vite --port 5293 --strictPort).
//
//   node run-infra.mjs --out <dir> [--port 5293] [--backends webgpu,webgl2] [--preset medium] [--parts trace,swap,infra]
//        [--cells "name|query;name|query"] [--seconds 30] [--tag <name>]
//
// trace  per cell: the dynamic-resolution read-out (`__mcDynres()`), the frame interval (p50, p95, share of frames over
//        20 ms) and the debug module's GPU window, sampled in 2 s windows for --seconds -> trace-<backend>[-tag].json.
//        The verdict line reads the last 10 s (steady state), not the climb.
// swap   `?scene=moon`: finds the day-clock time of the sun / Earth key swap, then captures the frame 0.3 s before and
//        after it (clock frozen) in two views and reports the ground luma of each -> swap-<backend>.json
// heap   `?scene=dust`: 10 s of sampled allocations by function (CDP heap profiler) -> heap-<backend>[-tag].json
// infra  `__mcRender()` (warm-up, pipelines created after warm-up, draw budget, memory ledger) after 10 s of the cell
//        -> infra-<backend>[-tag].json
//
// Headed Chrome on the real GPU, 1280 x 720, DPR 1. Playwright and pngjs come from tools/screenshots.

/* global window, requestAnimationFrame */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");
const { chromium } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);
const { PNG } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/pngjs/lib/png.js")).href
).then((m) => m.default ?? m);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const port = args.port ?? "5293";
const backends = (args.backends ?? "webgpu,webgl2").split(",");
const preset = args.preset ?? "medium";
const parts = new Set((args.parts ?? "trace").split(","));
const seconds = Number(args.seconds ?? 30);
const tag = args.tag === undefined ? "" : `-${args.tag}`;
const out = path.resolve(args.out ?? "infra-out");
fs.mkdirSync(out, { recursive: true });
const cells = (args.cells ?? "s06-pool|scene=s06&view=pool;moon-ground|scene=moon&view=ground")
  .split(";")
  .filter((c) => c !== "")
  .map((c) => {
    const [name, query] = c.split("|");
    return { name, query };
  });

const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: [
    ...OFFSCREEN_CHROME_ARGS,
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,WebGPU",
    "--ignore-gpu-blocklist",
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
  await page.waitForFunction(
    () => window.__mcReady === true && (window.__mcLook === undefined || window.__mcLook.isReady() === true),
    undefined,
    { timeout: 180_000 },
  );
  return { page, messages, url };
}

/** One window of `ms`: frame intervals, the dynres read-out and the GPU window of the debug module. */
function sampleWindow(page, ms) {
  return page.evaluate(async (windowMs) => {
    window.__mcStatsReset?.();
    const times = [];
    const start = performance.now();
    let last = start;
    await new Promise((done) => {
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (now - start >= windowMs) done(null);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    times.shift();
    times.sort((a, b) => a - b);
    const at = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0;
    const stats = window.__mcStats?.() ?? null;
    const dynres = window.__mcDynres?.() ?? null;
    return {
      frames: times.length,
      p50: at(0.5),
      p95: at(0.95),
      over20: times.filter((t) => t > 20).length / Math.max(1, times.length),
      scale: dynres?.scale ?? null,
      signal: dynres?.signal ?? null,
      dynP90: dynres?.p90Ms ?? null,
      dynTarget: dynres?.targetMs ?? null,
      steps: dynres?.steps ?? null,
      floorHint: dynres?.floorHint ?? null,
      gpuMs: stats?.gpu?.renderMs ?? null,
      gpuMeasured: stats?.gpu?.measured ?? null,
      draws: stats?.render?.drawCalls ?? null,
      triangles: stats?.render?.triangles ?? null,
    };
  }, ms);
}

const luma = (d, i) => d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722;
function meanLuma(png, x0, y0, x1, y1) {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++, n++) sum += luma(png.data, y * png.width + x);
  return sum / Math.max(1, n);
}
const write = (name, data) => fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(data, null, 2));
const f1 = (v) => (typeof v === "number" ? v.toFixed(1) : String(v));

for (const backend of backends) {
  const base = `solo=0&preset=${preset}&backend=${backend}`;

  if (parts.has("trace")) {
    const rows = [];
    for (const cell of cells) {
      const { page, messages, url } = await open(`${cell.query}&${base}`);
      const windows = [];
      const t0 = Date.now();
      while (Date.now() - t0 < seconds * 1000) {
        const w = await sampleWindow(page, 2000);
        windows.push({ atS: (Date.now() - t0) / 1000, ...w });
      }
      // Steady state: the last 10 s, without a window that holds a load stall (fewer than 20 frames in 2 s).
      const tail = windows.filter((w) => w.atS > seconds - 10 && w.frames >= 20);
      const mean = (key) => tail.reduce((s, w) => s + (w[key] ?? 0), 0) / Math.max(1, tail.length);
      const steady = {
        p50: mean("p50"),
        p95: mean("p95"),
        over20: mean("over20"),
        fps:
          1000 / Math.max(1e-6, tail.reduce((s, w) => s + 2000 / Math.max(1, w.frames), 0) / Math.max(1, tail.length)),
        scale: tail.at(-1)?.scale ?? null,
        steps: tail.at(-1)?.steps ?? null,
        stepsInTail: (tail.at(-1)?.steps ?? 0) - (tail[0]?.steps ?? 0),
      };
      const infra = await page.evaluate(() => window.__mcRender?.() ?? null);
      rows.push({ name: cell.name, url, steady, windows, infra, console: messages.slice(0, 6) });
      console.log(
        `trace ${backend} ${cell.name}: steady fps=${f1(steady.fps)} p50=${f1(steady.p50)} p95=${f1(steady.p95)} over20=${(steady.over20 * 100).toFixed(1)}% scale=${steady.scale} steps=${steady.steps} (tail ${steady.stepsInTail}) signal=${tail.at(-1)?.signal} target=${f1(tail.at(-1)?.dynTarget)}
  scale: ${windows.map((w) => w.scale).join(" ")}
  p50:   ${windows.map((w) => f1(w.p50)).join(" ")}
  gpu:   ${windows.map((w) => f1(w.gpuMs?.p50 ?? w.gpuMs?.avg ?? null)).join(" ")}
  draws=${tail.at(-1)?.draws} tris=${tail.at(-1)?.triangles} ${messages[0] ?? ""}`,
      );
      await page.close();
    }
    write(`trace-${backend}${tag}`, rows);
  }

  if (parts.has("infra")) {
    const rows = [];
    for (const cell of cells) {
      const { page, messages, url } = await open(`${cell.query}&${base}`);
      await page.waitForTimeout(10_000);
      const infra = await page.evaluate(() => window.__mcRender?.() ?? null);
      rows.push({ name: cell.name, url, infra, console: messages.slice(0, 6) });
      console.log(`infra ${backend} ${cell.name}: ${JSON.stringify(infra)} ${messages[0] ?? ""}`);
      await page.close();
    }
    write(`infra-${backend}${tag}`, rows);
  }

  // heap: sampled allocations of `?scene=dust` over 10 s of strokes, attributed by function (CDP sampling heap profiler,
  // objects already collected included) -> heap-<backend>.json. Answers who allocates per atlas pass.
  if (parts.has("heap")) {
    const { page, messages } = await open(`scene=dust&${base}`);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    const read = () =>
      page.evaluate(() => ({
        frames: window.__mcInfo?.() === undefined ? null : (window.__mcRender?.()?.drawBudget?.frames ?? null),
        atlas: window.__mcLook?.info?.().dustAtlas ?? null,
        feed: window.__mcLook?.info?.().dustFeed ?? null,
      }));
    const before = await read();
    await cdp.send("HeapProfiler.startSampling", {
      samplingInterval: 256,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    await page.waitForTimeout(10_000);
    const { profile } = await cdp.send("HeapProfiler.stopSampling");
    const after = await read();
    const byFunction = new Map();
    const byGroup = { three: 0, dust: 0, render: 0, other: 0 };
    let total = 0;
    const walk = (node, stack) => {
      const f = node.callFrame;
      const file = (f.url ?? "").split("?")[0].split("/").slice(-2).join("/");
      const key = `${f.functionName || "(anonymous)"} @ ${file}:${f.lineNumber}`;
      const here = [...stack, key];
      if (node.selfSize > 0) {
        total += node.selfSize;
        const entry = byFunction.get(key) ?? { bytes: 0, via: here.slice(-5, -1).join(" < ") };
        entry.bytes += node.selfSize;
        byFunction.set(key, entry);
        const url = f.url ?? "";
        const group = /three/i.test(url)
          ? "three"
          : url.includes("/visuals/dust/")
            ? "dust"
            : url.includes("/render/")
              ? "render"
              : "other";
        byGroup[group] += node.selfSize;
      }
      for (const child of node.children ?? []) walk(child, here);
    };
    walk(profile.head, []);
    const top = [...byFunction.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .slice(0, 30)
      .map(([fn, v]) => ({ fn, bytes: v.bytes, via: v.via }));
    const frames = (after.frames ?? 0) - (before.frames ?? 0);
    write(`heap-${backend}${tag}`, { before, after, frames, total, byGroup, top, console: messages.slice(0, 4) });
    console.log(
      `heap ${backend}: frames=${frames} total=${total} B (${(total / Math.max(1, frames)).toFixed(0)} B/frame) groups=${JSON.stringify(byGroup)}\n` +
        top
          .slice(0, 14)
          .map((t) => `  ${String(t.bytes).padStart(8)} ${t.fn}`)
          .join("\n"),
    );
    console.log(`  atlas before=${JSON.stringify(before.atlas)}\n  atlas after=${JSON.stringify(after.atlas)}`);
    await page.close();
  }

  if (parts.has("swap")) {
    const rows = [];
    for (const view of ["ground", "rim"]) {
      const { page, messages } = await open(`scene=moon&view=${view}&${base}&tod=1790&todrate=0&dynres=off`);
      await page.waitForTimeout(2500);
      const modeAt = async (t) => {
        await page.evaluate((timeS) => window.__mcLook.set({ dayTimeS: timeS }), t);
        await page.waitForTimeout(120);
        return (await page.evaluate(() => window.__mcLook.info())).keyMode;
      };
      let lo = 1790;
      let hi = 1840;
      if ((await modeAt(lo)) !== "sun" || (await modeAt(hi)) === "sun") {
        rows.push({ view, error: "key swap not inside 1790..1840 s" });
        await page.close();
        continue;
      }
      while (hi - lo > 0.05) {
        const mid = (lo + hi) / 2;
        if ((await modeAt(mid)) === "sun") lo = mid;
        else hi = mid;
      }
      const row = { view, swapAtS: hi, samples: [], console: messages.slice(0, 4) };
      for (const [name, t] of [
        ["before", lo - 0.3],
        ["after", hi + 0.3],
      ]) {
        await page.evaluate((timeS) => window.__mcLook.set({ dayTimeS: timeS }), t);
        await page.waitForTimeout(700);
        const info = await page.evaluate(() => window.__mcLook.info());
        const file = path.join(out, `swap-${backend}-${view}-${name}.png`);
        const png = PNG.sync.read(await page.screenshot({ path: file }));
        row.samples.push({
          name,
          timeS: t,
          keyMode: info.keyMode,
          ev100: info.ev100,
          sunEl: info.state.sunElevationDeg,
          keyLux: info.dayClock.keyLux,
          floorLux: info.dayClock.floorLux,
          groundLuma: meanLuma(png, 0, 400, 1280, 720),
          nearLuma: meanLuma(png, 440, 600, 840, 700),
        });
      }
      rows.push(row);
      console.log(
        `swap ${backend} ${view}: at ${row.swapAtS.toFixed(2)} s ` +
          row.samples
            .map(
              (s) =>
                `${s.name} mode=${s.keyMode} ev=${s.ev100.toFixed(2)} keyLux=${f1(s.keyLux)} floorLux=${f1(s.floorLux)} ground=${f1(s.groundLuma)} near=${f1(s.nearLuma)}`,
            )
            .join(" | "),
      );
      await page.close();
    }
    write(`swap-${backend}`, rows);
  }
}

await browser.close();
