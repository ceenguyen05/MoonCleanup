// node griddiff.mjs a.json b.json : per-block luma / rgb difference of two shot.mjs sidecars
import fs from "node:fs";
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")).grid);
let maxL = 0, sumL = 0, maxC = 0, at = -1;
a.forEach((p, i) => {
  const q = b[i]; const dl = Math.abs(p[0] - q[0]); const dc = Math.max(Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]), Math.abs(p[3] - q[3]));
  sumL += dl; if (dl > maxL) { maxL = dl; at = i; } if (dc > maxC) maxC = dc;
});
console.log(`blocks ${a.length} | mean |dLuma| ${(sumL / a.length).toFixed(2)} | max |dLuma| ${maxL.toFixed(2)} (block ${at}, row ${Math.floor(at / 12)} col ${at % 12}) | max |dRGB| ${maxC.toFixed(1)} codes`);
