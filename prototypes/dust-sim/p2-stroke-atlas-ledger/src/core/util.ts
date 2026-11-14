// P2 prototype: small shared helpers (frame-to-frame transform, byte writer/reader, logged ledger op).
// Environment-agnostic; nothing here allocates per call except ByteWriter growth.

import { STATE_POLISHED, type DustView } from "./dust-view";
import type { StrokeLog } from "./stroke-log";
import type { PlotTables } from "./tables";

/** Plot-local mm (u, v) of plot `from` expressed in the frame of plot `to`, rounded to mm, into out[0], out[1]. */
export function xform(t: PlotTables, from: number, u: number, v: number, to: number, out: Int32Array): void {
  const c = t.centers;
  const e = t.east;
  const n = t.north;
  const k = 1 / 1000 / t.radiusM;
  const a = u * k;
  const b = v * k;
  let o = from * 3;
  const x = c[o]! + a * e[o]! + b * n[o]!;
  const y = c[o + 1]! + a * e[o + 1]! + b * n[o + 1]!;
  const z = c[o + 2]! + a * e[o + 2]! + b * n[o + 2]!;
  const l = Math.sqrt(x * x + y * y + z * z);
  const px = x / l;
  const py = y / l;
  const pz = z / l;
  o = to * 3;
  const nx = c[o]!;
  const ny = c[o + 1]!;
  const nz = c[o + 2]!;
  const dn = px * nx + py * ny + pz * nz;
  const gx = px / dn - nx;
  const gy = py / dn - ny;
  const gz = pz / dn - nz;
  const s = t.radiusM * 1000;
  out[0] = Math.round(s * (gx * e[o]! + gy * e[o + 1]! + gz * e[o + 2]!));
  out[1] = Math.round(s * (gx * n[o]! + gy * n[o + 1]! + gz * n[o + 2]!));
}

/** Unit direction of plot-local mm (u, v) in the frame of `plot`, into out[0 .. 2]. */
export function dirOf(t: PlotTables, plot: number, u: number, v: number, out: Float64Array): void {
  const k = 1 / 1000 / t.radiusM;
  const a = u * k;
  const b = v * k;
  const o = plot * 3;
  const x = t.centers[o]! + a * t.east[o]! + b * t.north[o]!;
  const y = t.centers[o + 1]! + a * t.east[o + 1]! + b * t.north[o + 1]!;
  const z = t.centers[o + 2]! + a * t.east[o + 2]! + b * t.north[o + 2]!;
  const l = Math.sqrt(x * x + y * y + z * z);
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
}

/** Applies a stroke to `view` and appends it to the log ring of every overlapped plot that has a ledger. */
export function applyLogged(
  view: DustView,
  log: StrokeLog | null,
  anchor: number,
  sU: number,
  sV: number,
  eU: number,
  eV: number,
  widthCm: number,
  depth16: number,
  toolCode: number,
  actor: number,
): number {
  const removed = view.applyStroke(anchor, sU, sV, eU, eV, widthCm, depth16, actor);
  if (log !== null) {
    for (let i = 0; i < view.outN; i++) {
      const q = view.outPlots[i]!;
      if (view.slotOf[q]! >= 0) log.push(q, anchor, sU, sV, eU, eV, widthCm, depth16, toolCode, actor);
      else if (view.state[q] === STATE_POLISHED) log.drop(q);
    }
  }
  return removed;
}

/** Receives every stroke a client view applied (tile replay work lists). Called after DustView.applyStroke. */
export interface StrokeSink {
  onStroke(anchor: number, sU: number, sV: number, eU: number, eV: number, widthCm: number, depth16: number): void;
}

/** Compression hooks. The core defaults to identity; the Node adapter injects zlib deflate (level 6). */
export interface Codec {
  deflate(bytes: Uint8Array): Uint8Array;
  inflate(bytes: Uint8Array): Uint8Array;
}

export const IDENTITY_CODEC: Codec = { deflate: (b) => b.slice(), inflate: (b) => b };

export class ByteWriter {
  buf: Uint8Array;
  len = 0;
  constructor(cap = 1024) {
    this.buf = new Uint8Array(cap);
  }
  private need(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const g = new Uint8Array(cap);
    g.set(this.buf.subarray(0, this.len));
    this.buf = g;
  }
  reset(): void {
    this.len = 0;
  }
  u8(v: number): void {
    this.need(1);
    this.buf[this.len++] = v;
  }
  u16(v: number): void {
    this.need(2);
    this.buf[this.len++] = v;
    this.buf[this.len++] = v >>> 8;
  }
  u24(v: number): void {
    this.need(3);
    this.buf[this.len++] = v;
    this.buf[this.len++] = v >>> 8;
    this.buf[this.len++] = v >>> 16;
  }
  u32(v: number): void {
    this.need(4);
    this.buf[this.len++] = v;
    this.buf[this.len++] = v >>> 8;
    this.buf[this.len++] = v >>> 16;
    this.buf[this.len++] = v >>> 24;
  }
  bytes(src: Uint8Array, off: number, n: number): void {
    this.need(n);
    // A plain loop: subarray() would allocate a view object per call (this runs per client per frame).
    const buf = this.buf;
    const at = this.len;
    for (let i = 0; i < n; i++) buf[at + i] = src[off + i]!;
    this.len += n;
  }
  /** Copy of the written bytes. */
  take(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

export class ByteReader {
  pos = 0;
  constructor(public buf: Uint8Array) {}
  u8(): number {
    return this.buf[this.pos++]!;
  }
  u16(): number {
    const v = this.buf[this.pos]! | (this.buf[this.pos + 1]! << 8);
    this.pos += 2;
    return v;
  }
  u24(): number {
    const v = this.buf[this.pos]! | (this.buf[this.pos + 1]! << 8) | (this.buf[this.pos + 2]! << 16);
    this.pos += 3;
    return v;
  }
  u32(): number {
    const v =
      (this.buf[this.pos]! |
        (this.buf[this.pos + 1]! << 8) |
        (this.buf[this.pos + 2]! << 16) |
        (this.buf[this.pos + 3]! << 24)) >>>
      0;
    this.pos += 4;
    return v;
  }
}
