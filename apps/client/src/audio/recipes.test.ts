import { AUDIO_CUE_IDS, AUDIO_CUE_DEFS } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { allFinite, hashString, mulberry32, peakOf } from "./dsp";
import { CUE_RECIPES, variantOf } from "./recipes";
import { DAY_TIMING, PAD_SAMPLES, layerSamples, renderLayer, renderPad } from "./music-recipes";

const rms = (a: Float32Array, from: number, to: number): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += (a[i] ?? 0) ** 2;
  return Math.sqrt(s / Math.max(1, to - from));
};

describe("procedural recipes", () => {
  it("has a recipe with a source note for every cue id", () => {
    for (const id of AUDIO_CUE_IDS) {
      expect(CUE_RECIPES[id], id).toBeDefined();
      expect(CUE_RECIPES[id].note.length, id).toBeGreaterThan(10);
      expect(CUE_RECIPES[id].loop, id).toBe(AUDIO_CUE_DEFS[id].kind === "loop" || AUDIO_CUE_DEFS[id].kind === "bed");
    }
  });

  it("renders finite, audible, headroom-safe audio for every variant (music pads are tested separately)", () => {
    let totalBytes = 0;
    for (const id of AUDIO_CUE_IDS) {
      if (id.startsWith("music.") && !id.includes("stinger")) continue;
      const r = CUE_RECIPES[id];
      for (let v = 0; v < r.variants; v++) {
        const pcm = r.render(v, mulberry32(hashString(`${id}#${v}`)));
        expect(allFinite(pcm), `${id}#${v}`).toBe(true);
        const peak = peakOf(pcm);
        expect(peak, `${id}#${v} peak`).toBeGreaterThan(0.6);
        expect(peak, `${id}#${v} peak`).toBeLessThanOrEqual(0.7081); // -3 dBFS
        totalBytes += pcm.length * 4;
      }
    }
    // Decoded SFX residency budget: 32 MB (Tier B); everything rendered at once stays far below.
    expect(totalBytes).toBeLessThan(32 * 1024 * 1024);
  });

  it("is deterministic", () => {
    const a = CUE_RECIPES["assay.ka_ching"].render(0, mulberry32(hashString("assay.ka_ching#0")));
    const b = CUE_RECIPES["assay.ka_ching"].render(0, mulberry32(hashString("assay.ka_ching#0")));
    expect(Array.from(a.subarray(0, 64))).toEqual(Array.from(b.subarray(0, 64)));
  });

  it("loops carry energy at both ends (no fade hole at the seam)", () => {
    for (const id of AUDIO_CUE_IDS) {
      const r = CUE_RECIPES[id];
      if (!r.loop || id.startsWith("music.") || id === "robot.step" || id === "ambience.breathing") continue; // sparse clicks / breath with a silent seam by design
      const pcm = r.render(0, mulberry32(hashString(`${id}#0`)));
      const w = Math.floor(r.sampleRate * 0.01);
      const all = rms(pcm, 0, pcm.length);
      expect(rms(pcm, 0, w), `${id} head`).toBeGreaterThan(all * 0.2);
      expect(rms(pcm, pcm.length - w, pcm.length), `${id} tail`).toBeGreaterThan(all * 0.2);
    }
  });

  it("tonal loops are seamless: the sample after the end continues the wave", () => {
    for (const id of ["ambience.outpost_hum", "vehicle.drive_loop"] as const) {
      const pcm = CUE_RECIPES[id].render(0, mulberry32(1));
      const step = Math.abs((pcm[1] ?? 0) - (pcm[0] ?? 0));
      const seam = Math.abs((pcm[0] ?? 0) - (pcm[pcm.length - 1] ?? 0));
      expect(seam, id).toBeLessThan(Math.max(0.15, step * 6));
    }
  });

  it("music pad loops whole cycles and layers fit whole bars", () => {
    const pad = renderPad("day");
    expect(pad.length).toBe(PAD_SAMPLES);
    expect(allFinite(pad)).toBe(true);
    expect(Math.abs((pad[0] ?? 0) - (pad[pad.length - 1] ?? 0))).toBeLessThan(0.05);
    const pulse = renderLayer("day", "pulse");
    expect(pulse?.length).toBe(layerSamples(DAY_TIMING));
    expect(renderLayer("bridge", "pulse")).toBeNull();
  });

  it("picks render variants from cue parameters", () => {
    expect(variantOf("avatar.footstep", { surface: "deck" })).toBe(2);
    expect(variantOf("assay.ka_ching", { big: true })).toBe(1);
    expect(variantOf("ui.toggle", { on: false })).toBe(0);
    expect(variantOf("dot.chirp", { syllables: 4, contour: "fall" })).toBe(7);
    expect(variantOf("dot.chirp", { syllables: 99, contour: "rise" })).toBe(30);
  });
});
