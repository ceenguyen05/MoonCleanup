import { MESSAGE_CATALOG, MessageStatus } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import {
  SPIKE_DUST_HEADER_BYTES,
  SPIKE_DUST_ID,
  SPIKE_FRAME_HEADER_BYTES,
  SPIKE_FRAME_ID,
  SPIKE_FRAME_MAX_BODY_BYTES,
  SPIKE_INPUT_ID,
  SPIKE_INPUT_MAX_BODY_BYTES,
  createSpikeDustHeader,
  createSpikeFrameHeader,
  createSpikeInput,
  readSpikeDustHeader,
  readSpikeFrameHeader,
  readSpikeInputBody,
  spikeDustBodyLength,
  writeSpikeDustHeader,
  writeSpikeFrameHeader,
  writeSpikeInputBody,
  type SpikeInput,
} from "./spike";

/** Golden SPIKE_INPUT body: one input. seq 0x1234, moveX -5, moveY 127, yaw 0xBEEF, pitch -90, buttons 0x1009, tool 200. */
const GOLDEN_INPUT_ONE = [0x01, 0x34, 0x12, 0xfb, 0x7f, 0xef, 0xbe, 0xa6, 0x09, 0x10, 0xc8] as const;

function input(partial: Partial<SpikeInput>): SpikeInput {
  return { ...createSpikeInput(), ...partial };
}

describe("spike catalog ids", () => {
  it("uses the reserved spike ids", () => {
    expect(SPIKE_INPUT_ID).toBe(0x70);
    expect(SPIKE_FRAME_ID).toBe(0x71);
    expect(SPIKE_DUST_ID).toBe(0x72);
    expect(MESSAGE_CATALOG.SPIKE_INPUT.status).toBe(MessageStatus.Spike);
  });
});

describe("SPIKE_INPUT codec", () => {
  it("matches the golden vector both ways", () => {
    const out = new Uint8Array(32);
    const n = writeSpikeInputBody(
      [input({ seq: 0x1234, moveX: -5, moveY: 127, yaw: 0xbeef, pitch: -90, buttons: 0x1009, toolParam: 200 })],
      1,
      out,
    );
    expect([...out.subarray(0, n)]).toEqual(GOLDEN_INPUT_ONE);
    const targets = [createSpikeInput(), createSpikeInput()];
    expect(readSpikeInputBody(Uint8Array.from(GOLDEN_INPUT_ONE), targets)).toBe(1);
    expect(targets[0]).toEqual({
      seq: 0x1234,
      moveX: -5,
      moveY: 127,
      yaw: 0xbeef,
      pitch: -90,
      buttons: 0x1009,
      toolParam: 200,
    });
  });

  it("round-trips random pairs and clamps out-of-range fields on write", () => {
    const out = new Uint8Array(SPIKE_INPUT_MAX_BODY_BYTES);
    const targets = [createSpikeInput(), createSpikeInput()];
    for (let i = 0; i < 500; i++) {
      const a = input({
        seq: (i * 7919) & 0xffff,
        moveX: (i % 255) - 127,
        moveY: 127 - (i % 255),
        yaw: (i * 263) & 0xffff,
        pitch: (i % 181) - 90,
        buttons: (i * 37) & 0x1fff,
        toolParam: i & 0xff,
      });
      const b = input({ ...a, seq: (a.seq + 1) & 0xffff });
      const n = writeSpikeInputBody([a, b], 2, out);
      expect(n).toBe(SPIKE_INPUT_MAX_BODY_BYTES);
      expect(readSpikeInputBody(out, targets)).toBe(2);
      expect(targets[0]).toEqual(a);
      expect(targets[1]).toEqual(b);
    }
    writeSpikeInputBody([input({ moveX: -1000, pitch: 400, buttons: 0xffff, toolParam: Number.NaN })], 1, out);
    expect(readSpikeInputBody(out.subarray(0, 11), targets)).toBe(1);
    expect(targets[0]).toMatchObject({ moveX: -127, pitch: 90, buttons: 0x1fff, toolParam: 0 });
  });

  it("rejects malformed bodies without throwing (length, count, ranges, undefined bits)", () => {
    const targets = [createSpikeInput(), createSpikeInput()];
    for (let len = 0; len < 40; len++) {
      if (len === 11 || len === 21) continue;
      const body = new Uint8Array(len).fill(1);
      if (len > 0) body[0] = len >= 21 ? 2 : 1;
      expect(readSpikeInputBody(body, targets)).toBe(-1);
    }
    const bad = (mutate: (b: Uint8Array) => void): number => {
      const b = Uint8Array.from(GOLDEN_INPUT_ONE);
      mutate(b);
      return readSpikeInputBody(b, targets);
    };
    expect(bad((b) => (b[0] = 0))).toBe(-1);
    expect(bad((b) => (b[0] = 2))).toBe(-1);
    expect(bad((b) => (b[3] = 0x80))).toBe(-1); // moveX -128
    expect(bad((b) => (b[7] = 91))).toBe(-1); // pitch 91
    expect(bad((b) => (b[9] = 0x20))).toBe(-1); // button bit 13
    // Fuzz: random bodies never throw and only ever decode 1-2 inputs or -1.
    let seed = 99;
    for (let i = 0; i < 5000; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const len = seed % 24;
      const body = new Uint8Array(len);
      for (let j = 0; j < len; j++) body[j] = (seed >>> ((j % 4) * 8)) & 0xff;
      const n = readSpikeInputBody(body, targets);
      expect([-1, 1, 2]).toContain(n);
    }
  });

  it("throws on a bad count on the sending side", () => {
    expect(() => writeSpikeInputBody([], 1, new Uint8Array(32))).toThrow(RangeError);
    expect(() => writeSpikeInputBody([input({}), input({}), input({})], 3, new Uint8Array(32))).toThrow(RangeError);
    expect(() => writeSpikeInputBody([input({})], 1, new Uint8Array(5))).toThrow(RangeError);
  });
});

describe("SPIKE_FRAME header", () => {
  it("round-trips and bounds the body length", () => {
    const body = new Uint8Array(40);
    const header = { serverTick: 0xfffffffe, ackInputSeq: 0xabcd, inputBufferDepth: 3, flags: 0x45 };
    expect(writeSpikeFrameHeader(header, body)).toBe(SPIKE_FRAME_HEADER_BYTES);
    const target = createSpikeFrameHeader();
    expect(readSpikeFrameHeader(body, target)).toBe(true);
    expect(target).toEqual(header);
    expect(readSpikeFrameHeader(body.subarray(0, 7), target)).toBe(false);
    expect(readSpikeFrameHeader(new Uint8Array(SPIKE_FRAME_MAX_BODY_BYTES + 1), target)).toBe(false);
    expect(target).toEqual(header);
  });
});

describe("SPIKE_DUST header", () => {
  it("round-trips and only accepts the exact implied length", () => {
    const header = { serverTick: 77, plotCount: 10, intentCount: 1, checkCount: 2, ledgerBytes: 60 };
    const length = spikeDustBodyLength(header);
    expect(length).toBe(SPIKE_DUST_HEADER_BYTES + 40 + 17 + 12 + 60);
    const body = new Uint8Array(length);
    writeSpikeDustHeader(header, body);
    const target = createSpikeDustHeader();
    expect(readSpikeDustHeader(body, target)).toBe(true);
    expect(target).toEqual(header);
    expect(readSpikeDustHeader(body.subarray(0, length - 1), createSpikeDustHeader())).toBe(false);
    expect(readSpikeDustHeader(new Uint8Array(length + 1).fill(0), createSpikeDustHeader())).toBe(false);
    // A forged header claiming a huge count is rejected by the length check (no allocation on it).
    const forged = new Uint8Array(SPIKE_DUST_HEADER_BYTES);
    writeSpikeDustHeader({ serverTick: 1, plotCount: 0xffff, intentCount: 0, checkCount: 0, ledgerBytes: 0 }, forged);
    expect(readSpikeDustHeader(forged, createSpikeDustHeader())).toBe(false);
  });
});
