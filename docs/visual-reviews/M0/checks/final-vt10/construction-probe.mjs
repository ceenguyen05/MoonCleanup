import { pathToFileURL } from "node:url";
const lib = await import(pathToFileURL("C:/Users/caseyn/Downloads/BroswerMoonSweeper/docs/visual-reviews/M0/checks/driver/lib.mjs").href);
const { launch, decode, lumaPlane, fx } = lib;
const { chromium } = await import(pathToFileURL("C:/Users/caseyn/Downloads/BroswerMoonSweeper/tools/screenshots/node_modules/@playwright/test/index.mjs").href);
const BASE = "http://127.0.0.1:5185/";
const dprs = (process.argv[2] ?? "1,1.5,2").split(",").map(Number);
const label = process.env.LABEL ?? "run";
const W = "#ffffff";
// horizontal variants: [name, html style on the line element]
const H = {
  box: `height:var(--mc-px);background:${W}`,
  border: `height:0;border-top:var(--mc-px) solid ${W}`,
  grad: `height:1px;background:linear-gradient(${W} 0 var(--mc-px),transparent var(--mc-px))`,
  inset: `height:1px;box-shadow:inset 0 var(--mc-px) 0 ${W}`,
  boxShadowRing: `height:0;box-shadow:0 0 0 calc(var(--mc-px) / 2) ${W}`,
};
const V = {
  box: `width:var(--mc-px);height:20px;background:${W}`,
  border: `width:0;height:20px;border-left:var(--mc-px) solid ${W}`,
  grad: `width:1px;height:20px;background:linear-gradient(90deg,${W} 0 var(--mc-px),transparent var(--mc-px))`,
  inset: `width:1px;height:20px;box-shadow:inset var(--mc-px) 0 0 ${W}`,
};
const browser = process.env.HEADLESS
  ? await chromium.launch({ headless: true, channel: "chrome", args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist"] })
  : await launch(["--disable-frame-rate-limit", ...(process.env.EXTRA ? process.env.EXTRA.split(" ") : [])]);
for (const dpr of dprs) {
  const [w, h] = dpr === 1 ? [1920, 1080] : dpr === 2 ? [1280, 800] : [1280, 720];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  await page.goto(`${BASE}?scene=hud-test&preset=low&scale=floor&backend=webgpu&uimotion=reduced`);
  await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 240000 });
  await page.waitForSelector('[data-testid="hud-test"]');
  await page.waitForTimeout(2500);
  const names = await page.evaluate(([H, V]) => {
    const root = document.getElementById("mc-ui");
    const back = document.createElement("div");
    back.id = "exp-back";
    back.style.cssText = "position:fixed;left:960px;top:200px;width:480px;height:480px;background:#10161e;z-index:99999;pointer-events:none";
    root.appendChild(back);
    const out = [];
    let i = 0;
    for (const [n, st] of Object.entries(H)) {
      const el = document.createElement("div");
      el.dataset.exp = "h:" + n;
      el.style.cssText = `position:absolute;left:16px;top:${16 + i * 24}px;width:200px;${st}`;
      back.appendChild(el);
      out.push("h:" + n);
      i++;
    }
    i = 0;
    for (const [n, st] of Object.entries(V)) {
      const el = document.createElement("div");
      el.dataset.exp = "v:" + n;
      el.style.cssText = `position:absolute;left:${264 + i * 24}px;top:16px;${st}`;
      back.appendChild(el);
      out.push("v:" + n);
      i++;
    }
    return out;
  }, [H, V]);
  await page.waitForTimeout(400);
  const boxes = await page.evaluate(() => [...document.querySelectorAll("[data-exp]")].map((e) => { const r = e.getBoundingClientRect(); const d = window.devicePixelRatio; return { n: e.dataset.exp, x: r.left * d, y: r.top * d, w: r.width * d, h: r.height * d }; }));
  const img = decode(await page.screenshot());
  const lp = lumaPlane(img);
  const prof = [];
  for (const b of boxes) {
    const horiz = b.n.startsWith("h:");
    const x0 = Math.round(b.x), y0 = Math.round(b.y);
    const vals = [];
    if (horiz) {
      for (let y = y0 - 2; y <= y0 + 4; y++) { let s = 0; const xa = x0 + 20, xb = x0 + 120; for (let x = xa; x < xb; x++) s += lp[y * img.w + x]; vals.push(Math.round(s / (xb - xa))); }
    } else {
      for (let x = x0 - 2; x <= x0 + 4; x++) { let s = 0; const ya = y0 + 4, yb = y0 + 14; for (let y = ya; y < yb; y++) s += lp[y * img.w + x]; vals.push(Math.round(s / (yb - ya))); }
    }
    prof.push(`${b.n.padEnd(14)} ${JSON.stringify(vals)}`);
  }
  console.log(`== ${label} dpr ${dpr} (${img.w}x${img.h})\n` + prof.join("\n"));
  await ctx.close();
}
await browser.close();
