// M0-W3-T08: the pure parts of the cost cuts (baked sky parametrisation, PCF kernel choice) and the scene routing.
import { QUALITY_PRESETS } from "@moon-cleanup/shared";
import { SphereGeometry } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { TENT4_OFFSETS, shadowFilterFor } from "./lighting/shadow-filter";
import { defaultShadowFilter } from "./lighting/sun-rig";
import { TYPICAL_MASK_RECT, typicalStrokes } from "./lookdev/typical-worksite";
import { LOOKDEV_SCENE_IDS, createLookdevScene } from "./module";
import { SKY_BAKE_BYTES, skyBakeCoordOfSphereUv, skyBakeDirection } from "./sky/sky-dome";

describe("baked sky backdrop parametrisation", () => {
  it("maps the zenith, the horizon and the azimuth like three's SphereGeometry", () => {
    const d = { x: 0, y: 0, z: 0 };
    skyBakeDirection(0.3, 1, d);
    expect(d.y).toBeCloseTo(1, 6);
    skyBakeDirection(0, 0, d);
    expect([d.x, d.y, d.z].map((v) => +v.toFixed(6))).toEqual([-1, 0, 0]);
    skyBakeDirection(0.25, 0, d);
    expect(d.z).toBeCloseTo(1, 6);
    for (const [u, t] of [
      [0.1, 0.2],
      [0.77, 0.63],
    ] as const) {
      skyBakeDirection(u, t, d);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
      expect(d.y).toBeGreaterThan(0);
    }
  });

  it("the dome's own uv addresses the texel baked for that vertex direction (upper hemisphere)", () => {
    const geometry = new SphereGeometry(1, 16, 8);
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const coord = { u: 0, t: 0 };
    const d = { x: 0, y: 0, z: 0 };
    let checked = 0;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      // Pole rows carry a half-segment u offset in three; below the horizon the lookup clamps to the horizon row.
      if (y < -1e-6 || y > 0.999) continue;
      skyBakeCoordOfSphereUv(uv.getX(i), uv.getY(i), coord);
      skyBakeDirection(coord.u, coord.t, d);
      expect(d.x).toBeCloseTo(position.getX(i), 5);
      expect(d.y).toBeCloseTo(y, 5);
      expect(d.z).toBeCloseTo(position.getZ(i), 5);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(50);
    geometry.dispose();
  });

  it("clamps below the horizon and costs 2 MB", () => {
    const coord = { u: 0, t: 0 };
    skyBakeCoordOfSphereUv(0.4, 0.2, coord);
    expect(coord).toEqual({ u: 0.4, t: 0 });
    expect(SKY_BAKE_BYTES).toBe(1024 * 256 * 8);
  });
});

describe("shadow filter choice", () => {
  it("Low / Medium use the exact tent (pcf3) on cascade 0 (pcf5 beyond it), TRAA presets three's rotated disk", () => {
    expect(defaultShadowFilter(QUALITY_PRESETS.low)).toBe("pcf3");
    expect(defaultShadowFilter(QUALITY_PRESETS.medium)).toBe("pcf3");
    expect(defaultShadowFilter(QUALITY_PRESETS.high)).toBe("vogel5");
    expect(defaultShadowFilter(QUALITY_PRESETS.ultra)).toBe("vogel5");
  });

  it("vogel5 keeps the renderer's filter; tent4 and hard supply their own", () => {
    expect(shadowFilterFor("vogel5")).toBeNull();
    expect(typeof shadowFilterFor("tent4")).toBe("function");
    expect(typeof shadowFilterFor("hard")).toBe("function");
    expect(shadowFilterFor("tent4")).not.toBe(shadowFilterFor("hard"));
  });

  it("the tent taps are symmetric (no shadow shift) and half a radius out", () => {
    expect(TENT4_OFFSETS).toHaveLength(4);
    expect(TENT4_OFFSETS.reduce((s, [x]) => s + x, 0)).toBe(0);
    expect(TENT4_OFFSETS.reduce((s, [, y]) => s + y, 0)).toBe(0);
    for (const [x, y] of TENT4_OFFSETS) expect([Math.abs(x), Math.abs(y)]).toEqual([0.5, 0.5]);
  });
});

describe("scene routing", () => {
  it("routes S02, S03 and the typical worksite next to S01 / S05 / S06", () => {
    expect([...LOOKDEV_SCENE_IDS]).toEqual(["s01", "s02", "s03", "s05", "s06", "typical", "dust", "moon"]);
  });

  it("createLookdevScene only knows s02 and s03", () => {
    const options = {} as Parameters<typeof createLookdevScene>[1];
    expect(createLookdevScene("s01", options)).toBeNull();
    expect(createLookdevScene("typical", options)).toBeNull();
    expect(createLookdevScene("", options)).toBeNull();
  });

  it("the typical worksite's strokes stay inside its mask rectangle", () => {
    const { originX, originZ, sizeX, sizeZ } = TYPICAL_MASK_RECT;
    const strokes = typicalStrokes();
    expect(strokes.length).toBeGreaterThan(10);
    for (const s of strokes) {
      const margin = s.widthM / 2 + 0.2;
      for (const [x, z] of [
        [s.x0, s.z0],
        [s.x1, s.z1],
      ] as const) {
        expect(x - margin).toBeGreaterThan(originX);
        expect(x + margin).toBeLessThan(originX + sizeX);
        expect(z - margin).toBeGreaterThan(originZ);
        expect(z + margin).toBeLessThan(originZ + sizeZ);
      }
    }
  });
});
