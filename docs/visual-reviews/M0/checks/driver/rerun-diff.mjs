// Final re-run: whole-frame luma diff of final-rerun/scenes vs final/ (pre round 3), and x3 comb / pool crops.
import fs from "node:fs";
import { readPng, lumaPlane, crop, writePng, fx } from "./lib.mjs";
const A = "../final", B = "../final-rerun/scenes";
fs.mkdirSync(`${B}/crops`, { recursive: true });
for (const f of fs.readdirSync(B).filter((n) => n.endsWith(".png") && fs.existsSync(`${A}/${n}`))) {
  const a = readPng(`${A}/${f}`), b = readPng(`${B}/${f}`);
  const la = lumaPlane(a), lb = lumaPlane(b);
  let s = 0, o8 = 0, mx = 0;
  for (let i = 0; i < la.length; i++) { const d = Math.abs(la[i] - lb[i]); s += d; if (d > 8) o8++; if (d > mx) mx = d; }
  console.log(f, a.w + "x" + a.h, "mean", fx(s / la.length, 3), "over8%", fx((100 * o8) / la.length, 3), "max", fx(mx, 0));
}
for (const cell of ["low-webgpu", "medium-webgpu", "low-webgl2"]) {
  for (const [dir, tag] of [[A, "before"], [B, "after"]]) {
    const img = readPng(`${dir}/s05-slope-sun60-${cell}.png`);
    writePng(`${B}/crops/s05-canopy-x3-${cell}-${tag}.png`, crop(img, 680, 500, 360, 110, 3));
    const pool = readPng(`${dir}/s06-pool-${cell}.png`);
    writePng(`${B}/crops/s06-pool-x2-${cell}-${tag}.png`, crop(pool, 660, 340, 600, 400, 2));
    const dawn = readPng(`${dir}/s01-a-dawn-${cell}.png`);
    writePng(`${B}/crops/s01-dawn-hab-x3-${cell}-${tag}.png`, crop(dawn, 0, 0, 1, 1, 1));
  }
}
