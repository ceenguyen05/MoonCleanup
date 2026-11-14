// Synthetic assets for the budget checker: generated in code (grid meshes, flat PNGs), run through the real
// optimise + hash + manifest steps, never committed. Usage as a CLI:
//   tsx src/budgets/fixtures.ts <dir>     writes the deliberately oversize fixture into <dir>
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { Document } from "@gltf-transform/core";

import { createIo, optimizeDocument } from "../gltf/io.js";
import { type AssetManifest, hashedFileName, sha256Hex, writeManifest } from "../manifest.js";

export interface FixtureSpec {
  readonly id: string;
  readonly class: string;
  /** Triangle count per LOD node (`<id>_LOD<n>`). */
  readonly lodTriangles: readonly number[];
  readonly textureSize: number;
  readonly materials: number;
}

/** Inside the rock budget: 2000 / 300 / 60 triangles, one 1024 px texture, one material. */
export const PASSING_ROCK: FixtureSpec = {
  id: "fixture_rock_ok",
  class: "rock",
  lodTriangles: [2000, 300, 60],
  textureSize: 1024,
  materials: 1,
};

/** Deliberately oversize: 5000-triangle LOD0, no LOD chain, a 2048 px texture and two materials. */
export const OVERSIZE_ROCK: FixtureSpec = {
  id: "fixture_rock_oversize",
  class: "rock",
  lodTriangles: [5000],
  textureSize: 2048,
  materials: 2,
};

/**
 * Minimal RGB PNG (filter 0) with a generated pattern, enough for the checker to read real image dimensions.
 * It must not be a single colour: glTF-Transform prune() folds solid textures into material factors.
 */
export function patternPng(size: number): Uint8Array {
  const stride = 1 + size * 3;
  const raw = new Uint8Array(stride * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * stride + 1 + x * 3;
      raw[i] = 96 + ((x >> 3) & 63);
      raw[i + 1] = 96 + ((y >> 3) & 63);
      raw[i + 2] = 96 + (((x ^ y) >> 4) & 63);
    }
  }
  const chunk = (tag: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(tag), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, size);
  headerView.setUint32(4, size);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** A bumpy grid with at least `triangles` triangles, split over `groups` primitives. */
function gridPrimitives(
  triangles: number,
  groups: number,
): { positions: Float32Array<ArrayBuffer>; uvs: Float32Array<ArrayBuffer>; indices: Uint32Array<ArrayBuffer>[] } {
  const columns = Math.max(1, Math.round(Math.sqrt(triangles / 2)));
  const rows = Math.ceil(triangles / 2 / columns);
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
  const uvs = new Float32Array((columns + 1) * (rows + 1) * 2);
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= columns; c += 1) {
      const i = r * (columns + 1) + c;
      positions.set([c / columns, Math.sin(c * 1.7) * Math.cos(r * 1.3) * 0.05, r / rows], i * 3);
      uvs.set([c / columns, r / rows], i * 2);
    }
  }
  const all: number[] = [];
  for (let r = 0; r < rows && all.length / 3 < triangles; r += 1) {
    for (let c = 0; c < columns && all.length / 3 < triangles; c += 1) {
      const a = r * (columns + 1) + c;
      const b = a + 1;
      const d = a + columns + 1;
      all.push(a, d, b);
      if (all.length / 3 < triangles) all.push(b, d, d + 1);
    }
  }
  const perGroup = Math.ceil(all.length / 3 / groups) * 3;
  const indices: Uint32Array<ArrayBuffer>[] = [];
  for (let g = 0; g < groups; g += 1) indices.push(new Uint32Array(all.slice(g * perGroup, (g + 1) * perGroup)));
  return { positions, uvs, indices: indices.filter((group) => group.length > 0) };
}

export async function buildFixtureGlb(spec: FixtureSpec): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene(spec.id);
  const texture = document
    .createTexture(`${spec.id}_basecolor`)
    .setMimeType("image/png")
    .setImage(patternPng(spec.textureSize));
  const materials = Array.from({ length: spec.materials }, (_, index) =>
    document
      .createMaterial(`${spec.id}_m${index}`)
      .setBaseColorTexture(texture)
      .setRoughnessFactor(0.9 - index * 0.1),
  );
  spec.lodTriangles.forEach((triangles, lod) => {
    const grid = gridPrimitives(triangles, materials.length);
    const position = document.createAccessor().setType("VEC3").setArray(grid.positions).setBuffer(buffer);
    const uv = document.createAccessor().setType("VEC2").setArray(grid.uvs).setBuffer(buffer);
    const mesh = document.createMesh(`${spec.id}_LOD${lod}`);
    grid.indices.forEach((indices, group) => {
      const material = materials[group];
      const primitive = document
        .createPrimitive()
        .setAttribute("POSITION", position)
        .setAttribute("TEXCOORD_0", uv)
        .setIndices(document.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer));
      if (material) primitive.setMaterial(material);
      mesh.addPrimitive(primitive);
    });
    scene.addChild(document.createNode(`${spec.id}_LOD${lod}`).setMesh(mesh));
  });
  await optimizeDocument(document);
  const io = await createIo();
  return io.writeBinary(document);
}

/** Writes hashed fixture files and a manifest into `directory` (created if needed). */
export async function writeFixtures(directory: string, specs: readonly FixtureSpec[]): Promise<AssetManifest> {
  await mkdir(directory, { recursive: true });
  const assets: Record<string, AssetManifest["assets"][string]> = {};
  for (const spec of specs) {
    const bytes = await buildFixtureGlb(spec);
    const sha256 = sha256Hex(bytes);
    const file = hashedFileName(spec.id, sha256, "glb");
    await writeFile(join(directory, file), bytes);
    assets[spec.id] = {
      file,
      class: spec.class,
      bytes: bytes.byteLength,
      sha256,
      source: "tools/asset-pipeline/src/budgets/fixtures.ts",
      textureFormat: "png",
    };
  }
  const manifest: AssetManifest = { schema: 1, generator: "@moon-cleanup/asset-pipeline fixtures", assets };
  await writeManifest(directory, manifest);
  return manifest;
}

const invokedDirectly = process.argv[1] !== undefined && /fixtures\.[tj]s$/.test(process.argv[1]);
if (invokedDirectly) {
  const target = process.argv[2];
  if (target === undefined) {
    console.error("usage: tsx src/budgets/fixtures.ts <dir>");
    process.exitCode = 2;
  } else {
    writeFixtures(resolve(target), [OVERSIZE_ROCK]).then(
      () => {
        console.log(`wrote the oversize fixture to ${resolve(target)}`);
      },
      (error: unknown) => {
        console.error(error);
        process.exitCode = 2;
      },
    );
  }
}
