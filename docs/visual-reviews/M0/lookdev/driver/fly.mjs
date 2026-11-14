// node fly.mjs --out dir --preset medium --backend webgpu --t 0.5 --sun 4
import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const repo = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const { chromium } = await import(pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href);
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const out = path.resolve(args.out ?? "outf"); fs.mkdirSync(out, { recursive: true });
const backend = args.backend ?? "webgpu", preset = args.preset ?? "medium", lane = args.lane ?? "gpu";
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ""));
const entryUrl = "/@fs/" + path.join(here, "entry.ts").split(path.sep).join("/");
const terrain = "/@fs/" + repo + "/assets/terrain/";
const launch = lane === "ci" ? { headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }
  : { headless: false, channel: "chrome", args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist"] };
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = []; page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); }); page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 300)));
await page.route("**/look.html*", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><script type="module" src="${entryUrl}"></script></body></html>` }));
await page.goto(`http://localhost:5191/look.html?scene=s01&view=fly:${args.t ?? 0.5}&sun=${args.sun ?? 4}&az=${args.az ?? 100}&preset=${preset}&backend=${backend}&capture=1&terrain=${encodeURIComponent(terrain)}`);
await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 120000 });
await page.waitForFunction(() => window.__mcLook?.isReady() === true, null, { timeout: 120000 });
const rows = [];
for (const on of [true, false]) {
  await page.evaluate((v) => window.__mcLook.setHorizon(v), on);
  await page.evaluate(() => window.__mcStep(40, 1 / 60)); await page.waitForTimeout(300); await page.evaluate(() => window.__mcStep(2, 1 / 60));
  const buf = await page.screenshot({ path: path.join(out, `fly-${args.t ?? 0.5}-${preset}-${backend}-horizon${on ? "On" : "Off"}.png`) });
  const url = `data:image/png;base64,${buf.toString("base64")}`;
  const rects = []; for (let y = 200; y < 600; y += 6) rects.push({ x: 560, y, w: 160, h: 6 });
  const stats = await page.evaluate(([u, r]) => window.__mcLook.measure(u, r), [url, rects]);
  rows.push({ horizon: on, profile: stats.map((s, i) => [rects[i].y, +s.luma.toFixed(1)]) });
}
console.log("errors", errors.length, errors.slice(0, 2).join(" | "));
for (const r of rows) { let worst = 0, at = 0; for (let i = 1; i < r.profile.length; i++) { const d = Math.abs(r.profile[i][1] - r.profile[i - 1][1]); if (d > worst) { worst = d; at = r.profile[i][0]; } } console.log("horizon", r.horizon, "max row step", worst.toFixed(1), "at y", at); }
fs.writeFileSync(path.join(out, `fly-${args.t ?? 0.5}-${preset}-${backend}.json`), JSON.stringify({ rows, errors }, null, 1));
await browser.close();
