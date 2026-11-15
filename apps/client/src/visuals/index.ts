// Public surface of the visuals module (technical-artist). Other client folders import from "../visuals" only.
// The composition root registers `new VisualsModule()` after `render` (module-boundaries section 4).

export { createLookdevScene, LOOKDEV_SCENE_IDS, VisualsModule, type VisualsModuleOptions } from "./module";
// Regolith look-dev scenes (M0-W3-T04) and the typical worksite (M0-W3-T08). `VisualsModule` routes `?scene=s02|s03|typical`
// itself; the constructors are exported for hosts that drive a scene directly (dev entry, tests).
export { S02_SCENE_ID, S02Scene } from "./lookdev/s02-first-stroke";
export { S03_SCENE_ID, S03Scene } from "./lookdev/s03-distance-ladder";
export type {
  LookdevHooks,
  LookdevHost,
  LookdevProbes,
  LookdevScene,
  LookdevSceneOptions,
} from "./lookdev/s02-lookdev-kit";
export { TYPICAL_SCENE_ID, TypicalWorksite } from "./lookdev/typical-worksite";
export type { LookCameraInfo, LookDustAtlasInfo, LookHooks, LookInfo } from "./lookdev/hooks";
export type { LookState } from "./lookdev/scene-base";
// `?scene=dust` stroke feed port (M1-W3-T02b): the composition root adapts the Solo host's ledger view to it.
export { DUST_SCENE_ID, DUST_SCENE_SITE, type DustFeedPort } from "./dust/dust-worksite";

// Look rig building blocks (M0-W3-T07 follow-up): a host that does not run `VisualsModule` (the render bench) can drive the
// same sun / CSM, sky and post look through these. Export-only: no behaviour change.
export { HORIZON_VISIBILITY_KEY, MoonShadowNode, SunRig, type CascadeInfo } from "./lighting/sun-rig";
export { createKeyState, earthExposureGain, litFraction, resolveKey, type KeyState } from "./lighting/key-light";
// Day clock and Crown Lamp light hooks (M1-W2-T02): the sun path of decision D1 and the lamp levels for W6.
export { applySunPath, DEFAULT_DAY_CYCLE, ExposureRamp, sunAzimuthDeg } from "./lighting/day-clock";
export {
  createCrownLamp,
  CROWN_LAMP_LEVELS,
  setCrownLampLevel,
  updateCrownLamp,
  type CrownLampLevel,
  type CrownLampLevelId,
} from "./lighting/crown-lamp";
export { SkyRig, type SkyFrame } from "./sky/sky-rig";
export { limitingMagnitude } from "./sky/star-catalog";
export { CameraOnlyVelocity } from "./post/camera-velocity";
export { createLookStages, LOOK_GRADE, NEUTRAL_GRADE, type LookGrade, type LookStageHandles } from "./post/look-stages";
// Per-feature URL knobs of the look rig (M0-W3-T08): `?gtao=&traa=&aa=&shadowres=&cascades=&bloom=&sky=&grade=` ...
export {
  applyLookKnobs,
  DEFAULT_LOOK_KNOBS,
  describeLookKnobs,
  parseLookKnobs,
  sunShadowsEnabled,
  type LookKnobs,
} from "./look-knobs";
