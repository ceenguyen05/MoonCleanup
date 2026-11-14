import { PING_GOLDEN_VECTORS, PONG_GOLDEN_VECTORS } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import {
  PING_BODY_BYTES,
  PONG_BODY_BYTES,
  decodePing,
  decodePong,
  encodePing,
  encodePong,
  readPingBody,
  readPongBody,
  rttFromPong,
  toU32,
  writePingBody,
  writePongBody,
  type PongTarget,
} from "./ping";

describe("PING codec", () => {
  it("matches every golden vector both ways", () => {
    const out = new Uint8Array(16);
    for (const v of PING_GOLDEN_VECTORS) {
      const n = encodePing(v.payload.clientTimeMs, out);
      expect([...out.subarray(0, n)]).toEqual(v.bytes);
      expect(decodePing(Uint8Array.from(v.bytes))).toBe(v.payload.clientTimeMs);
      expect(readPingBody(Uint8Array.from(v.bytes.slice(1)))).toBe(v.payload.clientTimeMs);
    }
  });

  it("round-trips random u32 values through the body form", () => {
    const body = new Uint8Array(PING_BODY_BYTES);
    for (let i = 0; i < 1000; i++) {
      const value = Math.floor(Math.random() * 0x1_0000_0000);
      writePingBody(value, body);
      expect(readPingBody(body)).toBe(value);
    }
  });

  it("rejects truncated, oversized and wrong-id input without throwing", () => {
    for (let len = 0; len < 12; len++) {
      const bytes = new Uint8Array(len).fill(0xff);
      if (len !== PING_BODY_BYTES) expect(readPingBody(bytes)).toBe(-1);
      bytes[0] = 0x02;
      if (len !== 5) expect(decodePing(bytes)).toBe(-1);
    }
    expect(decodePing(Uint8Array.from([0x27, 0, 0, 0, 0]))).toBe(-1);
  });

  it("wraps non-u32 clocks instead of writing garbage", () => {
    expect(toU32(-1)).toBe(0xffffffff);
    expect(toU32(0x1_0000_0005)).toBe(5);
    expect(toU32(Number.NaN)).toBe(0);
    expect(toU32(12.9)).toBe(12);
  });

  it("refuses to write into a buffer that is too small", () => {
    expect(() => encodePing(1, new Uint8Array(4))).toThrow(RangeError);
  });
});

describe("PONG codec", () => {
  it("matches every golden vector both ways", () => {
    const out = new Uint8Array(16);
    const target: PongTarget = { clientTimeMs: -1, serverTick: -1 };
    for (const v of PONG_GOLDEN_VECTORS) {
      const n = encodePong(v.payload, out);
      expect([...out.subarray(0, n)]).toEqual(v.bytes);
      expect(decodePong(Uint8Array.from(v.bytes), target)).toBe(true);
      expect(target).toEqual(v.payload);
      expect(readPongBody(Uint8Array.from(v.bytes.slice(1)), target)).toBe(true);
      expect(target).toEqual(v.payload);
    }
  });

  it("round-trips random payloads through the body form", () => {
    const body = new Uint8Array(PONG_BODY_BYTES);
    const target: PongTarget = { clientTimeMs: 0, serverTick: 0 };
    for (let i = 0; i < 1000; i++) {
      const p = {
        clientTimeMs: Math.floor(Math.random() * 0x1_0000_0000),
        serverTick: Math.floor(Math.random() * 0x1_0000_0000),
      };
      writePongBody(p, body);
      expect(readPongBody(body, target)).toBe(true);
      expect(target).toEqual(p);
    }
  });

  it("rejects corrupt input and leaves the target untouched", () => {
    const target: PongTarget = { clientTimeMs: 7, serverTick: 7 };
    for (let len = 0; len < 16; len++) {
      const bytes = new Uint8Array(len).fill(0x27);
      if (len !== PONG_BODY_BYTES) expect(readPongBody(bytes, target)).toBe(false);
      if (len !== 9) expect(decodePong(bytes, target)).toBe(false);
    }
    expect(decodePong(new Uint8Array(9), target)).toBe(false);
    expect(target).toEqual({ clientTimeMs: 7, serverTick: 7 });
  });
});

describe("rttFromPong", () => {
  it("is wrap-safe across the u32 boundary", () => {
    expect(rttFromPong(10, 0xfffffff6)).toBe(20);
    expect(rttFromPong(1500, 1380)).toBe(120);
  });

  it("rejects echoes from the future or older than the limit", () => {
    expect(rttFromPong(1000, 1200)).toBe(-1);
    expect(rttFromPong(100_000, 10_000)).toBe(-1);
  });
});
