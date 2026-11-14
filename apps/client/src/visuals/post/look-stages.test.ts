// Post chain (M0 look-polish r2): when the stars are drawn as a layer after the temporal resolve.

import { describe, expect, it } from "vitest";
import { Scene } from "three/webgpu";
import { QUALITY_PRESETS } from "@moon-cleanup/shared";
import { DEFAULT_LOOK_KNOBS, parseLookKnobs } from "../look-knobs";
import { CameraOnlyVelocity } from "./camera-velocity";
import { createLookStages, starsAsLayer } from "./look-stages";

describe("star layer choice", () => {
  const layers = { stars: new Scene() };

  it("TRAA presets draw the stars after the resolve, SMAA presets keep them in the scene pass", () => {
    expect(starsAsLayer(QUALITY_PRESETS.high, DEFAULT_LOOK_KNOBS, layers)).toBe(true);
    expect(starsAsLayer(QUALITY_PRESETS.ultra, DEFAULT_LOOK_KNOBS, layers)).toBe(true);
    expect(starsAsLayer(QUALITY_PRESETS.medium, DEFAULT_LOOK_KNOBS, layers)).toBe(false);
    expect(starsAsLayer(QUALITY_PRESETS.low, DEFAULT_LOOK_KNOBS, layers)).toBe(false);
  });

  it("needs the layer scene (a host without one keeps the old path)", () => {
    expect(starsAsLayer(QUALITY_PRESETS.high, DEFAULT_LOOK_KNOBS, null)).toBe(false);
    expect(starsAsLayer(QUALITY_PRESETS.high, DEFAULT_LOOK_KNOBS, {})).toBe(false);
    expect(starsAsLayer(QUALITY_PRESETS.high, DEFAULT_LOOK_KNOBS, { stars: null })).toBe(false);
  });

  it("follows the knobs: stars=scene, and the anti-aliasing actually run", () => {
    expect(starsAsLayer(QUALITY_PRESETS.high, parseLookKnobs("?stars=scene"), layers)).toBe(false);
    expect(starsAsLayer(QUALITY_PRESETS.high, parseLookKnobs("?traa=off"), layers)).toBe(false);
    expect(starsAsLayer(QUALITY_PRESETS.medium, parseLookKnobs("?aa=traa"), layers)).toBe(true);
    // A layer needs the prepass depth of a TRAA chain: asking for it on SMAA does nothing.
    expect(starsAsLayer(QUALITY_PRESETS.medium, parseLookKnobs("?stars=layer"), layers)).toBe(false);
  });

  it("createLookStages reports the choice before the graph is built", () => {
    const velocity = new CameraOnlyVelocity();
    expect(createLookStages(QUALITY_PRESETS.high, velocity, undefined, DEFAULT_LOOK_KNOBS, layers).starsLayer).toBe(
      true,
    );
    expect(createLookStages(QUALITY_PRESETS.high, velocity).starsLayer).toBe(false);
    expect(createLookStages(QUALITY_PRESETS.medium, velocity, undefined, DEFAULT_LOOK_KNOBS, layers).starsLayer).toBe(
      false,
    );
  });
});
