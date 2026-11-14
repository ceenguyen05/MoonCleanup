// Procedural music beds. Original: chord voicings and rhythm patterns written for this game, synthesised from sine
// partials and noise. Each set has an L0 pad (all sets) and, for day and night, L1 pulse and L2 melody layers.
// Pads are additive with integer-cycle partials, so the 11.6 s loop has no seam. The pad is rendered in sample ranges so
// the music director can spread the work over many frames (see music.ts); pulse and melody are tiny and render at once.

import type { MusicSet } from "@moon-cleanup/shared";
import { MUSIC_RATE, TAU, addNoise, addTone, allocPcm, fadeEdges, loopFreq, mtof, mulberry32, normalize } from "./dsp";

export const PAD_SECONDS = 11.6;
export const PAD_SAMPLES = Math.round(PAD_SECONDS * MUSIC_RATE);

interface PadVoicing {
  readonly notes: readonly number[];
  readonly gains: readonly number[];
  /** Tremolo cycles per loop (integer, so the loop stays seamless). */
  readonly lfoCycles: number;
}

const PADS: Readonly<Record<MusicSet, PadVoicing>> = {
  // Lydian C: C3 G3 B3 E4 F#4 (bright, open).
  day: { notes: [48, 55, 59, 64, 66], gains: [0.5, 0.35, 0.25, 0.22, 0.14], lfoCycles: 2 },
  // Sus swell: D3 A3 D4 F#4.
  bridge: { notes: [50, 57, 62, 66], gains: [0.5, 0.35, 0.25, 0.2], lfoCycles: 3 },
  // Glassy Am(add9): A2 E3 A3 C4 E4 B4 (cool, sparse).
  night: { notes: [45, 52, 57, 60, 64, 71], gains: [0.5, 0.3, 0.22, 0.15, 0.16, 0.08], lfoCycles: 1 },
  // Calm day variant: C3 G3 B3 E4.
  menu: { notes: [48, 55, 59, 64], gains: [0.5, 0.35, 0.25, 0.2], lfoCycles: 2 },
  // Muzak-jazz Dm9: D3 A3 C4 E4 F4.
  hold: { notes: [50, 57, 60, 64, 65], gains: [0.45, 0.32, 0.3, 0.25, 0.18], lfoCycles: 4 },
};

interface PartialSpec {
  readonly freq: number;
  readonly gain: number;
}

const partialCache = new Map<MusicSet, readonly PartialSpec[]>();

function partialsOf(set: MusicSet): readonly PartialSpec[] {
  const cached = partialCache.get(set);
  if (cached !== undefined) return cached;
  const v = PADS[set];
  const list: PartialSpec[] = [];
  v.notes.forEach((n, i) => {
    const g = v.gains[i] ?? 0.2;
    const f = loopFreq(mtof(n), PAD_SECONDS);
    list.push({ freq: f, gain: g });
    list.push({ freq: loopFreq(f * 1.004, PAD_SECONDS), gain: g * 0.6 }); // chorus partner
    list.push({ freq: loopFreq(f * 2, PAD_SECONDS), gain: g * 0.18 });
  });
  partialCache.set(set, list);
  return list;
}

/** Renders pad samples [from, to) into `out` (length PAD_SAMPLES). Stateless per sample, so any range order works. */
export function renderPadRange(set: MusicSet, out: Float32Array, from: number, to: number): void {
  const partials = partialsOf(set);
  const lfoCycles = PADS[set].lfoCycles;
  const end = Math.min(to, out.length);
  for (let i = from; i < end; i++) {
    const t = i / MUSIC_RATE;
    const lfo = 0.8 + 0.2 * Math.sin((TAU * lfoCycles * t) / PAD_SECONDS);
    let s = 0;
    for (let p = 0; p < partials.length; p++) {
      const part = partials[p];
      if (part !== undefined) s += part.gain * Math.sin(TAU * part.freq * t);
    }
    out[i] = s * lfo * 0.18;
  }
}

/** Scales a finished pad to a gentle level (full stem stack is mixed by the bus levels; this is the stem peak). */
export function finishPad(out: Float32Array): void {
  normalize(out, 0.5);
}

/** Renders the whole pad at once (tests, auditioning; the director uses the ranged form). */
export function renderPad(set: MusicSet): Float32Array {
  const out = new Float32Array(PAD_SAMPLES);
  renderPadRange(set, out, 0, out.length);
  finishPad(out);
  return out;
}

// ---- L1 pulse and L2 melody -----------------------------------------------------------------------------------------

export interface LayerTiming {
  readonly bpm: number;
  readonly beats: number;
}

export const DAY_TIMING: LayerTiming = { bpm: 100, beats: 16 };
export const NIGHT_TIMING: LayerTiming = { bpm: 76, beats: 16 };

export function layerSamples(timing: LayerTiming): number {
  return Math.round((timing.beats * 60 * MUSIC_RATE) / timing.bpm);
}

/** Day pulse: soft kick on 1 and 3, brushed snare on 2 and 4, eighth hats, a round bass note per bar. */
function dayPulse(): Float32Array {
  const sr = MUSIC_RATE;
  const beat = 60 / DAY_TIMING.bpm;
  const out = allocPcm((DAY_TIMING.beats * 60) / DAY_TIMING.bpm, sr);
  const rng = mulberry32(0xd4a1);
  const bass = [36, 36, 43, 41];
  for (let b = 0; b < DAY_TIMING.beats - 1; b++) {
    const t = b * beat;
    if (b % 2 === 0) addTone(out, sr, t, 0.2, 110, { gain: 0.7, glideTo: 52, decay: 0.08, attack: 0.002 });
    else addNoise(out, sr, rng, t, 0.18, { gain: 0.25, hpHz: 1500, lpHz: 6000, attack: 0.012, decay: 0.07 });
    addNoise(out, sr, rng, t, 0.04, { gain: 0.07, hpHz: 6000, decay: 0.01 });
    addNoise(out, sr, rng, t + beat / 2, 0.03, { gain: 0.05, hpHz: 6500, decay: 0.008 });
    if (b % 4 === 0)
      addTone(out, sr, t, beat * 1.6, mtof(bass[(b / 4) | 0] ?? 36), { gain: 0.35, decay: 0.5, harmonics: [1, 0.3] });
  }
  fadeEdges(out, sr, 1, 6);
  normalize(out, 0.5);
  return out;
}

/** Day melody: sparse plucked lydian figure (marimba-like), four phrases of four beats. */
function dayMelody(): Float32Array {
  const sr = MUSIC_RATE;
  const beat = 60 / DAY_TIMING.bpm;
  const out = allocPcm((DAY_TIMING.beats * 60) / DAY_TIMING.bpm, sr);
  const phrase = [
    [0, 76],
    [1.5, 79],
    [2, 83],
    [3, 79],
    [4, 78],
    [5.5, 76],
    [6, 74],
    [8, 76],
    [9, 79],
    [10, 83],
    [10.5, 86],
    [12, 83],
    [13.5, 79],
  ] as const;
  for (const [b, n] of phrase)
    addTone(out, sr, b * beat, 0.7, mtof(n), { gain: 0.4, decay: 0.16, harmonics: [1, 0.35, 0.1], attack: 0.003 });
  fadeEdges(out, sr, 1, 6);
  normalize(out, 0.45);
  return out;
}

/** Night pulse: a soft sub thump every four beats and glassy ticks. */
function nightPulse(): Float32Array {
  const sr = MUSIC_RATE;
  const beat = 60 / NIGHT_TIMING.bpm;
  const out = allocPcm((NIGHT_TIMING.beats * 60) / NIGHT_TIMING.bpm, sr);
  const rng = mulberry32(0x9e17);
  for (let b = 0; b < NIGHT_TIMING.beats - 2; b++) {
    const t = b * beat;
    if (b % 4 === 0) addTone(out, sr, t, 0.9, 55, { gain: 0.7, decay: 0.3, attack: 0.02 });
    if (b % 2 === 1) addNoise(out, sr, rng, t, 0.03, { gain: 0.06, hpHz: 5000, decay: 0.01 });
  }
  fadeEdges(out, sr, 1, 6);
  normalize(out, 0.4);
  return out;
}

/** Night melody: sparse celesta bells and one distant low bell. */
function nightMelody(): Float32Array {
  const sr = MUSIC_RATE;
  const beat = 60 / NIGHT_TIMING.bpm;
  const out = allocPcm((NIGHT_TIMING.beats * 60) / NIGHT_TIMING.bpm, sr);
  const phrase = [
    [0, 81],
    [3, 84],
    [6, 88],
    [8, 81],
    [11, 79],
    [13, 76],
  ] as const;
  for (const [b, n] of phrase) {
    addTone(out, sr, b * beat, 1.8, mtof(n), { gain: 0.35, decay: 0.55, harmonics: [1, 0.2, 0.08], attack: 0.003 });
    addTone(out, sr, b * beat, 1.2, mtof(n) * 2.76, { gain: 0.05, decay: 0.2 });
  }
  addTone(out, sr, 7 * beat, 2.4, mtof(57), { gain: 0.25, decay: 0.9, harmonics: [1, 0.4] });
  fadeEdges(out, sr, 1, 6);
  normalize(out, 0.4);
  return out;
}

export type MusicLayer = "pulse" | "melody";

/** The L1/L2 buffer of a set, or null when the set has none (bridge, menu, hold). */
export function renderLayer(set: MusicSet, layer: MusicLayer): Float32Array | null {
  if (set === "day") return layer === "pulse" ? dayPulse() : dayMelody();
  if (set === "night") return layer === "pulse" ? nightPulse() : nightMelody();
  return null;
}
