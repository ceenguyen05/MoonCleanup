// Usage: node run.mjs --out dir --lane gpu|ci --backend webgpu|webgl2 --jobs "name|query|steps;..."
import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const repo = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
const { chromium } = await import(pathToFileURL(path.join(repo, "tools/screenshots/node_modules/@playwright/test/index.mjs")).href);
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const out = path.resolve(args.out ?? "out"); fs.mkdirSync(out, { recursive: true });
const lane = args.lane ?? "gpu", backend = args.backend ?? "webgpu";
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ""));
const entryUrl = "/@fs/" + path.join(here, "entry.ts").split(path.sep).join("/");
const launch = lane === "ci"
  ? { headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] }
  : { headless: false, channel: "chrome", args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist", "--disable-frame-rate-limit"] };
const browser = await chromium.launch(launch);
const jobs = args.jobs.split(";").map((j) => { const [name, query, steps] = j.split("|"); return { name, query, steps: Number(steps ?? 20) }; });
const w = Number(args.w ?? 1280), h = Number(args.h ?? 720);
for (const job of jobs) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || (m.type() === "warning" && /error|invalid|fail/i.test(t))) errors.push(t.slice(0, 500)); });
  page.on("pageerror", (e) => errors.push("pageerror " + e.message.slice(0, 500)));
  await page.route("**/look.html*", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><script type="module" src="${entryUrl}"></script></body></html>` }));
  const url = `http://localhost:5191/look.html?${job.query}&backend=${backend}&capture=1`;
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 120000 });
    await page.evaluate((n) => window.__mcStep(n, 1 / 60), job.steps);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__mcStep(2, 1 / 60));
    const buf = await page.screenshot({ path: path.join(out, `${job.name}-${backend}.png`) });
    const info = await page.evaluate(() => ({ look: window.__mcLook?.info?.(), mc: window.__mcInfo?.() }));
    fs.writeFileSync(path.join(out, `${job.name}-${backend}.json`), JSON.stringify({ url, info, errors }, null, 1));
    console.log(job.name, backend, "errors:", errors.length, JSON.stringify(info.look?.cascades?.map((c) => c.texelM.toFixed(4))), info.mc?.drawCalls);
    for (const e of errors.slice(0, 3)) console.log("  ERR", e);
  } catch (e) { console.log(job.name, "FAIL", String(e.message).slice(0, 300)); for (const x of errors.slice(0, 3)) console.log("  ERR", x); }
  await page.close();
}
await browser.close();
