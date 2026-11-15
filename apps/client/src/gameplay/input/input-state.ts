// DOM-free player input state (M1-W3-T05). Device events (keys, mouse, wheel, gamepad) are folded into held-action
// counts, latched presses and a live look angle; `sample` writes one sim input command (sim/input v1) per sim tick.
//
// - Buttons are LEVELS on the wire; a press shorter than one tick is latched so it reaches at least one input.
// - A jump press while airborne also sets `hopPack` (contract: "client sets it on a jump press while airborne").
// - Look (yaw / pitch) is applied to the camera on the very next rendered frame (E13 first visual), and quantised into
//   every sampled input.
// - Allocation-free after construction: typed arrays, a reused Set of down key codes, no closures per event.

import {
  INPUT_AXIS_MAX,
  INPUT_BUTTON_BIT,
  INPUT_BUTTON_MASK,
  INPUT_PITCH_MAX,
  INPUT_TOOL_PARAM_MAX,
  INPUT_YAW_STEPS,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import {
  ACTION_CAMERA_MODE,
  ACTION_COUNT,
  ACTION_MOVE_BACK,
  ACTION_MOVE_FORWARD,
  ACTION_MOVE_LEFT,
  ACTION_MOVE_RIGHT,
  ACTION_NONE,
  ACTION_PLOT_CARD,
  ACTION_SLOT_BASE,
  MOUSE_BUTTONS,
  PAD_BUTTONS,
  compileBindings,
  DEFAULT_BINDINGS,
  type BindingTable,
  type CompiledBindings,
} from "./bindings";

/**
 * Frame time handed to hot-path calls as an object: V8 boxes a double passed to (or returned from) a call it does not
 * inline, so per-frame APIs here never take time as a number argument.
 */
export interface FrameTime {
  /** Seconds since the previous rendered frame. */
  readonly dt: number;
  /** Clock of the frame (`performance.now()` ms). */
  readonly nowMs: number;
}

export type MutableInputCommand = { -readonly [K in keyof SimInputCommand]: SimInputCommand[K] };

export function createInputCommand(): MutableInputCommand {
  return { seq: 0, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 0 };
}

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
/** Look pitch limit (rad): 85 degrees up or down. */
export const PITCH_LIMIT_RAD = (85 * Math.PI) / 180;
/** Radial dead zone of the gamepad sticks. */
export const STICK_DEADZONE = 0.15;

/** Yaw (rad, any value) -> contract code 0..65535 (0..2 pi, toward the heading frame's east). */
export function yawToCode(yawRad: number): number {
  const code = Math.round((yawRad / TWO_PI) * INPUT_YAW_STEPS) % INPUT_YAW_STEPS;
  return code < 0 ? code + INPUT_YAW_STEPS : code;
}

/** Contract yaw code -> radians. */
export function codeToYaw(code: number): number {
  return (code / INPUT_YAW_STEPS) * TWO_PI;
}

/** Pitch (rad, + up) -> contract code -127..127 (-90..+90 degrees). */
export function pitchToCode(pitchRad: number): number {
  const c = Math.round((pitchRad / HALF_PI) * INPUT_PITCH_MAX);
  return c > INPUT_PITCH_MAX ? INPUT_PITCH_MAX : c < -INPUT_PITCH_MAX ? -INPUT_PITCH_MAX : c;
}

export interface LookSettings {
  /** Mouse radians per CSS pixel of movement. */
  mouseRadPerPx: number;
  /** Gamepad right-stick turn rate at full deflection (rad/s). */
  padRadPerS: number;
  invertY: boolean;
}

export const DEFAULT_LOOK: Readonly<LookSettings> = { mouseRadPerPx: 0.0022, padRadPerS: 2.6, invertY: false };

/** Applies a radial dead zone and rescales the rest to 0..1; writes into `out[0..1]`. */
function deadzone(x: number, y: number, out: Float64Array): void {
  const m = Math.sqrt(x * x + y * y);
  if (m <= STICK_DEADZONE) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  const scaled = Math.min(1, (m - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / m;
  out[0] = x * scaled;
  out[1] = y * scaled;
}

/** Gamepad menu-navigation bits (`InputState.takeNav`). */
export const PAD_NAV_UP = 1;
export const PAD_NAV_DOWN = 2;
export const PAD_NAV_LEFT = 4;
export const PAD_NAV_RIGHT = 8;
export const PAD_NAV_CONFIRM = 16;
export const PAD_NAV_BACK = 32;
export const PAD_NAV_PREV = 64;
export const PAD_NAV_NEXT = 128;
/** Standard-mapping button index -> nav bit (A 0, B 1, LB 4, RB 5, D-pad 12..15). */
const PAD_NAV_OF_BUTTON: readonly number[] = [
  PAD_NAV_CONFIRM,
  PAD_NAV_BACK,
  0,
  0,
  PAD_NAV_PREV,
  PAD_NAV_NEXT,
  0,
  0,
  0,
  0,
  0,
  0,
  PAD_NAV_UP,
  PAD_NAV_DOWN,
  PAD_NAV_LEFT,
  PAD_NAV_RIGHT,
  0,
];

export class InputState {
  /** Live look angles: yaw about local up (0 = heading-frame north, + toward east), pitch + up. */
  yawRad = 0;
  pitchRad = -0.35;
  /** Set by the avatar pose source each frame: a jump press while airborne adds `hopPack`. */
  airborne = false;
  /** Aim distance code 0..255, written by the tool aim each frame. */
  toolParam = 0;
  readonly look: LookSettings = { ...DEFAULT_LOOK };
  /**
   * The render frame is a mirror image of the moon (the dust scene's plot frame, det -1): mouse / stick turning and
   * strafing flip so that "right" on screen stays right. The sim sees a mirrored but consistent player.
   */
  mirrored = false;
  /** Counted per sample; read by tests and the perf HUD. */
  samples = 0;
  /** Bumped on every press, release and gamepad move change (instrumentation). */
  changes = 0;

  private bindings: CompiledBindings;
  private readonly held = new Uint8Array(ACTION_COUNT);
  private readonly downKeys = new Set<string>();
  private readonly mouseDown = new Uint8Array(MOUSE_BUTTONS);
  private readonly padDown = new Uint8Array(PAD_BUTTONS);
  private readonly stick = new Float64Array(2);
  private padMoveX = 0;
  private padMoveY = 0;
  private padLookX = 0;
  private padLookY = 0;
  private latched = 0;
  private pendingSlot = -1;
  private cameraToggles = 0;
  private interactPresses = 0;
  private plotCardToggles = 0;
  /** Rising edges of gamepad buttons 0..16 since the last `takePadEdges` (bit i = Pad<i>), recorded while suspended too. */
  private padEdges = 0;
  /** A menu is open: game actions are ignored (look and gamepad menu edges still work). */
  private suspended = false;
  /** Rising edges of the gamepad menu buttons since the last `takeNav` (PAD_NAV_* bits). */
  private navEdges = 0;

  constructor(table: BindingTable = DEFAULT_BINDINGS) {
    this.bindings = compileBindings(table);
  }

  /** Replaces the bindings (rebind from settings). Releases everything held so no action sticks. */
  setBindings(table: BindingTable): void {
    this.bindings = compileBindings(table);
    this.clear();
  }

  /** A key went down. Returns whether it is bound (the DOM layer then prevents the default action). */
  keyDown(code: string): boolean {
    const action = this.bindings.keys.get(code);
    if (action === undefined) return false;
    if (this.downKeys.has(code)) return true; // auto-repeat or a duplicate event
    this.downKeys.add(code);
    this.press(action);
    return true;
  }

  keyUp(code: string): boolean {
    const action = this.bindings.keys.get(code);
    if (action === undefined) return false;
    if (!this.downKeys.delete(code)) return true;
    this.release(action);
    return true;
  }

  mouseButton(button: number, down: boolean): boolean {
    if (button < 0 || button >= MOUSE_BUTTONS) return false;
    const action = this.bindings.mouse[button]!;
    if (action === ACTION_NONE) return false;
    const was = this.mouseDown[button] === 1;
    if (down === was) return true;
    this.mouseDown[button] = down ? 1 : 0;
    if (down) this.press(action);
    else this.release(action);
    return true;
  }

  /** Wheel notch: a tap of the bound action (`deltaY` < 0 = up). */
  wheel(deltaY: number): void {
    if (deltaY === 0) return;
    const action = deltaY < 0 ? this.bindings.wheelUp : this.bindings.wheelDown;
    if (action === ACTION_NONE) return;
    this.press(action);
    this.release(action);
  }

  /**
   * Mouse look in CSS pixels (the pointer-lock MouseEvent itself, or any `movementX/Y` object; an object because
   * fractional movement passed as double arguments would be boxed). Applied to `yawRad` / `pitchRad` at once.
   */
  lookBy(m: { readonly movementX: number; readonly movementY: number }): void {
    const s = this.look.mouseRadPerPx;
    const dy = m.movementY;
    const dx = this.mirrored ? -m.movementX : m.movementX;
    this.turn(dx * s, (this.look.invertY ? dy : -dy) * s);
  }

  /**
   * Gamepad state of this frame (standard mapping). `pressed` is a bit mask of buttons 0..16; axes are raw -1..1 with
   * y down. Button edges become presses/releases.
   */
  setGamepad(lx: number, ly: number, rx: number, ry: number, pressed: number): void {
    deadzone(lx, ly, this.stick);
    const mx = this.stick[0]!;
    const my = -this.stick[1]!;
    if (Math.abs(mx - this.padMoveX) > 0.05 || Math.abs(my - this.padMoveY) > 0.05) this.changes++;
    this.padMoveX = mx;
    this.padMoveY = my;
    deadzone(rx, ry, this.stick);
    this.padLookX = this.stick[0]!;
    this.padLookY = this.stick[1]!;
    const pad = this.bindings.pad;
    for (let i = 0; i < PAD_BUTTONS; i++) {
      const down = (pressed >>> i) & 1;
      if (down === this.padDown[i]) continue;
      this.padDown[i] = down;
      if (down === 1) {
        this.navEdges |= PAD_NAV_OF_BUTTON[i] ?? 0;
        this.padEdges |= 1 << i;
      }
      const action = pad[i]!;
      if (action === ACTION_NONE) continue;
      if (down === 1) this.press(action);
      else this.release(action);
    }
  }

  /** Per rendered frame: integrates the gamepad look stick. Takes the frame object (a double argument would box). */
  advance(t: FrameTime): void {
    if (this.padLookX === 0 && this.padLookY === 0) return;
    const r = this.look.padRadPerS * t.dt;
    this.turn(
      (this.mirrored ? -this.padLookX : this.padLookX) * r,
      (this.look.invertY ? this.padLookY : -this.padLookY) * r,
    );
  }

  /** Releases everything (window blur, pointer-lock loss, rebind): no key may stay stuck. */
  clear(): void {
    this.held.fill(0);
    this.downKeys.clear();
    this.mouseDown.fill(0);
    this.padDown.fill(0);
    this.padMoveX = this.padMoveY = this.padLookX = this.padLookY = 0;
  }

  /** Bit mask of the logical buttons currently held (no latches). */
  heldButtons(): number {
    let bits = 0;
    for (let i = 0; i < 16; i++) if (this.held[i]! > 0) bits |= 1 << i;
    return bits;
  }

  /** Whether an action code is held (movement included). */
  isHeld(action: number): boolean {
    return this.held[action]! > 0;
  }

  /**
   * Writes one input for the next sim tick into `cmd` (seq is the caller's). Clears the latches: every press reached
   * at least this input.
   */
  sample(cmd: MutableInputCommand): MutableInputCommand {
    const h = this.held;
    // While suspended `held` stays empty (presses are dropped); the stick is ignored too.
    const pm = this.suspended ? 0 : 1;
    let mx = (h[ACTION_MOVE_RIGHT]! > 0 ? 1 : 0) - (h[ACTION_MOVE_LEFT]! > 0 ? 1 : 0) + this.padMoveX * pm;
    let my = (h[ACTION_MOVE_FORWARD]! > 0 ? 1 : 0) - (h[ACTION_MOVE_BACK]! > 0 ? 1 : 0) + this.padMoveY * pm;
    const m = Math.sqrt(mx * mx + my * my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    cmd.moveX = Math.round((this.mirrored ? -mx : mx) * INPUT_AXIS_MAX) + 0;
    cmd.moveY = Math.round(my * INPUT_AXIS_MAX);
    cmd.yaw = yawToCode(this.yawRad);
    cmd.pitch = pitchToCode(this.pitchRad);
    cmd.buttons = (this.heldButtons() | this.latched) & 0xffff;
    const tp = Math.round(this.toolParam);
    cmd.toolParam = tp < 0 ? 0 : tp > INPUT_TOOL_PARAM_MAX ? INPUT_TOOL_PARAM_MAX : tp;
    this.latched = 0;
    this.samples++;
    return cmd;
  }

  /**
   * The input `sample` would write now, without consuming the latches (the Solo predictor's speculative partial step
   * of the live input between sends). `seq` is left alone.
   */
  peek(cmd: MutableInputCommand): MutableInputCommand {
    const latched = this.latched;
    const samples = this.samples;
    this.sample(cmd);
    this.latched = latched;
    this.samples = samples;
    return cmd;
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  /**
   * Menu open (true) / closed (false). On every change all game actions are released (held, latches, pending slot,
   * interact presses, camera toggles), so nothing sticks either way; while suspended new presses are dropped. Keys or
   * buttons still physically down when the menu closes do nothing until pressed again (their key-down was consumed).
   * Look (mouse / right stick) and `takeNav` edges keep working.
   */
  setSuspended(on: boolean): void {
    if (on === this.suspended) return;
    this.suspended = on;
    this.held.fill(0);
    this.latched = 0;
    this.pendingSlot = -1;
    this.interactPresses = 0;
    this.cameraToggles = 0;
    this.plotCardToggles = 0;
    this.changes++;
  }

  /** Holster slot 0..5 pressed since the last call (a `select_tool` intent), or -1. */
  takeSlot(): number {
    const s = this.pendingSlot;
    this.pendingSlot = -1;
    return s;
  }

  /** Interact presses (E / pad X) since the last call (the app opens the Desk with it when in reach). */
  takeInteractPresses(): number {
    const n = this.interactPresses;
    this.interactPresses = 0;
    return n;
  }

  /**
   * Gamepad menu-navigation edges since the last call (PAD_NAV_* bits: D-pad, A confirm, B back, LB/RB prev/next),
   * independent of the bindings; the app hands them to the UI while a menu is open. 0 when nothing was pressed.
   */
  takeNav(): number {
    const n = this.navEdges;
    this.navEdges = 0;
    return n;
  }

  /** Plot Card key presses (C) since the last call (the app toggles the card with them). */
  takePlotCardToggles(): number {
    const n = this.plotCardToggles;
    this.plotCardToggles = 0;
    return n;
  }

  /**
   * Gamepad buttons newly pressed since the last call, as a bit mask (bit i = `Pad<i>`), independent of the bindings
   * and of the suspended flag: the rebinding screen takes the next press from here (`UiModule.offerInput`). 0 when none.
   */
  takePadEdges(): number {
    const n = this.padEdges;
    this.padEdges = 0;
    return n;
  }

  /** Camera-mode toggles since the last call. */
  takeCameraToggles(): number {
    const n = this.cameraToggles;
    this.cameraToggles = 0;
    return n;
  }

  private turn(dYaw: number, dPitch: number): void {
    let y = this.yawRad + dYaw;
    if (y >= TWO_PI || y < 0) y -= Math.floor(y / TWO_PI) * TWO_PI;
    this.yawRad = y;
    const p = this.pitchRad + dPitch;
    this.pitchRad = p > PITCH_LIMIT_RAD ? PITCH_LIMIT_RAD : p < -PITCH_LIMIT_RAD ? -PITCH_LIMIT_RAD : p;
  }

  private press(action: number): void {
    this.changes++;
    if (this.suspended) return;
    this.held[action] = this.held[action]! + 1;
    if (action < 16) {
      this.latched |= 1 << action;
      if (action === INPUT_BUTTON_BIT.jump && this.airborne) this.latched |= INPUT_BUTTON_MASK.hopPack;
      if (action === INPUT_BUTTON_BIT.interact) this.interactPresses++;
    } else if (action >= ACTION_SLOT_BASE && action < ACTION_SLOT_BASE + 6) {
      this.pendingSlot = action - ACTION_SLOT_BASE;
    } else if (action === ACTION_CAMERA_MODE) {
      this.cameraToggles++;
    } else if (action === ACTION_PLOT_CARD) {
      this.plotCardToggles++;
    }
  }

  private release(action: number): void {
    this.changes++;
    const n = this.held[action]!;
    this.held[action] = n > 0 ? n - 1 : 0;
  }
}
