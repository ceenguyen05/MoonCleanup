// Data-driven, rebindable device bindings (M1-W3-T05 client input; game-feel-and-controls.md section 6). Devices map
// onto the 16 LOGICAL buttons of the sim input contract (@moon-cleanup/shared sim/input v1) plus four movement
// directions, two look-only actions and six direct holster slots (sent as rare `select_tool` intents). A binding table
// is plain data (JSON-safe) so the settings UI can store a player's rebinds; `compileBindings` turns it into lookup
// tables once, so the hot path never searches strings.

import { INPUT_BUTTON_MASK, type InputButton } from "@moon-cleanup/shared";

/** Non-button actions: movement directions, holster slots 1..6 and the camera-mode toggle. */
export const EXTRA_ACTIONS = [
  "moveForward",
  "moveBack",
  "moveLeft",
  "moveRight",
  "slot1",
  "slot2",
  "slot3",
  "slot4",
  "slot5",
  "slot6",
  "cameraMode",
  "plotCard",
] as const;
export type ExtraAction = (typeof EXTRA_ACTIONS)[number];
export type InputAction = InputButton | ExtraAction;

/**
 * A binding table. Keys are `KeyboardEvent.code` (layout independent), mouse buttons `Mouse0..Mouse4`, wheel
 * `WheelUp` / `WheelDown`, gamepad standard-mapping buttons `Pad0..Pad16`. One input may drive one action; several
 * inputs may drive the same action.
 */
export type BindingTable = Readonly<Record<string, InputAction>>;

/** Default on-foot bindings (keyboard + mouse and the standard gamepad mapping). */
export const DEFAULT_BINDINGS: BindingTable = {
  KeyW: "moveForward",
  ArrowUp: "moveForward",
  KeyS: "moveBack",
  ArrowDown: "moveBack",
  KeyA: "moveLeft",
  ArrowLeft: "moveLeft",
  KeyD: "moveRight",
  ArrowRight: "moveRight",
  Space: "jump",
  ShiftLeft: "lope",
  ShiftRight: "lope",
  ControlLeft: "descend",
  // Plot Card toggle (game-feel-and-controls 6.2: C; Touchdown/descend stays on Left Ctrl).
  KeyC: "plotCard",
  KeyE: "interact",
  KeyB: "ballast",
  KeyL: "lampCycle",
  KeyQ: "holsterPrev",
  KeyR: "holsterNext",
  KeyF: "laneLock",
  KeyG: "puckForm",
  KeyX: "pickupDrop",
  KeyT: "seatSwitch",
  KeyV: "cameraMode",
  Digit1: "slot1",
  Digit2: "slot2",
  Digit3: "slot3",
  Digit4: "slot4",
  Digit5: "slot5",
  Digit6: "slot6",
  Mouse0: "toolPrimary",
  Mouse2: "toolSecondary",
  WheelUp: "holsterPrev",
  WheelDown: "holsterNext",
  // Standard gamepad (game-feel-and-controls 6.4): A jump, B descend, X interact, Y puck, LB/RB holster, LT trait,
  // RT sweep, L3 lope, R3 lane lock, D-pad Up Plot Card (tap) / camera 1P-3P (hold, InputState.holdThresholdS),
  // D-pad down ballast, D-pad left pickup, D-pad right lamp. b9 Menu (Start) stays reserved for Pause; b16 Home is the
  // browser's. Interim until their spec features exist: View (b8) seat switch (spec: Survey Globe / Shift Roster);
  // ballast on D-pad down (spec: Ping wheel, ballast on D-pad left); pickup on D-pad left (spec: B).
  Pad0: "jump",
  Pad1: "descend",
  Pad2: "interact",
  Pad3: "puckForm",
  Pad4: "holsterPrev",
  Pad5: "holsterNext",
  Pad6: "toolSecondary",
  Pad7: "toolPrimary",
  Pad8: "seatSwitch",
  Pad10: "lope",
  Pad11: "laneLock",
  Pad12: "plotCard",
  Pad13: "ballast",
  Pad14: "pickupDrop",
  Pad15: "lampCycle",
};

/** Action codes of the compiled table: 0..15 logical button bits, then the extras. */
export const ACTION_NONE = -1;
export const ACTION_MOVE_FORWARD = 16;
export const ACTION_MOVE_BACK = 17;
export const ACTION_MOVE_LEFT = 18;
export const ACTION_MOVE_RIGHT = 19;
/** slot1..slot6 = ACTION_SLOT_BASE + 0..5. */
export const ACTION_SLOT_BASE = 20;
export const ACTION_CAMERA_MODE = 26;
export const ACTION_PLOT_CARD = 27;
export const ACTION_COUNT = 28;

/** Gamepad standard mapping button count read by the poller. */
export const PAD_BUTTONS = 17;
/** Mouse buttons tracked (`MouseEvent.button` 0..4). */
export const MOUSE_BUTTONS = 5;

function actionCode(action: InputAction): number {
  if (action in INPUT_BUTTON_MASK) return Math.log2(INPUT_BUTTON_MASK[action as InputButton]);
  const extra = EXTRA_ACTIONS.indexOf(action as ExtraAction);
  if (extra < 0) return ACTION_NONE;
  return 16 + extra;
}

/** Lookup tables built once from a BindingTable (rebuild after a rebind; never per frame). */
export interface CompiledBindings {
  /** `KeyboardEvent.code` -> action code. */
  readonly keys: ReadonlyMap<string, number>;
  /** Mouse button index -> action code (ACTION_NONE when unbound). */
  readonly mouse: Int8Array;
  /** Wheel up / down -> action code. */
  readonly wheelUp: number;
  readonly wheelDown: number;
  /** Gamepad button index -> action code. */
  readonly pad: Int8Array;
}

/** Validates and compiles a table. Unknown actions or device names throw (a corrupt saved rebind is a bug to see). */
export function compileBindings(table: BindingTable): CompiledBindings {
  const keys = new Map<string, number>();
  const mouse = new Int8Array(MOUSE_BUTTONS).fill(ACTION_NONE);
  const pad = new Int8Array(PAD_BUTTONS).fill(ACTION_NONE);
  let wheelUp = ACTION_NONE;
  let wheelDown = ACTION_NONE;
  for (const [device, action] of Object.entries(table)) {
    const code = actionCode(action);
    if (code === ACTION_NONE) throw new Error(`bindings: unknown action "${String(action)}" for ${device}`);
    const mouseMatch = /^Mouse([0-4])$/.exec(device);
    const padMatch = /^Pad(\d{1,2})$/.exec(device);
    if (mouseMatch !== null) mouse[Number(mouseMatch[1])] = code;
    else if (padMatch !== null) {
      const i = Number(padMatch[1]);
      if (i >= PAD_BUTTONS) throw new Error(`bindings: gamepad button ${device} is out of range`);
      pad[i] = code;
    } else if (device === "WheelUp") wheelUp = code;
    else if (device === "WheelDown") wheelDown = code;
    else if (device.length > 0) keys.set(device, code);
    else throw new Error("bindings: empty device name");
  }
  return { keys, mouse, pad, wheelUp, wheelDown };
}

/**
 * Revision of DEFAULT_BINDINGS. A stored table replaces the defaults wholesale, so a default changed later never
 * reaches a player with a stored rebind unless it is migrated once. Rev 1 = tables stored before the revision existed;
 * rev 2 moves the pad layout to the spec D-pad: Pad12 lamp -> Plot Card (tap) / camera (hold), lamp to Pad15, seat
 * switch from Pad15 to Pad8 (whose camera toggle moves to the Pad12 hold).
 */
export const BINDINGS_REV = 2;

/** One device rewrite: applied when the stored device holds `from` (undefined = unbound). */
interface Rewrite {
  readonly device: string;
  readonly from: InputAction | undefined;
  readonly to: InputAction;
}

/** Rewrites per revision; a group applies atomically, only if every `from` still matches (an untouched layout). */
const REV_REWRITES: Readonly<Record<number, readonly Rewrite[]>> = {
  2: [
    { device: "Pad8", from: "cameraMode", to: "seatSwitch" },
    { device: "Pad12", from: "lampCycle", to: "plotCard" },
    { device: "Pad15", from: "seatSwitch", to: "lampCycle" },
  ],
};

function hasPadBinding(table: BindingTable, action: InputAction): boolean {
  for (const [device, bound] of Object.entries(table)) if (bound === action && /^Pad\d{1,2}$/.test(device)) return true;
  return false;
}

export interface BindingsMigration {
  readonly table: BindingTable;
  /** Always >= BINDINGS_REV after migrating; store it next to the table. */
  readonly rev: number;
  /** Whether `table` differs from the input (the caller then re-saves it). */
  readonly changed: boolean;
}

/**
 * Brings a stored table (saved at `storedRev`; `null` = saved before revisions existed = 1) up to BINDINGS_REV. A
 * revision's rewrites apply only when the player has not touched those devices (every `from` matches) and the moved-in
 * Plot Card has no pad binding yet, so a player's own layout is never overwritten. Runs once per revision: once the rev
 * is stored, later rebinds stay as the player left them.
 */
export function migrateBindings(stored: BindingTable, storedRev: number | null): BindingsMigration {
  const from = storedRev ?? 1;
  if (from >= BINDINGS_REV) return { table: stored, rev: from, changed: false };
  let next: Record<string, InputAction> | null = null;
  for (let rev = from + 1; rev <= BINDINGS_REV; rev++) {
    const group = REV_REWRITES[rev];
    if (group === undefined) continue;
    const cur: BindingTable = next ?? stored;
    if (!group.every((r) => cur[r.device] === r.from)) continue;
    if (group.some((r) => r.to === "plotCard") && hasPadBinding(cur, "plotCard")) continue;
    next ??= { ...stored };
    for (const r of group) next[r.device] = r.to;
  }
  if (next === null) return { table: stored, rev: BINDINGS_REV, changed: false };
  compileBindings(next); // validate
  return { table: next, rev: BINDINGS_REV, changed: true };
}

/** Returns a copy of `base` with `device` rebound to `action` (or unbound with `null`). */
export function rebind(base: BindingTable, device: string, action: InputAction | null): BindingTable {
  const next: Record<string, InputAction> = { ...base };
  if (action === null) delete next[device];
  else next[device] = action;
  compileBindings(next); // validate
  return next;
}
