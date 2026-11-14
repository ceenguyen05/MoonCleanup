// Motion presets (art-direction section 8.7). Springs move things, short tweens give feedback. Animate transform and
// opacity only; never animate backdrop-filter. The names match the CSS tokens in tokens.css.

import type { Transition } from "motion/react";

export type CubicBezier = readonly [number, number, number, number];

/** Easing curves shared with the CSS tokens `--mc-ease-*`. */
export const EASE = {
  outCubic: [0.33, 1, 0.68, 1],
  inOut: [0.65, 0, 0.35, 1],
  outExpo: [0.16, 1, 0.3, 1],
} as const satisfies Record<string, CubicBezier>;

export interface SpringSpec {
  readonly type: "spring";
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

export const SPRINGS = {
  /** ~150 ms: press, release, toggles, slot selection. */
  snap: { type: "spring", stiffness: 600, damping: 38, mass: 1 },
  /** ~250 ms: panel open, list items, tabs. */
  ui: { type: "spring", stiffness: 380, damping: 32, mass: 1 },
  /** ~400 ms: large panels and overlays. */
  soft: { type: "spring", stiffness: 220, damping: 26, mass: 1 },
  /** ~350 ms with ~12 % overshoot: rewards, stamps, toasts. */
  pop: { type: "spring", stiffness: 520, damping: 16, mass: 0.8 },
  /** ~600 ms: banners and level-ups. */
  heavy: { type: "spring", stiffness: 160, damping: 22, mass: 1.4 },
} as const satisfies Record<string, SpringSpec>;

export type SpringName = keyof typeof SPRINGS;

/** Tween durations in seconds (tokens.css carries the same numbers in ms). */
export const DURATIONS = {
  hoverIn: 0.1,
  hoverOut: 0.14,
  press: 0.08,
  fadeIn: 0.2,
  fadeOut: 0.16,
  reduced: 0.12,
  toastHold: 3.5,
} as const;

/** Reduced motion: every spring becomes a 120 ms opacity fade (no overshoot, no travel). */
export const REDUCED_TRANSITION: Transition = { duration: DURATIONS.reduced, ease: [...EASE.outCubic] };

export function resolveSpring(name: SpringName, reduced: boolean): Transition {
  return reduced ? REDUCED_TRANSITION : { ...SPRINGS[name] };
}

export function fadeTransition(direction: "in" | "out", reduced: boolean): Transition {
  if (reduced) return REDUCED_TRANSITION;
  return direction === "in"
    ? { duration: DURATIONS.fadeIn, ease: [...EASE.outCubic] }
    : { duration: DURATIONS.fadeOut, ease: [...EASE.inOut] };
}

/** Number tick-up duration: clamp(350 + 220 x log10(|delta|), 350, 1200) ms (section 8.7). */
export function tickUpDurationMs(delta: number): number {
  const magnitude = Math.abs(delta);
  if (!(magnitude > 0)) return 0;
  return Math.min(1200, Math.max(350, 350 + 220 * Math.log10(magnitude)));
}
