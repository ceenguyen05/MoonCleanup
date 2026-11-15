// Menu captures + keyboard / gamepad-nav checks over the UI sandbox (`preview.html?uihud=1&menu=...`).
// tsx src/ui-menus-capture.ts --url http://localhost:5291 --out <dir>
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}
const baseUrl = arg("url", "http://localhost:5291").replace(/\/$/, "");
const outDir = resolve(arg("out", "output/ui-menus"));
const dprs = arg("dprs", "1,1.5,2").split(",").map(Number);
mkdirSync(outDir, { recursive: true });
const SHOTS = [
  ["desk-1slot", "menu=desk&slots=1", "menu-requisitions_desk"],
  ["desk-rig", "menu=desk", "menu-requisitions_desk"],
  ["console", "menu=console", "menu-ops_console"],
  ["settings", "menu=settings", "menu-settings"],
  ["hud-compass-plot", "", "hud"],
] as const;
const open = (page: Page, q: string) => page.goto(`${baseUrl}/src/ui/dev/preview.html?uihud=1&${q}`);
let failures = 0;
const check = (ok: boolean, what: string): void => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};
const browser = await chromium.launch({ headless: true });
try {
  for (const dpr of dprs) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: dpr,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    for (const [name, query, testId] of SHOTS) {
      await open(page, query);
      await page.getByTestId(testId).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      const path = join(outDir, `${name}-dpr${String(dpr).replace(".", "_")}.png`);
      await page.screenshot({ path, animations: "disabled" });
      console.log(`ok   ${name} dpr ${dpr}`);
    }
    await context.close();
  }
  // Keyboard flow at DPR 1.
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.evaluate(() => undefined);
  await open(page, "menu=desk&slots=1");
  await page.getByTestId("menu-requisitions_desk").waitFor();
  const leaks = await page.evaluate(() => {
    (window as unknown as { __keys: number }).__keys = 0;
    window.addEventListener("keydown", () => ((window as unknown as { __keys: number }).__keys += 1));
  });
  void leaks;
  check(await page.evaluate(() => document.activeElement?.tagName === "H2"), "dialog heading focused on open");
  await page.keyboard.press("ArrowDown");
  check(await page.evaluate(() => document.activeElement?.tagName === "BUTTON"), "ArrowDown moves focus to a control");
  for (let i = 0; i < 6; i += 1) await page.keyboard.press("ArrowDown");
  check(
    await page.evaluate(() => !!document.activeElement?.closest("[data-mc-nav-root]")),
    "focus stays inside the dialog",
  );
  for (let i = 0; i < 12; i += 1) await page.keyboard.press("Tab");
  check(await page.evaluate(() => !!document.activeElement?.closest("[data-mc-nav-root]")), "Tab is trapped");
  // Buy the Crescent Squeegee with Enter: focus its row button.
  await page.getByTestId("desk-row-tool.crescent_squeegee").getByRole("button").focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  check(
    (await page.getByTestId("desk-row-tool.crescent_squeegee").getAttribute("data-status")) === "owned",
    "Enter requisitions the focused item (row becomes Owned)",
  );
  check(
    (await page.evaluate(() => (window as unknown as { __keys: number }).__keys)) === 0,
    "no keydown reached the game",
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check((await page.getByTestId("menu-requisitions_desk").count()) === 0, "Escape closes the menu");
  await context.close();
} finally {
  await browser.close();
}
process.exit(failures === 0 ? 0 : 1);
