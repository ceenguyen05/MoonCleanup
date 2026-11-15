// DOM device layer (M1-W3-T05): keyboard, mouse (pointer lock look), wheel and the standard gamepad, folded into an
// InputState. Listeners are created once at attach; events only update typed state (no allocation in the handlers).
// Text fields keep their keys. Blur, a hidden tab or a lost pointer lock release everything so nothing sticks.
//
// Gamepad: polled once per frame only after a `gamepadconnected` event; `navigator.getGamepads()` returns a fresh
// browser array per call (browser-side allocation, unavoidable), so keyboard/mouse-only play never calls it.

import { PAD_BUTTONS } from "./bindings";
import type { InputState } from "./input-state";

/** The parts of `window` the layer uses (tests pass a fake). */
export interface DomInputHost {
  addEventListener(type: string, listener: (event: Event) => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  readonly document: {
    readonly pointerLockElement: unknown;
    readonly hidden?: boolean;
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
  };
  readonly navigator?: { getGamepads?: () => readonly (GamepadLike | null)[] };
}

/** The element that takes pointer lock (the canvas stage). */
export interface PointerLockTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  requestPointerLock?(): unknown;
}

export interface GamepadLike {
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

interface KeyLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly target: unknown;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  preventDefault(): void;
}
interface MouseLike {
  readonly button: number;
  readonly movementX: number;
  readonly movementY: number;
  preventDefault(): void;
}
interface WheelLike {
  readonly deltaY: number;
  preventDefault(): void;
}

function isTextTarget(target: unknown): boolean {
  if (target === null || typeof target !== "object") return false;
  const t = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof t.tagName === "string" ? t.tagName : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable === true;
}

export class DomInput {
  /** Pointer lock is held by the target (mouse look and tool buttons are live). */
  locked = false;
  private pads = 0;
  private attached = false;

  private readonly onKeyDown = (ev: Event): void => {
    const e = ev as unknown as KeyLike;
    if (isTextTarget(e.target) || e.ctrlKey === true || e.metaKey === true) return;
    // Auto-repeat is ignored by InputState (key already down); still prevent the page scrolling on a held key.
    if (this.state.keyDown(e.code)) e.preventDefault();
  };
  private readonly onKeyUp = (ev: Event): void => {
    const e = ev as unknown as KeyLike;
    if (this.state.keyUp(e.code)) e.preventDefault();
  };
  private readonly onMouseDown = (ev: Event): void => {
    const e = ev as unknown as MouseLike;
    if (!this.locked) {
      // First click captures the mouse; it does not also swing the tool.
      this.target.requestPointerLock?.();
      return;
    }
    if (this.state.mouseButton(e.button, true)) e.preventDefault();
  };
  private readonly onMouseUp = (ev: Event): void => {
    const e = ev as unknown as MouseLike;
    this.state.mouseButton(e.button, false);
  };
  private readonly onMouseMove = (ev: Event): void => {
    const e = ev as unknown as MouseLike;
    if (this.locked) this.state.lookBy(e);
  };
  private readonly onWheel = (ev: Event): void => {
    const e = ev as unknown as WheelLike;
    if (!this.locked) return;
    e.preventDefault();
    this.state.wheel(e.deltaY);
  };
  private readonly onContextMenu = (ev: Event): void => {
    const e = ev as unknown as MouseLike;
    e.preventDefault();
  };
  private readonly onLockChange = (): void => {
    const locked = this.host.document.pointerLockElement === this.target;
    if (locked !== this.locked && !locked) this.state.clear();
    this.locked = locked;
  };
  private readonly onBlur = (): void => {
    this.state.clear();
  };
  private readonly onVisibility = (): void => {
    if (this.host.document.hidden === true) this.state.clear();
  };
  private readonly onPadConnected = (): void => {
    this.pads++;
  };
  private readonly onPadDisconnected = (): void => {
    this.pads = Math.max(0, this.pads - 1);
    if (this.pads === 0) this.state.setGamepad(0, 0, 0, 0, 0);
  };

  constructor(
    private readonly host: DomInputHost,
    private readonly target: PointerLockTarget,
    private readonly state: InputState,
  ) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const w = this.host;
    w.addEventListener("keydown", this.onKeyDown);
    w.addEventListener("keyup", this.onKeyUp);
    w.addEventListener("mouseup", this.onMouseUp);
    w.addEventListener("mousemove", this.onMouseMove);
    w.addEventListener("blur", this.onBlur);
    w.addEventListener("gamepadconnected", this.onPadConnected);
    w.addEventListener("gamepaddisconnected", this.onPadDisconnected);
    w.document.addEventListener("pointerlockchange", this.onLockChange);
    w.document.addEventListener("visibilitychange", this.onVisibility);
    this.target.addEventListener("mousedown", this.onMouseDown);
    this.target.addEventListener("wheel", this.onWheel);
    this.target.addEventListener("contextmenu", this.onContextMenu);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    const w = this.host;
    w.removeEventListener("keydown", this.onKeyDown);
    w.removeEventListener("keyup", this.onKeyUp);
    w.removeEventListener("mouseup", this.onMouseUp);
    w.removeEventListener("mousemove", this.onMouseMove);
    w.removeEventListener("blur", this.onBlur);
    w.removeEventListener("gamepadconnected", this.onPadConnected);
    w.removeEventListener("gamepaddisconnected", this.onPadDisconnected);
    w.document.removeEventListener("pointerlockchange", this.onLockChange);
    w.document.removeEventListener("visibilitychange", this.onVisibility);
    this.target.removeEventListener("mousedown", this.onMouseDown);
    this.target.removeEventListener("wheel", this.onWheel);
    this.target.removeEventListener("contextmenu", this.onContextMenu);
    this.state.clear();
  }

  /** Per frame: the first standard-mapping gamepad, only while one is connected. */
  pollGamepads(): void {
    if (this.pads === 0) return;
    const list = this.host.navigator?.getGamepads?.();
    if (list === undefined) return;
    for (let i = 0; i < list.length; i++) {
      const pad = list[i];
      if (pad === null || pad === undefined || !pad.connected) continue;
      let pressed = 0;
      const n = Math.min(PAD_BUTTONS, pad.buttons.length);
      for (let b = 0; b < n; b++) if (pad.buttons[b]!.pressed) pressed |= 1 << b;
      const ax = pad.axes;
      this.state.setGamepad(ax[0] ?? 0, ax[1] ?? 0, ax[2] ?? 0, ax[3] ?? 0, pressed);
      return;
    }
  }
}
