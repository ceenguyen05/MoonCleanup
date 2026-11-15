// In-game HUD captures over the UI sandbox (`preview.html?uihud=1`, store seeded like gameplay will). Native resolution at
// DPR 1 / 1.5 / 2.   tsx src/ui-hud-capture.ts --url http://localhost:5291 --out <dir>
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}
const baseUrl = arg("url", "http://localhost:5291").replace(/\/$/, "");
const outDir = resolve(arg("out", "output/ui-hud"));
const dprs = arg("dprs", "1,1.5,2").split(",").map(Number);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
let failures = 0;
try {
  for (const dpr of dprs) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: dpr,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl}/src/ui/dev/preview.html?uihud=1&online=preview`);
      await page.getByTestId("hud").waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1500);
      const path = join(outDir, `hud-dpr${String(dpr).replace(".", "_")}.png`);
      await page.screenshot({ path, animations: "disabled" });
      console.log(`ok   dpr ${dpr} -> ${path}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL dpr ${dpr}: ${String(error).split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(failures === 0 ? 0 : 1);
