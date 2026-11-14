import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_CHUNK_COUNT_BYTES,
  CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES,
  CHECKPOINT_MAX_PARTS,
  CHECKPOINT_PACKAGE_FIXED_BYTES,
  CHECKPOINT_PACKAGE_LAYOUT,
  CHECKPOINT_PACKAGE_MAGIC,
  CHECKPOINT_PACKAGE_VERSION,
  CHECKPOINT_PART_MAX_BYTES,
  CHECKPOINT_SESSION_MAX_BYTES,
  CHECKPOINT_TRAILER_BYTES,
  CheckpointPackageSchema,
  type CheckpointPackage,
} from "./checkpoint-package";
import { CHECKPOINT_PACKAGE_GOLDEN_VECTORS, type CheckpointPackageGoldenVector } from "./checkpoint-vectors";

// ---- Test-only reference codec (the real codec lives in apps/client/src/sim-host and apps/server/src/api) ----------

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

function encode(pkg: CheckpointPackage): Uint8Array {
  const L = CHECKPOINT_PACKAGE_LAYOUT;
  const size =
    CHECKPOINT_PACKAGE_FIXED_BYTES +
    pkg.header.length +
    CHECKPOINT_CHUNK_COUNT_BYTES +
    pkg.chunks.reduce((n, c) => n + CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES + c.bytes.length, 0) +
    CHECKPOINT_TRAILER_BYTES;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i += 1) out[L.magic.offset + i] = CHECKPOINT_PACKAGE_MAGIC.charCodeAt(i);
  view.setUint16(L.version.offset, CHECKPOINT_PACKAGE_VERSION, true);
  out.set(hexToBytes(pkg.contractId.replaceAll("-", "")), L.contractId.offset);
  view.setBigUint64(L.generation.offset, BigInt(pkg.generation), true);
  view.setBigUint64(L.baseGeneration.offset, BigInt(pkg.baseGeneration), true);
  view.setUint32(L.headerLen.offset, pkg.header.length, true);
  out.set(pkg.header, CHECKPOINT_PACKAGE_FIXED_BYTES);
  let at = CHECKPOINT_PACKAGE_FIXED_BYTES + pkg.header.length;
  view.setUint16(at, pkg.chunks.length, true);
  at += CHECKPOINT_CHUNK_COUNT_BYTES;
  for (const c of pkg.chunks) {
    view.setUint16(at, c.chunkId, true);
    view.setUint8(at + 2, c.ver);
    view.setUint32(at + 3, c.rawSize, true);
    view.setUint32(at + 7, c.crc32, true);
    view.setUint32(at + 11, c.bytes.length, true);
    out.set(c.bytes, at + CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES);
    at += CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES + c.bytes.length;
  }
  view.setUint32(at, crc32(out.subarray(0, at)), true);
  return out;
}

function toPackage(vector: CheckpointPackageGoldenVector): CheckpointPackage {
  return CheckpointPackageSchema.parse({
    contractId: vector.contractId,
    generation: vector.generation,
    baseGeneration: vector.baseGeneration,
    header: hexToBytes(vector.headerHex),
    chunks: vector.chunks.map((c) => ({
      chunkId: c.chunkId,
      ver: c.ver,
      rawSize: c.rawSize,
      crc32: c.crc32,
      bytes: hexToBytes(c.bytesHex),
    })),
  });
}

// ---- Tests --------------------------------------------------------------------------------------------------------

describe("MCCK checkpoint package", () => {
  it("has a contiguous fixed prefix of 42 bytes and the ADR-0031 limits", () => {
    let next = 0;
    for (const [name, field] of Object.entries(CHECKPOINT_PACKAGE_LAYOUT)) {
      expect(field.offset, name).toBe(next);
      next += field.bytes;
    }
    expect(next).toBe(CHECKPOINT_PACKAGE_FIXED_BYTES);
    expect(CHECKPOINT_PACKAGE_MAGIC).toBe("MCCK");
    expect(CHECKPOINT_PACKAGE_VERSION).toBe(1);
    expect(CHECKPOINT_PART_MAX_BYTES).toBe(1_048_576);
    expect(CHECKPOINT_SESSION_MAX_BYTES).toBe(4_194_304);
    expect(CHECKPOINT_MAX_PARTS).toBe(4);
    expect(CHECKPOINT_CHUNK_ENTRY_FIXED_BYTES).toBe(2 + 1 + 4 + 4 + 4);
  });

  it.each(CHECKPOINT_PACKAGE_GOLDEN_VECTORS.map((v) => [v.name, v] as const))(
    "%s encodes bit for bit",
    (_name, vector) => {
      expect(bytesToHex(encode(toPackage(vector)))).toBe(vector.bytesHex);
    },
  );

  it("carries a valid trailer: the CRC32 of everything before it", () => {
    for (const vector of CHECKPOINT_PACKAGE_GOLDEN_VECTORS) {
      const bytes = hexToBytes(vector.bytesHex);
      const body = bytes.subarray(0, bytes.length - CHECKPOINT_TRAILER_BYTES);
      expect(new DataView(bytes.buffer).getUint32(bytes.length - CHECKPOINT_TRAILER_BYTES, true)).toBe(crc32(body));
    }
  });

  it("rejects malformed packages", () => {
    const first = CHECKPOINT_PACKAGE_GOLDEN_VECTORS[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const good = toPackage(first);
    const chunk = good.chunks[0];
    expect(chunk).toBeDefined();
    if (chunk === undefined) return;
    const bad: unknown[] = [
      { ...good, contractId: "not-a-uuid" },
      { ...good, generation: 0 },
      { ...good, baseGeneration: -1 },
      { ...good, chunks: [chunk, chunk] },
      { ...good, chunks: [{ ...chunk, chunkId: 641 }] },
      { ...good, chunks: [{ ...chunk, ver: 2 }] },
      { ...good, chunks: [{ ...chunk, rawSize: 256 * 1024 + 1 }] },
      { ...good, header: new Uint8Array(CHECKPOINT_PART_MAX_BYTES + 1) },
      {},
    ];
    for (const value of bad) expect(CheckpointPackageSchema.safeParse(value).success).toBe(false);
  });

  it("round-trips a parsed package through the schema", () => {
    for (const vector of CHECKPOINT_PACKAGE_GOLDEN_VECTORS) {
      const pkg = toPackage(vector);
      expect(CheckpointPackageSchema.parse(pkg)).toEqual(pkg);
    }
  });
});
