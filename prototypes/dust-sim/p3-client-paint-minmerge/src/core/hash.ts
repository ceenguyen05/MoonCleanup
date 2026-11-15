// Hashes. The tile hash is a Zobrist-style XOR of a per-(texel, level) mix, so it updates in O(1) per changed texel on
// both sides and never needs a pass over the tile. A texel at LEVEL_MAX contributes 0, so an untouched tile hashes to 0.
// Hash values are SIGNED int32 inside the core (always a Smi on 64-bit Node, so a hash crossing a call boundary never
// allocates a heap number); the public getters convert to unsigned.
import { LEVEL_MAX } from "./constants";

/** Contribution of texel `i` holding shared level `v` (0..15). */
export function texelZ(i: number, v: number): number {
  if (v === LEVEL_MAX) return 0;
  let x = Math.imul((i << 4) | v, 0x9e3779b1) ^ 0x85ebca6b;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x | 0;
}

function fnvU32(h: number, v: number): number {
  let x = h;
  x = Math.imul(x ^ (v & 0xff), 0x01000193);
  x = Math.imul(x ^ ((v >>> 8) & 0xff), 0x01000193);
  x = Math.imul(x ^ ((v >>> 16) & 0xff), 0x01000193);
  x = Math.imul(x ^ (v >>> 24), 0x01000193);
  return x | 0;
}

/** World-hash contribution of a plot: fnv1a-32(plotId u32le, tileHash u32le); 0 for an untouched tile. */
export function plotMix(plot: number, tileHash: number): number {
  if (tileHash === 0) return 0;
  return fnvU32(fnvU32(0x811c9dc5 | 0, plot), tileHash);
}

/** Tile hash of a Polished plot (tile freed on both sides). */
export const POLISHED_HASH = 0x504f4c49;

const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = (CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
