// Lazy buffer cache. Each (cue, variant) is rendered once from its procedural recipe, copied into an AudioBuffer and
// kept. Rendering is deterministic (seeded per cue and variant). `prewarm` renders the not-yet-cached buffers one per
// scheduler tick so the cost is spread out instead of landing on the first play.

import { AUDIO_CUE_IDS, type AudioCueId } from "@moon-cleanup/shared";
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

export class BufferStore {
  private readonly cache = new Map<string, BufferEntry>();
  private bytes = 0;
  private cursor = 0;
  private variantCursor = 0;

  constructor(private readonly ctx: AContext) {}

  get residentBytes(): number {
    return this.bytes;
  }

  get size(): number {
    return this.cache.size;
  }

  has(id: AudioCueId, variant: number): boolean {
    return this.cache.has(`${id}#${variant}`);
  }

  /** Returns the buffer of a cue variant, rendering it now when it is not cached yet. */
  get(id: AudioCueId, variant: number): BufferEntry | null {
    const key = `${id}#${variant}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    if (MUSIC_BED_CUES.has(id)) return null;
    const recipe = CUE_RECIPES[id];
    const v = variant < recipe.variants ? variant : 0;
    const pcm = recipe.render(v, mulberry32(hashString(`${id}#${v}`)));
    const buffer = this.ctx.createBuffer(1, pcm.length, recipe.sampleRate);
    buffer.copyToChannel(pcm, 0);
    const entry: BufferEntry = { buffer, loop: recipe.loop };
    this.cache.set(key, entry);
    this.bytes += pcm.length * 4;
    return entry;
  }

  /** Renders the next uncached buffer in PREWARM_ORDER. Returns false when everything is cached. */
  prewarmStep(): boolean {
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
