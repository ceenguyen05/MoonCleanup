// glTF-Transform I/O with every extension and the meshopt codec registered, plus the optimisation chain
// (dedup, prune, weld, reorder, quantize, EXT_meshopt_compression) and the statistics the checker needs.
import { type Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

import { type EncodedTexture, encodeTextures, type KtxStatus } from "../textures/ktx.js";

const TRIANGLES_MODE = 4;
const LOD_SUFFIX = /_LOD(\d+)$/;

export interface TextureStats {
  readonly name: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}

export interface GlbStats {
  /** Triangle count per LOD index, read from node names ending in `_LOD<n>`. */
  readonly lodTriangles: readonly number[];
  /** Triangles on mesh nodes without a `_LOD<n>` suffix. */
  readonly unassignedTriangles: number;
  readonly textures: readonly TextureStats[];
  readonly materials: number;
  readonly extensionsUsed: readonly string[];
}

export async function createIo(): Promise<NodeIO> {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
}

/** Runs the mesh optimisation chain in place. Textures are left untouched here (KTX2 is encodeTextures). */
export async function optimizeDocument(document: Document): Promise<void> {
  await document.transform(
    dedup(),
    prune(),
    weld(),
    // UVs tile along trim sheets (range > 1), so they get 14 bits instead of the default 12.
    meshopt({ encoder: MeshoptEncoder, level: "medium", quantizeTexcoord: 14 }),
  );
}

export async function optimizeGlb(
  raw: Uint8Array,
  ktx?: KtxStatus,
  onEncoded?: (t: EncodedTexture[]) => void,
): Promise<Uint8Array> {
  const io = await createIo();
  const document = await io.readBinary(raw);
  await optimizeDocument(document);
  if (ktx?.available) onEncoded?.(await encodeTextures(document, ktx));
  return io.writeBinary(document);
}

export function documentStats(document: Document): GlbStats {
  const root = document.getRoot();
  const lodTriangles: number[] = [];
  let unassignedTriangles = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    let triangles = 0;
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== TRIANGLES_MODE) continue;
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : (primitive.getAttribute("POSITION")?.getCount() ?? 0);
      triangles += Math.floor(count / 3);
    }
    const match = LOD_SUFFIX.exec(node.getName());
    if (match?.[1] === undefined) {
      unassignedTriangles += triangles;
    } else {
      const lod = Number(match[1]);
      lodTriangles[lod] = (lodTriangles[lod] ?? 0) + triangles;
    }
  }
  const textures = root.listTextures().map((texture): TextureStats => {
    const size = texture.getSize();
    return {
      name: texture.getName() || texture.getURI() || "(unnamed)",
      mimeType: texture.getMimeType(),
      width: size?.[0] ?? 0,
      height: size?.[1] ?? 0,
      bytes: texture.getImage()?.byteLength ?? 0,
    };
  });
  return {
    lodTriangles: Array.from(lodTriangles, (value) => value ?? 0),
    unassignedTriangles,
    textures,
    materials: root.listMaterials().length,
    extensionsUsed: root.listExtensionsUsed().map((extension) => extension.extensionName),
  };
}

export async function glbStats(bytes: Uint8Array): Promise<GlbStats> {
  const io = await createIo();
  return documentStats(await io.readBinary(bytes));
}
