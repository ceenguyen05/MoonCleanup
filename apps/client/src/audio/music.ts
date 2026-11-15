// Music director: layered, loop-clean, never a hard cut (audio-direction §4).
//
// A set is a pad (L0) plus, for day and night, a pulse (L1) and a melody (L2). All layers of a set start together on
// a bar boundary of the previous set and loop forever, so they stay phase-aligned; L1 and L2 are brought in and out by
// gain only (L1 follows cleaning activity, ~4 bar fade in, falls back after 8 s idle; L2 enters on the next 4-bar
// boundary). Set changes crossfade over about 2 bars and are quantised to the current set's bar. Pads render in small
// slices from `tick` (never more than PAD_SLICE samples per call) so no frame pays for a whole pad.

import type { MusicSet } from "@moon-cleanup/shared";
import type { AContext, AGain, ASource } from "./webaudio-types";
import { MUSIC_RATE } from "./dsp";
import {
  DAY_TIMING,
  NIGHT_TIMING,
  PAD_SAMPLES,
  finishPad,
  renderLayer,
  renderPadRange,
  type LayerTiming,
  type MusicLayer,
} from "./music-recipes";

export const PAD_SLICE = 1024;
const LAYERS: readonly MusicLayer[] = ["pulse", "melody"];
export const PULSE_IDLE_S = 8;
export const CROSSFADE_S = 4.8; // two bars at 100 BPM
const OLD_SET_LINGER_S = CROSSFADE_S + 0.5;

/** Fixed iteration order for pad slices (a Map key iterator would allocate every tick). */
const PAD_SET_LIST: readonly MusicSet[] = ["day", "night", "bridge", "menu", "hold"];

const BAR_S: Readonly<Record<MusicSet, number>> = {
  day: (4 * 60) / DAY_TIMING.bpm,
  night: (4 * 60) / NIGHT_TIMING.bpm,
  bridge: 2.4,
  menu: 2.4,
  hold: 2.4,
};

function timingOf(set: MusicSet): LayerTiming | null {
  return set === "day" ? DAY_TIMING : set === "night" ? NIGHT_TIMING : null;
}

interface Playing {
  readonly set: MusicSet;
  readonly startTime: number;
  readonly out: AGain;
  readonly pulseGain: AGain | null;
  readonly melodyGain: AGain | null;
  readonly sources: ASource[];
  endAt: number;
}

export class MusicDirector {
  private readonly pads = new Map<MusicSet, Float32Array>();
  private readonly padProgress = new Map<MusicSet, number>();
  private readonly layerBuffers = new Map<string, Float32Array>();
  private readonly layerPending = new Set<string>();
  private readonly layerEmpty = new Set<string>();
  private current: Playing | null = null;
  private readonly retiring: Playing[] = [];
  private wanted: MusicSet | null = null;
  private heldFrom: MusicSet | null = null;
  private activeUntilS = 0;
  private melodyOn = false;
  private pulseTarget = 0;
  private enabled = true;

  constructor(
    private readonly ctx: AContext,
    private readonly dest: AGain,
    /** Off-thread layer renderer; returns false when unavailable (layers then render here, one per tick). */
    private readonly requestLayer: ((set: MusicSet, layer: MusicLayer) => boolean) | null = null,
  ) {}

  /** A layer rendered by the worker arrives. */
  acceptLayer(set: MusicSet, layer: MusicLayer, pcm: Float32Array): void {
    this.layerPending.delete(`${set}/${layer}`);
    if (pcm.length > 0) this.layerBuffers.set(`${set}/${layer}`, pcm);
    else this.layerEmpty.add(`${set}/${layer}`);
  }

  get currentSet(): MusicSet | null {
    return this.current?.set ?? null;
  }

  get pendingSet(): MusicSet | null {
    return this.wanted;
  }

  get liveSources(): number {
    let n = this.current?.sources.length ?? 0;
    for (const p of this.retiring) n += p.sources.length;
    return n;
  }

  get residentBytes(): number {
    let b = 0;
    for (const p of this.pads.values()) b += p.length * 4;
    for (const l of this.layerBuffers.values()) b += l.length * 4;
    return b;
  }

  /** Requests a set; it starts on the next bar boundary once its pad is rendered. */
  setSet(set: MusicSet): void {
    if (this.heldFrom !== null) {
      this.heldFrom = set; // restored when the hold ends
      return;
    }
    this.requestSet(set);
  }

  /** Requisitions Desk or Ops Console open: the hold music takes over, then the previous set returns. */
  setHold(on: boolean): void {
    if (on && this.heldFrom === null) {
      this.heldFrom = this.wanted ?? this.current?.set ?? "menu";
      this.requestSet("hold");
    } else if (!on && this.heldFrom !== null) {
      const back = this.heldFrom;
      this.heldFrom = null;
      this.requestSet(back);
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.current !== null) this.current.out.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.2);
  }

  /** Cleaning is happening now (stroke contact): raises the pulse layer. */
  noteActivity(nowS: number): void {
    this.activeUntilS = nowS + PULSE_IDLE_S;
  }

  /** Melody layer on (a milestone was reached) or off; it enters on the next 4-bar boundary. */
  setMelody(on: boolean): void {
    if (on === this.melodyOn) return;
    this.melodyOn = on;
    const cur = this.current;
    if (cur?.melodyGain == null) return;
    const bar = BAR_S[cur.set];
    const t = this.ctx.currentTime;
    const grid = bar * 4;
    const at = cur.startTime + Math.ceil((t - cur.startTime) / grid) * grid;
    const g = cur.melodyGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(on ? 0 : 1, Math.max(t, at - 0.001));
    g.linearRampToValueAtTime(on ? 1 : 0, Math.max(t, at) + bar);
  }

  /** Called a few times per second from the module's update; does the amortised rendering and layer gains. */
  tick(nowS: number): void {
    this.renderSlice();
    if (this.wanted !== null && this.padReady(this.wanted) && this.layersReady(this.wanted)) {
      const set = this.wanted;
      this.wanted = null;
      this.begin(set);
    }
    const cur = this.current;
    if (cur?.pulseGain != null) {
      const target = nowS < this.activeUntilS ? 1 : 0;
      if (target !== this.pulseTarget) {
        this.pulseTarget = target;
        cur.pulseGain.gain.setTargetAtTime(target, this.ctx.currentTime, target === 1 ? 2.4 : 1.6);
      }
    }
    const now = this.ctx.currentTime;
    for (let i = this.retiring.length - 1; i >= 0; i--) {
      const old = this.retiring[i];
      if (old !== undefined && now >= old.endAt) {
        this.teardown(old);
        this.retiring.splice(i, 1);
      }
    }
  }

  dispose(): void {
    if (this.current !== null) this.teardown(this.current);
    for (const r of this.retiring) this.teardown(r);
    this.current = null;
    this.retiring.length = 0;
    this.pads.clear();
    this.layerBuffers.clear();
  }

  // ---- internals ----

  private requestSet(set: MusicSet): void {
    if (this.current?.set === set && this.wanted === null) return;
    this.wanted = set;
    if (!this.pads.has(set)) {
      this.pads.set(set, new Float32Array(PAD_SAMPLES));
      this.padProgress.set(set, 0);
    }
  }

  private padReady(set: MusicSet): boolean {
    return (this.padProgress.get(set) ?? 0) >= PAD_SAMPLES;
  }

  private renderSlice(): void {
    // Render the wanted set first, then any other set that was started. No allocation per call.
    if (this.wanted !== null && this.renderSetSlice(this.wanted)) return;
    for (let i = 0; i < PAD_SET_LIST.length; i++) {
      const set = PAD_SET_LIST[i];
      if (set !== undefined && set !== this.wanted && this.renderSetSlice(set)) return;
    }
  }

  private renderSetSlice(set: MusicSet): boolean {
    const done = this.padProgress.get(set) ?? 0;
    if (done >= PAD_SAMPLES) return false;
    const pad = this.pads.get(set);
    if (pad === undefined) return false;
    const to = Math.min(PAD_SAMPLES, done + PAD_SLICE);
    renderPadRange(set, pad, done, to);
    this.padProgress.set(set, to);
    if (to >= PAD_SAMPLES) finishPad(pad);
    return true;
  }

  /**
   * True once the pulse and melody layers of a set are cached. With a worker they are requested and arrive
   * asynchronously; without one a single layer is rendered per call so no tick pays for both.
   */
  private layersReady(set: MusicSet): boolean {
    if (timingOf(set) === null) return true;
    let ready = true;
    for (const which of LAYERS) {
      const key = `${set}/${which}`;
      if (this.layerBuffers.has(key) || this.layerEmpty.has(key)) continue;
      ready = false;
      if (this.requestLayer !== null) {
        if (!this.layerPending.has(key)) {
          if (this.requestLayer(set, which)) this.layerPending.add(key);
          else this.layer(set, which); // worker gone: render here
        }
      } else {
        this.layer(set, which);
        return false; // one layer per tick
      }
    }
    return ready;
  }

  private layer(set: MusicSet, which: MusicLayer): Float32Array | null {
    const key = `${set}/${which}`;
    const hit = this.layerBuffers.get(key);
    if (hit !== undefined) return hit;
    const made = renderLayer(set, which);
    if (made !== null) this.layerBuffers.set(key, made);
    return made;
  }

  private begin(set: MusicSet): void {
    const t = this.ctx.currentTime;
    const prev = this.current;
    let startTime = t + 0.05;
    if (prev !== null) {
      const bar = BAR_S[prev.set];
      startTime = Math.max(t + 0.05, prev.startTime + Math.ceil((t - prev.startTime) / bar) * bar);
    }
    const out = this.ctx.createGain();
    out.gain.value = 0;
    out.connect(this.dest);
    const sources: ASource[] = [];
    const addLoop = (pcm: Float32Array, into: AGain): void => {
      const buf = this.ctx.createBuffer(1, pcm.length, MUSIC_RATE);
      buf.copyToChannel(pcm, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = buf.duration;
      src.connect(into);
      src.start(startTime);
      sources.push(src);
    };
    const pad = this.pads.get(set);
    if (pad !== undefined) addLoop(pad, out);

    let pulseGain: AGain | null = null;
    let melodyGain: AGain | null = null;
    if (timingOf(set) !== null) {
      const pulse = this.layer(set, "pulse");
      const melody = this.layer(set, "melody");
      if (pulse !== null) {
        pulseGain = this.ctx.createGain();
        pulseGain.gain.value = 0;
        pulseGain.connect(out);
        addLoop(pulse, pulseGain);
      }
      if (melody !== null) {
        melodyGain = this.ctx.createGain();
        melodyGain.gain.value = this.melodyOn ? 1 : 0;
        melodyGain.connect(out);
        addLoop(melody, melodyGain);
      }
    }
    // Equal-ish crossfade: new set fades in from its start time, old one fades out over the same span.
    out.gain.setValueAtTime(0, startTime);
    out.gain.linearRampToValueAtTime(this.enabled ? 1 : 0, startTime + (prev === null ? 2 : CROSSFADE_S));
    this.pulseTarget = 0;
    if (prev !== null) {
      prev.out.gain.cancelScheduledValues(startTime);
      prev.out.gain.setValueAtTime(prev.out.gain.value, startTime);
      prev.out.gain.linearRampToValueAtTime(0, startTime + CROSSFADE_S);
      prev.endAt = startTime + OLD_SET_LINGER_S;
      this.retiring.push(prev);
    }
    this.current = { set, startTime, out, pulseGain, melodyGain, sources, endAt: Infinity };
  }

  private teardown(p: Playing): void {
    for (const s of p.sources) {
      s.stop();
      s.disconnect();
    }
    p.pulseGain?.disconnect();
    p.melodyGain?.disconnect();
    p.out.disconnect();
  }
}
