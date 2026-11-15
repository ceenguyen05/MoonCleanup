// Height function tests (WDS sections 3.4, 3.5) on the M0-W2-T05 fixture cube (64^2 per face, same pipeline).
import { describe, expect, it } from "vitest";
import {
  CUBE_FACE_ACROSS,
  cubeDirectionFromAB,
  cubeFaceAndAB,
  DEFAULT_HEIGHT_DETAIL,
  GroundHeight,
  HeightCube,
  mulberry32,
  padMasksFromManifest,
  pcgHash,
  valueNoise3,
} from "../../src/index";
import { cubeMeta, goldenSamples, loadFixtureCube, loadFixtureCubeBuffer } from "../support/fixtures";

const R = 2000;

describe("cube mapping (layout v1)", () => {
  it("direction -> (face, a, b) -> direction round-trips", () => {
    const rnd = mulberry32(3);
    const s = { face: 0, a: 0, b: 0 };
    const d = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < 2000; k++) {
      const x = rnd() / 2147483648 - 1;
      const y = rnd() / 2147483648 - 1;
      const z = rnd() / 2147483648 - 1;
      const len = Math.hypot(x, y, z);
      cubeFaceAndAB(x / len, y / len, z / len, s);
      expect(Math.abs(s.a)).toBeLessThanOrEqual(1 + 1e-12);
      expect(Math.abs(s.b)).toBeLessThanOrEqual(1 + 1e-12);
      cubeDirectionFromAB(s.face, s.a, s.b, d);
      expect(Math.abs(d.x - x / len) + Math.abs(d.y - y / len) + Math.abs(d.z - z / len)).toBeLessThan(1e-12);
    }
  });

  it("faces across edges are adjacent and never the face itself or its opposite", () => {
    for (let f = 0; f < 6; f++) {
      const across = Array.from(CUBE_FACE_ACROSS.slice(f * 4, f * 4 + 4));
      expect(new Set(across).size).toBe(4);
      expect(across).not.toContain(f);
      expect(across).not.toContain(f ^ 1);
    }
  });

  it("golden sample labels agree with the face mapping", () => {
    const s = { face: 0, a: 0, b: 0 };
    for (const g of goldenSamples.samples) {
      cubeFaceAndAB(g.dir[0] ?? 0, g.dir[1] ?? 0, g.dir[2] ?? 0, s);
      expect(s.face).toBe(g.face);
      expect(s.a).toBeCloseTo(g.a, 9);
      expect(s.b).toBeCloseTo(g.b, 9);
    }
  });
});

describe("HeightCube (H_base)", () => {
  it("matches the bake's golden samples exactly", () => {
    const cube = loadFixtureCube();
    for (const g of goldenSamples.samples) {
      const h = cube.sample({ x: g.dir[0] ?? 0, y: g.dir[1] ?? 0, z: g.dir[2] ?? 0 });
      expect(Math.abs(h - g.heightM)).toBeLessThanOrEqual(goldenSamples.toleranceM);
    }
  });

  it("an unaligned byte offset takes the copy path with identical results", () => {
    const src = new Uint8Array(loadFixtureCubeBuffer());
    const shifted = new Uint8Array(src.length + 1);
    shifted.set(src, 1);
    const a = loadFixtureCube();
    const b = new HeightCube(shifted.buffer, cubeMeta, 1);
    expect(b.data).not.toBe(a.data);
    for (const g of goldenSamples.samples) {
      expect(b.sampleXYZ(g.dir[0] ?? 0, g.dir[1] ?? 0, g.dir[2] ?? 0)).toBe(
        a.sampleXYZ(g.dir[0] ?? 0, g.dir[1] ?? 0, g.dir[2] ?? 0),
      );
    }
  });

  it("rejects short buffers and bad layouts", () => {
    expect(() => new HeightCube(new ArrayBuffer(10), cubeMeta)).toThrow(RangeError);
    expect(() => new HeightCube(loadFixtureCubeBuffer(), { ...cubeMeta, scaleM: 0 })).toThrow(RangeError);
    expect(() => new HeightCube(loadFixtureCubeBuffer(), { ...cubeMeta, faceSize: 1.5 })).toThrow(RangeError);
  });

  it("stays inside the representable range", () => {
    const cube = loadFixtureCube();
    const rnd = mulberry32(11);
    for (let k = 0; k < 5000; k++) {
      const x = rnd() / 2147483648 - 1;
      const y = rnd() / 2147483648 - 1;
      const z = rnd() / 2147483648 - 1;
      const len = Math.hypot(x, y, z);
      const h = cube.sampleXYZ(x / len, y / len, z / len);
      expect(h).toBeGreaterThanOrEqual(cube.minHeightM);
      expect(h).toBeLessThanOrEqual(cube.maxHeightM);
    }
  });
});

describe("GroundHeight (H_base + H_detail)", () => {
  const cube = loadFixtureCube();
  const ground = new GroundHeight(cube, { radiusM: R });

  it("heightsAt (batched) is bit-identical to heightAtXYZ", () => {
    const rnd = mulberry32(77);
    const n = 512;
    const dirs = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = rnd() / 2147483648 - 1;
      const y = rnd() / 2147483648 - 1;
      const z = rnd() / 2147483648 - 1;
      const l = Math.hypot(x, y, z) || 1;
      dirs[i * 3] = x / l;
      dirs[i * 3 + 1] = y / l;
      dirs[i * 3 + 2] = z / l;
    }
    // Include the poles and an exact face edge.
    dirs.set([0, 1, 0, 0, -1, 0, Math.SQRT1_2, Math.SQRT1_2, 0], 0);
    const out = new Float64Array(n);
    ground.heightsAt(dirs, out, n);
    for (let i = 0; i < n; i++) {
      expect(Object.is(out[i], ground.heightAtXYZ(dirs[i * 3]!, dirs[i * 3 + 1]!, dirs[i * 3 + 2]!))).toBe(true);
    }
    // n limits the work; entries past n are untouched.
    const partial = new Float64Array(4).fill(-999);
    ground.heightsAt(dirs, partial, 2);
    expect(partial[2]).toBe(-999);
  });

  it("detail disabled gives H_base", () => {
    const flat = new GroundHeight(cube, { radiusM: R, detail: null });
    expect(flat.heightAtXYZ(1, 0, 0)).toBe(cube.sampleXYZ(1, 0, 0));
    expect(flat.detailAtXYZ(1, 0, 0)).toBe(0);
    expect(flat.radiusAt({ x: 1, y: 0, z: 0 })).toBe(R + cube.sampleXYZ(1, 0, 0));
  });

  it("detail is bounded and non-trivial", () => {
    const rnd = mulberry32(21);
    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < 20_000; k++) {
      const x = rnd() / 2147483648 - 1;
      const y = rnd() / 2147483648 - 1;
      const z = rnd() / 2147483648 - 1;
      const len = Math.hypot(x, y, z);
      const d = ground.detailAtXYZ(x / len, y / len, z / len);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    // deepest bowl 0.08 * 15 m plus overlaps and noise; rims 0.04 r
    expect(min).toBeLessThan(-0.3);
    expect(max).toBeGreaterThan(0.2);
    expect(min).toBeGreaterThan(-4);
    expect(max).toBeLessThan(3);
  });

  it("detail is continuous across cube edges and corners (no seam step)", () => {
    const rnd = mulberry32(31);
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    let worst = 0;
    const eps = 1e-7; // 0.16 mm in face-space units at R = 2 km
    for (let k = 0; k < 20_000; k++) {
      const face = k % 6;
      const t = (rnd() / 2147483648 - 1) * (k % 50 === 0 ? 1 : 0.999);
      const corner = k % 50 === 0;
      const edgeA = corner ? (rnd() & 1 ? 1 : -1) : 0;
      const along = corner ? (rnd() & 1 ? 1 - eps : -1 + eps) : t;
      if (k % 2 === 0) {
        cubeDirectionFromAB(face, 1 - eps, along, a);
        cubeDirectionFromAB(face, 1 + eps, along, b);
      } else {
        cubeDirectionFromAB(face, along, -1 + eps + edgeA * 0, a);
        cubeDirectionFromAB(face, along, -1 - eps, b);
      }
      const da = ground.detailAtXYZ(a.x, a.y, a.z);
      const db = ground.detailAtXYZ(b.x, b.y, b.z);
      worst = Math.max(worst, Math.abs(da - db));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it("detail fades to zero on outpost pads", () => {
    const pads = padMasksFromManifest({ radiusM: 60, blendM: 20, sites: [{ dir: [0, 0, -1] }] });
    const padded = new GroundHeight(cube, { radiusM: R, pads });
    expect(padded.detailAtXYZ(0, 0, -1)).toBe(0);
    const inside = 50 / R;
    const l = Math.hypot(inside, 1);
    expect(padded.detailAtXYZ(inside / l, 0, -1 / l)).toBe(0);
    const outside = 90 / R;
    const l2 = Math.hypot(outside, 1);
    expect(padded.detailAtXYZ(outside / l2, 0, -1 / l2)).toBe(ground.detailAtXYZ(outside / l2, 0, -1 / l2));
  });

  it("rejects crater bands whose reach exceeds one cell", () => {
    const bad = { ...DEFAULT_HEIGHT_DETAIL, craterBands: [{ cellM: 4, radiusMinM: 1, radiusMaxM: 3, probability: 1 }] };
    expect(() => new GroundHeight(cube, { radiusM: R, detail: bad })).toThrow(RangeError);
  });

  it("hash and noise primitives are pure integer / bounded", () => {
    expect(pcgHash(0)).toBe(pcgHash(0));
    expect(pcgHash(1)).not.toBe(pcgHash(2));
    expect(pcgHash(-1)).toBe(pcgHash(0xffffffff));
    for (let k = 0; k < 1000; k++) {
      const v = valueNoise3(k * 0.37, k * 0.11 - 50, -k * 0.73, 7);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    expect(valueNoise3(3, 4, 5, 9)).toBe(valueNoise3(3, 4, 5, 9));
  });
});
