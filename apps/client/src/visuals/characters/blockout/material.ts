// The custodian material (M1-W3-T07): one TSL `MeshStandardNodeMaterial` shared by every custodian and its tool
// (one pipeline; per-object uniforms carry the player colour, lamp and limb angles). WebGPU and WebGL2 alike: no
// compute, no textures, no dynamic indexing in the fragment stage (slot lookups run per vertex, then vary).
//
// Inputs per vertex (glTF COLOR_0, see palette.ts): R = slot / 15, G = baked AO, B = rigid part / 15.
// Vertex stage: rigid limb rotation about the asset's pivot nodes (thigh, shin, upper arm, forearm), position and
// normal, so shadows (the shadow pass reuses `positionNode`) follow the pose. Fragment: slot base colour or player
// colour, roughness / metalness per slot, AO on indirect light only (`aoNode`), emissive player slots and lamp lens.
// This is the "final shader" of art-direction 13.4: the production suit swaps the per-slot constants for its
// base / ORM / player-mask textures and keeps the rest.

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

import {
  attribute,
  cos,
  float,
  Fn,
  mix,
  normalLocal,
  positionLocal,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  uniformArray,
  uv,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import { Color, MeshStandardNodeMaterial, Vector2, Vector3, Vector4, type Object3D, type Texture } from "three/webgpu";
import { GLYPH_INK, ID_SCALE, PLAYER_COLORS, SLOT, SLOTS, srgbHexToLinear } from "./palette";

/** Per-object state the material reads (`object.userData.custodian`); written by `BlockoutCustodian`. */
export interface CustodianShading {
  /** Linear RGB player colour. */
  readonly color: Color;
  /** Hip L, hip R, knee L, knee R (rad; motion.ts conventions). */
  readonly legs: Vector4;
  /** Shoulder L, shoulder R, elbow L, elbow R (rad). */
  readonly arms: Vector4;
  /** Crown Lamp lens emission 0..1. */
  lamp: number;
  /** Numeral glyph cell 0..15 (player slot P01..P16 shows numeral 1..16; production suit only). */
  glyph: number;
}

export function createShading(playerIndex = 0): CustodianShading {
  const [r, g, b] = srgbHexToLinear(PLAYER_COLORS[playerIndex % PLAYER_COLORS.length]!);
  return { color: new Color(r, g, b), legs: new Vector4(), arms: new Vector4(), lamp: 1, glyph: playerIndex & 15 };
}

/** Joint pivots in asset space (metres, Y up, facing +Z): read from the GLB `pivot_*` nodes. */
export interface CustodianPivots {
  readonly hipL: Vector3;
  readonly hipR: Vector3;
  readonly kneeL: Vector3;
  readonly kneeR: Vector3;
  readonly shoulderL: Vector3;
  readonly shoulderR: Vector3;
  readonly elbowL: Vector3;
  readonly elbowR: Vector3;
}

export interface CustodianMaterial {
  readonly material: MeshStandardNodeMaterial;
  /** Pivot uniforms (shared: one asset). Copy new values into them; no rebuild needed. */
  readonly pivots: CustodianPivots;
  dispose(): void;
}

const NO_SHADING = createShading(0);

function shadingOf(object: Object3D | null): CustodianShading {
  let o: Object3D | null = object;
  // The shading lives on the custodian root; LOD levels and the tool look it up through their parents.
  while (o !== null) {
    const s = (o.userData as { custodian?: CustodianShading }).custodian;
    if (s !== undefined) return s;
    o = o.parent;
  }
  return NO_SHADING;
}

/** Rotation about the asset's lateral (X) axis. */
const rotX = (p: TslNode, a: TslNode): TslNode => {
  const c = cos(a);
  const s = sin(a);
  return vec3(p.x, p.y.mul(c).sub(p.z.mul(s)), p.y.mul(s).add(p.z.mul(c)));
};

export interface CustodianMaterialOptions {
  /**
   * Numeral glyph atlas (production suit): 4 x 4 cells of numerals 1..16, signed-distance mask in R (0.5 = edge),
   * sampled with TEXCOORD_0 on the `glyph` slot. Null (blockout): no numeral, no UV read.
   */
  readonly glyphs?: Texture | null;
}

export function createCustodianMaterial(options: CustodianMaterialOptions = {}): CustodianMaterial {
  const glyphs = options.glyphs ?? null;
  // Per-slot constants: A = linear base RGB + roughness, B = metalness, player, emissive, lamp.
  const lin: [number, number, number] = [0, 0, 0];
  const slotA = SLOTS.map((s) => {
    srgbHexToLinear(s.base, lin);
    return new Vector4(lin[0], lin[1], lin[2], s.roughness);
  });
  const slotB = SLOTS.map((s) => new Vector4(s.metalness, s.player, s.emissive, s.lamp));
  const tableA = uniformArray(slotA, "vec4");
  const tableB = uniformArray(slotB, "vec4");

  const pivots: CustodianPivots = {
    hipL: new Vector3(0.105, 0.93, 0),
    hipR: new Vector3(-0.105, 0.93, 0),
    kneeL: new Vector3(0.118, 0.505, 0.015),
    kneeR: new Vector3(-0.118, 0.505, 0.015),
    shoulderL: new Vector3(0.222, 1.36, 0),
    shoulderR: new Vector3(-0.222, 1.36, 0),
    elbowL: new Vector3(0.252, 1.1, 0),
    elbowR: new Vector3(-0.252, 1.1, 0),
  };
  const u = {
    hipL: uniform(pivots.hipL),
    hipR: uniform(pivots.hipR),
    kneeL: uniform(pivots.kneeL),
    kneeR: uniform(pivots.kneeR),
    shoulderL: uniform(pivots.shoulderL),
    shoulderR: uniform(pivots.shoulderR),
    elbowL: uniform(pivots.elbowL),
    elbowR: uniform(pivots.elbowR),
  };
  const legs = uniform(new Vector4()).onObjectUpdate(({ object }: { object: Object3D | null }, self: any) =>
    self.value.copy(shadingOf(object).legs),
  );
  const arms = uniform(new Vector4()).onObjectUpdate(({ object }: { object: Object3D | null }, self: any) =>
    self.value.copy(shadingOf(object).arms),
  );
  const playerColor = uniform(new Color()).onObjectUpdate(({ object }: { object: Object3D | null }, self: any) =>
    self.value.copy(shadingOf(object).color),
  );
  const lamp = uniform(1).onObjectUpdate(({ object }: { object: Object3D | null }) => shadingOf(object).lamp);

  const data = attribute("color", "vec4");
  const slot = data.x.mul(ID_SCALE).round().toInt();
  const part = data.z.mul(ID_SCALE).round();

  const material = new MeshStandardNodeMaterial();
  material.name = "mc:custodian-blockout";

  material.positionNode = Fn(() => {
    const left = part.mod(2).greaterThan(0.5);
    const leg = part.lessThan(4.5);
    const child = part.greaterThan(2.5).and(part.lessThan(4.5)).or(part.greaterThan(6.5));
    const moving = part.greaterThan(0.5);
    // Forward swing is a negative rotation about +X (the limb hangs along -Y; +Z is forward). Knees bend backward.
    const rootAngle = select(
      moving,
      select(leg, select(left, legs.x, legs.y), select(left, arms.x, arms.y)).negate(),
      float(0),
    );
    const childAngle = select(
      child,
      select(leg, select(left, legs.z, legs.w), select(left, arms.z, arms.w).negate()),
      float(0),
    );
    const rootPivot = select(leg, select(left, u.hipL, u.hipR), select(left, u.shoulderL, u.shoulderR));
    const childPivot = select(leg, select(left, u.kneeL, u.kneeR), select(left, u.elbowL, u.elbowR));
    const q = rotX(positionLocal.sub(childPivot), childAngle).add(childPivot);
    const p = rotX(q.sub(rootPivot), rootAngle).add(rootPivot);
    normalLocal.assign(rotX(rotX(normalLocal, childAngle), rootAngle));
    return p;
  })();

  const a: TslNode = varying(tableA.element(slot), "v_mcSlotA");
  const b: TslNode = varying(tableB.element(slot), "v_mcSlotB");
  let base: TslNode = mix(a.xyz, playerColor, b.y);
  if (glyphs !== null) {
    const ink = srgbHexToLinear(GLYPH_INK);
    const cell = uniform(new Vector2()).onObjectUpdate(({ object }: { object: Object3D | null }, self: any) => {
      const g = shadingOf(object).glyph & 15;
      self.value.set(g & 3, g >> 2);
    });
    const isGlyph: TslNode = varying(select(slot.equal(SLOT["glyph"]!), float(1), float(0)), "v_mcGlyph");
    const atlasUv = cell.add(uv().clamp(0.02, 0.98)).mul(0.25);
    const sdf = texture(glyphs, atlasUv).r;
    // Edge at 0.5; the fwidth-free band holds from 1 m to the 50 m readability distance (atlas mips soften it).
    const m = smoothstep(0.4, 0.6, sdf).mul(isGlyph);
    base = mix(base, vec3(ink[0], ink[1], ink[2]), m);
  }
  material.colorNode = vec4(base, 1);
  material.roughnessNode = a.w;
  material.metalnessNode = b.x;
  material.aoNode = data.y;
  material.emissiveNode = base.mul(b.z).mul(mix(float(1), lamp, b.w));

  return {
    material,
    pivots,
    dispose: () => {
      material.dispose();
      glyphs?.dispose();
    },
  };
}
