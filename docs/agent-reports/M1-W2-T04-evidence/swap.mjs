// node swap.mjs <backend> <query> "v1,v2,..." [cycles] [windowMs]
// In-page paired A/B: swaps the terrain material between variants (__mcRegolith.swap) in short windows, so every
// variant sees the same thermal / clock state. Reports median GPU p50 per variant and the median paired delta to `plain`.
import path from "node:path";
import { pathToFileURL } from "node:url";
const repo = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const { chromium } = await import(pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href);
const { OFFSCREEN_CHROME_ARGS } = await import(pathToFileURL(path.join(repo, "apps/client/src/offscreen-chrome-args.mjs")).href);
const [backend, query, variantsArg, cyclesArg, windowArg] = process.argv.slice(2);
const variants = variantsArg.split(",").map((s) => s.replace(/\+/g, ","));
const cycles = Number(cyclesArg ?? 8);
const windowMs = Number(windowArg ?? 1500);
const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist", ...OFFSCREEN_CHROME_ARGS],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 300)); });
await page.goto(`http://localhost:5283/?scene=moon&solo=0&preset=medium&backend=${backend}&${query}`, { waitUntil: "load", timeout: 180000 });
await page.waitForFunction(() => window.__mcTerrain?.info().ready === true && window.__mcRegolith !== undefined && (window.__mcRender?.()?.warmup?.state ?? "ready") !== "warming", undefined, { timeout: 180000 });
const res = await page.evaluate(async ({ variants, cycles, windowMs }) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const measure = async () => { window.__mcStatsReset?.(); await wait(windowMs); return window.__mcStats?.()?.gpu?.renderMs?.p50 ?? null; };
  // Warm: compile every variant.
  for (const v of variants) { if (!window.__mcRegolith.swap(v)) return { error: `swap ${v} failed` }; await wait(2500); }
  const out = Object.fromEntries(variants.map((v) => [v, []]));
  for (let c = 0; c < cycles; c++) {
    const order = c % 2 === 0 ? variants : [...variants].reverse();
    for (const v of order) { window.__mcRegolith.swap(v); await wait(300); out[v].push(await measure()); }
  }
  window.__mcRegolith.swap("default");
  return out;
}, { variants, cycles, windowMs });
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
if (res.error) console.log(res.error);
else {
  for (const v of variants) {
    const d = res.plain ? med(res[v].map((x, i) => x - res.plain[i])) : NaN;
    console.log(`${v.padEnd(16)} p50 ${med(res[v]).toFixed(2)} ms  delta-vs-plain ${d.toFixed(2)} ms  runs ${res[v].map((x) => x?.toFixed(2)).join(" ")}`);
  }
}
console.log("errs", JSON.stringify(errs.slice(0, 3)));
await browser.close();
