// Renderer-neutral shared capture scene: the one framing every prototype's capture()/view() must render so GPU A/B
// captures of P1/P2/P3 differ only by their dust approach, never by camera, sun, ground, exposure or schedule.
// Pure data plus pure functions: no DOM, no three, no GPU. Poses come from scene.ts (bookmarks and path drivers).
import { HARNESS_SEED, makeBookmarks, SITE, sitePoint, TOOLS } from "./scene";
import { MOON_RADIUS_M, add, cross, normalize, scale, tangentFrame, type V3 } from "./geometry";
import type { CameraPose } from "./types";

export const CAPTURE_SCENE_VERSION = 1;

/** Output and projection. Native resolution PNG, never resized; DPR fixed at 1 so pixels are comparable. */
export const CAPTURE_VIEW = {
  widthPx: 1920,
  heightPx: 1080,
  devicePixelRatio: 1,
  /** Vertical field of view in degrees (visual-target section 2.2 measures at vFOV 60). */
  vFovDeg: 60,
  near: 0.05,
  far: 20_000,
  /** Square pixels, pinhole, no lens distortion, no depth of field, no motion blur. */
  antialias: "none-or-preset-default-recorded-in-sidecar",
} as const;

/** Ground height source: the reference sphere, identical for all renderers. packages/world height is NOT used. */
export const GROUND = {
  kind: "reference-sphere",
  radiusM: MOON_RADIUS_M,
  /** Height above the sphere at any direction: zero. Normals are the radial direction. No relief, no craters. */
  heightM: (_dir: V3): number => 0,
  /** Linear-light albedo. The dust overlay darkens the clean ground to `dustAlbedo` where dust opacity is 1. */
  cleanAlbedo: 0.55,
  dustAlbedo: 0.12,
} as const;

/** Fixed lighting and exposure. Lambert only: out = albedo * sunIlluminance * max(0, n.l) + ambient. */
export const LIGHTING = {
  sunIlluminance: 3.0,
  ambient: 0.02,
  /** Fixed exposure multiplier applied before encoding. No auto-exposure, no bloom, no tone-map curve beyond clamp. */
  exposure: 1.0,
  toneMap: "clamp",
  /** Output transfer: linear to sRGB (piecewise). */
  outputEncoding: "srgb",
  /** Hard sun shadow from the ground only is allowed; no cast shadows from props (there are none in this scene). */
  shadows: "none",
} as const;

/** Frame schedule: the captured frame is index `settleFrames` of a held pose, so temporal effects have settled. */
export const FRAME_SCHEDULE = {
  simTickHz: 20,
  captureFps: 60,
  /** Frames rendered and discarded at a bookmark before the PNG (TAA/history/streaming warm-up). */
  settleFrames: 30,
  /** Sim time between scene setup completing and the first capture, in ticks, so all setup echoes have landed. */
  settleTicks: 40,
} as const;

/** Unit vector pointing from the ground toward the sun, in the Moon-centred frame, for a pose (site frame azimuth). */
export function sunDirection(pose: CameraPose): V3 {
  const up = normalize(pose.up);
  const { east, north } = tangentFrame(up);
  const az = (pose.sunAzimuthDeg * Math.PI) / 180;
  const el = (pose.sunElevationDeg * Math.PI) / 180;
  const horiz = add(scale(north, Math.cos(az)), scale(east, Math.sin(az)));
  return normalize(add(scale(horiz, Math.cos(el)), scale(up, Math.sin(el))));
}

/** Camera right vector for a pose (forward x up), unit. */
export function cameraRight(pose: CameraPose): V3 {
  return normalize(cross(pose.forward as V3, pose.up as V3));
}

/** World size in metres of one screen pixel at `distM` along the view axis (vFOV and height from CAPTURE_VIEW). */
export function pixelFootprintM(distM: number, view = CAPTURE_VIEW): number {
  return (2 * distM * Math.tan((view.vFovDeg * Math.PI) / 360)) / view.heightPx;
}

/** Linear lit albedo of clean ground or full dust (opacity 0..1) under the fixed light; before exposure and encoding. */
export function shadeLinear(pose: CameraPose, dustOpacity: number): number {
  const l = sunDirection(pose);
  const ndl = Math.max(0, l[0] * pose.up[0] + l[1] * pose.up[1] + l[2] * pose.up[2]);
  const a = GROUND.cleanAlbedo + (GROUND.dustAlbedo - GROUND.cleanAlbedo) * Math.min(1, Math.max(0, dustOpacity));
  return (a * LIGHTING.sunIlluminance * ndl + LIGHTING.ambient) * LIGHTING.exposure;
}

/** Sweep paths of the scene setup in site-plane metres (east, north); the expected cleaned region for correlation. */
export interface SweepSegment {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly widthM: number;
}

/** The reference strip: two Bristle Broom lanes at east -0.6 and +0.6, north 0..40 (scene.ts sceneSetupStrokes). */
export function referenceStripSweeps(): SweepSegment[] {
  const w = TOOLS.bristleBroom.widthCm / 100;
  return [
    { from: [-0.6, 0], to: [-0.6, 40], widthM: w },
    { from: [0.6, 0], to: [0.6, 40], widthM: w },
  ];
}

export interface CaptureSceneSpec {
  readonly version: number;
  readonly seed: number;
  readonly site: typeof SITE;
  readonly view: typeof CAPTURE_VIEW;
  readonly ground: { kind: string; radiusM: number; cleanAlbedo: number; dustAlbedo: number };
  readonly lighting: typeof LIGHTING;
  readonly schedule: typeof FRAME_SCHEDULE;
  readonly sweeps: readonly SweepSegment[];
  /** Bookmarks with their sun direction, ready for any renderer. */
  readonly bookmarks: readonly { id: string; label: string; purpose: string; pose: CameraPose; sunDir: V3 }[];
  /** Expected 3D position of the strip's west edge midpoint, which edge-width crops centre on. */
  readonly edgeAnchor: V3;
}

/** The complete scene spec as plain JSON-serialisable data (written to results/capture-scene.json by the CLI). */
export function captureSceneSpec(): CaptureSceneSpec {
  return {
    version: CAPTURE_SCENE_VERSION,
    seed: HARNESS_SEED,
    site: SITE,
    view: CAPTURE_VIEW,
    ground: {
      kind: GROUND.kind,
      radiusM: GROUND.radiusM,
      cleanAlbedo: GROUND.cleanAlbedo,
      dustAlbedo: GROUND.dustAlbedo,
    },
    lighting: LIGHTING,
    schedule: FRAME_SCHEDULE,
    sweeps: referenceStripSweeps(),
    bookmarks: makeBookmarks().map((b) => ({
      id: b.id,
      label: b.label,
      purpose: b.purpose,
      pose: b.pose,
      sunDir: sunDirection(b.pose),
    })),
    edgeAnchor: sitePoint(-1.2, 20),
  };
}
