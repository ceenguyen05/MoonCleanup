// node ab.mjs <outDir> <tag> <backend> "name|query;name|query" [seconds] [rounds] [shots=1]
// Interleaved A/B: every round visits every cell in order; one off-screen headed Chrome (real GPU, never throttled).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const repo = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const { chromium } = await import(pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href);
const { OFFSCREEN_CHROME_ARGS } = await import(pathToFileURL(path.join(repo, "apps/client/src/offscreen-chrome-args.mjs")).href);
const [out, tag, backend, cellsArg, secArg, roundsArg, shotsArg] = process.argv.slice(2);
const seconds = Number(secArg ?? 6);
const rounds = Number(roundsArg ?? 1);
const shots = (shotsArg ?? "1") === "1";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist", ...OFFSCREEN_CHROME_ARGS],
});
const rows = [];
const cells = cellsArg.split(";").map((c) => c.split("|"));
for (let round = 0; round < rounds; round++) {
  for (const [name, query] of cells) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const errs = [];
    page.on("console", (m) => {
      if (m.type() === "error" || /error|warn/i.test(m.text().slice(0, 40))) errs.push(m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => errs.push(String(e).slice(0, 300)));
    try {
      const url = `http://localhost:5283/?${query.includes("scene=") ? "" : "scene=moon&"}solo=0&preset=medium&backend=${backend}&${query}`;
      await page.goto(url, { waitUntil: "load", timeout: 180000 });
      await page.waitForFunction(
        () =>
          (window.__mcTerrain === undefined ? window.__mcLook !== undefined : window.__mcTerrain.info().ready === true) &&
          (window.__mcRender?.()?.warmup?.state ?? "ready") !== "warming",
        undefined,
        { timeout: 180000 },
      );
      await page.waitForTimeout(3000);
      const r = await page.evaluate(async (ms) => {
        window.__mcStatsReset?.();
        const times = [];
        let last = performance.now();
        const start = last;
        await new Promise((done) => {
          const tick = () => {
            const n = performance.now();
            times.push(n - last);
            last = n;
            if (n - start >= ms) done();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        times.shift();
        times.sort((a, b) => a - b);
        const s = window.__mcStats?.();
        const look = window.__mcLook?.info?.();
        return {
          frameP50: times[Math.floor(times.length / 2)],
          gpuP50: s?.gpu?.renderMs?.p50 ?? null,
          gpuN: s?.gpu?.renderMs?.samples ?? null,
          backend: look?.backend,
        };
      }, seconds * 1000);
      if (shots && round === 0) await page.screenshot({ path: path.join(out, `${name}-${tag}-${backend}.png`) });
      rows.push({ round, name, ...r, errs: errs.slice(0, 3) });
    } catch (e) {
      rows.push({ round, name, error: String(e).slice(0, 300), errs: errs.slice(0, 3) });
    }
    console.log(JSON.stringify(rows.at(-1)));
    fs.writeFileSync(path.join(out, `rows-${tag}-${backend}.json`), JSON.stringify(rows, null, 1));
    await page.close();
  }
}
// Summary: median GPU p50 per cell over rounds.
const byName = new Map();
for (const r of rows) if (r.gpuP50 != null) (byName.get(r.name) ?? byName.set(r.name, []).get(r.name)).push(r.gpuP50);
for (const [name, v] of byName) {
  v.sort((a, b) => a - b);
  console.log(`SUMMARY ${name}: median ${v[Math.floor(v.length / 2)].toFixed(2)} ms  runs ${v.map((x) => x.toFixed(2)).join(" ")}`);
}
await browser.close();
