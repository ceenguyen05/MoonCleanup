// Bench v1 pieces (M0-W3-T07) that need no GPU: the CTMH / CTMW decoders and samplers against the committed bake and its golden
// samples, the loader, the static mask, chunks on the baked height, the regolith material's texture budget, options.

import { afterEach, describe, expect, it } from "vitest";
import { Mesh } from "three/webgpu";
import { createRegolithMaterial } from "../../visuals/materials";
import { BENCH_MASK_RECT, benchMaskStrokes, createBenchMask } from "./bench-mask";
import { addHorizonAttributes, createHorizonVisibility } from "./horizon-visibility";
import { BENCH_DEFAULT_TERRAIN_BASE, parseBenchOptions } from "./options";
import { buildChunkGeometry } from "./terrain-chunks";
import {
  cubeTexelM,
  decodeHeightCube,
  decodeHorizonMap,
  faceAB,
  inflateRaw,
  sampleHeight,
  sampleHorizon,
} from "./terrain-cube";
import { MOON_RADIUS_M, chunkRects, groundY, setTerrainHeightSource, terrainHeightM } from "./terrain-data";
import { loadBakedTerrain } from "./terrain-loader";

// Tests run in Node: read the committed files without Node typings in this package (dynamic import, minimal shape).
interface NodeFs {
  readFileSync(path: URL): Uint8Array;
}
async function readAsset(relative: string): Promise<Uint8Array> {
  const specifier = "node:fs";
  const fs = (await import(/* @vite-ignore */ specifier)) as NodeFs;
  return new Uint8Array(fs.readFileSync(new URL(`../../../../../assets/terrain/${relative}`, import.meta.url)));
}

interface Manifest {
  outputs: Record<string, { file: string; rawSha256: string }>;
}
interface Golden {
  toleranceM: number;
  samples: { label: string; dir: [number, number, number]; face: number; a: number; b: number; heightM: number }[];
}

afterEach(() => setTerrainHeightSource(null));

async function manifest(): Promise<Manifest> {
  return JSON.parse(new TextDecoder().decode(await readAsset("manifest.json"))) as Manifest;
}

describe("baked height cube decode", () => {
  it("decodes the 1024 cube to the golden heights (deflate-raw via DecompressionStream)", async () => {
    const m = await manifest();
    const file = m.outputs["height-cube-1024"]?.file;
    expect(file).toBeDefined();
    const golden = JSON.parse(
      new TextDecoder().decode(await readAsset("fixtures/golden-height-samples-1024.json")),
    ) as Golden;
    const { value: cube } = await decodeHeightCube(await readAsset(file ?? ""), inflateRaw);
    expect(cube.faceSize).toBe(1024);
    expect(cube.padded).toBe(1026);
    expect(golden.samples.length).toBeGreaterThanOrEqual(40);
    for (const s of golden.samples) {
      const [x, y, z] = s.dir;
      const ab = faceAB(x, y, z, { face: 0, a: 0, b: 0 });
      expect(ab.face, s.label).toBe(s.face);
      expect(ab.a, s.label).toBeCloseTo(s.a, 6);
      expect(ab.b, s.label).toBeCloseTo(s.b, 6);
      expect(Math.abs(sampleHeight(cube, x, y, z) - s.heightM), s.label).toBeLessThanOrEqual(golden.toleranceM);
    }
  }, 60_000);

  it("decodes the 256 cube and the horizon map within their ranges", async () => {
    const m = await manifest();
    const cubeFile = m.outputs["height-cube-256"]?.file ?? "";
    const horizonFile = m.outputs["horizon-map"]?.file ?? "";
    const { value: cube } = await decodeHeightCube(await readAsset(cubeFile));
    expect(cube.faceSize).toBe(256);
    // Boreal pad: the +Y pole is levelled (manifest pads.results boreal heightM -5.63).
    expect(sampleHeight(cube, 0, 1, 0)).toBeGreaterThan(-6.5);
    expect(sampleHeight(cube, 0, 1, 0)).toBeLessThan(-4.8);
    const { value: horizon } = await decodeHorizonMap(await readAsset(horizonFile));
    expect(horizon.faceSize).toBe(512);
    const out = new Float32Array(8);
    sampleHorizon(horizon, 0, 1, 0, out);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(horizon.minAngleDeg - 0.01);
      expect(v).toBeLessThanOrEqual(horizon.maxAngleDeg + 0.01);
    }
  }, 60_000);

  it("rejects a file that is not a cube", async () => {
    await expect(decodeHeightCube(new Uint8Array(64))).rejects.toThrow(/CTMH/);
    await expect(decodeHorizonMap(new Uint8Array(64))).rejects.toThrow(/CTMW/);
  });
});

describe("terrain loader", () => {
  it("fetches manifest, cube and horizon through the injected fetch and verifies the raw hashes", async () => {
    const m = await manifest();
    const files = new Map<string, Uint8Array>();
    files.set("/t/manifest.json", await readAsset("manifest.json"));
    for (const key of ["height-cube-256", "horizon-map"]) {
      const file = m.outputs[key]?.file ?? "";
      files.set(`/t/${file}`, await readAsset(file));
    }
    const loaded = await loadBakedTerrain({
      baseUrl: "/t/",
      cube: 256,
      horizon: true,
      verify: true,
      fetchBytes: (url) => {
        const bytes = files.get(url);
        return bytes === undefined ? Promise.reject(new Error(`404 ${url}`)) : Promise.resolve(bytes);
      },
    });
    expect(loaded.report.cubeFaceSize).toBe(256);
    expect(loaded.report.rawHashesMatch).toBe(true);
    expect(loaded.horizon).not.toBeNull();
    await expect(
      loadBakedTerrain({
        baseUrl: "/none/",
        cube: 256,
        horizon: false,
        verify: false,
        fetchBytes: () => Promise.reject(new Error("404")),
      }),
    ).rejects.toThrow("404");
  }, 60_000);
});

describe("chunks on the baked height", () => {
  it("builds from the height source and restores the stand-in on reset", async () => {
    const { value: cube } = await decodeHeightCube(
      await readAsset((await manifest()).outputs["height-cube-256"]?.file ?? ""),
    );
    const standIn = terrainHeightM(10, 10);
    setTerrainHeightSource((x, z) => {
      const len = Math.sqrt(x * x + MOON_RADIUS_M * MOON_RADIUS_M + z * z);
      return sampleHeight(cube, x / len, MOON_RADIUS_M / len, z / len);
    });
    // The pole is the levelled boreal pad: about -5.6 m, flat.
    expect(groundY(0, 0)).toBeCloseTo(terrainHeightM(0, 0), 6);
    expect(terrainHeightM(0, 0)).toBeLessThan(-4.8);
    expect(Math.abs(terrainHeightM(20, 20) - terrainHeightM(0, 0))).toBeLessThan(0.5);
    const rect = chunkRects()[36];
    expect(rect).toBeDefined();
    if (rect === undefined) return;
    const g = buildChunkGeometry(rect, 6);
    const normal = g.getAttribute("normal");
    for (let i = 0; i < normal.count; i += 41) expect(normal.getY(i)).toBeGreaterThan(0.95);
    const position = g.getAttribute("position");
    expect(position.getY(35 * 17 + 17)).toBeLessThan(-4.8);
    g.dispose();
    setTerrainHeightSource(null);
    expect(terrainHeightM(10, 10)).toBe(standIn);
  }, 60_000);

  it("adds eight horizon angles per vertex within the baked range", async () => {
    const m = await manifest();
    const { value: horizon } = await decodeHorizonMap(await readAsset(m.outputs["horizon-map"]?.file ?? ""));
    const rect = chunkRects()[36];
    if (rect === undefined) throw new Error("no chunk");
    const g = buildChunkGeometry(rect);
    addHorizonAttributes(g, horizon);
    const a = g.getAttribute("aHorizonA");
    const b = g.getAttribute("aHorizonB");
    expect(a.count).toBe(g.getAttribute("position").count);
    expect(a.itemSize).toBe(4);
    expect(b.itemSize).toBe(4);
    for (let i = 0; i < a.count; i += 53) {
      for (const v of [a.getX(i), a.getW(i), b.getX(i), b.getW(i)]) {
        expect(v).toBeGreaterThanOrEqual(horizon.minAngleDeg - 0.01);
        expect(v).toBeLessThanOrEqual(horizon.maxAngleDeg + 0.01);
      }
    }
    g.dispose();
    expect(createHorizonVisibility().node).toBeDefined();
  }, 60_000);
});

describe("static mask and material budget", () => {
  it("keeps every stroke inside the mask rectangle with a dusty border", () => {
    const r = BENCH_MASK_RECT;
    for (const s of benchMaskStrokes()) {
      for (const [x, z] of [
        [s.x0, s.z0],
        [s.x1, s.z1],
      ] as const) {
        const reach = s.widthM / 2 + (s.bermWidthM ?? 0.09) + 0.1;
        expect(x - reach).toBeGreaterThan(r.originX + 0.5);
        expect(x + reach).toBeLessThan(r.originX + r.sizeX - 0.5);
        expect(z - reach).toBeGreaterThan(r.originZ + 0.5);
        expect(z + reach).toBeLessThan(r.originZ + r.sizeZ - 0.5);
      }
    }
    const mask = createBenchMask(4, 256);
    const bytes = mask.texture.image.data as Uint8Array;
    // Corner texel: untouched dusty ground (R 255, berm 0). A lane centre (-0, -38): clean.
    expect(bytes[0]).toBe(255);
    expect(bytes[1]).toBe(0);
    const i = Math.floor(((0 - r.originX) / r.sizeX) * 256);
    const j = Math.floor(((-38 - r.originZ) / r.sizeZ) * 256);
    expect(bytes[(j * 256 + i) * 4]).toBe(0);
    mask.texture.dispose();
  });

  it("builds the regolith material on the bench mask within the texture budget", () => {
    const mask = createBenchMask(4, 64);
    const regolith = createRegolithMaterial({
      mask: mask.texture,
      maskRect: BENCH_MASK_RECT,
      maskSize: [64, 64],
      horizonVisibility: createHorizonVisibility().node,
    });
    // Mask + detail tile; CSM cascades, probe and lamp shadow share the 16-texture stage limit (target <= 12 for terrain).
    expect(regolith.textureBindings).toBe(2);
    expect(regolith.fetchCount).toBe(9);
    expect(regolith.material.userData["mcHorizonVisibility"]).toBeDefined();
    const mesh = new Mesh(undefined, regolith.material);
    expect(mesh.material).toBe(regolith.material);
    regolith.dispose();
    mask.texture.dispose();
  });

  it("derives the cube texel size", () => {
    expect(cubeTexelM(1024, MOON_RADIUS_M)).toBeCloseTo(3.07, 2);
    expect(cubeTexelM(256, MOON_RADIUS_M)).toBeCloseTo(12.27, 2);
  });
});

describe("bench v1 options", () => {
  it("defaults to the real terrain at /assets/terrain/ with the 256 cube", () => {
    const o = parseBenchOptions("?scene=bench");
    expect(o.terrain).toBe("real");
    expect(o.terrainBase).toBe(BENCH_DEFAULT_TERRAIN_BASE);
    expect(o.cube).toBe(256);
    expect(o.horizon).toBe(true);
    expect(o.verifyTerrain).toBe(false);
  });
  it("parses the overrides and adds the trailing slash", () => {
    const o = parseBenchOptions("?terrain=standin&terrainBase=/@fs/x/assets/terrain&cube=1024&horizon=off&verify=1");
    expect(o.terrain).toBe("standin");
    expect(o.terrainBase).toBe("/@fs/x/assets/terrain/");
    expect(o.cube).toBe(1024);
    expect(o.horizon).toBe(false);
    expect(o.verifyTerrain).toBe(true);
  });
});
