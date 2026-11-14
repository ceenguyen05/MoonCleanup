// Procedural cue recipes: one entry per cue id of shared/audio/cues.ts. Every sound is synthesised here from sine
// partials, filtered noise and envelopes (no recordings, no downloads, no third-party material), so the ledger entry is
// "original, procedurally synthesised". `note` documents each cue's source for docs/design/audio-direction.md §8.
// Recipes are pure (Float32Array out), deterministic and render lazily on first use (see buffer-store.ts).

import { AUDIO_CUE_IDS, type AudioCueId, type DotContour } from "@moon-cleanup/shared";
import {
  MUSIC_RATE,
  SFX_RATE,
  addGrain,
  addNoise,
  addTone,
  allocPcm,
  clamp,
  fadeEdges,
  hashString,
  loopCrossfade,
  loopFreq,
  mtof,
  mulberry32,
  normalize,
  type Rng,
} from "./dsp";
import { renderPad } from "./music-recipes";

export interface CueRecipe {
  /** How the sound is made, for the audio-direction sourcing table. */
  readonly note: string;
  /** Number of render variants (surface, contour, on/off...). */
  readonly variants: number;
  readonly loop: boolean;
  /** Linear gain applied on playback on top of the -3 dBFS normalised buffer (loudness class). */
  readonly level: number;
  readonly sampleRate: number;
  render(variant: number, rng: Rng): Float32Array;
}

const PEAK = 0.708; // -3 dBFS (audio-direction §5.2)

function finish(out: Float32Array, sr: number): Float32Array {
  fadeEdges(out, sr);
  normalize(out, PEAK);
  return out;
}

function finishLoop(out: Float32Array, sr: number, xfS: number): Float32Array {
  const looped = loopCrossfade(out, Math.round(xfS * sr));
  normalize(looped, PEAK);
  return looped;
}

const SR = SFX_RATE;

interface Spec {
  readonly note: string;
  readonly level: number;
  readonly variants?: number;
  readonly loop?: boolean;
  readonly render: (variant: number, rng: Rng) => Float32Array;
}

function one(spec: Spec): CueRecipe {
  return {
    note: spec.note,
    variants: spec.variants ?? 1,
    loop: spec.loop ?? false,
    level: spec.level,
    sampleRate: SR,
    render: spec.render,
  };
}

// ---- Shared building blocks -----------------------------------------------------------------------------------------

/** Bell-like chime note: a few harmonics plus a slightly detuned shimmer. */
function chime(out: Float32Array, t: number, freq: number, dur: number, gain: number): void {
  addTone(out, SR, t, dur, freq, { gain, decay: dur * 0.35, harmonics: [1, 0.35, 0.12], attack: 0.002 });
  addTone(out, SR, t, dur * 0.8, freq * 2.005, { gain: gain * 0.25, decay: dur * 0.22, attack: 0.002 });
}

function click(out: Float32Array, rng: Rng, t: number, freq: number, gain: number): void {
  addNoise(out, SR, rng, t, 0.012, { gain: gain * 0.6, hpHz: 1500, decay: 0.004 });
  addTone(out, SR, t, 0.02, freq, { gain, decay: 0.006, attack: 0.0005 });
}

function thump(out: Float32Array, rng: Rng, t: number, freq: number, dur: number, gain: number): void {
  addTone(out, SR, t, dur, freq, { gain, decay: dur * 0.3, glideTo: freq * 0.55, attack: 0.002 });
  addNoise(out, SR, rng, t, dur * 0.5, { gain: gain * 0.5, lpHz: freq * 5, decay: dur * 0.15 });
}

function noteRun(
  out: Float32Array,
  notes: readonly number[],
  t0: number,
  step: number,
  dur: number,
  gain: number,
): void {
  for (let i = 0; i < notes.length; i++) chime(out, t0 + i * step, mtof(notes[i] ?? 60), dur, gain);
}

const SURFACES = ["grime", "clean", "deck"] as const;
const CONTOURS: readonly DotContour[] = ["rise", "fall", "flat"];

// ---- Recipes --------------------------------------------------------------------------------------------------------

type RecipeTable = Record<AudioCueId, CueRecipe>;

function build(): RecipeTable {
  const t: Partial<RecipeTable> = {};

  // Hand tools
  t["tool.sweep"] = one({
    note: "Looped filtered noise with a 5 Hz circular swirl and a rising 'fwip' per circle; filter, rate and gain follow speed/grime/fill at play time.",
    level: 0.55,
    loop: true,
    render: (_v, rng) => {
      const dur = 2.4;
      const out = allocPcm(dur + 0.1, SR);
      addNoise(out, SR, rng, 0, dur + 0.1, { gain: 0.8, lpHz: 3800, hpHz: 400, am: 0.65, amHz: 5 });
      for (let c = 0; c < 12; c++)
        addTone(out, SR, c * 0.2 + 0.13, 0.06, 1700, { gain: 0.05, glideTo: 2500, attack: 0.01 });
      return finishLoop(out, SR, 0.1);
    },
  });
  t["cell.fill_hiss"] = one({
    note: "Looped high band-passed noise with sparse grain ticks; playback rate rises up to +7 semitones with Cell fill.",
    level: 0.3,
    loop: true,
    render: (_v, rng) => {
      const out = allocPcm(1.3, SR);
      addNoise(out, SR, rng, 0, 1.3, { gain: 0.6, hpHz: 2200, lpHz: 7000, am: 0.5, amHz: 23 });
      return finishLoop(out, SR, 0.1);
    },
  });
  t["cell.near_full"] = one({
    note: "Soft two-tone sine blip (880 Hz then 1175 Hz).",
    level: 0.35,
    render: () => {
      const out = allocPcm(0.4, SR);
      addTone(out, SR, 0, 0.14, 880, { gain: 0.5, decay: 0.07 });
      addTone(out, SR, 0.15, 0.2, 1175, { gain: 0.5, decay: 0.09 });
      return finish(out, SR);
    },
  });
  t["cell.full"] = one({
    note: "Low clunk (gliding sine plus lp noise) and three damped rattle ticks.",
    level: 0.5,
    render: (_v, rng) => {
      const out = allocPcm(0.7, SR);
      thump(out, rng, 0, 110, 0.18, 0.9);
      for (let i = 0; i < 3; i++)
        addNoise(out, SR, rng, 0.2 + i * 0.07, 0.04, { gain: 0.25 - i * 0.06, hpHz: 800, lpHz: 3500, decay: 0.012 });
      return finish(out, SR);
    },
  });
  t["tool.lane_lock"] = one({
    note: "Latch click: 1400 Hz tick plus noise transient.",
    level: 0.3,
    render: (_v, rng) => {
      const out = allocPcm(0.12, SR);
      click(out, rng, 0.005, 1400, 0.7);
      return finish(out, SR);
    },
  });
  t["tool.lane_unlock"] = one({
    note: "Latch release: lower 900 Hz tick plus noise transient.",
    level: 0.3,
    render: (_v, rng) => {
      const out = allocPcm(0.12, SR);
      click(out, rng, 0.005, 900, 0.7);
      return finish(out, SR);
    },
  });
  t["suit.holster_clip"] = one({
    note: "Two-stage clip click; variant 1 (drawing) is higher and brighter than variant 0 (stowing).",
    level: 0.3,
    variants: 2,
    render: (v, rng) => {
      const out = allocPcm(0.16, SR);
      click(out, rng, 0.005, v === 1 ? 1700 : 1100, 0.6);
      click(out, rng, 0.05, v === 1 ? 2100 : 1400, 0.4);
      return finish(out, SR);
    },
  });

  // Cargo, selling
  t["cargo.puck_press"] = one({
    note: "Hydraulic 'ka-chunk': lp noise exhale, a 70 Hz thud and a stamp click.",
    level: 0.5,
    render: (_v, rng) => {
      const out = allocPcm(0.4, SR);
      addNoise(out, SR, rng, 0, 0.14, { gain: 0.4, lpHz: 700, decay: 0.08 });
      thump(out, rng, 0.1, 70, 0.22, 0.9);
      click(out, rng, 0.12, 1000, 0.4);
      return finish(out, SR);
    },
  });
  t["cargo.stack_band"] = one({
    note: "Strap ratchet: six rapid ticks then a settling thunk.",
    level: 0.4,
    render: (_v, rng) => {
      const out = allocPcm(0.5, SR);
      for (let i = 0; i < 6; i++) click(out, rng, 0.02 + i * 0.045, 1300 + i * 70, 0.35);
      thump(out, rng, 0.32, 90, 0.14, 0.7);
      return finish(out, SR);
    },
  });
  t["cargo.pick_up"] = one({
    note: "Soft glove-on-plastic pat: lp noise plus a short 160 Hz tap.",
    level: 0.35,
    render: (_v, rng) => {
      const out = allocPcm(0.2, SR);
      addNoise(out, SR, rng, 0, 0.1, { gain: 0.5, lpHz: 1800, decay: 0.03 });
      thump(out, rng, 0.02, 160, 0.1, 0.5);
      return finish(out, SR);
    },
  });
  t["cargo.throw"] = one({
    note: "Rising band-passed whoosh.",
    level: 0.35,
    render: (_v, rng) => {
      const out = allocPcm(0.35, SR);
      addNoise(out, SR, rng, 0, 0.3, { gain: 0.6, lpHz: 700, lpGlideTo: 4200, hpHz: 300, attack: 0.08, decay: 0.12 });
      return finish(out, SR);
    },
  });
  t["assay.pour"] = one({
    note: "Looped granular stream: band-passed noise with fast random-feeling AM; rate follows pour rate.",
    level: 0.45,
    loop: true,
    render: (_v, rng) => {
      const out = allocPcm(1.7, SR);
      addNoise(out, SR, rng, 0, 1.7, { gain: 0.7, lpHz: 3200, hpHz: 600, am: 0.55, amHz: 31 });
      addNoise(out, SR, rng, 0, 1.7, { gain: 0.3, lpHz: 1400, hpHz: 300, am: 0.7, amHz: 17 });
      return finishLoop(out, SR, 0.1);
    },
  });
  t["assay.scale_tick"] = one({
    note: "Tiny 2.4 kHz sine tick.",
    level: 0.25,
    render: () => {
      const out = allocPcm(0.05, SR);
      addTone(out, SR, 0, 0.03, 2400, { gain: 0.6, decay: 0.008, attack: 0.0004 });
      return finish(out, SR);
    },
  });
  t["assay.ka_ching"] = one({
    note: "Lumens motif: bright two-note bell chime (E6 then B6) plus a soft register thunk made of lp noise and a 120 Hz thud; variant 1 (big) adds a third note and a longer shimmer. Not a coin sound.",
    level: 0.65,
    variants: 2,
    render: (v, rng) => {
      const out = allocPcm(v === 1 ? 1.5 : 1.0, SR);
      thump(out, rng, 0, 120, 0.12, 0.35);
      chime(out, 0.02, mtof(88), 0.7, 0.55);
      chime(out, 0.11, mtof(95), v === 1 ? 1.0 : 0.8, 0.5);
      if (v === 1) {
        chime(out, 0.22, mtof(100), 1.1, 0.4);
        addTone(out, SR, 0.2, 1.1, 5200, { gain: 0.06, decay: 0.35 });
      }
      return finish(out, SR);
    },
  });
  t["gate.blip"] = one({
    note: "Scanner blip: one 1960 Hz sine pip.",
    level: 0.3,
    render: () => {
      const out = allocPcm(0.1, SR);
      addTone(out, SR, 0, 0.06, 1960, { gain: 0.6, decay: 0.02 });
      return finish(out, SR);
    },
  });
  t["railshot.charge"] = one({
    note: "2 s rising coil: gliding tone 80 to 900 Hz with a thin rising whine; sub heavy, little top end.",
    level: 0.5,
    render: (_v, rng) => {
      const out = allocPcm(2.1, SR);
      addTone(out, SR, 0, 2, 80, { gain: 0.6, glideTo: 900, harmonics: [1, 0.3], attack: 0.3 });
      addNoise(out, SR, rng, 0, 2, { gain: 0.12, hpHz: 1200, lpHz: 2500, lpGlideTo: 6000, attack: 1 });
      return finish(out, SR);
    },
  });
  t["railshot.thoom"] = one({
    note: "Deep ground thoom: 80 Hz sine gliding to 35 Hz with lp noise, then a sled-release clack.",
    level: 0.8,
    render: (_v, rng) => {
      const out = allocPcm(1.6, SR);
      addTone(out, SR, 0, 1.3, 80, { gain: 0.9, glideTo: 35, decay: 0.5, attack: 0.01 });
      addNoise(out, SR, rng, 0, 0.6, { gain: 0.3, lpHz: 220, decay: 0.2 });
      click(out, rng, 1.0, 600, 0.35);
      return finish(out, SR);
    },
  });
  t["railshot.away"] = one({
    note: "Radio chime: three rising bell notes (C5 E5 A5), radio-chain processed at play time.",
    level: 0.5,
    render: () => {
      const out = allocPcm(1.2, SR);
      noteRun(out, [72, 76, 81], 0, 0.14, 0.7, 0.5);
      return finish(out, SR);
    },
  });

  // Plots
  t["plot.stamp"] = one({
    note: "Inspector's Stamp: rubber thunk (lp noise plus 100 Hz thud) then a quick rising major chord (C5 E5 G5 C6) and ivory shimmer; variant 1 (charged) adds a lower octave. Pitch moves up to +7 semitones per streak at play time.",
    level: 0.75,
    variants: 2,
    render: (v, rng) => {
      const out = allocPcm(1.4, SR);
      thump(out, rng, 0, 100, 0.14, 0.9);
      noteRun(out, [72, 76, 79, 84], 0.07, 0.06, 0.9, 0.38);
      addTone(out, SR, 0.2, 0.9, 3100, { gain: 0.05, decay: 0.3 });
      addTone(out, SR, 0.2, 0.9, 4600, { gain: 0.03, decay: 0.25 });
      if (v === 1) chime(out, 0.07, mtof(60), 1.1, 0.4);
      return finish(out, SR);
    },
  });
  t["plot.open_blip"] = one({
    note: "Soft sensor blip: 1200 Hz sine with a band-passed grain tail.",
    level: 0.25,
    render: (_v, rng) => {
      const out = allocPcm(0.25, SR);
      addTone(out, SR, 0, 0.12, 1200, { gain: 0.5, decay: 0.05 });
      addNoise(out, SR, rng, 0, 0.18, { gain: 0.1, hpHz: 2500, lpHz: 6000, decay: 0.06 });
      return finish(out, SR);
    },
  });

  // Avatar and suit
  t["avatar.footstep"] = one({
    note: "Contact thump: grime = soft lp-noise crunch-thud, clean = firmer tap with a 180 Hz body, deck = metallic ring (inharmonic 900/1430 Hz).",
    level: 0.4,
    variants: 3,
    render: (v, rng) => {
      const out = allocPcm(0.25, SR);
      if (v === 0) {
        addNoise(out, SR, rng, 0, 0.12, { gain: 0.8, lpHz: 520, decay: 0.045 });
        addNoise(out, SR, rng, 0.01, 0.05, { gain: 0.25, lpHz: 1800, decay: 0.015 });
      } else if (v === 1) {
        addNoise(out, SR, rng, 0, 0.06, { gain: 0.6, lpHz: 1700, decay: 0.02 });
        addTone(out, SR, 0, 0.06, 180, { gain: 0.5, decay: 0.02 });
      } else {
        addNoise(out, SR, rng, 0, 0.05, { gain: 0.5, lpHz: 2200, decay: 0.015 });
        addTone(out, SR, 0, 0.2, 900, { gain: 0.25, decay: 0.07 });
        addTone(out, SR, 0, 0.2, 1430, { gain: 0.15, decay: 0.05 });
        addTone(out, SR, 0, 0.1, 150, { gain: 0.45, decay: 0.03 });
      }
      return finish(out, SR);
    },
  });
  t["avatar.jump"] = one({
    note: "Valve click plus a short cold-gas hiss.",
    level: 0.4,
    render: (_v, rng) => {
      const out = allocPcm(0.4, SR);
      click(out, rng, 0, 1500, 0.5);
      addNoise(out, SR, rng, 0.02, 0.3, { gain: 0.35, hpHz: 2800, lpHz: 8000, attack: 0.03, decay: 0.1 });
      return finish(out, SR);
    },
  });
  t["avatar.land"] = one({
    note: "Landing thump (gliding 75 Hz sine plus lp noise); variant picks the surface timbre (grime soft, clean firmer, deck metallic). Scaled by impact at play time.",
    level: 0.6,
    variants: 3,
    render: (v, rng) => {
      const out = allocPcm(0.35, SR);
      thump(out, rng, 0, v === 0 ? 70 : 85, 0.2, 0.9);
      if (v === 1) addNoise(out, SR, rng, 0, 0.04, { gain: 0.3, hpHz: 1500, lpHz: 4000, decay: 0.012 });
      if (v === 2) addTone(out, SR, 0, 0.3, 880, { gain: 0.18, decay: 0.09 });
      return finish(out, SR);
    },
  });
  t["suit.lamp_click"] = one({
    note: "Soft relay click; variant 1 (on) is higher than variant 0 (off).",
    level: 0.3,
    variants: 2,
    render: (v, rng) => {
      const out = allocPcm(0.1, SR);
      click(out, rng, 0.004, v === 1 ? 1800 : 1200, 0.6);
      return finish(out, SR);
    },
  });

  // Vehicles
  t["vehicle.enter"] = one({
    note: "Seat clunk (thud) and a latch click.",
    level: 0.45,
    render: (_v, rng) => {
      const out = allocPcm(0.4, SR);
      thump(out, rng, 0, 95, 0.16, 0.8);
      click(out, rng, 0.14, 1000, 0.4);
      return finish(out, SR);
    },
  });
  t["vehicle.exit"] = one({
    note: "Latch click then a lighter seat release thud.",
    level: 0.45,
    render: (_v, rng) => {
      const out = allocPcm(0.4, SR);
      click(out, rng, 0, 1000, 0.4);
      thump(out, rng, 0.1, 110, 0.14, 0.6);
      return finish(out, SR);
    },
  });
  t["vehicle.drive_loop"] = one({
    note: "Looped small electric motor (180 Hz harmonic stack, integer cycles) with cart rattle ticks; rate follows speed, filter follows load.",
    level: 0.4,
    loop: true,
    render: (_v, rng) => {
      const dur = 1.5;
      const out = allocPcm(dur, SR);
      addTone(out, SR, 0, dur, loopFreq(180, dur), {
        gain: 0.5,
        harmonics: [1, 0.5, 0.3, 0.15],
        attack: 0,
        release: 0,
      });
      addTone(out, SR, 0, dur, loopFreq(363, dur), { gain: 0.15, attack: 0, release: 0 });
      addNoise(out, SR, rng, 0, dur, { gain: 0.25, lpHz: 900, hpHz: 150, am: 0.6, amHz: 14 });
      return normalizeLoop(out);
    },
  });
  t["vehicle.work_loop"] = one({
    note: "Looped brush-drum 'wsshh': band-passed noise with 8 Hz modulation.",
    level: 0.4,
    loop: true,
    render: (_v, rng) => {
      const out = allocPcm(1.6, SR);
      addNoise(out, SR, rng, 0, 1.6, { gain: 0.8, lpHz: 3600, hpHz: 700, am: 0.5, amHz: 8 });
      return finishLoop(out, SR, 0.1);
    },
  });

  // Robots
  t["robot.step"] = one({
    note: "Looped skittery tick-tick steps (two micro clicks per half second).",
    level: 0.25,
    loop: true,
    render: (_v, rng) => {
      const out = allocPcm(0.5, SR);
      click(out, rng, 0.0, 2400, 0.6);
      click(out, rng, 0.12, 2000, 0.5);
      click(out, rng, 0.25, 2400, 0.6);
      click(out, rng, 0.37, 2000, 0.5);
      return normalizeLoop(out);
    },
  });
  t["robot.peep"] = one({
    note: "Synthetic servo peeps: three short FM-ish notes (2400, 3000, 2700 Hz), never a real birdcall.",
    level: 0.3,
    render: () => {
      const out = allocPcm(0.4, SR);
      const f = [2400, 3000, 2700];
      for (let i = 0; i < 3; i++)
        addTone(out, SR, i * 0.09, 0.07, f[i] ?? 2400, { gain: 0.5, decay: 0.03, vibrato: 0.03, vibratoHz: 38 });
      return finish(out, SR);
    },
  });
  t["robot.peck"] = one({
    note: "Beak brush peck: tiny noise tick.",
    level: 0.25,
    render: (_v, rng) => {
      const out = allocPcm(0.08, SR);
      addNoise(out, SR, rng, 0, 0.04, { gain: 0.6, hpHz: 1800, lpHz: 5000, decay: 0.01 });
      return finish(out, SR);
    },
  });
  t["robot.dock"] = one({
    note: "Docking clamp click then a rising charge hum.",
    level: 0.35,
    render: (_v, rng) => {
      const out = allocPcm(0.7, SR);
      click(out, rng, 0, 800, 0.6);
      addTone(out, SR, 0.08, 0.5, 220, { gain: 0.3, glideTo: 330, attack: 0.1, harmonics: [1, 0.3] });
      return finish(out, SR);
    },
  });
  t["robot.deploy"] = one({
    note: "Servo whir sweep and a cold-gas puff.",
    level: 0.35,
    render: (_v, rng) => {
      const out = allocPcm(0.6, SR);
      addTone(out, SR, 0, 0.4, 300, { gain: 0.3, glideTo: 900, attack: 0.05 });
      addNoise(out, SR, rng, 0.2, 0.3, { gain: 0.3, hpHz: 2000, lpHz: 7000, decay: 0.1 });
      return finish(out, SR);
    },
  });
  t["robot.alert"] = one({
    note: "Amber two-note alert (A5 then E5, soft), radio-chain processed at play time.",
    level: 0.45,
    render: () => {
      const out = allocPcm(0.7, SR);
      chime(out, 0, mtof(81), 0.35, 0.5);
      chime(out, 0.2, mtof(76), 0.45, 0.5);
      return finish(out, SR);
    },
  });
  t["robot.plot_done"] = one({
    note: "Three rising bell notes (G5 B5 D6).",
    level: 0.4,
    render: () => {
      const out = allocPcm(0.9, SR);
      noteRun(out, [79, 83, 86], 0, 0.11, 0.55, 0.5);
      return finish(out, SR);
    },
  });

  // UI
  t["ui.hover"] = one({
    note: "Very soft glass tick: 3200 Hz sine, 8 ms.",
    level: 0.2,
    render: () => {
      const out = allocPcm(0.04, SR);
      addTone(out, SR, 0, 0.025, 3200, { gain: 0.5, decay: 0.006, attack: 0.0004 });
      return finish(out, SR);
    },
  });
  t["ui.click"] = one({
    note: "Soft rounded click: 900 Hz sine with a quick decay.",
    level: 0.35,
    render: () => {
      const out = allocPcm(0.08, SR);
      addTone(out, SR, 0, 0.05, 900, { gain: 0.6, decay: 0.012, attack: 0.001, harmonics: [1, 0.2] });
      return finish(out, SR);
    },
  });
  t["ui.toggle"] = one({
    note: "Two-state click: variant 1 (on) pitches up (1200 Hz), variant 0 (off) down (760 Hz).",
    level: 0.35,
    variants: 2,
    render: (v) => {
      const out = allocPcm(0.1, SR);
      addTone(out, SR, 0, 0.06, v === 1 ? 1200 : 760, { gain: 0.6, decay: 0.014, attack: 0.001 });
      return finish(out, SR);
    },
  });
  t["ui.panel_open"] = one({
    note: "Glass whoosh up: band-passed noise sweeping 800 to 3200 Hz.",
    level: 0.3,
    render: (_v, rng) => {
      const out = allocPcm(0.3, SR);
      addNoise(out, SR, rng, 0, 0.25, { gain: 0.6, lpHz: 800, lpGlideTo: 3200, hpHz: 400, attack: 0.07, decay: 0.1 });
      return finish(out, SR);
    },
  });
  t["ui.panel_close"] = one({
    note: "Glass whoosh down: band-passed noise sweeping 3200 to 800 Hz.",
    level: 0.3,
    render: (_v, rng) => {
      const out = allocPcm(0.3, SR);
      addNoise(out, SR, rng, 0, 0.22, { gain: 0.6, lpHz: 3200, lpGlideTo: 800, hpHz: 400, attack: 0.03, decay: 0.09 });
      return finish(out, SR);
    },
  });
  t["ui.purchase"] = one({
    note: "Requisition approved: two-note rise (E5 then A5) at 0 and 120 ms with a soft stamp thud at 120 ms.",
    level: 0.5,
    render: (_v, rng) => {
      const out = allocPcm(0.8, SR);
      chime(out, 0, mtof(76), 0.45, 0.5);
      chime(out, 0.12, mtof(81), 0.6, 0.55);
      thump(out, rng, 0.12, 120, 0.1, 0.3);
      return finish(out, SR);
    },
  });
  t["ui.reject"] = one({
    note: "Soft low double buzz: two 150 Hz triangle-ish bursts, low-passed so it is never harsh.",
    level: 0.4,
    render: () => {
      const out = allocPcm(0.35, SR);
      addTone(out, SR, 0, 0.1, 150, { gain: 0.6, harmonics: [1, 0.25, 0.1], attack: 0.01 });
      addTone(out, SR, 0.15, 0.12, 140, { gain: 0.6, harmonics: [1, 0.25, 0.1], attack: 0.01 });
      return finish(out, SR);
    },
  });
  t["ui.lumen_tick"] = one({
    note: "Lumen shimmer: four tiny rising high ticks; pitch rises with streak01 at play time.",
    level: 0.3,
    render: () => {
      const out = allocPcm(0.25, SR);
      for (let i = 0; i < 4; i++)
        addTone(out, SR, i * 0.04, 0.08, 2600 + i * 450, { gain: 0.4, decay: 0.02, attack: 0.001 });
      return finish(out, SR);
    },
  });
  t["ui.plot_card"] = one({
    note: "Sonar-like sweep and a soft ping.",
    level: 0.3,
    render: (_v, rng) => {
      const out = allocPcm(0.7, SR);
      addNoise(out, SR, rng, 0, 0.25, { gain: 0.2, lpHz: 600, lpGlideTo: 2600, hpHz: 300, attack: 0.1, decay: 0.1 });
      chime(out, 0.22, mtof(91), 0.45, 0.45);
      return finish(out, SR);
    },
  });
  t["ui.achievement"] = one({
    note: "Short bright four-note motif (C6 E6 G6 C7).",
    level: 0.5,
    render: () => {
      const out = allocPcm(1.2, SR);
      noteRun(out, [84, 88, 91, 96], 0, 0.09, 0.7, 0.45);
      return finish(out, SR);
    },
  });
  t["ui.unlock"] = one({
    note: "Rising three-note unlock (D5 F#5 A5).",
    level: 0.45,
    render: () => {
      const out = allocPcm(0.9, SR);
      noteRun(out, [74, 78, 81], 0, 0.1, 0.6, 0.5);
      return finish(out, SR);
    },
  });
  t["ui.find"] = one({
    note: "Sparkle: two high bell notes (B6 then F#7) with shimmer.",
    level: 0.4,
    render: () => {
      const out = allocPcm(0.8, SR);
      chime(out, 0, mtof(95), 0.5, 0.45);
      chime(out, 0.09, mtof(102), 0.6, 0.35);
      return finish(out, SR);
    },
  });
  t["ui.check"] = one({
    note: "Two quick soft notes (G5 then C6) for a completed Induction step.",
    level: 0.35,
    render: () => {
      const out = allocPcm(0.35, SR);
      chime(out, 0, mtof(79), 0.25, 0.5);
      chime(out, 0.07, mtof(84), 0.3, 0.5);
      return finish(out, SR);
    },
  });
  t["ui.clock_in"] = one({
    note: "Brightside jingle (about 3.2 s): warm major arpeggio (C5 E5 G5 B5 D6 C6) over a soft pad chord and a closing bell; written for this game.",
    level: 0.6,
    render: () => {
      const out = allocPcm(3.4, SR);
      for (const n of [60, 64, 67])
        addTone(out, SR, 0, 3.2, mtof(n), { gain: 0.12, attack: 0.3, decay: 1.6, harmonics: [1, 0.2] });
      noteRun(out, [72, 76, 79, 83, 86, 84], 0.1, 0.22, 1.1, 0.4);
      chime(out, 1.6, mtof(96), 1.6, 0.3);
      return finish(out, SR);
    },
  });

  // DOT
  t["dot.bloop"] = one({
    note: "Amber two-note bloop (F#5 then B5), soft sine with slight vibrato; radio-chain processed at play time.",
    level: 0.4,
    render: () => {
      const out = allocPcm(0.3, SR);
      addTone(out, SR, 0, 0.1, 740, { gain: 0.6, attack: 0.01, decay: 0.08 });
      addTone(out, SR, 0.1, 0.16, 988, { gain: 0.6, attack: 0.01, decay: 0.1 });
      return finish(out, SR);
    },
  });
  t["dot.chirp"] = one({
    note: "Chirp-speak: 2 to 12 short formant-ish syllables (sine plus 2nd/3rd harmonic) with a rise, fall or flat contour; 20 percent 7-bit 'terminal grain'. Variant = (syllables - 2) * 3 + contour index.",
    level: 0.4,
    variants: 33,
    render: (v) => {
      const syl = Math.floor(v / 3) + 2;
      const contour = CONTOURS[v % 3] ?? "flat";
      const sylDur = 0.07;
      const gap = 0.03;
      const out = allocPcm(syl * (sylDur + gap) + 0.05, SR);
      const rng = mulberry32(hashString(`chirp${v}`));
      for (let i = 0; i < syl; i++) {
        const u = syl > 1 ? i / (syl - 1) : 0;
        const slope = contour === "rise" ? 1 + 0.5 * u : contour === "fall" ? 1.4 - 0.5 * u : 1;
        const jitter = 0.9 + rng() * 0.25;
        const f = 520 * slope * jitter;
        addTone(out, SR, i * (sylDur + gap), sylDur, f, {
          gain: 0.55,
          attack: 0.008,
          decay: 0.05,
          harmonics: [1, 0.4, 0.15],
          glideTo: f * (0.92 + rng() * 0.2),
        });
      }
      addGrain(out, 7, 0.2);
      return finish(out, SR);
    },
  });

  // Ambience
  t["ambience.suit_bed"] = one({
    note: "Looped 6 s suit bed: fan hum (118/236/354 Hz at integer cycles), pink-ish radio hiss floor and two soft pump cycles.",
    level: 0.5,
    loop: true,
    render: (_v, rng) => {
      const dur = 6;
      const out = allocPcm(dur, SR);
      addTone(out, SR, 0, dur, loopFreq(118, dur), { gain: 0.3, attack: 0, release: 0 });
      addTone(out, SR, 0, dur, loopFreq(236, dur), { gain: 0.12, attack: 0, release: 0 });
      addTone(out, SR, 0, dur, loopFreq(354, dur), { gain: 0.06, attack: 0, release: 0 });
      addNoise(out, SR, rng, 0, dur, { gain: 0.12, lpHz: 3500, hpHz: 500, attack: 0, release: 0 });
      addNoise(out, SR, rng, 1.0, 0.9, { gain: 0.14, lpHz: 400, attack: 0.3, decay: 0.5 });
      addNoise(out, SR, rng, 4.0, 0.9, { gain: 0.14, lpHz: 400, attack: 0.3, decay: 0.5 });
      return normalizeLoop(out);
    },
  });
  t["ambience.breathing"] = one({
    note: "Looped 5 s calm breath: band-passed noise inhale then exhale; rate and level follow effort.",
    level: 0.35,
    loop: true,
    render: (_v, rng) => {
      const out = allocPcm(5, SR);
      addNoise(out, SR, rng, 0.2, 1.7, { gain: 0.6, lpHz: 900, lpGlideTo: 1500, hpHz: 250, attack: 0.8, decay: 1.2 });
      addNoise(out, SR, rng, 2.7, 2.0, { gain: 0.5, lpHz: 1300, lpGlideTo: 600, hpHz: 250, attack: 0.3, decay: 0.9 });
      return normalizeLoop(out);
    },
  });
  t["ambience.thermal_tick"] = one({
    note: "Hardware creak: a tick plus a short downward resonant sine.",
    level: 0.3,
    render: (_v, rng) => {
      const out = allocPcm(0.35, SR);
      click(out, rng, 0, 1100, 0.5);
      addTone(out, SR, 0.01, 0.25, 320, { gain: 0.4, glideTo: 140, decay: 0.08, harmonics: [1, 0.3] });
      return finish(out, SR);
    },
  });
  t["ambience.outpost_hum"] = one({
    note: "Looped 4 s generator hum (60/120/180 Hz at integer cycles) with a faint 3 kHz signage buzz.",
    level: 0.4,
    loop: true,
    render: () => {
      const dur = 4;
      const out = allocPcm(dur, SR);
      addTone(out, SR, 0, dur, loopFreq(60, dur), { gain: 0.5, attack: 0, release: 0 });
      addTone(out, SR, 0, dur, loopFreq(120, dur), { gain: 0.25, attack: 0, release: 0 });
      addTone(out, SR, 0, dur, loopFreq(180, dur), { gain: 0.1, attack: 0, release: 0 });
      addTone(out, SR, 0, dur, loopFreq(3000, dur), { gain: 0.015, attack: 0, release: 0 });
      return normalizeLoop(out);
    },
  });

  // Music beds (the real adaptive layers live in music.ts; these are the L0 pad of each set) and stingers.
  for (const set of ["day", "bridge", "night", "menu", "hold"] as const) {
    t[`music.${set}` as const] = {
      note: `L0 pad of the ${set} set: additive sine chord stack at integer cycles over an 11.6 s loop (loop-clean); layers L1/L2 are rendered by music.ts.`,
      variants: 1,
      loop: true,
      level: 1,
      sampleRate: MUSIC_RATE,
      render: () => renderPad(set),
    };
  }
  t["music.stinger_unlock"] = one({
    note: "1.6 s key-aware stinger: rising lydian fourth stack (C5 F#5 B5 E6).",
    level: 0.45,
    render: () => {
      const out = allocPcm(1.8, SR);
      noteRun(out, [72, 78, 83, 88], 0, 0.13, 1.0, 0.4);
      return finish(out, SR);
    },
  });
  t["music.stinger_shine"] = one({
    note: "Shine milestone: soft three-note bell rise (E5 G5 B5) with a pad swell; pitch follows the milestone at play time.",
    level: 0.45,
    render: () => {
      const out = allocPcm(2.0, SR);
      noteRun(out, [76, 79, 83], 0, 0.16, 1.1, 0.4);
      addTone(out, SR, 0, 1.8, mtof(64), { gain: 0.15, attack: 0.5, decay: 0.8, harmonics: [1, 0.2] });
      return finish(out, SR);
    },
  });
  t["music.stinger_fulfilled"] = one({
    note: "Contract Fulfilled fanfare (about 3.4 s): ascending major arpeggio, a held chord and a final bell; original.",
    level: 0.6,
    render: () => {
      const out = allocPcm(3.6, SR);
      noteRun(out, [60, 64, 67, 72, 76, 79, 84], 0, 0.14, 1.3, 0.38);
      for (const n of [60, 67, 72, 76])
        addTone(out, SR, 1.0, 2.4, mtof(n), { gain: 0.14, attack: 0.15, decay: 1.2, harmonics: [1, 0.25] });
      chime(out, 1.4, mtof(96), 2.0, 0.3);
      return finish(out, SR);
    },
  });

  return t as RecipeTable;
}

function normalizeLoop(out: Float32Array): Float32Array {
  normalize(out, PEAK);
  return out;
}

export const CUE_RECIPES: RecipeTable = build();

/** Every cue id has a recipe (checked in tests too). */
export function hasRecipe(id: AudioCueId): boolean {
  return AUDIO_CUE_IDS.includes(id) && CUE_RECIPES[id] !== undefined;
}

// ---- Variant selection ---------------------------------------------------------------------------------------------------

function surfaceIndex(surface: string | undefined): number {
  const i = SURFACES.indexOf(surface as (typeof SURFACES)[number]);
  return i < 0 ? 0 : i;
}

/** Which render variant a trigger asks for. Loose params type so the hot path does not need per-cue generics. */
export interface VariantParams {
  readonly surface?: string;
  readonly on?: boolean;
  readonly big?: boolean;
  readonly charged?: boolean;
  readonly drawing?: boolean;
  readonly syllables?: number;
  readonly contour?: string;
}

export function variantOf(id: AudioCueId, p: VariantParams): number {
  switch (id) {
    case "avatar.footstep":
    case "avatar.land":
      return surfaceIndex(p.surface);
    case "ui.toggle":
    case "suit.lamp_click":
      return p.on === true ? 1 : 0;
    case "assay.ka_ching":
      return p.big === true ? 1 : 0;
    case "plot.stamp":
      return p.charged === true ? 1 : 0;
    case "suit.holster_clip":
      return p.drawing === true ? 1 : 0;
    case "dot.chirp": {
      const syl = clamp(Math.round(p.syllables ?? 4), 2, 12);
      const c = Math.max(0, CONTOURS.indexOf((p.contour ?? "flat") as DotContour));
      return (syl - 2) * 3 + c;
    }
    default:
      return 0;
  }
}
