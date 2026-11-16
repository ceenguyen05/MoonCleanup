// Terrain GPU cost driver (M1-W2-T01 round 4). Not part of the app bundle: run it by hand against a running client dev
// server (pnpm --filter @moon-cleanup/client exec vite --port 5193 --strictPort).
//
//   node run-perf.mjs --out <dir> [--port 5193] [--backend webgpu] [--preset medium] [--repeat 2] [--seconds 8]
//        [--cells "name|query;name|query"] [--tag <name>]
//
// Per cell (repeated `--repeat` times, interleaved so drift from other load on the machine hits every cell alike): waits
// for the terrain, settles 3 s, then samples `--seconds` of frames: frame interval p50 / p95, the debug module's GPU
// window (WebGPU timestamps), `__mcTerrain.info()` (nodes per level, triangles, caster instances and overflow, select
// ms) and `__mcRender()` warm-up read-out. Writes perf[-tag].json and prints one line per run.
// Headed Chrome on the real GPU, 1280 x 720, DPR 1. Playwright comes from tools/screenshots.

/* global window, requestAnimationFrame */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");
const { chromium } = await import(
  pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href
);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const port = args.port ?? "5193";
const backend = args.backend ?? "webgpu";
const preset = args.preset ?? "medium";
const repeat = Number(args.repeat ?? 2);
const seconds = Number(args.seconds ?? 8);
const tag = args.tag === undefined ? "" : `-${args.tag}`;
const out = path.resolve(args.out ?? "terrain-perf-out");
fs.mkdirSync(out, { recursive: true });
const cells = (args.cells ?? "ground|view=ground&scale=0.85&dynres=off")
  .split(";")
  .filter((c) => c !== "")
  .map((c) => {
    const [name, query] = c.split("|");
    return { name, query };
  });

const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  // Headed for real GPU timing, but off-screen and never throttled (no popups on the owner's desktop).
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,WebGPU",
    "--ignore-gpu-blocklist",
    "--window-position=-32000,-32000",
    "--window-size=1280,720",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
  ],
});

const runs = [];
const f1 = (v) => (typeof v === "number" ? v.toFixed(1) : String(v));
for (let r = 0; r < repeat; r++) {
  for (const cell of cells) {
    const url = `http://localhost:${port}/?scene=moon&solo=0&preset=${preset}&backend=${backend}&${cell.query}`;
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const messages = [];
    page.on("console", (m) => {
      if (m.type() === "error") messages.push(`${m.type()}: ${m.text().slice(0, 300)}`);
    });
    page.on("pageerror", (e) => messages.push(`pageerror: ${String(e).slice(0, 300)}`));
    let row;
    try {
      await page.goto(url, { waitUntil: "load", timeout: 120_000 });
      await page.waitForFunction(() => window.__mcTerrain?.info().ready === true, undefined, { timeout: 120_000 });
      await page.waitForTimeout(3000);
      row = await page.evaluate(async (windowMs) => {
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
        const render = window.__mcRender?.() ?? null;
        return {
          frames: times.length,
          p50: at(0.5),
          p95: at(0.95),
          over20: times.filter((t) => t > 20).length / Math.max(1, times.length),
          gpu: stats?.gpu ?? null,
          draws: stats?.render?.drawCalls ?? null,
          triangles: stats?.render?.triangles ?? null,
          terrain: window.__mcTerrain.info(),
          warmup: render?.warmup ?? render?.pipelineWarmup ?? null,
        };
      }, seconds * 1000);
      if (r === 0) await page.screenshot({ path: path.join(out, `${cell.name}${tag}.png`) });
    } catch (e) {
      row = { error: String(e).slice(0, 400) };
    }
    runs.push({ run: r, name: cell.name, url, ...row, console: messages.slice(0, 4) });
    const t = row.terrain;
    console.log(
      `${cell.name}#${r}: gpu p50=${f1(row.gpu?.renderMs?.p50)} p95=${f1(row.gpu?.renderMs?.p95)} frame p50=${f1(row.p50)} p95=${f1(row.p95)} over20=${f1((row.over20 ?? 0) * 100)}% tris=${row.triangles} nodes=${t?.nodes} perLevel=${t?.perLevel?.join(",")} casters=${t?.shadowPerCascade?.join(",")} casterOverflow=${t?.casterOverflow?.join?.(",")} select=${f1(t?.selectMs?.p95)}/${f1(t?.casterSelectMs?.p95)} ${row.error ?? ""} ${messages[0] ?? ""}`,
    );
    await page.close();
  }
}
fs.writeFileSync(path.join(out, `perf${tag}.json`), JSON.stringify(runs, null, 2));
await browser.close();
