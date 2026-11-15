// Stroke logs (WDS sections 4.3 and 6): one ring of the most recent strokes per touched plot, 16 bytes per stroke,
// pooled in one slab. Used only to rebuild client tiles (ledger + log snapshots on join, restore and resync); it never
// feeds the ledger or the economy. Rings: STROKE_LOG_RING strokes per plot; process-wide RAM cap (default 16 MB =
// 4,096 full rings), the least recently written ring is evicted when the cap is reached.
//
// Packed record (4 x int32):
//   w0 = anchor (18) | toolCode << 18 (6) | actorSlot << 24 (6)
//   w1 = startU (int16) | startV << 16          w2 = endU (int16) | endV << 16
//   w3 = widthCm (10) | depth16 << 10 (8)
// Tick and inputSeq are not kept: a tile rebuild does not need them.
//
// Environment-agnostic. No allocation per stroke: the slab grows by doubling up to the cap (or once, through
// `reserve`), then rings are reused.

import { STROKE_LOG_RING } from "@moon-cleanup/shared";

/** int32 words per logged stroke. */
export const STROKE_LOG_WORDS = 4;

/** Bytes per logged stroke. */
export const STROKE_LOG_RECORD_BYTES = STROKE_LOG_WORDS * 4;

/** Default RAM cap of one log store (WDS section 4.3: 16 MB). */
export const STROKE_LOG_DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

/** One decoded log record (reused by the caller). */
export class LoggedStroke {
  anchor = 0;
  startUMm = 0;
  startVMm = 0;
  endUMm = 0;
  endVMm = 0;
  widthCm = 0;
  depth16 = 0;
  toolCode = 0;
  actorSlot = 0;
}

export class StrokeLogStore {
  /** Strokes per ring. */
  readonly ring: number;
  /** Largest number of rings the store may hold. */
  readonly maxSlots: number;
  /** Log slot per plot, -1 = none. Read-only for callers. */
  readonly slotOf: Int32Array;
  /** Rings evicted because the RAM cap was reached. */
  evictions = 0;

  private slab = new Int32Array(0);
  private cap = 0;
  private high = 0;
  private plotOfSlot = new Int32Array(0);
  /** Strokes ever written to the slot (ring index = written mod ring). */
  private written = new Float64Array(0);
  private lastWrite = new Float64Array(0);
  private free = new Int32Array(0);
  private freeTop = 0;
  private clock = 0;

  constructor(plotCount: number, maxBytes: number = STROKE_LOG_DEFAULT_MAX_BYTES, ring: number = STROKE_LOG_RING) {
    if (!(ring >= 1 && (ring | 0) === ring)) throw new RangeError(`stroke log ring ${ring}`);
    this.ring = ring;
    this.maxSlots = Math.max(1, Math.floor(maxBytes / (ring * STROKE_LOG_RECORD_BYTES)));
    this.slotOf = new Int32Array(plotCount).fill(-1);
    this.grow(Math.min(16, this.maxSlots));
  }

  /**
   * Makes room for `slots` rings (at most `maxSlots`) without further growth. The slab is allocated in one piece and
   * only the rings already handed out are copied, so reserving before the rings are written costs the allocation alone;
   * growing by doubling under load copies megabytes (measured: 2.5 to 5.7 ms at 8 and 16 MB).
   */
  reserve(slots: number): void {
    const want = slots < this.maxSlots ? slots : this.maxSlots;
    if (want > this.cap) this.grow(want);
  }

  /** Rings handed out at least once since the last `clear`: what growing the slab has to copy. */
  get ringsTouched(): number {
    return this.high;
  }

  private grow(cap: number): void {
    const slab = new Int32Array(cap * this.ring * STROKE_LOG_WORDS);
    // Rings behind `high` were never handed out: nothing to keep.
    slab.set(this.slab.subarray(0, this.high * this.ring * STROKE_LOG_WORDS));
    this.slab = slab;
    const plots = new Int32Array(cap).fill(-1);
    plots.set(this.plotOfSlot);
    this.plotOfSlot = plots;
    const w = new Float64Array(cap);
    w.set(this.written);
    this.written = w;
    const lw = new Float64Array(cap);
    lw.set(this.lastWrite);
    this.lastWrite = lw;
    const fr = new Int32Array(cap);
    fr.set(this.free);
    this.free = fr;
    this.cap = cap;
  }

  private take(plot: number): number {
    let slot: number;
    if (this.freeTop > 0) slot = this.free[--this.freeTop]!;
    else if (this.high < this.cap) slot = this.high++;
    else if (this.cap < this.maxSlots) {
      this.grow(Math.min(this.maxSlots, this.cap * 2));
      slot = this.high++;
    } else {
      // Cap reached: evict the least recently written ring (rare; linear scan over at most maxSlots entries).
      slot = 0;
      for (let s = 1; s < this.high; s++) if (this.lastWrite[s]! < this.lastWrite[slot]!) slot = s;
      const old = this.plotOfSlot[slot]!;
      if (old >= 0) this.slotOf[old] = -1;
      this.evictions++;
    }
    this.plotOfSlot[slot] = plot;
    this.slotOf[plot] = slot;
    this.written[slot] = 0;
    return slot;
  }

  /** Frees the ring of `plot` (Polished, reset, or dropped from an interest set). */
  drop(plot: number): void {
    const slot = this.slotOf[plot]!;
    if (slot < 0) return;
    this.slotOf[plot] = -1;
    this.plotOfSlot[slot] = -1;
    this.free[this.freeTop++] = slot;
  }

  /** Frees every ring. */
  clear(): void {
    for (let s = 0; s < this.high; s++) {
      const plot = this.plotOfSlot[s]!;
      if (plot >= 0) this.slotOf[plot] = -1;
      this.plotOfSlot[s] = -1;
    }
    this.high = 0;
    this.freeTop = 0;
  }

  /** Appends a stroke to the ring of `plot` (all arguments are integers in their wire ranges). */
  push(
    plot: number,
    anchor: number,
    sU: number,
    sV: number,
    eU: number,
    eV: number,
    widthCm: number,
    depth16: number,
    toolCode: number,
    actorSlot: number,
  ): void {
    let slot = this.slotOf[plot]!;
    if (slot < 0) slot = this.take(plot);
    const n = this.written[slot]!;
    const o = (slot * this.ring + (n % this.ring)) * STROKE_LOG_WORDS;
    const s = this.slab;
    s[o] = (anchor & 0x3ffff) | ((toolCode & 0x3f) << 18) | ((actorSlot & 0x3f) << 24);
    s[o + 1] = (sU & 0xffff) | (sV << 16);
    s[o + 2] = (eU & 0xffff) | (eV << 16);
    s[o + 3] = (widthCm & 0x3ff) | ((depth16 & 0xff) << 10);
    this.written[slot] = n + 1;
    this.lastWrite[slot] = ++this.clock;
  }

  /** Keeps only the `keep` most recent strokes of `plot` (WDS section 4.3: idle plots are trimmed to 64). */
  trim(plot: number, keep: number): void {
    const slot = this.slotOf[plot]!;
    if (slot < 0) return;
    const have = this.count(plot);
    if (keep >= have) return;
    if (keep <= 0) {
      this.drop(plot);
      return;
    }
    // Move the kept records to the start of the ring, oldest first (k-th kept = (have - keep + k)-th held).
    const s = this.slab;
    const n = this.written[slot]!;
    const first = n < this.ring ? 0 : n % this.ring;
    const base = slot * this.ring;
    // Put the oldest record at index 0 first; then every source index is >= its target index, so an ascending
    // record-by-record copy never overwrites a record it still has to read.
    if (first !== 0) this.normalise(slot, first);
    const from = have - keep;
    for (let k = 0; k < keep; k++) {
      const src = (base + from + k) * STROKE_LOG_WORDS;
      const dst = (base + k) * STROKE_LOG_WORDS;
      s[dst] = s[src]!;
      s[dst + 1] = s[src + 1]!;
      s[dst + 2] = s[src + 2]!;
      s[dst + 3] = s[src + 3]!;
    }
    this.written[slot] = keep;
  }

  /** Rotates a full ring so its oldest record sits at index 0 (three reversals, no allocation). */
  private normalise(slot: number, first: number): void {
    const base = slot * this.ring;
    this.reverse(base, base + first - 1);
    this.reverse(base + first, base + this.ring - 1);
    this.reverse(base, base + this.ring - 1);
    this.written[slot] = this.ring;
  }

  private reverse(lo: number, hi: number): void {
    const s = this.slab;
    while (lo < hi) {
      const a = lo * STROKE_LOG_WORDS;
      const b = hi * STROKE_LOG_WORDS;
      for (let w = 0; w < STROKE_LOG_WORDS; w++) {
        const t = s[a + w]!;
        s[a + w] = s[b + w]!;
        s[b + w] = t;
      }
      lo++;
      hi--;
    }
  }

  /**
   * Changes whenever the ring of `plot` is written (a store-wide write counter); 0 = no ring. Cache key for tile
   * rebuilds, and the way a sliced rebuild notices that a log changed between two slices.
   */
  stamp(plot: number): number {
    const slot = this.slotOf[plot]!;
    return slot < 0 ? 0 : this.lastWrite[slot]!;
  }

  /** Strokes currently held for `plot` (0 .. ring). */
  count(plot: number): number {
    const slot = this.slotOf[plot]!;
    if (slot < 0) return 0;
    const n = this.written[slot]!;
    return n < this.ring ? n : this.ring;
  }

  /** Decodes the k-th oldest held stroke of `plot` (0 <= k < count(plot)) into `out`. */
  read(plot: number, k: number, out: LoggedStroke): void {
    const slot = this.slotOf[plot]!;
    const n = this.written[slot]!;
    const first = n < this.ring ? 0 : n % this.ring;
    const o = (slot * this.ring + ((first + k) % this.ring)) * STROKE_LOG_WORDS;
    const s = this.slab;
    const w0 = s[o]!;
    const w1 = s[o + 1]!;
    const w2 = s[o + 2]!;
    const w3 = s[o + 3]!;
    out.anchor = w0 & 0x3ffff;
    out.toolCode = (w0 >>> 18) & 0x3f;
    out.actorSlot = (w0 >>> 24) & 0x3f;
    out.startUMm = (w1 << 16) >> 16;
    out.startVMm = w1 >> 16;
    out.endUMm = (w2 << 16) >> 16;
    out.endVMm = w2 >> 16;
    out.widthCm = w3 & 0x3ff;
    out.depth16 = (w3 >>> 10) & 0xff;
  }

  /** Bytes held by the slab (RAM accounting). */
  bytes(): number {
    return this.slab.byteLength;
  }
}
