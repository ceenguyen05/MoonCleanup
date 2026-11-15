// Crown Lamp light hooks (M1-W2-T02, for the W6 lamp gameplay): the helmet lamp as one range-culled, shadowed spot whose
// level is data. The gameplay / avatar owner creates one per local player, parents it to the helmet, and calls
// `setCrownLampLevel` on an upgrade and `updateCrownLamp` once per frame with the key's pre-exposure scale.
//
// Levels built here: L1 Clip Light and L2 Spot Ring (the MVP pair). Candela: art-direction 2.2. Range: rendering-pipeline 5.3.
// Cone: three's `SpotLight.angle` is the half-angle from the axis. Spot Ring keeps the cone S06 was calibrated with
// (VT-M1-10 pool luma: 30 degrees, penumbra 0.4); Clip Light is the wider, weaker cone of art-direction 2.2 (40 degrees).
// The two documents disagree on the cones (pipeline 5.3: 35 / 20 and 40 / 25 outer / inner): recorded in the task report.
//
// Cost rule: a lamp that is off, or whose level changes, never rebuilds a material: intensity, distance, angle and penumbra
// are light uniforms. `visible = false` while off removes its shadow pass.

import { Color, type SpotLight } from "three/webgpu";
import type { ShadowFilterId } from "../look-knobs";
import { LocalSpotLight, configureLampShadow } from "./local-lights";

const DEG = Math.PI / 180;

export type CrownLampLevelId = "clip-light" | "spot-ring";

export interface CrownLampLevel {
  readonly id: CrownLampLevelId;
  /** Luminous intensity on the axis (candela), before pre-exposure. */
  readonly candela: number;
  /** Range of the own lamp (m): the light is exactly zero beyond it. */
  readonly rangeM: number;
  /** Half-angle of the cone (degrees) and the soft fraction of it (three's `penumbra`). */
  readonly halfAngleDeg: number;
  readonly penumbra: number;
}

export const CROWN_LAMP_LEVELS: Readonly<Record<CrownLampLevelId, CrownLampLevel>> = Object.freeze({
  "clip-light": Object.freeze({ id: "clip-light", candela: 6_000, rangeM: 12, halfAngleDeg: 40, penumbra: 0.43 }),
  "spot-ring": Object.freeze({ id: "spot-ring", candela: 22_000, rangeM: 20, halfAngleDeg: 30, penumbra: 0.4 }),
});

/** Lamp white `#FFE7C8` (about 4500 K), linear. */
export const CROWN_LAMP_COLOUR: readonly [number, number, number] = [1.0, 0.906, 0.784];
/** Other players' unshadowed lamps: range clamp (rendering-pipeline 5.1), whatever their level. */
export const OTHER_LAMP_RANGE_M = 8;

export interface CrownLampOptions {
  /** Shadow map edge (px) of the preset (`shadows.ownLampShadowSizePx`); 0 = an unshadowed lamp (other players). */
  readonly shadowSizePx: number;
  /** PCF kernel of the preset (`defaultShadowFilter(settings)`). */
  readonly shadowFilter: ShadowFilterId;
}

/** Writes the level's range and cone to `lamp`. Uniform writes only: no shader rebuild. */
export function setCrownLampLevel(lamp: SpotLight, level: CrownLampLevel): void {
  const own = lamp.castShadow;
  lamp.distance = own ? level.rangeM : Math.min(level.rangeM, OTHER_LAMP_RANGE_M);
  lamp.angle = level.halfAngleDeg * DEG;
  lamp.penumbra = level.penumbra;
  lamp.userData["mcCrownLampCandela"] = level.candela;
  if (own) {
    lamp.shadow.camera.far = level.rangeM;
    lamp.shadow.camera.updateProjectionMatrix();
  }
}

/**
 * Per frame: pre-exposes the lamp (`scale` = the key's pre-exposure scale) and switches it. `fade` (0..1) is the 0.3 s
 * fade of the light budget (rendering-pipeline 5.4); an off lamp is invisible, so it costs neither shading nor a shadow pass.
 */
export function updateCrownLamp(lamp: SpotLight, scale: number, on: boolean, fade = 1): void {
  const candela = (lamp.userData["mcCrownLampCandela"] as number | undefined) ?? 0;
  const intensity = on ? candela * scale * Math.min(1, Math.max(0, fade)) : 0;
  lamp.intensity = intensity;
  lamp.visible = intensity > 0;
}

/**
 * A Crown Lamp at `level`: a range-culled spot (`local-lights.ts`), decay 2, shadowed when `shadowSizePx > 0` (casters of
 * `LAMP_CASTER_LAYER` only). Intensity is 0 until the first `updateCrownLamp`. The caller adds the lamp and `lamp.target`
 * to the scene graph (helmet crown; target ahead of the visor) and disposes it.
 */
export function createCrownLamp(level: CrownLampLevel, options: CrownLampOptions): SpotLight {
  const [r, g, b] = CROWN_LAMP_COLOUR;
  const lamp = new LocalSpotLight(new Color(r, g, b), 0, level.rangeM, level.halfAngleDeg * DEG, level.penumbra, 2);
  lamp.name = "mc:crown-lamp";
  lamp.castShadow = options.shadowSizePx > 0;
  if (lamp.castShadow) {
    configureLampShadow(lamp, options.shadowSizePx, options.shadowFilter);
    lamp.shadow.camera.near = 0.3;
    lamp.shadow.bias = -0.0002;
    lamp.shadow.normalBias = 0.02;
  }
  setCrownLampLevel(lamp, level);
  return lamp;
}
