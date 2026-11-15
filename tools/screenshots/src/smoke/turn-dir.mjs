/* global document, requestAnimationFrame */
// Turn direction probe: node turn-dir.mjs <baseUrl> <query>. Moves mouse right then left in small steps, reports feature shift.
import { chromium } from "@playwright/test";
const [base, query] = process.argv.slice(2);
const b = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await b.newPage({ viewport: { width: 960, height: 540 } });
await page.goto(`${base}?${query}`);
await page.waitForTimeout(6000);
const prof = () =>
  page.evaluate(async () => {
    const c = document.querySelector("canvas");
    const w = 240,
      h = 135;
    const t = document.createElement("canvas");
    t.width = w;
    t.height = h;
    const g = t.getContext("2d");
    await new Promise((r) => requestAnimationFrame(r));
    g.drawImage(c, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const cols = new Array(w).fill(0);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        cols[x] += d[i] + d[i + 1] + d[i + 2];
      }
    return cols;
  });
const shift = (a, c) => {
  let best = 0,
    bs = Infinity;
  for (let s = -12; s <= 12; s++) {
    let e = 0;
    for (let x = 20; x < 220; x++) {
      const d = a[x] - c[x + s];
      e += d * d;
    }
    if (e < bs) {
      bs = e;
      best = s;
    }
  }
  return best;
};
await page.mouse.move(480, 270);
await page.mouse.click(480, 270);
await page.waitForTimeout(500);
const res = [];
let x0 = 480;
for (const dx of [4, 4, -4, -4]) {
  const a = await prof();
  for (let i = 0; i < 5; i++) {
    x0 += dx;
    await page.mouse.move(x0, 270);
  }
  await page.waitForTimeout(400);
  const c = await prof();
  res.push({ dx, shift: shift(a, c) });
}
console.log(query, JSON.stringify(res), "(shift>0 => content moved left => camera turned right)");
await b.close();
