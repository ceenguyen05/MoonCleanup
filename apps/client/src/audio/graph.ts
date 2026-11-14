// The Web Audio graph (audio-direction §5.1 and §1.1).
//
//   voice gain -> [panner] -> channel input -> (channel filter) -> bus gain -> duck gain -> master -> mono sum -> limiter -> out
//
// Buses are the ten of shared/audio/cues.ts; default levels come from AUDIO_BUS_DEFAULT_DB and the player's sliders
// scale them. The channel filters implement the hearing channels: ground conduction runs through the helmet-muffle
// low-pass and an air gate that silences it about 150 ms after the player leaves the ground; contact has a high shelf
// cut; suit relay and radio are band-limited. Voice gains and panners are pooled; nothing is created after
// construction except buffer sources, which the Web Audio API requires per play.

import {
  AUDIO_BUSES,
  AUDIO_BUS_DEFAULT_DB,
  AUDIO_CHANNEL_MAX_DISTANCE_M,
  type AudioBus,
  type AudioChannel,
  type UiSettingsState,
} from "@moon-cleanup/shared";
import type { ACompressor, AContext, AFilter, AGain, AMonoSum, APanner } from "./webaudio-types";

export type VolumeSettings = UiSettingsState["volume"];

/** Which player slider scales a bus. */
export const BUS_SLIDER: Readonly<Record<AudioBus, keyof VolumeSettings>> = {
  master: "master",
  voice: "voice",
  ui: "interface",
  tools: "effects",
  vehicles: "effects",
  world: "effects",
  robots: "effects",
  foley: "effects",
  ambience: "ambience",
  music: "music",
};

export const GROUND_MUFFLE_HZ = 8000;
export const PANEL_MUFFLE_HZ = 3000;
/** Time constant of the air gate: about 150 ms (three constants) to inaudible. */
export const AIR_GATE_TC_S = 0.05;
export const REF_DISTANCE_M = 2;

export function dbToLin(db: number): number {
  return Math.pow(10, db / 20);
}

/** Inverse-distance rolloff with reference 2 m and a hard cut at `maxM` (null = no distance limit). */
export function distanceGain(distanceM: number, maxM: number | null): number {
  if (maxM !== null && distanceM > maxM) return 0;
  const d = distanceM < REF_DISTANCE_M ? REF_DISTANCE_M : distanceM;
  const g = REF_DISTANCE_M / d;
  // Fade the last 15 percent of the range so a source never pops out at the hard cap.
  if (maxM !== null && distanceM > maxM * 0.85) return g * Math.max(0, (maxM - distanceM) / (maxM * 0.15));
  return g;
}

export interface VoiceNodes {
  readonly gain: AGain;
  /** Pooled for a few spatial voices only; null otherwise. */
  panner: APanner | null;
  inUse: boolean;
}

export class AudioGraph {
  readonly master: AGain;
  readonly limiter: ACompressor;
  private readonly monoSum: AMonoSum & AGain;
  private readonly busGain = new Map<AudioBus, AGain>();
  private readonly duckGain = new Map<AudioBus, AGain>();
  private readonly channelInputs = new Map<string, AGain>();
  private readonly groundInputs: AGain[] = [];
  private readonly groundFilters: AFilter[] = [];
  private readonly voicePool: VoiceNodes[] = [];
  private readonly pannerPool: APanner[] = [];
  private volume: VolumeSettings = {
    master: 1,
    effects: 1,
    music: 1,
    ambience: 1,
    interface: 1,
    voice: 1,
    breathing: 1,
  };
  private airborne = false;
  private mono = false;
  private muffleHz = GROUND_MUFFLE_HZ;
  /** Live nodes created by the graph (budget AUDIO_ACTIVE_NODES_MAX counts sources too; see tests). */
  nodeCount = 0;

  constructor(
    private readonly ctx: AContext,
    voiceCap: number,
  ) {
    this.master = this.gain(1);
    this.monoSum = this.gain(1) as AMonoSum & AGain;
    this.limiter = ctx.createDynamicsCompressor();
    this.nodeCount++;
    // Limiter: fast, hard compressor; the buffers are normalised to -3 dBFS so it only catches stacked peaks.
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.12;
    this.master.connect(this.monoSum);
    this.monoSum.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    for (const bus of AUDIO_BUSES) {
      if (bus === "master") continue;
      const g = this.gain(dbToLin(AUDIO_BUS_DEFAULT_DB[bus]));
      const d = this.gain(1);
      g.connect(d);
      d.connect(this.master);
      this.busGain.set(bus, g);
      this.duckGain.set(bus, d);
    }
    for (let i = 0; i < voiceCap + 4; i++) this.voicePool.push({ gain: this.gain(1), panner: null, inUse: false });
    for (let i = 0; i < 12; i++) {
      this.nodeCount++;
      this.pannerPool.push(ctx.createStereoPanner());
    }
  }

  private gain(v: number): AGain {
    const g = this.ctx.createGain();
    g.gain.value = v;
    this.nodeCount++;
    return g;
  }

  /** Channel input of a (bus, channel) pair, created on first use; later calls return the same node. */
  input(bus: AudioBus, channel: AudioChannel): AGain {
    const key = `${bus}/${channel}`;
    const existing = this.channelInputs.get(key);
    if (existing !== undefined) return existing;
    const busNode = this.busGain.get(bus);
    if (busNode === undefined) throw new Error(`audio: unknown bus ${bus}`);
    const entry = this.gain(1);
    let filter: AFilter | null = null;
    const make = (type: string, hz: number, q: number, gainDb: number): AFilter => {
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      f.gain.value = gainDb;
      this.nodeCount++;
      return f;
    };
    switch (channel) {
      case "contact":
        filter = make("highshelf", 5000, 0.707, -6);
        break;
      case "ground":
        filter = make("lowpass", this.muffleHz, 0.707, 0);
        this.groundInputs.push(entry);
        this.groundFilters.push(filter);
        if (this.airborne) entry.gain.value = 0;
        break;
      case "relay":
        filter = make("bandpass", 1300, 0.45, 0);
        break;
      case "radio":
        filter = make("bandpass", 1000, 0.55, 0);
        break;
      default:
        break;
    }
    if (filter === null) {
      entry.connect(busNode);
    } else {
      entry.connect(filter);
      filter.connect(busNode);
    }
    this.channelInputs.set(key, entry);
    return entry;
  }

  // ---- Voices ----

  /** Takes a pooled voice gain (and a panner when `wantPan`) wired to `dest`. Null when the pool is exhausted. */
  takeVoice(dest: AGain, wantPan: boolean): VoiceNodes | null {
    for (const v of this.voicePool) {
      if (v.inUse) continue;
      v.inUse = true;
      if (wantPan) v.panner = this.pannerPool.pop() ?? null;
      if (v.panner !== null) {
        v.gain.connect(v.panner);
        v.panner.connect(dest);
      } else {
        v.gain.connect(dest);
      }
      return v;
    }
    return null;
  }

  returnVoice(v: VoiceNodes): void {
    if (!v.inUse) return;
    v.gain.disconnect();
    v.gain.gain.cancelScheduledValues(0);
    v.gain.gain.value = 1;
    if (v.panner !== null) {
      v.panner.disconnect();
      this.pannerPool.push(v.panner);
      v.panner = null;
    }
    v.inUse = false;
  }

  // ---- State-driven processing ----

  /** Jumping mutes ground conduction in about 150 ms; landing brings it back (audio-direction §1.2). */
  setAirborne(airborne: boolean): void {
    if (airborne === this.airborne) return;
    this.airborne = airborne;
    const t = this.ctx.currentTime;
    for (const g of this.groundInputs) g.gain.setTargetAtTime(airborne ? 0 : 1, t, airborne ? AIR_GATE_TC_S : 0.01);
  }

  get isAirborne(): boolean {
    return this.airborne;
  }

  /** Helmet muffle: low-pass cutoff of ground conduction (a panel-open lowers it so the hold music leads). */
  setMuffleHz(hz: number): void {
    if (hz === this.muffleHz) return;
    this.muffleHz = hz;
    const t = this.ctx.currentTime;
    for (const f of this.groundFilters) f.frequency.setTargetAtTime(hz, t, 0.08);
  }

  get currentMuffleHz(): number {
    return this.muffleHz;
  }

  /** Bus ducking in dB (<= 0), eased with separate attack and release time constants. */
  setDuck(bus: AudioBus, db: number, attackS: number, releaseS: number): void {
    const node = this.duckGain.get(bus);
    if (node === undefined) return;
    const target = dbToLin(db);
    node.gain.setTargetAtTime(target, this.ctx.currentTime, target < node.gain.value ? attackS : releaseS);
  }

  setVolumes(v: VolumeSettings): void {
    this.volume = v;
    const t = this.ctx.currentTime;
    for (const bus of AUDIO_BUSES) {
      if (bus === "master") continue;
      const node = this.busGain.get(bus);
      if (node === undefined) continue;
      node.gain.setTargetAtTime(dbToLin(AUDIO_BUS_DEFAULT_DB[bus]) * v[BUS_SLIDER[bus]], t, 0.03);
    }
    this.master.gain.setTargetAtTime(v.master, t, 0.03);
  }

  get breathingVolume(): number {
    return this.volume.breathing;
  }

  setMono(mono: boolean): void {
    if (mono === this.mono) return;
    this.mono = mono;
    this.monoSum.channelCount = mono ? 1 : 2;
    this.monoSum.channelCountMode = mono ? "explicit" : "max";
  }

  /** Fades the master for suspend and resume without a pop. */
  fadeMaster(toLinear: number, seconds: number): void {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(toLinear * this.volume.master, t, seconds / 3);
  }

  /** Hearing range of a cue in metres: the cue override, else the channel default; `null` = unlimited. */
  static rangeOf(channel: AudioChannel, override: number | null): number | null {
    return override ?? AUDIO_CHANNEL_MAX_DISTANCE_M[channel];
  }

  dispose(): void {
    this.master.disconnect();
    this.monoSum.disconnect();
    this.limiter.disconnect();
    for (const g of this.busGain.values()) g.disconnect();
    for (const g of this.duckGain.values()) g.disconnect();
    for (const g of this.channelInputs.values()) g.disconnect();
    for (const v of this.voicePool) v.gain.disconnect();
    for (const p of this.pannerPool) p.disconnect();
    this.channelInputs.clear();
  }
}
