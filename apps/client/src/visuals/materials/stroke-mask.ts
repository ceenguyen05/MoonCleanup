// Procedural test mask: strokes stamped into a grime / berm buffer (M0-W3-T04). Pure CPU maths, no three.
//
// This stands in for what the dust simulation will write in M1 (world-and-dust-simulation.md 7.5): a brush-width,
// slightly rounded rectangle removes dust (R falls to 0 across a short ramp, ~1.2 cm), re-sweeping removes the old berm,
// and a berm is pushed up on the DUSTY side of the edge (G). The buffer is the mask-input contract of the regolith
// material (see `mask-contract.ts`); any other writer (compute, fragment pass, CPU upload) fills the same bytes.

import { BERM_HEIGHT_MAX_M } from "./regolith-constants";

/** World rectangle (metres, x/z plane) the mask texture covers: uv = ((x, z) - origin) / size. */
export interface MaskWorldRect {
  readonly originX: number;
  readonly originZ: number;
  readonly sizeX: number;
  readonly sizeZ: number;
}

/** CPU-side working copy of the mask (float R and G, 8-bit export). */
export interface MaskBuffer {
  readonly width: number;
  readonly height: number;
  readonly rect: MaskWorldRect;
  /** Remaining dust 0..1 (1 = full grime). */
  readonly grime: Float32Array;
  /** Berm height 0..1 of BERM_HEIGHT_MAX_M. */
  readonly berm: Float32Array;
}

export interface StrokeSpec {
  /** Centre line start / end (world x, z) in metres. */
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  /** Brush width across the stroke (m). Desk Duster 0.15. */
  readonly widthM: number;
  /** Corner radius of the brush footprint (m). Squared ends (reference look): about 0.02. Capped at half the width. */
  readonly cornerM?: number;
  /** 10-90 % width of the grime -> clean transition (m). Hand tools <= 2 cm (art-direction 3.3). */
  readonly edgeM?: number;
  /** Berm peak height (m) and width (m) outside the edge. Hand tools 1.5-3 cm over 6-12 cm. */
  readonly bermHeightM?: number;
  readonly bermWidthM?: number;
}

export function createMaskBuffer(width: number, height: number, rect: MaskWorldRect): MaskBuffer {
  const grime = new Float32Array(width * height).fill(1);
  const berm = new Float32Array(width * height);
  return { width, height, rect, grime, berm };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Signed distance (m, negative inside) from a point to a rounded rectangle given in its own frame. */
function roundedRectSd(along: number, across: number, halfLen: number, halfWid: number, corner: number): number {
  const qx = Math.abs(along) - (halfLen - corner);
  const qy = Math.abs(across) - (halfWid - corner);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - corner;
}

/**
 * Stamps one stroke. The footprint is the brush rectangle swept along the centre line (length = line length + width, so
 * the ends are the brush's own ends). Inside: grime 0 and berm 0 (re-sweeping removes the berm). Outside: berm rises on
 * the dusty side only, scaled by the dust that was actually there.
 */
export function stampStroke(buffer: MaskBuffer, spec: StrokeSpec): void {
  const { rect, width, height, grime, berm } = buffer;
  const edge = spec.edgeM ?? 0.014;
  const bermH = (spec.bermHeightM ?? 0.025) / BERM_HEIGHT_MAX_M;
  const bermW = spec.bermWidthM ?? 0.09;
  const corner = Math.min(spec.cornerM ?? 0.02, spec.widthM * 0.5);

  const dx = spec.x1 - spec.x0;
  const dz = spec.z1 - spec.z0;
  const length = Math.hypot(dx, dz);
  const ux = length > 1e-6 ? dx / length : 1;
  const uz = length > 1e-6 ? dz / length : 0;
  const cx = (spec.x0 + spec.x1) * 0.5;
  const cz = (spec.z0 + spec.z1) * 0.5;
  const halfLen = length * 0.5 + spec.widthM * 0.5;
  const halfWid = spec.widthM * 0.5;
  // Axis-aligned box of the oriented footprint grown by the berm and the edge ramp (no texel outside it is touched).
  const grow = bermW + edge + 0.02;
  const reachX = Math.abs(ux) * (halfLen + grow) + Math.abs(uz) * (halfWid + grow);
  const reachZ = Math.abs(uz) * (halfLen + grow) + Math.abs(ux) * (halfWid + grow);

  const texelX = rect.sizeX / width;
  const texelZ = rect.sizeZ / height;
  const i0 = Math.max(0, Math.floor((cx - reachX - rect.originX) / texelX));
  const i1 = Math.min(width - 1, Math.ceil((cx + reachX - rect.originX) / texelX));
  const j0 = Math.max(0, Math.floor((cz - reachZ - rect.originZ) / texelZ));
  const j1 = Math.min(height - 1, Math.ceil((cz + reachZ - rect.originZ) / texelZ));

  for (let j = j0; j <= j1; j++) {
    const z = rect.originZ + (j + 0.5) * texelZ;
    for (let i = i0; i <= i1; i++) {
      const x = rect.originX + (i + 0.5) * texelX;
      const px = x - cx;
      const pz = z - cz;
      const along = px * ux + pz * uz;
      const across = -px * uz + pz * ux;
      const sd = roundedRectSd(along, across, halfLen, halfWid, corner);
      if (sd > bermW + edge) continue;
      const k = j * width + i;
      const rOld = grime[k] ?? 0;
      const gOld = berm[k] ?? 0;
      // Dust removal: R falls from 1 to 0 across `edge` centred on the footprint boundary.
      const rNew = Math.min(rOld, smooth(-edge * 0.5, edge * 0.5, sd));
      // Berm: pushed material, only where dust remains; the old berm is removed where the dust was removed.
      const u = Math.min(Math.max((sd - edge * 0.5) / bermW, 0), 1);
      const profile = smooth(0, 0.22, u) * (1 - smooth(0.22, 1, u));
      const kept = rOld > 1e-4 ? gOld * Math.min(rNew / rOld, 1) : 0;
      const pushed = sd > 0 ? profile * bermH * rOld : 0;
      grime[k] = rNew;
      berm[k] = Math.max(kept, pushed);
    }
  }
}

/** Packs the buffer into RGBA8 (R grime, G berm, B polish 0, A 0) in row-major order, row 0 at the rect's origin Z. */
export function packMaskRgba8(buffer: MaskBuffer, out?: Uint8Array): Uint8Array {
  const n = buffer.width * buffer.height;
  const bytes = out ?? new Uint8Array(n * 4);
  for (let k = 0; k < n; k++) {
    bytes[k * 4] = Math.round(Math.min(Math.max(buffer.grime[k] ?? 0, 0), 1) * 255);
    bytes[k * 4 + 1] = Math.round(Math.min(Math.max(buffer.berm[k] ?? 0, 0), 1) * 255);
    bytes[k * 4 + 2] = 0;
    bytes[k * 4 + 3] = 255;
  }
  return bytes;
}

/** Reads the float grime value at a world position (bilinear), for tests and for lookdev probes. */
export function sampleGrime(buffer: MaskBuffer, x: number, z: number): number {
  const { rect, width, height, grime } = buffer;
  const fx = ((x - rect.originX) / rect.sizeX) * width - 0.5;
  const fz = ((z - rect.originZ) / rect.sizeZ) * height - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const at = (a: number, b: number): number =>
    grime[Math.min(Math.max(b, 0), height - 1) * width + Math.min(Math.max(a, 0), width - 1)] ?? 1;
  const top = at(i, j) * (1 - tx) + at(i + 1, j) * tx;
  const bottom = at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx;
  return top * (1 - tz) + bottom * tz;
}
