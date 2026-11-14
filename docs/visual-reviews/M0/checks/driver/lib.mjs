// Shared plumbing of the M0 visual-check drivers (M0-visual-checks): headed Chrome on the real app (Vite dev server),
// `?capture=1` stepped frames, PNG decode with pngjs, and a RUNTIME-ONLY camera / scene hook (no source edit): the page
// imports `/src/visuals/module.ts` (same module instance Vite served to the app) and wraps `VisualsModule.prototype.update`
// so a driver can set any camera pose BEFORE the rig, sky and camera-velocity updates of the frame.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REPO = "C:/Users/caseyn/Downloads/BroswerMoonSweeper";
export const BASE = process.env.MC_BASE ?? "http://localhost:5193/";
const mod = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { chromium } = await mod("tools/screenshots/node_modules/@playwright/test/index.mjs");
const pngjs = await mod("tools/screenshots/node_modules/pngjs/lib/png.js");
export const PNG = pngjs.PNG ?? pngjs.default?.PNG;

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[a.slice(2)] = "1";
      else out[a.slice(2)] = argv[++i];
    }
  }
  return out;
}

export async function launch(extraArgs = []) {
  return chromium.launch({
    headless: false,
    channel: "chrome",
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--ignore-gpu-blocklist", ...extraArgs],
  });
}

/** Opens the app with `query`, waits for readiness, installs the runtime hook. Returns { page, errors }. */
export async function openPage(browser, query, { w = 1920, h = 1080, capture = true, hook = true, timeout = 240000 } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error") errors.push(t.slice(0, 400));
    else if (m.type() === "warning" && /error|invalid|fail/i.test(t) && !/preloaded/.test(t)) errors.push("warn: " + t.slice(0, 400));
  });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message).slice(0, 400)));
  const url = `${BASE}?${query}${capture ? "&capture=1" : ""}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__mcReady === true, null, { timeout });
  if (hook) await installHook(page);
  return { page, errors, url };
}

export async function installHook(page) {
  await page.evaluate(async () => {
    if (window.__vx) return;
    // `FrameLoop` binds each module's `update` at construction, so the module method cannot be wrapped afterwards; the
    // scene's `update` is looked up per call and runs first inside `VisualsModule.update` (before rig / sky / velocity).
    const vx = (window.__vx = { pose: null, scene: null, roots: null, frames: 0, zeroVelocity: false, saved: new Map() });
    const classes = [
      [await import("/src/visuals/lookdev/s05-shadow-lab.ts"), "S05ShadowLab"],
      [await import("/src/visuals/lookdev/s01-approach.ts"), "S01Approach"],
      [await import("/src/visuals/lookdev/s06-night.ts"), "S06Night"],
      [await import("/src/visuals/lookdev/typical-worksite.ts"), "TypicalWorksite"],
    ];
    for (const [m, name] of classes) {
      const proto = m[name].prototype;
      const orig = proto.update;
      proto.update = function (dt, time) {
        vx.scene = this;
        vx.roots = this.ctx?.roots ?? this.roots;
        vx.frames++;
        const p = vx.pose;
        if (p && vx.roots) {
          const cam = vx.roots.camera;
          cam.position.set(p.position[0], p.position[1], p.position[2]);
          cam.lookAt(p.target[0], p.target[1], p.target[2]);
          if (p.fov && cam.fov !== p.fov) {
            cam.fov = p.fov;
            cam.updateProjectionMatrix();
          }
          cam.updateMatrixWorld();
        }
        return orig.call(this, dt, time);
      };
    }
    // A/B switch for the TRAA check: `zeroVelocity` makes the camera-only velocity buffer report no motion.
    const cv = await import("/src/visuals/post/camera-velocity.ts");
    const origV = cv.CameraOnlyVelocity.prototype.update;
    cv.CameraOnlyVelocity.prototype.update = function (camera) {
      origV.call(this, camera);
      if (vx.zeroVelocity) this.previous.value.copy(this.current.value);
    };
    vx.each = (fn) => vx.roots?.world.traverse(fn);
    /** mode: "real" | "unshadowed" (nothing casts) | "bare" (nothing casts, named targets hidden) */
    vx.mode = (mode, hideNames = [], hideBlobs = false) => {
      vx.each((o) => {
        if (!vx.saved.has(o)) vx.saved.set(o, { cast: o.castShadow, vis: o.visible });
        const s = vx.saved.get(o);
        o.castShadow = mode === "real" ? s.cast : false;
        let vis = s.vis;
        if (mode === "bare" && hideNames.includes(o.name)) vis = false;
        if (hideBlobs && (o.name === "mc:look-contact" || o.name === "mc:look-boulder-contact")) vis = false;
        o.visible = vis;
      });
    };
  });
  // One frame so the scene registers itself with the hook.
  await page.evaluate(() => (window.__mcStep ? window.__mcStep(1, 1 / 60).catch(() => undefined) : undefined));
}

export const step = (page, n, dt = 1 / 60) => page.evaluate(([a, b]) => window.__mcStep(a, b), [n, dt]);
export const setPose = (page, pose) => page.evaluate((p) => void (window.__vx.pose = p), pose);

/** Steps `settle` frames, waits for presentation, steps again and returns the decoded viewport screenshot. */
export async function grab(page, { settle = 6, file = null, wait = 250 } = {}) {
  if (settle > 0) await step(page, settle);
  await page.waitForTimeout(wait);
  await step(page, 2);
  const buf = await page.screenshot(file ? { path: file } : {});
  return decode(buf);
}

export function decode(buf) {
  const png = PNG.sync.read(buf);
  return { w: png.width, h: png.height, data: png.data };
}
export function readPng(file) {
  return decode(fs.readFileSync(file));
}
export function writePng(file, img) {
  const png = new PNG({ width: img.w, height: img.h });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  fs.writeFileSync(file, PNG.sync.write(png));
}
/** Crops (and optionally integer-upscales, nearest) a region. */
export function crop(img, x0, y0, w, h, zoom = 1) {
  x0 = Math.max(0, Math.min(img.w - w, Math.round(x0)));
  y0 = Math.max(0, Math.min(img.h - h, Math.round(y0)));
  const out = { w: w * zoom, h: h * zoom, data: new Uint8Array(w * zoom * h * zoom * 4) };
  for (let y = 0; y < h * zoom; y++)
    for (let x = 0; x < w * zoom; x++) {
      const si = ((y0 + Math.floor(y / zoom)) * img.w + x0 + Math.floor(x / zoom)) * 4;
      const di = (y * out.w + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = 255;
    }
  return out;
}

/** Rec.709 luma plane (Float32, 0..255) of an RGBA image. */
export function lumaPlane(img) {
  const n = img.w * img.h;
  const out = new Float32Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) out[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  return out;
}
export function bilinear(plane, w, h, x, y) {
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const i = y0 * w + x0;
  return (plane[i] * (1 - fx) + plane[i + 1] * fx) * (1 - fy) + (plane[i + w] * (1 - fx) + plane[i + w + 1] * fx) * fy;
}
export function meanRect(plane, w, h, x, y, rw, rh) {
  let s = 0;
  let n = 0;
  for (let j = Math.max(0, Math.round(y)); j < Math.min(h, Math.round(y + rh)); j++)
    for (let i = Math.max(0, Math.round(x)); i < Math.min(w, Math.round(x + rw)); i++) {
      s += plane[j * w + i];
      n++;
    }
  return n ? s / n : NaN;
}
export const project = (page, pts) => page.evaluate((ps) => ps.map((p) => window.__mcLook.project(p[0], p[1], p[2])), pts);
export const info = (page) => page.evaluate(() => ({ look: window.__mcLook?.info?.(), mc: window.__mcInfo?.() }));
export const pct = (arr, q) => {
  const a = Float64Array.from(arr).sort();
  return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN;
};
export const fx = (v, d = 1) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
