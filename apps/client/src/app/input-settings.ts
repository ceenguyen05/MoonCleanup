// Boot-time input settings (M1 Plot Card wiring): migrates a stored binding table to the current default revision once,
// and restores the Plot Card activation (toggle default, hold optional). Kept out of boot.ts so it is testable without a
// browser. Failures are reported through `report`, never swallowed.

import {
  BINDINGS_REV,
  DEFAULT_PLOT_CARD_MODE,
  loadBindingsRev,
  loadPlotCardMode,
  migrateBindings,
  saveBindingsRev,
  savePlotCardMode,
  type BindingTable,
  type InputSettingsStore,
  type PlotCardMode,
} from "../gameplay";
import { toBindingTable } from "./controls-port";

export interface InputSettingsOptions {
  readonly input: {
    setBindings(table: BindingTable): void;
    setPlotCardMode(mode: PlotCardMode): void;
  };
  readonly storage: InputSettingsStore | null;
  /** `settings.loadBindings()`: the stored table (action ids as strings) or null. */
  readonly storedBindings: Readonly<Record<string, string>> | null;
  readonly saveBindings: (table: BindingTable) => void;
  readonly report: (source: string, error: unknown) => void;
}

export interface InputSettingsResult {
  /** The table to start the rebinding port from (null = defaults). */
  readonly initial: BindingTable | null;
  readonly plotCardMode: PlotCardMode;
}

export function applyInputSettings(o: InputSettingsOptions): InputSettingsResult {
  let initial: BindingTable | null = null;
  if (o.storedBindings !== null) {
    try {
      const migrated = migrateBindings(toBindingTable(o.storedBindings), loadBindingsRev(o.storage));
      initial = migrated.table;
      o.input.setBindings(initial);
      if (migrated.changed) o.saveBindings(initial);
    } catch (error) {
      o.report("stored key bindings", error);
    }
  }
  // Fresh installs and migrated tables are current from here on (a cleared binding then stays cleared).
  saveBindingsRev(o.storage, BINDINGS_REV);
  const plotCardMode = loadPlotCardMode(o.storage, o.report) ?? DEFAULT_PLOT_CARD_MODE;
  o.input.setPlotCardMode(plotCardMode);
  return { initial, plotCardMode };
}

/** Settings > Controls > Plot Card: applies the choice to the input layer and persists it. */
export function choosePlotCardMode(
  input: { setPlotCardMode(mode: PlotCardMode): void },
  storage: InputSettingsStore | null,
  mode: PlotCardMode,
): boolean {
  input.setPlotCardMode(mode);
  return savePlotCardMode(storage, mode);
}
