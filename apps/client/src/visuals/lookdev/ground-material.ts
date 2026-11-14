// RETIRED from the look scenes (M0 look-polish r2): S01 / S05 / S06 run the real regolith material (`look-ground.ts`); this
// stand-in is built only for `?ground=standin` A/B captures (it costs about 39 octaves of 3D noise per ground pixel).
//
// Look-dev regolith (M0-W3-T03 stand-in, NOT the T04 regolith/dust material; polished in M0-W3-T03b): a TSL node material
// with the grime / clean albedo split of art-direction 3.2 (grime 0.085 warm umber, clean 0.34 pale warm-to-lavender grey), a
// clean disk with Lane-Broom stripes and a crisp lit berm at its edge, macro tone patches, scattered small craters and pebbles
// (analytic cell bumps, no extra textures) and a fractal grain normal that fades with distance. Enough to judge light,
// shadow, sky and post on something that reads like the game. T04's mask-driven material replaces it; targets stay the same.
//
// Luminance bookkeeping (VT-M0-06/08): every colour pair below keeps the Rec.709 luminance of the art-direction albedo
// (grime 0.085, clean 0.34) so hue variation never moves the luma targets; macro/fine multipliers average 1.

import {
  Fn,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  normalWorldGeometry,
  positionWorld,
  sin,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { MeshStandardNodeMaterial, Vector2, type Node } from "three/webgpu";
import { SHADOW_FLAT_RECEIVER_KEY } from "../lighting/cascade-shadow-node";
import { keyDirectionUniform } from "../lighting/key-direction";
import { HORIZON_VISIBILITY_KEY } from "../lighting/sun-rig";
import { GRAZING_DETAIL_MIN, GRAZING_DETAIL_SIN } from "../materials/regolith-constants";

/** Mean linear albedo of the two states (art-direction 3.2; luminance 0.085 and 0.34). */
export const GRIME_ALBEDO = [0.098, 0.083, 0.068] as const;
export const CLEAN_ALBEDO = [0.33, 0.34, 0.352] as const;
/** Hue variants (same luminance as the means): grime warm umber / dark slate, clean warm sand-grey / cool lavender-grey. */
const GRIME_WARM = [0.104, 0.083, 0.061] as const;
const GRIME_COOL = [0.082, 0.082, 0.093] as const;
const CLEAN_WARM = [0.364, 0.338, 0.303] as const;
const CLEAN_COOL = [0.312, 0.338, 0.376] as const;

export interface GroundMaterialOptions {
  /** 1 = everything clean, 0 = everything grime, between: global blend. Ignored when `clean` is a disk (default). */
  readonly allClean?: boolean;
  /** Centre (local x, z) and radius of the clean disk of the approach scene. */
  readonly cleanCentre?: readonly [number, number];
  readonly cleanRadiusM?: number;
  /** Optional receiver-side far-occluder visibility (horizon map) published to the CSM node. */
  readonly horizonVisibility?: unknown;
}

export interface GroundMaterial {
  readonly material: MeshStandardNodeMaterial;
  /** Strength of the detail normal (1 default; 0 = smooth). */
  readonly bump: { value: number };
  /** Grazing-sun detail fade (1 on, 0 off), the same rule as the real material (regolith-constants `GRAZING_DETAIL_*`). */
  readonly grazingFade: { value: number };
}

type N2 = Node<"vec2">;

/** Cheap 2D hash in [0, 1). */
const hash2 = (p: N2, salt: number) => fract(sin(dot(p.add(salt), vec2(127.1, 311.7))).mul(43758.5453));

/**
 * One bump per grid cell, analytic: returns (height m, d/dx, d/dz). The bump is a crater (bowl + rim) or a pebble (dome); its
 * centre stays in the middle of the cell so it never reaches a neighbour (one evaluation per pixel, no loop).
 */
function cellBumps(q0: N2, cellM: number, presence: number, depthFrac: number, crater: boolean, angle: number) {
  // Each layer lives on its own rotated, offset grid so the layers do not line up into an obvious lattice.
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const q = vec2(q0.x.mul(cs).sub(q0.y.mul(sn)), q0.x.mul(sn).add(q0.y.mul(cs))).add(vec2(angle * 37.1, angle * 11.3));
  const g = q.div(cellM);
  const id = floor(g);
  const f = fract(g);
  const centre = vec2(hash2(id, 1.7), hash2(id, 5.3)).mul(0.3).add(0.35);
  const radius = hash2(id, 9.1).pow(1.8).mul(0.17).add(0.09);
  const present = step(float(1).sub(presence), hash2(id, 13.9));
  const delta = f.sub(centre);
  const dist = length(delta).max(1e-4);
  const d = dist.div(radius);
  const scaleM = radius.mul(cellM);
  const depth = scaleM.mul(depthFrac).mul(present);
  const dir = delta.div(dist);
  if (crater) {
    const inside = step(d, 1);
    const bowl = depth
      .mul(float(1).sub(d.mul(d)))
      .mul(-1)
      .mul(inside);
    const rimX = d.sub(1.08).div(0.22);
    const rim = depth.mul(0.3).mul(exp(rimX.mul(rimX).mul(-1)));
    const dBowl = depth.mul(d).mul(2).mul(inside);
    const dRim = rim.mul(rimX).mul(-2).div(0.22);
    const slope = dBowl.add(dRim).div(scaleM);
    return vec3(
      bowl.add(rim),
      dir.x.mul(slope).mul(cs).add(dir.y.mul(slope).mul(sn)),
      dir.y.mul(slope).mul(cs).sub(dir.x.mul(slope).mul(sn)),
    );
  }
  const inside = step(d, 1);
  const k = float(1).sub(d.mul(d));
  const h = depth.mul(k).mul(k).mul(inside);
  const slope = depth.mul(-4).mul(d).mul(k).mul(inside).div(scaleM);
  return vec3(
    h,
    dir.x.mul(slope).mul(cs).add(dir.y.mul(slope).mul(sn)),
    dir.y.mul(slope).mul(cs).sub(dir.x.mul(slope).mul(sn)),
  );
}

export function createGroundMaterial(options: GroundMaterialOptions = {}): GroundMaterial {
  const bump = uniform(1);
  const grazingFade = uniform(1);
  const centre = uniform(new Vector2(options.cleanCentre?.[0] ?? 0, options.cleanCentre?.[1] ?? 0));
  const radius = uniform(options.cleanRadiusM ?? 60);
  const everythingClean = options.allClean === true ? 1 : 0;
  const clean = uniform(everythingClean);

  // The clean disk: 1 inside, 0 outside, a wobbly rim (the berm sits here). Crisp: the edge is 0.2 m wide.
  const diskField = Fn(([q]: [N2]) => {
    const wobble = mx_fractal_noise_float(vec3(q.x.mul(0.07), 0.5, q.y.mul(0.07)), 3, 2.0, 0.5, 1.0).mul(7.0);
    const d = length(q.sub(centre)).add(wobble);
    return float(1).sub(smoothstep(radius.sub(0.1), radius.add(0.1), d));
  });

  // Clean amount at a ground point (0 grime .. 1 clean): the disk with soft Lane-Broom tonal stripes inside.
  const cleanField = Fn(([q]: [N2]) => {
    const disk = diskField(q);
    // 1.8 m lanes at a slight angle; alternate lanes keep a little more dust (soft tonal band, not a line).
    const u = q.x.mul(0.93).add(q.y.mul(0.37)).div(1.8);
    const band = smoothstep(0.3, 0.7, fract(u).sub(0.5).abs().mul(2));
    const striped = mix(float(0.84), float(1), band);
    return clean.max(disk.mul(striped));
  });

  // Surface height (metres) for the finite-difference normal: fractal grain, a pebble layer and the berm ring.
  const heightField = Fn(([q]: [N2]) => {
    const grain = mx_fractal_noise_float(vec3(q.x.mul(1.3), 0.21, q.y.mul(1.3)), 4, 2.1, 0.5, 1.0).mul(0.02);
    const d = diskField(q);
    const ring = d.mul(float(1).sub(d)).mul(4);
    return grain.add(ring.mul(ring).mul(0.075));
  });

  const material = new MeshStandardNodeMaterial();
  material.name = "mc:lookdev-regolith";
  material.metalness = 0;
  material.roughnessNode = Fn(() => {
    const c = cleanField(vec2(positionWorld.x, positionWorld.z));
    return mix(float(0.97), float(0.84), c);
  })();

  material.colorNode = Fn(() => {
    const q = vec2(positionWorld.x, positionWorld.z);
    const c = cleanField(q);
    // Tone patches: large (maria-like), medium and fine; hue drifts warm <-> cool at constant luminance.
    const macro = mx_fractal_noise_float(vec3(q.x.mul(0.035), 1.7, q.y.mul(0.035)), 3, 2.0, 0.5, 1.0);
    const patch = mx_fractal_noise_float(vec3(q.x.mul(0.16), 6.2, q.y.mul(0.16)), 3, 2.0, 0.5, 1.0);
    const fine = mx_fractal_noise_float(vec3(q.x.mul(2.4), 3.3, q.y.mul(2.4)), 3, 2.0, 0.55, 1.0);
    const hue = smoothstep(-0.35, 0.35, macro.mul(0.8).add(patch.mul(0.6)));
    const variation = float(1).add(macro.mul(0.12)).add(patch.mul(0.09)).add(fine.mul(0.08));
    const grime = mix(vec3(...GRIME_WARM), vec3(...GRIME_COOL), hue);
    const sand = mix(vec3(...CLEAN_WARM), vec3(...CLEAN_COOL), hue);
    let albedo = mix(grime, sand, c);

    // Craters and pebbles tint the albedo too: bright rims, darker floors, pebbles a little lighter on their crowns.
    const big = cellBumps(q, 6, 0.5, 0.16, true, 0.4);
    const small = cellBumps(q, 1.7, 0.38, 0.14, true, 1.1);
    const pebble = cellBumps(q, 0.5, 0.35, 0.35, false, 2.0);
    const lift = big.x.mul(1.4).add(small.x.mul(1.1)).add(pebble.x.mul(2.2));
    albedo = albedo.mul(float(1).add(lift.clamp(-0.25, 0.3)));

    // Berm lip: the dust pile at the clean edge is a touch lighter on its crown.
    const d = diskField(q);
    const ring = d.mul(float(1).sub(d)).mul(4);
    albedo = albedo.mul(float(1).add(ring.mul(ring).mul(0.07)));
    return vec4(albedo.mul(variation), 1);
  })();

  material.normalNode = Fn(() => {
    const q = vec2(positionWorld.x, positionWorld.z);
    const dist = length(positionWorld.sub(cameraPosition));
    const fine = float(1).sub(smoothstep(18, 70, dist));
    const mid = float(1).sub(smoothstep(40, 130, dist));
    const far = float(1).sub(smoothstep(80, 260, dist));
    const e = float(0.025);
    const h0 = heightField(q);
    const hx = heightField(q.add(vec2(e, 0)));
    const hz = heightField(q.add(vec2(0, e)));
    const grain = vec3(hx.sub(h0).div(e), 0, hz.sub(h0).div(e)).mul(fine);

    const big = cellBumps(q, 6, 0.5, 0.16, true, 0.4);
    const small = cellBumps(q, 1.7, 0.38, 0.14, true, 1.1);
    const pebble = cellBumps(q, 0.5, 0.35, 0.35, false, 2.0);
    const slopes = vec3(
      big.y.mul(far).add(small.y.mul(mid)).add(pebble.y.mul(fine)),
      0,
      big.z.mul(far).add(small.z.mul(mid)).add(pebble.z.mul(fine)),
    );
    // Grazing-sun fade (M0 look-polish r2 item 3): under a sun lower than the bump slopes every bump facing away has
    // N.L <= 0 and shows a hard black terminator; scale the slopes with the local sun elevation below 20 degrees.
    const sunOnGround = max(dot(normalWorldGeometry, keyDirectionUniform), 0);
    const gain = mix(float(1), clamp(sunOnGround.div(GRAZING_DETAIL_SIN), GRAZING_DETAIL_MIN, 1), grazingFade);
    const n = normalWorldGeometry.sub(grain.add(slopes).mul(bump.mul(gain))).normalize();
    return cameraViewMatrix.mul(vec4(n, 0)).xyz.normalize();
  })();

  material.userData[SHADOW_FLAT_RECEIVER_KEY] = true;
  material.userData["mcBump"] = bump;
  material.userData["mcGrazeFade"] = grazingFade;
  if (options.horizonVisibility !== undefined) {
    material.userData[HORIZON_VISIBILITY_KEY] = options.horizonVisibility;
  }
  return { material, bump, grazingFade };
}
