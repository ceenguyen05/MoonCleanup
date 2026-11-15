/* global window, document, HTMLElement */ // page.evaluate bodies run in the browser
// Solo Desk smoke (M1): node desk-smoke.mjs <baseUrl>   (dev server, ?play=1, webgl2 swiftshader)
// Teleports the presented avatar next to the Desk stand-in (dev hook), E opens the Desk, Enter buys the Holster Rig,
// Escape closes, and movement works again. Exit code 1 on any failed check.
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
const base = process.argv[2];
const args = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ headless: true, args });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const out = { checks: {}, console: [] };
page.on("console", (m) => {
  if (m.type() === "error") out.console.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => out.console.push("pageerror: " + String(e).slice(0, 300)));
const check = (name, ok, detail) => (out.checks[name] = { ok: Boolean(ok), detail });
const T = 60000;
await page.goto(`${base}?play=1&lm=500`);
await page.waitForFunction(
  () => typeof window.__mcGameplay === "function" && typeof window.__mcStations === "function",
  null,
  { timeout: T },
);
await page.waitForFunction(() => Boolean(window.__mcGameplay?.().pose), null, { timeout: T });
await page.mouse.click(480, 270); // pointer lock / focus
const pose = () => page.evaluate(() => window.__mcGameplay?.().pose);
const walked = async () => {
  const a = await pose();
  await page.keyboard.down("w");
  await page
    .waitForFunction(
      (p) => {
        const q = window.__mcGameplay?.().pose;
        return q && Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) > 0.3;
      },
      a,
      { timeout: 20000 },
    )
    .catch(() => {});
  await page.keyboard.up("w");
  const b = await pose();
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
};
const d0 = await walked();
check("walk-before", d0 > 0.3, d0);
const tp = await page.evaluate(() => {
  const d = window.__mcStations().find((s) => s.kind === "desk");
  return d ? window.__mcGameplayTeleportDir(d.x, d.y, d.z) : "no-desk";
});
check("teleport", tp === true, tp);
const deskBtn = page.locator('[data-testid="menu-requisitions_desk"]');
await page.keyboard.press("e");
await deskBtn.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
check("desk-open", await deskBtn.isVisible(), null);
const bal = () =>
  page
    .locator('[data-testid="desk-balance"]')
    .innerText()
    .catch(() => null);
const walletBefore = await bal();
const row = page.locator('[data-testid="desk-row-gear.holster_rig"]');
check("holster-row", (await row.count()) === 1, await row.count());
await row.locator("button").first().focus();
await page.keyboard.press("Enter");
await page
  // Compare like for like: `bal()` reads innerText (CSS text-transform / line breaks applied), so textContent would
  // differ from walletBefore at once and the wallet would be read before the purchase reaches the UI flush.
  .waitForFunction(
    (b) => {
      const el = document.querySelector('[data-testid="desk-balance"]');
      return el instanceof HTMLElement && el.innerText !== b;
    },
    walletBefore,
    { timeout: 15000 },
  )
  .catch(() => {});
const walletAfter = await bal();
const notices = await page
  .locator('[data-testid="hud-notices"]')
  .innerText()
  .catch(() => null);
check("wallet-changed", walletBefore !== walletAfter, { walletBefore, walletAfter });
out.notices = notices;
out.rowStatus = await row.getAttribute("data-status").catch(() => null);
mkdirSync("tools/screenshots/output/solo-smoke", { recursive: true });
await page.screenshot({ path: "tools/screenshots/output/solo-smoke/desk.png", timeout: 20000 }).catch(() => {});
await page.keyboard.press("Escape");
await deskBtn.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
check("desk-closed", !(await deskBtn.isVisible()), null);
const d1 = await walked();
check("walk-after", d1 > 0.3, d1);
await browser.close();
check("no-console-errors", out.console.length === 0, out.console);
const ok = Object.values(out.checks).every((c) => c.ok);
writeFileSync("tools/screenshots/output/solo-smoke/desk.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
process.exit(ok ? 0 : 1);
