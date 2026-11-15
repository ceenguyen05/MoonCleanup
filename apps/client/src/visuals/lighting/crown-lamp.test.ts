import { describe, expect, it } from "vitest";
import {
  createCrownLamp,
  CROWN_LAMP_LEVELS,
  OTHER_LAMP_RANGE_M,
  setCrownLampLevel,
  updateCrownLamp,
} from "./crown-lamp";
import { preExposureScale, EV100 } from "./key-light";
import { isRangeCulled, LAMP_CASTER_LAYER } from "./local-lights";

const DEG = Math.PI / 180;

describe("Crown Lamp hooks (L1 Clip Light, L2 Spot Ring)", () => {
  it("levels carry the authored candela and range; Spot Ring is the brighter, tighter, longer lamp", () => {
    const clip = CROWN_LAMP_LEVELS["clip-light"];
    const ring = CROWN_LAMP_LEVELS["spot-ring"];
    expect(clip).toMatchObject({ candela: 6_000, rangeM: 12 });
    expect(ring).toMatchObject({ candela: 22_000, rangeM: 20, halfAngleDeg: 30, penumbra: 0.4 });
    expect(ring.candela).toBeGreaterThan(clip.candela);
    expect(ring.halfAngleDeg).toBeLessThan(clip.halfAngleDeg);
  });

  it("own lamp: range-culled, shadowed from the lamp-caster layer, dark until updated", () => {
    const lamp = createCrownLamp(CROWN_LAMP_LEVELS["clip-light"], { shadowSizePx: 1024, shadowFilter: "pcf3" });
    expect(isRangeCulled(lamp)).toBe(true);
    expect(lamp.castShadow).toBe(true);
    expect(lamp.shadow.mapSize.width).toBe(1024);
    expect(lamp.shadow.camera.layers.mask).toBe(1 << LAMP_CASTER_LAYER);
    expect(lamp.intensity).toBe(0);
    expect(lamp.distance).toBe(12);
    expect(lamp.angle).toBeCloseTo(40 * DEG, 9);
    expect(lamp.decay).toBe(2);
    lamp.dispose();
  });

  it("update pre-exposes the candela, fades, and hides an off lamp", () => {
    const lamp = createCrownLamp(CROWN_LAMP_LEVELS["spot-ring"], { shadowSizePx: 512, shadowFilter: "pcf3" });
    const scale = preExposureScale(EV100.nightNear);
    updateCrownLamp(lamp, scale, true);
    expect(lamp.intensity).toBeCloseTo(22_000 * scale, 12);
    expect(lamp.visible).toBe(true);
    updateCrownLamp(lamp, scale, true, 0.5);
    expect(lamp.intensity).toBeCloseTo(11_000 * scale, 12);
    updateCrownLamp(lamp, scale, false);
    expect(lamp.intensity).toBe(0);
    expect(lamp.visible).toBe(false);
    lamp.dispose();
  });

  it("a level change writes light properties only; an unshadowed lamp is clamped to 8 m", () => {
    const own = createCrownLamp(CROWN_LAMP_LEVELS["clip-light"], { shadowSizePx: 512, shadowFilter: "pcf3" });
    setCrownLampLevel(own, CROWN_LAMP_LEVELS["spot-ring"]);
    expect(own.distance).toBe(20);
    expect(own.shadow.camera.far).toBe(20);
    expect(own.angle).toBeCloseTo(30 * DEG, 9);
    const other = createCrownLamp(CROWN_LAMP_LEVELS["spot-ring"], { shadowSizePx: 0, shadowFilter: "pcf3" });
    expect(other.castShadow).toBe(false);
    expect(other.distance).toBe(OTHER_LAMP_RANGE_M);
    own.dispose();
    other.dispose();
  });
});
