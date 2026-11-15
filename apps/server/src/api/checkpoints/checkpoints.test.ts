// Solo checkpoint REST (M1-W5-T07): every verify rule of data-model.md section 3.7c that the server owns, over the in-memory
// repository and an in-process dispatcher. Binary bodies use the `rawBody` seam of the harness.
import { crc32, deflateSync, gzipSync } from "node:zlib";
import { encodeCheckpointUploadBody } from "@moon-cleanup/protocol";
import {
  API_ROUTES,
  CHECKPOINT_META_MAX_BYTES,
  CHECKPOINT_PART_MAX_BYTES,
  CHECKPOINT_UPLOAD_BODY_MAX_BYTES,
  CHECKPOINT_UPLOAD_PREFIX_BYTES,
  DUST_CHUNK_PAYLOAD_MAX_BYTES,
  GuestCreateResponseSchema,
  SAVE_FORMAT_VERSION,
  SAVE_HEADER_CODEC,
  SAVE_HEADER_FIXED_BYTES,
  SAVE_HEADER_LAYOUT,
  type HttpResponse,
} from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../test-harness";
import { createInflateBudget } from "./inflate-budget";
import { decodePackage, encodePackage, uuidToBytes } from "./mcck";

const BAKE = "ab".repeat(32);
const DEVICE = "0190a000-0000-7000-8000-0000000000d1";
let ipCounter = 40;

async function setup(over: { shiftType?: "solo" | "private" } = {}) {
  const h = createHarness();
  const g = await h.call("POST", "/v1/auth/guest", {
    body: { displayName: "Saver One" },
    ip: `198.51.100.${ipCounter++}`,
  });
  const me = GuestCreateResponseSchema.parse(g.body);
  const created = await h.call("POST", "/v1/contracts", {
    token: me.accessToken,
    body: { name: "My Moon", shiftType: over.shiftType ?? "solo" },
  });
  const contractId = (created.body as { contract: { id: string } }).contract.id;
  return { h, me, contractId };
}

interface EnvOptions {
  generation: number;
  parent: number;
  simTick?: number;
  origin?: 0 | 1;
  version?: number;
  bake?: string;
  gridM?: number;
  plotCount?: number;
}

function envelope(o: EnvOptions): Buffer {
  const out = Buffer.alloc(SAVE_HEADER_FIXED_BYTES + 4);
  const L = SAVE_HEADER_LAYOUT;
  out.write("MCSV", 0, "ascii");
  out.writeUInt16LE(o.version ?? SAVE_FORMAT_VERSION, L.saveFormatVersion.offset);
  out.writeUInt16LE(o.gridM ?? 128, L.gridM.offset);
  out.writeUInt16LE(2000, L.radiusM.offset);
  out.writeUInt32LE(o.plotCount ?? 163842, L.plotCount.offset);
  Buffer.from(o.bake ?? BAKE, "hex").copy(out, L.bakeHash.offset);
  out.writeUInt16LE(1, L.dustModelVersion.offset);
  out.writeBigUInt64LE(BigInt(o.simTick ?? 100), L.simTick.offset);
  out.writeBigUInt64LE(BigInt(o.generation), L.generation.offset);
  out.writeBigUInt64LE(BigInt(o.parent), L.parentGeneration.offset);
  out[L.originKind.offset] = o.origin ?? 1;
  out.writeUInt16LE(0, L.sectionCount.offset);
  out.writeUInt32LE(crc32(out.subarray(0, SAVE_HEADER_FIXED_BYTES)), SAVE_HEADER_FIXED_BYTES);
  return out;
}

interface Build {
  contractId: string;
  generation?: number;
  parent?: number;
  base?: number;
  simTick?: number;
  playtimeS?: number;
  chunks?: { id: number; payload: Buffer }[];
  overwrite?: boolean;
  env?: Partial<EnvOptions>;
  tamper?: (pkg: Buffer) => Buffer;
  tenure?: number;
}

function build(b: Build) {
  const generation = b.generation ?? 1;
  const parent = b.parent ?? generation - 1;
  const chunks = (b.chunks ?? [{ id: 3, payload: Buffer.alloc(300, 7) }]).map((c) => ({
    chunkId: c.id,
    ver: 0 as const,
    rawSize: c.payload.length,
    crc32: crc32(c.payload),
    bytes: deflateSync(c.payload),
  }));
  let pkg = encodePackage({
    contractId: b.contractId,
    generation,
    baseGeneration: b.base ?? 0,
    header: gzipSync(
      envelope({ generation, parent, ...(b.simTick === undefined ? {} : { simTick: b.simTick }), ...b.env }),
    ),
    chunks,
  });
  if (b.tamper) pkg = b.tamper(pkg);
  const meta = {
    contractId: b.contractId,
    generation,
    parentGeneration: parent,
    baseGeneration: b.base ?? 0,
    saveFormatVersion: SAVE_FORMAT_VERSION,
    gameDataVersion: "1.3",
    bakeHash: BAKE,
    totalBytes: pkg.length,
    partCount: 1,
    packageCrc32: pkg.readUInt32LE(pkg.length - 4),
    summary: {
      generation,
      parentGeneration: parent,
      originKind: "solo",
      savedAt: new Date().toISOString(),
      simTick: b.simTick ?? 100,
      playtimeS: b.playtimeS ?? 60,
      shinePolished: 10,
      walletLumens: 5,
      saveFormatVersion: SAVE_FORMAT_VERSION,
      gameDataVersion: "1.3",
    },
    profileDelta: { playtimeS: 60, tenurePoints: b.tenure ?? 0, commendations: 0, achievementIds: [] },
    deviceId: DEVICE,
    overwrite: b.overwrite ?? false,
  };
  return { pkg, metaBytes: new TextEncoder().encode(JSON.stringify(meta)), meta };
}

type Built = { pkg: Uint8Array; metaBytes: Uint8Array };

const uploadPath = (contractId: string): string => `/v1/contracts/${contractId}/solo-checkpoints`;

/** Frames metadata + package exactly as a client does (u16 LE metaLen | JSON | MCCK package). */
function put(h: Harness, token: string, contractId: string, built: Built): Promise<HttpResponse> {
  return putRaw(h, token, contractId, encodeCheckpointUploadBody(built.metaBytes, built.pkg));
}

function putRaw(h: Harness, token: string | undefined, contractId: string, rawBody: Uint8Array): Promise<HttpResponse> {
  return h.call("POST", uploadPath(contractId), { ...(token === undefined ? {} : { token }), rawBody });
}

const reasonOf = (r: HttpResponse): string | undefined => (r.body as { reason?: string }).reason;

describe("solo checkpoint upload", () => {
  it("accepts a first upload, then a fast-forward after the 20 s gap, and serves the head", async () => {
    const { h, me, contractId } = await setup();
    const first = await put(h, me.accessToken, contractId, build({ contractId }));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ acceptedGeneration: 1, flags: [] });
    h.advance(30_000);
    const second = await put(
      h,
      me.accessToken,
      contractId,
      build({ contractId, generation: 2, base: 1, simTick: 700, playtimeS: 90 }),
    );
    expect(second.status).toBe(200);
    const head = await h.call("GET", `/v1/contracts/${contractId}/save/head`, { token: me.accessToken });
    expect(head.status).toBe(200);
    expect(head.body).toMatchObject({ generation: 2, parentGeneration: 1, originKind: "solo", playtimeS: 90 });
  });

  it("answers 404 for a head with no save, and 404 for a stranger on every route", async () => {
    const { h, me, contractId } = await setup();
    expect((await h.call("GET", `/v1/contracts/${contractId}/save/head`, { token: me.accessToken })).status).toBe(404);
    const other = GuestCreateResponseSchema.parse(
      (
        await h.call("POST", "/v1/auth/guest", {
          body: { displayName: "Other One" },
          ip: `198.51.100.${ipCounter++}`,
        })
      ).body,
    );
    expect((await put(h, other.accessToken, contractId, build({ contractId }))).status).toBe(404);
    expect((await h.call("GET", `/v1/contracts/${contractId}/save/head`, { token: other.accessToken })).status).toBe(
      404,
    );
    expect((await h.call("GET", `/v1/contracts/${contractId}/save`, { token: other.accessToken })).status).toBe(404);
  });

  it("409 SAVE_CONFLICT with the server summary when baseGeneration is stale; overwrite wins", async () => {
    const { h, me, contractId } = await setup();
    await put(h, me.accessToken, contractId, build({ contractId }));
    h.advance(30_000);
    const stale = await put(h, me.accessToken, contractId, build({ contractId, generation: 2, base: 0 }));
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: "SAVE_CONFLICT", server: { generation: 1 } });
    const forced = await put(
      h,
      me.accessToken,
      contractId,
      build({ contractId, generation: 2, parent: 0, base: 1, overwrite: true }),
    );
    expect(forced.status).toBe(200);
  });

  it("overwrite still needs a generation above the server's: 422 generation_not_increasing", async () => {
    const { h, me, contractId } = await setup();
    await put(h, me.accessToken, contractId, build({ contractId, generation: 5, parent: 0 }));
    h.advance(30_000);
    const low = await put(
      h,
      me.accessToken,
      contractId,
      build({ contractId, generation: 4, parent: 0, base: 5, overwrite: true }),
    );
    expect(low.status).toBe(422);
    expect(reasonOf(low)).toBe("generation_not_increasing");
    const notAbove = await put(h, me.accessToken, contractId, build({ contractId, generation: 3, parent: 3 }));
    expect(reasonOf(notAbove)).toBe("generation_not_increasing");
  });

  it("is idempotent for a lost acknowledgement (same device, same generation)", async () => {
    const { h, me, contractId } = await setup();
    const b = build({ contractId });
    expect((await put(h, me.accessToken, contractId, b)).status).toBe(200);
    const replay = await put(h, me.accessToken, contractId, b);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ acceptedGeneration: 1 });
  });

  it("429 with retry-after when uploads come faster than 20 s per Contract", async () => {
    const { h, me, contractId } = await setup();
    await put(h, me.accessToken, contractId, build({ contractId }));
    h.advance(5_000);
    const res = await put(h, me.accessToken, contractId, build({ contractId, generation: 2, base: 1 }));
    expect(res.status).toBe(429);
    expect(res.headers?.["retry-after"]).toBeDefined();
  });

  it("limits a player to 60 uploads per hour", async () => {
    const { h, me, contractId } = await setup();
    let limited = 0;
    for (let i = 0; i < 62; i += 1) {
      const res = await put(h, me.accessToken, contractId, build({ contractId, generation: 1, base: 99 }));
      if (res.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it("rejects bad input with the right reason, writing nothing", async () => {
    const { h, me, contractId } = await setup();
    const flip = (p: Buffer): Buffer => {
      const copy = Buffer.from(p);
      copy[60] = (copy[60] ?? 0) ^ 0xff;
      return copy;
    };
    const cases: [string, Build, string][] = [
      ["flipped package byte", { contractId, tamper: flip }, "bad_crc"],
      ["envelope origin room", { contractId, env: { origin: 0 } }, "bad_envelope"],
      ["envelope generation differs", { contractId, env: { generation: 9, parent: 8 } }, "bad_envelope"],
      ["wrong grid for the Contract", { contractId, env: { gridM: 64, plotCount: 10 * 64 * 64 + 2 } }, "bake_mismatch"],
      ["chunk id above 640", { contractId, chunks: [{ id: 641, payload: Buffer.alloc(8) }] }, "chunk_id_out_of_range"],
    ];
    for (const [name, spec, reason] of cases) {
      h.advance(30_000);
      const res = await put(h, me.accessToken, contractId, build(spec));
      expect(res.status, name).toBe(422);
      expect(reasonOf(res), name).toBe(reason);
    }
    expect((await h.call("GET", `/v1/contracts/${contractId}/save/head`, { token: me.accessToken })).status).toBe(404);
  });

  it("rejects a chunk whose CRC lies, and an inflate bomb", async () => {
    const { h, me, contractId } = await setup();
    const base = build({ contractId });
    const decoded = decodePackage(base.pkg);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const chunk = decoded.value.chunks[0];
    if (chunk === undefined) throw new Error("fixture has a chunk");
    const withMeta = (pkg: Buffer): Built => ({
      pkg,
      metaBytes: new TextEncoder().encode(
        JSON.stringify({ ...base.meta, totalBytes: pkg.length, packageCrc32: pkg.readUInt32LE(pkg.length - 4) }),
      ),
    });
    const badCrc = encodePackage({ ...decoded.value, chunks: [{ ...chunk, crc32: chunk.crc32 ^ 1 }] });
    expect(reasonOf(await put(h, me.accessToken, contractId, withMeta(badCrc)))).toBe("bad_crc");
    const bomb = encodePackage({
      ...decoded.value,
      chunks: [{ ...chunk, rawSize: 100, crc32: 0, bytes: deflateSync(Buffer.alloc(300 * 1024)) }],
    });
    expect(reasonOf(await put(h, me.accessToken, contractId, withMeta(bomb)))).toBe("size_limit");
  });

  it("declares the raw body opt-in from the shared route table (no header carrier)", async () => {
    const { h } = await setup();
    const route = h.api.routes.find((r) => r.path === API_ROUTES.checkpointUpload.path);
    expect(route?.rawBodyMaxBytes).toBe(CHECKPOINT_UPLOAD_BODY_MAX_BYTES);
    expect(CHECKPOINT_UPLOAD_BODY_MAX_BYTES).toBe(
      CHECKPOINT_UPLOAD_PREFIX_BYTES + CHECKPOINT_META_MAX_BYTES + CHECKPOINT_PART_MAX_BYTES,
    );
    for (const other of h.api.routes.filter((r) => r.path !== API_ROUTES.checkpointUpload.path)) {
      expect(other.rawBodyMaxBytes, other.path).toBeUndefined();
    }
  });

  it("rejects hostile framing: truncated, bad metaLen, empty package, oversize, bad JSON, bad UTF-8", async () => {
    const { h, me, contractId } = await setup();
    const t = me.accessToken;
    const b = build({ contractId });
    const prefix = (len: number): Uint8Array => Uint8Array.of(len & 0xff, len >>> 8);
    const cat = (...parts: Uint8Array[]): Uint8Array => Buffer.concat(parts);
    const code = (r: HttpResponse): string => (r.body as { error: string }).error;

    const bad: [string, Uint8Array][] = [
      ["empty body", new Uint8Array(0)],
      ["one byte", Uint8Array.of(5)],
      ["metaLen zero", cat(prefix(0), b.pkg)],
      [
        "metaLen above 4096",
        cat(prefix(CHECKPOINT_META_MAX_BYTES + 1), new Uint8Array(CHECKPOINT_META_MAX_BYTES + 1), b.pkg),
      ],
      ["metaLen 0xffff", cat(prefix(0xffff), b.metaBytes, b.pkg)],
      ["metaLen past the body", cat(prefix(b.metaBytes.length + b.pkg.length + 1), b.metaBytes, b.pkg)],
      ["truncated inside the metadata", cat(prefix(b.metaBytes.length), b.metaBytes.subarray(0, 10))],
      ["no package", cat(prefix(b.metaBytes.length), b.metaBytes)],
      ["metadata not JSON", cat(prefix(4), new TextEncoder().encode("nope"), b.pkg)],
      ["metadata JSON null", cat(prefix(4), new TextEncoder().encode("null"), b.pkg)],
      ["metadata fails the schema", cat(prefix(2), new TextEncoder().encode("{}"), b.pkg)],
      ["metadata invalid UTF-8", cat(prefix(3), Uint8Array.of(0x7b, 0xff, 0x7d), b.pkg)],
      ["metaLen shorter than the JSON", cat(prefix(b.metaBytes.length - 1), b.metaBytes, b.pkg)],
    ];
    for (const [name, body] of bad) {
      const res = await putRaw(h, t, contractId, body);
      expect(res.status, name).toBe(400);
      expect(code(res), name).toBe("BAD_REQUEST");
    }

    // Package larger than one request (1 MiB + 1) and a body above the contract maximum.
    const tooBigPackage = cat(prefix(b.metaBytes.length), b.metaBytes, new Uint8Array(CHECKPOINT_PART_MAX_BYTES + 1));
    for (const body of [tooBigPackage, new Uint8Array(CHECKPOINT_UPLOAD_BODY_MAX_BYTES + 1)]) {
      const res = await putRaw(h, t, contractId, body);
      expect(res.status).toBe(413);
      expect(code(res)).toBe("PAYLOAD_TOO_LARGE");
    }
    // No rawBody at all (transport without the seam) fails closed.
    expect((await h.call("POST", uploadPath(contractId), { token: t })).status).toBe(400);
    expect((await putRaw(h, undefined, contractId, b.pkg)).status).toBe(401);
    // Nothing was written by any of the above.
    expect((await h.call("GET", `/v1/contracts/${contractId}/save/head`, { token: t })).status).toBe(404);
  });

  it("rejects metadata that disagrees with the framed package", async () => {
    const { h, me, contractId } = await setup();
    const b = build({ contractId });
    const reframe = (patch: Record<string, unknown>): Built => ({
      pkg: b.pkg,
      metaBytes: new TextEncoder().encode(JSON.stringify({ ...b.meta, ...patch })),
    });
    const otherId = "0190a000-0000-7000-8000-0000000000aa";
    for (const patch of [{ totalBytes: b.pkg.length + 1 }, { partCount: 2 }, { contractId: otherId }]) {
      expect((await put(h, me.accessToken, contractId, reframe(patch))).status).toBe(400);
    }
    const wrongCrc = await put(
      h,
      me.accessToken,
      contractId,
      reframe({ packageCrc32: (b.meta.packageCrc32 ^ 1) >>> 0 }),
    );
    expect(reasonOf(wrongCrc)).toBe("bad_crc");
  });

  it("accepts metadata of exactly 4096 bytes", async () => {
    const { h, me, contractId } = await setup();
    const b = build({ contractId });
    // Pad the JSON with trailing spaces up to exactly 4096 bytes: still strict JSON, still schema-valid.
    const json = JSON.stringify(b.meta);
    const padded = new TextEncoder().encode(json.padEnd(CHECKPOINT_META_MAX_BYTES, " "));
    expect(padded.length).toBe(CHECKPOINT_META_MAX_BYTES);
    expect((await put(h, me.accessToken, contractId, { pkg: b.pkg, metaBytes: padded })).status).toBe(200);
  });

  it("409 SAVE_VERSION_UNSUPPORTED for a newer format, 422 contract_not_solo for a private Contract", async () => {
    const { h, me, contractId } = await setup();
    const b = build({ contractId });
    const newer = new TextEncoder().encode(JSON.stringify({ ...b.meta, saveFormatVersion: SAVE_FORMAT_VERSION + 1 }));
    expect((await put(h, me.accessToken, contractId, { pkg: b.pkg, metaBytes: newer })).status).toBe(409);
    const priv = await setup({ shiftType: "private" });
    const res = await put(priv.h, priv.me.accessToken, priv.contractId, build({ contractId: priv.contractId }));
    expect(reasonOf(res)).toBe("contract_not_solo");
  });

  it("flags an implausible playtime jump, accepts the save, and credits nothing", async () => {
    const { h, me, contractId } = await setup();
    await put(h, me.accessToken, contractId, build({ contractId, playtimeS: 60 }));
    h.advance(30_000);
    const res = await put(
      h,
      me.accessToken,
      contractId,
      build({ contractId, generation: 2, base: 1, playtimeS: 100_000, tenure: 5000, simTick: 2_000_000 }),
    );
    expect(res.status).toBe(200);
    expect((res.body as { flags: string[] }).flags).toContain("solo_implausible");
    expect(h.audits).toContain("solo_implausible");
    const profile = await h.call("GET", "/v1/me", { token: me.accessToken });
    expect((profile.body as { tenurePoints: number }).tenurePoints).toBe(0);
  });

  it("caps the profile credit by accepted playtime", async () => {
    const { h, me, contractId } = await setup();
    await put(h, me.accessToken, contractId, build({ contractId, playtimeS: 0 }));
    h.advance(600_000); // 10 minutes: inside the 15-minute access token
    const res = await put(
      h,
      me.accessToken,
      contractId,
      build({ contractId, generation: 2, base: 1, playtimeS: 600, simTick: 12_000, tenure: 100_000 }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as { flags: string[] }).flags).toContain("profile_delta_capped");
    const profile = await h.call("GET", "/v1/me", { token: me.accessToken });
    expect((profile.body as { tenurePoints: number }).tenurePoints).toBe(100); // 600 s = 1/6 h x 600 per hour
  });
});

describe("solo checkpoint download", () => {
  it("returns the newest header and the chosen chunk versions as an MCCK page", async () => {
    const { h, me, contractId } = await setup();
    await put(
      h,
      me.accessToken,
      contractId,
      build({
        contractId,
        chunks: [
          { id: 3, payload: Buffer.alloc(300, 1) },
          { id: 9, payload: Buffer.alloc(100, 2) },
        ],
      }),
    );
    h.advance(30_000);
    await put(
      h,
      me.accessToken,
      contractId,
      build({ contractId, generation: 2, base: 1, chunks: [{ id: 3, payload: Buffer.alloc(400, 3) }] }),
    );
    const res = (await h.call("GET", `/v1/contracts/${contractId}/save`, {
      token: me.accessToken,
    })) as HttpResponse & { binary?: Uint8Array };
    expect(res.status).toBe(200);
    expect(res.headers?.["x-save-pages"]).toBe("1");
    const decoded = decodePackage(res.binary ?? new Uint8Array(0));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.generation).toBe(2);
    expect(decoded.value.header.length).toBeGreaterThan(0);
    expect(decoded.value.chunks.map((c) => [c.chunkId, c.rawSize])).toEqual([
      [3, 400],
      [9, 100],
    ]);
    expect(Buffer.from(decoded.value.contractId.replaceAll("-", ""), "hex")).toEqual(uuidToBytes(contractId));
    expect((await h.call("GET", `/v1/contracts/${contractId}/save?page=1`, { token: me.accessToken })).status).toBe(
      404,
    );
    expect((await h.call("GET", `/v1/contracts/${contractId}/save?page=zz`, { token: me.accessToken })).status).toBe(
      400,
    );
  });

  it("404 when there is no save", async () => {
    const { h, me, contractId } = await setup();
    expect((await h.call("GET", `/v1/contracts/${contractId}/save`, { token: me.accessToken })).status).toBe(404);
  });
});

describe("decompression amplification guard (review H1)", () => {
  it("rejects a 641-chunk, ~258 MiB-inflated package as size_limit without inflating it", async () => {
    const { h, me, contractId } = await setup();
    const zeros = Buffer.alloc(DUST_CHUNK_PAYLOAD_MAX_BYTES);
    const compressed = deflateSync(zeros, { level: 9 });
    const chunks = Array.from({ length: 641 }, (_, id) => ({
      chunkId: id,
      ver: 0 as const,
      rawSize: zeros.length,
      crc32: crc32(zeros),
      bytes: compressed,
    }));
    const base = build({ contractId });
    const decoded = decodePackage(base.pkg);
    if (!decoded.ok) throw new Error("fixture decodes");
    const pkg = encodePackage({ ...decoded.value, chunks });
    expect(pkg.length).toBeLessThan(CHECKPOINT_PART_MAX_BYTES);
    const meta = { ...base.meta, totalBytes: pkg.length, packageCrc32: pkg.readUInt32LE(pkg.length - 4) };
    const started = performance.now();
    const res = await put(h, me.accessToken, contractId, {
      pkg,
      metaBytes: new TextEncoder().encode(JSON.stringify(meta)),
    });
    const ms = performance.now() - started;
    expect(res.status).toBe(422);
    expect(reasonOf(res)).toBe("size_limit");
    // Rejected from the declared sizes alone: a ~258 MiB inflate takes seconds, this is a header scan.
    expect(ms).toBeLessThan(500);
    expect((await h.call("GET", `/v1/contracts/${contractId}/save/head`, { token: me.accessToken })).status).toBe(404);
  });

  /** An upload whose package carries exactly these chunk payloads (zeros of the given sizes). */
  async function uploadZeroChunks(sizes: readonly number[]) {
    const { h, me, contractId } = await setup();
    const base = build({ contractId });
    const decoded = decodePackage(base.pkg);
    if (!decoded.ok) throw new Error("fixture decodes");
    const chunks = sizes.map((size, id) => {
      const zeros = Buffer.alloc(size);
      return { chunkId: id, ver: 0 as const, rawSize: size, crc32: crc32(zeros), bytes: deflateSync(zeros) };
    });
    const pkg = encodePackage({ ...decoded.value, chunks });
    const meta = { ...base.meta, totalBytes: pkg.length, packageCrc32: pkg.readUInt32LE(pkg.length - 4) };
    return put(h, me.accessToken, contractId, { pkg, metaBytes: new TextEncoder().encode(JSON.stringify(meta)) });
  }

  it("per-chunk cap: exactly 421,959 B is accepted, 421,960 B is rejected as size_limit (review N5)", async () => {
    expect(DUST_CHUNK_PAYLOAD_MAX_BYTES).toBe(421_959);
    const atCap = await uploadZeroChunks([DUST_CHUNK_PAYLOAD_MAX_BYTES]);
    expect(atCap.status).toBe(200);
    const over = await uploadZeroChunks([DUST_CHUNK_PAYLOAD_MAX_BYTES + 1]);
    expect(reasonOf(over)).toBe("size_limit");
  });

  it("per-upload declared-raw cap: exactly 32 MiB is accepted (review N5, accepted side of the boundary)", async () => {
    const cap = 32 * 1024 * 1024;
    const full = Math.floor(cap / DUST_CHUNK_PAYLOAD_MAX_BYTES);
    const sizes = [
      ...Array.from({ length: full }, () => DUST_CHUNK_PAYLOAD_MAX_BYTES),
      cap - full * DUST_CHUNK_PAYLOAD_MAX_BYTES,
    ];
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(cap);
    const res = await uploadZeroChunks(sizes);
    expect(reasonOf(res)).not.toBe("size_limit");
    expect(res.status).toBe(200);
  }, 30_000);

  it("per-upload declared-raw cap: 32 MiB + 1 B is rejected as size_limit before any inflate (review N5)", async () => {
    const cap = 32 * 1024 * 1024;
    const full = Math.floor(cap / DUST_CHUNK_PAYLOAD_MAX_BYTES);
    const sizes = [
      ...Array.from({ length: full }, () => DUST_CHUNK_PAYLOAD_MAX_BYTES),
      cap - full * DUST_CHUNK_PAYLOAD_MAX_BYTES + 1,
    ];
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(cap + 1);
    expect(reasonOf(await uploadZeroChunks(sizes))).toBe("size_limit");
  });

  it("aborts a stream that expands past its declared chunk size", async () => {
    const { h, me, contractId } = await setup();
    const base = build({ contractId });
    const decoded = decodePackage(base.pkg);
    if (!decoded.ok) throw new Error("fixture decodes");
    const chunk = decoded.value.chunks[0];
    if (chunk === undefined) throw new Error("fixture has a chunk");
    // Declares 1 KiB, deflates 256 KiB of zeros (a few hundred bytes): zlib must stop at the declared size.
    const lying = encodePackage({
      ...decoded.value,
      chunks: [{ ...chunk, rawSize: 1024, crc32: 0, bytes: deflateSync(Buffer.alloc(256 * 1024)) }],
    });
    const meta = { ...base.meta, totalBytes: lying.length, packageCrc32: lying.readUInt32LE(lying.length - 4) };
    const res = await put(h, me.accessToken, contractId, {
      pkg: lying,
      metaBytes: new TextEncoder().encode(JSON.stringify(meta)),
    });
    expect(reasonOf(res)).toBe("size_limit");
  });

  it("download serves stored rows without inflating them", async () => {
    const { h, me, contractId } = await setup();
    expect((await put(h, me.accessToken, contractId, build({ contractId }))).status).toBe(200);
    h.advance(30_000);
    // A row that is not valid deflate: a re-inflating download would drop it; the stored-row download serves it as is.
    const garbage = Uint8Array.of(1, 2, 3, 4, 5);
    const committed = await h.repo.commitSoloCheckpoint({
      contractId,
      playerId: me.playerId,
      deviceId: DEVICE,
      baseGeneration: 1,
      overwrite: false,
      generation: 2,
      parentGeneration: 1,
      saveFormatVersion: SAVE_FORMAT_VERSION,
      gameDataVersion: "1.3",
      simTick: 200,
      header: {
        codec: SAVE_HEADER_CODEC,
        rawSize: 0,
        checksum: 0,
        blob: gzipSync(envelope({ generation: 2, parent: 1, simTick: 200 })),
      },
      chunks: [{ chunkId: 3, codec: "deflate", rawSize: 40, checksum: 0x1234, blob: garbage }],
      playtimeS: 90,
      shinePolished: 0,
      walletLumens: 0,
      profileCredit: { tenurePoints: 0, commendations: 0 },
      minIntervalS: 0,
      hardCapBytes: 8 * 1024 * 1024,
    });
    expect(committed.kind).toBe("accepted");
    const res = await h.call("GET", `/v1/contracts/${contractId}/save`, { token: me.accessToken });
    expect(res.status).toBe(200);
    const decoded = decodePackage(res.binary ?? new Uint8Array(0));
    if (!decoded.ok) throw new Error("page decodes");
    const row = decoded.value.chunks.find((c) => c.chunkId === 3);
    expect(row?.rawSize).toBe(40);
    expect(row?.crc32).toBe(0x1234);
    expect(Array.from(row?.bytes ?? [])).toEqual(Array.from(garbage));
  });
});

describe("inflate budget: concurrency (review L1)", () => {
  const budgetOf = (maxQueued: number) =>
    createInflateBudget({ maxConcurrent: 1, maxQueued, bytesPerMinute: 1_000_000, now: () => 0 });

  it("never runs two jobs at once, at any microtask depth of a late arrival", async () => {
    for (let depth = 0; depth < 8; depth += 1) {
      const budget = budgetOf(3);
      let live = 0;
      let maxLive = 0;
      const job = (ms: number, onDone?: () => void) => async (): Promise<void> => {
        live += 1;
        maxLive = Math.max(maxLive, live);
        await new Promise<void>((resolve) =>
          setTimeout(() => {
            onDone?.();
            resolve();
          }, ms),
        );
        live -= 1;
      };
      let release: () => void = () => undefined;
      const lateArrival = new Promise<void>((resolve) => (release = resolve));
      const a = budget.run(
        1,
        job(10, () => release()),
      );
      const b = budget.run(1, job(20));
      let p = lateArrival;
      for (let i = 0; i < depth; i += 1) p = p.then(() => undefined);
      const c = p.then(() => budget.run(1, job(20)));
      await Promise.all([a, b, c]);
      expect(maxLive, `depth ${depth}`).toBe(1);
    }
  });

  it("sheds load beyond the queue and recovers afterwards", async () => {
    const budget = budgetOf(1);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const running = budget.run(1, () => gate);
    const waiting = budget.run(1, async () => "second");
    expect(await budget.run(1, async () => "third")).toMatchObject({ ok: false, retryAfterS: 5 });
    open();
    expect(await running).toEqual({ ok: true, value: undefined });
    expect(await waiting).toEqual({ ok: true, value: "second" });
    expect(await budget.run(1, async () => "again")).toEqual({ ok: true, value: "again" });
    expect(budget.stats()).toMatchObject({ running: 0, queued: 0 });
  });

  it("honours a configured concurrency above one, and releases the slot when a job throws", async () => {
    const budget = createInflateBudget({ maxConcurrent: 2, maxQueued: 0, bytesPerMinute: 1_000_000, now: () => 0 });
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const a = budget.run(1, () => gate);
    const b = budget.run(1, () => gate);
    expect(budget.stats().running).toBe(2);
    expect(await budget.run(1, async () => 1)).toMatchObject({ ok: false });
    open();
    await Promise.all([a, b]);
    await expect(
      budget.run(1, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(budget.stats().running).toBe(0);
    expect(await budget.run(1, async () => "ok")).toEqual({ ok: true, value: "ok" });
  });
});

describe("inflate budget: process-wide bytes per minute (security review R1)", () => {
  it("sheds with a retry-after once the minute's bytes are spent, and refills continuously", async () => {
    let at = 0;
    const budget = createInflateBudget({ maxConcurrent: 1, maxQueued: 3, bytesPerMinute: 60_000, now: () => at });
    expect(await budget.run(40_000, async () => "a")).toEqual({ ok: true, value: "a" });
    // 20_000 left; 30_000 needs 10_000 more at 1_000 per second = 10 s.
    expect(await budget.run(30_000, async () => "b")).toEqual({ ok: false, retryAfterS: 10 });
    at = 10_000;
    expect(await budget.run(30_000, async () => "b")).toEqual({ ok: true, value: "b" });
    // A job larger than the whole bucket is clamped to it (runs alone, never starves forever).
    at = 120_000;
    expect(await budget.run(10_000_000, async () => "big")).toEqual({ ok: true, value: "big" });
    expect(await budget.run(1, async () => "next")).toMatchObject({ ok: false });
  });

  it("is shared by every account: a second guest cannot add budget, and the shed answer is 503 RETRY_LATER", async () => {
    // Bucket of 64 KiB: one upload of a 60 KiB chunk fits, the next (from ANOTHER account) is shed.
    let at = 0;
    const inflateBudget = createInflateBudget({
      maxConcurrent: 1,
      maxQueued: 3,
      bytesPerMinute: 64 * 1024,
      now: () => at,
    });
    const h = createHarness({ checkpoints: { inflateBudget } });
    const mk = async (name: string) => {
      const me = GuestCreateResponseSchema.parse(
        (await h.call("POST", "/v1/auth/guest", { body: { displayName: name }, ip: `198.51.100.${ipCounter++}` })).body,
      );
      const created = await h.call("POST", "/v1/contracts", {
        token: me.accessToken,
        body: { name: "Moon", shiftType: "solo" },
      });
      return { me, contractId: (created.body as { contract: { id: string } }).contract.id };
    };
    const one = await mk("Saver One");
    const two = await mk("Saver Two");
    const big = { id: 1, payload: Buffer.alloc(60 * 1024, 5) };
    const first = await put(
      h,
      one.me.accessToken,
      one.contractId,
      build({ contractId: one.contractId, chunks: [big] }),
    );
    expect(first.status).toBe(200);
    const shed = await put(h, two.me.accessToken, two.contractId, build({ contractId: two.contractId, chunks: [big] }));
    expect(shed.status).toBe(503);
    expect(shed.body).toMatchObject({ error: "RETRY_LATER" });
    expect(Number(shed.headers?.["retry-after"])).toBeGreaterThanOrEqual(1);
    // Nothing was stored for the shed upload.
    const head = await h.call("GET", `/v1/contracts/${two.contractId}/save/head`, { token: two.me.accessToken });
    expect(head.status).toBe(404);
    at += 60_000;
    const retry = await put(
      h,
      two.me.accessToken,
      two.contractId,
      build({ contractId: two.contractId, chunks: [big] }),
    );
    expect(retry.status).toBe(200);
  });

  it("a download is charged only its header size, so reads cannot starve uploads", async () => {
    const { h, me, contractId } = await setup();
    expect((await put(h, me.accessToken, contractId, build({ contractId }))).status).toBe(200);
    for (let i = 0; i < 5; i += 1) {
      h.advance(2_000);
      expect((await h.call("GET", `/v1/contracts/${contractId}/save`, { token: me.accessToken })).status).toBe(200);
    }
  });
});

describe("profile credit bounds (review M2)", () => {
  it("a first upload cannot claim more playtime than the Contract's age, and credits nothing", async () => {
    const { h, me, contractId } = await setup();
    h.advance(60_000); // the Contract is one minute old
    const res = await put(
      h,
      me.accessToken,
      contractId,
      build({ contractId, playtimeS: 20 * 3600, tenure: 12_000, simTick: 100 }),
    );
    expect(res.status).toBe(200);
    expect((res.body as { flags: string[] }).flags).toContain("solo_implausible");
    const profile = await h.call("GET", "/v1/me", { token: me.accessToken });
    expect((profile.body as { tenurePoints: number }).tenurePoints).toBe(0);
  });

  it("a first upload of plausible playtime is credited only up to the per-hour cap", async () => {
    const { h, me, contractId } = await setup();
    h.advance(600_000); // 10 minutes old
    const res = await put(h, me.accessToken, contractId, build({ contractId, playtimeS: 600, tenure: 100_000 }));
    expect(res.status).toBe(200);
    expect((res.body as { flags: string[] }).flags).toEqual(["profile_delta_capped"]);
    const profile = await h.call("GET", "/v1/me", { token: me.accessToken });
    expect((profile.body as { tenurePoints: number }).tenurePoints).toBe(100);
  });

  it("the slack is spent once: frequent uploads cannot stack it into extra playtime", async () => {
    const { h, me, contractId } = await setup();
    let playtime = 0;
    let flagged = 0;
    for (let i = 0; i < 10; i += 1) {
      h.advance(21_000);
      // Claims 60 s more every 21 s (about 2.9x real time); the old per-upload 120 s slack accepted this indefinitely.
      playtime += 60;
      const res = await put(
        h,
        me.accessToken,
        contractId,
        build({ contractId, generation: i + 1, base: i, playtimeS: playtime, simTick: 100 + i * 1200, tenure: 50 }),
      );
      expect(res.status).toBe(200);
      if ((res.body as { flags: string[] }).flags.includes("solo_implausible")) flagged += 1;
    }
    expect(flagged).toBeGreaterThan(0);
  });
});

describe("account-wide playtime credit (security review R3)", () => {
  async function threeContracts() {
    const h = createHarness();
    const me = GuestCreateResponseSchema.parse(
      (await h.call("POST", "/v1/auth/guest", { body: { displayName: "Triple One" }, ip: `198.51.100.${ipCounter++}` }))
        .body,
    );
    const ids: string[] = [];
    for (const name of ["Moon A", "Moon B", "Moon C"]) {
      const created = await h.call("POST", "/v1/contracts", {
        token: me.accessToken,
        body: { name, shiftType: "solo" },
      });
      ids.push((created.body as { contract: { id: string } }).contract.id);
    }
    return { h, me, ids };
  }
  const tenureOf = async (h: Harness, token: string): Promise<number> =>
    ((await h.call("GET", "/v1/me", { token })).body as { tenurePoints: number }).tenurePoints;
  const claim = (id: string, playtimeS: number, extra: Partial<Build> = {}) =>
    build({ contractId: id, playtimeS, tenure: 100_000, simTick: Math.round(playtimeS * 20), ...extra });

  it("three Contracts created together cannot each claim the full elapsed time", async () => {
    const { h, me, ids } = await threeContracts();
    h.advance(600_000); // ten real minutes since the account and all three Contracts were created
    // Alone, each Contract could claim 600 s (100 tenure at 600/h): 3x in total.
    let flagged = 0;
    for (const id of ids) {
      const res = await put(h, me.accessToken, id, claim(id, 600));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      if ((res.body as { flags: string[] }).flags.includes("solo_implausible")) flagged += 1;
    }
    expect(flagged).toBe(2); // the first claim uses the real time, the other two exceed the account's age
    expect(await tenureOf(h, me.accessToken)).toBe(100); // 600 s once, not 1800 s
    // The stored total keeps bounding later claims: still nothing extra for another Contract.
    h.advance(30_000);
    const id = ids[1] as string;
    const again = await put(h, me.accessToken, id, claim(id, 640, { generation: 2, base: 1 }));
    expect(again.status).toBe(200);
    expect(await tenureOf(h, me.accessToken)).toBe(100);
  });

  it("simultaneous uploads for the three Contracts are serialized and credit real time once", async () => {
    const { h, me, ids } = await threeContracts();
    h.advance(600_000);
    const results = await Promise.all(ids.map((id) => put(h, me.accessToken, id, claim(id, 600))));
    for (const res of results) expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await tenureOf(h, me.accessToken)).toBe(100);
  });

  it("sequential real play across Contracts is still credited in full", async () => {
    const { h, me, ids } = await threeContracts();
    h.advance(300_000);
    const a = ids[0] as string;
    expect((await put(h, me.accessToken, a, claim(a, 300))).status).toBe(200);
    expect(await tenureOf(h, me.accessToken)).toBe(50); // 300 s at 600/h
    h.advance(300_000);
    const b = ids[1] as string;
    const second = await put(h, me.accessToken, b, claim(b, 300));
    expect((second.body as { flags: string[] }).flags).not.toContain("solo_implausible");
    expect(await tenureOf(h, me.accessToken)).toBe(100);
  });
});
