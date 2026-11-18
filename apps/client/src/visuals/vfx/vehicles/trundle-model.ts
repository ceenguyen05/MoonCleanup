// Trundle blockout model (M1-W7-T02, art-direction vehicles: walk-behind push cart, tall T-handle, low body, spinning
// brush drum in front with yellow hub caps, small smoked hopper; about 1.4 x 0.9 x 1.1 m). Built from primitives that
// are MERGED into four meshes with baked vertex colours and one shared material (UHD 620 floor: four draws, not
// thirty), until the Blender GLB replaces them through the asset pipeline. Local frame: +Z forward (drum end),
// +Y up, +X right; origin = chassis ground point.
//
// Node / bone naming spec (published for the animation-engineer; the GLB must keep these node names):
//   trundle_root > chassis (sprung body: dips with the sim's per-probe compression; merged body, frame, hopper, handle)
//   trundle_root > lamps (head lamp lenses; shown while the sim's lights are on)
//   trundle_root > drum_pivot (spins about X; sim probe 0) > drum (bristle drum + yellow hub caps)
//   trundle_root > wheel_pivot (spins about X; sim probes 1 and 2) > wheels (both wheels, one mesh)

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  type Object3D,
} from "three/webgpu";

export const TRUNDLE_DRUM_RADIUS_M = 0.2;
export const TRUNDLE_WHEEL_RADIUS_M = 0.22;
/** Forward distance from the chassis point to the drum's front edge (spray origin). */
export const TRUNDLE_DRUM_FRONT_M = 0.78;
/** Draw calls the Trundle adds (meshes), for the budget test. */
export const TRUNDLE_MESH_COUNT = 4;

export interface TrundleParts {
  readonly root: Group;
  readonly chassis: Mesh;
  readonly drumPivot: Group;
  readonly wheelPivot: Group;
  readonly lamps: Mesh;
  readonly meshes: readonly Mesh[];
  readonly materials: readonly MeshStandardNodeMaterial[];
}

interface Piece {
  readonly geo: BufferGeometry;
  readonly color: number;
  readonly m: Matrix4;
}

const tmpColor = new Color();

/** Bakes `pieces` into one geometry (position, normal, colour attributes, indexed). */
export function mergePieces(pieces: readonly Piece[]): BufferGeometry {
  let verts = 0;
  let idx = 0;
  for (const p of pieces) {
    verts += p.geo.getAttribute("position").count;
    idx += p.geo.getIndex()?.count ?? 0;
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const index = new Uint32Array(idx);
  let v = 0;
  let i = 0;
  for (const p of pieces) {
    const g = p.geo.clone();
    g.applyMatrix4(p.m);
    tmpColor.setHex(p.color);
    const gp = g.getAttribute("position");
    const gn = g.getAttribute("normal");
    for (let k = 0; k < gp.count; k++) {
      pos.set([gp.getX(k), gp.getY(k), gp.getZ(k)], (v + k) * 3);
      nor.set([gn.getX(k), gn.getY(k), gn.getZ(k)], (v + k) * 3);
      col.set([tmpColor.r, tmpColor.g, tmpColor.b], (v + k) * 3);
    }
    const gi = g.getIndex();
    if (gi !== null) for (let k = 0; k < gi.count; k++) index[i++] = gi.getX(k) + v;
    v += gp.count;
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(pos, 3));
  out.setAttribute("normal", new BufferAttribute(nor, 3));
  out.setAttribute("color", new BufferAttribute(col, 3));
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

const at = (x: number, y: number, z: number, rx = 0, rz = 0): Matrix4 => {
  const m = new Matrix4().makeRotationFromEuler(new Euler(rx, 0, rz));
  return m.setPosition(x, y, z);
};

function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): Piece {
  return { geo: new BoxGeometry(w, h, d), color, m: at(x, y, z) };
}

function cyl(
  r: number,
  len: number,
  seg: number,
  color: number,
  x: number,
  y: number,
  z: number,
  alongX: boolean,
  tilt = 0,
): Piece {
  const geo = new CylinderGeometry(r, r, len, seg);
  return { geo, color, m: alongX ? at(x, y, z, 0, Math.PI / 2) : at(x, y, z, tilt, 0) };
}

export function buildTrundle(): TrundleParts {
  const WHITE = 0xe8e4da;
  const CHAR = 0x3a3f45;
  const YELLOW = 0xf2b81c;
  const BRISTLE = 0x6b5a48;
  const SMOKED = 0x2a3138;
  const LENS = 0xfff4cf;

  const root = new Group();
  root.name = "trundle_root";
  const body = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 });
  const lensMat = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.3 });
  lensMat.emissive.setHex(0x8a7a40);

  const make = (name: string, pieces: Piece[], mat: MeshStandardNodeMaterial, parent: Object3D): Mesh => {
    const mesh = new Mesh(mergePieces(pieces), mat);
    mesh.name = name;
    mesh.castShadow = name === "chassis"; // drum and wheels are hidden under the body: no shadow-pass draws for them
    mesh.receiveShadow = true;
    parent.add(mesh);
    for (const p of pieces) p.geo.dispose();
    return mesh;
  };

  const chassis = make(
    "chassis",
    [
      box(0.9, 0.28, 1.1, WHITE, 0, 0.36, 0.05),
      box(0.96, 0.08, 1.2, CHAR, 0, 0.2, 0.05),
      box(0.7, 0.3, 0.5, SMOKED, 0, 0.64, -0.12),
      cyl(0.025, 0.9, 8, CHAR, 0, 0.95, -0.55, false, 0.35),
      { geo: new CylinderGeometry(0.03, 0.03, 0.62, 8), color: YELLOW, m: at(0, 1.38, -0.7, 0, Math.PI / 2) },
    ],
    body,
    root,
  );
  const lamps = make(
    "lamps",
    [box(0.12, 0.08, 0.04, LENS, -0.3, 0.42, 0.62), box(0.12, 0.08, 0.04, LENS, 0.3, 0.42, 0.62)],
    lensMat,
    root,
  );
  lamps.visible = false;

  const drumPivot = new Group();
  drumPivot.name = "drum_pivot";
  drumPivot.position.set(0, TRUNDLE_DRUM_RADIUS_M, TRUNDLE_DRUM_FRONT_M - TRUNDLE_DRUM_RADIUS_M);
  root.add(drumPivot);
  const drum = make(
    "drum",
    [
      cyl(TRUNDLE_DRUM_RADIUS_M, 1.1, 14, BRISTLE, 0, 0, 0, true),
      cyl(0.09, 0.06, 10, YELLOW, -0.58, 0, 0, true),
      cyl(0.09, 0.06, 10, YELLOW, 0.58, 0, 0, true),
    ],
    body,
    drumPivot,
  );

  const wheelPivot = new Group();
  wheelPivot.name = "wheel_pivot";
  wheelPivot.position.set(0, TRUNDLE_WHEEL_RADIUS_M, -0.45);
  root.add(wheelPivot);
  const wheels = make(
    "wheels",
    [
      cyl(TRUNDLE_WHEEL_RADIUS_M, 0.1, 14, CHAR, -0.5, 0, 0, true),
      cyl(TRUNDLE_WHEEL_RADIUS_M, 0.1, 14, CHAR, 0.5, 0, 0, true),
    ],
    body,
    wheelPivot,
  );
  return {
    root,
    chassis,
    drumPivot,
    wheelPivot,
    lamps,
    meshes: [chassis, lamps, drum, wheels],
    materials: [body, lensMat],
  };
}

export function disposeTrundle(parts: TrundleParts): void {
  for (const m of parts.meshes) m.geometry.dispose();
  for (const m of parts.materials) m.dispose();
}
