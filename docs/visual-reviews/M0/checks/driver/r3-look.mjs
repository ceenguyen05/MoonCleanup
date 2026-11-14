// M0 look-polish round 3: stepped captures of URL variants, with a crop and the difference of each variant to the first.
//   node r3-look.mjs --out <dir> --tag <name> --base "scene=s06&preset=low&backend=webgpu&scale=1" \
//        --variants "plain=lights=plain;culled=" [--crop x,y,w,h] [--zoom 3] [--settle 30]
// Per variant: full frame `<tag>-<variant>.png`, optional crop `<tag>-<variant>-crop.png` (nearest, xZoom), console errors.
// Difference to the first variant: mean |d luma|, max |d luma|, share of pixels over 2 and over 8 codes.
import fs from "node:fs";
import path from "node:path";
import { launch, openPage, grab, crop, writePng, lumaPlane, info, parseArgs, fx } from "./lib.mjs";

const args = parseArgs();
const out = path.resolve(args.out ?? "out-r3");
fs.mkdirSync(out, { recursive: true });
const tag = args.tag ?? "look";
const base = args.base ?? "";
const variants = (args.variants ?? "base=")
  .split(";")
  .filter((v) => v !== "")
  .map((v) => {
    const i = v.indexOf("=");
    return { name: v.slice(0, i), query: v.slice(i + 1) };
  });
const rect = args.crop ? args.crop.split(",").map(Number) : null;
const zoom = Number(args.zoom ?? 3);

const browser = await launch();
const result = {};
let first = null;
for (const variant of variants) {
  const q = [base, variant.query, "hud=0"].filter((s) => s !== "").join("&");
  const { page, errors } = await openPage(browser, q, { hook: false });
  await page.addStyleTag({ content: "#mc-overlay,#mc-perf-hud,[data-mc-ui]{display:none !important}" });
  const img = await grab(page, { settle: Number(args.settle ?? 30), file: path.join(out, `${tag}-${variant.name}.png`) });
  const meta = await info(page);
  if (rect) writePng(path.join(out, `${tag}-${variant.name}-crop.png`), crop(img, rect[0], rect[1], rect[2], rect[3], zoom));
  const plane = lumaPlane(img);
  const row = { backend: meta.look?.backend, preset: meta.look?.preset, filter: meta.look?.shadowFilter, knobs: meta.look?.knobs, errors };
  if (first === null) first = plane;
  else {
    let sum = 0;
    let max = 0;
    let over2 = 0;
    let over8 = 0;
    for (let i = 0; i < plane.length; i++) {
      const d = Math.abs(plane[i] - first[i]);
      sum += d;
      if (d > max) max = d;
      if (d > 2) over2++;
      if (d > 8) over8++;
    }
    row.diffToFirst = { mean: fx(sum / plane.length, 3), max: fx(max, 1), over2Pct: fx((over2 / plane.length) * 100, 3), over8Pct: fx((over8 / plane.length) * 100, 3) };
  }
  result[variant.name] = row;
  console.log(variant.name, JSON.stringify(row));
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(out, `r3-look-${tag}.json`), JSON.stringify({ base, variants, result }, null, 1));
