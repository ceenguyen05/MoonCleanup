// node compare-backends.mjs <dirA> <dirB>  -> per-frame diff stats (pixels differing by > 12 in any channel, mean abs luma delta, bbox)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const { PNG } = await import(pathToFileURL(path.join(repo, "tools/screenshots/node_modules/pngjs/lib/png.js")).href).then(
  (m) => m.default ?? m,
);
const [a, b] = process.argv.slice(2);
const names = fs.readdirSync(a).filter((n) => n.endsWith(".png") && fs.existsSync(path.join(b, n)));
const rows = {};
for (const n of names) {
  const A = PNG.sync.read(fs.readFileSync(path.join(a, n)));
  const B = PNG.sync.read(fs.readFileSync(path.join(b, n)));
  let diff = 0, sum = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0; i < A.width * A.height; i++) {
    const d = Math.max(
      Math.abs(A.data[i * 4] - B.data[i * 4]),
      Math.abs(A.data[i * 4 + 1] - B.data[i * 4 + 1]),
      Math.abs(A.data[i * 4 + 2] - B.data[i * 4 + 2]),
    );
    sum += d;
    if (d > 12) {
      diff++;
      const x = i % A.width, y = (i / A.width) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  const act = n.replace(/-\d+\.png$/, "");
  (rows[act] ??= []).push({ n, diffPx: diff, meanAbs: +(sum / (A.width * A.height)).toFixed(3), bbox: diff ? [x0, y0, x1, y1] : null });
}
for (const [act, r] of Object.entries(rows)) {
  const tot = r.reduce((s, x) => s + x.diffPx, 0);
  const worst = r.reduce((m, x) => (x.diffPx > m.diffPx ? x : m), r[0]);
  console.log(act.padEnd(22), "frames", r.length, "meanDiffPx", Math.round(tot / r.length), "mean|d|", (r.reduce((s, x) => s + x.meanAbs, 0) / r.length).toFixed(3), "worst", worst.n, worst.diffPx, JSON.stringify(worst.bbox));
}
