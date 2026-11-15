// `?hud=1` text overlay (#mc-overlay, app/overlay.ts) vs the HUD panels of the full app (`?scene=hud-test&hud=1`): measures
// bounding boxes and fails when any HUD panel intersects the overlay, at several viewports and DPRs. Also saves a PNG per case.
//   tsx src/ui-hud-overlap.ts --url http://localhost:5291 --out <dir>
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}
const baseUrl = arg("url", "http://localhost:5291").replace(/\/$/, "");
const outDir = resolve(arg("out", "output/ui-hud-overlap"));
mkdirSync(outDir, { recursive: true });

const CASES = [
  { w: 1280, h: 720, dpr: 1 },
  { w: 1280, h: 720, dpr: 1.5 },
  { w: 1920, h: 1080, dpr: 1 },
  { w: 1920, h: 1080, dpr: 2 },
  { w: 960, h: 540, dpr: 2 },
];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
let failures = 0;
try {
  for (const c of CASES) {
    const context = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: c.dpr });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/?scene=hud-test&hud=1`);
    await page.getByTestId("hud-test").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    // A string expression: tsx's keepNames helper (`__name`) does not exist in the page.
    const rects = (await page.evaluate(`(() => {
      const box = (el) => {
        if (el === null) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const overlay = box(document.getElementById("mc-overlay"));
      const dock = box(document.querySelector("[data-testid=online-launcher], [data-testid=online-chip]"));
      const panels = [...document.querySelectorAll("[data-testid=hud-test] header, [data-testid=hud-test] aside, [data-testid=hud-test] section")]
        .map((el) => ({ label: el.getAttribute("aria-label") || el.tagName, rect: box(el) }))
        .filter((p) => p.rect !== null && p.rect.w > 0);
      return { overlay, dock, panels };
    })()`)) as {
      overlay: { x: number; y: number; w: number; h: number } | null;
      dock: { x: number; y: number; w: number; h: number } | null;
      panels: { label: string; rect: { x: number; y: number; w: number; h: number } | null }[];
    };
    type Rect = { x: number; y: number; w: number; h: number };
    const hitBy = (o: Rect | null, what: string): string[] =>
      o === null
        ? [`${what} missing`]
        : rects.panels
            .filter((p) => {
              const r = p.rect!;
              return r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y;
            })
            .map((p) => `${p.label} x ${what}`);
    const o = rects.overlay;
    const hits = [...hitBy(o, "debug overlay"), ...hitBy(rects.dock, "online dock")];
    const tag = `${c.w}x${c.h}@${c.dpr}`;
    console.log(
      `${hits.length === 0 ? "ok  " : "FAIL"} ${tag} overlay=${JSON.stringify(o)} ${hits.length ? "overlaps: " + hits.join(", ") : ""}`,
    );
    if (hits.length > 0) failures += 1;
    // Software WebGL2 renders the canvas slowly; the screenshot waits for a frame, so give it room (PNG is a bonus).
    await page
      .screenshot({ path: join(outDir, `${tag.replace(".", "_")}.png`), timeout: 150_000 })
      .catch(() => console.warn(`no screenshot for ${tag} (renderer too slow)`));
    await context.close();
  }
} finally {
  await browser.close();
}
process.exit(failures === 0 ? 0 : 1);
