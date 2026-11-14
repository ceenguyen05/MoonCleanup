// View model of the "Waking the moon..." overlay (SCR-03), kept pure so it is testable without React or a DOM.
// Input: the `session.conn` state mirrored from `net.status`, plus the local elapsed seconds since the overlay appeared.

import type { NetConnectionState } from "@moon-cleanup/shared";
import { WAKING_DOT_TIPS, WAKING_TIP_INTERVAL_S } from "../strings";

/** From this many seconds of waiting the headline admits the wake is slow (SCR-03 `slow_wake`). */
export const SLOW_WAKE_AFTER_S = 120;

export type WakingVariant = "waking" | "slow" | "connecting" | "lost";

/** Overlay is up for these connection states; `asleep` (nothing started) and `connected` (done) hide it. */
export function isWakingVisible(conn: NetConnectionState): boolean {
  return conn === "waking" || conn === "connecting" || conn === "lost";
}

export function wakingVariant(conn: NetConnectionState, elapsedS: number): WakingVariant | null {
  switch (conn) {
    case "waking":
      return elapsedS >= SLOW_WAKE_AFTER_S ? "slow" : "waking";
    case "connecting":
      return "connecting";
    case "lost":
      return "lost";
    case "asleep":
    case "connected":
      return null;
  }
}

/** Elapsed seconds as `m:ss`. */
export function formatElapsed(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

/** The DOT tip for an elapsed time: rotates every 8 s through the pool. */
export function dotTipAt(elapsedS: number): { readonly index: number; readonly text: string } {
  const index = Math.floor(Math.max(0, elapsedS) / WAKING_TIP_INTERVAL_S) % WAKING_DOT_TIPS.length;
  return { index, text: WAKING_DOT_TIPS[index] ?? WAKING_DOT_TIPS[0] };
}
