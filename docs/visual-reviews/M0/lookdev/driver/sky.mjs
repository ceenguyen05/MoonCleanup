import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const require = createRequire("C:/Users/caseyn/Downloads/BroswerMoonSweeper/tools/screenshots/package.json");
const { PNG } = require("pngjs");
for (const f of process.argv.slice(2)) {
  const img = PNG.sync.read(fs.readFileSync(f)); const { width: w, height: h, data } = img;
  let worstLuma = 0, worstCh = 0, blocks = 0, dirty = 0;
  for (let by = 0; by < 170; by += 16) for (let bx = 0; bx + 16 <= w; bx += 16) {
    let sr = 0, sg = 0, sb = 0, mx = 0, bright = false;
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { const k = ((by + j) * w + bx + i) * 4; const r = data[k], g = data[k + 1], b = data[k + 2]; sr += r; sg += g; sb += b; mx = Math.max(mx, r, g, b); if (r + g + b > 60) bright = true; }
    if (bright) continue; // star, sun or Earth block
    blocks++; const l = 0.2126 * sr / 256 + 0.7152 * sg / 256 + 0.0722 * sb / 256; worstLuma = Math.max(worstLuma, l); worstCh = Math.max(worstCh, mx); if (mx > 4) dirty++;
  }
  console.log(path.basename(f), "star-free blocks", blocks, "max mean luma", worstLuma.toFixed(2), "max channel", worstCh, "blocks with channel>4:", dirty);
}
