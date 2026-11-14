// P2 prototype: CPU REFERENCE of the client tile atlas (WDS 7.2 to 7.4). The real client replays strokes on the GPU;
// this class does the same bookkeeping (who gets a tile, slot allocation, eviction, per-frame work lists, rebuild
// budget) and the same per-texel math in JavaScript, so the headless harness can time the CPU side and the GPU lane
// has bytes to compare against. Tile channels (RGBA8): R remaining dust, G unpolish, B untrampled, A berm height.
//
// Replay (7.3): R <- max(0, R - round(255 s c)), G <- max(0, G - round(255 * 0.25 c)), A <- max(A, berm), with
// c = round-capped capsule coverage with a 1-texel edge and s = min(1, depth16 / (16 L_P)). Order-independent.
// Rebuild (7.4, corrected): replaying the logs ON TOP of a ledger-initialised tile would subtract the logged strokes
// twice. This reference replays the logs from R = 1 and then subtracts, per 0.8 m ledger cell, only the removal the
// logs do not explain (older strokes): R <- max(0, R - max(0, mean(R) - u_t / u0)); cells with u_t = 0 are cleared.
// Environment-agnostic. onStroke allocates nothing; frame() allocates nothing after warm-up.

import type { TileSink } from "./client";
import {
  FRAME_EDGE_MM,
  FRAME_HALF_MM,
  LEDGER_BYTES,
  LEDGER_EDGE,
  STATE_POLISHED,
  TEXEL_MM,
  type DustView,
} from "./dust-view";
import type { InterestSet } from "./interest";
import type { StrokeLog } from "./stroke-log";
import { DUST_LEVEL_BY_CLASS, type PlotTables } from "./tables";
import { dirOf, xform } from "./util";

export interface TileOptions {
  /** Tile edge in texels: 64 (Low / Medium) or 128 (High / Ultra). */
  readonly slotPx: number;
  readonly slots: number;
  readonly residencyM: number;
  /** Tiles rebuilt per frame at most (Low 2, Medium 3, High 6). */
  readonly rebuildBudget: number;
  readonly now: () => number;
}

export const TILE_PRESETS = {
  low: { slotPx: 64, slots: 512, residencyM: 80, rebuildBudget: 2 },
  medium: { slotPx: 64, slots: 1024, residencyM: 120, rebuildBudget: 3 },
  high: { slotPx: 128, slots: 512, residencyM: 160, rebuildBudget: 6 },
} as const;

const SW = 7;

export class TileAtlasRef implements TileSink {
  readonly px: number;
  readonly texelMm: number;
  readonly data: Uint8Array;
  readonly slotOfPlot: Int32Array;
  readonly plotOfSlot: Int32Array;
  private readonly free: Int32Array;
  private freeTop: number;
  tilesResident = 0;
  evictions = 0;

  private pending = new Int32Array(256 * SW);
  private pendingN = 0;
  private readonly needRebuild: Uint8Array;
  private rebuildList = new Int32Array(64);
  private rebuildN = 0;
  private readonly touched: Uint8Array;
  private touchedList = new Int32Array(64);
  private touchedN = 0;

  private readonly xy = new Int32Array(2);
  private readonly dir = new Float64Array(3);
  // rebuild de-duplication set: 4,096 slots (7 logs x 256 strokes = 1,792 entries at most)
  private readonly seenKeys = new Int32Array(4096 * 3);
  private readonly seenStamp = new Int32Array(4096);
  private seenGen = 0;
  private readonly cosRes: number;

  // results of the last frame()
  fCpuMs = 0;
  fReplayMs = 0;
  fRebuildMs = 0;
  fUploads = 0;
  fStrokes = 0;
  fRebuilds = 0;
  // totals
  strokesReplayed = 0;
  tileStrokeDraws = 0;
  rebuilds = 0;
  rebuildMsTotal = 0;
  rebuildMsMax = 0;
  ledgerZeroClears = 0;

  constructor(
    private readonly t: PlotTables,
    private readonly view: DustView,
    private readonly log: StrokeLog,
    private readonly set: InterestSet,
    private readonly opt: TileOptions,
  ) {
    this.px = opt.slotPx;
    this.texelMm = FRAME_EDGE_MM / opt.slotPx;
    this.data = new Uint8Array(opt.slots * this.px * this.px * 4);
    this.slotOfPlot = new Int32Array(t.count).fill(-1);
    this.plotOfSlot = new Int32Array(opt.slots).fill(-1);
    this.free = new Int32Array(opt.slots);
    for (let i = 0; i < opt.slots; i++) this.free[i] = opt.slots - 1 - i;
    this.freeTop = opt.slots;
    this.needRebuild = new Uint8Array(t.count);
    this.touched = new Uint8Array(opt.slots);
    const a = opt.residencyM / t.radiusM;
    this.cosRes = 1 - (a * a) / 2;
    if (view.zeroList === null) view.zeroList = new Int32Array(256);
  }

  // ---- sink ---------------------------------------------------------------------------------------------------

  onStroke(anchor: number, sU: number, sV: number, eU: number, eV: number, widthCm: number, depth16: number): void {
    if ((this.pendingN + 1) * SW > this.pending.length) {
      const g = new Int32Array(this.pending.length * 2);
      g.set(this.pending);
      this.pending = g;
    }
    const o = this.pendingN++ * SW;
    const p = this.pending;
    p[o] = anchor;
    p[o + 1] = sU;
    p[o + 2] = sV;
    p[o + 3] = eU;
    p[o + 4] = eV;
    p[o + 5] = widthCm;
    p[o + 6] = depth16;
  }

  onLedger(plot: number): void {
    this.queueRebuild(plot);
  }

  onDrop(plot: number): void {
    this.release(plot);
  }

  private queueRebuild(plot: number): void {
    if (this.needRebuild[plot] === 1) return;
    this.needRebuild[plot] = 1;
    if (this.rebuildN === this.rebuildList.length) {
      const g = new Int32Array(this.rebuildN * 2);
      g.set(this.rebuildList);
      this.rebuildList = g;
    }
    this.rebuildList[this.rebuildN++] = plot;
  }

  private release(plot: number): void {
    const slot = this.slotOfPlot[plot]!;
    if (slot < 0) return;
    this.slotOfPlot[plot] = -1;
    this.plotOfSlot[slot] = -1;
    this.free[this.freeTop++] = slot;
    this.tilesResident--;
  }

  // ---- per-texel math -----------------------------------------------------------------------------------------

  /** Draws one stroke (endpoints already in the frame of the tile's plot) into `slot`. Returns texels touched. */
  private draw(
    slot: number,
    su: number,
    sv: number,
    eu: number,
    ev: number,
    widthCm: number,
    depth16: number,
    level: number,
  ): number {
    // s = fraction of the plot's initial dust one full-coverage pass removes (integers in, no boxed double argument).
    const s = depth16 >= 16 * level ? 1 : depth16 / (16 * level);
    const px = this.px;
    const ts = this.texelMm;
    const hw = widthCm * 5;
    const band = Math.max(150, 3 * widthCm);
    const reach = hw + band + ts;
    let x0 = Math.floor(((su < eu ? su : eu) - reach + FRAME_HALF_MM) / ts);
    let x1 = Math.floor(((su > eu ? su : eu) + reach + FRAME_HALF_MM) / ts);
    let y0 = Math.floor(((sv < ev ? sv : ev) - reach + FRAME_HALF_MM) / ts);
    let y1 = Math.floor(((sv > ev ? sv : ev) + reach + FRAME_HALF_MM) / ts);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > px - 1) x1 = px - 1;
    if (y1 > px - 1) y1 = px - 1;
    if (x0 > x1 || y0 > y1) return 0;
    const dx = eu - su;
    const dy = ev - sv;
    const len2 = dx * dx + dy * dy;
    const d = this.data;
    const base = slot * px * px * 4;
    for (let y = y0; y <= y1; y++) {
      const wy = (y + 0.5) * ts - FRAME_HALF_MM - sv;
      for (let x = x0; x <= x1; x++) {
        const wx = (x + 0.5) * ts - FRAME_HALF_MM - su;
        let tt = len2 === 0 ? 0 : (wx * dx + wy * dy) / len2;
        if (tt < 0) tt = 0;
        else if (tt > 1) tt = 1;
        const ox = wx - tt * dx;
        const oy = wy - tt * dy;
        const dist = Math.sqrt(ox * ox + oy * oy);
        const o = base + (y * px + x) * 4;
        let c = 0.5 + (hw - dist) / ts;
        if (c > 0) {
          if (c > 1) c = 1;
          const r = d[o]! - Math.round(255 * s * c);
          d[o] = r > 0 ? r : 0;
          const g = d[o + 1]! - Math.round(63.75 * c);
          d[o + 1] = g > 0 ? g : 0;
        }
        const bx = (dist - hw) / band;
        if (bx > 0 && bx < 1) {
          const h = Math.round(255 * s * (bx < 0.35 ? bx / 0.35 : (1 - bx) / 0.65));
          if (h > d[o + 3]!) d[o + 3] = h;
        }
      }
    }
    return (x1 - x0 + 1) * (y1 - y0 + 1);
  }

  /** Draws a stroke record into the tile of `plot` when its reach overlaps the frame. */
  private drawRecord(
    plot: number,
    anchor: number,
    sU: number,
    sV: number,
    eU: number,
    eV: number,
    widthCm: number,
    depth16: number,
  ): boolean {
    const slot = this.slotOfPlot[plot]!;
    if (slot < 0) return false;
    let su = sU;
    let sv = sV;
    let eu = eU;
    let ev = eV;
    if (anchor !== plot) {
      xform(this.t, anchor, sU, sV, plot, this.xy);
      su = this.xy[0]!;
      sv = this.xy[1]!;
      xform(this.t, anchor, eU, eV, plot, this.xy);
      eu = this.xy[0]!;
      ev = this.xy[1]!;
    }
    const level = DUST_LEVEL_BY_CLASS[this.t.classOf[plot]!] ?? 1;
    if (this.draw(slot, su, sv, eu, ev, widthCm, depth16, level) === 0) return false;
    this.tileStrokeDraws++;
    if (this.touched[slot] === 0) {
      this.touched[slot] = 1;
      if (this.touchedN === this.touchedList.length) {
        const g = new Int32Array(this.touchedN * 2);
        g.set(this.touchedList);
        this.touchedList = g;
      }
      this.touchedList[this.touchedN++] = slot;
    }
    return true;
  }

  /** Plot nearest to the unit direction in this.dir, walking from `start` (ties to the lower id). */
  private nearest(start: number): number {
    const x = this.dir[0]!;
    const y = this.dir[1]!;
    const z = this.dir[2]!;
    const c = this.t.centers;
    const nbr = this.t.neighbors;
    let home = start;
    let best = x * c[home * 3]! + y * c[home * 3 + 1]! + z * c[home * 3 + 2]!;
    for (let step = 0; step < 64; step++) {
      let next = home;
      for (let k = 0; k < 6; k++) {
        const q = nbr[home * 6 + k]!;
        if (q < 0) continue;
        const dq = x * c[q * 3]! + y * c[q * 3 + 1]! + z * c[q * 3 + 2]!;
        if (dq > best || (dq === best && q < next)) {
          best = dq;
          next = q;
        }
      }
      if (next === home) break;
      home = next;
    }
    return home;
  }

  /** Remaining dust in 1/255 the ledger reports at integer mm (u, v) of `plot`'s frame; -1 = no information. */
  private ledgerAt(plot: number, u: number, v: number): number {
    dirOf(this.t, plot, u, v, this.dir);
    const owner = this.nearest(plot);
    const st = this.view.state[owner]!;
    if (st >= STATE_POLISHED) return 0;
    const slot = this.view.slotOf[owner]!;
    if (slot < 0) return this.set.member[owner] === 1 ? 255 : -1;
    let ou = u;
    let ov = v;
    if (owner !== plot) {
      xform(this.t, plot, u, v, owner, this.xy);
      ou = this.xy[0]!;
      ov = this.xy[1]!;
    }
    const a = Math.floor((ou + FRAME_HALF_MM) / TEXEL_MM);
    const b = Math.floor((ov + FRAME_HALF_MM) / TEXEL_MM);
    if (a < 0 || a >= LEDGER_EDGE || b < 0 || b >= LEDGER_EDGE) return -1;
    const u0 = 16 * (DUST_LEVEL_BY_CLASS[this.t.classOf[owner]!] ?? 1);
    return Math.round((this.view.texels[slot * LEDGER_BYTES + b * LEDGER_EDGE + a]! * 255) / u0);
  }

  private rebuild(plot: number): void {
    const slot = this.slotOfPlot[plot]!;
    const px = this.px;
    const d = this.data;
    const base = slot * px * px * 4;
    for (let i = 0; i < px * px; i++) {
      d[base + i * 4] = 255;
      d[base + i * 4 + 1] = 255;
      d[base + i * 4 + 2] = 255;
      d[base + i * 4 + 3] = 0;
    }
    // 1. Replay the logs of the plot and its neighbours.
    const log = this.log;
    this.seenGen++;
    for (let ci = -1; ci < 6; ci++) {
      const q = ci < 0 ? plot : this.t.neighbors[plot * 6 + ci]!;
      if (q < 0) continue;
      const n = log.count(q);
      for (let k = 0; k < n; k++) {
        if (this.seenBefore(log.word(q, k, 0), log.word(q, k, 1), log.word(q, k, 2))) continue;
        log.read(q, k);
        this.drawRecord(plot, log.anchor, log.sU, log.sV, log.eU, log.eV, log.widthCm, log.depth16);
      }
    }
    // 2. Per ledger cell: subtract the removal the logs do not explain; clear ledger-zero cells.
    const cell = px / LEDGER_EDGE;
    for (let b = 0; b < LEDGER_EDGE; b++) {
      for (let a = 0; a < LEDGER_EDGE; a++) {
        const rl = this.ledgerAt(
          plot,
          a * TEXEL_MM + TEXEL_MM / 2 - FRAME_HALF_MM,
          b * TEXEL_MM + TEXEL_MM / 2 - FRAME_HALF_MM,
        );
        if (rl < 0) continue;
        let sum = 0;
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) sum += d[base + ((b * cell + y) * px + a * cell + x) * 4]!;
        }
        const older = rl === 0 ? 255 : Math.round(sum / (cell * cell)) - rl;
        if (older <= 0) continue;
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) {
            const o = base + ((b * cell + y) * px + a * cell + x) * 4;
            const r = d[o]! - older;
            d[o] = r > 0 ? r : 0;
          }
        }
      }
    }
    this.needRebuild[plot] = 0;
  }

  /**
   * A stroke sits in the log of every plot it overlapped, so a rebuild meets it up to 7 times; it must be drawn once.
   * Open-addressing set keyed by the packed (anchor | tool | actor, start, end) words. Two different strokes with
   * identical words (the same actor re-scrubbing the exact same segment) collapse into one [prototype limitation].
   */
  private seenBefore(w0: number, w1: number, w2: number): boolean {
    const keys = this.seenKeys;
    const stamp = this.seenStamp;
    const gen = this.seenGen;
    let h = (Math.imul(w0, 0x9e3779b1) ^ Math.imul(w1, 0x85ebca6b) ^ Math.imul(w2, 0xc2b2ae35)) >>> 20;
    for (;;) {
      if (stamp[h] !== gen) {
        stamp[h] = gen;
        keys[h * 3] = w0;
        keys[h * 3 + 1] = w1;
        keys[h * 3 + 2] = w2;
        return false;
      }
      if (keys[h * 3] === w0 && keys[h * 3 + 1] === w1 && keys[h * 3 + 2] === w2) return true;
      h = (h + 1) & 4095;
    }
  }

  /** Clears ledger cell `ix` of `plot` in its own tile and in the gutters of the neighbouring tiles. */
  private clearCell(plot: number, ix: number): void {
    const px = this.px;
    const cell = px / LEDGER_EDGE;
    const cu = ((ix & 31) + 0.5) * TEXEL_MM - FRAME_HALF_MM;
    const cv = ((ix >> 5) + 0.5) * TEXEL_MM - FRAME_HALF_MM;
    for (let ci = -1; ci < 6; ci++) {
      const q = ci < 0 ? plot : this.t.neighbors[plot * 6 + ci]!;
      if (q < 0) continue;
      const slot = this.slotOfPlot[q]!;
      if (slot < 0 || this.needRebuild[q] === 1) continue;
      let u = cu;
      let w = cv;
      if (q !== plot) {
        xform(this.t, plot, cu, cv, q, this.xy);
        u = this.xy[0]!;
        w = this.xy[1]!;
      }
      // Neighbouring frames are almost parallel, so the cell is cleared as an axis-aligned block around its centre.
      const x0 = Math.round((u + FRAME_HALF_MM) / this.texelMm - cell / 2);
      const y0 = Math.round((w + FRAME_HALF_MM) / this.texelMm - cell / 2);
      if (x0 + cell <= 0 || y0 + cell <= 0 || x0 >= px || y0 >= px) continue;
      const base = slot * px * px * 4;
      for (let y = y0 < 0 ? 0 : y0; y < y0 + cell && y < px; y++) {
        for (let x = x0 < 0 ? 0 : x0; x < x0 + cell && x < px; x++) this.data[base + (y * px + x) * 4] = 0;
      }
      this.ledgerZeroClears++;
      if (this.touched[slot] === 0) {
        this.touched[slot] = 1;
        if (this.touchedN === this.touchedList.length) {
          const g = new Int32Array(this.touchedN * 2);
          g.set(this.touchedList);
          this.touchedList = g;
        }
        this.touchedList[this.touchedN++] = slot;
      }
    }
  }

  // ---- frame --------------------------------------------------------------------------------------------------

  private wantsTile(plot: number): boolean {
    const v = this.view;
    if (v.slotOf[plot]! >= 0) return true;
    if (v.state[plot] !== STATE_POLISHED) return false;
    for (let k = 0; k < 6; k++) {
      const q = this.t.neighbors[plot * 6 + k]!;
      if (q >= 0 && v.slotOf[q]! >= 0) return true;
    }
    return false;
  }

  /** One rendered frame at camera unit direction pos[0 .. 2]: residency, rebuilds (budgeted), stroke replay. */
  frame(pos: Float64Array): void {
    const x = pos[0]!;
    const y = pos[1]!;
    const z = pos[2]!;
    const now = this.opt.now;
    const t0 = now();
    const c = this.t.centers;
    const set = this.set;

    // 1. Residency: touched / Opened member plots inside the residency radius get a tile.
    for (let i = 0; i < set.n; i++) {
      const p = set.list[i]!;
      if (this.slotOfPlot[p]! >= 0) continue;
      const d = x * c[p * 3]! + y * c[p * 3 + 1]! + z * c[p * 3 + 2]!;
      if (d < this.cosRes || !this.wantsTile(p)) continue;
      let slot = -1;
      if (this.freeTop > 0) slot = this.free[--this.freeTop]!;
      else {
        // Atlas full: evict the farthest tile if it is farther than this plot.
        let far = -1;
        let farDot = d;
        for (let s = 0; s < this.plotOfSlot.length; s++) {
          const q = this.plotOfSlot[s]!;
          const dq = x * c[q * 3]! + y * c[q * 3 + 1]! + z * c[q * 3 + 2]!;
          if (dq < farDot) {
            farDot = dq;
            far = s;
          }
        }
        if (far < 0) continue;
        this.slotOfPlot[this.plotOfSlot[far]!] = -1;
        this.tilesResident--;
        this.evictions++;
        slot = far;
      }
      this.slotOfPlot[p] = slot;
      this.plotOfSlot[slot] = p;
      this.tilesResident++;
      this.queueRebuild(p);
    }

    // 2. Rebuilds, at most `rebuildBudget` per frame.
    const t1 = now();
    let done = 0;
    let keep = 0;
    for (let i = 0; i < this.rebuildN; i++) {
      const p = this.rebuildList[i]!;
      if (this.slotOfPlot[p]! < 0) {
        this.needRebuild[p] = 0;
        continue;
      }
      if (done < this.opt.rebuildBudget) {
        const r0 = now();
        this.rebuild(p);
        const ms = now() - r0;
        this.rebuildMsTotal += ms;
        if (ms > this.rebuildMsMax) this.rebuildMsMax = ms;
        done++;
      } else this.rebuildList[keep++] = p;
    }
    this.rebuildN = keep;
    this.rebuilds += done;
    const t2 = now();

    // 3. Replay this frame's strokes into every resident tile they reach (tiles awaiting a rebuild get them there).
    const pend = this.pending;
    for (let i = 0; i < this.pendingN; i++) {
      const o = i * SW;
      const anchor = pend[o]!;
      dirOf(this.t, anchor, pend[o + 3]!, pend[o + 4]!, this.dir);
      const home = this.nearest(anchor);
      for (let ci = -1; ci < 6; ci++) {
        const q = ci < 0 ? home : this.t.neighbors[home * 6 + ci]!;
        if (q < 0 || this.slotOfPlot[q]! < 0 || this.needRebuild[q] === 1) continue;
        this.drawRecord(q, anchor, pend[o + 1]!, pend[o + 2]!, pend[o + 3]!, pend[o + 4]!, pend[o + 5]!, pend[o + 6]!);
      }
    }
    // 4. Ledger-zero clear (WDS 7.3): a 0.8 m cell the ledger counts as clean shows no residue in any resident tile.
    const v = this.view;
    if (v.zeroList !== null) {
      for (let i = 0; i < v.zeroN; i++) this.clearCell(v.zeroList[i * 2]!, v.zeroList[i * 2 + 1]!);
      v.zeroN = 0;
    }
    this.fStrokes = this.pendingN;
    this.strokesReplayed += this.pendingN;
    this.pendingN = 0;
    const t3 = now();

    this.fUploads = this.touchedN + done;
    for (let i = 0; i < this.touchedN; i++) this.touched[this.touchedList[i]!] = 0;
    this.touchedN = 0;
    this.fRebuilds = done;
    this.fRebuildMs = t2 - t1;
    this.fReplayMs = t3 - t2;
    this.fCpuMs = t3 - t0;
  }

  /** Rebuilds queued and not yet done (late join: time to drain). */
  get rebuildBacklog(): number {
    return this.rebuildN;
  }
}
