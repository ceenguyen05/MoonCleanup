// Pure view-model helpers of the HUD. No React, no DOM, no allocation beyond the formatted strings the screen shows.
// Everything here reads store slices (plain data) and returns display values; the HUD never touches sim state.

import type { UiHolsterSlot, UiNotice, UiWalletDelta } from "@moon-cleanup/shared";
import { formatString, STRINGS } from "../strings";

const INTEGER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const formatLm = (value: number): string => INTEGER.format(Math.round(value));

/** Shine shows 4 decimals (ui/slices `UiShineState.pct`). */
export const formatShinePct = (pct: number): string => `${clamp(pct, 0, 100).toFixed(4)}%`;

export function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

/** Fill fraction 0..1 of a Dust Cell. */
export function cellFraction(slot: Pick<UiHolsterSlot, "cellKg" | "cellCapKg">): number {
  return slot.cellCapKg > 0 ? clamp(slot.cellKg / slot.cellCapKg, 0, 1) : 0;
}

/** Whole-percent width, quantised to 1% so a bar repaints at most 100 times across its whole range. */
export const percent = (fraction: number): number => Math.round(clamp(fraction, 0, 1) * 100);

export function toolName(toolId: string | null): string | null {
  if (toolId === null) return null;
  return (STRINGS.tools as Readonly<Record<string, string>>)[toolId] ?? null;
}

export function promptText(labelId: string): string | null {
  return (STRINGS.prompts as Readonly<Record<string, string>>)[labelId] ?? null;
}

/** Text of a notice, or `null` when its catalog id is unknown (raw ids are never shown to players). */
export function noticeText(notice: Pick<UiNotice, "textId" | "params" | "count">): string | null {
  const template = (STRINGS.notices as Readonly<Record<string, string>>)[notice.textId];
  if (template === undefined) return null;
  const reason = notice.params["reason"];
  const params =
    typeof reason === "string"
      ? { ...notice.params, reason: (STRINGS.purchaseRejectReasons as Readonly<Record<string, string>>)[reason] ?? "" }
      : notice.params;
  const text = formatString(template, params);
  return notice.count > 1 ? `${text} x${notice.count}` : text;
}

export interface WalletFloater {
  readonly key: string;
  readonly text: string;
  readonly gain: boolean;
}

/** The floater for the newest wallet delta, or `null` when there is none or it is zero. */
export function floaterOf(delta: UiWalletDelta | undefined): WalletFloater | null {
  if (delta === undefined || delta.amountLm === 0) return null;
  const gain = delta.amountLm > 0;
  const amount = formatLm(Math.abs(delta.amountLm));
  return {
    key: `${delta.atMs}:${delta.amountLm}:${delta.source}`,
    text: formatString(gain ? STRINGS.hud.walletDeltaGain : STRINGS.hud.walletDeltaSpend, { amount }),
    gain,
  };
}

/** Accessible name of a holster slot (state is text, never colour alone). */
export function slotLabel(slot: UiHolsterSlot, index: number, active: boolean): string {
  const name = toolName(slot.toolId);
  if (name === null || !slot.owned) return `${STRINGS.hud.slotEmpty}, slot ${index + 1}`;
  const cell = formatString(STRINGS.hud.cellValue, { pct: percent(cellFraction(slot)) });
  const base = formatString(STRINGS.hud.slotLabel, { name, slot: index + 1, cell });
  return active ? `${base}, ${STRINGS.hud.slotActive}` : base;
}

export function dayText(isDay: boolean, minutes: number): string {
  const min = Math.max(0, Math.round(minutes));
  return formatString(isDay ? STRINGS.hud.toDusk : STRINGS.hud.toDawn, { min });
}
