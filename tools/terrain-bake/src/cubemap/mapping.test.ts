import { describe, expect, it } from "vitest";

import { randomDirection, seededRandom } from "./analysis.js";
import { abOnFace, axisCoord, directionFromFaceAB, FACE_BASIS, faceAndAB, type FaceAB, type Vec3 } from "./mapping.js";

describe("equal-angle cube mapping", () => {
  it("round-trips random directions through (face, a, b)", () => {
    const rand = seededRandom(1);
    const d: Vec3 = { x: 0, y: 0, z: 0 };
    const back: Vec3 = { x: 0, y: 0, z: 0 };
    const ab: FaceAB = { face: 0, a: 0, b: 0 };
    for (let k = 0; k < 5000; k++) {
      randomDirection(rand, d);
      faceAndAB(d.x, d.y, d.z, ab);
      expect(Math.abs(ab.a)).toBeLessThanOrEqual(1 + 1e-12);
      expect(Math.abs(ab.b)).toBeLessThanOrEqual(1 + 1e-12);
      directionFromFaceAB(ab.face, ab.a, ab.b, back);
      expect(back.x).toBeCloseTo(d.x, 12);
      expect(back.y).toBeCloseTo(d.y, 12);
      expect(back.z).toBeCloseTo(d.z, 12);
    }
  });

  it("maps every texel centre of a 16^2 face back to itself", () => {
    const n = 16;
    const d: Vec3 = { x: 0, y: 0, z: 0 };
    const ab: FaceAB = { face: 0, a: 0, b: 0 };
    for (let face = 0; face < 6; face++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          directionFromFaceAB(face, axisCoord(i, n), axisCoord(j, n), d);
          faceAndAB(d.x, d.y, d.z, ab);
          expect(ab.face).toBe(face);
          expect(ab.a).toBeCloseTo(axisCoord(i, n), 12);
          expect(ab.b).toBeCloseTo(axisCoord(j, n), 12);
        }
      }
    }
  });

  it("uses outward right-handed bases and the section-1 world frame", () => {
    for (const f of FACE_BASIS) {
      const [ux, uy, uz] = f.u;
      const [vx, vy, vz] = f.v;
      const cross = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx].map((v) => v + 0);
      expect(cross).toEqual([...f.n]);
    }
    const ab: FaceAB = { face: 0, a: 0, b: 0 };
    // +Y north pole is the +Y face centre, -Z (lon 90E) is the -Z face centre.
    expect(faceAndAB(0, 1, 0, ab).face).toBe(2);
    expect(faceAndAB(0, 0, -1, ab).face).toBe(5);
  });

  it("extends beyond a face edge into the gutter plane continuously", () => {
    const ab: FaceAB = { face: 0, a: 0, b: 0 };
    abOnFace(4, 1, 0, 1.02, ab);
    expect(Math.abs(ab.a)).toBeLessThan(1);
    abOnFace(0, 1, 0, -1.02, ab);
    expect(Math.abs(ab.a)).toBeLessThan(1.05);
  });
});
