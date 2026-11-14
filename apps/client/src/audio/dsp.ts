// Pure DSP primitives for the procedural cue recipes. No Web Audio, no DOM: everything renders into Float32Array so the
// recipes run (and are tested) in Node. Rendering is deterministic: noise comes from a seeded PRNG, never Math.random.

/** Sample rate the one-shot and loop recipes are rendered at (the context resamples on playback). */
export const SFX_RATE = 32_000;
/** Sample rate of the music beds (pads are low-passed content; keeps memory and render time small). */
export const MUSIC_RATE = 22_050;

export type Rng = () => number;

/** mulberry32: small, fast, deterministic. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string, used to derive per-cue seeds. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const TAU = Math.PI * 2;

/** MIDI note number to Hz. */
export function mtof(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function allocPcm(seconds: number, sr: number): Float32Array {
  return new Float32Array(Math.max(1, Math.round(seconds * sr)));
}

/** Frequency quantised so a whole number of cycles fits `durS`: tonal loops built from these loop with no seam. */
export function loopFreq(freq: number, durS: number): number {
  return Math.max(1, Math.round(freq * durS)) / durS;
}

export interface ToneOptions {
  readonly gain?: number;
  /** Attack in seconds (default 0.004). */
  readonly attack?: number;
  /** Exponential decay time constant in seconds (default: sustains for the duration with a short release). */
  readonly decay?: number;
  /** Relative amplitudes of harmonics 1..n (default [1]). */
  readonly harmonics?: readonly number[];
  /** Frequency at the end of the tone; glides exponentially from `freq`. */
  readonly glideTo?: number;
  /** Vibrato depth as a fraction of frequency and rate in Hz. */
  readonly vibrato?: number;
  readonly vibratoHz?: number;
  /** Release in seconds at the end (0 for seamless loops). */
  readonly release?: number;
}

/** Adds a (possibly gliding) harmonic tone. Out-of-range parts are clipped, not an error. */
export function addTone(
  out: Float32Array,
  sr: number,
  startS: number,
  durS: number,
  freq: number,
  o: ToneOptions = {},
): void {
  const start = Math.max(0, Math.round(startS * sr));
  const n = Math.min(out.length - start, Math.round(durS * sr));
  if (n <= 0) return;
  const gain = o.gain ?? 0.5;
  const attack = Math.max(1 / sr, o.attack ?? 0.004);
  const release = o.release ?? Math.min(0.02, durS * 0.3);
  const harmonics = o.harmonics ?? [1];
  const glide = o.glideTo === undefined ? 0 : Math.log(o.glideTo / freq);
  const vib = o.vibrato ?? 0;
  const vibHz = o.vibratoHz ?? 5.5;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = n > 1 ? i / (n - 1) : 0;
    let f = freq * Math.exp(glide * u);
    if (vib !== 0) f *= 1 + vib * Math.sin(TAU * vibHz * t);
    phase += (TAU * f) / sr;
    let env = t < attack ? t / attack : 1;
    if (o.decay !== undefined) env *= Math.exp(-(t - Math.min(t, attack)) / o.decay);
    const tail = durS - t;
    if (tail < release) env *= tail / release;
    let s = 0;
    for (let h = 0; h < harmonics.length; h++) s += (harmonics[h] ?? 0) * Math.sin(phase * (h + 1));
    out[start + i] = (out[start + i] ?? 0) + s * env * gain;
  }
}

export interface NoiseOptions {
  readonly gain?: number;
  readonly attack?: number;
  readonly decay?: number;
  /** One-pole low-pass cutoff in Hz (default none). */
  readonly lpHz?: number;
  /** One-pole high-pass cutoff in Hz (default none). */
  readonly hpHz?: number;
  /** Sweeps the low-pass cutoff exponentially to this value over the burst. */
  readonly lpGlideTo?: number;
  /** Amplitude modulation depth 0..1 at `amHz` (swirl and rattle textures). */
  readonly am?: number;
  readonly amHz?: number;
  /** Release in seconds at the end (0 for seamless loops). */
  readonly release?: number;
}

/** Adds a filtered noise burst. */
export function addNoise(
  out: Float32Array,
  sr: number,
  rng: Rng,
  startS: number,
  durS: number,
  o: NoiseOptions = {},
): void {
  const start = Math.max(0, Math.round(startS * sr));
  const n = Math.min(out.length - start, Math.round(durS * sr));
  if (n <= 0) return;
  const gain = o.gain ?? 0.5;
  const attack = Math.max(1 / sr, o.attack ?? 0.003);
  const release = o.release ?? Math.min(0.015, durS * 0.3);
  let lp = 0;
  let hp = 0;
  const lpGlide = o.lpHz !== undefined && o.lpGlideTo !== undefined ? Math.log(o.lpGlideTo / o.lpHz) : 0;
  const aHp = o.hpHz === undefined ? 0 : 1 - Math.exp((-TAU * o.hpHz) / sr);
  const am = o.am ?? 0;
  const amHz = o.amHz ?? 6;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = n > 1 ? i / (n - 1) : 0;
    let x = rng() * 2 - 1;
    if (o.lpHz !== undefined) {
      const f = o.lpHz * Math.exp(lpGlide * u);
      lp += (1 - Math.exp((-TAU * f) / sr)) * (x - lp);
      x = lp;
    }
    if (o.hpHz !== undefined) {
      hp += aHp * (x - hp);
      x -= hp;
    }
    let env = t < attack ? t / attack : 1;
    if (o.decay !== undefined) env *= Math.exp(-(t - Math.min(t, attack)) / o.decay);
    const tail = durS - t;
    if (tail < release) env *= tail / release;
    if (am > 0) env *= 1 - am + am * (0.5 + 0.5 * Math.sin(TAU * amHz * t));
    out[start + i] = (out[start + i] ?? 0) + x * env * gain;
  }
}

/** Scales the buffer so its absolute peak equals `peak` (linear). Silent buffers are left alone. */
export function normalize(out: Float32Array, peak: number): void {
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i] ?? 0);
    if (a > max) max = a;
  }
  if (max < 1e-9) return;
  const k = peak / max;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * k;
}

/** Peak of a buffer. */
export function peakOf(out: Float32Array): number {
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i] ?? 0);
    if (a > max) max = a;
  }
  return max;
}

/** Linear fade at both ends so one-shots never click. */
export function fadeEdges(out: Float32Array, sr: number, inMs = 1, outMs = 6): void {
  const a = Math.min(out.length, Math.round((inMs / 1000) * sr));
  const b = Math.min(out.length, Math.round((outMs / 1000) * sr));
  for (let i = 0; i < a; i++) out[i] = (out[i] ?? 0) * (i / a);
  for (let i = 0; i < b; i++) {
    const j = out.length - 1 - i;
    out[j] = (out[j] ?? 0) * (i / b);
  }
}

/**
 * Makes a noise loop seamless: crossfades the last `xf` samples into the first ones and drops them, so the sample after
 * the end equals the sample at the start. Returns a shorter view of `out`.
 */
export function loopCrossfade(out: Float32Array, xf: number): Float32Array {
  const n = out.length - xf;
  if (n <= 0 || xf <= 0) return out;
  for (let i = 0; i < xf; i++) {
    const w = i / xf;
    out[i] = (out[i] ?? 0) * w + (out[n + i] ?? 0) * (1 - w);
  }
  return out.subarray(0, n);
}

/** Quantises toward a coarse bit depth and mixes it in (the DOT "terminal grain"). */
export function addGrain(out: Float32Array, bits: number, mix: number): void {
  const levels = Math.pow(2, bits);
  for (let i = 0; i < out.length; i++) {
    const x = out[i] ?? 0;
    const q = Math.round(x * levels) / levels;
    out[i] = x * (1 - mix) + q * mix;
  }
}

/** True when every sample is finite (recipe sanity test). */
export function allFinite(out: Float32Array): boolean {
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) return false;
  return true;
}
