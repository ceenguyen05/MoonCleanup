// DataView access without per-call allocation.

const viewCache = new WeakMap<ArrayBufferLike, DataView>();

/**
 * A DataView whose index 0 is `bytes[0]`. Views starting at offset 0 of their buffer are cached per underlying buffer,
 * so hot calls on a reused buffer allocate nothing; a view with a non-zero `byteOffset` allocates (cold paths only).
 */
export function viewOf(bytes: Uint8Array): DataView {
  if (bytes.byteOffset === 0) {
    let v = viewCache.get(bytes.buffer);
    if (v === undefined || v.byteLength !== bytes.buffer.byteLength) {
      v = new DataView(bytes.buffer);
      viewCache.set(bytes.buffer, v);
    }
    return v;
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
