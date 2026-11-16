import { describe, expect, it } from "vitest";
import { MeshLambertNodeMaterial } from "three/webgpu";
import { normalize, vec3 } from "three/tsl";
import { applyTerrainRegolith, createTerrainRegolithMaterial, type RegolithLayer } from "./terrain-regolith";
import { parseCostSplits, TerrainRegolithProvider } from "./terrain-regolith-provider";
import {
  REGOLITH_PERIOD_M,
  SELECTOR_TILES,
  TERRAIN_DETAIL,
  dominantAxis,
  tileM,
  wrapPeriod,
} from "./terrain-regolith-constants";

describe("terrain regolith constants", () => {
  it("every tile divides the period and every stochastic scale divides into selector cells", () => {
    for (const scale of Object.values(TERRAIN_DETAIL)) {
      expect(Number.isInteger(scale.tiles)).toBe(true);
      expect(tileM(scale) * scale.tiles).toBeCloseTo(REGOLITH_PERIOD_M, 9);
      if (scale.stochastic) expect(scale.tiles % SELECTOR_TILES).toBe(0);
    }
  });

  it("orders the scales close -> far and the fades start before they end", () => {
    const sizes = Object.values(TERRAIN_DETAIL).map(tileM);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeGreaterThan(sizes[i - 1]!);
    for (const scale of Object.values(TERRAIN_DETAIL)) {
      if (scale.fadeM !== null) expect(scale.fadeM[1]).toBeGreaterThan(scale.fadeM[0]);
    }
  });

  it("wraps floor-based and keeps sub-millimetre precision at moon-radius coordinates", () => {
    expect(wrapPeriod(-1)).toBe(REGOLITH_PERIOD_M - 1);
    expect(wrapPeriod(REGOLITH_PERIOD_M + 2.5)).toBe(2.5);
    // A point 1.7374e6 m out: wrapped value is < period, so float32 keeps ~0.5 mm (ulp at 4096 = 4.9e-4).
    const w = wrapPeriod(1_737_400.123);
    expect(w).toBeGreaterThanOrEqual(0);
    expect(w).toBeLessThan(REGOLITH_PERIOD_M);
    expect(Math.fround(w + 0.25) - (w + 0.25)).toBeLessThan(5e-4);
  });

  it("picks the cube face of the direction, Boreal (+Y) for the north pole", () => {
    expect(dominantAxis(0.1, 1, 0.2)).toBe(1);
    expect(dominantAxis(-0.9, 0.2, 0.1)).toBe(0);
    expect(dominantAxis(0.1, -0.3, -0.95)).toBe(2);
    expect(dominantAxis(1, 1, 0)).toBe(1);
  });
});

describe("terrain regolith graph", () => {
  const normal = normalize(vec3(0, 1, 0));

  it("costs 7 taps of one texture (5 with single close taps) and owns its default tile", () => {
    const a = applyTerrainRegolith(new MeshLambertNodeMaterial(), normal);
    expect(a.fetchCount).toBe(7);
    expect(a.textureBindings).toBe(1);
    a.dispose();
    const b = applyTerrainRegolith(new MeshLambertNodeMaterial(), normal, { singleTap: true });
    expect(b.fetchCount).toBe(5);
    b.dispose();
  });

  it("runs layer hooks with the precise coordinate and counts their fetches", () => {
    const seen: string[] = [];
    const footprint: RegolithLayer = (ctx) => {
      seen.push(ctx.coord === undefined ? "none" : "coord");
      return {
        slope: ctx.coord.mul(0),
        albedo: ctx.toCamera.mul(0).add(0.9),
        thickness: ctx.toCamera.mul(0).add(1),
        fetches: 2,
      };
    };
    const r = applyTerrainRegolith(new MeshLambertNodeMaterial(), normal, { layers: [footprint] });
    expect(seen).toEqual(["coord"]);
    expect(r.fetchCount).toBe(9);
    r.dispose();
  });

  it("builds a terrain material through the surface hook and sets colour and normal", () => {
    let applied = 0;
    const { material, regolith } = createTerrainRegolithMaterial({ normalWorld: normal }, () => (applied += 1));
    expect(applied).toBe(1);
    expect(material.name).toBe("mc:terrain-regolith");
    expect(material.colorNode).not.toBeNull();
    expect(material.normalNode).not.toBeNull();
    regolith.dispose();
  });
});

describe("terrain regolith provider (terrain material hook H1)", () => {
  const surface = { normalWorld: normalize(vec3(0, 1, 0)) };

  it("builds one regolith material per terrain build, sharing one detail tile, and applies the surface", () => {
    const provider = new TerrainRegolithProvider(new URLSearchParams(""));
    let applied = 0;
    const factory = provider.factory<typeof surface>(() => (applied += 1));
    expect(factory).toBeTypeOf("function");
    const a = factory!(surface);
    const b = factory!(surface);
    expect(a).not.toBe(b);
    expect(a.name).toBe("mc:terrain-regolith");
    expect(applied).toBe(2);
    expect(provider.count).toBe(2);
    provider.dispose();
    expect(provider.count).toBe(0);
  });

  it("supplies no factory with regolith=0, so the terrain keeps its plain material", () => {
    const provider = new TerrainRegolithProvider(new URLSearchParams("regolith=0"));
    expect(provider.factory(() => undefined)).toBeUndefined();
  });

  it("parses the cost-split knob and builds every split", () => {
    expect(parseCostSplits("noclose, NOFAR,bogus")).toEqual(["noclose", "nofar"]);
    expect(parseCostSplits(null)).toEqual([]);
    for (const split of ["noclose", "nofar", "nobranch", "gradfar"] as const) {
      const r = applyTerrainRegolith(new MeshLambertNodeMaterial(), surface.normalWorld, { costSplits: [split] });
      expect(r.textureBindings).toBe(1);
      r.dispose();
    }
  });
});
