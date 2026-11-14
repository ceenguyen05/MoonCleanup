// Ground of the look scenes S01 / S05 / S06 (M0 look-polish r2, item 7): the REAL regolith material (`visuals/materials`:
// mask + detail tile, 9 fetches, 2 textures) on the scene's cap mesh, the same path the `typical` worksite runs, so these
// scenes cost what the game costs (the T03b stand-in evaluated about 39 octaves of 3D noise per ground pixel: 3 to 4 fps on
// the UHD 620). The cleaned area is a mask stamped with Lane Broom passes: rows on a 1.5 m pitch that together fill a disk,
// with stepped lane ends and a real berm along every edge (the reference look: cleaned ground is made of lanes).
//
// `?ground=standin` keeps the old procedural stand-in (`ground-material.ts`) for A/B captures only.
//
// Tuning handles live in `material.userData` (a capture driver or `__mcLook.setBump` flips them at run time):
//   mcBump       detail-relief strength (1 default, 0 = flat)
//   mcGrazeFade  grazing-sun detail fade (1 default, 0 = off: shows the black bump terminators at a 4 / 1 degree sun)

import type { DataTexture, MeshStandardNodeMaterial, Node } from "three/webgpu";
import {
  createMaskBuffer,
  createMaskTextureFromBuffer,
  createRegolithMaterial,
  stampStroke,
  type MaskBuffer,
  type MaskWorldRect,
  type StrokeSpec,
} from "../materials";
import { mulberry32 } from "../sky/star-catalog";
import { createGroundMaterial } from "./ground-material";

/** Mask of a look scene: 2048^2 (16 MB + mips, as `typical`); texel 3.3 cm for S01's 68 m, 4.4 cm for S06's 90 m. */
export const LOOK_MASK_SIZE = 2048;
/** Dusty margin between the clean disk and the mask rectangle (the border texels must read as dust: mask contract). */
export const LOOK_MASK_MARGIN_M = 7;
/** Lane Broom: 1.6 m passes on a 1.5 m pitch (neighbours overlap by 10 cm and leave no ridge). */
export const LANE_WIDTH_M = 1.6;
export const LANE_PITCH_M = 1.5;
/** Lane ends vary by up to this much around the disk's chord (m), so the outline is stepped, not a circle. */
const LANE_END_JITTER_M = 1.5;

export interface LookGroundOptions {
  /** Everything clean (S05 shadow lab). */
  readonly allClean?: boolean;
  /** Centre (x, z) and radius of the cleaned disk. */
  readonly cleanCentre?: readonly [number, number];
  readonly cleanRadiusM?: number;
  /** More strokes stamped after the disk rows (work in progress next to the patch). Must stay inside the mask rectangle. */
  readonly extraStrokes?: readonly StrokeSpec[];
  /** Receiver-side far-occluder visibility (horizon map) published to the CSM node. */
  readonly horizonVisibility?: unknown;
  /** Large-scale tone / hue variation of the real material, 0..1 (0 on calibration scenes). Default 0. */
  readonly macroVariation?: number;
  /** `true`: the old procedural stand-in instead of the real material (A/B only). */
  readonly standIn?: boolean;
}

export interface LookGround {
  readonly kind: "regolith" | "standin";
  readonly material: MeshStandardNodeMaterial;
  /** Strength of the detail relief (1 default; 0 = smooth). */
  readonly bump: { value: number };
  /** Grazing-sun detail fade (1 on, 0 off). */
  readonly grazingFade: { value: number };
  /** Texture fetches per fragment and distinct sampled textures of the material (0 / 0 for the stand-in). */
  readonly fetchCount: number;
  readonly textureBindings: number;
  dispose(): void;
}

/** `true` when the URL asks for the old stand-in ground (`?ground=standin`). */
export function wantsStandInGround(params: URLSearchParams): boolean {
  return (params.get("ground") ?? "").toLowerCase() === "standin";
}

/** World rectangle of the mask for a clean disk: the disk plus the dusty margin, square. */
export function lookMaskRect(centre: readonly [number, number], radiusM: number): MaskWorldRect {
  const half = radiusM + LANE_END_JITTER_M + LOOK_MASK_MARGIN_M;
  return { originX: centre[0] - half, originZ: centre[1] - half, sizeX: half * 2, sizeZ: half * 2 };
}

/**
 * Lane Broom passes that fill a disk: one row per pitch along x, each as long as the disk's chord at that row with both ends
 * moved by a seeded -1.5..+1.5 m. Deterministic.
 */
export function lookCleanStrokes(centre: readonly [number, number], radiusM: number, seed = 5): StrokeSpec[] {
  const out: StrokeSpec[] = [];
  const rand = mulberry32(seed);
  const half = LANE_WIDTH_M / 2;
  for (let dz = -radiusM + half; dz <= radiusM - half + 1e-6; dz += LANE_PITCH_M) {
    const chord = Math.sqrt(Math.max(radiusM * radiusM - dz * dz, 0));
    // The stroke footprint adds half a brush width at each end: take it off so the lane ends on the chord.
    const left = chord - half + (rand() * 2 - 1) * LANE_END_JITTER_M;
    const right = chord - half + (rand() * 2 - 1) * LANE_END_JITTER_M;
    if (left + right < 2) continue;
    const z = centre[1] + dz;
    const ltr = out.length % 2 === 0;
    const xa = centre[0] - left;
    const xb = centre[0] + right;
    out.push({ x0: ltr ? xa : xb, z0: z, x1: ltr ? xb : xa, z1: z, widthM: LANE_WIDTH_M });
  }
  return out;
}

/** The stamped mask of a look ground (`size`^2 texels; tests use a small size). `null` for `allClean`. */
export function buildLookMask(options: LookGroundOptions, size = LOOK_MASK_SIZE): MaskBuffer | null {
  if (options.allClean === true) return null;
  const centre = options.cleanCentre ?? [0, 0];
  const radius = options.cleanRadiusM ?? 60;
  const buffer = createMaskBuffer(size, size, lookMaskRect(centre, radius));
  for (const stroke of lookCleanStrokes(centre, radius)) stampStroke(buffer, stroke);
  for (const stroke of options.extraStrokes ?? []) stampStroke(buffer, stroke);
  return buffer;
}

/** 4 x 4 texels of clean ground: the clamp makes the whole world clean (S05; a look-scene exception to the mask contract). */
function allCleanMask(): MaskBuffer {
  const buffer = createMaskBuffer(4, 4, { originX: -1, originZ: -1, sizeX: 2, sizeZ: 2 });
  buffer.grime.fill(0);
  return buffer;
}

export function createLookGround(options: LookGroundOptions = {}): LookGround {
  if (options.standIn === true) {
    const standIn = createGroundMaterial(options);
    return {
      kind: "standin",
      material: standIn.material,
      bump: standIn.bump,
      grazingFade: standIn.grazingFade,
      fetchCount: 0,
      textureBindings: 0,
      dispose: () => standIn.material.dispose(),
    };
  }
  const buffer = buildLookMask(options) ?? allCleanMask();
  const mask: DataTexture = createMaskTextureFromBuffer(buffer, { mipmaps: buffer.width > 4, anisotropy: 4 });
  mask.name = "mc:look-mask";
  const regolith = createRegolithMaterial({
    mask,
    maskRect: buffer.rect,
    maskSize: [buffer.width, buffer.height],
    macroVariation: options.macroVariation ?? 0,
    ...(options.horizonVisibility === undefined ? {} : { horizonVisibility: options.horizonVisibility as Node }),
  });
  regolith.material.name = "mc:look-regolith";
  regolith.material.userData["mcBump"] = regolith.uniforms.detailGain;
  regolith.material.userData["mcGrazeFade"] = regolith.uniforms.grazingFade;
  return {
    kind: "regolith",
    material: regolith.material,
    bump: regolith.uniforms.detailGain,
    grazingFade: regolith.uniforms.grazingFade,
    fetchCount: regolith.fetchCount,
    textureBindings: regolith.textureBindings,
    dispose: () => {
      regolith.dispose();
      mask.dispose();
    },
  };
}
