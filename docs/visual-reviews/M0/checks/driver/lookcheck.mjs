// Look regression check after a lighting change (M0-visual-checks): the calibration numbers that must not move.
//   node lookcheck.mjs --out <dir> [--preset medium] [--backend webgpu] [--tag after]
// S02 (noon): chart chips 0.10 / 0.33 / 0.80 and the grime / clean chips (targets 126 / 181 / 213 +-8, ratio >= 1.5).
// S05 (sun 60): flat lit and flat shadow probes (VT-M0-16 fill: 182 +-8 and 81-97), slope and wall probes.
// Also writes `?debug=cascades` frames of S05 (VT-M0-03 debug view) when --debug 1.
import fs from "node:fs";
import path from "node:path";
import { launch, openPage, step, info, parseArgs, fx } from "./lib.mjs";

const args = parseArgs();
const out = path.resolve(args.out ?? "out-look");
fs.mkdirSync(out, { recursive: true });
const preset = args.preset ?? "medium";
const backend = args.backend ?? "webgpu";
const tag = `${args.tag ?? "after"}-${preset}-${backend}`;
const result = { preset, backend };
const browser = await launch();

const shoot = async (page, file) => {
  await step(page, 30);
  await page.waitForTimeout(300);
  await step(page, 3);
  await page.addStyleTag({ content: "#mc-overlay,#mc-perf-hud,[data-mc-ui]{display:none !important}" });
  const buf = await page.screenshot({ path: file });
  return `data:image/png;base64,${buf.toString("base64")}`;
};

{
  const { page, errors } = await openPage(browser, `scene=s02&preset=${preset}&backend=${backend}&hud=0`, { hook: false });
  const url = await shoot(page, path.join(out, `s02-${tag}.png`));
  result.s02 = await page.evaluate(async (u) => {
    const dev = window.__mcLookdev;
    const look = window.__mcLook;
    if (!dev || !look) return { error: "no __mcLookdev / __mcLook" };
    const p = dev.probes();
    const ids = Object.keys(p.chips);
    const stats = await look.measure(u, ids.map((id) => p.chips[id]));
    const chips = {};
    ids.forEach((id, i) => (chips[id] = +stats[i].luma.toFixed(1)));
    return { chips, facts: p.facts ?? null };
  }, url);
  result.s02.errors = errors;
  console.log("s02", JSON.stringify(result.s02));
  await page.close();
}

for (const view of ["shade", "shadeSlope", "wall"]) {
  const { page, errors } = await openPage(browser, `scene=s05&view=${view}&sun=60&preset=${preset}&backend=${backend}&hud=0`, { hook: false });
  const url = await shoot(page, path.join(out, `s05-${view}-${tag}.png`));
  const probes = await page.evaluate(async (u) => {
    const look = window.__mcLook;
    const pr = look.probes();
    const names = Object.keys(pr).filter((n) => pr[n].px.visible);
    const stats = await look.measure(u, names.map((n) => ({ x: pr[n].px.x - 8, y: pr[n].px.y - 8, w: 16, h: 16 })));
    const o = {};
    names.forEach((n, i) => (o[n] = { luma: +stats[i].luma.toFixed(1), labB: +stats[i].labB.toFixed(2) }));
    return o;
  }, url);
  (result.s05 ??= {})[view] = probes;
  if (errors.length) (result.s05errors ??= []).push(...errors);
  console.log("s05", view, JSON.stringify(probes));
  await page.close();
}

if (args.debug === "1") {
  for (const [name, q] of [
    ["s05-wide", "scene=s05&view=wide&sun=60"],
    ["typical-wide", "scene=typical&view=wide"],
  ]) {
    const { page, errors } = await openPage(browser, `${q}&preset=${preset}&backend=${backend}&scale=1&hud=0&debug=cascades`, { hook: false });
    await shoot(page, path.join(out, `debug-cascades-${name}-${preset}-${backend}.png`));
    const meta = await info(page);
    (result.debug ??= []).push({ name, knobs: meta.look.knobs, cascades: meta.look.cascades.map((c) => [fx(c.texelM * 100, 1), fx(c.endM, 1)]), errors });
    console.log("debug", name, meta.look.knobs, "errors", errors.length, errors.slice(0, 2));
    await page.close();
  }
}
fs.writeFileSync(path.join(out, `lookcheck-${tag}.json`), JSON.stringify(result, null, 1));
await browser.close();
