/* global window, document, Worker, requestAnimationFrame */ // evaluate bodies run in the browser
// M1 browser-only checks (software WebGL2, solo): node browser-checks.mjs <baseUrl> [soakSec]
//  (1) gamepad capture in the rebinding screen (injected navigator.getGamepads)
//  (2) persisted UI size / quality preset / binding across reload
//  (3) solo worker read-out message profile (rate, bytes, main handler cost) over a soak
// The UI store is not exposed by the app, so the dev server response of ui-store.ts is wrapped by a route handler (no
// source edit) to publish `window.__qaStore`. Exit code 1 on any failed check.
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
const base = process.argv[2];
const soak = Number(process.argv[3] ?? "30");
const args = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ headless: true, args });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const out = { checks: {}, console: [], profile: null };
page.on("console", (m) => {
  if (m.type() === "error") out.console.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => out.console.push("pageerror: " + String(e).slice(0, 300)));
const check = (name, ok, detail) => {
  out.checks[name] = { ok: Boolean(ok), detail };
  console.log(ok ? "ok  " : "FAIL", name, JSON.stringify(detail));
};
const T = 60000;

await page.route(/\/src\/app\/ui-store\.ts(\?.*)?$/, async (route) => {
  const res = await route.fetch();
  let body = await res.text();
  body = body.replace(
    /export function createUiStore\(/,
    "function __qaOrig(",
  );
  body += "\nexport function createUiStore(...a) { const s = __qaOrig(...a); globalThis.__qaStore = s; return s; }\n";
  await route.fulfill({ response: res, body });
});
// Gamepad simulation + worker read-out probe (init script, every load).
await page.addInitScript(() => {
  window.__qaPad = { pressed: new Set(), on: false };
  const pad = {
    id: "qa-pad",
    index: 0,
    connected: true,
    mapping: "standard",
    axes: [0, 0, 0, 0],
    get buttons() {
      return Array.from({ length: 17 }, (_, i) => ({ pressed: window.__qaPad.pressed.has(i), value: 0 }));
    },
  };
  navigator.getGamepads = () => (window.__qaPad.on ? [pad, null, null, null] : [null, null, null, null]);
  window.__qaRo = { n: 0, bytes: 0, handlerMs: 0, maxMs: 0, times: [] };
  const desc = Object.getOwnPropertyDescriptor(Worker.prototype, "onmessage");
  if (desc?.set) {
    Object.defineProperty(Worker.prototype, "onmessage", {
      configurable: true,
      get: desc.get,
      set(fn) {
        desc.set.call(
          this,
          typeof fn === "function"
            ? (e) => {
                const d = e.data;
                if (d && typeof d === "object" && d.t === "ro") {
                  const t = performance.now();
                  fn(e);
                  const dt = performance.now() - t;
                  const r = window.__qaRo;
                  r.n++;
                  r.handlerMs += dt;
                  if (dt > r.maxMs) r.maxMs = dt;
                  r.bytes += JSON.stringify(d).length; // payload size proxy (structured clone is of the same order)
                  r.times.push(t);
                } else fn(e);
              }
            : fn,
        );
      },
    });
  }
});

const boot = async () => {
  await page.waitForFunction(() => Boolean(window.__qaStore) && typeof window.__mcGameplay === "function", null, {
    timeout: T,
  });
  await page.waitForFunction(() => Boolean(window.__mcGameplay?.().pose), null, { timeout: T });
};
const openSettings = async () => {
  await page.evaluate(() => window.__qaStore.dispatch({ type: "menus.open", surface: "settings" }));
  await page.waitForSelector('[data-testid="settings-quality"]', { timeout: 15000 });
};
const frames = (n) =>
  page.evaluate(
    (k) =>
      new Promise((res) => {
        let i = 0;
        const f = () => (++i >= k ? res(true) : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );
const ls = () =>
  page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith("mc."))));
const scaleVar = () =>
  page.evaluate(() => {
    const el = document.querySelector('[style*="--mc-hud-scale"]');
    return el ? el.style.getPropertyValue("--mc-hud-scale").trim() : "none";
  });

await page.goto(`${base}?play=1`);
await boot();
check("store-hook", true, "window.__qaStore published via route wrap");
await openSettings();
const lsBefore = await ls();

// ---- (1) gamepad capture
await page.click('[data-testid="settings-remap"]');
await page.waitForSelector('[data-testid="controls-screen"]');
const padCell = page.locator('[data-testid="bind-jump-pad"]');
const padBefore = (await padCell.innerText()).trim();
await padCell.click();
const capText = (await padCell.innerText()).trim();
check("pad-capture-prompt", capText !== padBefore, { before: padBefore, capturing: capText });
await page.evaluate(() => {
  window.__qaPad.on = true;
  window.dispatchEvent(new Event("gamepadconnected"));
});
await frames(3);
await page.evaluate(() => window.__qaPad.pressed.add(9));
await frames(4);
await page.evaluate(() => window.__qaPad.pressed.delete(9));
await frames(3);
const padAfter = (await padCell.innerText()).trim();
const note = (await page.locator('[data-testid="controls-note"]').innerText()).trim();
const stored1 = (await ls())["mc.controls.bindings"] ?? "";
check("pad-capture-binds", padAfter !== capText && padAfter !== padBefore, { before: padBefore, after: padAfter, note });
check("pad-capture-persisted-Pad9-jump", /"Pad9":"jump"/.test(stored1), stored1.slice(0, 200));
check(
  "pad-capture-no-menu-side-effect",
  await page.locator('[data-testid="controls-screen"]').isVisible(),
  "controls screen still open after pad press during capture",
);
const keyCell = page.locator('[data-testid="bind-jump-key"]');
const keyBefore = (await keyCell.innerText()).trim();
await keyCell.click();
await page.keyboard.press("KeyJ");
const keyAfter = (await keyCell.innerText()).trim();
check("key-rebind-applied", keyAfter !== keyBefore, { keyBefore, keyAfter });
await page.evaluate(() => (window.__qaPad.on = false));
await page.click('[data-testid="controls-back"]');
await page.waitForSelector('[data-testid="settings-quality"]');

// ---- (2) set UI size + quality, reload
const scaleBefore = await scaleVar();
await page.evaluate(() => window.__qaStore.dispatch({ type: "settings.set", patch: { hudScalePct: 130 } }));
const radios = await page.$$eval('[data-testid="settings-quality"] button', (bs) =>
  bs.map((b) => ({
    t: b.textContent,
    on: b.getAttribute("aria-checked") === "true",
    off: b.getAttribute("aria-disabled") === "true",
  })),
);
const pick = radios.find((r) => !r.on && !r.off);
check("quality-options", Boolean(pick), radios);
if (pick) await page.locator('[data-testid="settings-quality"] button', { hasText: pick.t }).first().click();
await page
  .waitForFunction(() => localStorage.getItem("mc.settings.hudScalePct") === "130", null, { timeout: 10000 })
  .catch(() => {});
await frames(6);
const saved = await ls();
const scaleSet = await scaleVar();
check("saved-keys", saved["mc.settings.hudScalePct"] === "130" && Boolean(saved["mc.settings.quality"]), {
  saved,
  lsBefore,
  scaleBefore,
  scaleSet,
});
await page.reload();
await boot();
const scaleAfter = await scaleVar();
check("reload-ui-size-applied", scaleAfter === scaleSet && scaleAfter !== scaleBefore, {
  scaleBefore,
  scaleSet,
  scaleAfter,
});
await openSettings();
const pct = await page.evaluate(() => window.__qaStore.getState().settings.hudScalePct);
check("reload-ui-size-store", pct === 130, pct);
const sel = await page.$$eval('[data-testid="settings-quality"] button', (bs) =>
  bs.filter((b) => b.getAttribute("aria-checked") === "true").map((b) => b.textContent),
);
check("reload-quality-selected", sel.length === 1 && sel[0] === pick?.t, {
  selected: sel,
  wanted: pick?.t,
  stored: saved["mc.settings.quality"],
});
out.infoAfterReload = await page.evaluate(() => window.__mcInfo?.());
await page.click('[data-testid="settings-remap"]');
await page.waitForSelector('[data-testid="controls-screen"]');
const pad2 = (await page.locator('[data-testid="bind-jump-pad"]').innerText()).trim();
const key2 = (await page.locator('[data-testid="bind-jump-key"]').innerText()).trim();
check("reload-binding-pad", pad2 === padAfter, { pad2, expected: padAfter });
check("reload-binding-key", key2 === keyAfter, { key2, expected: keyAfter });
const stored2 = (await ls())["mc.controls.bindings"] ?? "";
check("reload-bindings-stored", /"KeyJ":"jump"/.test(stored2) && /"Pad9":"jump"/.test(stored2), stored2.slice(0, 200));

// ---- (3) worker read-out profile (menu closed; idle then walking)
await page.evaluate(() => window.__qaStore.dispatch({ type: "menus.closeAll" }));
await frames(4);
await page.mouse.click(640, 360);
const snap = () =>
  page.evaluate(() => ({
    n: window.__qaRo.n,
    bytes: window.__qaRo.bytes,
    ms: window.__qaRo.handlerMs,
    max: window.__qaRo.maxMs,
    t: performance.now(),
  }));
const ph = async (label, secs, keys) => {
  const a = await snap();
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(secs * 1000); // fixed soak window, not a readiness wait
  for (const k of keys) await page.keyboard.up(k);
  const b = await snap();
  const dtS = (b.t - a.t) / 1000;
  const n = b.n - a.n;
  return {
    label,
    seconds: +dtS.toFixed(1),
    messages: n,
    hz: +(n / dtS).toFixed(2),
    jsonBytesPerMsg: n ? Math.round((b.bytes - a.bytes) / n) : 0,
    jsonBytesPerSec: Math.round((b.bytes - a.bytes) / dtS),
    handlerMsPerMsg: n ? +((b.ms - a.ms) / n).toFixed(4) : 0,
    handlerMsPerSec: +((b.ms - a.ms) / dtS).toFixed(4),
    maxHandlerMsSoFar: +b.max.toFixed(3),
  };
};
const idle = await ph("idle", soak / 2, []);
const walk = await ph("walking W", soak / 2, ["w"]);
const a0 = await snap();
for (let i = 0; i < 6; i++) {
  await page.keyboard.down("KeyJ"); await page.waitForTimeout(150); await page.keyboard.up("KeyJ");
  await page.keyboard.press("KeyL");
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(((soak / 2) * 1000) / 6); // fixed soak window, not a readiness wait
}
const a1 = await snap();
const aDt = (a1.t - a0.t) / 1000;
const aN = a1.n - a0.n;
const active = {
  label: "6x (J hop, L lamp, C plot card)",
  seconds: +aDt.toFixed(1),
  messages: aN,
  hz: +(aN / aDt).toFixed(2),
  jsonBytesPerMsg: aN ? Math.round((a1.bytes - a0.bytes) / aN) : 0,
  jsonBytesPerSec: Math.round((a1.bytes - a0.bytes) / aDt),
  handlerMsPerMsg: aN ? +((a1.ms - a0.ms) / aN).toFixed(4) : 0,
  handlerMsPerSec: +((a1.ms - a0.ms) / aDt).toFixed(4),
  maxHandlerMsSoFar: +a1.max.toFixed(3),
};
const gaps = await page.evaluate(() => {
  const t = window.__qaRo.times,
    g = [];
  for (let i = 1; i < t.length; i++) g.push(t[i] - t[i - 1]);
  g.sort((x, y) => x - y);
  return g.length
    ? { n: g.length, minMs: Math.round(g[0]), p50Ms: Math.round(g[g.length >> 1]), maxMs: Math.round(g[g.length - 1]) }
    : null;
});
out.profile = { idle, walk, active, gaps, totalSinceLoad: await snap() };
console.log(JSON.stringify(out.profile));
check("readout-messages-seen", idle.messages + walk.messages + active.messages > 0, { idle: idle.messages, walk: walk.messages, active: active.messages });
check("readout-rate-le-10hz", Math.max(idle.hz, walk.hz, active.hz) <= 10.5, { idle: idle.hz, walk: walk.hz, active: active.hz });

mkdirSync(new URL("../../output/browser-checks/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../output/browser-checks/result.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("console errors:", out.console.length, out.console.slice(0, 5));
await browser.close();
process.exit(Object.values(out.checks).every((c) => c.ok) ? 0 : 1);
