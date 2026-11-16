// node crop.mjs out.png x y w h in1.png in2.png  -> side by side crops (x2 nearest) using the repo's pngjs if present
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire("C:/Users/caseyn/Downloads/BroswerMoonSweeper/tools/screenshots/package.json");
const { PNG } = req("pngjs");
const [out, xs, ys, ws, hs, ...ins] = process.argv.slice(2); const [x, y, w, h] = [xs, ys, ws, hs].map(Number); const s = 2;
const imgs = ins.map((f) => PNG.sync.read(fs.readFileSync(f)));
const o = new PNG({ width: w * s * imgs.length + 4 * (imgs.length - 1), height: h * s });
imgs.forEach((im, k) => { for (let j = 0; j < h * s; j++) for (let i = 0; i < w * s; i++) { const si = ((y + (j / s | 0)) * im.width + x + (i / s | 0)) * 4; const di = (j * o.width + k * (w * s + 4) + i) * 4; for (let c = 0; c < 4; c++) o.data[di + c] = im.data[si + c]; } });
fs.writeFileSync(out, PNG.sync.write(o));
