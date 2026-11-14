// Fixed seed, the standard scene (one pre-cleaned reference strip), scene bookmarks and the camera path drivers.
// Every approach renders the same scene from the same poses: world-and-dust-simulation section 10.
import type { StrokeRecord } from "@moon-cleanup/shared";
import {
  MOON_RADIUS_M,
  add,
  advanceAlong,
  dirFromLatLon,
  normalize,
  scale,
  strokeBetween,
  tangentFrame,
  toPosition,
  type V3,
} from "./geometry";
import type { CameraPose, CleaningState, ContestGrid } from "./types";

/** The one seed of the contest. Bots, scene, robots and the A/B shuffle all derive from it. */
export const HARNESS_SEED = 20261114;

export const SIM_TICK_HZ = 20;

/** Reference site near the equator on the near side; the dust is cleaned in a strip so every approach shows an edge. */
export const SITE = { latDeg: 8, lonDeg: 24 } as const;

/** Plot pitch of GP(128,0): sqrt(4 pi R^2 / 163,842), about 17.5 m. */
export const PLOT_PITCH_M = Math.sqrt((4 * Math.PI * MOON_RADIUS_M ** 2) / 163_842);

export const TOOLS = {
  deskDuster: { toolCode: 1, widthCm: 60, depth16: 16 },
  bristleBroom: { toolCode: 2, widthCm: 120, depth16: 32 },
  bulldust: { toolCode: 9, widthCm: 300, depth16: 48 },
  stamp: { toolCode: 63, widthCm: 25, depth16: 0 },
} as const;

interface SiteFrame {
  readonly origin: V3;
  readonly east: V3;
  readonly north: V3;
}

function siteFrame(): SiteFrame {
  const origin = dirFromLatLon(SITE.latDeg, SITE.lonDeg);
  const { east, north } = tangentFrame(origin);
  return { origin, east, north };
}

/** Unit direction at planar offset (eastM, northM) from the site, on the reference sphere. */
export function sitePoint(eastM: number, northM: number): V3 {
  const f = siteFrame();
  return normalize(add(f.origin, add(scale(f.east, eastM / MOON_RADIUS_M), scale(f.north, northM / MOON_RADIUS_M))));
}

function pose(
  tSec: number,
  eye: V3,
  heightM: number,
  target: V3,
  sunElevationDeg: number,
  sunAzimuthDeg = 90,
): CameraPose {
  const up = normalize(eye);
  const pos = toPosition(eye, heightM);
  const fwd = normalize([target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]] as V3);
  return { tSec, position: pos, forward: fwd, up, heightM, sunElevationDeg, sunAzimuthDeg };
}

// ---- Scene setup ------------------------------------------------------------------------------------------------------

/** The reference strip: 2 m wide, 40 m long, running north from the site. Cleaned with the Bristle Broom (120 cm x2). */
export function sceneSetupStrokes(grid: ContestGrid): StrokeRecord[] {
  const out: StrokeRecord[] = [];
  const stepM = 0.5;
  let tick = 1;
  for (const lane of [-0.6, 0.6]) {
    let prev = sitePoint(lane, 0);
    for (let n = stepM; n <= 40; n += stepM) {
      const next = sitePoint(lane, n);
      out.push(strokeBetween(grid, prev, next, tick++, { ...TOOLS.bristleBroom, actorSlot: 0 }));
      prev = next;
    }
  }
  return out;
}

// ---- Bookmarks --------------------------------------------------------------------------------------------------------

export interface Bookmark {
  readonly id: string;
  readonly label: string;
  /** Which question the screenshot answers (blind A/B, edge width, readability, outline visibility, orbit read). */
  readonly purpose: "edge" | "stamp-outline" | "wake" | "orbit" | "cluster";
  readonly pose: CameraPose;
}

/** Eye-level shot of the strip's west edge from `distM` away at `sunDeg`. */
function edgeShot(id: string, label: string, distM: number, sunDeg: number): Bookmark {
  const eye = sitePoint(-0.6 - 0.6 - distM, 20);
  const target = toPosition(sitePoint(-1.2, 20), 0);
  return { id, label, purpose: "edge", pose: pose(0, eye, 1.7, target, sunDeg, sunDeg < 15 ? 270 : 180) };
}

/** Fixed scene bookmarks (ids are the file names the A/B generator and the capture step share). */
export function makeBookmarks(): Bookmark[] {
  const stamp = pose(0, sitePoint(0, 20), 6, toPosition(sitePoint(0, 24), 0), 45, 180);
  const wake = pose(0, sitePoint(-6, -4), 3, toPosition(sitePoint(0, 30), 0), 45, 180);
  const orbitEye = normalize(add(siteOrigin(), [0.0, 0.15, 0.0] as V3));
  const orbit = pose(0, orbitEye, 6000, [0, 0, 0], 60, 180);
  const cluster = pose(0, sitePoint(-8, -8), 4, toPosition(sitePoint(0, 0), 0), 45, 180);
  return [
    edgeShot("B01-edge-2m-noon", "Strip edge from 2 m, sun 60 deg", 2, 60),
    edgeShot("B02-edge-10m-noon", "Strip edge from 10 m, sun 60 deg", 10, 60),
    edgeShot("B03-edge-50m-noon", "Strip edge from 50 m, sun 60 deg", 50, 60),
    edgeShot("B04-edge-2m-lowsun", "Strip edge from 2 m, sun 5 deg", 2, 5),
    edgeShot("B05-edge-10m-lowsun", "Strip edge from 10 m, sun 5 deg", 10, 5),
    {
      id: "B06-stamp-outline",
      label: "Hexagon outline after Inspector's Stamp",
      purpose: "stamp-outline",
      pose: stamp,
    },
    { id: "B07-skiff-wake", label: "Skiff wake across plots", purpose: "wake", pose: wake },
    { id: "B08-orbit-globe", label: "Survey Globe orbit read", purpose: "orbit", pose: orbit },
    { id: "B09-cluster-16", label: "16 bots clustered, cleaned pattern", purpose: "cluster", pose: cluster },
  ];
}

function siteOrigin(): V3 {
  return siteFrame().origin;
}

// ---- Camera path drivers ----------------------------------------------------------------------------------------------

export interface CameraSample {
  readonly pose: CameraPose;
  readonly cleaning: CleaningState | null;
  /** Index of the camera frame. */
  readonly frame: number;
}

export interface CameraPath {
  readonly scenario: "S1" | "S2" | "S3" | "S7" | "S8";
  readonly id: string;
  readonly durationSec: number;
  /** Total number of samples at `fps`. */
  samples(fps: number): Generator<CameraSample>;
}

/** One sample of a walker moving along the great circle from `start` in unit tangent `tangent`, `facing` -1 looks back. */
function walker(
  tSec: number,
  start: V3,
  tangent: V3,
  arcM: number,
  heightM: number,
  headAheadM: number,
  sunDeg: number,
  tool: { toolCode: number; widthCm: number; depth16: number } | null,
  frame: number,
  facing: 1 | -1 = 1,
): CameraSample {
  const at = advanceAlong(start, tangent, arcM);
  const head = advanceAlong(start, tangent, arcM + headAheadM * facing).dir;
  const target = toPosition(head, 0);
  const eyePose = pose(tSec, at.dir, heightM, target, sunDeg, 90);
  return {
    frame,
    pose: { ...eyePose, forward: normalize(add(scale(at.heading, facing), scale(eyePose.up, -0.25))) },
    cleaning: tool ? { headDir: head, ...tool } : null,
  };
}

/**
 * S1: 3 minutes of walking at 1.5 m/s, 1.7 m eye. Four 45 s legs: sun 5 deg then 45 deg, each with Desk Duster then
 * Bristle Broom. The path crosses fresh dust (west of the reference strip) so the tools always have something to clean.
 */
export function s1Path(): CameraPath {
  const legs = [
    { sun: 5, tool: TOOLS.deskDuster },
    { sun: 5, tool: TOOLS.bristleBroom },
    { sun: 45, tool: TOOLS.deskDuster },
    { sun: 45, tool: TOOLS.bristleBroom },
  ] as const;
  const legSec = 45;
  const speed = 1.5;
  return {
    scenario: "S1",
    id: "s1-walk",
    durationSec: legSec * legs.length,
    *samples(fps) {
      const n = Math.round(legSec * legs.length * fps);
      for (let i = 0; i < n; i++) {
        const t = i / fps;
        const li = Math.min(legs.length - 1, Math.floor(t / legSec));
        const leg = legs[li] ?? legs[0];
        // Each leg walks a fresh 67.5 m lane, lanes 4 m apart east of x = -30, heading north on even legs and south on odd.
        const local = t - li * legSec;
        const north = li % 2 === 0;
        const lane = sitePoint(-30 - 4 * li, north ? -30 : 37.5);
        const f = tangentFrame(lane);
        yield walker(t, lane, north ? f.north : scale(f.north, -1), speed * local, 1.7, 0.6, leg.sun, leg.tool, i);
      }
    },
  };
}

/**
 * S2: Skiff + Bulldust at 20 m/s across 30 plots (about 525 m), 2 minutes, out and back. Camera 3 m above and behind.
 */
export function s2Path(): CameraPath {
  const lengthM = 30 * PLOT_PITCH_M;
  const speed = 20;
  return {
    scenario: "S2",
    id: "s2-skiff",
    durationSec: 120,
    *samples(fps) {
      const n = Math.round(120 * fps);
      const start = sitePoint(60, 0);
      const f = tangentFrame(start);
      for (let i = 0; i < n; i++) {
        const t = i / fps;
        const d = (speed * t) % (2 * lengthM);
        const out = d <= lengthM;
        const s = out ? d : 2 * lengthM - d;
        yield walker(t, start, f.north, s, 3, 6, 45, TOOLS.bulldust, i, out ? 1 : -1);
      }
    },
  };
}

/** S3: Survey Globe orbit spin, 60 s, one full turn about the polar axis at 6000 m from the centre, sun fixed. */
export function s3Path(): CameraPath {
  return {
    scenario: "S3",
    id: "s3-orbit",
    durationSec: 60,
    *samples(fps) {
      const n = Math.round(60 * fps);
      const tilt = 0.25;
      for (let i = 0; i < n; i++) {
        const t = i / fps;
        const a = (2 * Math.PI * t) / 60;
        const eye = normalize([Math.cos(a), tilt, -Math.sin(a)] as V3);
        const pos = toPosition(eye, 6000 - MOON_RADIUS_M);
        const up: V3 = [0, 1, 0];
        const fwd = normalize([-pos[0], -pos[1], -pos[2]] as V3);
        yield {
          frame: i,
          pose: {
            tSec: t,
            position: pos,
            forward: fwd,
            up,
            heightM: 6000 - MOON_RADIUS_M,
            sunElevationDeg: 60,
            sunAzimuthDeg: 180,
          },
          cleaning: null,
        };
      }
    },
  };
}

/** S7: late-join viewpoint: standing at the cluster looking at the cleaned ground, 10 s once the snapshot has landed. */
export function s7Path(): CameraPath {
  const mark = makeBookmarks().find((b) => b.id === "B09-cluster-16");
  return {
    scenario: "S7",
    id: "s7-latejoin",
    durationSec: 10,
    *samples(fps) {
      const n = Math.round(10 * fps);
      for (let i = 0; i < n; i++) {
        yield { frame: i, pose: { ...(mark?.pose as CameraPose), tSec: i / fps }, cleaning: null };
      }
    },
  };
}

/**
 * S8: backend parity. Visits every bookmark for `dwellSec` so each backend captures identical frames. Pairs of
 * (webgpu, webgl2) captures of the same bookmark are compared by the reviewer (no difference beyond 1 texel).
 */
export function s8Path(dwellSec = 2): CameraPath {
  const marks = makeBookmarks();
  return {
    scenario: "S8",
    id: "s8-parity",
    durationSec: dwellSec * marks.length,
    *samples(fps) {
      const per = Math.round(dwellSec * fps);
      let frame = 0;
      for (const m of marks) {
        for (let k = 0; k < per; k++) yield { frame: frame++, pose: { ...m.pose, tSec: frame / fps }, cleaning: null };
      }
    },
  };
}

export const ALL_PATHS = { S1: s1Path, S2: s2Path, S3: s3Path, S7: s7Path, S8: s8Path } as const;
