// M0 look-polish r2 item 2: which PCF kernel and radius each cascade of a preset runs without knobs.
import { QUALITY_PRESETS } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { Scene } from "three/webgpu";
import { DEFAULT_LOOK_KNOBS, applyLookKnobs, parseLookKnobs } from "../look-knobs";
import {
  CASCADE_DEBUG_TINTS,
  SunRig,
  TENT4_HOLE_FREE_RADIUS,
  defaultFarShadowFilter,
  defaultShadowFilter,
  pcfRadiusFor,
} from "./sun-rig";

describe("?debug=cascades view", () => {
  it("is off by default and hands the cascade far ends to the shadow node when asked for", () => {
    const rig = new SunRig(new Scene());
    rig.applyQuality(QUALITY_PRESETS.medium, DEFAULT_LOOK_KNOBS);
    expect(rig.shadowNode?.debugEndsM).toBeNull();

    for (const preset of Object.values(QUALITY_PRESETS)) {
      rig.applyQuality(preset, parseLookKnobs("?debug=cascades"));
      const ends = rig.shadowNode?.debugEndsM ?? [];
      expect(ends).toHaveLength(preset.shadows.cascades);
      expect(ends).toEqual(rig.cascadeInfo.map((info) => info.endM));
      expect(ends[ends.length - 1]).toBe(preset.shadows.maxFarM);
      for (let i = 1; i < ends.length; i++) expect(ends[i]).toBeGreaterThan(ends[i - 1] ?? 0);
    }
    rig.dispose();
  });

  it("follows the cascade count knob and has a tint for each of the 4 possible cascades", () => {
    const knobs = parseLookKnobs("?debug=cascades&cascades=2");
    const rig = new SunRig(new Scene());
    rig.applyQuality(applyLookKnobs(QUALITY_PRESETS.ultra, knobs), knobs);
    expect(rig.shadowNode?.debugEndsM).toHaveLength(2);
    expect(CASCADE_DEBUG_TINTS).toHaveLength(4);
    // No sun shadows: no cascade node, so nothing to tint.
    const off = parseLookKnobs("?debug=cascades&cascades=0");
    rig.applyQuality(applyLookKnobs(QUALITY_PRESETS.ultra, off), off);
    expect(rig.shadowNode).toBeNull();
    rig.dispose();
  });
});

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

describe("shadowMapSizePx (`__mcLook.info().shadowMapSize`, VT-M0-03)", () => {
  it("is the cascade map edge of the preset, before the cascades are built too", () => {
    const rig = new SunRig(new Scene());
    expect(rig.shadowMapSizePx).toBe(0);
    for (const preset of Object.values(QUALITY_PRESETS)) {
      rig.applyQuality(preset, DEFAULT_LOOK_KNOBS);
      expect(rig.shadowMapSizePx).toBe(preset.shadows.cascadeSizePx);
    }
    // Owner decision 2026-11-14: Low shadow maps stay as they are.
    rig.applyQuality(QUALITY_PRESETS.low, DEFAULT_LOOK_KNOBS);
    expect(rig.shadowMapSizePx).toBe(1024);
    rig.dispose();
  });

  it("is 0 with the sun shadows switched off", () => {
    const off = parseLookKnobs("?cascades=0");
    const rig = new SunRig(new Scene());
    rig.applyQuality(applyLookKnobs(QUALITY_PRESETS.medium, off), off);
    expect(rig.shadowMapSizePx).toBe(0);
    rig.dispose();
  });
});
