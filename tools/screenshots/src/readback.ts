import type { CDPSession, Page } from "@playwright/test";

/**
 * Lossless full-viewport PNG through the DevTools protocol (`Page.captureScreenshot`, `optimizeForSpeed`). `optimizeForSpeed`
 * only lowers the PNG deflate effort (bigger file, identical pixels), and the call skips Playwright's pre-shot waits (fonts,
 * animation settling, stable-layout rAFs). Falls back to `page.screenshot` when CDP is unavailable (non-Chromium, closed
 * session) or `mode` is `playwright`.
 *
 * Size: the captured surface can come back at the OS display scale (150 % on the dev laptop) even when the context emulates
 * DPR 1. `scaleFor` learns the correction from the first frame (clip scale = wanted width / returned width), so the PNG is
 * always viewport x emulated DPR; the same resample Playwright's own screenshot applies.
 */
const sessions = new WeakMap<Page, CDPSession>();
const pins = new WeakMap<Page, { dpr: number; w: number; h: number }>();
const learnedScale = new WeakMap<Page, number>();

export type ReadbackMode = "cdp" | "playwright";

function pngWidth(b: Buffer): number {
  return b.readUInt32BE(16);
}

export async function readbackPng(page: Page, mode: ReadbackMode = "cdp"): Promise<Buffer> {
  if (mode === "cdp") {
    try {
      let s = sessions.get(page);
      if (s === undefined) {
        s = await page.context().newCDPSession(page);
        sessions.set(page, s);
      }
      const vp = page.viewportSize();
      if (vp === null) throw new Error("no viewport");
      const dpr = Math.round((await page.evaluate(() => window.devicePixelRatio)) * 1000) / 1000;
      // Pin the surface scale to the emulated DPR. Without this, a clip scale that differs from the OS display scale
      // (150 % on the dev laptop) leaves `window.devicePixelRatio` at the OS scale after the shot, and a DPR-reactive page
      // (the HUD page's readout, --mc-dpr) re-renders at the wrong DPR (S12 read "1.5" in the DPR 1 and 2 frames).
      const pinned = pins.get(page);
      if (pinned === undefined || pinned.dpr !== dpr || pinned.w !== vp.width || pinned.h !== vp.height) {
        await s.send("Emulation.setDeviceMetricsOverride", {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: dpr,
          mobile: false,
        });
        pins.set(page, { dpr, w: vp.width, h: vp.height });
      }
      const wantW = Math.round(vp.width * dpr);
      const shoot = async (scale: number): Promise<Buffer> => {
        const r = (await s.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
          optimizeForSpeed: true,
          clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale },
        })) as { data: string };
        return Buffer.from(r.data, "base64");
      };
      let scale = learnedScale.get(page) ?? 1;
      const t0 = performance.now();
      let buf = await shoot(scale);
      if (process.env["MC_READBACK_DEBUG"]) console.log("shoot1 ms", performance.now() - t0, pngWidth(buf));
      if (pngWidth(buf) !== wantW) {
        scale = scale * (wantW / pngWidth(buf));
        buf = await shoot(scale);
        if (pngWidth(buf) !== wantW) throw new Error(`CDP screenshot width ${pngWidth(buf)}, wanted ${wantW}`);
      }
      learnedScale.set(page, scale);
      return buf;
    } catch {
      sessions.delete(page);
    }
  }
  return page.screenshot({ type: "png", animations: "allow", caret: "initial" });
}

/**
 * The first compositor capture of a browser process costs about 3-4 s on UHD 620 (surface setup); later ones about 0.5 s.
 * Doing it once on a blank page also learns the clip scale, so no scene capture carries it or a wasted oversize frame.
 */
export async function warmUpReadback(
  page: Page,
  cssWidth: number,
  cssHeight: number,
  mode: ReadbackMode,
): Promise<number> {
  const t0 = performance.now();
  await page.setViewportSize({ width: cssWidth, height: cssHeight });
  await page.goto("about:blank");
  await readbackPng(page, mode);
  return performance.now() - t0;
}
