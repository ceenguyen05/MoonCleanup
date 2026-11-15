// TSL twin of the ground height function of packages/world (`GroundHeight`, WDS section 3.5): H = H_base + H_detail,
// the same arithmetic in float32 / uint32 on the GPU. It must match the JS function within +-2 cm (GPU readback check
// in `terrain/verify`). Works on WebGPU and on the WebGL2 backend (integer ops, texelFetch).
//
// Height texture. three r187 has no r16uint mapping (`RedIntegerFormat` accepts 32-bit types only), so the uint16
// cube is bound as an RG8 2D array texture over the SAME bytes (R = low byte, G = high byte; 12.6 MB, as r16uint) and
// read with `textureLoad`: value = G * 256 + R, exact. Four taps give the bilinear sample of `HeightCube.bilinearIO`.
//
// Differences from the JS code that cannot change a result by more than float rounding:
//   * the crater test `hash / 2^32 >= probability` is the integer compare `hash >= ceil(probability * 2^32)`;
//   * the pad mask is `min` over smoothsteps (JS breaks at the first pad that contains the point);
//   * the noise lattice hashes are shared between corners (same chain, fewer evaluations).
// Besides H the twin returns the slope terms the terrain vertex stage needs for its normal (analytic for craters and
// noise, central differences at +-1/2 texel for H_base). Craters of a NEIGHBOUR face (within 24 m of a cube edge)
// add height only.
//
// The graph is typed loosely on purpose (built once per material), as the regolith material is.
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as TSL from "three/tsl";
import {
  DataArrayTexture,
  NearestFilter,
  NoColorSpace,
  RGFormat,
  UnsignedByteType,
  Vector3,
  ClampToEdgeWrapping,
} from "three/webgpu";
import {
  CUBE_FACE_ACROSS,
  CUBE_FACE_BASIS,
  DEFAULT_HEIGHT_DETAIL,
  pcgHash,
  type HeightCube,
  type HeightDetailParams,
  type PadMask,
} from "@moon-cleanup/world";

export type TslNode = any;
const t = TSL as unknown as Record<string, (...args: any[]) => any>;
const Fn = t["Fn"]!;
const If = t["If"]!;
const { abs, clamp, dot, float, floor, int, ivec2, length, max, min, mix, select, smoothstep, sqrt } = t as any;
const { textureLoad, uint, uniformArray, vec3, vec4 } = t as any;

const QUARTER_PI = Math.PI / 4;
const FOUR_OVER_PI = 4 / Math.PI;
const INV_2_32 = 1 / 4294967296;

/** The uint16 height cube as an RG8 array texture over the cube's own bytes (no copy on little-endian hosts). */
export function createHeightTexture(cube: HeightCube): DataArrayTexture {
  const p = cube.padded;
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  let bytes: Uint8Array;
  if (littleEndian) {
    bytes = new Uint8Array(cube.data.buffer, cube.data.byteOffset, cube.data.byteLength);
  } else {
    bytes = new Uint8Array(cube.data.length * 2);
    for (let k = 0; k < cube.data.length; k++) {
      bytes[k * 2] = cube.data[k]! & 0xff;
      bytes[k * 2 + 1] = cube.data[k]! >> 8;
    }
  }
  const texture = new DataArrayTexture(bytes, p, p, 6);
  texture.name = "mc:height-cube";
  texture.format = RGFormat;
  texture.type = UnsignedByteType;
  texture.colorSpace = NoColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Mip levels 1..count of the height cube as RG8 array textures without a gutter, each texel the mean of 2 x 2 of the
 * level above (WDS section 3.4: 512 / 256 / 128, 4.1 MB). Separate textures because three r187 uploads no mips for a
 * data array texture. Used only for the far-field normal.
 */
export function createHeightMipTextures(cube: HeightCube, count = 3): DataArrayTexture[] {
  const out: DataArrayTexture[] = [];
  let size = cube.faceSize;
  const p = cube.padded;
  let previous = new Uint16Array(6 * size * size);
  for (let face = 0; face < 6; face++) {
    for (let y = 0; y < size; y++) {
      const from = face * p * p + (y + 1) * p + 1;
      previous.set(cube.data.subarray(from, from + size), (face * size + y) * size);
    }
  }
  for (let level = 1; level <= count && size >= 4; level++) {
    const half = size >> 1;
    const next = new Uint16Array(6 * half * half);
    for (let face = 0; face < 6; face++) {
      for (let y = 0; y < half; y++) {
        for (let x = 0; x < half; x++) {
          const k = (face * size + y * 2) * size + x * 2;
          next[(face * half + y) * half + x] =
            (previous[k]! + previous[k + 1]! + previous[k + size]! + previous[k + size + 1]! + 2) >> 2;
        }
      }
    }
    const bytes = new Uint8Array(next.length * 2);
    for (let k = 0; k < next.length; k++) {
      bytes[k * 2] = next[k]! & 0xff;
      bytes[k * 2 + 1] = next[k]! >> 8;
    }
    const texture = new DataArrayTexture(bytes, half, half, 6);
    texture.name = "mc:height-cube-mip" + String(level);
    texture.format = RGFormat;
    texture.type = UnsignedByteType;
    texture.colorSpace = NoColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    out.push(texture);
    previous = next;
    size = half;
  }
  return out;
}

/** PCG RXS-M-XS on one LCG step, uint32 -> uint32 (`pcgHash`). */
const pcg = Fn(([v]: [TslNode]) => {
  const state = v.mul(uint(747796405)).add(uint(2891336453)).toVar();
  const word = state
    .shiftRight(state.shiftRight(uint(28)).add(uint(4)))
    .bitXor(state)
    .mul(uint(277803737))
    .toVar();
  return word.shiftRight(uint(22)).bitXor(word);
}).setLayout({ name: "mcPcg", type: "uint", inputs: [{ name: "v", type: "uint" }] });

/**
 * atan(x) for |x| <= 1 to float32 accuracy. The built-in is not accurate enough on every GPU: an error of 1e-5 rad
 * in the face coordinate (measured on the UHD 620, D3D12) moves the height sample by 2 cm on a steep slope. Two
 * half-angle reductions (|x| <= 0.2) and five series terms leave about 1e-8.
 */
const atanUnit = (x: TslNode): TslNode => {
  const u1 = x.div(sqrt(x.mul(x).add(1)).add(1)).toVar();
  const u2 = u1.div(sqrt(u1.mul(u1).add(1)).add(1)).toVar();
  const z = u2.mul(u2).toVar();
  const series = z
    .mul(1 / 9)
    .sub(1 / 7)
    .mul(z)
    .add(1 / 5)
    .mul(z)
    .sub(1 / 3)
    .mul(z)
    .add(1);
  return u2.mul(series).mul(4);
};

export interface HeightTwinOptions {
  readonly cube: HeightCube;
  readonly texture: DataArrayTexture;
  readonly radiusM: number;
  /** `null` disables H_detail. Default: the WDS section 3.5 defaults. */
  readonly detail?: HeightDetailParams | null;
  readonly pads?: readonly PadMask[];
  /** Mip levels 1.. of the cube (`createHeightMipTextures`), for `farSlope`. */
  readonly mips?: readonly DataArrayTexture[];
}

/** Face coordinates of a direction in the fragment or vertex stage. */
export interface FaceCoords {
  readonly face: TslNode;
  readonly n: TslNode;
  readonly u: TslNode;
  readonly v: TslNode;
  /** tan(pi/4 a), tan(pi/4 b). */
  readonly ta: TslNode;
  readonly tb: TslNode;
  readonly a: TslNode;
  readonly b: TslNode;
}

/** Fade weights of the procedural detail (1 = full): crater bands in `craters.xyz`, noise octaves in `noise.xy`. */
export interface DetailWeights {
  readonly craters: TslNode;
  readonly noise: TslNode;
}

export interface FaceFrame {
  /** int face index and the face basis vectors. */
  readonly face: TslNode;
  readonly n: TslNode;
  readonly u: TslNode;
  readonly v: TslNode;
}

export interface DetailResult {
  /** H_detail, metres. */
  readonly h: TslNode;
  /** d H_detail / d(face metres s, t) of the craters of the own face. */
  readonly gs: TslNode;
  readonly gt: TslNode;
  /** d H_detail / d(direction) of the noise (vec3). */
  readonly g3: TslNode;
}

export interface HeightTwin {
  /** Face basis of an int face index (uniform arrays). */
  frame(face: TslNode): FaceFrame;
  /** H_base at face coordinates (4 taps). Call inside a `Fn`. */
  base(face: TslNode, a: TslNode, b: TslNode): TslNode;
  /** H_detail and its slope terms at `dir` = direction of (face, a, b). Call inside a `Fn`. */
  detail(dir: TslNode, face: TslNode, a: TslNode, b: TslNode, weights: DetailWeights | null): DetailResult;
  /** H at a unit direction (face by major axis), all detail at full weight: the node the readback check renders. */
  heightAtDirection(dir: TslNode): TslNode;
  /** Face (major axis) and equal-angle coordinates of a unit direction. Call inside a `Fn`. */
  faceCoords(dir: TslNode): FaceCoords;
  /**
   * Slope of H_base from mip `level` (int node, 0..`farLevels`): vec3(dH/da, dH/db, H), central differences at
   * +-1/2 texel of that level (16 taps). Call inside a `Fn`.
   */
  farSlope(face: TslNode, a: TslNode, b: TslNode, level: TslNode): TslNode;
  /** Highest mip level `farSlope` accepts. */
  readonly farLevels: number;
  /** Texels per face edge of level 0. */
  readonly faceSize: number;
  /** Half a height texel in face coordinates. */
  readonly halfTexelAB: number;
  /** Metres of face arc per unit of a (pi/4 R). */
  readonly faceHalfM: number;
}

export function createHeightTwin(options: HeightTwinOptions): HeightTwin {
  const { cube, texture } = options;
  const R = options.radiusM;
  const detailParams = options.detail === undefined ? DEFAULT_HEIGHT_DETAIL : options.detail;
  const pads = options.pads ?? [];
  const n = cube.faceSize;
  const p = cube.padded;
  const faceHalfM = QUARTER_PI * R;

  const B = CUBE_FACE_BASIS;
  const vecs = (offset: number): Vector3[] =>
    Array.from(
      { length: 6 },
      (_, f) => new Vector3(B[f * 9 + offset]!, B[f * 9 + offset + 1]!, B[f * 9 + offset + 2]!),
    );
  const faceN = uniformArray(vecs(0));
  const faceU = uniformArray(vecs(3));
  const faceV = uniformArray(vecs(6));
  const faceAcross = uniformArray(Array.from(CUBE_FACE_ACROSS, (f) => f));

  const frame = (face: TslNode): FaceFrame => ({
    face,
    n: faceN.element(face),
    u: faceU.element(face),
    v: faceV.element(face),
  });

  const base = (face: TslNode, a: TslNode, b: TslNode): TslNode => {
    const x = clamp(
      a
        .add(1)
        .mul(n / 2)
        .add(0.5),
      0,
      p - 1,
    ).toVar();
    const y = clamp(
      b
        .add(1)
        .mul(n / 2)
        .add(0.5),
      0,
      p - 1,
    ).toVar();
    const x0 = floor(x).toVar();
    const y0 = floor(y).toVar();
    const fx = x.sub(x0);
    const fy = y.sub(y0);
    const ix0 = int(x0).toVar();
    const iy0 = int(y0).toVar();
    const ix1 = min(ix0.add(1), int(p - 1)).toVar();
    const iy1 = min(iy0.add(1), int(p - 1)).toVar();
    const tap = (ix: TslNode, iy: TslNode): TslNode => {
      const texel = textureLoad(texture, ivec2(ix, iy)).depth(face);
      return floor(texel.g.mul(255).add(0.5))
        .mul(256)
        .add(floor(texel.r.mul(255).add(0.5)));
    };
    const top = mix(tap(ix0, iy0), tap(ix1, iy0), fx);
    const bottom = mix(tap(ix0, iy1), tap(ix1, iy1), fx);
    return mix(top, bottom, fy).mul(cube.scaleM).add(cube.offsetM);
  };

  /** Bilinear H_base from a level texture of `size` texels per edge with `pad` gutter texels. */
  const levelSample = (
    tex: DataArrayTexture,
    size: number,
    pad: number,
    face: TslNode,
    a: TslNode,
    b: TslNode,
  ): TslNode => {
    const last = size + 2 * pad - 1;
    const x = clamp(
      a
        .add(1)
        .mul(size / 2)
        .add(pad - 0.5),
      0,
      last,
    ).toVar();
    const y = clamp(
      b
        .add(1)
        .mul(size / 2)
        .add(pad - 0.5),
      0,
      last,
    ).toVar();
    const x0 = floor(x).toVar();
    const y0 = floor(y).toVar();
    const ix0 = int(x0).toVar();
    const iy0 = int(y0).toVar();
    const ix1 = min(ix0.add(1), int(last)).toVar();
    const iy1 = min(iy0.add(1), int(last)).toVar();
    const tap = (ix: TslNode, iy: TslNode): TslNode => {
      const texel = textureLoad(tex, ivec2(ix, iy)).depth(face);
      return floor(texel.g.mul(255).add(0.5))
        .mul(256)
        .add(floor(texel.r.mul(255).add(0.5)));
    };
    const top = mix(tap(ix0, iy0), tap(ix1, iy0), x.sub(x0));
    const bottom = mix(tap(ix0, iy1), tap(ix1, iy1), x.sub(x0));
    return mix(top, bottom, y.sub(y0)).mul(cube.scaleM).add(cube.offsetM);
  };
  const levels: { tex: DataArrayTexture; size: number; pad: number }[] = [{ tex: texture, size: n, pad: 1 }];
  (options.mips ?? []).forEach((tex, k) => levels.push({ tex, size: n >> (k + 1), pad: 0 }));
  const slopeOf = (k: number, face: TslNode, a: TslNode, b: TslNode): TslNode => {
    const { tex, size, pad } = levels[k]!;
    const e = 1 / size;
    const hE = levelSample(tex, size, pad, face, a.add(e), b).toVar();
    const hW = levelSample(tex, size, pad, face, a.sub(e), b).toVar();
    const hN = levelSample(tex, size, pad, face, a, b.add(e)).toVar();
    const hS = levelSample(tex, size, pad, face, a, b.sub(e)).toVar();
    return vec3(hE.sub(hW).div(2 * e), hN.sub(hS).div(2 * e), hE.add(hW).add(hN).add(hS).mul(0.25));
  };
  const farSlope = (face: TslNode, a: TslNode, b: TslNode, level: TslNode): TslNode => {
    const out = vec3(0).toVar();
    // One branch per level (a texture cannot be picked by index).
    for (let k = 0; k < levels.length; k++) {
      const pick = k === levels.length - 1 ? level.greaterThanEqual(int(k)) : level.equal(int(k));
      If(pick, () => {
        out.assign(slopeOf(k, face, a, b));
      });
    }
    return out;
  };
  const faceCoords = (dir: TslNode): FaceCoords => {
    const ad = abs(dir).toVar();
    const face = int(0).toVar();
    If(ad.x.greaterThanEqual(ad.y).and(ad.x.greaterThanEqual(ad.z)), () => {
      face.assign(select(dir.x.greaterThanEqual(0), int(0), int(1)));
    })
      .ElseIf(ad.y.greaterThanEqual(ad.z), () => {
        face.assign(select(dir.y.greaterThanEqual(0), int(2), int(3)));
      })
      .Else(() => {
        face.assign(select(dir.z.greaterThanEqual(0), int(4), int(5)));
      });
    const fr = frame(face);
    const fnv = vec3(fr.n).toVar();
    const fuv = vec3(fr.u).toVar();
    const fvv = vec3(fr.v).toVar();
    const major = dot(dir, fnv).toVar();
    const ta = dot(dir, fuv).div(major).toVar();
    const tb = dot(dir, fvv).div(major).toVar();
    return {
      face,
      n: fnv,
      u: fuv,
      v: fvv,
      ta,
      tb,
      a: atanUnit(ta).mul(FOUR_OVER_PI).toVar(),
      b: atanUnit(tb).mul(FOUR_OVER_PI).toVar(),
    };
  };
  const farApi = { faceCoords, farSlope, farLevels: levels.length - 1, faceSize: n };

  type DetailFn = HeightTwin["detail"];
  const heightAtWith =
    (detailFn: DetailFn) =>
    (dir: TslNode): TslNode =>
      Fn(() => {
        const d = vec3(dir).toVar();
        const ad = abs(d).toVar();
        const face = int(0).toVar();
        If(ad.x.greaterThanEqual(ad.y).and(ad.x.greaterThanEqual(ad.z)), () => {
          face.assign(select(d.x.greaterThanEqual(0), int(0), int(1)));
        })
          .ElseIf(ad.y.greaterThanEqual(ad.z), () => {
            face.assign(select(d.y.greaterThanEqual(0), int(2), int(3)));
          })
          .Else(() => {
            face.assign(select(d.z.greaterThanEqual(0), int(4), int(5)));
          });
        const fr = frame(face);
        const major = dot(d, fr.n).toVar();
        const a = atanUnit(dot(d, fr.u).div(major)).mul(FOUR_OVER_PI).toVar();
        const b = atanUnit(dot(d, fr.v).div(major)).mul(FOUR_OVER_PI).toVar();
        const h = base(face, a, b).toVar();
        h.addAssign(detailFn(d, face, a, b, null).h);
        return h;
      })();

  if (detailParams === null) {
    const none: DetailFn = () => ({ h: float(0), gs: float(0), gt: float(0), g3: vec3(0) });
    return {
      frame,
      base,
      detail: none,
      heightAtDirection: heightAtWith(none),
      ...farApi,
      halfTexelAB: 1 / n,
      faceHalfM,
    };
  }

  const seed = detailParams.seed >>> 0;
  const ejecta = detailParams.ejectaReach;
  const bowl = detailParams.bowlDepth;
  const rimK = detailParams.rimHeight;
  let reach = 0;
  const bands = detailParams.craterBands.map((band, bi) => {
    reach = Math.max(reach, band.radiusMaxM * ejecta);
    return {
      cell: band.cellM,
      rMin: band.radiusMinM,
      rSpan: band.radiusMaxM - band.radiusMinM,
      threshold: Math.min(4294967295, Math.ceil(band.probability * 4294967296)),
      seed: pcgHash((seed + Math.imul(bi + 1, 0x9e3779b9)) >>> 0),
    };
  });
  const octaves = detailParams.noise.map((oct, oi) => ({
    inv: R / oct.wavelengthM,
    amplitude: oct.amplitudeM,
    seed: pcgHash((seed + Math.imul(oi, 0x85ebca6b)) >>> 0),
  }));
  const marginAB = 1 - reach / faceHalfM;

  /**
   * One jittered-grid cell (cx, cy) of a crater band at face metres (s, t): vec3(height, dH/ds, dH/dt), zero when the
   * cell holds no crater, the crater belongs to another face or the point is out of its reach.
   */
  const craterCell = Fn(([rowSeed, cx, cy, s, tm, cell, rMin, rSpan, threshold]: TslNode[]) => {
    const acc = vec3(0).toVar();
    const h0 = pcg(rowSeed.add(uint(cx))).toVar();
    If(h0.lessThan(threshold), () => {
      const h1 = pcg(h0).toVar();
      const h2 = pcg(h1).toVar();
      const h3 = pcg(h2).toVar();
      const ccs = float(cx).add(float(h1).mul(INV_2_32)).mul(cell).toVar();
      const cct = float(cy).add(float(h2).mul(INV_2_32)).mul(cell).toVar();
      const owned = ccs
        .greaterThanEqual(-faceHalfM)
        .and(ccs.lessThan(faceHalfM))
        .and(cct.greaterThanEqual(-faceHalfM))
        .and(cct.lessThan(faceHalfM));
      If(owned, () => {
        const r = rMin.add(rSpan.mul(float(h3).mul(INV_2_32))).toVar();
        const ds = s.sub(ccs).toVar();
        const dt = tm.sub(cct).toVar();
        const d2 = ds.mul(ds).add(dt.mul(dt)).toVar();
        const reachR = r.mul(ejecta).toVar();
        If(d2.lessThan(reachR.mul(reachR)), () => {
          const dist = sqrt(d2).toVar();
          const xr = dist.div(r).toVar();
          const rim = r.mul(rimK).toVar();
          If(xr.lessThan(1), () => {
            const g = float(2 * bowl)
              .div(r)
              .toVar();
            acc.assign(vec3(rim.add(r.mul(bowl).mul(xr.mul(xr).sub(1))), ds.mul(g), dt.mul(g)));
          }).Else(() => {
            const tt = clamp(
              float(ejecta)
                .sub(xr)
                .div(ejecta - 1),
              0,
              1,
            ).toVar();
            const g = rim
              .mul(tt.mul(6).mul(float(1).sub(tt)))
              .mul(-1 / (ejecta - 1))
              .div(r.mul(max(dist, 1e-6)))
              .toVar();
            acc.assign(vec3(rim.mul(tt.mul(tt).mul(float(3).sub(tt.mul(2)))), ds.mul(g), dt.mul(g)));
          });
        });
      });
    });
    return acc;
  }).setLayout({
    name: "mcCraterCell",
    type: "vec3",
    inputs: [
      { name: "rowSeed", type: "uint" },
      { name: "cx", type: "int" },
      { name: "cy", type: "int" },
      { name: "s", type: "float" },
      { name: "tm", type: "float" },
      { name: "cell", type: "float" },
      { name: "rMin", type: "float" },
      { name: "rSpan", type: "float" },
      { name: "threshold", type: "uint" },
    ],
  });

  /**
   * One crater band around face metres (s, t): vec3(height, dH/ds, dH/dt), the 3 x 3 cells written out. No shader
   * loop on purpose: with the two nested `for` loops the WebGL2 backend (ANGLE on D3D11) returned zero craters, while
   * the same GLSL is correct by reading; nine calls behave the same on both backends.
   */
  const craterBand = Fn(([faceSeed, s, tm, cell, rMin, rSpan, threshold]: TslNode[]) => {
    const acc = vec3(0).toVar();
    const cx0 = int(floor(s.div(cell))).toVar();
    const cy0 = int(floor(tm.div(cell))).toVar();
    for (let dy = -1; dy <= 1; dy++) {
      const cy = cy0.add(int(dy)).toVar();
      const rowSeed = pcg(faceSeed.add(uint(cy))).toVar();
      for (let dx = -1; dx <= 1; dx++) {
        acc.addAssign(craterCell(rowSeed, cx0.add(int(dx)), cy, s, tm, cell, rMin, rSpan, threshold));
      }
    }
    return acc;
  }).setLayout({
    name: "mcCraterBand",
    type: "vec3",
    inputs: [
      { name: "faceSeed", type: "uint" },
      { name: "s", type: "float" },
      { name: "tm", type: "float" },
      { name: "cell", type: "float" },
      { name: "rMin", type: "float" },
      { name: "rSpan", type: "float" },
      { name: "threshold", type: "uint" },
    ],
  });

  /** Value noise at lattice point `q`: vec4(value in -1..1, d value / d q). */
  const noise3 = Fn(([q, noiseSeed]: TslNode[]) => {
    const ip = floor(q).toVar();
    const f = q.sub(ip).toVar();
    const w = f
      .mul(f)
      .mul(vec3(3).sub(f.mul(2)))
      .toVar();
    const dw = f.mul(6).mul(vec3(1).sub(f)).toVar();
    const ix = int(ip.x).toVar();
    const iy = int(ip.y).toVar();
    const iz = int(ip.z).toVar();
    const hx0 = pcg(noiseSeed.add(uint(ix))).toVar();
    const hx1 = pcg(noiseSeed.add(uint(ix.add(1)))).toVar();
    const hy = (hx: TslNode, j: number): TslNode => pcg(hx.add(uint(iy.add(j)))).toVar();
    const h00 = hy(hx0, 0);
    const h10 = hy(hx1, 0);
    const h01 = hy(hx0, 1);
    const h11 = hy(hx1, 1);
    const value = (h: TslNode, k: number): TslNode =>
      float(pcg(h.add(uint(iz.add(k)))))
        .mul(2 * INV_2_32)
        .sub(1)
        .toVar();
    const c000 = value(h00, 0);
    const c100 = value(h10, 0);
    const c010 = value(h01, 0);
    const c110 = value(h11, 0);
    const c001 = value(h00, 1);
    const c101 = value(h10, 1);
    const c011 = value(h01, 1);
    const c111 = value(h11, 1);
    const x00 = mix(c000, c100, w.x).toVar();
    const x10 = mix(c010, c110, w.x).toVar();
    const x01 = mix(c001, c101, w.x).toVar();
    const x11 = mix(c011, c111, w.x).toVar();
    const y0 = mix(x00, x10, w.y).toVar();
    const y1 = mix(x01, x11, w.y).toVar();
    const gx = mix(mix(c100.sub(c000), c110.sub(c010), w.y), mix(c101.sub(c001), c111.sub(c011), w.y), w.z);
    const gy = mix(x10.sub(x00), x11.sub(x01), w.z);
    const gz = y1.sub(y0);
    return vec4(mix(y0, y1, w.z), gx.mul(dw.x), gy.mul(dw.y), gz.mul(dw.z));
  }).setLayout({
    name: "mcNoise3",
    type: "vec4",
    inputs: [
      { name: "q", type: "vec3" },
      { name: "noiseSeed", type: "uint" },
    ],
  });

  const bandCall = (bi: number, face: TslNode, s: TslNode, tm: TslNode): TslNode => {
    const band = bands[bi]!;
    const faceSeed = pcg(uint(band.seed).bitXor(uint(face)));
    return craterBand(faceSeed, s, tm, float(band.cell), float(band.rMin), float(band.rSpan), uint(band.threshold));
  };

  /**
   * Crater height of another face (`other`, basis `fnO` / `fuO` / `fvO`) at `dir`, weighted. The basis comes in as
   * arguments: a function with a layout must not read uniforms (its code is reused by the shadow material's shader,
   * where they are not declared).
   */
  const cratersOnFace = Fn(([dir, other, fnO, fuO, fvO, wc]: TslNode[]) => {
    const major = dot(dir, fnO).toVar();
    const s = atanUnit(dot(dir, fuO).div(major))
      .mul(FOUR_OVER_PI * faceHalfM)
      .toVar();
    const tm = atanUnit(dot(dir, fvO).div(major))
      .mul(FOUR_OVER_PI * faceHalfM)
      .toVar();
    const h = float(0).toVar();
    bands.forEach((_, bi) => {
      const w = bi === 0 ? wc.x : bi === 1 ? wc.y : wc.z;
      If(w.greaterThan(0), () => {
        h.addAssign(bandCall(bi, other, s, tm).x.mul(w));
      });
    });
    return h;
  }).setLayout({
    name: "mcCratersOnFace",
    type: "float",
    inputs: [
      { name: "dir", type: "vec3" },
      { name: "other", type: "int" },
      { name: "fnO", type: "vec3" },
      { name: "fuO", type: "vec3" },
      { name: "fvO", type: "vec3" },
      { name: "wc", type: "vec3" },
    ],
  });
  const cratersAcross = (dir: TslNode, slot: TslNode, wc: TslNode): TslNode => {
    const other = int(faceAcross.element(slot)).toVar();
    const fr = frame(other);
    return cratersOnFace(dir, other, vec3(fr.n), vec3(fr.u), vec3(fr.v), wc);
  };

  const detail = (dir: TslNode, face: TslNode, a: TslNode, b: TslNode, weights: DetailWeights | null): DetailResult => {
    const acc = vec3(0).toVar();
    const g3 = vec3(0).toVar();
    const mask = float(1).toVar();
    for (const pad of pads) {
      const d = length(dir.sub(vec3(pad.dir.x, pad.dir.y, pad.dir.z))).mul(R);
      mask.assign(min(mask, smoothstep(pad.radiusM, pad.radiusM + pad.blendM, d)));
    }
    const wc = (weights?.craters ?? vec3(1)).toVar();
    const wn = weights?.noise ?? null;
    If(mask.greaterThan(0), () => {
      const s = a.mul(faceHalfM).toVar();
      const tm = b.mul(faceHalfM).toVar();
      bands.forEach((_, bi) => {
        const w = bi === 0 ? wc.x : bi === 1 ? wc.y : wc.z;
        If(w.greaterThan(0), () => {
          acc.addAssign(bandCall(bi, face, s, tm).mul(w));
        });
      });
      If(max(abs(a), abs(b)).greaterThan(marginAB), () => {
        If(abs(a).greaterThan(marginAB), () => {
          const slot = face.mul(4).add(select(a.greaterThan(0), int(0), int(1)));
          acc.addAssign(vec3(cratersAcross(dir, slot, wc), 0, 0));
        });
        If(abs(b).greaterThan(marginAB), () => {
          const slot = face.mul(4).add(select(b.greaterThan(0), int(2), int(3)));
          acc.addAssign(vec3(cratersAcross(dir, slot, wc), 0, 0));
        });
      });
      octaves.forEach((oct, oi) => {
        const body = (w: TslNode | null): void => {
          const nv = noise3(dir.mul(oct.inv), uint(oct.seed)).toVar();
          const k = w === null ? float(oct.amplitude) : w.mul(oct.amplitude);
          acc.addAssign(vec3(nv.x.mul(k), 0, 0));
          g3.addAssign(nv.yzw.mul(k.mul(oct.inv)));
        };
        if (wn === null) body(null);
        else {
          const w = oi === 0 ? wn.x : wn.y;
          If(w.greaterThan(0), () => {
            body(w);
          });
        }
      });
    });
    return { h: acc.x.mul(mask), gs: acc.y.mul(mask), gt: acc.z.mul(mask), g3: g3.mul(mask) };
  };

  return {
    frame,
    base,
    detail,
    heightAtDirection: heightAtWith(detail),
    ...farApi,
    halfTexelAB: 1 / n,
    faceHalfM,
  };
}
