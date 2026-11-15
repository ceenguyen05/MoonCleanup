// Rebinding port of the composition root (integrator round 5, Job B): backs `UiModuleOptions.controls` with the gameplay
// input module's real binding table. `apply` validates (`compileBindings` throws on an unknown action or device, which
// the UI shows as "not accepted"), hands the table to `InputState.setBindings` (which releases everything held so no
// action sticks), persists it and notifies the screen. `table()` returns the same object until a change.

import { INPUT_BUTTON_MASK } from "@moon-cleanup/shared";
import { DEFAULT_BINDINGS, EXTRA_ACTIONS, compileBindings, type BindingTable, type InputAction } from "../gameplay";
import type { ControlsPort } from "../ui";

function isInputAction(value: string): value is InputAction {
  return Object.hasOwn(INPUT_BUTTON_MASK, value) || (EXTRA_ACTIONS as readonly string[]).includes(value);
}

/** Narrows a UI/stored table (action ids as strings) to a validated gameplay table; throws with the offender named. */
export function toBindingTable(raw: Readonly<Record<string, string>>): BindingTable {
  const table: Record<string, InputAction> = {};
  for (const [device, action] of Object.entries(raw)) {
    if (!isInputAction(action)) throw new Error(`bindings: unknown action "${action}" for ${device}`);
    table[device] = action;
  }
  compileBindings(table);
  return table;
}

export interface ControlsPortOptions {
  /** The live input state (`InputState.setBindings`). */
  readonly input: { setBindings(table: BindingTable): void };
  /** Validated table to start from (a stored rebind); null = defaults. */
  readonly initial: BindingTable | null;
  readonly save: (table: BindingTable) => void;
}

export function createControlsPort(options: ControlsPortOptions): ControlsPort {
  let table: BindingTable = options.initial ?? DEFAULT_BINDINGS;
  const listeners = new Set<() => void>();
  const set = (next: BindingTable): void => {
    options.input.setBindings(next);
    table = next;
    options.save(next);
    for (const listener of [...listeners]) listener();
  };
  return {
    table: () => table,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    apply: (next) => set(toBindingTable(next)),
    reset: () => set(DEFAULT_BINDINGS),
  };
}
