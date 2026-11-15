// Reusable byte writer / reader. Growth is the only allocation and happens a handful of times per session.

export class ByteWriter {
  buf: Uint8Array;
  pos = 0;
  private nibHalf = false;

  constructor(capacity = 1024) {
    this.buf = new Uint8Array(capacity);
  }

  reset(): void {
    this.pos = 0;
    this.nibHalf = false;
  }

  ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.pos++] = v & 0xff;
  }

  u16(v: number): void {
    this.ensure(2);
    this.buf[this.pos++] = v & 0xff;
    this.buf[this.pos++] = (v >>> 8) & 0xff;
  }

  u24(v: number): void {
    this.ensure(3);
    this.buf[this.pos++] = v & 0xff;
    this.buf[this.pos++] = (v >>> 8) & 0xff;
    this.buf[this.pos++] = (v >>> 16) & 0xff;
  }

  u32(v: number): void {
    this.ensure(4);
    this.buf[this.pos++] = v & 0xff;
    this.buf[this.pos++] = (v >>> 8) & 0xff;
    this.buf[this.pos++] = (v >>> 16) & 0xff;
    this.buf[this.pos++] = (v >>> 24) & 0xff;
  }

  /** LEB128, values below 2^28. */
  varint(v: number): void {
    let x = v;
    while (x >= 0x80) {
      this.u8((x & 0x7f) | 0x80);
      x >>>= 7;
    }
    this.u8(x);
  }

  /** Overwrites a byte written earlier (section counts). */
  patchU8(at: number, v: number): void {
    this.buf[at] = v & 0xff;
  }

  patchU16(at: number, v: number): void {
    this.buf[at] = v & 0xff;
    this.buf[at + 1] = (v >>> 8) & 0xff;
  }

  /** Nibble stream: low nibble first; call nibEnd() after the last one. */
  nib(v: number): void {
    if (this.nibHalf) {
      this.buf[this.pos - 1] = (this.buf[this.pos - 1] ?? 0) | ((v & 15) << 4);
      this.nibHalf = false;
    } else {
      this.ensure(1);
      this.buf[this.pos++] = v & 15;
      this.nibHalf = true;
    }
  }

  nibEnd(): void {
    this.nibHalf = false;
  }

  bytes(src: Uint8Array, start: number, end: number): void {
    const n = end - start;
    this.ensure(n);
    for (let i = 0; i < n; i++) this.buf[this.pos + i] = src[start + i] ?? 0;
    this.pos += n;
  }
}

export class ByteReader {
  buf: Uint8Array = EMPTY;
  pos = 0;
  end = 0;
  /** Set when a read ran past the end; every later read returns 0. */
  bad = false;
  private nibHalf = false;

  load(buf: Uint8Array, start: number, end: number): void {
    this.buf = buf;
    this.pos = start;
    this.end = end;
    this.bad = false;
    this.nibHalf = false;
  }

  get remaining(): number {
    return this.end - this.pos;
  }

  u8(): number {
    if (this.pos >= this.end) {
      this.bad = true;
      return 0;
    }
    return this.buf[this.pos++] ?? 0;
  }

  u16(): number {
    const a = this.u8();
    return a | (this.u8() << 8);
  }

  u24(): number {
    const a = this.u16();
    return a | (this.u8() << 16);
  }

  u32(): number {
    const a = this.u16();
    return (a | (this.u16() << 16)) >>> 0;
  }

  varint(): number {
    let shift = 0;
    let v = 0;
    for (;;) {
      const b = this.u8();
      v |= (b & 0x7f) << shift;
      if (b < 0x80 || this.bad || shift > 21) return v;
      shift += 7;
    }
  }

  nib(): number {
    if (this.nibHalf) {
      this.nibHalf = false;
      return ((this.buf[this.pos - 1] ?? 0) >> 4) & 15;
    }
    const b = this.u8();
    this.nibHalf = true;
    return b & 15;
  }

  nibEnd(): void {
    this.nibHalf = false;
  }

  skip(n: number): void {
    if (this.pos + n > this.end) {
      this.bad = true;
      this.pos = this.end;
      return;
    }
    this.pos += n;
  }
}

const EMPTY = new Uint8Array(0);

/**
 * Reusable list. `array.length = 0` drops the backing store in V8, so the next push allocates a new one; this keeps
 * the store and only moves a counter. Entries at or beyond `count` are stale.
 */
export class Bag<T> {
  readonly items: T[] = [];
  count = 0;

  push(v: T): void {
    if (this.count < this.items.length) this.items[this.count] = v;
    else this.items.push(v);
    this.count++;
  }

  clear(): void {
    this.count = 0;
  }

  /** Swap-removes the first occurrence of `v`. */
  remove(v: T): void {
    for (let k = 0; k < this.count; k++) {
      if (this.items[k] !== v) continue;
      this.items[k] = this.items[this.count - 1] as T;
      this.count--;
      return;
    }
  }
}

/** Bytes of `count` packed nibbles. */
export const nibBytes = (count: number): number => (count + 1) >> 1;
