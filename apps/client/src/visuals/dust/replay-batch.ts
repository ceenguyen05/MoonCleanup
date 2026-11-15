// Dust tile replay batch (M1-W3-T02): the per-frame instance stream of the GPU stroke replay, plus its CPU reference.
//
// `DustTileAtlas.frame()` (tile-atlas.ts) writes one batch per rendered frame; `DustReplayPass.flush()` (replay-pass.ts)
// draws it into the RGBA8 atlas on the GPU, and `CpuAtlas.execute()` below does the same arithmetic in JavaScript. The
// acceptance rule of the task is that both end in the same bytes. Tile channels: R remaining dust, G unpolish,
// B untrampled, A berm height.
//
// Order inside one batch (the GPU does it in three passes, the CPU in the same order):
//   1. fills    plain writes (no blending): a tile reset to R = G = B = 255, A = 0 before a rebuild;
//   2. strokes  R <- max(0, R - round(255 s c)), G <- max(0, G - round(63.75 c)), A <- max(A, lip); kind 1 = ledger-zero
//               clear (R <- 0). Flat-ended segment box-filtered over one texel, disc for a zero-length stroke
//               (W1-T06 contract items 2 and 3). Saturating subtraction and max are order-independent;
//   3. residual per 0.8 m ledger cell: R <- max(0, R - older), older = 255 when the ledger cell is empty, else
//               mean(R over the cell) - ledger remaining (W1-T06 contract item 4). Reads the tile after step 2.
// No three.js, DOM or Node imports. Nothing here allocates after construction.

import { LEDGER_BYTES, LEDGER_EDGE_TEXELS, LEDGER_FRAME_EDGE_MM, PLOT_FRAME_HALF_MM } from "@moon-cleanup/shared";

export const FRAME_EDGE_MM = LEDGER_FRAME_EDGE_MM;
export const FRAME_HALF_MM = PLOT_FRAME_HALF_MM;
/** Ledger cells per tile edge (32). */
export const CELLS = LEDGER_EDGE_TEXELS;
/** Ledger cells per tile (1,024). */
export const CELL_COUNT = LEDGER_BYTES;

/** Stroke instances one batch can hold (one instance = one stroke in one tile slot). */
export const BATCH_MAX_STROKES = 2048;
/** Tile fills one batch can hold. */
export const BATCH_MAX_FILLS = 16;
/** Residual steps (finished tile rebuilds) one batch can hold. */
export const BATCH_MAX_RESIDUALS = 4;

export const KIND_STROKE = 0;
export const KIND_CLEAR = 1;

/** Atlas layout shared by the CPU bookkeeping, the GPU pass and the CPU reference. */
export interface AtlasLayout {
  /** Tile edge in texels: 64 or 128. */
  readonly slotPx: number;
  readonly cols: number;
  readonly rows: number;
}

export function atlasWidth(layout: AtlasLayout): number {
  return layout.cols * layout.slotPx;
}
export function atlasHeight(layout: AtlasLayout): number {
  return layout.rows * layout.slotPx;
}

export class DustReplayBatch {
  // fills: rect = x0, y0, x1, y1 in atlas texels (x1 / y1 exclusive); color = r, g, b, a in 0 .. 1
  readonly fillRect = new Float32Array(BATCH_MAX_FILLS * 4);
  readonly fillColor = new Float32Array(BATCH_MAX_FILLS * 4);
  fillN = 0;
  // strokes: rect as above; seg = su, sv, eu, ev (mm, tile frame); par = half width mm, berm band mm, s, kind;
  // org = tile origin x, y in atlas texels
  readonly strokeRect = new Float32Array(BATCH_MAX_STROKES * 4);
  readonly strokeSeg = new Float32Array(BATCH_MAX_STROKES * 4);
  readonly strokePar = new Float32Array(BATCH_MAX_STROKES * 4);
  readonly strokeOrg = new Float32Array(BATCH_MAX_STROKES * 4);
  strokeN = 0;
  // residuals: rect = tile rectangle in the atlas; info = tile origin x, y, residual index k, 0
  readonly residRect = new Float32Array(BATCH_MAX_RESIDUALS * 4);
  readonly residInfo = new Float32Array(BATCH_MAX_RESIDUALS * 4);
  /** Rectangle of residual k in the 32 x (32 * BATCH_MAX_RESIDUALS) scratch target. */
  readonly residScratchRect = new Float32Array(BATCH_MAX_RESIDUALS * 4);
  /** RGBA8, 32 x 32 per residual, rows of residual k start at row 32 k: R = ledger remaining in 1/255, G = 255 valid. */
  readonly ledgerCells = new Uint8Array(BATCH_MAX_RESIDUALS * CELL_COUNT * 4);
  residN = 0;

  constructor() {
    for (let k = 0; k < BATCH_MAX_RESIDUALS; k++) {
      this.residScratchRect[k * 4] = 0;
      this.residScratchRect[k * 4 + 1] = k * CELLS;
      this.residScratchRect[k * 4 + 2] = CELLS;
      this.residScratchRect[k * 4 + 3] = (k + 1) * CELLS;
    }
  }

  reset(): void {
    this.fillN = 0;
    this.strokeN = 0;
    this.residN = 0;
  }

  get empty(): boolean {
    return this.fillN === 0 && this.strokeN === 0 && this.residN === 0;
  }

  /** Resets tile `slot` to full dust (R = G = B = 255, A = 0). False when the batch is full. */
  pushFill(layout: AtlasLayout, slot: number): boolean {
    if (this.fillN === BATCH_MAX_FILLS) return false;
    const px = layout.slotPx;
    const ox = (slot % layout.cols) * px;
    const oy = Math.floor(slot / layout.cols) * px;
    const o = this.fillN++ * 4;
    const r = this.fillRect;
    r[o] = ox;
    r[o + 1] = oy;
    r[o + 2] = ox + px;
    r[o + 3] = oy + px;
    const c = this.fillColor;
    c[o] = 1;
    c[o + 1] = 1;
    c[o + 2] = 1;
    c[o + 3] = 0;
    return true;
  }

  /**
   * One stroke (endpoints in mm in the frame of the tile's plot) into tile `slot`. `level` is the dust level of the
   * plot (s = min(1, depth16 / (16 level))). Returns 1 when an instance was written, 0 when the stroke does not reach
   * the tile, -1 when the batch is full.
   */
  pushStroke(
    layout: AtlasLayout,
    slot: number,
    su: number,
    sv: number,
    eu: number,
    ev: number,
    widthCm: number,
    depth16: number,
    level: number,
  ): number {
    const px = layout.slotPx;
    const ts = FRAME_EDGE_MM / px;
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
    if (this.strokeN === BATCH_MAX_STROKES) return -1;
    const ox = (slot % layout.cols) * px;
    const oy = Math.floor(slot / layout.cols) * px;
    const o = this.strokeN++ * 4;
    const r = this.strokeRect;
    r[o] = ox + x0;
    r[o + 1] = oy + y0;
    r[o + 2] = ox + x1 + 1;
    r[o + 3] = oy + y1 + 1;
    const g = this.strokeSeg;
    g[o] = su;
    g[o + 1] = sv;
    g[o + 2] = eu;
    g[o + 3] = ev;
    const p = this.strokePar;
    p[o] = hw;
    p[o + 1] = band;
    p[o + 2] = level <= 0 || depth16 >= 16 * level ? 1 : depth16 / (16 * level);
    p[o + 3] = KIND_STROKE;
    const q = this.strokeOrg;
    q[o] = ox;
    q[o + 1] = oy;
    q[o + 2] = 0;
    q[o + 3] = 0;
    return 1;
  }

  /** Ledger-zero clear: R <- 0 in the inclusive tile-texel rectangle of `slot`. False when the batch is full. */
  pushClear(layout: AtlasLayout, slot: number, x0: number, y0: number, x1: number, y1: number): boolean {
    if (this.strokeN === BATCH_MAX_STROKES) return false;
    const px = layout.slotPx;
    const ox = (slot % layout.cols) * px;
    const oy = Math.floor(slot / layout.cols) * px;
    const o = this.strokeN++ * 4;
    const r = this.strokeRect;
    r[o] = ox + x0;
    r[o + 1] = oy + y0;
    r[o + 2] = ox + x1 + 1;
    r[o + 3] = oy + y1 + 1;
    const g = this.strokeSeg;
    g[o] = 0;
    g[o + 1] = 0;
    g[o + 2] = 0;
    g[o + 3] = 0;
    const p = this.strokePar;
    p[o] = 0;
    p[o + 1] = 1;
    p[o + 2] = 0;
    p[o + 3] = KIND_CLEAR;
    const q = this.strokeOrg;
    q[o] = ox;
    q[o + 1] = oy;
    q[o + 2] = 0;
    q[o + 3] = 0;
    return true;
  }

  /**
   * Reserves residual index k for tile `slot` and returns the offset of its 1,024 RGBA cells in `ledgerCells`
   * (the caller fills them); -1 when the batch is full.
   */
  pushResidual(layout: AtlasLayout, slot: number): number {
    if (this.residN === BATCH_MAX_RESIDUALS) return -1;
    const px = layout.slotPx;
    const ox = (slot % layout.cols) * px;
    const oy = Math.floor(slot / layout.cols) * px;
    const k = this.residN++;
    const o = k * 4;
    const r = this.residRect;
    r[o] = ox;
    r[o + 1] = oy;
    r[o + 2] = ox + px;
    r[o + 3] = oy + px;
    const i = this.residInfo;
    i[o] = ox;
    i[o + 1] = oy;
    i[o + 2] = k;
    i[o + 3] = 0;
    return k * CELL_COUNT * 4;
  }
}

/** CPU reference of the atlas: executes batches with the arithmetic of the GPU pass. Tests and the verify page. */
export class CpuAtlas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  private readonly ts: number;
  private readonly cellPx: number;
  private readonly older = new Uint8Array(CELL_COUNT);

  constructor(readonly layout: AtlasLayout) {
    this.width = atlasWidth(layout);
    this.height = atlasHeight(layout);
    this.data = new Uint8Array(this.width * this.height * 4);
    this.ts = FRAME_EDGE_MM / layout.slotPx;
    this.cellPx = layout.slotPx / CELLS;
  }

  execute(batch: DustReplayBatch): void {
    const d = this.data;
    const w = this.width;
    for (let i = 0; i < batch.fillN; i++) {
      const o = i * 4;
      const r = Math.round(batch.fillColor[o]! * 255);
      const g = Math.round(batch.fillColor[o + 1]! * 255);
      const b = Math.round(batch.fillColor[o + 2]! * 255);
      const a = Math.round(batch.fillColor[o + 3]! * 255);
      const x1 = batch.fillRect[o + 2]!;
      const y1 = batch.fillRect[o + 3]!;
      for (let y = batch.fillRect[o + 1]!; y < y1; y++) {
        for (let x = batch.fillRect[o]!; x < x1; x++) {
          const p = (y * w + x) * 4;
          d[p] = r;
          d[p + 1] = g;
          d[p + 2] = b;
          d[p + 3] = a;
        }
      }
    }
    for (let i = 0; i < batch.strokeN; i++) this.stroke(batch, i * 4);
    for (let k = 0; k < batch.residN; k++) this.residual(batch, k);
  }

  private stroke(batch: DustReplayBatch, o: number): void {
    const d = this.data;
    const w = this.width;
    const ts = this.ts;
    const x0 = batch.strokeRect[o]!;
    const y0 = batch.strokeRect[o + 1]!;
    const x1 = batch.strokeRect[o + 2]!;
    const y1 = batch.strokeRect[o + 3]!;
    if (batch.strokePar[o + 3]! > 0.5) {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d[(y * w + x) * 4] = 0;
      return;
    }
    const su = batch.strokeSeg[o]!;
    const sv = batch.strokeSeg[o + 1]!;
    const hw = batch.strokePar[o]!;
    const band = batch.strokePar[o + 1]!;
    const s = batch.strokePar[o + 2]!;
    const ox = batch.strokeOrg[o]!;
    const oy = batch.strokeOrg[o + 1]!;
    const dx = batch.strokeSeg[o + 2]! - su;
    const dy = batch.strokeSeg[o + 3]! - sv;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ax = len === 0 ? 0 : dx / len;
    const ay = len === 0 ? 0 : dy / len;
    const h = ts / 2;
    for (let y = y0; y < y1; y++) {
      const wy = (y - oy + 0.5) * ts - FRAME_HALF_MM - sv;
      for (let x = x0; x < x1; x++) {
        const wx = (x - ox + 0.5) * ts - FRAME_HALF_MM - su;
        const p = (y * w + x) * 4;
        let c: number;
        let side: number;
        if (len === 0) {
          side = Math.sqrt(wx * wx + wy * wy);
          c = 0.5 + (hw - side) / ts;
          if (c > 1) c = 1;
        } else {
          const along = wx * ax + wy * ay;
          const cr = wy * ax - wx * ay;
          side = cr < 0 ? -cr : cr;
          const w1 = side + h < hw ? side + h : hw;
          const w0 = side - h > -hw ? side - h : -hw;
          const l1 = along + h < len ? along + h : len;
          const l0 = along - h > 0 ? along - h : 0;
          c = w1 > w0 && l1 > l0 ? ((w1 - w0) * (l1 - l0)) / (ts * ts) : 0;
          if (l1 <= l0) side = -1;
        }
        if (c > 0) {
          const r = d[p]! - Math.floor(255 * s * c + 0.5);
          d[p] = r > 0 ? r : 0;
          const g = d[p + 1]! - Math.floor(63.75 * c + 0.5);
          d[p + 1] = g > 0 ? g : 0;
        }
        const bx = (side - hw) / band;
        if (side >= 0 && bx > 0 && bx < 1) {
          const lip = Math.floor(255 * s * (bx < 0.35 ? bx / 0.35 : (1 - bx) / 0.65) + 0.5);
          if (lip > d[p + 3]!) d[p + 3] = lip;
        }
      }
    }
  }

  private residual(batch: DustReplayBatch, k: number): void {
    const d = this.data;
    const w = this.width;
    const cell = this.cellPx;
    const ox = batch.residInfo[k * 4]!;
    const oy = batch.residInfo[k * 4 + 1]!;
    const cells = batch.ledgerCells;
    const base = k * CELL_COUNT * 4;
    const older = this.older;
    // Every cell reads the tile as the stroke pass left it, then the subtraction is applied (two GPU passes).
    for (let b = 0; b < CELLS; b++) {
      for (let a = 0; a < CELLS; a++) {
        const ci = b * CELLS + a;
        let v = 0;
        if (cells[base + ci * 4 + 1]! > 127) {
          const rl = cells[base + ci * 4]!;
          if (rl === 0) v = 255;
          else {
            let sum = 0;
            for (let y = 0; y < cell; y++) {
              for (let x = 0; x < cell; x++) sum += d[((oy + b * cell + y) * w + ox + a * cell + x) * 4]!;
            }
            v = Math.floor(sum / (cell * cell) + 0.5) - rl;
            if (v < 0) v = 0;
          }
        }
        older[ci] = v;
      }
    }
    for (let b = 0; b < CELLS; b++) {
      for (let a = 0; a < CELLS; a++) {
        const v = older[b * CELLS + a]!;
        if (v === 0) continue;
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) {
            const p = ((oy + b * cell + y) * w + ox + a * cell + x) * 4;
            const r = d[p]! - v;
            d[p] = r > 0 ? r : 0;
          }
        }
      }
    }
  }
}
