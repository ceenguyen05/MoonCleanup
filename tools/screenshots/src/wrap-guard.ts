import { createHash } from "node:crypto";
import type { Img } from "./measure/image";

/**
 * Wrapped / repeated-band guard (M0-W3-T06 finding 2): one capture had rows 878-1079 identical to rows 0-201, a
 * canvas/render-target readback artefact. A frame is "wrapped" when its top k rows equal its bottom k rows exactly for some
 * k in [minBand, height * maxFraction] and that band has real content (a flat sky or a blank page must not trigger).
 */
export interface WrapCheck {
  readonly wrapped: boolean;
  /** Largest matching band height in rows (0 when none). */
  readonly bandRows: number;
  /** Distinct rows inside the matching band. */
  readonly distinctRows: number;
}

export interface WrapOptions {
  readonly minBand?: number;
  readonly maxFraction?: number;
  /** Minimum distinct row hashes inside the band for it to count as content. */
  readonly minDistinct?: number;
}

function rowHashes(img: Img): string[] {
  const stride = img.width * 4;
  const out: string[] = [];
  for (let y = 0; y < img.height; y++) {
    out.push(
      createHash("md5")
        .update(img.data.subarray(y * stride, (y + 1) * stride))
        .digest("hex"),
    );
  }
  return out;
}

export function detectWrappedBand(img: Img, opts: WrapOptions = {}): WrapCheck {
  const minBand = opts.minBand ?? 16;
  const maxBand = Math.floor(img.height * (opts.maxFraction ?? 0.34));
  const minDistinct = opts.minDistinct ?? 8;
  const h = rowHashes(img);
  let best: WrapCheck = { wrapped: false, bandRows: 0, distinctRows: 0 };
  for (let k = maxBand; k >= minBand; k--) {
    let ok = true;
    for (let i = 0; i < k; i++) {
      if (h[i] !== h[img.height - k + i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const distinct = new Set(h.slice(0, k)).size;
    if (distinct >= minDistinct && distinct >= k * 0.25) {
      best = { wrapped: true, bandRows: k, distinctRows: distinct };
      break;
    }
  }
  return best;
}

export interface WrapAttempt {
  readonly attempt: number;
  readonly how: "first" | "re-screenshot" | "reload";
  readonly wrapped: boolean;
  readonly bandRows: number;
  readonly dpr: number;
  readonly readbackMs: number;
}

export interface WrapGuardReport {
  readonly checked: true;
  readonly result: "clean" | "recovered" | "failed";
  readonly attempts: readonly WrapAttempt[];
  readonly note: string;
}

export function wrapReport(attempts: readonly WrapAttempt[]): WrapGuardReport {
  const last = attempts[attempts.length - 1];
  const failed = last === undefined || last.wrapped;
  const result = failed ? "failed" : attempts.length > 1 ? "recovered" : "clean";
  const note =
    result === "clean"
      ? "no repeated top/bottom band"
      : result === "recovered"
        ? `wrapped frame detected on ${attempts.length - 1} attempt(s) (band ${attempts[0]?.bandRows} rows); recaptured clean via ${last?.how}`
        : `wrapped frame persisted after ${attempts.length} attempts`;
  return { checked: true, result, attempts, note };
}

export class WrappedFrameError extends Error {
  constructor(readonly report: WrapGuardReport) {
    super(`capture is a wrapped/repeated-band frame: ${report.note}`);
  }
}

/** Retry policy: up to `maxShots` screenshots of the same page state, then the caller reloads. Pure so it is unit-testable. */
export async function captureWithGuard(
  shoot: (how: WrapAttempt["how"]) => Promise<{ png: Uint8Array; img: Img; readbackMs: number }>,
  dpr: number,
  hows: readonly WrapAttempt["how"][] = ["first", "re-screenshot", "reload"],
): Promise<{ png: Uint8Array; img: Img; report: WrapGuardReport }> {
  const attempts: WrapAttempt[] = [];
  let shot: { png: Uint8Array; img: Img } | null = null;
  for (const how of hows) {
    const s = await shoot(how);
    const c = detectWrappedBand(s.img);
    attempts.push({
      attempt: attempts.length + 1,
      how,
      wrapped: c.wrapped,
      bandRows: c.bandRows,
      dpr,
      readbackMs: s.readbackMs,
    });
    shot = s;
    if (!c.wrapped) break;
  }
  const report = wrapReport(attempts);
  if (report.result === "failed") throw new WrappedFrameError(report);
  return { png: shot!.png, img: shot!.img, report };
}
