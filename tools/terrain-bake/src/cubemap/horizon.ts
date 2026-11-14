// Step 8b: far-occluder horizon map (rendering-pipeline 5.2). Per cube texel, the horizon elevation angle in 8 azimuths
// (0, 45, ... 315 degrees from local north toward east), quantised to uint8 over [minAngleDeg, maxAngleDeg].
// Occluders closer than minOccluderM are ignored (CSM covers them). The ray walks the great circle on the R sphere and
// uses exact spherical geometry: elevation = atan2(Vup, Vhorizontal) with V = Q - P, so curvature drop is included.
// Local frame: east = normalize(cross(Y, p)), north = cross(p, east). At the poles east := (0, 0, -1).

import { FACE_COUNT, directionFromTan, QUARTER_PI, axisCoord, type Vec3 } from "./mapping.js";
import { sampleCubeHeight, type CubeSampleSource } from "./sample.js";
import type { HorizonFile } from "./codec.js";

export interface HorizonParams {
  readonly faceSize: number;
  readonly radiusM: number;
  readonly minOccluderM: number;
  /** Geometric step ratio between successive sample distances. */
  readonly stepRatio: number;
  readonly maxDistanceM: number;
  readonly minAngleDeg: number;
  readonly maxAngleDeg: number;
}

export const DEFAULT_HORIZON: HorizonParams = {
  faceSize: 512,
  radiusM: 2000,
  minOccluderM: 20,
  stepRatio: 1.1,
  maxDistanceM: 3000,
  minAngleDeg: -16,
  maxAngleDeg: 60,
};

export interface HorizonStats {
  readonly texels: number;
  readonly samples: number;
  readonly clampedLow: number;
  readonly clampedHigh: number;
  readonly angleMinDeg: number;
  readonly angleMaxDeg: number;
  readonly angleMeanDeg: number;
  readonly stepsPerRay: number;
}

export function bakeHorizon(
  cube: CubeSampleSource,
  heightMaxM: number,
  params: HorizonParams = DEFAULT_HORIZON,
): { file: HorizonFile; stats: HorizonStats } {
  const n = params.faceSize;
  const azimuths = 8;
  const planes = new Uint8Array(FACE_COUNT * azimuths * n * n);
  const R = params.radiusM;
  const distances: number[] = [];
  for (let d = params.minOccluderM; d <= params.maxDistanceM; d *= params.stepRatio) distances.push(d);
  const cosT = distances.map((d) => Math.cos(d / R));
  const sinT = distances.map((d) => Math.sin(d / R));
  const cosAz = Array.from({ length: azimuths }, (_, k) => Math.cos((k * Math.PI) / 4));
  const sinAz = Array.from({ length: azimuths }, (_, k) => Math.sin((k * Math.PI) / 4));
  const tan = new Float64Array(n);
  for (let i = 0; i < n; i++) tan[i] = Math.tan(axisCoord(i, n) * QUARTER_PI);

  const p: Vec3 = { x: 0, y: 0, z: 0 };
  const span = params.maxAngleDeg - params.minAngleDeg;
  const toDeg = 180 / Math.PI;
  let samples = 0;
  let clampedLow = 0;
  let clampedHigh = 0;
  let sum = 0;
  let aMin = Infinity;
  let aMax = -Infinity;

  for (let face = 0; face < FACE_COUNT; face++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        directionFromTan(face, tan[i] ?? 0, tan[j] ?? 0, p);
        const hr = sampleCubeHeight(cube, p.x, p.y, p.z);
        // east = cross(Y, p) = (pz, 0, -px)
        let ex = p.z;
        let ez = -p.x;
        const el = Math.hypot(ex, ez);
        if (el < 1e-9) {
          ex = 0;
          ez = -1;
        } else {
          ex /= el;
          ez /= el;
        }
        // north = cross(p, east)
        const nx = p.y * ez;
        const ny = p.z * ex - p.x * ez;
        const nz = -p.y * ex;
        for (let k = 0; k < azimuths; k++) {
          const ca = cosAz[k] ?? 1;
          const sa = sinAz[k] ?? 0;
          const tx = ca * nx + sa * ex;
          const ty = ca * ny;
          const tz = ca * nz + sa * ez;
          let best = -Infinity;
          for (let s = 0; s < distances.length; s++) {
            const c = cosT[s] ?? 1;
            const sn = sinT[s] ?? 0;
            const ho = sampleCubeHeight(cube, p.x * c + tx * sn, p.y * c + ty * sn, p.z * c + tz * sn);
            samples++;
            const up = (R + ho) * c - (R + hr);
            const hz = (R + ho) * sn;
            const t = up / hz;
            if (t > best) best = t;
            const bound = (R + heightMaxM) * c - (R + hr);
            if (bound < 0 && best >= bound / ((R + heightMaxM) * sn)) break;
          }
          const deg = Math.atan(best) * toDeg;
          sum += deg;
          if (deg < aMin) aMin = deg;
          if (deg > aMax) aMax = deg;
          let q = Math.round(((deg - params.minAngleDeg) / span) * 255);
          if (q < 0) {
            q = 0;
            clampedLow++;
          } else if (q > 255) {
            q = 255;
            clampedHigh++;
          }
          planes[((face * azimuths + k) * n + j) * n + i] = q;
        }
      }
    }
  }
  const texels = FACE_COUNT * n * n;
  return {
    file: {
      faceSize: n,
      azimuths,
      minAngleDeg: params.minAngleDeg,
      maxAngleDeg: params.maxAngleDeg,
      minOccluderM: params.minOccluderM,
      planes,
    },
    stats: {
      texels,
      samples,
      clampedLow,
      clampedHigh,
      angleMinDeg: aMin,
      angleMaxDeg: aMax,
      angleMeanDeg: sum / (texels * azimuths),
      stepsPerRay: distances.length,
    },
  };
}
