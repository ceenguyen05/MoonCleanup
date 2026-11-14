// M0 look-polish r2b items 3 and 7: the ground of the look scenes.
//   node r2b-ground.mjs --out <dir> --part graze|scenes|fps [--preset medium] [--backend webgpu] [--grounds regolith,standin]
// graze  (item 3) S05 at sun 4 and 1 degrees, empty lit ground (camera 1.5 m up, looking down-sun) and the `post` view, for
//        each ground: A detail fade OFF (the state before), B fade off + relief OFF (identifies the term), C fade ON (shipped).
//        Per frame: luma p1 / p5 / p50 of the frame and the share of pixels darker than half the median ("black patches").
// scenes (item 7) one frame per look scene / view on the real ground (+ S01 `a` on the stand-in), console errors, fetch facts.
// fps    (item 7) free-running frame ms of s01 / s05 / s06 on each ground (no vsync, scale = preset ceiling).
import fs from "node:fs";
import path from "node:path";
import { launch, openPage, grab, lumaPlane, setPose, info, parseArgs, pct, fx } from "./lib.mjs";

const args = parseArgs();
const out = path.resolve(args.out ?? "out-r2b-ground");
fs.mkdirSync(out, { recursive: true });
const part = args.part ?? "scenes";
const preset = args.preset ?? "medium";
const backend = args.backend ?? "webgpu";
const grounds = (args.grounds ?? "regolith,standin").split(",");
const groundQuery = (g) => (g === "standin" ? "&ground=standin" : "");
const hideUi = (page) => page.addStyleTag({ content: "#mc-overlay,#mc-perf-hud,[data-mc-ui]{display:none !important}" });
const result = { preset, backend };

/** Sets a uniform stored in `material.userData[key]` on every mesh of the scene. Returns how many materials had it. */
const setUserUniform = (page, key, value) =>
  page.evaluate(
    ([k, v]) => {
      const seen = new Set();
      window.__vx.each((o) => {
        const u = o.material?.userData?.[k];
        if (u && !seen.has(u)) {
          u.value = v;
          seen.add(u);
        }
      });
      return seen.size;
    },
    [key, value],
  );

function frameStats(img) {
  const plane = lumaPlane(img);
  const p50 = pct(plane, 0.5);
  let dark = 0;
  for (let i = 0; i < plane.length; i++) if (plane[i] < p50 * 0.5) dark++;
  return {
    p1: fx(pct(plane, 0.01)),
    p5: fx(pct(plane, 0.05)),
    p50: fx(p50),
    p95: fx(pct(plane, 0.95)),
    darkSharePct: fx((dark / plane.length) * 100, 2),
  };
}

if (part === "graze") {
  const browser = await launch();
  result.graze = {};
  for (const ground of grounds) {
    const q = `scene=s05&view=post&sun=4&az=250&preset=${preset}&backend=${backend}&scale=1&hud=0${groundQuery(ground)}`;
    const { page, errors } = await openPage(browser, q);
    await hideUi(page);
    for (const sun of [4, 1]) {
      await page.evaluate((s) => window.__mcLook.set({ sunElevationDeg: s }), sun);
      for (const [poseName, pose] of [
        ["empty", { position: [30, 1.5, -30], target: [30, 0.3, -27.5] }],
        ["post", { position: [0, 1.5, -3], target: [0, 0.5, 0] }],
      ]) {
        await setPose(page, pose);
        for (const [state, fade, bump] of [
          ["A-fadeoff", 0, 1],
          ["B-fadeoff-flat", 0, 0],
          ["C-shipped", 1, 1],
        ]) {
          const nFade = await setUserUniform(page, "mcGrazeFade", fade);
          const nBump = await setUserUniform(page, "mcBump", bump);
          const file = path.join(out, `graze-${ground}-sun${sun}-${poseName}-${state}.png`);
          const img = await grab(page, { settle: 8, file });
          const stats = { ...frameStats(img), uniforms: [nFade, nBump] };
          result.graze[`${ground}:sun${sun}:${poseName}:${state}`] = stats;
          console.log(ground, sun, poseName, state, JSON.stringify(stats));
        }
      }
    }
    result.graze[`${ground}:errors`] = errors;
    console.log(ground, "errors", errors.length, errors.slice(0, 2));
    await page.close();
  }
  await browser.close();
}

if (part === "scenes") {
  const browser = await launch();
  result.scenes = {};
  const shots = [
    ["s01-a-noon", "scene=s01&view=a&time=noon", ""],
    ["s01-a-dawn", "scene=s01&view=a&time=dawn", ""],
    ["s01-b-noon", "scene=s01&view=b&time=noon", ""],
    ["s01-wide-morning", "scene=s01&view=wide&time=morning", ""],
    ["s01-close-noon", "scene=s01&view=close&time=noon", ""],
    ["s05-wide-sun15", "scene=s05&view=wide&sun=15&az=250", ""],
    ["s05-slope-sun60", "scene=s05&view=slope&sun=60", ""],
    ["s06-pool", "scene=s06&view=pool", ""],
    ["s06-wide", "scene=s06&view=wide", ""],
    ["s01-a-noon-standin", "scene=s01&view=a&time=noon", "&ground=standin"],
  ].filter(([name]) => !args.only || args.only.split(",").includes(name));
  for (const [name, q, extra] of shots) {
    const { page, errors } = await openPage(browser, `${q}&preset=${preset}&backend=${backend}&scale=1&hud=0${extra}`, { hook: false });
    await hideUi(page);
    const img = await grab(page, { settle: 30, file: path.join(out, `${name}-${preset}-${backend}.png`) });
    const meta = await info(page);
    const probes = await page.evaluate(() => {
      const pr = window.__mcLook.probes();
      return Object.fromEntries(Object.entries(pr).map(([k, v]) => [k, v.px]));
    });
    const plane = lumaPlane(img);
    const probeLuma = {};
    for (const [k, px] of Object.entries(probes)) {
      if (!px.visible) continue;
      let s = 0;
      let n = 0;
      for (let y = Math.round(px.y) - 8; y < Math.round(px.y) + 8; y++)
        for (let x = Math.round(px.x) - 8; x < Math.round(px.x) + 8; x++)
          if (x >= 0 && y >= 0 && x < img.w && y < img.h) {
            s += plane[y * img.w + x];
            n++;
          }
      probeLuma[k] = fx(s / Math.max(1, n));
    }
    result.scenes[name] = { filter: meta.look.shadowFilter, knobs: meta.look.knobs, draws: meta.mc?.render?.calls, probeLuma, errors };
    console.log(name, JSON.stringify(result.scenes[name]));
    await page.close();
  }
  await browser.close();
}

if (part === "fps") {
  const browser = await launch(["--disable-frame-rate-limit", "--disable-gpu-vsync"]);
  result.fps = {};
  const warm = Number(args.warm ?? 6);
  const seconds = Number(args.seconds ?? 8);
  for (const scene of (args.scenes ?? "s01,s05,s06").split(",")) {
    for (const ground of grounds) {
      const q = `scene=${scene}&preset=${preset}&backend=${backend}&scale=ceil&hud=0${groundQuery(ground)}`;
      const { page, errors } = await openPage(browser, q, { capture: false, hook: false });
      await page.waitForTimeout(warm * 1000);
      await page.evaluate(() => window.__mcStatsReset());
      await page.waitForTimeout(seconds * 1000);
      const s = await page.evaluate(() => window.__mcStats());
      const row = {
        frames: s.frames,
        fps: fx(1000 / s.frameMs.avg, 1),
        frameAvg: fx(s.frameMs.avg, 2),
        frameP50: fx(s.frameMs.p50, 2),
        frameP95: fx(s.frameMs.p95, 2),
        renderScale: s.env?.renderScale,
        errors: errors.length,
      };
      result.fps[`${scene}:${ground}`] = row;
      console.log(scene, ground, JSON.stringify(row));
      await page.close();
    }
  }
  await browser.close();
}
fs.writeFileSync(path.join(out, `r2b-ground-${part}-${preset}-${backend}.json`), JSON.stringify(result, null, 1));

// band (item 3 follow-up): is the flat dark band on the left ground of S01 dawn view `a` a cast shadow? Same page, everything
// casts vs nothing casts; mean luma of the band rectangle.
if (part === "band") {
  const { meanRect } = await import("./lib.mjs");
  const browser = await launch();
  const { page, errors } = await openPage(browser, `scene=s01&view=a&time=dawn&preset=${preset}&backend=${backend}&scale=1&hud=0`);
  await hideUi(page);
  const rect = [100, 640, 600, 120];
  const out2 = {};
  for (const mode of ["real", "unshadowed"]) {
    await page.evaluate((m) => window.__vx.mode(m), mode);
    const img = await grab(page, { settle: 10, file: path.join(out, `s01-dawn-a-${mode}-${preset}-${backend}.png`) });
    out2[mode] = fx(meanRect(lumaPlane(img), img.w, img.h, ...rect));
  }
  out2.rect = rect;
  out2.errors = errors;
  console.log("band", JSON.stringify(out2));
  fs.writeFileSync(path.join(out, `r2b-ground-band-${preset}-${backend}.json`), JSON.stringify(out2, null, 1));
  await browser.close();
}
