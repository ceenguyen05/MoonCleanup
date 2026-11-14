// M0 look-polish r2 item 7: the stamped masks of the look scenes (pure parts) and the rock seating of item 5.
import { describe, expect, it } from "vitest";
import { createMaskBuffer, sampleGrime, stampStroke, type MaskBuffer, type StrokeSpec } from "../materials";
import {
  LANE_PITCH_M,
  LANE_WIDTH_M,
  buildLookMask,
  lookCleanStrokes,
  lookMaskRect,
  wantsStandInGround,
} from "./look-ground";
import { ROCK_BASE_Y, ROCK_SINK, rockGeometry, rockRestY } from "./props";
import { S01_CLEAN_CENTRE, S01_CLEAN_PROBE, S01_CLEAN_RADIUS_M, S01_EXTRA_STROKES } from "./s01-approach";
import { S06_CLEAN_CENTRE, S06_CLEAN_RADIUS_M } from "./s06-night";

const S01 = { cleanCentre: S01_CLEAN_CENTRE, cleanRadiusM: S01_CLEAN_RADIUS_M, extraStrokes: S01_EXTRA_STROKES };
const S06 = { cleanCentre: S06_CLEAN_CENTRE, cleanRadiusM: S06_CLEAN_RADIUS_M };

function mustBuild(options: Parameters<typeof buildLookMask>[0], size: number): MaskBuffer {
  const buffer = buildLookMask(options, size);
  if (buffer === null) throw new Error("no mask");
  return buffer;
}

describe("look-scene ground masks", () => {
  it("keeps every stroke at least 1 m inside the mask rectangle (mask contract: the border reads as dust)", () => {
    const noExtras: readonly StrokeSpec[] = [];
    for (const scene of [S01, { ...S06, extraStrokes: noExtras }]) {
      const rect = lookMaskRect(scene.cleanCentre, scene.cleanRadiusM);
      const strokes: StrokeSpec[] = [...lookCleanStrokes(scene.cleanCentre, scene.cleanRadiusM), ...scene.extraStrokes];
      expect(strokes.length).toBeGreaterThan(30);
      for (const s of strokes) {
        const reach = s.widthM / 2 + 0.2;
        for (const [x, z] of [
          [s.x0, s.z0],
          [s.x1, s.z1],
        ] as const) {
          expect(x - reach).toBeGreaterThan(rect.originX + 1);
          expect(x + reach).toBeLessThan(rect.originX + rect.sizeX - 1);
          expect(z - reach).toBeGreaterThan(rect.originZ + 1);
          expect(z + reach).toBeLessThan(rect.originZ + rect.sizeZ - 1);
        }
      }
    }
  });

  it("lane rows overlap (pitch below the brush width) and are deterministic", () => {
    expect(LANE_PITCH_M).toBeLessThan(LANE_WIDTH_M);
    expect(lookCleanStrokes(S01_CLEAN_CENTRE, S01_CLEAN_RADIUS_M)).toEqual(
      lookCleanStrokes(S01_CLEAN_CENTRE, S01_CLEAN_RADIUS_M),
    );
  });

  it("S01: the patch is clean at its probe and centre, dust beyond, a dust ridge stays between the passes in progress", () => {
    const mask = mustBuild(S01, 512);
    // Probes of the scene (`S01Approach.probes`): clean (-4, -8), grime (-6, 70).
    expect(sampleGrime(mask, S01_CLEAN_PROBE[0], S01_CLEAN_PROBE[1])).toBeLessThan(0.02);
    expect(sampleGrime(mask, -6, 70)).toBe(1);
    expect(sampleGrime(mask, 0, 8)).toBeLessThan(0.02);
    expect(sampleGrime(mask, 0, 8 + S01_CLEAN_RADIUS_M + 4)).toBe(1);
    // Passes in progress at z = -15.4 and -17.6 (1.6 m wide): clean on the lane, dust on the 0.6 m ridge between them.
    expect(sampleGrime(mask, -9, -15.4)).toBeLessThan(0.02);
    expect(sampleGrime(mask, -9, -17.6)).toBeLessThan(0.02);
    expect(sampleGrime(mask, -9, -16.5)).toBeGreaterThan(0.9);
    // The pass walked toward the camera is clean on its centre line; the ground under views `a` / `b` stays dusty.
    expect(sampleGrime(mask, 1.5, -16.75)).toBeLessThan(0.02);
    expect(sampleGrime(mask, -3, -19)).toBe(1);
    // Border texels: full dust, no berm.
    const { width, height, grime, berm } = mask;
    for (let i = 0; i < width; i++) {
      for (const k of [i, (height - 1) * width + i, i * width, i * width + width - 1]) {
        expect(grime[k]).toBe(1);
        expect(berm[k]).toBe(0);
      }
    }
  });

  it("S01: at least 95 % of the disk 2 m inside its radius is clean, and the lane ends step (the outline is not a circle)", () => {
    const mask = mustBuild(S01, 512);
    let clean = 0;
    let total = 0;
    const r = S01_CLEAN_RADIUS_M - 2.5;
    for (let z = -r; z <= r; z += 0.5) {
      for (let x = -r; x <= r; x += 0.5) {
        if (x * x + z * z > r * r) continue;
        total += 1;
        if (sampleGrime(mask, S01_CLEAN_CENTRE[0] + x, S01_CLEAN_CENTRE[1] + z) < 0.05) clean += 1;
      }
    }
    expect(clean / total).toBeGreaterThan(0.95);
    const ends = lookCleanStrokes(S01_CLEAN_CENTRE, S01_CLEAN_RADIUS_M).map((s) => Math.max(s.x0, s.x1));
    const chordError = ends.map((x, i) => {
      const stroke = lookCleanStrokes(S01_CLEAN_CENTRE, S01_CLEAN_RADIUS_M)[i];
      const dz = (stroke?.z0 ?? 0) - S01_CLEAN_CENTRE[1];
      return x + LANE_WIDTH_M / 2 - Math.sqrt(S01_CLEAN_RADIUS_M ** 2 - dz ** 2);
    });
    expect(Math.max(...chordError) - Math.min(...chordError)).toBeGreaterThan(1.5);
    for (const e of chordError) expect(Math.abs(e)).toBeLessThanOrEqual(1.5 + 1e-9);
  });

  it("S06: the lamp pool and the earthlit probe lie on clean ground", () => {
    const mask = mustBuild(S06, 512);
    expect(sampleGrime(mask, 0, 5)).toBeLessThan(0.02);
    expect(sampleGrime(mask, 8, -4)).toBeLessThan(0.02);
    expect(sampleGrime(mask, 0, 8 + S06_CLEAN_RADIUS_M + 4)).toBe(1);
  });

  it("an all-clean scene needs no stamped mask; `?ground=standin` selects the old stand-in", () => {
    expect(buildLookMask({ allClean: true })).toBeNull();
    expect(wantsStandInGround(new URLSearchParams("scene=s01&ground=standin"))).toBe(true);
    expect(wantsStandInGround(new URLSearchParams("scene=s01"))).toBe(false);
  });
});

describe("stroke stamping box (oriented strokes)", () => {
  it("a diagonal stroke gets its whole footprint and a closed berm ring", () => {
    const buffer = createMaskBuffer(512, 512, { originX: -8, originZ: -8, sizeX: 16, sizeZ: 16 });
    const a = (28 * Math.PI) / 180;
    const half = 4;
    const stroke = { x0: -Math.cos(a) * half, z0: -Math.sin(a) * half, x1: Math.cos(a) * half, z1: Math.sin(a) * half };
    stampStroke(buffer, { ...stroke, widthM: 1.2 });
    const at = (along: number, across: number): [number, number] => [
      Math.cos(a) * along - Math.sin(a) * across,
      Math.sin(a) * along + Math.cos(a) * across,
    ];
    const bermAt = (x: number, z: number): number => {
      const i = Math.floor(((x + 8) / 16) * 512);
      const j = Math.floor(((z + 8) / 16) * 512);
      return buffer.berm[j * 512 + i] ?? 0;
    };
    // Footprint: +-(4 + 0.6) along, +-0.6 across. Inside is clean; 4 cm outside every side carries a berm.
    for (let along = -4.5; along <= 4.5; along += 0.25) {
      for (const across of [-0.5, 0, 0.5]) expect(sampleGrime(buffer, ...at(along, across))).toBeLessThan(0.02);
      for (const across of [-0.64, 0.64]) expect(bermAt(...at(along, across))).toBeGreaterThan(0.05);
    }
    for (let across = -0.5; across <= 0.5; across += 0.25) {
      for (const along of [-4.64, 4.64]) expect(bermAt(...at(along, across))).toBeGreaterThan(0.05);
    }
    expect(sampleGrime(buffer, ...at(0, 1.2))).toBe(1);
    expect(sampleGrime(buffer, ...at(5.2, 0))).toBe(1);
  });
});

describe("rock seating (item 5: no light under a boulder)", () => {
  it("no vertex of a rock is above the ground inside its footprint: the lowest ring is the flat base or below it", () => {
    for (const seed of [7, 9, 11]) {
      const geometry = rockGeometry(seed);
      const pos = geometry.getAttribute("position");
      const groundY = -rockRestY(1); // ground plane in the rock's unit frame
      let below = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        // Every vertex of the underside (the lower third of the unit sphere) is under the ground plane.
        if (y <= ROCK_BASE_Y + 1e-6) {
          below += 1;
          expect(y).toBeLessThan(groundY);
        }
      }
      expect(below).toBeGreaterThan(20);
      expect(groundY - ROCK_BASE_Y).toBeCloseTo(ROCK_SINK, 9);
      geometry.dispose();
    }
  });

  it("the ground plane cuts the rock through its side faces all the way round (a closed contact outline)", () => {
    const geometry = rockGeometry(7);
    const pos = geometry.getAttribute("position");
    const groundY = -rockRestY(1);
    // Triangles that straddle the ground plane, binned by azimuth: every 30 degree sector has one.
    const sectors = new Set<number>();
    for (let t = 0; t < pos.count; t += 3) {
      const ys = [pos.getY(t), pos.getY(t + 1), pos.getY(t + 2)];
      if (Math.min(...ys) < groundY && Math.max(...ys) > groundY) {
        const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
        const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
        sectors.add(Math.floor(((Math.atan2(cz, cx) + Math.PI) / (2 * Math.PI)) * 12) % 12);
      }
    }
    expect(sectors.size).toBe(12);
    geometry.dispose();
  });
});
