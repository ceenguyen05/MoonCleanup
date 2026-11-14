import { QUALITY_PRESETS } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import {
  applyLookKnobs,
  DEFAULT_LOOK_KNOBS,
  describeLookKnobs,
  effectiveAa,
  effectiveGtao,
  parseLookKnobs,
  sunShadowsEnabled,
} from "./look-knobs";

describe("parseLookKnobs", () => {
  it("returns the shipped look for a URL without knobs", () => {
    expect(parseLookKnobs("")).toEqual(DEFAULT_LOOK_KNOBS);
    expect(parseLookKnobs("?scene=s01&preset=low&view=a")).toEqual(DEFAULT_LOOK_KNOBS);
    expect(describeLookKnobs(parseLookKnobs("?scene=bench"))).toBe("default");
  });

  it("parses every knob", () => {
    const knobs = parseLookKnobs(
      "?aa=fxaa&gtao=on&shadowres=512&cascades=1&shadowfilter=hard&pcf=2.5&bloom=half&grade=neutral&sky=0.5" +
        "&skyoff=earth,halo&skydome=procedural&aainput=half-float",
    );
    expect(knobs).toMatchObject({
      aa: "fxaa",
      aaInput: "half-float",
      gtao: true,
      shadowRes: 512,
      cascades: 1,
      shadowFilter: "hard",
      pcfRadius: 2.5,
      bloom: "half",
      grade: "neutral",
      skyLevel: 0.5,
      skyDome: "procedural",
    });
    expect(knobs.sky).toEqual({ dome: true, stars: true, earth: false, halo: false, sun: true });
    expect(describeLookKnobs(knobs)).toBe(
      "aa=fxaa aainput=half-float gtao=on shadowres=512 cascades=1 shadowfilter=hard pcf=2.5 bloom=half grade=neutral " +
        "sky=0.5 skyoff=earth,halo skydome=procedural",
    );
  });

  it("maps traa=on|off to the AA mode and lets aa= win", () => {
    expect(parseLookKnobs("?traa=on").aa).toBe("traa");
    expect(parseLookKnobs("?traa=off").aa).toBe("smaa");
    expect(parseLookKnobs("?traa=on&aa=none").aa).toBe("none");
  });

  it("ignores malformed values and clamps numbers", () => {
    const knobs = parseLookKnobs("?aa=msaa&shadowres=1000&cascades=9&pcf=-3&bloom=yes&grade=warm&sky=abc&gtao=maybe");
    expect(knobs.aa).toBeNull();
    expect(knobs.shadowRes).toBeNull();
    expect(knobs.cascades).toBe(4);
    expect(knobs.pcfRadius).toBe(0);
    expect(knobs.bloom).toBeNull();
    expect(knobs.grade).toBe("look");
    expect(knobs.skyLevel).toBe(1);
    expect(knobs.gtao).toBeNull();
  });

  it("sky=off hides every sky part; sky=0 only blacks out the backdrop", () => {
    expect(Object.values(parseLookKnobs("?sky=off").sky).every((on) => !on)).toBe(true);
    const black = parseLookKnobs("?sky=0");
    expect(black.skyLevel).toBe(0);
    expect(Object.values(black.sky).every((on) => on)).toBe(true);
  });
});

describe("applyLookKnobs", () => {
  it("returns the same settings object when no slot changes", () => {
    const medium = QUALITY_PRESETS.medium;
    expect(applyLookKnobs(medium, DEFAULT_LOOK_KNOBS)).toBe(medium);
    // Knobs without a slot in the settings leave them untouched too.
    expect(applyLookKnobs(medium, parseLookKnobs("?aa=none&bloom=off&cascades=0&grade=off&gtao=on"))).toBe(medium);
  });

  it("overrides cascade count and size, AA and bloom resolution without touching the preset", () => {
    const medium = QUALITY_PRESETS.medium;
    const out = applyLookKnobs(medium, parseLookKnobs("?cascades=2&shadowres=2048&traa=on&bloom=half"));
    expect(out).not.toBe(medium);
    expect(out.shadows.cascades).toBe(2);
    expect(out.shadows.cascadeSizePx).toBe(2048);
    expect(out.post.aa).toBe("traa");
    expect(out.post.bloom.resolution).toBe("half");
    expect(out.shadows.maxFarM).toBe(medium.shadows.maxFarM);
    expect(QUALITY_PRESETS.medium.shadows.cascades).toBe(3);
    expect(QUALITY_PRESETS.medium.post.aa).toBe("smaa");
  });
});

describe("derived switches", () => {
  it("GTAO follows TRAA unless forced", () => {
    const { medium, high } = QUALITY_PRESETS;
    expect(effectiveGtao(medium, DEFAULT_LOOK_KNOBS)).toBe(false);
    expect(effectiveGtao(high, DEFAULT_LOOK_KNOBS)).toBe(true);
    expect(effectiveGtao(high, parseLookKnobs("?gtao=off"))).toBe(false);
    expect(effectiveGtao(medium, parseLookKnobs("?gtao=on"))).toBe(true);
    expect(effectiveGtao(high, parseLookKnobs("?traa=off"))).toBe(false);
    expect(effectiveAa(high, parseLookKnobs("?traa=off"))).toBe("smaa");
    expect(effectiveAa(medium, parseLookKnobs("?aa=none"))).toBe("none");
  });

  it("default AA: FXAA on Low, SMAA on Medium, TRAA on High / Ultra; ?aa= and ?traa= override", () => {
    const { low, medium, high, ultra } = QUALITY_PRESETS;
    expect(effectiveAa(low, DEFAULT_LOOK_KNOBS)).toBe("fxaa");
    expect(effectiveAa(medium, DEFAULT_LOOK_KNOBS)).toBe("smaa");
    expect(effectiveAa(high, DEFAULT_LOOK_KNOBS)).toBe("traa");
    expect(effectiveAa(ultra, DEFAULT_LOOK_KNOBS)).toBe("traa");
    expect(effectiveAa(low, parseLookKnobs("?aa=smaa"))).toBe("smaa");
    expect(effectiveAa(low, parseLookKnobs("?aa=traa"))).toBe("traa");
    expect(effectiveAa(low, parseLookKnobs("?aa=none"))).toBe("none");
    expect(effectiveAa(low, parseLookKnobs("?traa=off"))).toBe("smaa");
    expect(effectiveAa(medium, parseLookKnobs("?aa=fxaa"))).toBe("fxaa");
    // The preset table itself is unchanged and applyLookKnobs keeps the Low preset id (FXAA is derived, not stored).
    expect(low.post.aa).toBe("smaa");
    expect(effectiveAa(applyLookKnobs(low, parseLookKnobs("?cascades=2")), DEFAULT_LOOK_KNOBS)).toBe("fxaa");
  });

  it("cascades=0 switches the sun shadows off", () => {
    expect(sunShadowsEnabled(DEFAULT_LOOK_KNOBS)).toBe(true);
    expect(parseLookKnobs("?debug=cascades").debugCascades).toBe(true);
    expect(parseLookKnobs("?debug=other").debugCascades).toBe(false);
    expect(parseLookKnobs("?shadowkernel=square").shadowKernelSquare).toBe(true);
    expect(parseLookKnobs("?shadowkernel=other").shadowKernelSquare).toBe(false);
    expect(describeLookKnobs(parseLookKnobs("?shadowkernel=square"))).toContain("shadowkernel=square");
    expect(sunShadowsEnabled(parseLookKnobs("?cascades=0"))).toBe(false);
    expect(sunShadowsEnabled(parseLookKnobs("?cascades=1"))).toBe(true);
  });
});
