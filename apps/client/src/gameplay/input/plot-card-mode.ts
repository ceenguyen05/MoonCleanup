// Plot Card activation setting (game-feel-and-controls 6.1: "Plot Card | C | Toggle (option Hold)"; owner decision
// 2026-11-15: tap-to-toggle is the default, hold-to-show is a Settings option). Plain data plus the persistence helpers
// for the key/value store the other player settings use (localStorage, `mc.settings.*`, see app/settings-storage.ts),
// and the binding-table revision key used by `migrateBindings`. DOM-free: the store is passed in.

export const PLOT_CARD_MODES = ["toggle", "hold"] as const;
export type PlotCardMode = (typeof PLOT_CARD_MODES)[number];
export const DEFAULT_PLOT_CARD_MODE: PlotCardMode = "toggle";

/** Storage keys, next to the existing `mc.settings.*` / `mc.controls.bindings` keys. */
export const INPUT_SETTINGS_KEYS = {
  plotCardMode: "mc.settings.plotCardMode",
  bindingsRev: "mc.controls.bindingsRev",
} as const;

/** The subset of `Storage` used (same shape as the app's KeyValueStore). */
export interface InputSettingsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isPlotCardMode(value: unknown): value is PlotCardMode {
  return value === "toggle" || value === "hold";
}

/** Stored Plot Card mode; null when nothing (or an unknown value, reported through `onProblem`) is stored. */
export function loadPlotCardMode(
  store: InputSettingsStore | null,
  onProblem?: (source: string, error: unknown) => void,
): PlotCardMode | null {
  let raw: string | null;
  try {
    raw = store?.getItem(INPUT_SETTINGS_KEYS.plotCardMode) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  if (isPlotCardMode(raw)) return raw;
  onProblem?.("settings load", new Error(`stored Plot Card mode "${raw}" is unknown and was ignored`));
  return null;
}

/** Persists the mode; never throws (private mode, quota): returns false on failure. */
export function savePlotCardMode(store: InputSettingsStore | null, mode: PlotCardMode): boolean {
  try {
    store?.setItem(INPUT_SETTINGS_KEYS.plotCardMode, mode);
    return store !== null;
  } catch {
    return false;
  }
}

/** Stored binding-table revision (null = none stored, i.e. a table from before revisions, or no table at all). */
export function loadBindingsRev(store: InputSettingsStore | null): number | null {
  let raw: string | null;
  try {
    raw = store?.getItem(INPUT_SETTINGS_KEYS.bindingsRev) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  const rev = Number(raw);
  return Number.isInteger(rev) && rev >= 1 ? rev : null;
}

export function saveBindingsRev(store: InputSettingsStore | null, rev: number): void {
  try {
    store?.setItem(INPUT_SETTINGS_KEYS.bindingsRev, String(rev));
  } catch {
    // A failed write only means the migration runs again next load; it is idempotent.
  }
}
