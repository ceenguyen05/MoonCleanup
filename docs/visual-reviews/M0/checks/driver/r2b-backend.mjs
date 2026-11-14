// M0 look-polish r2b: confirms which backend a `&backend=` page really runs and writes one frame + probe lumas.
import path from "node:path";
import { launch, openPage, grab, info, parseArgs } from "./lib.mjs";
const args = parseArgs();
const browser = await launch();
for (const q of ["scene=s05&view=post&sun=60&az=250", "scene=s01&view=a&time=noon"]) {
  const { page, errors } = await openPage(browser, `${q}&preset=medium&backend=${args.backend ?? "webgl2"}&scale=1&hud=0`, { hook: false });
  await page.addStyleTag({ content: "#mc-overlay,#mc-perf-hud,[data-mc-ui]{display:none !important}" });
  await grab(page, { settle: 30, file: path.join(path.resolve(args.out), `backend-${args.backend ?? "webgl2"}-${q.slice(6, 9)}.png`) });
  const meta = await info(page);
  console.log(q, "backend", meta.look.backend, "filter", meta.look.shadowFilter, "passes", meta.look.postPasses.join(">"), "errors", errors.length, errors.slice(0, 2));
  await page.close();
}
await browser.close();
