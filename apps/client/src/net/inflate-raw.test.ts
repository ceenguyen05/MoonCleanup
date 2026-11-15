// The client raw inflater against Node zlib: every level and strategy, random and structured data (dust-like), and
// hostile input (truncation, bit flips, size caps) that must return null without throwing.
import { constants, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { inflateRaw } from "./inflate-raw";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
}

function sample(r: () => number, kind: number, n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (kind === 0)
      b[i] = Math.floor(r() * 256); // incompressible
    else if (kind === 1)
      b[i] = r() < 0.9 ? 80 : Math.floor(r() * 8) * 10; // ledger-like texels
    else if (kind === 2)
      b[i] = i % 4 === 0 ? Math.floor(r() * 4) : 0; // plot states, mostly zero
    else b[i] = "Clean The Moon! ".charCodeAt(i % 16) ^ (r() < 0.02 ? 1 : 0); // long repeats
  }
  return b;
}

describe("inflateRaw (client, synchronous)", () => {
  it("decodes Node zlib deflateRaw output byte-exactly for every level, strategy and data kind", () => {
    const r = rng(7);
    let cases = 0;
    for (const n of [1, 17, 1000, 46_248, 140_000]) {
      for (let kind = 0; kind < 4; kind++) {
        const raw = sample(r, kind, n);
        for (const level of [0, 1, 6, 9]) {
          for (const strategy of [constants.Z_DEFAULT_STRATEGY, constants.Z_FIXED, constants.Z_HUFFMAN_ONLY]) {
            const z = deflateRawSync(raw, { level, strategy });
            const out = inflateRaw(z, 1 << 20);
            expect(out).not.toBeNull();
            expect(Buffer.from(out!).equals(Buffer.from(raw))).toBe(true);
            cases++;
          }
        }
      }
    }
    expect(cases).toBe(5 * 4 * 4 * 3);
  });

  it("enforces maxBytes: exactly the size passes, one byte less is refused", () => {
    const raw = sample(rng(3), 1, 5000);
    const z = deflateRawSync(raw);
    expect(inflateRaw(z, 5000)?.length).toBe(5000);
    expect(inflateRaw(z, 4999)).toBeNull();
    // A tiny stream that expands to megabytes is cut off at the cap.
    const bomb = deflateRawSync(new Uint8Array(4 << 20));
    expect(bomb.length).toBeLessThan(8000);
    expect(inflateRaw(bomb, 1 << 20)).toBeNull();
  });

  it("never throws on truncated, bit-flipped or random input", () => {
    const r = rng(11);
    const raw = sample(r, 1, 20_000);
    const z = deflateRawSync(raw, { level: 6 });
    for (let cut = 0; cut < z.length; cut += Math.max(1, Math.floor(z.length / 300))) {
      const out = inflateRaw(z.subarray(0, cut), 1 << 20);
      if (out !== null) expect(out.length).toBeLessThanOrEqual(raw.length);
    }
    for (let k = 0; k < 2000; k++) {
      const bad = Uint8Array.from(z);
      bad[Math.floor(r() * bad.length)]! ^= 1 << Math.floor(r() * 8);
      expect(() => inflateRaw(bad, 1 << 20)).not.toThrow();
    }
    for (let k = 0; k < 2000; k++) {
      const junk = sample(r, 0, 1 + Math.floor(r() * 400));
      expect(() => inflateRaw(junk, 1 << 16)).not.toThrow();
    }
    expect(inflateRaw(new Uint8Array(0), 100)).toBeNull();
    expect(inflateRaw(z, 0)).toBeNull();
  });

  it("is fast enough for a worst-case join snapshot on the main thread", () => {
    const raw = sample(rng(5), 1, 250_000);
    const z = deflateRawSync(raw, { level: 6 });
    for (let i = 0; i < 3; i++) inflateRaw(z, 1 << 20);
    const t = performance.now();
    const runs = 10;
    for (let i = 0; i < runs; i++) inflateRaw(z, 1 << 20);
    const ms = (performance.now() - t) / runs;
    console.info(`[inflateRaw] 250 KB raw (${z.length} B deflated): ${ms.toFixed(2)} ms per inflate`);
    expect(ms).toBeLessThan(50);
  });
});
