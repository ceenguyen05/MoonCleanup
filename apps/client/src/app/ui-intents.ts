// Menu intents of the composition root (integrator round 5, Job B): the full `UiIntentPort` the UI module uses (it takes
// either `intents` or `purchase`, not both). Purchases go through the purchase port with the price the menu showed;
// the quality preset goes to the render module's quality service as a user choice and is persisted.

import type { QualityPresetId, UiStore } from "@moon-cleanup/shared";
import type { PlotCardActivation, UiIntentPort } from "../ui";

export interface UiIntentsOptions {
  readonly store: Pick<UiStore, "getState">;
  /** `PurchasePort.purchase`. */
  readonly purchase: (itemId: string, priceLm?: number) => string | null;
  readonly quality: { setPreset(preset: QualityPresetId, source: "user"): void };
  readonly saveQuality: (preset: QualityPresetId) => void;
  /** The rebinding screen opened / closed (default: nothing; menus already suspend gameplay input). */
  readonly openControls?: (open: boolean) => void;
  /** Plot Card activation chosen in Settings (default: nothing). */
  readonly setPlotCardMode?: (mode: PlotCardActivation) => void;
}

export function createUiIntents(o: UiIntentsOptions): UiIntentPort {
  return {
    purchaseDeskItem: (itemId) => {
      const item = o.store.getState().desk.items.find((candidate) => candidate.itemId === itemId);
      o.purchase(itemId, item?.priceLm);
    },
    purchaseBoardNode: (nodeId) => {
      const node = o.store.getState().board.nodes.find((candidate) => candidate.nodeId === nodeId);
      o.purchase(nodeId, node?.nextCostLm ?? undefined);
    },
    setQualityPreset: (preset) => {
      o.quality.setPreset(preset, "user");
      o.saveQuality(preset);
    },
    openControls: (open) => o.openControls?.(open !== false),
    setPlotCardMode: (mode) => o.setPlotCardMode?.(mode),
  };
}
