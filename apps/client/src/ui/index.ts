// Public surface of the ui module (ui-ux-motion-designer). Other client folders import from "../ui" only.

export { UiModule, UI_HOST_ID, type FlushableUiStore, type UiModuleOptions } from "./module";
export { HUD_TEST_SCENE_ID, parseUiUrlOptions, type GlassMode, type MotionMode, type UiUrlOptions } from "./ui-options";
export { STRINGS, GAME_TITLE } from "./strings";
export { QUALITY_PRESETS, NO_INTENTS, type QualityPreset, type UiIntentPort } from "./menus/intents";
export type { UiNavAction } from "./menus/focus-nav";
export { connView, parseEntryTarget, type OnlineAuthPort, type OnlineEntryPort } from "./online/online-model";
export { createMemoryControlsPort, type BindingTable, type ControlsPort } from "./menus/controls-model";
export {
  NEAR_PARCEL_REWARD_LM,
  sphereBearingDeg,
  type NearParcelSource,
  type ParcelBearingFn,
  type ParcelDir,
} from "./hud/parcels-store";
export { userScaleFromSetting } from "./tokens/display-metrics";
