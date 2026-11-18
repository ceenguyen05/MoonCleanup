// Authored Trundle GLB loader (M1-W7-T02). Cold path: the presenter imports this module dynamically after the first
// frame, so the GLTF loader, the meshopt decoder and the asset itself stay out of the entry chunk and the boot path. A
// failed load keeps the procedural model (`buildTrundle`) on screen.
//
// The pipeline output (`public/assets/vehicles/`, class `vehicle`) holds chassis / lamps / drum / wheels LOD0..2 meshes
// with linear albedo x AO in COLOR_0 plus `drum_pivot` / `wheel_pivot` empties, all in the game frame (+Z forward, +Y
// up, +X right, origin = chassis ground point). Only LOD0 is used: the Trundle is always within a few metres of the
// camera. Four meshes, one vertex-colour material (+ the lens material) = the same four draws as the procedural model.

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Vector3,
  type Object3D,
} from "three/webgpu";
import { TRUNDLE_MESH_COUNT, type TrundleParts } from "./trundle-model";

export const TRUNDLE_ASSET_BASE_URL = "/assets/vehicles/";
export const TRUNDLE_ASSET_ID = "trundle";

function bakeGeometry(src: BufferGeometry, matrix: Matrix4, offset: Vector3): BufferGeometry {
  const pos = src.getAttribute("position") as BufferAttribute;
  const nor = src.getAttribute("normal") as BufferAttribute;
  const col = src.getAttribute("color") as BufferAttribute | undefined;
  if (col === undefined) throw new Error("trundle: mesh has no COLOR_0");
  const n = pos.count;
  const p = new Float32Array(n * 3);
  const q = new Float32Array(n * 3);
  const c = new Float32Array(n * 3);
  const v = new Vector3();
  for (let i = 0; i < n; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(matrix).sub(offset);
    p.set([v.x, v.y, v.z], i * 3);
    v.set(nor.getX(i), nor.getY(i), nor.getZ(i)).transformDirection(matrix);
    q.set([v.x, v.y, v.z], i * 3);
    c.set([col.getX(i), col.getY(i), col.getZ(i)], i * 3);
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(p, 3));
  out.setAttribute("normal", new BufferAttribute(q, 3));
  out.setAttribute("color", new BufferAttribute(c, 3));
  if (src.index !== null) out.setIndex(src.index);
  out.computeBoundingSphere();
  return out;
}

/** Builds `TrundleParts` (same node names and pivots as the procedural model) from a parsed glTF scene. */
export function trundlePartsFromScene(scene: Object3D): TrundleParts {
  scene.updateMatrixWorld(true);
  const found = new Map<string, Object3D>();
  scene.traverse((o) => {
    if (o.name.length > 0) found.set(o.name, o);
  });
  const need = (name: string): Object3D => {
    const o = found.get(name);
    if (o === undefined) throw new Error(`trundle: node "${name}" missing`);
    return o;
  };
  const drumAt = new Vector3().setFromMatrixPosition(need("drum_pivot").matrixWorld);
  const wheelAt = new Vector3().setFromMatrixPosition(need("wheel_pivot").matrixWorld);
  const zero = new Vector3();

  const body = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.08 });
  const lensMat = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.25 });
  lensMat.emissive.setHex(0xb09a50);

  const root = new Group();
  root.name = "trundle_root";
  const make = (name: string, mat: MeshStandardNodeMaterial, parent: Object3D, offset: Vector3): Mesh => {
    const node = need(`${name}_LOD0`) as Mesh;
    const mesh = new Mesh(bakeGeometry(node.geometry, node.matrixWorld, offset), mat);
    mesh.name = name;
    mesh.castShadow = name === "chassis";
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const chassis = make("chassis", body, root, zero);
  const lamps = make("lamps", lensMat, root, zero);
  lamps.visible = false;
  const drumPivot = new Group();
  drumPivot.name = "drum_pivot";
  drumPivot.position.copy(drumAt);
  root.add(drumPivot);
  const drum = make("drum", body, drumPivot, drumAt);
  const wheelPivot = new Group();
  wheelPivot.name = "wheel_pivot";
  wheelPivot.position.copy(wheelAt);
  root.add(wheelPivot);
  const wheels = make("wheels", body, wheelPivot, wheelAt);
  const meshes = [chassis, lamps, drum, wheels];
  if (meshes.length !== TRUNDLE_MESH_COUNT) throw new Error("trundle: mesh count drifted from the draw budget");
  return { root, chassis, drumPivot, wheelPivot, lamps, meshes, materials: [body, lensMat] };
}

/** Fetches the manifest entry, parses the GLB (meshopt) and builds the parts. Rejects on any failure. */
export async function loadTrundleGlb(
  base = TRUNDLE_ASSET_BASE_URL,
  fetchFn: typeof fetch = fetch,
): Promise<TrundleParts> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import("three/addons/loaders/GLTFLoader.js"),
    import("three/addons/libs/meshopt_decoder.module.js"),
  ]);
  const manifestResponse = await fetchFn(`${base}manifest.json`, { cache: "no-cache" });
  if (!manifestResponse.ok) throw new Error(`trundle manifest: HTTP ${manifestResponse.status}`);
  const manifest = (await manifestResponse.json()) as { assets: Record<string, { file: string } | undefined> };
  const entry = manifest.assets[TRUNDLE_ASSET_ID];
  if (entry === undefined || !/^[\w.-]+\.glb$/.test(entry.file))
    throw new Error(`trundle manifest: no "${TRUNDLE_ASSET_ID}"`);
  const response = await fetchFn(`${base}${entry.file}`);
  if (!response.ok) throw new Error(`${entry.file}: HTTP ${response.status}`);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(await response.arrayBuffer(), base);
  const parts = trundlePartsFromScene(gltf.scene);
  gltf.scene.traverse((node) => {
    const m = (node as { material?: { dispose(): void } }).material;
    m?.dispose();
    (node as { geometry?: BufferGeometry }).geometry?.dispose();
  });
  return parts;
}
