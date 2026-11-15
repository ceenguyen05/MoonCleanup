import type { ReactElement } from "react";
import { Hud } from "./hud/Hud";
import { ParcelsContext, type ParcelsStore } from "./hud/parcels-store";
import { HudTestPage } from "./hud-test/HudTestPage";
import { NO_INTENTS, UiIntentsContext, type UiIntentPort } from "./menus/intents";
import { MenuHost } from "./menus/MenuHost";
import type { ControlsPort } from "./menus/controls-model";
import { UiControlsContext, UiPrefsContext, type UiPrefsStore } from "./menus/ui-local";
import { OnlineEntry } from "./online/OnlineEntry";
import type { OnlineEntryPort } from "./online/online-model";
import { WakingOverlay } from "./screens/WakingOverlay";
import { useUiSelector } from "./ui-context";
import type { UiUrlOptions } from "./ui-options";

/** Everything the UI draws over the canvas: HUD, menus (Desk, Console, Settings), waking overlay, online entry, bench. */
export function UiRoot({
  options,
  online = null,
  intents = NO_INTENTS,
  prefs,
  controls = null,
  parcels,
}: {
  /** Near Parcels / outpost bearings for the compass. Default: a private empty store (chip hidden). */
  readonly parcels?: ParcelsStore;
  readonly options: UiUrlOptions;
  /** The online entry port; absent when the app does not offer online play (solo only, harness lanes). */
  readonly online?: OnlineEntryPort | null;
  /** Purchase / settings intents the menus raise; the app routes them to gameplay and net. Default: no-ops. */
  readonly intents?: UiIntentPort;
  /** UI-local settings state (quality preset mirror, rebinding screen). Default: a private store. */
  readonly prefs?: UiPrefsStore;
  /** The input layer's binding table for the rebinding screen; `null` shows "not available". */
  readonly controls?: ControlsPort | null;
}): ReactElement {
  const shiftReady = useUiSelector((state) => state.shift.ready);
  const body = (
    <UiIntentsContext.Provider value={intents}>
      <UiControlsContext.Provider value={controls}>
        {!options.hudTest && (shiftReady || options.hudForce) && <Hud />}
        {options.hudTest && <HudTestPage />}
        {!options.hudTest && <MenuHost />}
        <WakingOverlay previewConn={options.wakePreview} />
        {online !== null && <OnlineEntry port={online} />}
      </UiControlsContext.Provider>
    </UiIntentsContext.Provider>
  );
  const withParcels =
    parcels === undefined ? body : <ParcelsContext.Provider value={parcels}>{body}</ParcelsContext.Provider>;
  return prefs === undefined ? (
    withParcels
  ) : (
    <UiPrefsContext.Provider value={prefs}>{withParcels}</UiPrefsContext.Provider>
  );
}
