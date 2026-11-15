import { describe, expect, expectTypeOf, it } from "vitest";
import { LEDGER_BYTES, PlotState } from "../world";
import { DUST_CHUNK_PAYLOAD_MAX_BYTES } from "./format";
import {
  DUST_CHUNK_FIXED_BYTES,
  DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES,
  DUST_CHUNK_PAYLOAD_VERSION,
  DUST_CHUNK_PLOT_RECORD_FIXED_BYTES,
  DUST_CHUNK_PLOT_RECORD_MAX_BYTES,
  DUST_CHUNK_POLE_STATE_BYTES,
  DUST_CHUNK_STATE_BYTES,
  DUST_CHUNK_STROKE_CHAIN_PREFIX_BYTES,
  DUST_CHUNK_STROKE_LOG_MAX_BYTES,
  DustChunkPayloadSchema,
  type DustChunkGoldenVector,
  type DustChunkPayload,
} from "./dust-chunk";
import { DUST_CHUNK_GOLDEN_VECTORS } from "./dust-chunk-vectors";

// ---- Test-only reference codec (the real codec lives in packages/world) -------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const bytesToHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

function texelsOf(pattern: "zeros" | "ramp" | "corners"): Uint8Array {
  const t = new Uint8Array(LEDGER_BYTES);
  if (pattern === "ramp") for (let i = 0; i < t.length; i += 1) t[i] = i & 0xff;
  if (pattern === "corners") {
    t[0] = 208;
    t[LEDGER_BYTES - 1] = 80;
  }
  return t;
}

function toPayload(vector: DustChunkGoldenVector): DustChunkPayload {
  return DustChunkPayloadSchema.parse({
    payloadVersion: DUST_CHUNK_PAYLOAD_VERSION,
    chunkId: vector.chunkId,
    bakeCheck: vector.bakeCheck,
    states: vector.states,
    plots: vector.plots.map((p) => ({
      localIndex: p.localIndex,
      remainingFrac: p.remainingFrac,
      ledger: p.ledger,
      texels: texelsOf(p.texelsPattern),
      strokeCount: p.strokeCount,
      strokeLog: hexToBytes(p.strokeLogHex),
    })),
  });
}

function encode(chunk: DustChunkPayload): Uint8Array {
  const stateBytes = chunk.states.length === 2 ? DUST_CHUNK_POLE_STATE_BYTES : DUST_CHUNK_STATE_BYTES;
  let size = DUST_CHUNK_FIXED_BYTES + stateBytes;
  for (const p of chunk.plots)
    size += DUST_CHUNK_PLOT_RECORD_FIXED_BYTES + p.ledger.contributions.length * 5 + p.strokeLog.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint16(0, chunk.payloadVersion, true);
  view.setUint16(2, chunk.chunkId, true);
  view.setUint8(4, chunk.bakeCheck);
  view.setUint16(5, chunk.plots.length, true);
  chunk.states.forEach((s, k) => {
    out[DUST_CHUNK_FIXED_BYTES + (k >> 2)] = (out[DUST_CHUNK_FIXED_BYTES + (k >> 2)] ?? 0) | (s << (2 * (k & 3)));
  });
  let at = DUST_CHUNK_FIXED_BYTES + stateBytes;
  for (const p of chunk.plots) {
    const h = p.ledger;
    view.setUint8(at, p.localIndex);
    view.setUint8(at + 1, p.remainingFrac);
    view.setUint32(at + 2, h.version, true);
    view.setUint32(at + 6, h.remainingUnits, true);
    view.setUint32(at + 10, h.initialUnits, true);
    view.setUint16(at + 14, h.ownedTexels, true);
    view.setUint32(at + 16, h.mgPerUnit, true);
    view.setUint32(at + 20, h.hash, true);
    view.setUint8(at + 24, h.contributions.length);
    at += 25;
    for (const c of h.contributions) {
      view.setUint8(at, c.actorSlot);
      view.setUint32(at + 1, c.units, true);
      at += 5;
    }
    out.set(p.texels, at);
    at += LEDGER_BYTES;
    view.setUint8(at, p.strokeCount);
    view.setUint16(at + 1, p.strokeLog.length, true);
    at += 3;
    out.set(p.strokeLog, at);
    at += p.strokeLog.length;
  }
  expect(at).toBe(size);
  return out;
}

// ---- Tests --------------------------------------------------------------------------------------------------------

describe("dust chunk payload", () => {
  it("sizes", () => {
    expect(DUST_CHUNK_FIXED_BYTES).toBe(7);
    expect(DUST_CHUNK_STATE_BYTES).toBe(64);
    // localIndex 1 + remainingFrac 1 + ledger header fixed 23 + 1024 + strokeCount 1 + strokeLogBytes 2
    expect(DUST_CHUNK_PLOT_RECORD_FIXED_BYTES).toBe(1 + 1 + 23 + 1024 + 1 + 2);
    // chain header 17 + continuationCount 1; 32 strokes as their own chains
    expect(DUST_CHUNK_STROKE_CHAIN_PREFIX_BYTES).toBe(18);
    expect(DUST_CHUNK_STROKE_LOG_MAX_BYTES).toBe(576);
    expect(DUST_CHUNK_PLOT_RECORD_MAX_BYTES).toBe(1052 + 4 * 5 + 576);
    expect(DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES).toBe(7 + 64 + 256 * 1648);
    expect(DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES).toBe(421_959);
  });

  it("the save limit is the layout maximum and admits a full chunk", () => {
    expect(DUST_CHUNK_PAYLOAD_MAX_BYTES).toBe(DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES);
    // M1-W3-T01 finding 1: 256 touched plots without contributions or logs needed 269,383 B (> the old 262,144).
    const fullNoLogs = DUST_CHUNK_FIXED_BYTES + DUST_CHUNK_STATE_BYTES + 256 * DUST_CHUNK_PLOT_RECORD_FIXED_BYTES;
    expect(fullNoLogs).toBe(269_383);
    expect(fullNoLogs).toBeLessThanOrEqual(DUST_CHUNK_PAYLOAD_MAX_BYTES);
    const max = DUST_CHUNK_GOLDEN_VECTORS.find((v) => v.length === DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES);
    expect(max).toBeDefined();
    expect(max?.plots.length).toBe(256);
  });

  it("bounds a stroke log by its stroke count", () => {
    const vector = DUST_CHUNK_GOLDEN_VECTORS[1];
    const plot0 = vector?.plots[0];
    expect(plot0).toBeDefined();
    if (vector === undefined || plot0 === undefined) return;
    const good = toPayload(vector);
    const record = good.plots[0];
    if (record === undefined) return;
    const at = (strokeCount: number, length: number): boolean =>
      DustChunkPayloadSchema.safeParse({
        ...good,
        plots: [{ ...record, strokeCount, strokeLog: new Uint8Array(length) }, ...good.plots.slice(1)],
      }).success;
    expect(at(32, DUST_CHUNK_STROKE_LOG_MAX_BYTES)).toBe(true);
    expect(at(32, DUST_CHUNK_STROKE_LOG_MAX_BYTES + 1)).toBe(false);
    expect(at(2, 36)).toBe(true);
    expect(at(2, 37)).toBe(false);
    expect(at(0, 0)).toBe(true);
    expect(at(0, 1)).toBe(false);
  });

  it.each(DUST_CHUNK_GOLDEN_VECTORS.map((v) => [v.name, v] as const))(
    "%s encodes to the golden length and CRC32",
    (_name, vector) => {
      const bytes = encode(toPayload(vector));
      expect(bytes.length).toBe(vector.length);
      expect(crc32(bytes)).toBe(vector.crc32);
      if (vector.bytesHex !== undefined) expect(bytesToHex(bytes)).toBe(vector.bytesHex);
    },
  );

  it("states are 2 bits per plot, LSB first", () => {
    const vector = DUST_CHUNK_GOLDEN_VECTORS[1];
    expect(vector).toBeDefined();
    if (vector === undefined) return;
    const bytes = encode(toPayload(vector));
    // local 0 Opened (1), local 1 Grimy (0), local 2 Polished (2), local 3 Grimy (0): byte = 1 | 2 << 4 = 0x21
    expect(bytes[DUST_CHUNK_FIXED_BYTES]).toBe(0x21);
    // local 255 Empty (3) sits in the top 2 bits of the last state byte.
    expect(bytes[DUST_CHUNK_FIXED_BYTES + 63]).toBe(0xc0);
  });

  it("rejects malformed payloads", () => {
    const vector = DUST_CHUNK_GOLDEN_VECTORS[1];
    expect(vector).toBeDefined();
    if (vector === undefined) return;
    const good = toPayload(vector);
    const plot0 = good.plots[0];
    const plot1 = good.plots[1];
    expect(plot0).toBeDefined();
    expect(plot1).toBeDefined();
    if (plot0 === undefined || plot1 === undefined) return;
    const bad: unknown[] = [
      { ...good, chunkId: 641 },
      { ...good, chunkId: 640 }, // 256 states on the pole chunk
      { ...good, states: good.states.slice(0, 255) },
      { ...good, plots: [plot1, plot0] }, // not ascending
      { ...good, plots: [{ ...plot0, localIndex: 2 }] }, // local 2 is Polished: no ledger record
      { ...good, plots: [{ ...plot0, localIndex: 255 }] }, // local 255 is Empty
      { ...good, plots: [{ ...plot0, texels: new Uint8Array(1000) }] },
      { ...good, plots: [{ ...plot0, strokeCount: 33 }] },
    ];
    for (const value of bad) expect(DustChunkPayloadSchema.safeParse(value).success).toBe(false);
  });

  it("round-trips a parsed payload through the schema", () => {
    for (const vector of DUST_CHUNK_GOLDEN_VECTORS) {
      const payload = toPayload(vector);
      expect(DustChunkPayloadSchema.parse(payload)).toEqual(payload);
    }
  });

  it("type check", () => {
    expectTypeOf<DustChunkPayload["states"][number]>().toExtend<number>();
    expect(PlotState.Opened).toBe(1);
  });
});
