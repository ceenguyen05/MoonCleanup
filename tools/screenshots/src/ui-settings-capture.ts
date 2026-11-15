// Settings captures + checks over the UI sandbox: UI size slider -> --mc-hud-scale, quality preset intent, rebinding screen
// keyboard flow, and a text crispness probe (font size and line height land on whole device pixels).
// tsx src/ui-settings-capture.ts --url http://localhost:5291 --out <dir>
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}
const baseUrl = arg("url", "http://localhost:5291").replace(/\/$/, "");
const outDir = resolve(arg("out", "output/ui-settings"));
const dprs = arg("dprs", "1,1.25,1.5,2,3").split(",").map(Number);
mkdirSync(outDir, { recursive: true });
let failures = 0;
const check = (ok: boolean, what: string): void => {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};
const open = (page: Page, q: string) => page.goto(`${baseUrl}/src/ui/dev/preview.html?uihud=1&${q}`);

// Text nodes whose font-size is not whole CSS px or whose line-height is not whole device px (tolerance 0.02 device px).
async function crispText(page: Page): Promise<{ total: number; off: number }> {
  return page.evaluate(() => {
    const dpr = window.devicePixelRatio;
    const root = document.querySelector("[data-testid^=menu-]");
    let total = 0;
    let off = 0;
    for (const el of root?.querySelectorAll("*") ?? []) {
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
      if (!hasText) continue;
      const cs = getComputedStyle(el);
      total += 1;
      const lh = parseFloat(cs.lineHeight);
      const fs = parseFloat(cs.fontSize);
      const fsOff = Math.abs(fs - Math.round(fs)) > 0.02; // font sizes step in whole CSS px (--mc-step); boxes snap to device px
      const lhOff = Number.isFinite(lh) && Math.abs(lh * dpr - Math.round(lh * dpr)) > 0.02;
      if (fsOff || lhOff) off += 1;
    }
    return { total, off };
  });
}

const browser = await chromium.launch({ headless: true });
try {
  for (const dpr of dprs) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: dpr,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const tag = String(dpr).replace(".", "_");
    for (const [name, query] of [
      ["settings", "menu=settings"],
      ["settings-ui130", "menu=settings&hudpct=130"],
    ] as const) {
      await open(page, query);
      await page.getByTestId("menu-settings").waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      const crisp = await crispText(page);
      check(
        crisp.total > 10 && crisp.off === 0,
        `dpr ${dpr} ${name}: ${crisp.total} text nodes, ${crisp.off} off-grid`,
      );
      await page.screenshot({ path: join(outDir, `${name}-dpr${tag}.png`), animations: "disabled" });
    }
    await open(page, "menu=settings");
    await page.getByTestId("settings-remap").click();
    await page.getByTestId("controls-screen").waitFor();
    await page.waitForTimeout(300);
    const crisp = await crispText(page);
    check(crisp.off === 0, `dpr ${dpr} controls: ${crisp.total} text nodes, ${crisp.off} off-grid`);
    await page.screenshot({ path: join(outDir, `controls-dpr${tag}.png`), animations: "disabled" });
    await context.close();
  }

  // Behaviour at DPR 1.
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await open(page, "menu=settings&maxpreset=high");
  await page.getByTestId("menu-settings").waitFor();
  const scaleJs = `getComputedStyle(document.getElementById("mc-ui")).getPropertyValue("--mc-hud-scale").trim()`;
  const scale = (): Promise<string> => page.evaluate(scaleJs);
  check((await scale()) === "1", "hud scale starts at 1");
  const slider = page.getByTestId("settings-hud-scale");
  await slider.focus();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(120); // the store flushes at 15 Hz and the slider is store-controlled
  }
  await page.waitForTimeout(250);
  check((await scale()) === "1.3", `slider to 130% sets --mc-hud-scale (got ${await scale()})`);
  const quality = page.getByTestId("settings-quality");
  check(
    (await quality.getByRole("radio", { name: "Ultra" }).getAttribute("aria-disabled")) === "true",
    "Ultra marked unavailable above maxPreset",
  );
  await quality.getByRole("radio", { name: "High" }).click();
  await page.waitForTimeout(200);
  check(
    (await quality.getByRole("radio", { name: "High" }).getAttribute("aria-checked")) === "true",
    "High selected via intent + quality.changed",
  );
  await quality.getByRole("radio", { name: "Ultra" }).click({ force: true });
  check(
    (await quality.getByRole("radio", { name: "Ultra" }).getAttribute("aria-checked")) !== "true",
    "Ultra click ignored",
  );

  await page.evaluate(() => {
    (window as unknown as { __keys: number }).__keys = 0;
    window.addEventListener("keydown", () => ((window as unknown as { __keys: number }).__keys += 1));
  });
  await page.getByTestId("settings-remap").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("controls-screen").waitFor();
  check(await page.evaluate(() => document.activeElement?.tagName === "H3"), "controls heading focused on open");
  const jumpKey = page.getByTestId("bind-jump-key");
  await jumpKey.focus();
  await page.keyboard.press("Enter");
  check((await jumpKey.getAttribute("data-capturing")) !== null, "Enter starts capture");
  await page.keyboard.press("KeyJ");
  check((await jumpKey.innerText()) === "J", `key J bound to Hop (got ${await jumpKey.innerText()})`);
  check(
    await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "bind-jump-key"),
    "focus stays on the button",
  );
  const interactKey = page.getByTestId("bind-interact-key");
  await interactKey.focus();
  await page.keyboard.press("Space"); // starts capture on keyup
  await page.keyboard.press("KeyJ"); // J belongs to Hop: moved
  check((await interactKey.innerText()) === "J", "taken key moves to the new action");
  check((await jumpKey.innerText()) === "Unbound", "previous owner shows Unbound");
  check(((await page.getByTestId("controls-note").innerText()) ?? "").includes("moved"), "note announces the move");
  await interactKey.press("Enter");
  await page.keyboard.press("Escape");
  check((await page.getByTestId("controls-screen").count()) === 1, "Escape cancels capture without leaving");
  await page.keyboard.press("Escape");
  check(
    (await page.getByTestId("controls-screen").count()) === 0 &&
      (await page.getByTestId("menu-settings").count()) === 1,
    "Escape returns to Settings list",
  );
  check(
    await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "settings-remap"),
    "focus returns to Remap button",
  );
  check(
    (await page.evaluate(() => (window as unknown as { __keys: number }).__keys)) === 0,
    "no keydown reached the game",
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check((await page.getByTestId("menu-settings").count()) === 0, "Escape closes Settings");
  await context.close();
} finally {
  await browser.close();
}
process.exit(failures === 0 ? 0 : 1);
