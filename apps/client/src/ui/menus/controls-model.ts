// Key rebinding model (pure). The UI never imports the input layer: it reads and writes a binding table through
// `ControlsPort`, which has the same shape as the gameplay input module's `BindingTable` (device code -> action id, JSON
// safe), so the input owner wires it with `() => bindings`, `compileBindings` + persist, and the defaults table.
// Device codes: `KeyboardEvent.code` for keys, `Mouse0..Mouse4`, `WheelUp` / `WheelDown`, `Pad0..Pad16` (standard mapping).

import { formatString, STRINGS } from "../strings";

export type BindingTable = Readonly<Record<string, string>>;

/** What the rebinding screen needs from the input layer. */
export interface ControlsPort {
  /** The current table. Must return the same object until a change (it is a store snapshot). */
  readonly table: () => BindingTable;
  readonly subscribe: (listener: () => void) => () => void;
  /** Replaces the table. The input layer validates (it may throw), compiles, persists and notifies subscribers. */
  readonly apply: (next: BindingTable) => void;
  /** Restores the default table. */
  readonly reset: () => void;
}

/** Keys the screen refuses: Escape cancels, Tab is menu navigation. */
export const RESERVED_KEYS: readonly string[] = ["Escape", "Tab"];
/** Clears the binding being captured. */
export const CLEAR_KEYS: readonly string[] = ["Backspace", "Delete"];

export type InputKind = "key" | "pad";
export type DeviceClass = InputKind | "pointer";

export const CONTROL_GROUPS = [
  {
    id: "move",
    actions: ["moveForward", "moveBack", "moveLeft", "moveRight", "jump", "lope", "descend", "hopPack", "boost"],
  },
  {
    id: "tools",
    actions: [
      "toolPrimary",
      "toolSecondary",
      "holsterPrev",
      "holsterNext",
      "slot1",
      "slot2",
      "slot3",
      "slot4",
      "slot5",
      "slot6",
    ],
  },
  {
    id: "work",
    actions: [
      "interact",
      "pickupDrop",
      "puckForm",
      "laneLock",
      "ballast",
      "lampCycle",
      "seatSwitch",
      "cameraMode",
      "plotCard",
    ],
  },
] as const;

export type ControlGroupId = (typeof CONTROL_GROUPS)[number]["id"];

export function deviceClass(code: string): DeviceClass {
  if (/^Pad\d+$/.test(code)) return "pad";
  if (/^Mouse\d$/.test(code) || code === "WheelUp" || code === "WheelDown") return "pointer";
  return "key";
}

/** Device codes bound to `action` of one class, in a stable order (table insertion order). */
export function inputsFor(table: BindingTable, action: string, cls: DeviceClass): string[] {
  const out: string[] = [];
  for (const [code, bound] of Object.entries(table)) if (bound === action && deviceClass(code) === cls) out.push(code);
  return out;
}

export interface AssignResult {
  readonly table: BindingTable;
  /** The action that owned `code` before and lost it; `null` when the input was free or already `action`'s. */
  readonly stolenFrom: string | null;
  /** True when the action that lost the input now has no keyboard / pad input of that kind left. */
  readonly leftUnbound: boolean;
}

/**
 * Binds `code` (or clears with `null`) for `action`: every input of `kind` the action had is replaced (mouse and wheel
 * bindings stay), and the input moves away from whatever action used it (one input drives one action).
 */
export function assignInput(table: BindingTable, action: string, kind: InputKind, code: string | null): AssignResult {
  const next: Record<string, string> = {};
  for (const [device, bound] of Object.entries(table)) {
    if (bound === action && deviceClass(device) === kind) continue;
    next[device] = bound;
  }
  let stolenFrom: string | null = null;
  let leftUnbound = false;
  if (code !== null) {
    const previous = table[code];
    if (previous !== undefined && previous !== action) {
      stolenFrom = previous;
      delete next[code];
    }
    next[code] = action;
    if (stolenFrom !== null) leftUnbound = inputsFor(next, stolenFrom, kind).length === 0;
  }
  return { table: next, stolenFrom, leftUnbound };
}

const PAD_NAMES = STRINGS.menus.remap.padNames as Readonly<Record<string, string>>;
const KEY_NAMES = STRINGS.menus.remap.keyNames as Readonly<Record<string, string>>;
const POINTER_NAMES = STRINGS.menus.remap.pointerNames as Readonly<Record<string, string>>;

/** Player-facing name of a device code ("W", "Left Shift", "Left click", "A button"). Never a raw code for known inputs. */
export function inputLabel(code: string): string {
  const named = KEY_NAMES[code] ?? POINTER_NAMES[code];
  if (named !== undefined) return named;
  const pad = /^Pad(\d+)$/.exec(code);
  if (pad !== null)
    return PAD_NAMES[pad[1] as string] ?? formatString(STRINGS.menus.remap.padFallback, { n: pad[1] as string });
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter !== null) return letter[1] as string;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit !== null) return digit[1] as string;
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad !== null) return formatString(STRINGS.menus.remap.numpad, { key: numpad[1] as string });
  return code; // F-keys and rare keys fall back to the browser code, which reads fine ("F5", "MediaPlayPause")
}

/** "W / Up arrow" or the unbound word. */
export function inputsText(codes: readonly string[]): string {
  return codes.length === 0 ? STRINGS.menus.remap.unbound : codes.map(inputLabel).join(" / ");
}

/** In-memory port: for the dev sandbox and tests. The app backs the real port with the input module's bindings. */
export function createMemoryControlsPort(initial: BindingTable, defaults: BindingTable = initial): ControlsPort {
  let table = initial;
  const listeners = new Set<() => void>();
  const set = (next: BindingTable): void => {
    table = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    table: () => table,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    apply: set,
    reset: () => set(defaults),
  };
}
