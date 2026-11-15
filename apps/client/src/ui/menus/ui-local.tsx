// UI-local external store for state that belongs to the settings screens, not to the game: the render quality preset the
// player picked (mirrored from the `quality.changed` event, so the screen always shows what the renderer really runs), the
// rebinding screen (open, capture in progress, last result) and the controls port. Same pattern as the game UI store:
// typed state, `subscribe` / `getState`, read with `useSyncExternalStore` selectors, written only through its methods.
// It is not game state and carries nothing the sim reads.

import { createContext, useContext, useSyncExternalStore } from "react";
import type { QualityPresetId } from "@moon-cleanup/shared";
import {
  assignInput,
  CLEAR_KEYS,
  RESERVED_KEYS,
  deviceClass,
  type ControlsPort,
  type InputKind,
} from "./controls-model";

export interface QualityView {
  /** The preset in effect (or just requested, until `quality.changed` confirms or clamps it). */
  readonly preset: QualityPresetId;
  /** Highest preset the running backend offers. */
  readonly maxPreset: QualityPresetId;
}

export interface CaptureState {
  readonly action: string;
  readonly kind: InputKind;
}

export type RemapNote =
  | { readonly kind: "bound"; readonly action: string; readonly code: string }
  | { readonly kind: "cleared"; readonly action: string }
  | {
      readonly kind: "moved";
      readonly action: string;
      readonly code: string;
      readonly from: string;
      readonly leftUnbound: boolean;
    }
  | { readonly kind: "reserved"; readonly code: string }
  | { readonly kind: "failed" }
  | { readonly kind: "reset" };

export interface UiPrefsState {
  readonly quality: QualityView;
  readonly controlsOpen: boolean;
  readonly capture: CaptureState | null;
  readonly note: RemapNote | null;
}

export interface UiPrefsStore {
  readonly getState: () => UiPrefsState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setQuality: (patch: Partial<QualityView>) => void;
  readonly setControlsOpen: (open: boolean) => void;
  readonly setCapture: (capture: CaptureState | null) => void;
  readonly setNote: (note: RemapNote | null) => void;
}

export function createUiPrefsStore(initial?: Partial<UiPrefsState>): UiPrefsStore {
  let state: UiPrefsState = {
    quality: { preset: "medium", maxPreset: "ultra" },
    controlsOpen: false,
    capture: null,
    note: null,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<UiPrefsState>): void => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setQuality: (patch) => {
      const next = { ...state.quality, ...patch };
      if (next.preset === state.quality.preset && next.maxPreset === state.quality.maxPreset) return;
      set({ quality: next });
    },
    setControlsOpen: (open) => {
      if (open === state.controlsOpen) return;
      set({ controlsOpen: open, capture: null, note: null });
    },
    setCapture: (capture) => set({ capture, note: capture === null ? state.note : null }),
    setNote: (note) => set({ note }),
  };
}

export const UiPrefsContext = createContext<UiPrefsStore>(createUiPrefsStore());
export const UiControlsContext = createContext<ControlsPort | null>(null);

export function useUiPrefs<T>(selector: (state: UiPrefsState) => T): T {
  const prefs = useContext(UiPrefsContext);
  return useSyncExternalStore(
    prefs.subscribe,
    () => selector(prefs.getState()),
    () => selector(prefs.getState()),
  );
}

export function useUiPrefsStore(): UiPrefsStore {
  return useContext(UiPrefsContext);
}

export function useControlsPort(): ControlsPort | null {
  return useContext(UiControlsContext);
}

/**
 * Offers one device input (`KeyboardEvent.code` or `Pad<n>`) to a capture in progress. Returns true when a capture was
 * waiting for that kind of input (the input is consumed, even when refused). Keys: Escape cancels (handled by the caller),
 * Tab is refused, Backspace / Delete clear. The same function serves the keyboard (React handler) and the gamepad
 * (`UiModule.offerInput`, called by the input module while `capturing()` is "pad").
 */
export function commitCapture(prefs: UiPrefsStore, port: ControlsPort | null, code: string): boolean {
  const capture = prefs.getState().capture;
  if (capture === null) return false;
  if (port === null) {
    prefs.setCapture(null);
    return true;
  }
  const isPad = deviceClass(code) === "pad";
  if (capture.kind === "pad" ? !isPad : isPad) return false;
  if (capture.kind === "key" && RESERVED_KEYS.includes(code)) {
    prefs.setNote({ kind: "reserved", code });
    return true;
  }
  const clear = capture.kind === "key" && CLEAR_KEYS.includes(code);
  const result = assignInput(port.table(), capture.action, capture.kind, clear ? null : code);
  try {
    port.apply(result.table);
  } catch {
    prefs.setCapture(null);
    prefs.setNote({ kind: "failed" });
    return true;
  }
  prefs.setCapture(null);
  if (clear) prefs.setNote({ kind: "cleared", action: capture.action });
  else if (result.stolenFrom !== null)
    prefs.setNote({
      kind: "moved",
      action: capture.action,
      code,
      from: result.stolenFrom,
      leftUnbound: result.leftUnbound,
    });
  else prefs.setNote({ kind: "bound", action: capture.action, code });
  return true;
}
