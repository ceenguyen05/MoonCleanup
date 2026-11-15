// Keyboard arrow and gamepad D-pad focus navigation for menus. Pure geometry (`pickNext`) plus thin DOM helpers. There is
// no listener and no polling here: React `onKeyDown` on the menu frame calls `moveFocus` for arrow keys, and the input
// module polls the gamepad and calls `UiModule.navigate(...)`, which lands in the same functions.

export type NavDirection = "up" | "down" | "left" | "right" | "next" | "prev";

/** What the input layer can ask of an open menu. */
export type UiNavAction = NavDirection | "confirm" | "back";

export interface NavRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Index of the control to focus when moving `dir` from `current` (-1 = nothing focused yet: first control). Spatial
 * moves pick the nearest centre inside the half-plane of the direction, weighting off-axis distance double so rows and
 * columns feel straight. Returns `current` when nothing lies that way.
 */
export function pickNext(rects: readonly NavRect[], current: number, dir: NavDirection): number {
  const count = rects.length;
  if (count === 0) return -1;
  if (current < 0 || current >= count) return dir === "prev" || dir === "up" || dir === "left" ? count - 1 : 0;
  if (dir === "next") return (current + 1) % count;
  if (dir === "prev") return (current - 1 + count) % count;
  const from = rects[current] as NavRect;
  const fx = from.x + from.w / 2;
  const fy = from.y + from.h / 2;
  let best = current;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < count; i += 1) {
    if (i === current) continue;
    const r = rects[i] as NavRect;
    const dx = r.x + r.w / 2 - fx;
    const dy = r.y + r.h / 2 - fy;
    const primary = dir === "down" ? dy : dir === "up" ? -dy : dir === "right" ? dx : -dx;
    if (primary <= 0.5) continue;
    const secondary = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
    const score = primary + secondary * 2;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

const FOCUSABLE = 'button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Controls the player can focus inside `root`: visible, not natively disabled. `aria-disabled` controls stay (they explain themselves). */
export function focusables(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const node of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if ((node as HTMLButtonElement).disabled || node.tabIndex < 0 || node.hidden) continue;
    out.push(node);
  }
  return out;
}

/** Moves focus inside `root`. Returns true when focus changed. */
export function moveFocus(root: HTMLElement, dir: NavDirection): boolean {
  const nodes = focusables(root);
  const rects = nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  });
  const active = root.ownerDocument.activeElement;
  const current = active instanceof HTMLElement ? nodes.indexOf(active) : -1;
  const target = pickNext(rects, current, dir);
  const node = nodes[target];
  if (node === undefined || target === current) return false;
  node.focus({ preventScroll: false });
  node.scrollIntoView?.({ block: "nearest" });
  return true;
}

/** Clicks the focused control inside `root` (the gamepad A / Cross button). */
export function activateFocused(root: HTMLElement): boolean {
  const active = root.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active) || active === root) return false;
  active.click();
  return true;
}
