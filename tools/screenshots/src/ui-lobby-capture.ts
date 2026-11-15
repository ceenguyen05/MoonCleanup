// Lobby / online-entry UI captures over the UI sandbox (`apps/client/src/ui/dev/preview.html?online=preview`, fake port,
// no network). Native resolution PNGs at DPR 1 / 1.5 / 2: `deviceScaleFactor` emulation, viewport in CSS px, so the PNG is
// viewport x DPR device pixels and nothing is resampled. Run:
//   tsx src/ui-lobby-capture.ts --url http://localhost:5291 --out <dir> [--dprs 1,1.5,2] [--width 1280 --height 720]
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

const baseUrl = arg("url", "http://localhost:5291").replace(/\/$/, "");
const outDir = resolve(arg("out", "output/ui-lobby"));
const dprs = arg("dprs", "1,1.5,2").split(",").map(Number);
const width = Number(arg("width", "1280"));
const height = Number(arg("height", "720"));

const page_ = (query: string): string => `${baseUrl}/src/ui/dev/preview.html?${query}`;

type Shot = { readonly name: string; readonly query: string; readonly steps: (p: Page) => Promise<void> };

const openPanel = async (p: Page): Promise<void> => {
  await p.getByRole("button", { name: /Play online/ }).click();
  await p.getByTestId("online-panel").waitFor();
  await p.getByTestId("choose-private").waitFor();
};
const toPrivate = async (p: Page): Promise<void> => {
  await openPanel(p);
  await p.getByTestId("choose-private").click();
  await p.getByTestId("start-private").waitFor();
};

const SHOTS: readonly Shot[] = [
  { name: "01-launcher", query: "online=preview", steps: async () => undefined },
  {
    name: "02-choose",
    query: "online=preview",
    steps: openPanel,
  },
  {
    name: "03-private-form",
    query: "online=preview",
    steps: toPrivate,
  },
  {
    name: "04-join-busy-error",
    query: "online=preview&fail=busy",
    steps: async (p) => {
      await toPrivate(p);
      await p.getByTestId("join-code").fill("7qxk 2m9t");
      await p.getByTestId("join-private").click();
      await p.getByTestId("online-error").waitFor();
    },
  },
  {
    name: "05-join-capacity-error",
    query: "online=preview&fail=capacity",
    steps: async (p) => {
      await toPrivate(p);
      await p.getByTestId("join-code").fill("7QXK2M9T");
      await p.getByTestId("join-private").click();
      await p.getByTestId("online-error").waitFor();
    },
  },
  {
    name: "06-recovery-code",
    query: "online=preview&guest=0",
    steps: async (p) => {
      await toPrivate(p);
      await p.getByTestId("start-private").click();
      await p.getByTestId("recovery-code").waitFor();
    },
  },
  {
    name: "07-invite-created",
    query: "online=preview",
    steps: async (p) => {
      await toPrivate(p);
      await p.getByTestId("start-private").click();
      await p.getByTestId("invite-code").waitFor();
    },
  },
  {
    name: "08-on-shift",
    query: "online=preview",
    steps: async (p) => {
      await toPrivate(p);
      await p.getByTestId("join-code").fill("7QXK2M9T");
      await p.getByTestId("join-private").click();
      await p.getByTestId("online-conn").waitFor();
      await p.waitForFunction(
        () => document.querySelector("[data-testid=online-conn]")?.getAttribute("data-conn") === "connected",
      );
    },
  },
  {
    name: "09-chip-connected",
    query: "online=preview&conn=connected",
    steps: async () => undefined,
  },
  {
    name: "10-chip-lost",
    query: "online=preview&conn=lost",
    steps: async () => undefined,
  },
];

const browser = await chromium.launch({ headless: true });
let failures = 0;
try {
  for (const dpr of dprs) {
    const dir = join(outDir, `dpr${String(dpr).replace(".", "_")}`);
    mkdirSync(dir, { recursive: true });
    for (const shot of SHOTS) {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: dpr,
        reducedMotion: "reduce", // settles instantly: the capture is of the resting state
      });
      const page = await context.newPage();
      try {
        await page.goto(page_(shot.query));
        await page.evaluate(() => document.fonts.ready);
        await shot.steps(page);
        await page.waitForTimeout(250);
        const path = join(dir, `${shot.name}.png`);
        await page.screenshot({ path, animations: "disabled" });
        const dims = await page.evaluate(() => ({
          dpr: window.devicePixelRatio,
          w: window.innerWidth,
          h: window.innerHeight,
        }));
        console.log(`ok   dpr ${dims.dpr} ${dims.w}x${dims.h} css -> ${path}`);
      } catch (error) {
        failures += 1;
        console.error(`FAIL dpr ${dpr} ${shot.name}: ${String(error).split("\n")[0]}`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
process.exit(failures === 0 ? 0 : 1);
