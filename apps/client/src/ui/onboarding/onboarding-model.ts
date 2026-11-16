// Pure view-model of onboarding: the Induction Checklist, DOT subtitle lines, the Handbook and achievement toasts.
// Reads store slice data and returns what the screen shows. Unknown catalog ids yield `null`: raw ids never reach players.

import type { UiAchievementItem, UiChecklistItem, UiChecklistState } from "@moon-cleanup/shared";
import { formatString, STRINGS } from "../strings";

const I = STRINGS.induction;

export interface StepText {
  readonly title: string;
  readonly hint: string;
}

/** Title and hint of a checklist item; looked up by `labelId`, then by `id`. `null` when the catalog has neither. */
export function stepText(item: Pick<UiChecklistItem, "id" | "labelId">): StepText | null {
  const steps = I.steps as Readonly<Record<string, StepText | undefined>>;
  return steps[item.labelId] ?? steps[item.id] ?? null;
}

export interface InductionView {
  readonly total: number;
  readonly done: number;
  /** The step to do now: the one at `stepIndex` when it is not done, else the first item not done. */
  readonly current: UiChecklistItem | null;
  /** The step after `current`, greyed. */
  readonly next: UiChecklistItem | null;
  readonly complete: boolean;
}

/** Known steps only (an item without catalog text is skipped), in store order. */
export function inductionView(checklist: Pick<UiChecklistState, "items" | "stepIndex">): InductionView {
  const items = checklist.items.filter((item) => stepText(item) !== null);
  const done = items.filter((item) => item.done).length;
  const atIndex = items[checklist.stepIndex];
  const current = atIndex !== undefined && !atIndex.done ? atIndex : (items.find((item) => !item.done) ?? null);
  const after = current === null ? [] : items.slice(items.indexOf(current) + 1).filter((item) => !item.done);
  return {
    total: items.length,
    done,
    current,
    next: after[0] ?? null,
    complete: items.length > 0 && done === items.length,
  };
}

/** "3/8" and its spoken form. */
export const inductionCount = (view: Pick<InductionView, "done" | "total">): string =>
  formatString(I.count, { done: view.done, total: view.total });
export const inductionCountLabel = (view: Pick<InductionView, "done" | "total">): string =>
  formatString(I.countLabel, { done: view.done, total: view.total });

/** Progress "2 of 5" for a multi-count step; `null` for a single-action step. */
export function stepProgressText(item: Pick<UiChecklistItem, "progress" | "target">): string | null {
  if (item.target <= 1) return null;
  const progress = Math.max(0, Math.min(item.target, Math.floor(item.progress)));
  return formatString(I.progress, { progress, target: item.target });
}

/** 0..1 fill of a step. */
export function stepFraction(item: Pick<UiChecklistItem, "progress" | "target" | "done">): number {
  if (item.done) return 1;
  return item.target > 0 ? Math.max(0, Math.min(1, item.progress / item.target)) : 0;
}

/** Changes whenever the player makes progress (a step done or a counter moved): re-expands the collapsed block. */
export function progressKey(items: readonly UiChecklistItem[]): string {
  let key = "";
  for (const item of items) key += item.done ? "d" : String(Math.floor(item.progress));
  return key;
}

// ---- DOT lines ---------------------------------------------------------------------------------------------------------

/** Subtitle text for a DOT line; `null` for an unknown id or a line whose parameters are missing. */
export function dotText(textId: string, params: Readonly<Record<string, string | number>>): string | null {
  const template = (STRINGS.dotLines as Readonly<Record<string, string | undefined>>)[textId];
  if (template === undefined) return null;
  const text = formatString(template, params);
  return /\{\w+\}/.test(text) ? null : text;
}

/** Log text from an id alone (the history keeps no parameters): unresolved placeholders become an ellipsis. */
export function dotLogText(textId: string): string | null {
  const template = (STRINGS.dotLines as Readonly<Record<string, string | undefined>>)[textId];
  return template === undefined ? null : template.replace(/\{\w+\}/g, "…");
}

/** How long a subtitle stays: the line's own time, within 1.5 s and 12 s. */
export const dotHoldMs = (durationMs: number): number =>
  Math.min(12_000, Math.max(1500, Number.isFinite(durationMs) ? durationMs : 4000));

// ---- achievements ------------------------------------------------------------------------------------------------------

export const achievementName = (id: string): string | null =>
  (STRINGS.achievements.names as Readonly<Record<string, string | undefined>>)[id] ?? null;

export interface UnlockScan {
  /** Ids unlocked since the last scan, in item order. */
  readonly fresh: readonly string[];
  /** Every id unlocked now. */
  readonly known: ReadonlySet<string>;
}

/**
 * Compares the unlocked set before and after. With `known === null` (the first non-empty snapshot) nothing is fresh:
 * achievements earned in earlier sessions must not replay as toasts when a shift loads.
 */
export function scanUnlocks(known: ReadonlySet<string> | null, items: readonly UiAchievementItem[]): UnlockScan {
  const now = new Set<string>();
  const fresh: string[] = [];
  for (const item of items) {
    if (item.unlockedAtMs === null) continue;
    now.add(item.id);
    if (known !== null && !known.has(item.id)) fresh.push(item.id);
  }
  return { fresh, known: now };
}

// ---- handbook ---------------------------------------------------------------------------------------------------------

export const CHAPTER_IDS = [
  "getting_started",
  "cleaning",
  "selling",
  "upgrades",
  "vehicles",
  "robots",
  "coop",
  "controls",
  "accessibility",
] as const;
export type ChapterId = (typeof CHAPTER_IDS)[number];

/** Chapters that carry the plot-state diagram. */
export const DIAGRAM_CHAPTERS: readonly ChapterId[] = ["cleaning", "accessibility"];

export interface Chapter {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly keys: Readonly<Record<"kbm" | "xbox" | "playstation", string>>;
}

export const chapterOf = (id: ChapterId): Chapter => STRINGS.handbook.chapters[id];
