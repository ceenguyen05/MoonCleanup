// Cue player: turns a cue id and its typed parameters into a Web Audio voice. It owns the voice table (preallocated),
// applies the voice budget through VoiceManager, routes by bus and hearing channel through AudioGraph, and applies
// spatial gain and pan. Loops return a handle that later updates adjust (smoothed) and stop with a short fade.

import { AUDIO_CUE_DEFS, type AudioCueId } from "@moon-cleanup/shared";
import { BufferStore } from "./buffer-store";
import { controlsFor, type Controls, type LooseParams } from "./cue-params";
import { AudioGraph, distanceGain, type VoiceNodes } from "./graph";
import { CUE_RECIPES, variantOf, type VariantParams } from "./recipes";
import { VoiceManager, type VoiceSlot } from "./voice-manager";
import type { AContext, ASource } from "./webaudio-types";

export interface PlayOptions {
  /** Extra linear gain (default 1). */
  readonly gain?: number;
  /** Stereo position -1 (left) .. 1 (right). Omit for centred (no panner is used). */
  readonly pan?: number;
  /** Distance of the source from the listener in metres; applies inverse rolloff and the range cut. */
  readonly distanceM?: number;
  /** Seconds from now to start (sample-accurate scheduling, for example the Railshot sequence). */
  readonly delayS?: number;
  /** The sound belongs to another player or a machine: demotes the steal priority and uses the suit-relay channel. */
  readonly other?: boolean;
}

export type CuePlayParams = LooseParams & VariantParams;

interface PlayerVoice {
  slot: VoiceSlot | null;
  nodes: VoiceNodes | null;
  source: ASource | null;
  gen: number;
  /** True from start until the source has ended (a fading voice is busy but no longer holds a budget slot). */
  busy: boolean;
  readonly onEnded: () => void;
}

export interface LoopHandle {
  readonly index: number;
  readonly gen: number;
}

const STEAL_FADE_S = 0.03;
const LOOP_SMOOTH_TC_S = 0.05;
const OTHERS_TOOL_RANK = 7;
const OTHERS_VEHICLE_RANK = 6;

export class CuePlayer {
  private readonly voices: PlayerVoice[] = [];
  private readonly controls: Controls = { rate: 1, gain: 1 };
  /** Called with the cue id of every cue that actually starts (caption hook, debug log). */
  onStart: ((id: AudioCueId) => void) | null = null;

  constructor(
    private readonly ctx: AContext,
    private readonly graph: AudioGraph,
    private readonly store: BufferStore,
    private readonly manager: VoiceManager,
    private readonly nowMs: () => number,
    slots = 64,
  ) {
    for (let i = 0; i < slots; i++) {
      const voice: PlayerVoice = {
        slot: null,
        nodes: null,
        source: null,
        gen: 0,
        busy: false,
        onEnded: () => this.finish(i),
      };
      this.voices.push(voice);
    }
  }

  /** Plays a one-shot (or starts a loop without a handle). Returns false when the budget, a cooldown or range refuses it. */
  play(id: AudioCueId, params: CuePlayParams, opts?: PlayOptions): boolean {
    return this.start(id, params, opts) !== null;
  }

  /** Starts a loop (or any cue) and returns a handle for `update` and `stop`; null when refused. */
  startLoop(id: AudioCueId, params: CuePlayParams, opts?: PlayOptions): LoopHandle | null {
    const index = this.start(id, params, opts);
    if (index === null) return null;
    return { index, gen: this.voices[index]?.gen ?? 0 };
  }

  /** True while the handle's voice is still the one it was created for (not stolen or stopped). */
  isAlive(h: LoopHandle): boolean {
    const v = this.voices[h.index];
    return v !== undefined && v.gen === h.gen && v.slot !== null;
  }

  /** Smoothly updates rate and gain of a running loop from new parameters. */
  update(h: LoopHandle, id: AudioCueId, params: CuePlayParams, opts?: PlayOptions): void {
    if (!this.isAlive(h)) return;
    const v = this.voices[h.index];
    if (v === undefined || v.source === null || v.nodes === null) return;
    controlsFor(id, params, this.controls);
    const dist = this.distanceFactor(id, opts);
    const t = this.ctx.currentTime;
    v.source.playbackRate.setTargetAtTime(this.controls.rate, t, LOOP_SMOOTH_TC_S);
    v.nodes.gain.gain.setTargetAtTime(
      CUE_RECIPES[id].level * this.controls.gain * (opts?.gain ?? 1) * dist,
      t,
      LOOP_SMOOTH_TC_S,
    );
  }

  /** Fades a voice out and frees it. */
  stop(h: LoopHandle, fadeS = 0.08): void {
    if (!this.isAlive(h)) return;
    this.fadeOut(h.index, fadeS);
  }

  stopAll(fadeS = 0.05): void {
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v?.slot !== null && v !== undefined) this.fadeOut(i, fadeS);
    }
  }

  get activeVoices(): number {
    return this.manager.activeCount;
  }

  // ---- internals ----

  private distanceFactor(id: AudioCueId, opts: PlayOptions | undefined): number {
    if (opts?.distanceM === undefined) return 1;
    const def = AUDIO_CUE_DEFS[id];
    return distanceGain(opts.distanceM, AudioGraph.rangeOf(def.channel, def.maxDistanceM));
  }

  private start(id: AudioCueId, params: CuePlayParams, opts: PlayOptions | undefined): number | null {
    const def = AUDIO_CUE_DEFS[id];
    const dist = this.distanceFactor(id, opts);
    if (dist <= 0) return null;
    const entry = this.store.get(id, variantOf(id, params));
    if (entry === null) return null;

    let rank: number = def.priority;
    let channel = def.channel;
    if (opts?.other === true) {
      if (rank === 3) rank = OTHERS_TOOL_RANK;
      else if (rank === 4) rank = OTHERS_VEHICLE_RANK;
      if (channel === "contact") channel = "relay";
    }

    // Reserve the table index first so the manager token is the voice index.
    let index = -1;
    for (let i = 0; i < this.voices.length; i++) {
      if (this.voices[i]?.busy === false) {
        index = i;
        break;
      }
    }
    if (index < 0) return null;
    const voice = this.voices[index];
    if (voice === undefined) return null;

    const now = this.nowMs();
    const got = this.manager.acquire(id, rank, now, index);
    if (!got.ok) return null;
    if (got.steal !== null) this.fadeOut(got.stealToken, STEAL_FADE_S, false);

    const dest = this.graph.input(def.bus, channel);
    const pan = opts?.pan;
    const nodes = this.graph.takeVoice(dest, pan !== undefined && pan !== 0);
    if (nodes === null) {
      this.manager.release(got.slot);
      return null;
    }
    controlsFor(id, params, this.controls);
    const source = this.ctx.createBufferSource();
    source.buffer = entry.buffer;
    source.loop = entry.loop;
    if (entry.loop) {
      source.loopStart = 0;
      source.loopEnd = entry.buffer.duration;
    }
    source.playbackRate.value = this.controls.rate;
    nodes.gain.gain.value = CUE_RECIPES[id].level * this.controls.gain * (opts?.gain ?? 1) * dist;
    if (nodes.panner !== null && pan !== undefined) nodes.panner.pan.value = pan < -1 ? -1 : pan > 1 ? 1 : pan;
    source.connect(nodes.gain);
    source.onended = voice.onEnded;

    voice.gen++;
    voice.busy = true;
    voice.slot = got.slot;
    voice.nodes = nodes;
    voice.source = source;
    source.start(this.ctx.currentTime + (opts?.delayS ?? 0));
    this.onStart?.(id);
    return index;
  }

  /** `releaseSlot` is false for a stolen voice: the manager already freed (and may have reused) its slot. */
  private fadeOut(index: number, fadeS: number, releaseSlot = true): void {
    const v = this.voices[index];
    if (v === undefined || v.slot === null) return;
    const t = this.ctx.currentTime;
    if (v.nodes !== null) {
      v.nodes.gain.gain.cancelScheduledValues(t);
      v.nodes.gain.gain.setTargetAtTime(0, t, fadeS / 3);
    }
    // Free the budget slot now (the voice is inaudible within fadeS); node cleanup happens when the source ends.
    if (releaseSlot) this.manager.release(v.slot);
    v.slot = null;
    v.gen++;
    if (v.source !== null) v.source.stop(t + fadeS);
  }

  private finish(index: number): void {
    const v = this.voices[index];
    if (v === undefined) return;
    if (v.slot !== null) this.manager.release(v.slot);
    if (v.source !== null) {
      v.source.onended = null;
      v.source.disconnect();
    }
    if (v.nodes !== null) this.graph.returnVoice(v.nodes);
    v.slot = null;
    v.nodes = null;
    v.source = null;
    v.busy = false;
  }
}
