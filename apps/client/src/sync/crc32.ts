// Incremental CRC32 (IEEE 802.3, as zlib and the save envelope). The sync code checksums up to a few MiB of dust
// chunks on the main thread, so the state can be carried across time slices (yield between chunks).

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Initial running state. */
export const CRC32_INIT = 0xffffffff;

/** Feeds `bytes[start, end)` into a running state and returns the new state (not yet finalized). */
export function crc32Update(state: number, bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = state;
  for (let i = start; i < end; i++) c = (TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return c >>> 0;
}

/** Final unsigned CRC32 of a running state. */
export function crc32Final(state: number): number {
  return (state ^ 0xffffffff) >>> 0;
}

/** CRC32 of `bytes[start, end)` in one go. */
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  return crc32Final(crc32Update(CRC32_INIT, bytes, start, end));
}
