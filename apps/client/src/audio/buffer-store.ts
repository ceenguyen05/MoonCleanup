// Lazy buffer cache. Each (cue, variant) is rendered once from its procedural recipe, copied into an AudioBuffer and
// kept. Rendering is deterministic (seeded per cue and variant). `prewarm` renders the not-yet-cached buffers one per
// scheduler tick so the cost is spread out instead of landing on the first play.

import { AUDIO_CUE_IDS, type AudioCueId, type MusicSet } from "@moon-cleanup/shared";
import { hashString, mulberry32 } from "./dsp";
import { CUE_RECIPES } from "./recipes";
import type { ABuffer, AContext } from "./webaudio-types";

export interface BufferEntry {
  readonly buffer: ABuffer;
  readonly loop: boolean;
}

/** Cues the music director renders itself (long, chunked); the store never renders them. */
const MUSIC_BED_CUES: ReadonlySet<AudioCueId> = new Set<AudioCueId>([
  "music.day",
  "music.bridge",
  "music.night",
  "music.menu",
  "music.hold",
]);

/** Order the prewarm renders in: what the first minute of play needs first. */
export const PREWARM_ORDER: readonly AudioCueId[] = [
  "ui.click",
  "ui.hover",
  "ui.toggle",
  "ui.panel_open",
  "ui.panel_close",
  "ambience.suit_bed",
  "tool.sweep",
  "avatar.footstep",
  "cell.fill_hiss",
  "avatar.jump",
  "avatar.land",
  "assay.pour",
  "assay.ka_ching",
  "plot.stamp",
  "ui.lumen_tick",
  "dot.bloop",
  "ui.purchase",
  "ui.reject",
  ...AUDIO_CUE_IDS,
];

/** Renders one cue variant to PCM. Pure and deterministic; runs on the main thread (fallback) or in the render worker. */
export function renderCuePcm(
  id: AudioCueId,
  variant: number,
): { pcm: Float32Array; loop: boolean; sampleRate: number } {
  const recipe = CUE_RECIPES[id];
  const v = variant < recipe.variants ? variant : 0;
  return {
    pcm: recipe.render(v, mulberry32(hashString(`${id}#${v}`))),
    loop: recipe.loop,
    sampleRate: recipe.sampleRate,
  };
}

export type MusicLayerName = "pulse" | "melody";

export type RenderRequest =
  | { readonly kind: "cue"; readonly id: AudioCueId; readonly variant: number }
  | { readonly kind: "layer"; readonly set: MusicSet; readonly layer: MusicLayerName };

export type RenderReply =
  | {
      readonly kind: "cue";
      readonly id: AudioCueId;
      readonly variant: number;
      readonly pcm: Float32Array;
      readonly loop: boolean;
      readonly sampleRate: number;
    }
  | { readonly kind: "layer"; readonly set: MusicSet; readonly layer: MusicLayerName; readonly pcm: Float32Array };

/**
 * Off-thread renderer (browser: a module Worker). `request` is fire-and-forget; replies come back through the callback
 * given to `connect`. `onFailure` fires if the worker dies, after which the store renders on the main thread.
 */
export interface CueRenderRemote {
  connect(onReply: (reply: RenderReply) => void, onFailure: () => void): void;
  request(req: RenderRequest): void;
  dispose(): void;
}

export class BufferStore {
  private readonly cache = new Map<string, BufferEntry>();
  private readonly pending = new Set<string>();
  private remote: CueRenderRemote | null;
  private prewarmQueued = false;
  /** Called after the worker failed and the store went back to main-thread rendering (module restarts prewarm). */
  onFallback: (() => void) | null = null;
  /** Receives music layer PCM rendered by the worker (wired to the MusicDirector). */
  onLayer: ((set: MusicSet, layer: MusicLayerName, pcm: Float32Array) => void) | null = null;
  private bytes = 0;
  private cursor = 0;
  private variantCursor = 0;

  constructor(
    private readonly ctx: AContext,
    remote: CueRenderRemote | null = null,
  ) {
    this.remote = remote;
    remote?.connect(
      (r) => {
        if (r.kind === "cue") this.accept(r.id, r.variant, r.pcm, r.loop, r.sampleRate);
        else this.onLayer?.(r.set, r.layer, r.pcm);
      },
      () => {
        // Worker failed: fall back to main-thread rendering (prewarm continues in slices).
        this.remote?.dispose();
        this.remote = null;
        this.pending.clear();
        this.prewarmQueued = false;
        this.cursor = 0;
        this.variantCursor = 0;
        this.onFallback?.();
      },
    );
  }

  /** True while an off-thread renderer is in use (cache misses return null instead of blocking the frame). */
  get offThread(): boolean {
    return this.remote !== null;
  }

  private accept(id: AudioCueId, variant: number, pcm: Float32Array, loop: boolean, sr: number): void {
    const key = `${id}#${variant}`;
    this.pending.delete(key);
    if (this.cache.has(key)) return;
    const buffer = this.ctx.createBuffer(1, pcm.length, sr);
    buffer.copyToChannel(pcm, 0);
    this.cache.set(key, { buffer, loop });
    this.bytes += pcm.length * 4;
  }

  private readonly keys = new Map<AudioCueId, string[]>();

  /** Interned `${id}#${v}` key: the per-play lookup allocates no string after the first use of a variant. */
  private keyOf(id: AudioCueId, v: number): string {
    let row = this.keys.get(id);
    if (row === undefined) {
      row = [];
      this.keys.set(id, row);
    }
    let k = row[v];
    if (k === undefined) {
      k = `${id}#${v}`;
      row[v] = k;
    }
    return k;
  }

  private canonical(id: AudioCueId, variant: number): number {
    return variant < CUE_RECIPES[id].variants ? variant : 0;
  }

  dispose(): void {
    this.remote?.dispose();
    this.remote = null;
    this.clear();
  }

  get residentBytes(): number {
    return this.bytes;
  }

  get size(): number {
    return this.cache.size;
  }

  has(id: AudioCueId, variant: number): boolean {
    return this.cache.has(this.keyOf(id, this.canonical(id, variant)));
  }

  /**
   * Returns the buffer of a cue variant. On a miss with an off-thread renderer it requests the render and returns null
   * (that one play is skipped, nothing blocks the frame); without one it renders now (tests, no-Worker fallback).
   */
  get(id: AudioCueId, variant: number): BufferEntry | null {
    if (MUSIC_BED_CUES.has(id)) return null;
    const v = this.canonical(id, variant);
    const key = this.keyOf(id, v);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    if (this.remote !== null) {
      this.requestRemote(id, v, key);
      return null;
    }
    const r = renderCuePcm(id, v);
    const buffer = this.ctx.createBuffer(1, r.pcm.length, r.sampleRate);
    buffer.copyToChannel(r.pcm, 0);
    const entry: BufferEntry = { buffer, loop: r.loop };
    this.cache.set(key, entry);
    this.bytes += r.pcm.length * 4;
    return entry;
  }

  /** Asks the worker to render a music layer; false when there is no worker (the director renders it itself). */
  requestLayer(set: MusicSet, layer: MusicLayerName): boolean {
    if (this.remote === null) return false;
    this.remote.request({ kind: "layer", set, layer });
    return true;
  }

  private requestRemote(id: AudioCueId, v: number, key: string): void {
    if (this.pending.has(key)) return;
    this.pending.add(key);
    this.remote?.request({ kind: "cue", id, variant: v });
  }

  /** Renders the next uncached buffer in PREWARM_ORDER. Returns false when everything is cached. */
  prewarmStep(): boolean {
    if (this.remote !== null) {
      // Off-thread: queue every missing buffer once, in PREWARM_ORDER; the worker renders them in order.
      if (!this.prewarmQueued) {
        this.prewarmQueued = true;
        for (const id of PREWARM_ORDER) {
          if (MUSIC_BED_CUES.has(id)) continue;
          const n = CUE_RECIPES[id].variants;
          for (let v = 0; v < n; v++) {
            if (id === "dot.chirp" && (v < 3 || v > 17)) continue;
            const key = `${id}#${v}`;
            if (!this.cache.has(key)) this.requestRemote(id, v, key);
          }
        }
      }
      return false;
    }
    while (this.cursor < PREWARM_ORDER.length) {
      const id = PREWARM_ORDER[this.cursor];
      if (id === undefined || MUSIC_BED_CUES.has(id)) {
        this.cursor++;
        this.variantCursor = 0;
        continue;
      }
      const recipe = CUE_RECIPES[id];
      if (this.variantCursor >= recipe.variants) {
        this.cursor++;
        this.variantCursor = 0;
        continue;
      }
      const variant = this.variantCursor++;
      // dot.chirp has 33 variants; only the common ones (3 to 7 syllables) are prewarmed, the rest render on demand.
      if (id === "dot.chirp" && (variant < 3 || variant > 17)) continue;
      if (!this.has(id, variant)) {
        this.get(id, variant);
        return true;
      }
    }
    return false;
  }

  clear(): void {
    this.cache.clear();
    this.bytes = 0;
  }
}
