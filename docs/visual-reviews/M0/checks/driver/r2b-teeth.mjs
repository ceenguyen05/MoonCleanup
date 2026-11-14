// M0 look-polish r2b: far-cascade edge on the S05 ramp (canopy shadow), kernel A/B. Crops x4 around the serrated edge.
//   node r2b-teeth.mjs --out <dir> [--variants new,pcf3all,before]
import path from "node:path";
import fs from "node:fs";
import { launch, openPage, grab, crop, writePng, parseArgs } from "./lib.mjs";
const args = parseArgs();
const out = path.resolve(args.out ?? "out-teeth");
fs.mkdirSync(out, { recursive: true });
const V = { before: "&shadowfilter=tent4&pcf=1.5", new: "", tent4r1: "&shadowfilter=tent4", pcf3all: "&shadowfilter=pcf3", near2: "&shadowfilter0=pcf3" };
const browser = await launch();
for (const v of (args.variants ?? "new,pcf3all,before").split(",")) {
  const { page, errors } = await openPage(browser, `scene=s05&view=slope&sun=60&preset=medium&backend=webgpu&scale=1&hud=0${V[v]}`, { hook: false });
  await page.addStyleTag({ content: "#mc-overlay,#mc-perf-hud,[data-mc-ui]{display:none !important}" });
  const img = await grab(page, { settle: 30 });
  writePng(path.join(out, `teeth-${v}.png`), crop(img, 860, 480, 240, 130, 4));
  console.log(v, "errors", errors.length);
  await page.close();
}
await browser.close();
