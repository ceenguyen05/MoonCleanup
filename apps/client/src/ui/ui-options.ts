// URL parameters the ui module reads (QA and the screenshot harness). Pure parsing, no DOM access.
//
//   ?scene=hud-test           crispness bench page over the canvas (VT-M0-10). Use `&preset=low&scale=floor` for a 0.5 render scale
//   ?wakePreview=waking|connecting|lost   forces the "Waking the moon" overlay state locally (never writes the store)
//   ?glass=blur|solid         glass panel mode; default `auto` (blur, unless OS reduce-transparency)
//   ?uimotion=full|reduced    overrides prefers-reduced-motion; default follows the OS
//   ?hudscale=0.8..1.5        player HUD size setting (default 1)
//   ?uihud=1                  shows the in-game HUD even before a shift is ready (sandbox and screenshot lanes)

import { NET_CONNECTION_STATES, type NetConnectionState } from "@moon-cleanup/shared";
import { USER_SCALE_MAX, USER_SCALE_MIN } from "./tokens/display-metrics";

export const HUD_TEST_SCENE_ID = "hud-test";

export type GlassMode = "auto" | "blur" | "solid";
export type MotionMode = "system" | "reduced" | "full";

export interface UiUrlOptions {
  readonly hudTest: boolean;
  readonly wakePreview: NetConnectionState | null;
  readonly glass: GlassMode;
  readonly motion: MotionMode;
  readonly hudScale: number;
  /** `?uihud=1`: draw the in-game HUD without waiting for `shift.ready`. */
  readonly hudForce: boolean;
}

export function parseUiUrlOptions(search: string): UiUrlOptions {
  const params = new URLSearchParams(search);
  const preview = params.get("wakePreview");
  const wakePreview = NET_CONNECTION_STATES.find((state) => state === preview) ?? null;
  const glass = params.get("glass");
  const motion = params.get("uimotion");
  const scale = Number(params.get("hudscale"));
  return {
    hudTest: params.get("scene") === HUD_TEST_SCENE_ID,
    wakePreview,
    glass: glass === "blur" || glass === "solid" ? glass : "auto",
    motion: motion === "reduced" ? "reduced" : motion === "full" ? "full" : "system",
    hudScale:
      params.get("hudscale") !== null && Number.isFinite(scale)
        ? Math.min(USER_SCALE_MAX, Math.max(USER_SCALE_MIN, scale))
        : 1,
    hudForce: params.get("uihud") === "1",
  };
}
