// Synchronous raw-DEFLATE (RFC 1951) decoder for the dust bytes messages (DUST_SNAPSHOT, DUST_LEDGER) of online rooms.
// The server compresses with Node zlib `deflateRaw`; the browser's DecompressionStream is asynchronous, and the
// protocol session and the in-order dust mirror need a synchronous `Inflate`. Small, allocation-bounded, never throws:
// - the output never grows past `maxBytes` (a hostile stream returns null instead of a huge buffer);
// - reading past the input end, invalid block types, bad stored lengths, over-long codes and back-references before
//   the start of the output all return null;
// - every loop consumes input or output, so a corrupt stream terminates.
// Online-only: the solo path never imports this file (ADR-0031).

import type { Inflate } from "@moon-cleanup/protocol";

const LENGTH_BASE = new Uint16Array([
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
]);
const LENGTH_EXTRA = new Uint8Array([
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
]);
const DIST_BASE = new Uint16Array([
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577,
]);
const DIST_EXTRA = new Uint8Array([
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
]);
const CLEN_ORDER = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

class Fail extends Error {}
const FAIL = new Fail("inflate");

/** Canonical Huffman table: code counts per length and symbols in code order. */
class Tree {
  readonly counts = new Uint16Array(16);
  readonly symbols: Uint16Array;
  constructor(size: number) {
    this.symbols = new Uint16Array(size);
  }
  build(lengths: Uint8Array, offset: number, n: number): void {
    const counts = this.counts;
    counts.fill(0);
    for (let i = 0; i < n; i++) counts[lengths[offset + i]!]!++;
    counts[0] = 0;
    // Over-subscribed code sets are invalid (RFC 1951 3.2.2); incomplete sets are allowed (single-code distance trees).
    let left = 1;
    for (let len = 1; len < 16; len++) {
      left = (left << 1) - counts[len]!;
      if (left < 0) throw FAIL;
    }
    const offs = new Uint16Array(16);
    for (let len = 1; len < 16; len++) offs[len] = offs[len - 1]! + counts[len - 1]!;
    for (let i = 0; i < n; i++) {
      const l = lengths[offset + i]!;
      if (l !== 0) this.symbols[offs[l]!++] = i;
    }
  }
}

class Inflater {
  private pos = 0;
  private bitBuf = 0;
  private bitCount = 0;
  out: Uint8Array;
  outLen = 0;
  private readonly lit = new Tree(288);
  private readonly dist = new Tree(32);
  private readonly lengths = new Uint8Array(288 + 32);

  constructor(
    private readonly src: Uint8Array,
    private readonly maxBytes: number,
  ) {
    this.out = new Uint8Array(Math.min(maxBytes, Math.max(1024, src.length * 4)));
  }

  private bits(n: number): number {
    while (this.bitCount < n) {
      if (this.pos >= this.src.length) throw FAIL;
      this.bitBuf |= this.src[this.pos++]! << this.bitCount;
      this.bitCount += 8;
    }
    const v = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCount -= n;
    return v;
  }

  private symbol(t: Tree): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= this.bits(1);
      const count = t.counts[len]!;
      if (code - first < count) return t.symbols[index + code - first]!;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw FAIL;
  }

  private ensure(extra: number): void {
    const need = this.outLen + extra;
    if (need > this.maxBytes) throw FAIL;
    if (need <= this.out.length) return;
    let cap = this.out.length * 2;
    while (cap < need) cap *= 2;
    const grown = new Uint8Array(Math.min(cap, this.maxBytes));
    grown.set(this.out.subarray(0, this.outLen));
    this.out = grown;
  }

  run(): void {
    let final = 0;
    while (final === 0) {
      final = this.bits(1);
      const type = this.bits(2);
      if (type === 0) this.stored();
      else if (type === 1) {
        this.fixedTrees();
        this.block();
      } else if (type === 2) {
        this.dynamicTrees();
        this.block();
      } else throw FAIL;
    }
  }

  private stored(): void {
    this.bitBuf = 0;
    this.bitCount = 0;
    const s = this.src;
    if (this.pos + 4 > s.length) throw FAIL;
    const len = s[this.pos]! | (s[this.pos + 1]! << 8);
    const nlen = s[this.pos + 2]! | (s[this.pos + 3]! << 8);
    this.pos += 4;
    if ((len ^ 0xffff) !== nlen || this.pos + len > s.length) throw FAIL;
    this.ensure(len);
    this.out.set(s.subarray(this.pos, this.pos + len), this.outLen);
    this.outLen += len;
    this.pos += len;
  }

  private fixedTrees(): void {
    const l = this.lengths;
    l.fill(8, 0, 144);
    l.fill(9, 144, 256);
    l.fill(7, 256, 280);
    l.fill(8, 280, 288);
    this.lit.build(l, 0, 288);
    l.fill(5, 0, 30);
    this.dist.build(l, 0, 30);
  }

  private dynamicTrees(): void {
    const hlit = this.bits(5) + 257;
    const hdist = this.bits(5) + 1;
    const hclen = this.bits(4) + 4;
    if (hlit > 286 || hdist > 30) throw FAIL;
    const l = this.lengths;
    l.fill(0, 0, 19);
    for (let i = 0; i < hclen; i++) l[CLEN_ORDER[i]!] = this.bits(3);
    const clen = new Tree(19);
    clen.build(l, 0, 19);
    const total = hlit + hdist;
    l.fill(0, 0, total);
    let n = 0;
    while (n < total) {
      const sym = this.symbol(clen);
      if (sym < 16) {
        l[n++] = sym;
        continue;
      }
      let rep: number;
      let val = 0;
      if (sym === 16) {
        if (n === 0) throw FAIL;
        val = l[n - 1]!;
        rep = 3 + this.bits(2);
      } else if (sym === 17) rep = 3 + this.bits(3);
      else rep = 11 + this.bits(7);
      if (n + rep > total) throw FAIL;
      l.fill(val, n, n + rep);
      n += rep;
    }
    if (l[256] === 0) throw FAIL; // no end-of-block code
    this.lit.build(l, 0, hlit);
    this.dist.build(l, hlit, hdist);
  }

  private block(): void {
    for (;;) {
      const sym = this.symbol(this.lit);
      if (sym < 256) {
        this.ensure(1);
        this.out[this.outLen++] = sym;
        continue;
      }
      if (sym === 256) return;
      const li = sym - 257;
      if (li >= 29) throw FAIL;
      const len = LENGTH_BASE[li]! + this.bits(LENGTH_EXTRA[li]!);
      const di = this.symbol(this.dist);
      if (di >= 30) throw FAIL;
      const d = DIST_BASE[di]! + this.bits(DIST_EXTRA[di]!);
      if (d > this.outLen) throw FAIL;
      this.ensure(len);
      const out = this.out;
      let from = this.outLen - d;
      for (let k = 0; k < len; k++) out[this.outLen++] = out[from++]!;
    }
  }
}

/** Inflates a raw DEFLATE stream. Null on corrupt input or when the output would exceed `maxBytes`. Never throws. */
export const inflateRaw: Inflate = (data, maxBytes) => {
  if (!(maxBytes > 0) || data.byteLength === 0) return null;
  const inf = new Inflater(data, maxBytes);
  try {
    inf.run();
  } catch {
    return null;
  }
  return inf.out.length === inf.outLen ? inf.out : inf.out.slice(0, inf.outLen);
};
