// Post chain (M0 look-polish r2): when the stars are drawn as a layer after the temporal resolve.

import { describe, expect, it, vi } from "vitest";
import { vec4 } from "three/tsl";
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

  it("Low (FXAA by default) keeps the stars in the scene pass, like every spatial-AA chain", () => {
    expect(starsAsLayer(QUALITY_PRESETS.low, parseLookKnobs("?stars=layer"), layers)).toBe(false);
    expect(starsAsLayer(QUALITY_PRESETS.low, parseLookKnobs("?aa=traa"), layers)).toBe(true);
  });
});

describe("display stage anti-aliasing", () => {
  /** Builds the display stage of the chain (no GPU: the nodes are only constructed) and returns the pass names it added. */
  function displayPasses(preset: keyof typeof QUALITY_PRESETS, search = ""): string[] {
    const handles = createLookStages(
      QUALITY_PRESETS[preset],
      new CameraOnlyVelocity(),
      undefined,
      parseLookKnobs(search),
    );
    const out = handles.stages.display?.(vec4(0, 0, 0, 1) as never, {} as never);
    expect(out).toBeDefined();
    const passes = handles.passes.slice();
    handles.stages.dispose?.();
    return passes;
  }

  it("Low runs one FXAA pass by default and never SMAA", () => {
    expect(displayPasses("low")).toEqual(["fxaa"]);
  });

  it("Medium keeps SMAA; ?aa=smaa restores it on Low", () => {
    // three's SMAA node decodes its two lookup textures through `new Image()`, which the node test environment lacks.
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        onload: (() => void) | null = null;
      },
    );
    try {
      expect(displayPasses("medium")).toEqual(["smaa"]);
      expect(displayPasses("low", "?aa=smaa")).toEqual(["smaa"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("High / Ultra add no spatial pass (TRAA resolves in the HDR stage)", () => {
    expect(displayPasses("high")).toEqual([]);
    expect(displayPasses("ultra")).toEqual([]);
  });

  it("?aa= still overrides the Low default", () => {
    expect(displayPasses("low", "?aa=none")).toEqual([]);
    expect(displayPasses("low", "?aa=traa")).toEqual([]);
    expect(displayPasses("medium", "?aa=fxaa")).toEqual(["fxaa"]);
    expect(displayPasses("high", "?aa=fxaa")).toEqual(["fxaa"]);
  });
});
