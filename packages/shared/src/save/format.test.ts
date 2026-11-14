import { describe, expect, it } from "vitest";
import {
  BAKE_HASH_BYTES,
  SAVE_FORMAT_VERSION,
  SAVE_HEADER_FIXED_BYTES,
  SAVE_HEADER_FIXED_BYTES_V0,
  SAVE_HEADER_LAYOUT,
  SAVE_HEADER_LAYOUT_V0,
  SAVE_MAGIC,
  SAVE_ORIGIN_ID_BYTES,
  SAVE_ORIGIN_KIND_CODE,
  SAVE_ORIGIN_KINDS,
  SAVE_SECTION_ENTRY_BYTES,
  SAVE_SECTION_ID,
  SAVE_TRAILER_BYTES,
  SAVE_V0_TO_V1_DEFAULTS,
  SaveHeaderSchema,
  SaveHeaderV0Schema,
  type SaveHeader,
  type SaveHeaderV0,
} from "./format";
import { SAVE_HEADER_GOLDEN_VECTORS, SAVE_HEADER_V0_GOLDEN_VECTORS } from "./vectors";

// ---- Test-only reference codec (the real codec lives in packages/sim) ---------------------------------------------

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

type Layout = Record<string, { offset: number; bytes: number }>;

function writeTable(
  out: Uint8Array,
  view: DataView,
  tableAt: number,
  sections: SaveHeader["sections"],
  bodies: readonly Uint8Array[],
): void {
  let at = tableAt;
  for (const s of sections) {
    view.setUint16(at, s.id, true);
    view.setUint16(at + 2, s.version, true);
    view.setUint32(at + 4, s.length, true);
    at += SAVE_SECTION_ENTRY_BYTES;
  }
  for (const body of bodies) {
    out.set(body, at);
    at += body.length;
  }
  view.setUint32(at, crc32(out.subarray(0, at)), true);
}

function encodeV1(header: SaveHeader, bodies: readonly Uint8Array[]): Uint8Array {
  const bodyBytes = bodies.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(
    SAVE_HEADER_FIXED_BYTES + header.sections.length * SAVE_SECTION_ENTRY_BYTES + bodyBytes + SAVE_TRAILER_BYTES,
  );
  const view = new DataView(out.buffer);
  const L = SAVE_HEADER_LAYOUT;
  for (let i = 0; i < 4; i += 1) out[L.magic.offset + i] = SAVE_MAGIC.charCodeAt(i);
  view.setUint16(L.saveFormatVersion.offset, header.saveFormatVersion, true);
  view.setUint16(L.gridM.offset, header.gridM, true);
  view.setUint16(L.radiusM.offset, header.radiusM, true);
  view.setUint32(L.plotCount.offset, header.plotCount, true);
  out.set(hexToBytes(header.bakeHash), L.bakeHash.offset);
  view.setUint16(L.dustModelVersion.offset, header.dustModelVersion, true);
  view.setBigUint64(L.simTick.offset, BigInt(header.simTick), true);
  view.setBigUint64(L.generation.offset, BigInt(header.generation), true);
  view.setBigUint64(L.parentGeneration.offset, BigInt(header.parentGeneration), true);
  out[L.originKind.offset] = SAVE_ORIGIN_KIND_CODE[header.originKind];
  out[L.reserved.offset] = 0;
  out.set(hexToBytes(header.originId), L.originId.offset);
  view.setUint16(L.sectionCount.offset, header.sections.length, true);
  writeTable(out, view, SAVE_HEADER_FIXED_BYTES, header.sections, bodies);
  return out;
}

function encodeV0(header: SaveHeaderV0, bodies: readonly Uint8Array[]): Uint8Array {
  const bodyBytes = bodies.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(
    SAVE_HEADER_FIXED_BYTES_V0 + header.sections.length * SAVE_SECTION_ENTRY_BYTES + bodyBytes + SAVE_TRAILER_BYTES,
  );
  const view = new DataView(out.buffer);
  const L = SAVE_HEADER_LAYOUT_V0;
  for (let i = 0; i < 4; i += 1) out[L.magic.offset + i] = SAVE_MAGIC.charCodeAt(i);
  view.setUint16(L.saveFormatVersion.offset, header.saveFormatVersion, true);
  view.setUint16(L.gridM.offset, header.gridM, true);
  view.setUint16(L.radiusM.offset, header.radiusM, true);
  view.setUint32(L.plotCount.offset, header.plotCount, true);
  out.set(hexToBytes(header.bakeHash), L.bakeHash.offset);
  view.setUint16(L.dustModelVersion.offset, header.dustModelVersion, true);
  view.setBigUint64(L.simTick.offset, BigInt(header.simTick), true);
  view.setUint16(L.sectionCount.offset, header.sections.length, true);
  writeTable(out, view, SAVE_HEADER_FIXED_BYTES_V0, header.sections, bodies);
  return out;
}

/** Test-only v0 -> v1 upgrade following the migration note in format.ts. */
function upgradeV0(bytes: Uint8Array, saveSeq: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectionCount = view.getUint16(SAVE_HEADER_LAYOUT_V0.sectionCount.offset, true);
  const tableBytes = sectionCount * SAVE_SECTION_ENTRY_BYTES;
  const bodyStart = SAVE_HEADER_FIXED_BYTES_V0 + tableBytes;
  const bodies = bytes.subarray(bodyStart, bytes.length - SAVE_TRAILER_BYTES);
  const out = new Uint8Array(SAVE_HEADER_FIXED_BYTES + tableBytes + bodies.length + SAVE_TRAILER_BYTES);
  const outView = new DataView(out.buffer);
  out.set(bytes.subarray(0, SAVE_HEADER_LAYOUT_V0.sectionCount.offset), 0);
  outView.setUint16(SAVE_HEADER_LAYOUT.saveFormatVersion.offset, 1, true);
  outView.setBigUint64(SAVE_HEADER_LAYOUT.generation.offset, BigInt(saveSeq), true);
  outView.setBigUint64(SAVE_HEADER_LAYOUT.parentGeneration.offset, BigInt(saveSeq - 1), true);
  out[SAVE_HEADER_LAYOUT.originKind.offset] = SAVE_ORIGIN_KIND_CODE[SAVE_V0_TO_V1_DEFAULTS.originKind];
  out.set(hexToBytes(SAVE_V0_TO_V1_DEFAULTS.originId), SAVE_HEADER_LAYOUT.originId.offset);
  outView.setUint16(SAVE_HEADER_LAYOUT.sectionCount.offset, sectionCount, true);
  out.set(bytes.subarray(SAVE_HEADER_FIXED_BYTES_V0, bodyStart), SAVE_HEADER_FIXED_BYTES);
  out.set(bodies, SAVE_HEADER_FIXED_BYTES + tableBytes);
  const end = out.length - SAVE_TRAILER_BYTES;
  outView.setUint32(end, crc32(out.subarray(0, end)), true);
  return out;
}

// ---- Tests --------------------------------------------------------------------------------------------------------

function contiguous(layout: Layout, total: number): void {
  let next = 0;
  for (const [name, field] of Object.entries(layout)) {
    expect(field.offset, name).toBe(next);
    next += field.bytes;
  }
  expect(next).toBe(total);
}

describe("save header layout", () => {
  it("is version 1 with magic MCSV", () => {
    expect(SAVE_FORMAT_VERSION).toBe(1);
    expect(SAVE_MAGIC).toBe("MCSV");
  });

  it("has contiguous v1 fields that end at SAVE_HEADER_FIXED_BYTES (92)", () => {
    contiguous(SAVE_HEADER_LAYOUT, SAVE_HEADER_FIXED_BYTES);
    expect(SAVE_HEADER_FIXED_BYTES).toBe(92);
    expect(SAVE_HEADER_LAYOUT.bakeHash.bytes).toBe(BAKE_HASH_BYTES);
    expect(SAVE_HEADER_LAYOUT.originId.bytes).toBe(SAVE_ORIGIN_ID_BYTES);
    expect(SAVE_HEADER_LAYOUT.simTick.offset).toBe(48);
    expect(SAVE_HEADER_LAYOUT.generation.offset).toBe(56);
    expect(SAVE_HEADER_LAYOUT.parentGeneration.offset).toBe(64);
    expect(SAVE_HEADER_LAYOUT.originKind.offset).toBe(72);
    expect(SAVE_HEADER_LAYOUT.originId.offset).toBe(74);
    expect(SAVE_HEADER_LAYOUT.sectionCount.offset).toBe(90);
  });

  it("keeps the v0 layout and shares every field before simTick with v1", () => {
    contiguous(SAVE_HEADER_LAYOUT_V0, SAVE_HEADER_FIXED_BYTES_V0);
    expect(SAVE_HEADER_FIXED_BYTES_V0).toBe(58);
    for (const name of [
      "magic",
      "saveFormatVersion",
      "gridM",
      "radiusM",
      "plotCount",
      "bakeHash",
      "dustModelVersion",
      "simTick",
    ] as const) {
      expect(SAVE_HEADER_LAYOUT[name]).toEqual(SAVE_HEADER_LAYOUT_V0[name]);
    }
  });

  it("has unique non-zero section ids for the sections of data-model section 6", () => {
    const ids = Object.values(SAVE_SECTION_ID);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id > 0 && id <= 0xffff)).toBe(true);
    expect(Object.keys(SAVE_SECTION_ID)).toEqual([
      "META",
      "PLAYERS",
      "VEHICLES",
      "ROBOTS",
      "STRUCTURES",
      "RAILS",
      "MACHINES",
      "PUCKS",
    ]);
  });

  it("has origin kinds room=0 and solo=1", () => {
    expect(SAVE_ORIGIN_KINDS).toEqual(["room", "solo"]);
    expect(SAVE_ORIGIN_KIND_CODE).toEqual({ room: 0, solo: 1 });
  });
});

describe("save header golden vectors", () => {
  it.each(SAVE_HEADER_GOLDEN_VECTORS.map((v) => [v.name, v] as const))("%s encodes bit for bit", (_name, vector) => {
    const header = SaveHeaderSchema.parse(vector.header);
    const bodies = vector.bodiesHex.map(hexToBytes);
    vector.header.sections.forEach((s, i) => expect(bodies[i]?.length).toBe(s.length));
    expect(bytesToHex(encodeV1(header, bodies))).toBe(vector.bytesHex);
    expect(SaveHeaderSchema.parse(JSON.parse(JSON.stringify(header)))).toEqual(header);
  });

  it.each(SAVE_HEADER_V0_GOLDEN_VECTORS.map((v) => [v.name, v] as const))(
    "%s (historical) encodes bit for bit",
    (_name, vector) => {
      const header = SaveHeaderV0Schema.parse(vector.header);
      const bodies = vector.bodiesHex.map(hexToBytes);
      expect(bytesToHex(encodeV0(header, bodies))).toBe(vector.bytesHex);
    },
  );

  it("upgrades the v0 fixture to the v1 bytes of the migration note (generation = save_seq, room origin)", () => {
    const v0 = SAVE_HEADER_V0_GOLDEN_VECTORS[0];
    expect(v0).toBeDefined();
    if (v0 === undefined) return;
    const upgraded = upgradeV0(hexToBytes(v0.bytesHex), 3);
    const expected = encodeV1(
      {
        ...v0.header,
        saveFormatVersion: 1,
        generation: 3,
        parentGeneration: 2,
        originKind: "room",
        originId: SAVE_V0_TO_V1_DEFAULTS.originId,
      },
      v0.bodiesHex.map(hexToBytes),
    );
    expect(bytesToHex(upgraded)).toBe(bytesToHex(expected));
  });
});

describe("SaveHeaderSchema", () => {
  const base = SAVE_HEADER_GOLDEN_VECTORS[0]?.header as SaveHeader;

  it("rejects malformed headers", () => {
    const bad: unknown[] = [
      { ...base, plotCount: 163_841 },
      { ...base, bakeHash: "ABC" },
      { ...base, bakeHash: base.bakeHash.toUpperCase() },
      { ...base, simTick: -1 },
      { ...base, gridM: 0 },
      { ...base, sections: [{ id: 70_000, version: 1, length: 0 }] },
      { ...base, generation: 0, parentGeneration: 0 },
      { ...base, generation: 2, parentGeneration: 2 },
      { ...base, generation: 2, parentGeneration: 3 },
      { ...base, originKind: "cloud" },
      { ...base, originId: "00112233" },
      { ...base, originId: base.originId.toUpperCase() },
      {},
    ];
    for (const value of bad) expect(SaveHeaderSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });

  it("accepts the first save (generation 1, parent 0) and a conflict-overwrite jump", () => {
    expect(SaveHeaderSchema.safeParse({ ...base, generation: 1, parentGeneration: 0 }).success).toBe(true);
    expect(SaveHeaderSchema.safeParse({ ...base, generation: 9, parentGeneration: 2 }).success).toBe(true);
  });

  it("rejects a v0 header at the v1 schema and a v1 header at the v0 schema", () => {
    const v0 = SAVE_HEADER_V0_GOLDEN_VECTORS[0]?.header;
    expect(SaveHeaderSchema.safeParse(v0).success).toBe(false);
    expect(SaveHeaderV0Schema.safeParse(base).success).toBe(false);
  });
});
