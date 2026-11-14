// VT-M0-10 HUD crispness (M0-visual-check-final re-run): `?scene=hud-test&preset=low&scale=floor` on the real app.
//   node hud10.mjs --out <dir> [--backend webgpu] [--glass 1]
// Per display config (DPR 1 at 1920x1080 CSS; DPR 1.5 at 1280x720 CSS = a 1920x1080 window at 150 % browser zoom;
// DPR 2 at 1280x800 CSS): full screenshot (native device pixels), nearest x4 crops of text / hairlines / icons / panels,
// in-page facts (readout DPR, hairline device px, canvas scale, rests of panels on whole device px, transforms at rest),
// and the device-row luma profile across each 1 CSS-px hairline (a blurred hairline spreads over 2+ rows).
// --glass 1: free-running (no vsync) frame ms with the 4 glass panels in `blur` vs `solid`, alternating windows (DPR 1).
import fs from "node:fs";
import path from "node:path";
import { launch, parseArgs, decode, crop, writePng, lumaPlane, fx, BASE } from "./lib.mjs";

const args = parseArgs();
const out = path.resolve(args.out ?? "out-hud10");
fs.mkdirSync(out, { recursive: true });
const backend = args.backend ?? "webgpu";
const CONFIGS = [
  { name: "dpr1", w: 1920, h: 1080, dpr: 1 },
  { name: "dpr1.5", w: 1280, h: 720, dpr: 1.5 },
  { name: "dpr2", w: 1280, h: 800, dpr: 2 },
];
const result = { backend, configs: {} };
const browser = await launch(["--disable-frame-rate-limit"]);

for (const c of CONFIGS) {
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: c.dpr });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 300)));
  const url = `${BASE}?scene=hud-test&preset=low&scale=floor&backend=${backend}&uimotion=reduced`;
  await page.goto(url);
  await page.waitForFunction(() => window.__mcReady === true, null, { timeout: 240000 });
  await page.waitForSelector('[data-testid="hud-test"]');
  await page.waitForTimeout(4000); // toast in, readout interval ticked, fonts loaded
  await page.evaluate(() => document.fonts.ready);
  const facts = await page.evaluate(() => {
    const dpr = window.devicePixelRatio;
    const q = (s) => document.querySelector(s);
    const txt = (s) => q(s)?.textContent?.trim() ?? null;
    const root = q('[data-testid="hud-test"]');
    const els = [...root.querySelectorAll("*")];
    let fractional = [];
    let transforms = [];
    for (const el of els) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const isPanel = /glass|panel|wallet|bench|shine|holster|gear|compass/i.test(el.className?.toString?.() ?? "") && el.tagName !== "SPAN";
      if (isPanel) {
        const offs = [r.left, r.top, r.width, r.height].map((v) => Math.abs(v * dpr - Math.round(v * dpr)));
        if (Math.max(...offs) > 0.02) fractional.push({ cls: String(el.className).slice(0, 60), rect: [r.left, r.top, r.width, r.height].map((v) => +(v * dpr).toFixed(3)) });
      }
      if (cs.transform !== "none" && !/caret|floater|meterFill|toast/i.test(String(el.className))) transforms.push({ cls: String(el.className).slice(0, 60), t: cs.transform });
    }
    const box = (s) => {
      const e = q(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr };
    };
    const hair = [...document.querySelectorAll('[class*="hairH"]')].map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr };
    });
    const canvas = q("#mc-stage canvas");
    return {
      dpr,
      readoutDpr: txt('[data-testid="readout-dpr"]'),
      readoutHairline: txt('[data-testid="readout-hairline"]'),
      readoutCanvas: txt('[data-testid="readout-canvas-scale"]'),
      canvasBacking: canvas ? [canvas.width, canvas.height, canvas.clientWidth, canvas.clientHeight] : null,
      fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`),
      sample14Font: (() => { const e = q('[class*="sample14"]'); if (!e) return null; const cs = getComputedStyle(e); return `${cs.fontFamily} ${cs.fontSize} ${cs.fontWeight}`; })(),
      panelsOffDevicePx: fractional,
      transformsAtRest: transforms,
      boxes: { sample14: box('[class*="sample14"]'), sample22: box('[class*="sample22"]'), hairlines: box('[class*="hairlines"]'), icons: box('[class*="iconRow"]'), holster: box('[class*="holster"]'), wallet: box('[class*="wallet"]'), shine: box('[class*="shine"]'), compass: box('[class*="compass"]'), gear: box('[class*="gear"]') },
      hair,
      info: window.__mcInfo?.(),
    };
  });
  const buf = await page.screenshot({ path: path.join(out, `S12-hudtest-low-${backend}-${c.w}x${c.h}@${c.dpr}-floor.png`) });
  const img = decode(buf);
  const lp = lumaPlane(img);
  // Hairline rows: column-mean luma per device row over the middle half of each hairline, 4 rows of margin each side.
  facts.hairProfiles = facts.hair.map((b) => {
    const x0 = Math.round(b.x + b.w * 0.25);
    const x1 = Math.round(b.x + b.w * 0.75);
    const rows = [];
    for (let y = Math.floor(b.y) - 4; y <= Math.ceil(b.y + b.h) + 4; y++) {
      let s = 0;
      for (let x = x0; x < x1; x++) s += lp[y * img.w + x];
      rows.push(fx(s / Math.max(1, x1 - x0), 1));
    }
    const bg = (rows[0] + rows[rows.length - 1]) / 2;
    const peak = Math.max(...rows.map((v) => Math.abs(v - bg)));
    return { y: fx(b.y, 2), h: fx(b.h, 2), rows, rowsOverHalfPeak: rows.filter((v) => Math.abs(v - bg) > peak * 0.5).length };
  });
  facts.imagePx = [img.w, img.h];
  for (const [k, b] of Object.entries(facts.boxes)) {
    if (!b) continue;
    const cw = Math.min(Math.round(b.w) + 8, 240);
    const ch = Math.min(Math.round(b.h) + 8, 120);
    writePng(path.join(out, `crop-${k}-${c.name}-x4.png`), crop(img, b.x - 4, b.y - 4, cw, ch, 4));
  }
  facts.errors = errors;
  result.configs[c.name] = facts;
  console.log(c.name, JSON.stringify({ dpr: facts.dpr, readout: [facts.readoutDpr, facts.readoutHairline, facts.readoutCanvas], img: facts.imagePx, canvas: facts.canvasBacking, off: facts.panelsOffDevicePx.length, tr: facts.transformsAtRest.length, hair: facts.hairProfiles.map((h) => h.rowsOverHalfPeak), errors: errors.length }));

  if (args.glass === "1" && c.dpr === 1) {
    const rows = [];
    const setGlass = (v) => page.click(`[data-value="${v}"]`);
    await page.waitForTimeout(3000);
    for (let i = 0; i < 8; i++) {
      const mode = i % 2 === 0 ? "blur" : "solid";
      await setGlass(mode);
      await page.waitForTimeout(800);
      const s = await page.evaluate(
        () =>
          new Promise((res) => {
            const iv = [];
            let last = null;
            const t0 = performance.now();
            const f = (now) => {
              if (last !== null) iv.push(now - last);
              last = now;
              if (now - t0 < 6000) requestAnimationFrame(f);
              else {
                iv.sort((a, b) => a - b);
                res({ n: iv.length, mean: iv.reduce((a, b) => a + b, 0) / iv.length, p50: iv[Math.floor(iv.length / 2)], p95: iv[Math.floor(iv.length * 0.95)] });
              }
            };
            requestAnimationFrame(f);
          }),
      );
      rows.push({ mode, ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, fx(v, 2)])) });
      console.log("glass", JSON.stringify(rows.at(-1)));
    }
    const m = (mode, k) => {
      const r = rows.filter((x) => x.mode === mode);
      return fx(r.reduce((a, x) => a + x[k], 0) / r.length, 2);
    };
    result.glass = { rows, blur: { mean: m("blur", "mean"), p50: m("blur", "p50"), p95: m("blur", "p95") }, solid: { mean: m("solid", "mean"), p50: m("solid", "p50"), p95: m("solid", "p95") } };
    // The page's own probe (rAF intervals, 120 frames each) for the record.
    await page.click("text=Measure glass cost");
    await page.waitForSelector('[data-testid="glass-probe"]', { timeout: 60000 });
    result.glass.pageProbe = await page.textContent('[data-testid="glass-probe"]');
    console.log("glass", JSON.stringify(result.glass));
  }
  await ctx.close();
}
fs.writeFileSync(path.join(out, "hud10.json"), JSON.stringify(result, null, 1));
await browser.close();
