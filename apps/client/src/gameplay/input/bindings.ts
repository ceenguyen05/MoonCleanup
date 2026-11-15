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
  // Standard gamepad: A jump, B descend, X interact, Y puck, LB/RB holster, LT trait, RT sweep, L3 lope, R3 lane lock,
  // Select camera, D-pad up lamp, D-pad down ballast, D-pad left pickup, D-pad right seat.
  Pad0: "jump",
  Pad1: "descend",
  Pad2: "interact",
  Pad3: "puckForm",
  Pad4: "holsterPrev",
  Pad5: "holsterNext",
  Pad6: "toolSecondary",
  Pad7: "toolPrimary",
  Pad8: "cameraMode",
  Pad10: "lope",
  Pad11: "laneLock",
  Pad12: "lampCycle",
  Pad13: "ballast",
  Pad14: "pickupDrop",
  Pad15: "seatSwitch",
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

/** Returns a copy of `base` with `device` rebound to `action` (or unbound with `null`). */
export function rebind(base: BindingTable, device: string, action: InputAction | null): BindingTable {
  const next: Record<string, InputAction> = { ...base };
  if (action === null) delete next[device];
  else next[device] = action;
  compileBindings(next); // validate
  return next;
}
