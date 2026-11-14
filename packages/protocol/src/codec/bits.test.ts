import { describe, expect, it } from "vitest";
import { BitReader, BitWriter } from "./bits";

/** Deterministic PRNG (mulberry32) so failures reproduce. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("BitWriter / BitReader", () => {
  it("packs LSB-first (golden bytes)", () => {
    const w = new BitWriter(new Uint8Array(4));
    w.writeBits(0b101, 3);
    w.writeBits(0b11111, 5);
    w.writeBits(0x3ff, 10);
    w.align();
    expect(w.byteLength).toBe(3);
    // byte0 = 11111 101, byte1 = low 8 of 0x3ff, byte2 = high 2 bits of 0x3ff
    expect([...w.buffer.subarray(0, 3)]).toEqual([0b11111101, 0xff, 0b11]);
  });

  it("round-trips random unsigned and signed fields of 1-32 bits", () => {
    const next = rng(1234);
    const buf = new Uint8Array(4096);
    const w = new BitWriter(buf);
    const fields: Array<[number, number, boolean]> = [];
    for (let i = 0; i < 600; i++) {
      const bits = 1 + Math.floor(next() * 32);
      const signed = bits >= 2 && next() < 0.5;
      const max = 2 ** bits;
      let value = Math.floor(next() * max);
      if (signed) value -= 2 ** (bits - 1);
      fields.push([value, bits, signed]);
      if (signed) w.writeSigned(value, bits);
      else w.writeBits(value, bits);
    }
    expect(w.overflow).toBe(false);
    const r = new BitReader(buf.subarray(0, w.byteLength));
    for (const [value, bits, signed] of fields) {
      expect(signed ? r.readSigned(bits) : r.readBits(bits)).toBe(value);
    }
    expect(r.error).toBe(false);
  });

  it("clears stale bytes of a reused buffer", () => {
    const buf = new Uint8Array(2).fill(0xff);
    const w = new BitWriter(buf);
    w.writeBits(0, 3);
    w.writeBits(1, 1);
    w.align();
    expect(buf[0]).toBe(0b1000);
  });

  it("sets overflow instead of writing past the capacity", () => {
    const buf = new Uint8Array(2);
    const w = new BitWriter(buf);
    expect(w.writeBits(0xabc, 12)).toBe(true);
    expect(w.writeBits(0x3f, 6)).toBe(false);
    expect(w.overflow).toBe(true);
    expect(w.writeBits(1, 1)).toBe(false);
    expect(w.writeBytes(new Uint8Array(1))).toBe(false);
    w.reset();
    expect(w.overflow).toBe(false);
    expect(w.writeBytes(new Uint8Array([7, 8]))).toBe(true);
    expect(w.writeBytes(new Uint8Array([9]))).toBe(false);
  });

  it("reader flags truncation and returns 0 instead of throwing", () => {
    const r = new BitReader(new Uint8Array([0xff]));
    expect(r.readBits(6)).toBe(0x3f);
    expect(r.readBits(6)).toBe(0);
    expect(r.error).toBe(true);
    r.reset(new Uint8Array(2));
    r.skipBytes(3);
    expect(r.error).toBe(true);
  });
});
