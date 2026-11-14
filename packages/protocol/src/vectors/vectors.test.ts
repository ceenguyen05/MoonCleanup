import { PROTOCOL_VERSION } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { FRAME_OK, FrameReader } from "../codec/frame-reader";
import { FrameView, SlotTable } from "../codec/frame-state";
import {
  DUST_CHECK_CHUNKS_VECTOR,
  DUST_CHECK_DETAIL_VECTOR,
  DUST_LOG_VECTOR,
  DUST_REQUEST_CHUNK_VECTOR,
  DUST_REQUEST_PLOTS_VECTOR,
  DUST_SNAPSHOT_SLICE_VECTOR,
} from "./dust-vectors";
import { FRAME_DUST_SECTIONS_VECTOR as V, FRAME_SECTION_VECTORS_VERSION } from "./frame-section-vectors";

const PLOTS = 163_842;

/** Independent reference packer: LSB-first bit stream built with BigInt (shares no code with BitWriter). */
function refPack(fields: readonly (readonly [number, number])[]): number[] {
  let acc = 0n;
  let at = 0n;
  for (const [value, bits] of fields) {
    acc |= (BigInt(value >>> 0) & ((1n << BigInt(bits)) - 1n)) << at;
    at += BigInt(bits);
  }
  const out: number[] = [];
  for (let i = 0n; i < (at + 7n) / 8n; i++) out.push(Number((acc >> (8n * i)) & 0xffn));
  return out;
}

const s = (v: number, bits: number): readonly [number, number] => [v & ((1 << bits) - 1), bits];

describe("FRAME dust-sections golden vector", () => {
  const bytes = Uint8Array.from(V.bytes);

  it("header and framing match hand arithmetic", () => {
    expect(bytes.length).toBe(91);
    expect(bytes[0]).toBe(0x20);
    expect(bytes[1]! | (bytes[2]! << 8) | (bytes[3]! << 16) | (bytes[4]! << 24)).toBe(V.serverTick);
    expect(bytes[5]! | (bytes[6]! << 8)).toBe(V.ackInputSeq);
    expect(bytes[7]).toBe(V.inputBufferDepth);
    expect(bytes[8]).toBe(V.flags);
    // Self (21 B, all zero) ends at 30; strokes prefix = 27, robots prefix = 20, plots prefix = 8.
    expect(bytes.slice(9, 30).every((b) => b === 0)).toBe(true);
    expect(bytes[30]! | (bytes[31]! << 8)).toBe(27);
    expect(bytes[32]).toBe(1); // chain count
    expect(bytes[59]! | (bytes[60]! << 8)).toBe(20);
    expect(bytes[81]! | (bytes[82]! << 8)).toBe(8);
    expect(30 + 2 + 27 + 2 + 20 + 2 + 8).toBe(bytes.length);
  });

  it("stroke chain bytes equal the reference packer", () => {
    const chain = refPack([
      [10, 18],
      s(1, 16),
      s(-2, 16),
      s(3, 16),
      s(-4, 16),
      [20, 10],
      [80, 8],
      [1, 6],
      [2, 6],
      [2, 8], // tickOffset
      [0x1234, 16],
      [2, 8], // continuation count
      [2, 6],
      s(5, 13),
      s(-5, 13),
      [2, 6],
      s(-6, 13),
      s(7, 13),
    ]);
    expect(chain.length).toBe(26);
    expect([...bytes.slice(33, 59)]).toEqual(chain);
  });

  it("robot intent bytes equal the reference packer", () => {
    const robot = refPack([
      [0x0102, 16],
      [0x2a3b, 18],
      [0x0a0b0c0d, 32],
      [30, 10],
      [60, 8],
      [150, 10],
      [0x55aa55aa, 32],
      [0x00ff00ff, 32],
    ]);
    expect(robot.length).toBe(20);
    expect([...bytes.slice(61, 81)]).toEqual(robot);
  });

  it("plot delta bytes equal the reference packer", () => {
    expect([...bytes.slice(83, 87)]).toEqual(
      refPack([
        [7, 18],
        [1, 2],
        [200, 8],
        [0, 4],
      ]),
    );
    expect([...bytes.slice(87, 91)]).toEqual(
      refPack([
        [163841, 18],
        [3, 2],
        [255, 8],
        [0, 4],
      ]),
    );
  });

  it("decodes back to the documented values", () => {
    const view = new FrameView();
    expect(new FrameReader().decode(bytes, view, new SlotTable(), PLOTS)).toBe(FRAME_OK);
    expect(view.serverTick).toBe(1000);
    expect(view.strokes.chainCount).toBe(1);
    expect(view.strokes.tick[0]).toBe(998);
    expect(view.strokes.contCount[0]).toBe(2);
    expect(view.strokes.contDxMm[1]).toBe(-6);
    expect(view.strokes.contDyMm[1]).toBe(7);
    expect(view.robotIntents.count).toBe(1);
    expect(view.robotIntents.laneMaskLow[0]).toBe(0x55aa55aa);
    expect(view.robotIntents.laneMaskHigh[0]).toBe(0x00ff00ff);
    expect(view.dustPlots.count).toBe(2);
    expect(view.dustPlots.plotId[1]).toBe(163841);
    expect(view.dustPlots.state[1]).toBe(3);
  });
});

/** FNV-1a 32 over every golden vector of this package (order fixed), so any byte change is caught. */
function goldenHash(): number {
  const all: readonly (readonly number[])[] = [
    DUST_REQUEST_PLOTS_VECTOR.bytes,
    DUST_REQUEST_CHUNK_VECTOR.bytes,
    DUST_CHECK_CHUNKS_VECTOR.bytes,
    DUST_CHECK_DETAIL_VECTOR.bytes,
    DUST_SNAPSHOT_SLICE_VECTOR.bytes,
    DUST_LOG_VECTOR.bytes,
    V.bytes,
  ];
  let h = 0x811c9dc5;
  for (const v of all) {
    // length separator so moving a byte between vectors changes the hash
    h = Math.imul(h ^ v.length, 0x01000193) >>> 0;
    for (const b of v) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The wire is tied to PROTOCOL_VERSION by hash (netcode.md section 13): the handshake compares versions strictly, and
 * this table makes "golden bytes changed" and "version bumped" the same edit. When PROTOCOL_VERSION is bumped, ADD
 * the new version's hash here; never edit an existing entry.
 */
const GOLDEN_HASH_BY_PROTOCOL_VERSION: Readonly<Record<number, number>> = {
  1: 998653946,
};

describe("golden vectors are tied to PROTOCOL_VERSION", () => {
  it("vector set version equals the shared constant", () => {
    expect(FRAME_SECTION_VECTORS_VERSION).toBe(PROTOCOL_VERSION);
  });

  it("hash of all vectors equals the pinned hash of this protocol version", () => {
    expect(GOLDEN_HASH_BY_PROTOCOL_VERSION[PROTOCOL_VERSION]).toBeDefined();
    expect(goldenHash()).toBe(GOLDEN_HASH_BY_PROTOCOL_VERSION[PROTOCOL_VERSION]);
  });
});
