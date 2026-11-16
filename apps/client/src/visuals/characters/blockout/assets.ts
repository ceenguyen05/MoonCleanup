// Loading of the blockout custodian and Desk Duster v0 GLBs (M1-W3-T07). Cold path: once per session.
//
// The asset pipeline writes content-hashed files plus `manifest.json` into `public/assets/blockout/` (served at
// `/assets/blockout/`). The GLTF loader and the meshopt decoder are imported on demand, so they stay out of the entry
// chunk. Geometry is dequantised once (KHR_mesh_quantization stores int16 positions under a node transform) so the
// limb pivots of the shader live in plain asset space (metres, Y up, facing +Z).

import { BufferAttribute, BufferGeometry, Matrix4, Quaternion, Vector3, type Object3D } from "three/webgpu";

export const BLOCKOUT_BASE_URL = "/assets/blockout/";
export const CUSTODIAN_ASSET_ID = "custodian_blockout";
export const DUSTER_ASSET_ID = "desk_duster_v0";

export interface AssetSocket {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

export interface LoadedAsset {
  readonly id: string;
  /** LOD0..n geometries (dequantised, shared by every instance). */
  readonly levels: readonly BufferGeometry[];
  /** `socket_*` and `pivot_*` nodes in asset space. */
  readonly sockets: ReadonlyMap<string, AssetSocket>;
  /** Manifest fields kept for capture sidecars. */
  readonly file: string;
  readonly placeholder: boolean;
}

interface ManifestEntry {
  readonly file: string;
  readonly placeholder?: boolean;
}

/** Turns a quantised (normalised int) attribute into float32, transforming positions / normals by `matrix`. */
function dequantize(attr: BufferAttribute, matrix: Matrix4 | null, kind: "position" | "normal"): BufferAttribute {
  const n = attr.count;
  const out = new Float32Array(n * 3);
  const v = new Vector3();
  for (let i = 0; i < n; i++) {
    v.set(attr.getX(i), attr.getY(i), attr.getZ(i));
    if (matrix !== null) {
      if (kind === "position") v.applyMatrix4(matrix);
      else v.transformDirection(matrix);
    } else if (kind === "normal") v.normalize();
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return new BufferAttribute(out, 3);
}

/** Extracts LOD geometries and sockets from a parsed glTF scene (exported for tests with a hand-built scene). */
export function extractAsset(id: string, scene: Object3D, file = "", placeholder = true): LoadedAsset {
  scene.updateMatrixWorld(true);
  const levels: BufferGeometry[] = [];
  const sockets = new Map<string, AssetSocket>();
  const lodPattern = new RegExp(`^${id}_LOD(\\d+)$`);
  scene.traverse((node) => {
    const match = lodPattern.exec(node.name);
    const mesh = node as Object3D & { isMesh?: boolean; geometry?: BufferGeometry };
    if (match !== null && mesh.isMesh === true && mesh.geometry !== undefined) {
      const src = mesh.geometry;
      const position = src.getAttribute("position") as BufferAttribute;
      const normal = src.getAttribute("normal") as BufferAttribute;
      const color = src.getAttribute("color") as BufferAttribute | undefined;
      if (color === undefined) throw new Error(`${id}: ${node.name} has no COLOR_0 (slot / part data)`);
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", dequantize(position, node.matrixWorld, "position"));
      geometry.setAttribute("normal", dequantize(normal, node.matrixWorld, "normal"));
      geometry.setAttribute("color", color);
      if (src.index !== null) geometry.setIndex(src.index);
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      geometry.name = node.name;
      levels[Number(match[1])] = geometry;
      return;
    }
    if (node.name.startsWith("socket_") || node.name.startsWith("pivot_")) {
      const position = new Vector3();
      const quaternion = new Quaternion();
      node.matrixWorld.decompose(position, quaternion, new Vector3());
      sockets.set(node.name, { position, quaternion });
    }
  });
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] === undefined) throw new Error(`${id}: LOD${i} missing`);
  }
  if (levels.length === 0) throw new Error(`${id}: no ${id}_LOD<n> meshes`);
  return { id, levels, sockets, file, placeholder };
}

/** Loads both blockout assets through the pipeline manifest. */
export async function loadBlockoutAssets(
  base = BLOCKOUT_BASE_URL,
  fetchFn: typeof fetch = fetch,
): Promise<{ custodian: LoadedAsset; duster: LoadedAsset }> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import("three/addons/loaders/GLTFLoader.js"),
    import("three/addons/libs/meshopt_decoder.module.js"),
  ]);
  const manifestResponse = await fetchFn(`${base}manifest.json`, { cache: "no-cache" });
  if (!manifestResponse.ok) throw new Error(`blockout manifest: HTTP ${manifestResponse.status}`);
  const manifest = (await manifestResponse.json()) as { assets: Record<string, ManifestEntry> };
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const load = async (id: string): Promise<LoadedAsset> => {
    const entry = manifest.assets[id];
    if (entry === undefined) throw new Error(`blockout manifest has no "${id}"`);
    const response = await fetchFn(`${base}${entry.file}`);
    if (!response.ok) throw new Error(`${entry.file}: HTTP ${response.status}`);
    const gltf = await loader.parseAsync(await response.arrayBuffer(), base);
    const asset = extractAsset(id, gltf.scene, entry.file, entry.placeholder === true);
    // The loader's own materials are never used (the custodian material replaces them).
    gltf.scene.traverse((node) => {
      const m = (node as { material?: { dispose(): void } }).material;
      m?.dispose();
    });
    return asset;
  };
  const [custodian, duster] = await Promise.all([load(CUSTODIAN_ASSET_ID), load(DUSTER_ASSET_ID)]);
  return { custodian, duster };
}
