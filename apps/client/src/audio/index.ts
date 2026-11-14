// Public surface of the audio module. The composition root imports `AudioModule` and `browserEnv` from here.

export { AudioModule, browserEnv, CAPTION_CUES, type AudioEnv, type AudioModuleOptions } from "./module";
export { AudioGraph, distanceGain, dbToLin, BUS_SLIDER, GROUND_MUFFLE_HZ, PANEL_MUFFLE_HZ } from "./graph";
export { VoiceManager } from "./voice-manager";
export { CuePlayer, type PlayOptions, type LoopHandle } from "./player";
export { EventRouter, type AudioActions } from "./event-router";
export { MusicDirector } from "./music";
export { CUE_RECIPES } from "./recipes";
export type { AContext } from "./webaudio-types";
