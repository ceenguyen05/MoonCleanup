// Pure model of the save-sync screens (ADR-0031): what the indicator shows for each sync state, how a checkpoint summary
// reads in the "Which copy?" prompt, and the focus-trap arithmetic. No React, no DOM, no clock of its own (callers pass
// `nowMs`), so every rule here is a plain unit test.

import type { SaveSyncState, SoloCheckpointSummary, UiSaveSyncState } from "@moon-cleanup/shared";
import { formatString, STRINGS } from "../strings";

const S = STRINGS.saveSync;

/** Which glyph the indicator draws. Every state has its own SHAPE, so colour is never the only cue. */
export type SyncGlyph = "device" | "cloud_ok" | "cloud_up" | "cloud_off" | "compare" | "alert";

/** `quiet` states fade to a calm chip; `attention` states stay readable and ask for nothing but a look. */
export type SyncTone = "quiet" | "attention";

export interface SyncIndicatorView {
  readonly state: SaveSyncState;
  readonly glyph: SyncGlyph;
  readonly tone: SyncTone;
  readonly chip: string;
  readonly text: string;
}

const GLYPH: Readonly<Record<SaveSyncState, SyncGlyph>> = {
  local_only: "device",
  synced: "cloud_ok",
  pending: "cloud_up",
  uploading: "cloud_up",
  offline: "cloud_off",
  conflict: "compare",
  error: "alert",
};

/** Only a conflict or a failure asks the player to look; offline and local-only are normal Solo states. */
const ATTENTION: ReadonlySet<SaveSyncState> = new Set<SaveSyncState>(["conflict", "error"]);

export function indicatorView(state: SaveSyncState): SyncIndicatorView {
  return {
    state,
    glyph: GLYPH[state],
    tone: ATTENTION.has(state) ? "attention" : "quiet",
    chip: S.states[state].chip,
    text: S.states[state].text,
  };
}

/** Whole-minute age text ("just now", "5 min ago", "3 h ago", "2 d ago"); a future or unknown time reads as just now. */
export function formatAge(thenMs: number, nowMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - thenMs) / 60_000);
  if (minutes < 1) return S.ageNow;
  if (minutes < 60) return formatString(S.ageMinutes, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return formatString(S.ageHours, { n: hours });
  return formatString(S.ageDays, { n: Math.floor(hours / 24) });
}

/** "3 h 20 min" / "45 min" / "under a minute" style playtime, from whole seconds. */
export function formatPlaytime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${total} s`;
}

/** Local time of day and date, e.g. "Nov 16, 3:42 PM" (locale decides the shape). */
export function formatStamp(ms: number, locale?: string): string {
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    new Date(ms),
  );
}

/** Calendar date only, for "kept until {date}". */
export function formatDate(ms: number, locale?: string): string {
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(ms));
}

/** Shine as the HUD writes it (percent of all plots polished, four decimals) or a plot count while the total is unknown. */
export function shineText(shinePolished: number, totalPlots: number): string {
  if (totalPlots > 0) {
    const pct = Math.min(100, Math.max(0, (shinePolished / totalPlots) * 100));
    return formatString(S.prompt.shineValue, { pct: `${pct.toFixed(2)}%` });
  }
  return formatString(S.prompt.shinePlots, { count: shinePolished.toLocaleString("en-US") });
}

export interface SummaryRow {
  readonly id: "savedAt" | "device" | "playtime" | "shine" | "wallet";
  readonly label: string;
  readonly value: string;
}

/** The five rows of one copy: saved-at, device, playtime, Shine, wallet. */
export function summaryRows(summary: SoloCheckpointSummary, nowMs: number, totalPlots: number): readonly SummaryRow[] {
  const savedMs = Date.parse(summary.savedAt);
  const R = S.prompt.rows;
  return [
    {
      id: "savedAt",
      label: R.savedAt,
      value: Number.isFinite(savedMs) ? `${formatStamp(savedMs)} (${formatAge(savedMs, nowMs)})` : "",
    },
    { id: "device", label: R.device, value: summary.deviceLabel ?? S.prompt.unknownDevice },
    { id: "playtime", label: R.playtime, value: formatPlaytime(summary.playtimeS) },
    { id: "shine", label: R.shine, value: shineText(summary.shinePolished, totalPlots) },
    { id: "wallet", label: R.wallet, value: `${Math.round(summary.walletLumens).toLocaleString("en-US")} LM` },
  ];
}

/**
 * Which copy has more progress (informational tag only: the prompt never preselects it). Newest save time wins; a tie
 * falls back to playtime. `null` when they are equal, so neither side is tagged.
 */
export function newerSide(local: SoloCheckpointSummary, server: SoloCheckpointSummary): "local" | "server" | null {
  const a = Date.parse(local.savedAt);
  const b = Date.parse(server.savedAt);
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a > b ? "local" : "server";
  if (local.playtimeS !== server.playtimeS) return local.playtimeS > server.playtimeS ? "local" : "server";
  return null;
}

/** True exactly when the prompt has both copies to show (the slice rule: `conflict` non-null iff state `conflict`). */
export function hasConflict(save: UiSaveSyncState): boolean {
  return save.state === "conflict" && save.conflict !== null;
}

/** The prompt is visible while a conflict exists and the player has not chosen "Decide later" for it. */
export function promptVisible(save: UiSaveSyncState, dismissed: boolean): boolean {
  return hasConflict(save) && !dismissed;
}

/**
 * Tab wrap for a trapped dialog: where focus goes after Tab (`shift` false) or Shift+Tab from `current` among `count`
 * controls (-1 = focus is outside or on the dialog heading). `null` = let the browser move focus normally.
 */
export function wrapTab(count: number, current: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (shift && current <= 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return null;
}

/** Whether the scrolling copies body has more content below the visible part (drives the "more below" cue). */
export function hasMoreBelow(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight - clientHeight > 1 && scrollHeight - (scrollTop + clientHeight) > 1;
}

/** Error line for the Settings section: the failure kind in words, or `null`. */
export function errorText(save: UiSaveSyncState): string | null {
  return save.error === null ? null : S.errorKinds[save.error.kind];
}
