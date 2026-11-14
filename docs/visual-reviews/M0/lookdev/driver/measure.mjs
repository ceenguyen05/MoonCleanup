// node measure.mjs --out dir --backend webgpu --preset medium  : VT-M0-16 fill probes at noon
import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const repo = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const { chromium } = await import(pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href);
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const out = path.resolve(args.out ?? "outm"); fs.mkdirSync(out, { recursive: true });
const backend = args.backend ?? "webgpu", preset = args.preset ?? "medium", lane = args.lane ?? "gpu";
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ""));
const entryUrl = "/@fs/" + path.join(here, "entry.ts").split(path.sep).join("/");
const launch = lane === "ci" ? { headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }
  : { headless: false, channel: "chrome", args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist"] };
const browser = await chromium.launch(launch);
const results = [];
for (const view of (args.views ?? "shade,shadeSlope,wall").split(",")) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.route("**/look.html*", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><script type="module" src="${entryUrl}"></script></body></html>` }));
  await page.goto(`http://localhost:5191/look.html?scene=s05&view=${view}&sun=${args.sun ?? 60}&preset=${preset}&backend=${backend}&capture=1`);
  await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 120000 });
  await page.evaluate(() => window.__mcStep(30, 1 / 60)); await page.waitForTimeout(300); await page.evaluate(() => window.__mcStep(2, 1 / 60));
  const probes = await page.evaluate(() => window.__mcLook.probes());
  const buf = await page.screenshot({ path: path.join(out, `fill-${view}-${backend}.png`) });
  const names = Object.keys(probes).filter((n) => probes[n].px.visible);
  const stats = await page.evaluate(([u, rects]) => window.__mcLook.measure(u, rects), [`data:image/png;base64,${buf.toString("base64")}`, names.map((n) => ({ x: probes[n].px.x - 8, y: probes[n].px.y - 8, w: 16, h: 16 }))]);
  names.forEach((n, i) => results.push({ view, probe: n, px: [Math.round(probes[n].px.x), Math.round(probes[n].px.y)], luma: +stats[i].luma.toFixed(1), labB: +stats[i].labB.toFixed(2), rgb: [stats[i].r, stats[i].g, stats[i].b].map((v) => Math.round(v)) }));
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(out, `fill-${backend}.json`), JSON.stringify(results, null, 1));
for (const r of results) console.log(r.view.padEnd(10), r.probe.padEnd(12), "luma", String(r.luma).padStart(6), "b*", String(r.labB).padStart(6), r.rgb.join(","));
