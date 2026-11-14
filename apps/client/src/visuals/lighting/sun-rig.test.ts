// M0 look-polish r2 item 2: which PCF kernel and radius each cascade of a preset runs without knobs.
import { QUALITY_PRESETS } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { TENT4_HOLE_FREE_RADIUS, defaultFarShadowFilter, defaultShadowFilter, pcfRadiusFor } from "./sun-rig";

describe("cascade kernel defaults", () => {
  it("SMAA presets: the 4-tap tent on cascade 0, the wider 9-tap kernel beyond; TRAA presets: the rotated disk", () => {
    for (const preset of [QUALITY_PRESETS.low, QUALITY_PRESETS.medium]) {
      expect(defaultShadowFilter(preset)).toBe("pcf3");
      expect(defaultFarShadowFilter(preset)).toBe("pcf5");
    }
    for (const preset of [QUALITY_PRESETS.high, QUALITY_PRESETS.ultra]) {
      expect(defaultShadowFilter(preset)).toBe("vogel5");
      expect(defaultFarShadowFilter(preset)).toBe("vogel5");
    }
  });

  it("tent4 never runs past the radius at which its four boxes still tile (no hole in the kernel)", () => {
    expect(TENT4_HOLE_FREE_RADIUS).toBe(1);
    for (const preset of Object.values(QUALITY_PRESETS)) {
      expect(pcfRadiusFor("tent4", preset)).toBeLessThanOrEqual(1);
    }
  });

  it("the Vogel disk keeps the preset width, capped at 2 without a temporal resolve and 3 with one", () => {
    expect(pcfRadiusFor("vogel5", QUALITY_PRESETS.medium)).toBe(
      Math.min(QUALITY_PRESETS.medium.shadows.pcfWidthTexels, 2),
    );
    expect(pcfRadiusFor("vogel5", QUALITY_PRESETS.high)).toBe(Math.min(QUALITY_PRESETS.high.shadows.pcfWidthTexels, 3));
  });
});
