// P2 prototype: L4 stroke logs. One ring of the most recent strokes per touched plot, 16 bytes per stroke
// (4 x int32), pooled in one slab. WDS 4.3: <= 256 strokes per plot; process-wide cap (16 MB = 4,096 full rings),
// the least recently written ring is evicted when the cap is reached.
// Packed record: w0 = anchor (18) | toolCode << 18 (6) | actorSlot << 24 (6)
//                w1 = startU (int16) | startV << 16     w2 = endU (int16) | endV << 16
//                w3 = widthCm (10) | depth16 << 10 (8)
// Environment-agnostic. No allocation per stroke (the slab grows by doubling up to the cap).

export const LOG_WORDS = 4;

export class StrokeLog {
  readonly ring: number;
  readonly maxSlots: number;
  private slab = new Int32Array(0);
  private cap = 0;
  private high = 0;
  /** Log slot per plot, -1 = none. */
  readonly slotOf: Int32Array;
  private plotOfSlot = new Int32Array(0);
  /** Strokes ever written to the slot (ring index = written mod ring). */
  private written = new Uint32Array(0);
  private lastWrite = new Int32Array(0);
  private free = new Int32Array(0);
  private freeTop = 0;
  private clock = 0;
  evictions = 0;

  // Decode outputs of read().
  anchor = 0;
  sU = 0;
  sV = 0;
  eU = 0;
  eV = 0;
  widthCm = 0;
  depth16 = 0;
  toolCode = 0;
  actor = 0;

  constructor(plotCount: number, ring = 256, maxBytes = 16 * 1024 * 1024) {
    this.ring = ring;
    this.maxSlots = Math.max(1, Math.floor(maxBytes / (ring * LOG_WORDS * 4)));
    this.slotOf = new Int32Array(plotCount).fill(-1);
    this.grow(Math.min(16, this.maxSlots));
  }

  private grow(cap: number): void {
    const slab = new Int32Array(cap * this.ring * LOG_WORDS);
    slab.set(this.slab);
    this.slab = slab;
    const plots = new Int32Array(cap).fill(-1);
    plots.set(this.plotOfSlot);
    this.plotOfSlot = plots;
    const w = new Uint32Array(cap);
    w.set(this.written);
    this.written = w;
    const lw = new Int32Array(cap);
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
      // Cap reached: evict the least recently written ring (rare; linear scan).
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

  drop(plot: number): void {
    const slot = this.slotOf[plot]!;
    if (slot < 0) return;
    this.slotOf[plot] = -1;
    this.plotOfSlot[slot] = -1;
    this.free[this.freeTop++] = slot;
  }

  /** Appends a stroke to the ring of `plot`. */
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
    actor: number,
  ): void {
    let slot = this.slotOf[plot]!;
    if (slot < 0) slot = this.take(plot);
    const n = this.written[slot]!;
    const o = (slot * this.ring + (n % this.ring)) * LOG_WORDS;
    const s = this.slab;
    s[o] = anchor | (toolCode << 18) | (actor << 24);
    s[o + 1] = (sU & 0xffff) | (sV << 16);
    s[o + 2] = (eU & 0xffff) | (eV << 16);
    s[o + 3] = widthCm | (depth16 << 10);
    this.written[slot] = n + 1;
    this.lastWrite[slot] = ++this.clock;
  }

  /** Appends an already packed record (snapshot / save loading). */
  pushPacked(plot: number, w0: number, w1: number, w2: number, w3: number): void {
    let slot = this.slotOf[plot]!;
    if (slot < 0) slot = this.take(plot);
    const n = this.written[slot]!;
    const o = (slot * this.ring + (n % this.ring)) * LOG_WORDS;
    this.slab[o] = w0;
    this.slab[o + 1] = w1;
    this.slab[o + 2] = w2;
    this.slab[o + 3] = w3;
    this.written[slot] = n + 1;
    this.lastWrite[slot] = ++this.clock;
  }

  /** Packed word w (0 .. 3) of the k-th oldest held stroke of `plot`. */
  word(plot: number, k: number, w: number): number {
    const slot = this.slotOf[plot]!;
    const n = this.written[slot]!;
    const first = n < this.ring ? 0 : n % this.ring;
    return this.slab[(slot * this.ring + ((first + k) % this.ring)) * LOG_WORDS + w]!;
  }

  /** Strokes currently held for `plot` (0 .. ring). */
  count(plot: number): number {
    const slot = this.slotOf[plot]!;
    if (slot < 0) return 0;
    const n = this.written[slot]!;
    return n < this.ring ? n : this.ring;
  }

  /** Decodes the k-th oldest held stroke of `plot` into the public fields. */
  read(plot: number, k: number): void {
    const slot = this.slotOf[plot]!;
    const n = this.written[slot]!;
    const first = n < this.ring ? 0 : n % this.ring;
    const o = (slot * this.ring + ((first + k) % this.ring)) * LOG_WORDS;
    const s = this.slab;
    const w0 = s[o]!;
    const w1 = s[o + 1]!;
    const w2 = s[o + 2]!;
    const w3 = s[o + 3]!;
    this.anchor = w0 & 0x3ffff;
    this.toolCode = (w0 >>> 18) & 0x3f;
    this.actor = (w0 >>> 24) & 0x3f;
    this.sU = (w1 << 16) >> 16;
    this.sV = w1 >> 16;
    this.eU = (w2 << 16) >> 16;
    this.eV = w2 >> 16;
    this.widthCm = w3 & 0x3ff;
    this.depth16 = (w3 >>> 10) & 0xff;
  }

  /** Bytes held by the slab (RAM accounting). */
  bytes(): number {
    return this.slab.byteLength;
  }
}
