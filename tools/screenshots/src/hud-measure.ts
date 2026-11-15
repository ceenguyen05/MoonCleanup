import type { Page } from "@playwright/test";
import { luma709, type Img } from "./measure/image";

/** Hairline rows over half of the peak step for a column-mean luma profile (1 = a single crisp device row). */
export function rowsOverHalfPeak(rows: readonly number[]): number {
  if (rows.length < 2) return 0;
  const bg = ((rows[0] ?? 0) + (rows[rows.length - 1] ?? 0)) / 2;
  const peak = Math.max(...rows.map((v) => Math.abs(v - bg)));
  return rows.filter((v) => Math.abs(v - bg) > peak * 0.5).length;
}

export interface HudMeasure {
  readonly panelsOffDevicePx: number;
  readonly hairlines: readonly {
    readonly y: number;
    readonly h: number;
    readonly rowsOverHalfPeak: number;
    readonly peak: number;
  }[];
}

/** HUD-page numbers for the sidecar (VT-M0-10): panel rects off whole device px, hairline rows. Null off the HUD page. */
export async function measureHud(page: Page, img: Img): Promise<HudMeasure | null> {
  const facts = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="hud-test"]');
    if (root === null) return null;
    const dpr = window.devicePixelRatio;
    let off = 0;
    for (const el of root.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const panel =
        /glass|panel|wallet|bench|shine|holster|gear|compass/i.test(el.className?.toString?.() ?? "") &&
        el.tagName !== "SPAN";
      if (
        panel &&
        Math.max(...[r.left, r.top, r.width, r.height].map((v) => Math.abs(v * dpr - Math.round(v * dpr)))) > 0.02
      )
        off++;
    }
    const hair = [...document.querySelectorAll('[class*="hairH"]')].map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr };
    });
    return { off, hair };
  });
  if (facts === null) return null;
  const hairlines = facts.hair.map((b) => {
    const x0 = Math.round(b.x + b.w * 0.25);
    const x1 = Math.round(b.x + b.w * 0.75);
    const rows: number[] = [];
    for (let y = Math.floor(b.y) - 4; y <= Math.ceil(b.y + b.h) + 4; y++) {
      let s = 0;
      for (let x = x0; x < x1; x++) {
        const i = (y * img.width + x) * 4;
        s += luma709(img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0);
      }
      rows.push(s / Math.max(1, x1 - x0));
    }
    const bg = ((rows[0] ?? 0) + (rows[rows.length - 1] ?? 0)) / 2;
    return {
      y: Math.round(b.y * 100) / 100,
      h: Math.round(b.h * 100) / 100,
      rowsOverHalfPeak: rowsOverHalfPeak(rows),
      peak: Math.round(Math.max(...rows.map((v) => Math.abs(v - bg))) * 10) / 10,
    };
  });
  return { panelsOffDevicePx: facts.off, hairlines };
}
