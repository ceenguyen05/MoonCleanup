// Player intents the menus raise. The UI never changes sim state: a click calls one of these callbacks and the integrator
// (app composition root) routes it to gameplay / net, which validates it and answers through the store (`desk`, `board`,
// `wallet`, `holster`). The default port does nothing, so the UI renders and tests without a backend.

import { createContext, useContext } from "react";
import { QUALITY_PRESET_IDS, type QualityPresetId } from "@moon-cleanup/shared";

export const QUALITY_PRESETS = QUALITY_PRESET_IDS;
export type QualityPreset = QualityPresetId;

export interface UiIntentPort {
  /** Requisitions Desk: buy (or level up) `itemId` (`tool.<id>` / `gear.<id>`). */
  readonly purchaseDeskItem: (itemId: string) => void;
  /** Ops Console: promote `nodeId` (`node.<id>`) one level. */
  readonly purchaseBoardNode: (nodeId: string) => void;
  /**
   * Settings: the player chose a render quality preset. Wire to `quality.setPreset(preset, "user")`; the render module
   * answers with `quality.changed`, which the UI mirrors (clamped to what the backend offers).
   */
  readonly setQualityPreset: (preset: QualityPreset) => void;
  /**
   * Settings: the rebinding screen opened (`true`) or closed (`false`), so the input layer can pause gameplay bindings
   * while the player is remapping. The screen itself is drawn by the UI over `UiModuleOptions.controls`.
   */
  readonly openControls: (open?: boolean) => void;
  /** Settings > Controls: Plot Card activation, tap-to-toggle or hold-to-show. Wire to input + persistence. */
  readonly setPlotCardMode: (mode: PlotCardActivation) => void;
}

/** Same values as the input layer's `PlotCardMode` (the UI does not import gameplay). */
export const PLOT_CARD_ACTIVATIONS = ["toggle", "hold"] as const;
export type PlotCardActivation = (typeof PLOT_CARD_ACTIVATIONS)[number];

const noop = (): void => undefined;

export const NO_INTENTS: UiIntentPort = {
  purchaseDeskItem: noop,
  purchaseBoardNode: noop,
  setQualityPreset: noop,
  openControls: noop,
  setPlotCardMode: noop,
};

export const UiIntentsContext = createContext<UiIntentPort>(NO_INTENTS);

export function useUiIntents(): UiIntentPort {
  return useContext(UiIntentsContext);
}
