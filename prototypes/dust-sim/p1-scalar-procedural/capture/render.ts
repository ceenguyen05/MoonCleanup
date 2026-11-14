// CPU reference renderer of the P1 dust model on the shared capture scene (harness capture-scene.ts): reference
// sphere, Lambert sun + ambient, the scene's albedo pair, clamp, sRGB, pinhole camera at vFOV 60. One sample per pixel:
// edges are anti-aliased analytically from per-pixel derivatives, the way a fragment shader does it with fwidth.
// THIS IS NOT A GPU RENDER. It evaluates the same functions a TSL twin would (src/ring.ts, visual.ts, shade.ts).
import type { PlotId, UnitDirection } from "@moon-cleanup/shared";
import { CAPTURE_VIEW, GROUND, LIGHTING, sunDirection } from "../../harness/src/capture-scene";
import type { GrayImage, PixelSweep, Rect } from "../../harness/src/image-compare";
import { sitePoint } from "../../harness/src/scene";
import type { CameraPose, ContestGrid } from "../../harness/src/types";
import type { DetailRing } from "../src/ring";
import { composeDust } from "../src/shade";
import { dissolveNoise, plotSeed, type Dissolve } from "../src/visual";
import type { DecodedPng } from "./png";

/** Above this height the view is the orbit proxy: a smooth per-plot value, no ring, no dissolve (WDS 7.8). */
export const ORBIT_HEIGHT_M = 200;

export interface DustScene {
  readonly grid: ContestGrid;
  /** Fraction 0..255 the dissolve uses for a plot (L0 plus local ring credit). */
  fracOf(plot: number): number;
  readonly ring: DetailRing | null;
  readonly dissolve: Dissolve;
}

export interface Raster {
  readonly width: number;
  readonly height: number;
  /** 8-bit sRGB, 3 bytes per pixel. */
  readonly rgb: Uint8Array;
  /** Dust opacity 0..1 per pixel (1 in the sky). */
  readonly opacity: Float32Array;
  /** Dust presence mask 0..1 per pixel (1 in the sky). */
  readonly mask: Float32Array;
}

class Dir implements UnitDirection {
  x = 1;
  y = 0;
  z = 0;
}

/** Pinhole camera of the capture scene. */
export class Camera {
  readonly w: number = CAPTURE_VIEW.widthPx;
  readonly h: number = CAPTURE_VIEW.heightPx;
  private readonly o: readonly number[];
  private readonly f: number[];
  private readonly r: number[];
  private readonly u: number[];
  private readonly tan = Math.tan((CAPTURE_VIEW.vFovDeg * Math.PI) / 360);
  private readonly radius: number;

  constructor(pose: CameraPose, radiusM: number) {
    this.o = pose.position;
    this.f = unit(pose.forward);
    this.r = unit(cross(this.f, pose.up));
    this.u = cross(this.r, this.f);
    this.radius = radiusM;
  }

  /** Unit direction of the ground point seen through screen point (sx, sy), into out[at..at+2]. False in the sky. */
  hit(sx: number, sy: number, out: Float64Array, at: number): boolean {
    const px = ((2 * sx) / this.w - 1) * this.tan * (this.w / this.h);
    const py = (1 - (2 * sy) / this.h) * this.tan;
    let dx = (this.f[0] ?? 0) + px * (this.r[0] ?? 0) + py * (this.u[0] ?? 0);
    let dy = (this.f[1] ?? 0) + px * (this.r[1] ?? 0) + py * (this.u[1] ?? 0);
    let dz = (this.f[2] ?? 0) + px * (this.r[2] ?? 0) + py * (this.u[2] ?? 0);
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    dx /= l;
    dy /= l;
    dz /= l;
    const ox = this.o[0] ?? 0;
    const oy = this.o[1] ?? 0;
    const oz = this.o[2] ?? 0;
    const b = ox * dx + oy * dy + oz * dz;
    const disc = b * b - (ox * ox + oy * oy + oz * oz - this.radius * this.radius);
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc);
    if (t <= 0) return false;
    out[at] = (ox + t * dx) / this.radius;
    out[at + 1] = (oy + t * dy) / this.radius;
    out[at + 2] = (oz + t * dz) / this.radius;
    return true;
  }

  /** Screen position of a moon-centred point in metres; null behind the near plane. */
  project(p: readonly number[]): { x: number; y: number } | null {
    const v = [(p[0] ?? 0) - (this.o[0] ?? 0), (p[1] ?? 0) - (this.o[1] ?? 0), (p[2] ?? 0) - (this.o[2] ?? 0)];
    const z = dot(v, this.f);
    if (z <= CAPTURE_VIEW.near) return null;
    return {
      x: (dot(v, this.r) / z / (this.tan * (this.w / this.h)) + 1) * (this.w / 2),
      y: (1 - dot(v, this.u) / z / this.tan) * (this.h / 2),
    };
  }
}

const dot = (a: readonly number[], b: readonly number[]): number =>
  (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
const cross = (a: readonly number[], b: readonly number[]): number[] => [
  (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
  (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
  (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
];
const unit = (a: readonly number[]): number[] => {
  const l = Math.hypot(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0) || 1;
  return [(a[0] ?? 0) / l, (a[1] ?? 0) / l, (a[2] ?? 0) / l];
};

const srgbEncode = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const srgbDecode = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Renders `rect` (default: the whole 1920 x 1080 frame) of the scene from `pose`. */
export function renderDust(scene: DustScene, pose: CameraPose, rect: Rect | null, hintPlot: number): Raster {
  const R = scene.grid.params.radiusM;
  const cam = new Camera(pose, R);
  const x0 = rect ? rect.x0 : 0;
  const y0 = rect ? rect.y0 : 0;
  const width = (rect ? rect.x1 : cam.w) - x0;
  const height = (rect ? rect.y1 : cam.h) - y0;
  const rgb = new Uint8Array(width * height * 3);
  const opacity = new Float32Array(width * height).fill(1);
  const mask = new Float32Array(width * height).fill(1);
  const sun = sunDirection(pose);
  const orbit = pose.heightM > ORBIT_HEIGHT_M;
  const ring = orbit ? null : scene.ring;
  const h = new Float64Array(9);
  const tc = new Float64Array(6);
  const edge = new Float64Array(3);
  const dust = new Float64Array(2);
  const dir = new Dir();
  let hint = hintPlot;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x0 + x + 0.5;
      const sy = y0 + y + 0.5;
      if (!cam.hit(sx, sy, h, 0)) continue;
      if (!cam.hit(sx + 1, sy, h, 3)) h.copyWithin(3, 0, 3);
      if (!cam.hit(sx, sy + 1, h, 6)) h.copyWithin(6, 0, 3);
      dir.x = h[0] ?? 0;
      dir.y = h[1] ?? 0;
      dir.z = h[2] ?? 0;
      const plot = scene.grid.plotAt(dir, hint as PlotId) as number;
      hint = plot;
      const frac = scene.fracOf(plot);
      if (orbit) {
        dust[0] = frac / 255;
        dust[1] = frac > 0 ? 1 : 0;
      } else {
        let presence = frac >= 255 ? 1 : 0;
        if (frac > 0 && frac < 255) {
          const seed = plotSeed(plot);
          const v0 = dissolveNoise(dir.x * R, dir.y * R, dir.z * R, seed);
          const v1 = dissolveNoise((h[3] ?? 0) * R, (h[4] ?? 0) * R, (h[5] ?? 0) * R, seed);
          const v2 = dissolveNoise((h[6] ?? 0) * R, (h[7] ?? 0) * R, (h[8] ?? 0) * R, seed);
          const softness = Math.max(1e-4, 0.7 * (Math.abs(v1 - v0) + Math.abs(v2 - v0)));
          presence = scene.dissolve.coverageOf(v0, frac, softness);
        }
        edge[0] = edge[1] = edge[2] = 0;
        if (ring && ring.isAnchored) {
          ring.texelCoords(dir.x, dir.y, dir.z, tc, 0);
          ring.texelCoords(h[3] ?? 0, h[4] ?? 0, h[5] ?? 0, tc, 2);
          ring.texelCoords(h[6] ?? 0, h[7] ?? 0, h[8] ?? 0, tc, 4);
          const fx = tc[0] ?? 0;
          const fy = tc[1] ?? 0;
          ring.edgeAt(fx, fy, (tc[2] ?? 0) - fx, (tc[3] ?? 0) - fy, (tc[4] ?? 0) - fx, (tc[5] ?? 0) - fy, edge);
        }
        composeDust(presence, edge[0] ?? 0, edge[1] ?? 0, edge[2] ?? 0, dust);
      }
      const t = dust[0] ?? 0;
      const i = y * width + x;
      opacity[i] = t;
      mask[i] = dust[1] ?? 0;
      const ndl = Math.max(0, dir.x * sun[0] + dir.y * sun[1] + dir.z * sun[2]);
      const albedo = GROUND.cleanAlbedo + (GROUND.dustAlbedo - GROUND.cleanAlbedo) * t;
      const linear = (albedo * LIGHTING.sunIlluminance * ndl + LIGHTING.ambient) * LIGHTING.exposure;
      const code = Math.round(255 * srgbEncode(linear > 1 ? 1 : linear));
      rgb[i * 3] = code;
      rgb[i * 3 + 1] = code;
      rgb[i * 3 + 2] = code;
    }
  }
  return { width, height, rgb, opacity, mask };
}

export const grayOf = (data: Float32Array, width: number, height: number): GrayImage => ({ width, height, data });

/**
 * Dust opacity per pixel recovered from a decoded capture PNG by inverting the scene's shading. Where the clean ground
 * clips at 1.0 (the scene's exposure clips it for sun elevations above about 37 degrees) opacity below the clip
 * level cannot be told apart; `clipOpacity` reports that level (0 when nothing clips). Sky pixels read as opacity 1.
 */
export function opacityFromPng(png: DecodedPng, pose: CameraPose): { image: GrayImage; clipOpacity: number } {
  const sun = sunDirection(pose);
  const up = unit(pose.up);
  const ndl = Math.max(1e-6, dot(sun, up));
  const span = GROUND.cleanAlbedo - GROUND.dustAlbedo;
  const data = new Float32Array(png.width * png.height);
  for (let i = 0; i < data.length; i++) {
    const linear = srgbDecode((png.data[i * png.channels] ?? 0) / 255);
    const albedo = (linear / LIGHTING.exposure - LIGHTING.ambient) / (LIGHTING.sunIlluminance * ndl);
    const t = (GROUND.cleanAlbedo - albedo) / span;
    data[i] = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const clipAlbedo = (1 / LIGHTING.exposure - LIGHTING.ambient) / (LIGHTING.sunIlluminance * ndl);
  const clip = (GROUND.cleanAlbedo - clipAlbedo) / span;
  return { image: { width: png.width, height: png.height, data }, clipOpacity: clip < 0 ? 0 : clip };
}

/**
 * The scene's sweeps (site-plane metres) as screen-space capsules for the harness correlation: each lane is cut into
 * 0.25 m pieces, each with the pixel width the lane has there. Pieces behind the camera are dropped.
 */
export function sweepsToPixels(
  pose: CameraPose,
  radiusM: number,
  sweeps: readonly { from: readonly [number, number]; to: readonly [number, number]; widthM: number }[],
): PixelSweep[] {
  const cam = new Camera(pose, radiusM);
  const world = (e: number, n: number): number[] => sitePoint(e, n).map((c) => c * radiusM);
  const out: PixelSweep[] = [];
  for (const s of sweeps) {
    const length = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]);
    const pieces = Math.max(1, Math.ceil(length / 0.25));
    // Unit normal of the lane in the site plane.
    const nx = -(s.to[1] - s.from[1]) / (length || 1);
    const ny = (s.to[0] - s.from[0]) / (length || 1);
    for (let k = 0; k < pieces; k++) {
      const at = (t: number): [number, number] => [
        s.from[0] + (s.to[0] - s.from[0]) * t,
        s.from[1] + (s.to[1] - s.from[1]) * t,
      ];
      const a = at(k / pieces);
      const b = at((k + 1) / pieces);
      const m = at((k + 0.5) / pieces);
      const pa = cam.project(world(a[0], a[1]));
      const pb = cam.project(world(b[0], b[1]));
      const left = cam.project(world(m[0] - (nx * s.widthM) / 2, m[1] - (ny * s.widthM) / 2));
      const right = cam.project(world(m[0] + (nx * s.widthM) / 2, m[1] + (ny * s.widthM) / 2));
      if (!pa || !pb || !left || !right) continue;
      const widthPx = Math.hypot(left.x - right.x, left.y - right.y);
      if (widthPx > 4 * cam.w) continue;
      out.push({ x0: pa.x, y0: pa.y, x1: pb.x, y1: pb.y, widthPx });
    }
  }
  return out;
}
