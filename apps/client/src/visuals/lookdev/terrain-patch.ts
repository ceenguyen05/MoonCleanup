// VT-M0-15 horizon-map spike data (look-dev only, loaded when `?terrain=<base url>` is given): decodes the baked height cube
// (CTMH) and horizon map (CTMW) of tools/terrain-bake in the browser, samples the height around the +Y pole for a polar cap
// mesh, and bakes the horizon angles of each cap vertex into two vec4 vertex attributes. The horizon shading itself is a TSL
// node (`createHorizonVisibility`) multiplied into the CSM result (`MoonShadowNode`, material.userData).
//
// Layout v1 (world-and-dust-simulation 3.4; mirrors tools/terrain-bake/src/cubemap/mapping.ts and sample.ts, which the
// production sampler will share). This file is a spike, not the terrain module.

import {
  Fn,
  attribute,
  atan,
  dot,
  float,
  mix,
  normalize,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
  vec4,
  cross,
} from "three/tsl";
import { BufferAttribute, type BufferGeometry, type Node, Vector3, type UniformNode } from "three/webgpu";
import { MOON_RADIUS_M } from "./cap-geometry";

const FOUR_OVER_PI = 4 / Math.PI;
const BASIS = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
] as const;

export interface HeightCube {
  readonly faceSize: number;
  readonly padded: number;
  readonly data: Uint16Array;
  readonly offsetM: number;
  readonly scaleM: number;
}

export interface HorizonCube {
  readonly faceSize: number;
  readonly planes: Uint8Array;
  readonly minAngleDeg: number;
  readonly maxAngleDeg: number;
}

export interface TerrainData {
  readonly height: HeightCube;
  readonly horizon: HorizonCube;
}

async function inflateRaw(payload: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([payload as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function loadTerrain(baseUrl: string): Promise<TerrainData> {
  const manifest = (await (await fetch(`${baseUrl}manifest.json`)).json()) as {
    outputs?: Record<string, { file?: string }>;
  };
  const files = Object.values(manifest.outputs ?? {})
    .map((o) => o.file ?? "")
    .filter((f) => f !== "");
  const heightFile = files.find((f) => f.startsWith("height-cube-1024"));
  const horizonFile = files.find((f) => f.startsWith("horizon-map"));
  if (heightFile === undefined || horizonFile === undefined) throw new Error("terrain manifest lacks the cube files");
  const [hBytes, wBytes] = await Promise.all(
    [heightFile, horizonFile].map(async (f) => new Uint8Array(await (await fetch(`${baseUrl}${f}`)).arrayBuffer())),
  );
  if (hBytes === undefined || wBytes === undefined) throw new Error("terrain fetch failed");

  // Height cube: 6 padded faces, row-delta coded, high-byte plane then low-byte plane.
  const hv = new DataView(hBytes.buffer, hBytes.byteOffset, hBytes.byteLength);
  const n = hv.getUint16(6, true);
  const raw = await inflateRaw(hBytes.subarray(32));
  const p = n + 2;
  const plane = p * p;
  const data = new Uint16Array(6 * plane);
  for (let face = 0; face < 6; face++) {
    const dst = face * plane;
    const hi = face * plane * 2;
    const lo = hi + plane;
    for (let j = 0; j < p; j++) {
      for (let i = 0; i < p; i++) {
        const delta = ((raw[hi + j * p + i] ?? 0) << 8) | (raw[lo + j * p + i] ?? 0);
        const ref = i === 0 ? (j === 0 ? 0 : (data[dst + (j - 1) * p] ?? 0)) : (data[dst + j * p + i - 1] ?? 0);
        data[dst + j * p + i] = (ref + delta) & 0xffff;
      }
    }
  }
  const height: HeightCube = {
    faceSize: n,
    padded: p,
    data,
    offsetM: hv.getFloat64(16, true),
    scaleM: hv.getFloat64(24, true),
  };

  // Horizon map: per face, per azimuth channel, a faceSize^2 uint8 plane (row-delta coded).
  const wv = new DataView(wBytes.buffer, wBytes.byteOffset, wBytes.byteLength);
  const m = wv.getUint16(6, true);
  const wraw = await inflateRaw(wBytes.subarray(32));
  const planes = new Uint8Array(wraw.length);
  for (let k = 0; k < wraw.length / (m * m); k++) {
    const base = k * m * m;
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < m; i++) {
        const ref = i === 0 ? (j === 0 ? 0 : (planes[base + (j - 1) * m] ?? 0)) : (planes[base + j * m + i - 1] ?? 0);
        planes[base + j * m + i] = (ref + (wraw[base + j * m + i] ?? 0)) & 0xff;
      }
    }
  }
  return {
    height,
    horizon: { faceSize: m, planes, minAngleDeg: wv.getFloat32(16, true), maxAngleDeg: wv.getFloat32(20, true) },
  };
}

interface FaceAB {
  face: number;
  a: number;
  b: number;
}

function faceAB(x: number, y: number, z: number, out: FaceAB): FaceAB {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  const face = ax >= ay && ax >= az ? (x >= 0 ? 0 : 1) : ay >= az ? (y >= 0 ? 2 : 3) : z >= 0 ? 4 : 5;
  const f = BASIS[face];
  if (f === undefined) throw new RangeError("face");
  const major = x * f.n[0] + y * f.n[1] + z * f.n[2];
  out.face = face;
  out.a = Math.atan((x * f.u[0] + y * f.u[1] + z * f.u[2]) / major) * FOUR_OVER_PI;
  out.b = Math.atan((x * f.v[0] + y * f.v[1] + z * f.v[2]) / major) * FOUR_OVER_PI;
  return out;
}

const _ab: FaceAB = { face: 0, a: 0, b: 0 };

/** Height in metres above the 2 km sphere at a unit direction (bilinear over the padded cube, as the bake's reference sampler). */
export function sampleHeight(cube: HeightCube, x: number, y: number, z: number): number {
  faceAB(x, y, z, _ab);
  const n = cube.faceSize;
  const p = cube.padded;
  const max = p - 1.000001;
  const fx = Math.min(max, Math.max(0, ((_ab.a + 1) / 2) * n + 0.5));
  const fy = Math.min(max, Math.max(0, ((_ab.b + 1) / 2) * n + 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const base = _ab.face * p * p + y0 * p + x0;
  const d = cube.data;
  const top = (d[base] ?? 0) * (1 - tx) + (d[base + 1] ?? 0) * tx;
  const bottom = (d[base + p] ?? 0) * (1 - tx) + (d[base + p + 1] ?? 0) * tx;
  return cube.offsetM + (top * (1 - ty) + bottom * ty) * cube.scaleM;
}

/** Horizon elevation (degrees) per azimuth channel at a unit direction (bilinear). Writes `out[0..7]`. */
export function sampleHorizon(cube: HorizonCube, x: number, y: number, z: number, out: Float32Array): void {
  faceAB(x, y, z, _ab);
  const n = cube.faceSize;
  const fx = Math.min(n - 1.0001, Math.max(0, ((_ab.a + 1) / 2) * n - 0.5));
  const fy = Math.min(n - 1.0001, Math.max(0, ((_ab.b + 1) / 2) * n - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const span = cube.maxAngleDeg - cube.minAngleDeg;
  for (let k = 0; k < 8; k++) {
    const base = (_ab.face * 8 + k) * n * n + y0 * n + x0;
    const q = cube.planes;
    const top = (q[base] ?? 0) * (1 - tx) + (q[base + 1] ?? 0) * tx;
    const bottom = (q[base + n] ?? 0) * (1 - tx) + (q[base + n + 1] ?? 0) * tx;
    out[k] = cube.minAngleDeg + ((top * (1 - ty) + bottom * ty) / 255) * span;
  }
}

/** Height function for `buildCapGeometry`: the cube height above the sphere at the cap's local (x, z) (pole at +Y). */
export function capHeightFromCube(cube: HeightCube): (x: number, z: number) => number {
  const R = MOON_RADIUS_M;
  return (x, z) => {
    const r = Math.hypot(x, z);
    const y = Math.sqrt(Math.max(R * R - r * r, 0));
    const inv = 1 / R;
    return sampleHeight(cube, x * inv, y * inv, z * inv);
  };
}

/** Adds `aHorizonA` (azimuths 0..3) and `aHorizonB` (4..7), in degrees, to a cap geometry whose vertices carry the height. */
export function addHorizonAttributes(geometry: BufferGeometry, cube: HorizonCube): void {
  const pos = geometry.getAttribute("position");
  const a = new Float32Array(pos.count * 4);
  const b = new Float32Array(pos.count * 4);
  const R = MOON_RADIUS_M;
  const tmp = new Float32Array(8);
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    // Local cap coordinates -> direction from the sphere centre (0, -R, 0), ignoring the (tiny) height.
    v.set(pos.getX(i), pos.getY(i) + R, pos.getZ(i)).normalize();
    sampleHorizon(cube, v.x, v.y, v.z, tmp);
    for (let k = 0; k < 4; k++) {
      a[i * 4 + k] = tmp[k] ?? 0;
      b[i * 4 + k] = tmp[4 + k] ?? 0;
    }
  }
  geometry.setAttribute("aHorizonA", new BufferAttribute(a, 4));
  geometry.setAttribute("aHorizonB", new BufferAttribute(b, 4));
}

export interface HorizonVisibility {
  /** Multiply into the cascade shadow (1 = lit, 0 = in a far shadow). */
  readonly node: Node<"float">;
  /** Direction toward the key light (unit); the rig keeps it up to date. */
  readonly keyDirection: UniformNode<"vec3", Vector3>;
  /** 1 enables the horizon term, 0 disables it (for A/B captures). */
  readonly enabled: UniformNode<"float", number>;
}

/**
 * Far-occluder visibility at the fragment: interpolates the 8 baked horizon angles at the key light's azimuth in the local
 * (north, east) frame of the sphere point and compares the key's elevation (rendering-pipeline 5.2). `deltaDeg` = half the
 * sun disk plus about one texel of angular error.
 */
export function createHorizonVisibility(deltaDeg = 0.55): HorizonVisibility {
  const keyDirection = uniform(new Vector3(0, 1, 0));
  const enabled = uniform(1);
  const centre = vec3(0, -MOON_RADIUS_M, 0);
  const aH = attribute("aHorizonA", "vec4");
  const bH = attribute("aHorizonB", "vec4");
  const node = Fn(() => {
    const p = normalize(positionWorld.sub(centre));
    const east = normalize(cross(vec3(0, 1, 0), p));
    const north = cross(p, east);
    const l = keyDirection;
    const elevation = dot(l, p)
      .asin()
      .mul(180 / Math.PI);
    const az = atan(dot(l, east), dot(l, north)); // from north toward east, -pi..pi
    const t = az
      .mul(8 / (2 * Math.PI))
      .add(8)
      .mod(8); // 0..8 channel coordinate
    const h = vec4(aH.x, aH.y, aH.z, aH.w);
    const g = vec4(bH.x, bH.y, bH.z, bH.w);
    const channel = (i: number): Node<"float"> =>
      (i < 4 ? [h.x, h.y, h.z, h.w][i] : [g.x, g.y, g.z, g.w][i - 4]) as Node<"float">;
    // Piecewise-linear interpolation across the eight channels (wrapping 7 -> 0).
    let horizon: Node<"float"> = float(0) as Node<"float">;
    for (let i = 0; i < 8; i++) {
      const w = float(1).sub(
        t
          .sub(i)
          .abs()
          .min(float(8).sub(t.sub(i).abs()))
          .min(1),
      );
      horizon = horizon.add(channel(i).mul(w)) as Node<"float">;
    }
    const visible = smoothstep(horizon.sub(deltaDeg), horizon.add(deltaDeg), elevation);
    return mix(float(1), visible, enabled);
  })();
  return { node: node as Node<"float">, keyDirection, enabled };
}
