// Display metrics for the DOM UI: devicePixelRatio, the one-device-pixel hairline and the HUD scale.
// The UI layer always renders at the full device DPR, independent of the canvas DPR cap and the dynamic render scale
// (visual-target section 2.3; ui-screens-and-flows section 5.5). Pure helpers first, DOM installer last.

/** Smallest HUD scale. Art-direction 8.2 allows 0.85, but that would take the 14 px caption below 14 CSS px. */
export const HUD_SCALE_MIN = 1;
export const HUD_SCALE_MAX = 1.5;
export const HUD_REFERENCE_HEIGHT_CSS_PX = 1080;
/** Player-facing HUD size setting range (Settings, accessibility basics). */
export const USER_SCALE_MIN = 0.8;
export const USER_SCALE_MAX = 1.5;

export interface DisplayMetrics {
  readonly dpr: number;
  /** One device pixel expressed in CSS px (`1 / dpr`): the border and hairline width. */
  readonly pxCss: number;
  readonly hudScale: number;
}

/** `clamp(1, viewportHeight / 1080, 1.5) x userScale`, rounded to 1/100. */
export function computeHudScale(viewportHeightCssPx: number, userScale: number = 1): number {
  const base = Math.min(HUD_SCALE_MAX, Math.max(HUD_SCALE_MIN, viewportHeightCssPx / HUD_REFERENCE_HEIGHT_CSS_PX));
  const user = Math.min(USER_SCALE_MAX, Math.max(USER_SCALE_MIN, Number.isFinite(userScale) ? userScale : 1));
  return Math.round(base * user * 100) / 100;
}

/** Snaps a CSS-px position to a whole device pixel: `round(x * dpr) / dpr` (section 5.5 rule 3). */
export function snapToDevicePx(cssPx: number, dpr: number): number {
  return Math.round(cssPx * dpr) / dpr;
}

/**
 * `devicePixelRatio` cleaned for layout. Browsers (and automation) report float32 noise such as 1.0000000298 or
 * 2.00000006; `1 / dpr` then becomes 0.99999997 px and every `round(x, var(--mc-px))` spacing lands a hair under a
 * whole device pixel, so panels, hairlines and text end up on fractional rows. Rounding to 1/1000 restores exact
 * values for every real scale (1, 1.25, 1.5, 1.75, 2, 2.5, 3) and browser zoom steps.
 */
export function normalizeDpr(dpr: number): number {
  if (!Number.isFinite(dpr) || dpr <= 0) return 1;
  return Math.round(dpr * 1000) / 1000;
}

/** Short DPR text for readouts: `1`, `1.5`, `1.25` (never float noise). */
export function formatDpr(dpr: number): string {
  return String(Number(normalizeDpr(dpr).toFixed(2)));
}

export function computeDisplayMetrics(dpr: number, viewportHeightCssPx: number, userScale: number = 1): DisplayMetrics {
  const safeDpr = normalizeDpr(dpr);
  return { dpr: safeDpr, pxCss: 1 / safeDpr, hudScale: computeHudScale(viewportHeightCssPx, userScale) };
}

/** Writes the metrics as custom properties on `root` (only when a value changed). */
export function applyDisplayMetrics(root: HTMLElement, metrics: DisplayMetrics): void {
  const set = (name: string, value: string): void => {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  };
  set("--mc-dpr", String(metrics.dpr));
  set("--mc-px", `${metrics.pxCss}px`);
  set("--mc-hud-scale", String(metrics.hudScale));
}

export interface DisplayMetricsHandle {
  readonly current: () => DisplayMetrics;
  /** Updates the player's HUD size setting (0.8 to 1.5). */
  readonly setUserScale: (scale: number) => void;
  readonly dispose: () => void;
}

/**
 * Keeps the metrics current: `resize` covers viewport changes and browser zoom, and a `(resolution: Ndppx)` media
 * query (re-armed after every change) covers moving the window between displays. `onChange` runs after each update.
 */
export function installDisplayMetrics(
  win: Window,
  root: HTMLElement,
  options: { userScale?: number; onChange?: (metrics: DisplayMetrics) => void } = {},
): DisplayMetricsHandle {
  let userScale = options.userScale ?? 1;
  let metrics = computeDisplayMetrics(win.devicePixelRatio, win.innerHeight, userScale);
  let mql: MediaQueryList | null = null;

  const update = (): void => {
    metrics = computeDisplayMetrics(win.devicePixelRatio, win.innerHeight, userScale);
    applyDisplayMetrics(root, metrics);
    options.onChange?.(metrics);
  };
  const armDprWatch = (): void => {
    mql?.removeEventListener("change", onDprChange);
    mql = win.matchMedia(`(resolution: ${win.devicePixelRatio}dppx)`);
    mql.addEventListener("change", onDprChange);
  };
  function onDprChange(): void {
    update();
    armDprWatch();
  }

  applyDisplayMetrics(root, metrics);
  armDprWatch();
  win.addEventListener("resize", update);
  options.onChange?.(metrics);

  return {
    current: () => metrics,
    setUserScale(scale) {
      userScale = scale;
      update();
    },
    dispose() {
      mql?.removeEventListener("change", onDprChange);
      mql = null;
      win.removeEventListener("resize", update);
    },
  };
}
