// View state of the online panel as a pure reducer (testable without a DOM).

import type { OnlineFlowResult, OnlineStage } from "./online-flow";
import type { OnlineFailure } from "./online-model";

export type PanelView = "choose" | "private" | "recovery" | "created" | "onShift";

export interface PanelState {
  readonly view: PanelView;
  /** The flow is running (inputs and primary buttons are disabled), with its stage for the status line. */
  readonly busy: OnlineStage | null;
  readonly error: OnlineFailure | null;
  /** Invite code of the Private Shift this panel just created. */
  readonly inviteCode: string | null;
  /** One-time recovery code of a guest account created by this flow (memory only; cleared on confirm). */
  readonly recoveryCode: string | null;
  /** The view shown after the recovery code is confirmed. */
  readonly afterRecovery: "created" | "onShift";
}

export type PanelAction =
  | { readonly type: "go"; readonly view: "choose" | "private" | "onShift" }
  | { readonly type: "busy"; readonly stage: OnlineStage }
  | { readonly type: "result"; readonly result: OnlineFlowResult }
  | { readonly type: "stalled" }
  | { readonly type: "recoveryConfirmed" }
  | { readonly type: "clearError" };

export function initialPanelState(active: boolean): PanelState {
  return {
    view: active ? "onShift" : "choose",
    busy: null,
    error: null,
    inviteCode: null,
    recoveryCode: null,
    afterRecovery: "onShift",
  };
}

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "go":
      return { ...state, view: action.view, error: null };
    case "busy":
      return { ...state, busy: action.stage, error: null };
    case "clearError":
      return state.error === null ? state : { ...state, error: null };
    case "stalled":
      return { ...state, view: "private", busy: null, error: { key: "stalled", retryAfterS: 0 } };
    case "recoveryConfirmed":
      return { ...state, view: state.afterRecovery, recoveryCode: null };
    case "result": {
      const { result } = action;
      if (!result.ok) return { ...state, busy: null, error: result.failure };
      const next = result.inviteCode !== null ? "created" : "onShift";
      return {
        ...state,
        busy: null,
        error: null,
        inviteCode: result.inviteCode,
        recoveryCode: result.recoveryCode,
        afterRecovery: next,
        view: result.recoveryCode !== null ? "recovery" : next,
      };
    }
  }
}
