import { LoadingManager, Mesh, Texture, type Object3D, type WebGPURenderer } from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import basisJs from "three/examples/jsm/libs/basis/basis_transcoder.js?url";
import basisWasm from "three/examples/jsm/libs/basis/basis_transcoder.wasm?url";

export const OUTPOST_PIECES = ["assay_counter", "receiving_gate", "dump_plate", "flood_mast"] as const;
export type OutpostPiece = (typeof OUTPOST_PIECES)[number];
export type OutpostKit = ReadonlyMap<OutpostPiece, readonly Object3D[]>;

/** Keep export transforms, including meshopt quantization transforms, on every clone. */
export function extractOutpostKit(scene: Object3D): OutpostKit {
  scene.updateMatrixWorld(true);
  const kit = new Map<OutpostPiece, Object3D[]>();
  for (const piece of OUTPOST_PIECES) {
    const levels: Object3D[] = [];
    for (let level = 0; level < 3; level++) {
      const source = scene.getObjectByName(`${piece}_LOD${level}`);
      if (!source) throw new Error(`Outpost kit missing ${piece}_LOD${level}`);
      const clone = source.clone(true);
      clone.matrix.copy(source.matrixWorld);
      clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
      clone.traverse((node) => {
        if (node instanceof Mesh) node.castShadow = node.receiveShadow = true;
      });
      levels.push(clone);
    }
    kit.set(piece, levels);
  }
  return kit;
}

/** Disposes shared GPU resources exactly once, including textures from the glTF materials. */
export function disposeOutpostKit(kit: OutpostKit): void {
  const resources = new Set<{ dispose(): void }>();
  for (const levels of kit.values())
    for (const root of levels)
      root.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        resources.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          resources.add(material);
          for (const value of Object.values(material)) if (value instanceof Texture) resources.add(value);
        }
      });
  for (const resource of resources) resource.dispose();
}

/** Call only after renderer.init(). Vite emits the installed three revision's transcoder as local assets. */
export async function loadOutpostKit(renderer: WebGPURenderer, base = "/assets/outpost/"): Promise<OutpostKit> {
  const manager = new LoadingManager();
  manager.setURLModifier((url) =>
    url.endsWith("basis_transcoder.js") ? basisJs : url.endsWith("basis_transcoder.wasm") ? basisWasm : url,
  );
  const ktx = new KTX2Loader(manager).setWorkerLimit(2).detectSupport(renderer);
  const loader = new GLTFLoader(manager).setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);
  try {
    const response = await fetch(`${base}manifest.json`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`outpost manifest: HTTP ${response.status}`);
    const manifest = (await response.json()) as { assets: Record<string, { file: string }> };
    const file = manifest.assets["boreal_hero_kit"]?.file;
    if (!file || !/^[\w.-]+\.glb$/.test(file)) throw new Error("outpost manifest: invalid boreal_hero_kit file");
    const gltf = await loader.loadAsync(`${base}${file}`);
    return extractOutpostKit(gltf.scene);
  } finally {
    ktx.dispose();
  }
}
