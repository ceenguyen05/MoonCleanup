import type { Page } from "@playwright/test";

/** Same formatting as the client's `formatDpr` (1/1000 rounding, at most 2 decimals), kept local: tools never import apps. */
export function expectedDprText(dpr: number): string {
  return String(Number((Math.round(dpr * 1000) / 1000).toFixed(2)));
}

export interface DprCheck {
  readonly requested: number;
  readonly pageDpr: number;
  /** Text of `[data-testid=readout-dpr]` (the HUD page), null when the scene has none. */
  readonly readout: string | null;
  readonly ok: boolean;
}

export function evaluateDprCheck(requested: number, pageDpr: number, readout: string | null): DprCheck {
  const pageOk = Math.round(pageDpr * 1000) / 1000 === Math.round(requested * 1000) / 1000;
  const readoutOk = readout === null || readout === expectedDprText(requested);
  return { requested, pageDpr, readout, ok: pageOk && readoutOk };
}

/**
 * After a readback: the page DPR must still be the requested one (a capture must not change emulation) and, on scenes with
 * the DPR readout, the readout must show it. The readout polls every 500 ms, so wait for it instead of sleeping.
 */
export async function assertDprReadout(page: Page, requested: number, timeoutMs = 5_000): Promise<DprCheck> {
  const want = expectedDprText(requested);
  await page
    .waitForFunction(
      (w) => {
        const el = document.querySelector("[data-testid=readout-dpr]");
        return el === null || el.textContent === w;
      },
      want,
      { timeout: timeoutMs },
    )
    .catch(() => undefined);
  const raw = await page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    readout: document.querySelector("[data-testid=readout-dpr]")?.textContent ?? null,
  }));
  const check = evaluateDprCheck(requested, raw.dpr, raw.readout);
  if (!check.ok)
    throw new Error(
      `DPR mismatch after capture: requested ${requested}, page ${raw.dpr}, readout ${String(raw.readout)} (expected "${want}")`,
    );
  return check;
}
