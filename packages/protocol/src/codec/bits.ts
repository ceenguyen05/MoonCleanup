// Bit-level writer and reader over caller-owned byte buffers (netcode.md section 2: little-endian, bit-packed
// sections, byte-aligned at record boundaries). Bits are packed LSB-first: bit k of the stream is bit (k & 7) of
// byte (k >> 3). Both classes are reusable (`reset`) and never allocate after construction.
//
// Failure model: the writer never writes past its capacity and the reader never reads past its limit. Overruns set a
// sticky flag (`overflow` / `error`) instead of throwing, so a hot-path encoder or a decoder of untrusted input can
// finish the call and check one flag.

/** Writes bit fields into a fixed buffer. */
export class BitWriter {
  /** Write position in bits. */
  bitPos = 0;
  /** Set when a write did not fit; later writes are ignored until `reset`. */
  overflow = false;
  private buf: Uint8Array;
  private capacityBits: number;

  constructor(buffer: Uint8Array) {
    this.buf = buffer;
    this.capacityBits = buffer.byteLength * 8;
  }

  /** The buffer being written. */
  get buffer(): Uint8Array {
    return this.buf;
  }

  /** Bytes used so far, rounding a partial byte up. */
  get byteLength(): number {
    return (this.bitPos + 7) >>> 3;
  }

  /** Starts over on the same buffer, or on `buffer` when given. Old contents are overwritten as bits are written. */
  reset(buffer?: Uint8Array): void {
    if (buffer !== undefined) {
      this.buf = buffer;
      this.capacityBits = buffer.byteLength * 8;
    }
    this.bitPos = 0;
    this.overflow = false;
  }

  /** Bits still free. */
  remainingBits(): number {
    return this.capacityBits - this.bitPos;
  }

  /**
   * Writes the low `bits` bits (1-32) of `value` as an unsigned field. Values outside the range wrap (the caller
   * clamps/quantizes first). Returns false and sets `overflow` when the field does not fit.
   */
  writeBits(value: number, bits: number): boolean {
    if (this.overflow) return false;
    if (this.bitPos + bits > this.capacityBits) {
      this.overflow = true;
      return false;
    }
    // Integer-only arithmetic: no double intermediates, so V8 never boxes a HeapNumber on the hot path.
    let v = (value & (0xffffffff >>> (32 - bits))) >>> 0;
    let remaining = bits;
    const buf = this.buf;
    while (remaining > 0) {
      const byteIndex = this.bitPos >>> 3;
      const bitOff = this.bitPos & 7;
      const take = Math.min(8 - bitOff, remaining);
      const chunk = v & ((1 << take) - 1);
      // A fresh byte is assigned (clears stale data of a reused buffer); a partial byte is OR-ed.
      buf[byteIndex] = bitOff === 0 ? chunk : (buf[byteIndex] ?? 0) | (chunk << bitOff);
      v = v >>> take;
      remaining -= take;
      this.bitPos += take;
    }
    return true;
  }

  /** Writes a two's-complement signed field of `bits` bits (2-32). `value` must already be in range. */
  writeSigned(value: number, bits: number): boolean {
    return this.writeBits(value, bits); // masking an int32 yields the two's-complement field
  }

  /** Writes a single bit. */
  writeBool(value: boolean): boolean {
    return this.writeBits(value ? 1 : 0, 1);
  }

  /** Pads with zero bits to the next byte boundary (record boundaries are byte-aligned). */
  align(): boolean {
    const pad = (8 - (this.bitPos & 7)) & 7;
    return pad === 0 ? !this.overflow : this.writeBits(0, pad);
  }

  /** Byte-aligned write of `bytes`. Returns false (and sets `overflow`) when it does not fit. */
  writeBytes(bytes: Uint8Array): boolean {
    if (!this.align()) return false;
    const start = this.bitPos >>> 3;
    if (start + bytes.byteLength > this.buf.byteLength) {
      this.overflow = true;
      return false;
    }
    this.buf.set(bytes, start);
    this.bitPos += bytes.byteLength * 8;
    return true;
  }
}

/** Reads bit fields from a byte view. */
export class BitReader {
  /** Read position in bits. */
  bitPos = 0;
  /** Set when a read went past the end; reads then return 0 until `reset`. */
  error = false;
  private buf: Uint8Array = new Uint8Array(0);
  private limitBits = 0;

  constructor(buffer?: Uint8Array) {
    if (buffer !== undefined) this.reset(buffer);
  }

  reset(buffer: Uint8Array): void {
    this.buf = buffer;
    this.limitBits = buffer.byteLength * 8;
    this.bitPos = 0;
    this.error = false;
  }

  remainingBits(): number {
    return this.limitBits - this.bitPos;
  }

  /** Reads an unsigned field of `bits` bits (1-32). Returns 0 and sets `error` past the end. */
  readBits(bits: number): number {
    if (this.error) return 0;
    if (this.bitPos + bits > this.limitBits) {
      this.error = true;
      return 0;
    }
    let result = 0;
    let shift = 0;
    let remaining = bits;
    const buf = this.buf;
    while (remaining > 0) {
      const byteIndex = this.bitPos >>> 3;
      const bitOff = this.bitPos & 7;
      const take = Math.min(8 - bitOff, remaining);
      const chunk = ((buf[byteIndex] ?? 0) >>> bitOff) & ((1 << take) - 1);
      result |= chunk << shift;
      shift += take;
      remaining -= take;
      this.bitPos += take;
    }
    return result >>> 0;
  }

  /** Reads a two's-complement signed field of `bits` bits (2-32). */
  readSigned(bits: number): number {
    const u = this.readBits(bits);
    return bits === 32 ? u | 0 : (u << (32 - bits)) >> (32 - bits);
  }

  readBool(): boolean {
    return this.readBits(1) === 1;
  }

  /** Skips to the next byte boundary. */
  align(): void {
    const pad = (8 - (this.bitPos & 7)) & 7;
    if (pad > 0) this.readBits(pad);
  }

  /** Skips `bytes` whole bytes after aligning. Sets `error` past the end. */
  skipBytes(bytes: number): void {
    this.align();
    if (this.bitPos + bytes * 8 > this.limitBits) {
      this.error = true;
      return;
    }
    this.bitPos += bytes * 8;
  }
}
