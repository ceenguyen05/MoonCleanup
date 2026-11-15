import { describe, expect, it } from "vitest";
import { SAVE_SECTION_ID, type SaveHeader, type SoloCheckpointSummary } from "@moon-cleanup/shared";
import {
  crc32 as simHostCrc32,
  decodeSaveEnvelope,
  deflate,
  encodeSaveEnvelope,
  gzip,
} from "../sim-host/save-envelope";
import { backoffDelayMs } from "./backoff";
import { assembleCopy } from "./copy";
import { CRC32_INIT, crc32, crc32Final, crc32Update } from "./crc32";
import { readEnvelopeFacts, withGeneration } from "./envelope";
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, CHUNK_RAW_MAX_BYTES, INFLATE_CAP_BYTES } from "./limits";
import { decodeMcck, encodeMcck, mcckTrailerCrc, packPages, type McckChunk } from "./mcck";
import { classifyFailure } from "./save-api";
import { decideHead } from "./save-sync";
import { CONTRACT } from "./test-support";

const HEADER: SaveHeader = {
  saveFormatVersion: 1,
  gridM: 128,
  radiusM: 2000,
  plotCount: 163_842,
  bakeHash: "ab".repeat(32),
  dustModelVersion: 1,
  simTick: 4000,
  generation: 3,
  parentGeneration: 2,
  originKind: "solo",
  originId: "00".repeat(16),
  sections: [{ id: SAVE_SECTION_ID.META, version: 1, length: 3 }],
};
const rawEnvelope = () => encodeSaveEnvelope(HEADER, [new Uint8Array([9, 8, 7])]);

describe("crc32", () => {
  it("matches the save-envelope CRC and works incrementally", () => {
    const data = Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) & 0xff);
    expect(crc32(data)).toBe(simHostCrc32(data));
    let s = CRC32_INIT;
    s = crc32Update(s, data, 0, 1234);
    s = crc32Update(s, data, 1234);
    expect(crc32Final(s)).toBe(crc32(data));
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("envelope", () => {
  it("reads the fixed facts and rejects a corrupt CRC", () => {
    const raw = rawEnvelope();
    expect(readEnvelopeFacts(raw)).toMatchObject({
      generation: 3,
      parentGeneration: 2,
      simTick: 4000,
      plotCount: 163_842,
      originKind: "solo",
    });
    const bad = raw.slice();
    bad[60] = (bad[60] ?? 0) ^ 1;
    expect(readEnvelopeFacts(bad)).toBeNull();
    expect(readEnvelopeFacts(raw.subarray(0, 50))).toBeNull();
  });
  it("rewrites generation and parent with a valid CRC", () => {
    const patched = withGeneration(rawEnvelope(), 9, 4);
    expect(decodeSaveEnvelope(patched).header).toMatchObject({ generation: 9, parentGeneration: 4 });
    expect(() => withGeneration(rawEnvelope(), 4, 4)).toThrow(RangeError);
  });
});

function chunk(id: number, fill: number): McckChunk {
  const bytes = Uint8Array.from({ length: 40 }, (_, i) => (fill + i) & 0xff);
  return { chunkId: id, ver: 0, rawSize: 100, crc32: 0xdeadbeef, bytes };
}

describe("MCCK package", () => {
  const header = Uint8Array.from({ length: 64 }, (_, i) => i);
  it("round-trips and reports its trailer CRC", () => {
    const pkg = encodeMcck({
      contractId: CONTRACT,
      generation: 7,
      baseGeneration: 5,
      header,
      chunks: [chunk(3, 1), chunk(640, 2)],
    });
    const d = decodeMcck(pkg);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.value).toMatchObject({ contractId: CONTRACT, generation: 7, baseGeneration: 5 });
    expect(d.value.chunks.map((c) => c.chunkId)).toEqual([3, 640]);
    expect([...d.value.header]).toEqual([...header]);
    expect(mcckTrailerCrc(pkg)).toBe(crc32(pkg, 0, pkg.length - 4));
  });
  it("never throws on truncated or corrupted input", () => {
    const pkg = encodeMcck({ contractId: CONTRACT, generation: 7, baseGeneration: 5, header, chunks: [chunk(3, 1)] });
    for (let n = 0; n < pkg.length; n++) expect(decodeMcck(pkg.subarray(0, n)).ok).toBe(false);
    let seed = 12345;
    for (let round = 0; round < 300; round++) {
      const mutated = pkg.slice();
      for (let k = 0; k < 3; k++) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        mutated[seed % mutated.length] = seed >>> 24;
      }
      expect(() => decodeMcck(mutated)).not.toThrow();
    }
  });
  it("refuses a chunk above 421,959 B raw, a bad id and duplicates (even with a valid CRC)", () => {
    expect(() =>
      encodeMcck({
        contractId: CONTRACT,
        generation: 1,
        baseGeneration: 0,
        header,
        chunks: [{ ...chunk(1, 0), rawSize: CHUNK_RAW_MAX_BYTES + 1 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      encodeMcck({ contractId: CONTRACT, generation: 1, baseGeneration: 0, header, chunks: [chunk(641, 0)] }),
    ).toThrow(RangeError);
    const ok = encodeMcck({
      contractId: CONTRACT,
      generation: 1,
      baseGeneration: 0,
      header,
      chunks: [{ ...chunk(1, 0), rawSize: CHUNK_RAW_MAX_BYTES }],
    });
    expect(decodeMcck(ok).ok).toBe(true);
  });
  it("splits into pages of at most 1 MiB, header on page 0 only", () => {
    const big = Array.from({ length: 5 }, (_, i) => ({ ...chunk(i, i), bytes: new Uint8Array(400_000) }));
    const pages = packPages(CONTRACT, 2, 2, header, big);
    expect(pages.length).toBe(3);
    for (const [i, p] of pages.entries()) {
      expect(p.length).toBeLessThanOrEqual(1024 * 1024);
      const d = decodeMcck(p);
      expect(d.ok && d.value.header.length).toBe(i === 0 ? header.length : 0);
    }
  });
});

describe("assembleCopy", () => {
  const env = { now: () => performance.now() };
  async function goodPackage(generation: number, payload = new Uint8Array(500).fill(7)) {
    const gz = await gzip(withGeneration(rawEnvelope(), generation, generation - 1));
    const bytes = await deflate(payload);
    return { gz, bytes, payload };
  }
  it("verifies chunks, and refuses mixed generations, bad CRCs and an inflated total above the cap", async () => {
    const a = await goodPackage(3);
    const page = encodeMcck({
      contractId: CONTRACT,
      generation: 3,
      baseGeneration: 3,
      header: a.gz,
      chunks: [{ chunkId: 4, ver: 0, rawSize: 500, crc32: crc32(a.payload), bytes: a.bytes }],
    });
    const ok = await assembleCopy([page], CONTRACT, env, 1);
    expect(ok.ok && ok.copy.generation).toBe(3);

    const badCrc = encodeMcck({
      contractId: CONTRACT,
      generation: 3,
      baseGeneration: 3,
      header: a.gz,
      chunks: [{ chunkId: 4, ver: 0, rawSize: 500, crc32: 1, bytes: a.bytes }],
    });
    expect(await assembleCopy([badCrc], CONTRACT, env, 1)).toEqual({ ok: false, reason: "corrupt" });

    const other = encodeMcck({
      contractId: CONTRACT,
      generation: 4,
      baseGeneration: 4,
      header: new Uint8Array(0),
      chunks: [],
    });
    expect(await assembleCopy([page, other], CONTRACT, env, 1)).toEqual({ ok: false, reason: "mixed_generation" });

    const wrong = await assembleCopy([page], "0190a5b4-1111-4222-8333-999999999999", env, 1);
    expect(wrong).toEqual({ ok: false, reason: "wrong_contract" });

    // 80 chunks declaring 421,959 B each = 32.2 MiB > 32 MiB: refused before anything is inflated.
    const many = Array.from({ length: 80 }, (_, i) => ({
      chunkId: i,
      ver: 0 as const,
      rawSize: CHUNK_RAW_MAX_BYTES,
      crc32: 0,
      bytes: new Uint8Array(8),
    }));
    expect(80 * CHUNK_RAW_MAX_BYTES).toBeGreaterThan(INFLATE_CAP_BYTES);
    const bomb = [
      encodeMcck({ contractId: CONTRACT, generation: 3, baseGeneration: 3, header: a.gz, chunks: many.slice(0, 40) }),
      encodeMcck({
        contractId: CONTRACT,
        generation: 3,
        baseGeneration: 3,
        header: new Uint8Array(0),
        chunks: many.slice(40),
      }),
    ];
    expect(await assembleCopy(bomb, CONTRACT, env, 1)).toEqual({ ok: false, reason: "too_large" });
  });
  it("stops a stream that expands past its declared size", async () => {
    const a = await goodPackage(3, new Uint8Array(100_000));
    const page = encodeMcck({
      contractId: CONTRACT,
      generation: 3,
      baseGeneration: 3,
      header: a.gz,
      chunks: [{ chunkId: 1, ver: 0, rawSize: 500, crc32: 0, bytes: a.bytes }],
    });
    expect(await assembleCopy([page], CONTRACT, env, 1)).toEqual({ ok: false, reason: "corrupt" });
  });
});

describe("backoff", () => {
  it("is 30 s, doubles, caps at 5 minutes and honours retry-after", () => {
    const mid = () => 0.5;
    expect(backoffDelayMs(1, mid)).toBe(BACKOFF_BASE_MS);
    expect(backoffDelayMs(2, mid)).toBe(BACKOFF_BASE_MS * 2);
    expect(backoffDelayMs(3, mid)).toBe(BACKOFF_BASE_MS * 4);
    expect(backoffDelayMs(20, mid)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelayMs(1, mid, 90_000)).toBe(90_000);
    expect(backoffDelayMs(1, () => 0)).toBeCloseTo(BACKOFF_BASE_MS * 0.8);
    expect(backoffDelayMs(1, () => 1)).toBeCloseTo(BACKOFF_BASE_MS * 1.2);
  });
});

describe("classifyFailure", () => {
  it("maps statuses to sync failures", () => {
    expect(classifyFailure(503, undefined, null).kind).toBe("offline"); // Render waking page
    expect(classifyFailure(503, { error: "RETRY_LATER" }, 5000)).toMatchObject({
      kind: "server_error",
      retryAfterMs: 5000,
    });
    expect(classifyFailure(429, { error: "RATE_LIMITED" }, 12_000)).toMatchObject({
      kind: "rate_limited",
      retryAfterMs: 12_000,
    });
    expect(classifyFailure(422, { error: "CHECKPOINT_REJECTED", reason: "bad_crc" }, null)).toMatchObject({
      kind: "rejected",
      reason: "bad_crc",
    });
    expect(classifyFailure(409, { error: "SAVE_VERSION_UNSUPPORTED" }, null).kind).toBe("version_unsupported");
    expect(classifyFailure(409, { error: "CONTRACT_BUSY" }, null).kind).toBe("server_error");
    expect(classifyFailure(413, undefined, null).kind).toBe("too_large");
    expect(classifyFailure(401, undefined, null)).toMatchObject({ kind: "offline", auth: true });
    expect(classifyFailure(500, { error: "INTERNAL" }, null).kind).toBe("server_error");
  });
});

describe("decideHead", () => {
  const server = (generation: number, simTick = 0): SoloCheckpointSummary => ({
    generation,
    parentGeneration: 0,
    originKind: "solo",
    savedAt: "2026-11-15T00:00:00.000Z",
    simTick,
    playtimeS: 0,
    shinePolished: 0,
    walletLumens: 0,
    saveFormatVersion: 1,
    gameDataVersion: "x",
  });
  const base = { hasLocal: true, localGeneration: 3, localSimTick: 600, baseGeneration: 3, dirty: false };
  it("follows the normative table", () => {
    expect(decideHead({ ...base, server: null, hasLocal: false })).toBe("none");
    expect(decideHead({ ...base, server: null })).toBe("upload");
    expect(decideHead({ ...base, server: server(3) })).toBe("in_sync");
    expect(decideHead({ ...base, server: server(5) })).toBe("download");
    expect(decideHead({ ...base, hasLocal: false, localGeneration: 0, baseGeneration: 0, server: server(5) })).toBe(
      "download",
    );
    expect(decideHead({ ...base, dirty: true, localGeneration: 4, server: server(3) })).toBe("upload");
    expect(decideHead({ ...base, dirty: true, localGeneration: 4, server: server(5) })).toBe("conflict");
    expect(decideHead({ ...base, dirty: true, localGeneration: 4, localSimTick: 800, server: server(4, 800) })).toBe(
      "in_sync",
    );
  });
});
