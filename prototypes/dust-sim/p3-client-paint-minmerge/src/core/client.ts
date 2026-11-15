// P3 client: paints its own tiles with its own brush, uploads the texels whose shared 4-bit level dropped, and
// min-merges what the server relays. The `fine` plane (sub-level progress of the local brush) is private and never
// leaves the client. Environment-agnostic; hot paths (paint, encodeUpload, receive, takeGpuUploads) do not allocate
// except when a tile is created for the first time.
import type { StrokeRecord } from "../../../../../packages/shared/src/index";
import { Bag, ByteReader, ByteWriter } from "./bytes";
import { decodeFull, lowBit, readGaps, readZigzag, writeZigzag } from "./codec";
import {
  DEFAULT_DUST_LEVEL,
  FINE_MAX,
  FINE_PER_LEVEL,
  LEVEL_MAX,
  MAX_SEGMENT_MM,
  ROBOT_INTENT_BYTES,
  SEC_ACK,
  SEC_CHECK,
  SEC_INTEREST,
  SEC_PAINT,
  SEC_PLOTS,
  SEC_ROBOT,
  SEC_TILE_DELTA,
  SEC_TILE_FULL,
  SEC_TILE_RESYNC,
  STATE_POLISHED,
  TILE_EDGE,
  TILE_TEXELS,
} from "./constants";
import { GeomCache, LocalMm, PlotGeom, Vec3, dirToLocal, localToDir } from "./geom";
import { POLISHED_HASH, plotMix, texelZ } from "./hash";
import { BRUSH_FLAT, Painter, depthFineOf, removalFine } from "./painter";

export const PAINT_OK = 0;
export const PAINT_SEGMENT_TOO_LONG = 1;

class ClientTile {
  readonly level = new Uint8Array(TILE_TEXELS).fill(LEVEL_MAX);
  readonly fine = new Uint8Array(TILE_TEXELS).fill(FINE_MAX);
  readonly upMask = new Uint32Array(TILE_TEXELS / 32);
  upCount = 0;
  inUp = false;
  hash = 0;
  mix = 0;
  plot = -1;
  geom: PlotGeom | null = null;
  // GPU upload rectangle (inclusive); x1 < x0 means clean.
  gx0 = TILE_EDGE;
  gy0 = TILE_EDGE;
  gx1 = -1;
  gy1 = -1;
  inGpu = false;

  reset(plot: number, geom: PlotGeom): void {
    this.level.fill(LEVEL_MAX);
    this.fine.fill(FINE_MAX);
    this.upMask.fill(0);
    this.upCount = 0;
    this.inUp = false;
    this.hash = 0;
    this.mix = 0;
    this.plot = plot;
    this.geom = geom;
    this.gx0 = TILE_EDGE;
    this.gy0 = TILE_EDGE;
    this.gx1 = -1;
    this.gy1 = -1;
    this.inGpu = false;
  }
}

export class P3Client {
  readonly state: Uint8Array;
  readonly remFrac: Uint8Array;
  private readonly tiles = new Map<number, ClientTile>();
  private readonly pool: ClientTile[] = [];
  private readonly upTiles = new Bag<ClientTile>();
  private readonly gpuTiles = new Bag<ClientTile>();
  private readonly painter = new Painter();
  private readonly reader = new ByteReader();
  private readonly idx = new Uint16Array(TILE_TEXELS);
  private readonly full = new Uint8Array(TILE_TEXELS);
  private readonly dir = new Vec3();
  private readonly loc = new LocalMm();
  private tilesHash = 0;
  private polishedHash = 0;
  private seq = 0;
  private readonly radiusM: number;

  grams = 0;
  /** dust.check mismatches seen. */
  drift = 0;
  robotIntents = 0;
  fullTilesDecoded = 0;
  resyncs = 0;
  malformed = 0;
  /** Texels whose shared level this client lowered locally / that arrived from the server. */
  texelsPainted = 0;
  texelsReceived = 0;

  constructor(private readonly geom: GeomCache) {
    this.radiusM = geom.radiusM;
    this.state = new Uint8Array(geom.plotCount);
    this.remFrac = new Uint8Array(geom.plotCount).fill(255);
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  /** Hash of everything this client holds: its tiles plus the Polished plots it knows from L0. */
  viewHash(): number {
    return (this.tilesHash ^ this.polishedHash) >>> 0;
  }

  /** Shared level of a texel (LEVEL_MAX when the client holds no tile for the plot). For tests and CPU references. */
  levelAt(plot: number, texel: number): number {
    if (this.state[plot] === STATE_POLISHED) return 0;
    return this.tiles.get(plot)?.level[texel] ?? LEVEL_MAX;
  }

  /** Private fine value (0..240) of a texel; what the local dust texture shows. */
  fineAt(plot: number, texel: number): number {
    if (this.state[plot] === STATE_POLISHED) return 0;
    return this.tiles.get(plot)?.fine[texel] ?? FINE_MAX;
  }

  private tile(plot: number): ClientTile {
    let t = this.tiles.get(plot);
    if (t) return t;
    t = this.pool.pop() ?? new ClientTile();
    t.reset(plot, this.geom.get(plot));
    this.tiles.set(plot, t);
    return t;
  }

  private free(t: ClientTile): void {
    this.tilesHash ^= t.mix;
    this.tiles.delete(t.plot);
    if (t.inUp) this.upTiles.remove(t);
    if (t.inGpu) this.gpuTiles.remove(t);
    t.inUp = false;
    t.inGpu = false;
    this.pool.push(t);
  }

  private commit(t: ClientTile): void {
    const mix = plotMix(t.plot, t.hash);
    this.tilesHash ^= t.mix ^ mix;
    t.mix = mix;
  }

  private gpuDirty(t: ClientTile, i: number): void {
    const a = i & (TILE_EDGE - 1);
    const b = i >> 6;
    if (a < t.gx0) t.gx0 = a;
    if (a > t.gx1) t.gx1 = a;
    if (b < t.gy0) t.gy0 = b;
    if (b > t.gy1) t.gy1 = b;
    if (!t.inGpu) {
      t.inGpu = true;
      this.gpuTiles.push(t);
    }
  }

  /**
   * Local paint of one tool-head segment (plot-local mm in the anchor frame). Any brush may be used: the server only
   * ever sees the resulting levels. Returns PAINT_OK or the client-side sanity reject.
   */
  paint(s: StrokeRecord, brush: number = BRUSH_FLAT): number {
    const dx = s.endUMm - s.startUMm;
    const dy = s.endVMm - s.startVMm;
    if (dx * dx + dy * dy > MAX_SEGMENT_MM * MAX_SEGMENT_MM) return PAINT_SEGMENT_TOO_LONG;
    const widthMm = s.widthCm * 10;
    const depthFine = depthFineOf(s.depth16, DEFAULT_DUST_LEVEL);
    if (depthFine <= 0) return PAINT_OK;
    const ga = this.geom.get(s.anchor);
    this.paintInto(ga, s.startUMm, s.startVMm, s.endUMm, s.endVMm, widthMm, depthFine, brush);
    const d = this.dir;
    const l = this.loc;
    for (let k = 0; k < ga.neighborCount; k++) {
      const gn = this.geom.get(ga.neighbors[k] ?? 0);
      dirToLocal(gn, localToDir(ga, s.startUMm, s.startVMm, this.radiusM, d), this.radiusM, l);
      const su = l.u;
      const sv = l.v;
      dirToLocal(gn, localToDir(ga, s.endUMm, s.endVMm, this.radiusM, d), this.radiusM, l);
      this.paintInto(gn, su, sv, l.u, l.v, widthMm, depthFine, brush);
    }
    return PAINT_OK;
  }

  private paintInto(
    g: PlotGeom,
    su: number,
    sv: number,
    eu: number,
    ev: number,
    widthMm: number,
    depthFine: number,
    brush: number,
  ): void {
    const p = this.painter;
    const n = p.raster(su, sv, eu, ev, widthMm, brush);
    if (n === 0) return;
    if (this.state[g.plot] === STATE_POLISHED) {
      p.clear();
      return;
    }
    const owned = g.owned;
    let t: ClientTile | null = null;
    let changed = false;
    for (let k = 0; k < n; k++) {
      const i = p.touched[k] ?? 0;
      if (((owned[i >>> 5] ?? 0) & (1 << (i & 31))) === 0) continue;
      t ??= this.tile(g.plot);
      const f = t.fine[i] ?? 0;
      if (f === 0) continue;
      const r = removalFine(p.cov[i] ?? 0, depthFine);
      if (r === 0) continue;
      const nf = f > r ? f - r : 0;
      t.fine[i] = nf;
      this.gpuDirty(t, i);
      const lvl = (nf + FINE_PER_LEVEL - 1) >> 4;
      const old = t.level[i] ?? 0;
      if (lvl < old) {
        t.level[i] = lvl;
        t.hash = t.hash ^ texelZ(i, old) ^ texelZ(i, lvl);
        changed = true;
        this.texelsPainted++;
        const bit = 1 << (i & 31);
        const word = t.upMask[i >>> 5] ?? 0;
        if ((word & bit) === 0) {
          t.upMask[i >>> 5] = word | bit;
          t.upCount++;
        }
      }
    }
    p.clear();
    if (t && changed) {
      this.commit(t);
      if (!t.inUp) {
        t.inUp = true;
        this.upTiles.push(t);
      }
    }
  }

  /** Writes the pending paint as one C -> S message. Returns its length (0 when there is nothing to send). */
  encodeUpload(w: ByteWriter): number {
    const list = this.upTiles.items;
    const tiles = this.upTiles.count;
    if (tiles === 0) return 0;
    const start = w.pos;
    w.u8(SEC_PAINT);
    w.u16(this.seq);
    this.seq = (this.seq + 1) & 0xffff;
    w.varint(tiles);
    let prev = 0;
    for (let k = 0; k < tiles; k++) {
      const t = list[k] as ClientTile;
      writeZigzag(w, t.plot - prev);
      prev = t.plot;
      w.varint(t.upCount);
      let last = -1;
      for (let wi = 0; wi < t.upMask.length; wi++) {
        let word = t.upMask[wi] ?? 0;
        while (word !== 0) {
          const i = (wi << 5) + lowBit(word);
          word &= word - 1;
          w.varint(i - last - 1);
          last = i;
        }
      }
      for (let wi = 0; wi < t.upMask.length; wi++) {
        let word = t.upMask[wi] ?? 0;
        while (word !== 0) {
          const i = (wi << 5) + lowBit(word);
          word &= word - 1;
          w.nib(t.level[i] ?? 0);
        }
        t.upMask[wi] = 0;
      }
      w.nibEnd();
      t.upCount = 0;
      t.inUp = false;
    }
    this.upTiles.clear();
    return w.pos - start;
  }

  /** Applies one S -> C message (a sequence of sections). Never throws on malformed input. */
  receive(buf: Uint8Array, start: number, end: number): void {
    const r = this.reader;
    r.load(buf, start, end);
    while (r.remaining > 0 && !r.bad) {
      const sec = r.u8();
      switch (sec) {
        case SEC_TILE_DELTA:
          this.onDelta(r);
          break;
        case SEC_TILE_FULL:
        case SEC_TILE_RESYNC:
          this.onFull(r, sec === SEC_TILE_RESYNC);
          break;
        case SEC_PLOTS:
          this.onPlots(r);
          break;
        case SEC_ACK:
          this.grams = r.u24();
          break;
        case SEC_INTEREST: {
          const n = r.u16();
          for (let k = 0; k < n; k++) {
            const t = this.tiles.get(r.u24());
            if (t) this.free(t);
          }
          break;
        }
        case SEC_ROBOT:
          r.skip(ROBOT_INTENT_BYTES);
          this.robotIntents++;
          break;
        case SEC_CHECK:
          if (r.u32() !== this.viewHash()) this.drift++;
          break;
        default:
          this.malformed++;
          return;
      }
    }
    if (r.bad) this.malformed++;
  }

  private onDelta(r: ByteReader): void {
    const plots = r.u16();
    let plot = 0;
    for (let p = 0; p < plots; p++) {
      plot += readZigzag(r);
      const n = r.varint();
      if (plot < 0 || plot >= this.state.length || n < 1 || n > TILE_TEXELS || !readGaps(r, n, this.idx)) {
        r.bad = true;
        return;
      }
      const polished = this.state[plot] === STATE_POLISHED;
      const t = polished ? null : this.tile(plot);
      let changed = false;
      for (let k = 0; k < n; k++) {
        const v = r.nib();
        if (!t) continue;
        const i = this.idx[k] ?? 0;
        const old = t.level[i] ?? 0;
        if (v >= old) continue;
        t.level[i] = v;
        if ((t.fine[i] ?? 0) > v * FINE_PER_LEVEL) t.fine[i] = v * FINE_PER_LEVEL;
        t.hash = t.hash ^ texelZ(i, old) ^ texelZ(i, v);
        this.gpuDirty(t, i);
        this.texelsReceived++;
        changed = true;
      }
      r.nibEnd();
      if (t && changed) this.commit(t);
    }
  }

  private onFull(r: ByteReader, overwrite: boolean): void {
    const plot = r.u24();
    if (plot >= this.state.length || !decodeFull(r, this.full)) {
      r.bad = true;
      return;
    }
    if (this.state[plot] === STATE_POLISHED) return;
    const t = this.tile(plot);
    const full = this.full;
    let changed = false;
    for (let i = 0; i < TILE_TEXELS; i++) {
      const v = full[i] ?? 0;
      const old = t.level[i] ?? 0;
      if (overwrite) {
        if (old === v && (t.fine[i] ?? 0) === v * FINE_PER_LEVEL) continue;
        t.fine[i] = v * FINE_PER_LEVEL;
        this.gpuDirty(t, i);
        if (old === v) continue;
      } else {
        if (v >= old) continue;
        if ((t.fine[i] ?? 0) > v * FINE_PER_LEVEL) t.fine[i] = v * FINE_PER_LEVEL;
        this.gpuDirty(t, i);
      }
      t.level[i] = v;
      t.hash = t.hash ^ texelZ(i, old) ^ texelZ(i, v);
      changed = true;
    }
    if (overwrite) {
      // The server refused part of our paint: drop what is still queued for this tile (it would be refused again).
      t.upMask.fill(0);
      t.upCount = 0;
      if (t.inUp) {
        this.upTiles.remove(t);
        t.inUp = false;
      }
      this.resyncs++;
    }
    this.fullTilesDecoded++;
    if (changed) this.commit(t);
  }

  private onPlots(r: ByteReader): void {
    const n = r.u24();
    for (let k = 0; k < n; k++) {
      const rec = r.u24();
      const frac = r.u8();
      const plot = rec & 0x3ffff;
      const st = (rec >> 18) & 3;
      if (r.bad || plot >= this.state.length) {
        r.bad = true;
        return;
      }
      if (st === STATE_POLISHED && this.state[plot] !== STATE_POLISHED) {
        const t = this.tiles.get(plot);
        if (t) this.free(t);
        this.polishedHash ^= plotMix(plot, POLISHED_HASH);
      }
      this.state[plot] = st;
      this.remFrac[plot] = frac;
    }
  }

  /**
   * Frame-side work: copies the dirty rectangle of every changed tile (the private fine plane, one byte per texel)
   * into `staging`, as the source of one texture sub-region write each. Returns the number of regions.
   */
  takeGpuUploads(staging: Uint8Array): number {
    const list = this.gpuTiles.items;
    const tiles = this.gpuTiles.count;
    let regions = 0;
    let o = 0;
    for (let k = 0; k < tiles; k++) {
      const t = list[k] as ClientTile;
      for (let y = t.gy0; y <= t.gy1; y++) {
        const row = y * TILE_EDGE;
        for (let x = t.gx0; x <= t.gx1; x++) {
          if (o < staging.length) staging[o++] = t.fine[row + x] ?? 0;
        }
      }
      t.gx0 = TILE_EDGE;
      t.gy0 = TILE_EDGE;
      t.gx1 = -1;
      t.gy1 = -1;
      t.inGpu = false;
      regions++;
      if (o >= staging.length) o = 0;
    }
    this.gpuTiles.clear();
    return regions;
  }

  /** Test hook: flips one texel without telling anyone (simulates corruption for the drift check). */
  corruptForTest(plot: number, texel: number, level: number): void {
    const t = this.tile(plot);
    const old = t.level[texel] ?? 0;
    t.level[texel] = level;
    t.hash = t.hash ^ texelZ(texel, old) ^ texelZ(texel, level);
    this.commit(t);
  }

  /** Test / cheat hook: queue an arbitrary level for upload without painting (what a modified client would do). */
  forgeForTest(plot: number, texel: number, level: number): void {
    const t = this.tile(plot);
    const old = t.level[texel] ?? 0;
    t.level[texel] = level;
    t.fine[texel] = level * FINE_PER_LEVEL;
    t.hash = t.hash ^ texelZ(texel, old) ^ texelZ(texel, level);
    const bit = 1 << (texel & 31);
    if (((t.upMask[texel >>> 5] ?? 0) & bit) === 0) {
      t.upMask[texel >>> 5] = (t.upMask[texel >>> 5] ?? 0) | bit;
      t.upCount++;
    }
    this.commit(t);
    if (!t.inUp) {
      t.inUp = true;
      this.upTiles.push(t);
    }
  }
}
