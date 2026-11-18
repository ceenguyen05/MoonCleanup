// Loading of the blockout custodian and Desk Duster v0 GLBs (M1-W3-T07). Cold path: once per session.
//
// The asset pipeline writes content-hashed files plus `manifest.json` into `public/assets/blockout/` (served at
// `/assets/blockout/`). The GLTF loader and the meshopt decoder are imported on demand, so they stay out of the entry
// chunk. Geometry is dequantised once (KHR_mesh_quantization stores int16 positions under a node transform) so the
// limb pivots of the shader live in plain asset space (metres, Y up, facing +Z).

import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Quaternion,
  Vector3,
  type Object3D,
  type SkinnedMesh,
  type Texture,
} from "three/webgpu";

export const BLOCKOUT_BASE_URL = "/assets/blockout/";
export const CUSTODIAN_ASSET_ID = "custodian_blockout";
export const DUSTER_ASSET_ID = "desk_duster_v0";

/** Production custodian and hand tools (M1-W4-T07), pipeline output in `public/assets/{characters,tools}/`. */
export const CHARACTERS_BASE_URL = "/assets/characters/";
export const TOOLS_BASE_URL = "/assets/tools/";
export const SUIT_ASSET_ID = "custodian_suit";
/** Tool asset ids by animation tool class (`TOOL_CLASS`: palm, blade, broom, bar). */
export const TOOL_ASSET_IDS: ReadonlyMap<number, string> = new Map([
  [1, "desk_duster"],
  [2, "crescent_squeegee"],
  [3, "bristle_broom"],
  [4, "lane_broom"],
]);

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
  /** Numeral glyph atlas from the GLB's material (production suit), else null. */
  readonly glyphs?: Texture | null;
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

/**
 * Bind-pose positions of a skinned mesh in asset space. glTF-Transform's quantisation moves the dequantisation of
 * skinned meshes into the inverse bind matrices (the node transform stays identity), so the skin itself is applied.
 */
function skinnedBindPositions(mesh: SkinnedMesh): BufferAttribute {
  const attr = mesh.geometry.getAttribute("position") as BufferAttribute;
  const n = attr.count;
  const out = new Float32Array(n * 3);
  const v = new Vector3();
  mesh.skeleton.update();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(attr, i);
    mesh.applyBoneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
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
      const skinned = (node as Partial<SkinnedMesh>).isSkinnedMesh === true;
      geometry.setAttribute(
        "position",
        skinned ? skinnedBindPositions(node as SkinnedMesh) : dequantize(position, node.matrixWorld, "position"),
      );
      // Rigid single-bone skin: the bind pose only scales (uniform) and translates, so normals keep their direction.
      geometry.setAttribute("normal", dequantize(normal, skinned ? null : node.matrixWorld, "normal"));
      geometry.setAttribute("color", color);
      // TEXCOORD_0 feeds the glyph decal; meshes without it get zeros so one shared material fits every mesh.
      const uv = src.getAttribute("uv") as BufferAttribute | undefined;
      geometry.setAttribute("uv", uv ?? new BufferAttribute(new Float32Array(position.count * 2), 2));
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
  let glyphs: Texture | null = null;
  scene.traverse((node) => {
    const material = (node as { material?: { normalMap?: Texture | null } }).material;
    if (glyphs === null && material?.normalMap) glyphs = material.normalMap;
  });
  return { id, levels, sockets, file, placeholder, glyphs };
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

/** Renderer shape the KTX2 loader's `detectSupport` needs (WebGPURenderer satisfies it). */
export type Ktx2Renderer = Parameters<import("three/addons/loaders/KTX2Loader.js").KTX2Loader["detectSupport"]>[0];

export interface ProductionAssets {
  readonly custodian: LoadedAsset;
  /** Tool assets by animation tool class (palm, blade, broom, bar). */
  readonly tools: ReadonlyMap<number, LoadedAsset>;
}

/**
 * Loads the production custodian (skinned GLB, KTX2 glyph atlas) and the T1-T4 hand tools through their manifests.
 * `renderer` (optional, after `init()`) lets the KTX2 transcoder pick a GPU block format; without it the 512 px glyph
 * atlas is transcoded to plain RGBA8 (about 1.4 MB with mips), which every backend accepts. Cold path.
 */
export async function loadProductionAssets(
  renderer: Ktx2Renderer | null = null,
  fetchFn: typeof fetch = fetch,
): Promise<ProductionAssets> {
  const [{ GLTFLoader }, { KTX2Loader }, { MeshoptDecoder }, basis] = await Promise.all([
    import("three/addons/loaders/GLTFLoader.js"),
    import("three/addons/loaders/KTX2Loader.js"),
    import("three/addons/libs/meshopt_decoder.module.js"),
    Promise.all([
      import("three/examples/jsm/libs/basis/basis_transcoder.js?url"),
      import("three/examples/jsm/libs/basis/basis_transcoder.wasm?url"),
    ]),
  ]);
  const { LoadingManager } = await import("three/webgpu");
  const [basisJs, basisWasm] = [basis[0].default, basis[1].default];
  const manager = new LoadingManager();
  manager.setURLModifier((url) =>
    url.endsWith("basis_transcoder.js") ? basisJs : url.endsWith("basis_transcoder.wasm") ? basisWasm : url,
  );
  const ktx = new KTX2Loader(manager).setTranscoderPath("/").setWorkerLimit(1);
  if (renderer !== null) ktx.detectSupport(renderer);
  else
    ktx.workerConfig = {
      astcSupported: false,
      astcHDRSupported: false,
      etc1Supported: false,
      etc2Supported: false,
      dxtSupported: false,
      bptcSupported: false,
      pvrtcSupported: false,
    };
  const loader = new GLTFLoader(manager).setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
  const manifests = new Map<string, Record<string, ManifestEntry>>();
  const manifestFor = async (base: string): Promise<Record<string, ManifestEntry>> => {
    let m = manifests.get(base);
    if (m === undefined) {
      const response = await fetchFn(`${base}manifest.json`, { cache: "no-cache" });
      if (!response.ok) throw new Error(`${base}manifest.json: HTTP ${response.status}`);
      m = ((await response.json()) as { assets: Record<string, ManifestEntry> }).assets;
      manifests.set(base, m);
    }
    return m;
  };
  const load = async (base: string, id: string): Promise<LoadedAsset> => {
    const entry = (await manifestFor(base))[id];
    if (entry === undefined || !/^[\w.-]+\.glb$/.test(entry.file)) throw new Error(`${base}manifest.json: no "${id}"`);
    const response = await fetchFn(`${base}${entry.file}`);
    if (!response.ok) throw new Error(`${entry.file}: HTTP ${response.status}`);
    const gltf = await loader.parseAsync(await response.arrayBuffer(), base);
    const asset = extractAsset(id, gltf.scene, entry.file, entry.placeholder === true);
    gltf.scene.traverse((node) => {
      const m = (node as { material?: { dispose(): void } }).material;
      m?.dispose(); // the glyph texture survives: the custodian material owns it
    });
    return asset;
  };
  try {
    const custodian = load(CHARACTERS_BASE_URL, SUIT_ASSET_ID);
    const tools = [...TOOL_ASSET_IDS].map(async ([cls, id]) => [cls, await load(TOOLS_BASE_URL, id)] as const);
    const [c, ...t] = await Promise.all([custodian, ...tools]);
    return { custodian: c, tools: new Map(t) };
  } finally {
    ktx.dispose();
  }
}
