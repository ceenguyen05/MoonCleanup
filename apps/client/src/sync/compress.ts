// Stream compression helpers (CompressionStream / DecompressionStream, every target browser and Node 18+). The
// browser runs the codec off the main thread; these wrappers only schedule it. Decompression is always CAPPED: the
// bytes come from the network or from disk and a tiny stream may expand without bound.

export type CompressionFormat = "gzip" | "deflate";

export function hasCompressionStreams(): boolean {
  return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
}

export class InflateLimitError extends RangeError {
  override readonly name = "InflateLimitError";
}

async function readAll(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new InflateLimitError(`output exceeds ${maxBytes} bytes`);
    }
    parts.push(value);
  }
  if (parts.length === 1) return parts[0] as Uint8Array;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function streamOf(bytes: Uint8Array) {
  return new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
}

/** Compresses `bytes` (output capped at `maxBytes`, default 64 MiB, a safety net only). */
export function compress(bytes: Uint8Array, format: CompressionFormat, maxBytes = 64 * 1024 * 1024) {
  return readAll(streamOf(bytes).pipeThrough(new CompressionStream(format)), maxBytes);
}

/** Decompresses `bytes`; rejects with InflateLimitError as soon as the output passes `maxBytes`, and on a bad stream. */
export function decompress(bytes: Uint8Array, format: CompressionFormat, maxBytes: number): Promise<Uint8Array> {
  return readAll(streamOf(bytes).pipeThrough(new DecompressionStream(format)), maxBytes);
}
