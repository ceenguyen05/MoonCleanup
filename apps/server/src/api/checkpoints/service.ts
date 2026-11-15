// Solo checkpoint service (ADR-0031, data-model.md section 3.7c): verify -> commit, head, download.
//
// TRUST MODEL. The server never treats an uploaded checkpoint as authoritative game state. It verifies the CONTAINER (magic,
// versions, lengths, section table, CRC32 of the package, the envelope and every chunk, bounded gunzip/inflate, ids, sizes,
// world identity, generation arithmetic) and bounds what a checkpoint may change on SHARED surfaces (profile credit, capped by
// accepted playtime). The save CONTENT (wallet, plot states, unlocks) is opaque and unverified: a player can edit their own
// solo world, and such a Contract is kept out of shared surfaces by the `solo_implausible` flag. Clients are never told more
// than a uniform reason code.

import { constants as zlibConstants, crc32, gunzip, inflate } from "node:zlib";
import { promisify } from "node:util";
import type { SaveSlotRow } from "@moon-cleanup/db";
import { splitCheckpointUploadBody } from "@moon-cleanup/protocol";
import {
  CHECKPOINT_PART_MAX_BYTES,
  DEFAULT_SIM_TICK_HZ,
  DUST_CHUNK_PAYLOAD_MAX_BYTES,
  SAVE_FORMAT_VERSION,
  SAVE_HEADER_CODEC,
  SAVE_HEADER_MAX_BYTES,
  SAVE_DOWNLOAD_PAGES_HEADER,
  SOLO_UPLOAD_MIN_INTERVAL_S,
  SaveDownloadQuerySchema,
  SoloCheckpointBeginRequestSchema,
  type CheckpointRejectReason,
  type HttpRequest,
  type HttpResponse,
  type SaveConflictBody,
  type SoloCheckpointAccepted,
  type SoloCheckpointSummary,
} from "@moon-cleanup/shared";
import { fail, gate, notFound, parse, type ApiContext } from "../http";
import { createInflateBudget, type InflateBudget } from "./inflate-budget";
import { decodeEnvelope, decodePackage, encodePackage, pageSize, type EnvelopeInfo, type PackageChunk } from "./mcck";

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);

/** Strict UTF-8 (invalid bytes throw) for the metadata JSON that prefixes the upload body. */
const META_DECODER = new TextDecoder("utf-8", { fatal: true });
/** Per-Contract hard cap of data-model.md section 5.1. */
export const CONTRACT_HARD_CAP_BYTES = 8 * 1024 * 1024;
/**
 * Total inflated chunk bytes one package may declare. Sized from the stored-size hard cap: 8 MB stored at the ~4:1 ratio of
 * ledger data is about 32 MiB raw (a plot record is about 1.05 KB raw, so roughly 30,000 touched plots, ten times the typical
 * mid-game Contract of data-model 5.1). The per-chunk bound alone (DUST_CHUNK_PAYLOAD_MAX_BYTES, 421,959 B since shared/save
 * v1.1; 256 KiB at review H1) would allow 641 x 421,959 B = about 258 MiB.
 */
export const CHECKPOINT_RAW_BUDGET_BYTES = 32 * 1024 * 1024;

/**
 * Process-wide decompression budget defaults (see ./inflate-budget). Sized for the 512 MB / 0.1 CPU Render Free instance
 * (NODE_OPTIONS max-old-space-size=384): inflating costs about 14 ms per MiB on a laptop core and an order of magnitude more
 * on the free instance, so one maximum upload (32 MiB) per minute is the most the whole process spends on decompression. A
 * typical mid-game upload inflates about 3 MiB (data-model 5.1), so this still covers several solo players saving every 30 s.
 */
export const DEFAULT_INFLATE_BYTES_PER_MINUTE = 32 * 1024 * 1024;
/** One verification at a time: gunzip/inflate share the single, tiny CPU with the room tick. */
export const DEFAULT_INFLATE_MAX_CONCURRENT = 1;
/** Verifications that may wait for the running one before further ones are shed. */
export const DEFAULT_INFLATE_MAX_QUEUED = 3;

export interface CheckpointOptions {
  /** Lower-case hex bake hash of this build's terrain bake; when set, a different hash is `bake_mismatch`. */
  readonly expectedBakeHash?: string;
  /** Accepted `gameDataVersion` values; when set, any other is `game_data_unknown`. */
  readonly knownGameDataVersions?: readonly string[];
  readonly simTickHz?: number;
  /** Profile credit caps per hour of accepted playtime (placeholders until game-data supplies them). */
  readonly maxTenurePointsPerHour?: number;
  readonly maxCommendationsPerHour?: number;
  /** Largest pending verify queue (running + this many waiting) before 503 RETRY_LATER (default `DEFAULT_INFLATE_MAX_QUEUED`). */
  readonly maxQueued?: number;
  /** Verifications that may inflate at once, process-wide (default `DEFAULT_INFLATE_MAX_CONCURRENT`). */
  readonly inflateMaxConcurrent?: number;
  /** Inflated bytes per minute the whole process may spend on checkpoints (default `DEFAULT_INFLATE_BYTES_PER_MINUTE`). */
  readonly inflateBytesPerMinute?: number;
  /** Test seam: a ready-made budget (e.g. shared, or with a fake clock). Overrides the three numbers above. */
  readonly inflateBudget?: InflateBudget;
  readonly minIntervalS?: number;
  /** Cap on the total inflated chunk bytes of one upload (default `CHECKPOINT_RAW_BUDGET_BYTES`). */
  readonly maxRawBytes?: number;
}

/** Client clock drift allowed once against the Contract's age. */
const MAX_CLIENT_DRIFT_SLACK_S = 120;
/** Per-upload allowance on top of the wall-clock time since the previous upload (capture-to-receipt jitter). */
const MAX_INTERVAL_SLACK_S = 20;

/**
 * Inflated size a gzip stream CLAIMS (its trailer's ISIZE, little-endian, last 4 bytes), clamped to the header limit. It only
 * prices the job for the budget: the real inflate is bounded by `SAVE_HEADER_MAX_BYTES` whatever it claims, so a lying trailer
 * can underpay by at most that bound (about 1 MiB, a few milliseconds).
 */
function gzipDeclaredSize(gz: Uint8Array): number {
  if (gz.byteLength < 18) return SAVE_HEADER_MAX_BYTES;
  const v = new DataView(gz.buffer, gz.byteOffset, gz.byteLength);
  return Math.min(SAVE_HEADER_MAX_BYTES, v.getUint32(gz.byteLength - 4, true));
}

function rejected(ctx: ApiContext, playerId: string, reason: CheckpointRejectReason): HttpResponse {
  ctx.audit({ kind: "checkpoint_rejected", playerId });
  return { status: 422, body: { error: "CHECKPOINT_REJECTED", reason } };
}

function summaryOf(head: {
  generation: number;
  parentGeneration: number | null;
  originKind: "room" | "solo";
  savedAt: Date;
  simTick: number;
  playtimeS: number;
  shinePolished: number;
  walletLumens: number;
  saveFormatVersion: number;
  gameDataVersion: string;
}): SoloCheckpointSummary {
  return {
    generation: head.generation,
    parentGeneration: head.parentGeneration ?? 0,
    originKind: head.originKind,
    savedAt: head.savedAt.toISOString(),
    simTick: head.simTick,
    playtimeS: head.playtimeS,
    shinePolished: Math.max(0, Math.floor(head.shinePolished)),
    walletLumens: Math.max(0, head.walletLumens),
    saveFormatVersion: head.saveFormatVersion,
    gameDataVersion: head.gameDataVersion.length === 0 ? "unknown" : head.gameDataVersion.slice(0, 32),
  };
}

export function createCheckpointService(ctx: ApiContext, options: CheckpointOptions = {}) {
  const hz = options.simTickHz ?? DEFAULT_SIM_TICK_HZ;
  const maxTenure = options.maxTenurePointsPerHour ?? 600;
  const maxCommendations = options.maxCommendationsPerHour ?? 6;
  const minIntervalS = options.minIntervalS ?? SOLO_UPLOAD_MIN_INTERVAL_S;
  const maxRawBytes = options.maxRawBytes ?? CHECKPOINT_RAW_BUDGET_BYTES;

  // Process-wide decompression budget (security review R1): gunzip/inflate run on the libuv pool but share the one tiny CPU
  // with the room tick, so at most `inflateMaxConcurrent` verifications run at once and the bytes inflated per minute are
  // bounded; anything beyond is shed with 503 RETRY_LATER + retry-after instead of queued without bound.
  const budget =
    options.inflateBudget ??
    createInflateBudget({
      maxConcurrent: options.inflateMaxConcurrent ?? DEFAULT_INFLATE_MAX_CONCURRENT,
      maxQueued: options.maxQueued ?? DEFAULT_INFLATE_MAX_QUEUED,
      bytesPerMinute: options.inflateBytesPerMinute ?? DEFAULT_INFLATE_BYTES_PER_MINUTE,
    });
  const busy = (retryAfterS: number): HttpResponse =>
    fail("RETRY_LATER", "checkpoint verification is busy", { "retry-after": String(retryAfterS) });

  async function gunzipBounded(bytes: Uint8Array): Promise<Buffer | CheckpointRejectReason> {
    try {
      return await gunzipAsync(bytes, { maxOutputLength: SAVE_HEADER_MAX_BYTES });
    } catch (error) {
      return (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" ? "size_limit" : "bad_envelope";
    }
  }
  /** Inflates at most `limit` bytes: zlib aborts as soon as the output would exceed it (no bomb-sized buffer is ever built). */
  async function inflateBounded(bytes: Uint8Array, limit: number): Promise<Buffer | CheckpointRejectReason> {
    try {
      return await inflateAsync(bytes, {
        maxOutputLength: Math.max(1, Math.min(limit, DUST_CHUNK_PAYLOAD_MAX_BYTES)),
        finishFlush: zlibConstants.Z_SYNC_FLUSH,
      });
    } catch (error) {
      return (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" ? "size_limit" : "bad_envelope";
    }
  }

  // Serializes the credit decision and the commit of ONE player's uploads (security review R3). The account-wide playtime bound
  // reads the player's total claimed playtime and the commit then raises it: without this, three uploads for three Contracts
  // sent at the same instant would each see the same total and each claim the full remaining room. In-process is enough
  // because the deployment is a single instance (ADR-0029); a second instance would need a database lock on the player row.
  const playerChains = new Map<string, Promise<unknown>>();
  function withPlayerLock<T>(playerId: string, job: () => Promise<T>): Promise<T> {
    const previous = playerChains.get(playerId) ?? Promise.resolve();
    const run = previous.then(job, job);
    const tail = run.catch(() => undefined);
    playerChains.set(playerId, tail);
    void tail.then(() => {
      if (playerChains.get(playerId) === tail) playerChains.delete(playerId);
    });
    return run;
  }

  async function upload(playerId: string, contractId: string, request: HttpRequest, now: Date) {
    // 1. Cheap checks first. Body = u16 LE metaLen | metadata JSON | MCCK package (api/rest v0.4.0). The split never copies:
    // `raw` is a view of the package inside the request body.
    const body = request.rawBody;
    if (body === undefined) return fail("BAD_REQUEST", "invalid request");
    const split = splitCheckpointUploadBody(body);
    if (!split.ok) {
      return split.reason === "too_large"
        ? fail("PAYLOAD_TOO_LARGE", "checkpoint exceeds one request")
        : fail("BAD_REQUEST", "invalid request");
    }
    const raw = split.pkg;
    let metaJson: unknown;
    try {
      metaJson = JSON.parse(META_DECODER.decode(split.meta));
    } catch {
      return fail("BAD_REQUEST", "invalid request");
    }
    const metaParsed = parse(SoloCheckpointBeginRequestSchema, metaJson);
    if (!metaParsed.ok) return metaParsed.response;
    const meta = metaParsed.value;
    if (meta.contractId !== contractId || meta.partCount !== 1 || meta.totalBytes !== raw.byteLength) {
      return fail("BAD_REQUEST", "invalid request");
    }

    const limited = await gate(ctx, [{ rule: "soloUpload", key: playerId }]);
    if (limited !== undefined) return limited;

    // 2. Authorization and world identity from the database (no gunzip yet).
    const contract = await ctx.repo.getContract(contractId, playerId);
    if (contract === null) return notFound();
    if (contract.role !== "holder") return rejected(ctx, playerId, "not_holder");
    if (contract.shiftType !== "solo") return rejected(ctx, playerId, "contract_not_solo");
    if (meta.saveFormatVersion > SAVE_FORMAT_VERSION) {
      return fail("SAVE_VERSION_UNSUPPORTED", "save format is newer than this server");
    }
    if (options.knownGameDataVersions !== undefined && !options.knownGameDataVersions.includes(meta.gameDataVersion)) {
      return rejected(ctx, playerId, "game_data_unknown");
    }
    if (options.expectedBakeHash !== undefined && meta.bakeHash !== options.expectedBakeHash) {
      return rejected(ctx, playerId, "bake_mismatch");
    }

    // 3. Package structure and CRC (cheap, bounded by the 1 MB body).
    const pkg = decodePackage(raw);
    if (!pkg.ok) return rejected(ctx, playerId, pkg.reason);
    const p = pkg.value;
    const trailerCrc = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).readUInt32LE(raw.byteLength - 4);
    if (trailerCrc !== meta.packageCrc32) return rejected(ctx, playerId, "bad_crc");
    if (p.contractId !== contractId) return rejected(ctx, playerId, "bad_envelope");
    if (p.generation !== meta.generation || p.baseGeneration !== meta.baseGeneration) {
      return rejected(ctx, playerId, "bad_envelope");
    }
    if (p.header.byteLength === 0) return rejected(ctx, playerId, "bad_envelope");
    // Amplification guard (review H1): the total INFLATED size of a package is capped before anything is inflated. A 178 KB
    // request may otherwise declare 641 x DUST_CHUNK_PAYLOAD_MAX_BYTES (421,959 B) = about 258 MiB of zeros.
    let declaredRaw = 0;
    for (const chunk of p.chunks) declaredRaw += chunk.rawSize;
    if (declaredRaw > maxRawBytes) return rejected(ctx, playerId, "size_limit");
    if (meta.generation <= meta.parentGeneration) return rejected(ctx, playerId, "generation_not_increasing");

    // 4. Bounded decompression and CRC of the header envelope and each chunk, one verification at a time.
    // The job is charged its worst-case inflated size up front: declared chunk bytes plus the header (its gzip trailer's size).
    const budgeted = await budget.run(
      declaredRaw + gzipDeclaredSize(p.header),
      async (): Promise<
        | { ok: true; envelope: EnvelopeInfo; rawHeaderSize: number; headerCrc: number; chunkCrcs: number[] }
        | { ok: false; reason: CheckpointRejectReason }
      > => {
        const header = await gunzipBounded(p.header);
        if (typeof header === "string") return { ok: false, reason: header };
        const envelope = decodeEnvelope(header);
        if (!envelope.ok) return { ok: false, reason: envelope.reason };
        const chunkCrcs: number[] = [];
        for (const chunk of p.chunks) {
          // Bounded by the chunk's DECLARED size: a stream that expands past it is aborted immediately.
          const payload = await inflateBounded(chunk.bytes, chunk.rawSize);
          if (typeof payload === "string") return { ok: false, reason: payload };
          if (payload.byteLength !== chunk.rawSize) return { ok: false, reason: "bad_envelope" };
          if (crc32(payload) !== chunk.crc32) return { ok: false, reason: "bad_crc" };
          chunkCrcs.push(chunk.crc32);
        }
        const headerCrc = Buffer.from(header.buffer, header.byteOffset, header.byteLength).readUInt32LE(
          header.byteLength - 4,
        );
        return { ok: true, envelope: envelope.value, rawHeaderSize: header.byteLength, headerCrc, chunkCrcs };
      },
    );
    if (!budgeted.ok) return busy(budgeted.retryAfterS);
    const verified = budgeted.value;
    if (!verified.ok) return rejected(ctx, playerId, verified.reason);
    const env = verified.envelope;

    if (env.saveFormatVersion > SAVE_FORMAT_VERSION) {
      return fail("SAVE_VERSION_UNSUPPORTED", "save format is newer than this server");
    }
    if (env.saveFormatVersion !== SAVE_FORMAT_VERSION || env.saveFormatVersion !== meta.saveFormatVersion) {
      return rejected(ctx, playerId, "bad_envelope");
    }
    if (env.originKind !== "solo") return rejected(ctx, playerId, "bad_envelope");
    if (env.generation !== meta.generation || env.parentGeneration !== meta.parentGeneration) {
      return rejected(ctx, playerId, "bad_envelope");
    }
    if (env.bakeHash !== meta.bakeHash) return rejected(ctx, playerId, "bake_mismatch");
    if (env.gridM !== contract.gridM || env.plotCount !== contract.plotCount)
      return rejected(ctx, playerId, "bake_mismatch");

    return withPlayerLock(playerId, async () => {
      // 5. Plausibility (flag, never reject) and capped shared-surface credit, from the previous server copy.
      const prev = await ctx.repo.getSaveHead(contractId);
      const flags: SoloCheckpointAccepted["flags"] = [];
      const claimedPlaytime = meta.summary.playtimeS;
      const prevPlaytime = prev?.playtimeS ?? 0;
      let playtimeDelta = Math.max(0, claimedPlaytime - prevPlaytime);
      let implausible = false;
      // Review M2: playtime is bounded by the wall clock twice. (a) Cumulative: total claimed playtime cannot exceed the
      // Contract's age (the slack is spent once, not once per upload), which also bounds the FIRST upload to the time since the
      // Contract was created. (b) Per interval: the delta cannot exceed the time since the previous accepted upload.
      const ageS = Math.max(0, (now.getTime() - contract.createdAt.getTime()) / 1000);
      const cumulativeRoom = Math.max(0, ageS * 1.05 + MAX_CLIENT_DRIFT_SLACK_S - prevPlaytime);
      if (playtimeDelta > cumulativeRoom) {
        implausible = true;
        playtimeDelta = Math.floor(cumulativeRoom);
      }
      // Review R3: the same bound across the player's WHOLE Contract quota. Per-Contract age alone lets N Contracts created together
      // each claim the full elapsed time (N x credit); the sum of playtime claimed on all owned Contracts (any status) cannot
      // exceed the account's age either, so total credit can never outrun real elapsed time. The slack is spent once, here.
      const ledger = await ctx.repo.getPlaytimeLedger(playerId);
      if (ledger !== null) {
        const accountAgeS = Math.max(0, (now.getTime() - ledger.accountCreatedAt.getTime()) / 1000);
        const otherContractsS = Math.max(0, ledger.contractsPlaytimeS - prevPlaytime);
        const accountRoom = Math.max(0, accountAgeS * 1.05 + MAX_CLIENT_DRIFT_SLACK_S - otherContractsS - prevPlaytime);
        if (playtimeDelta > accountRoom) {
          implausible = true;
          playtimeDelta = Math.floor(accountRoom);
        }
      }
      if (prev !== null) {
        const elapsedS = Math.max(0, (now.getTime() - prev.savedAt.getTime()) / 1000);
        const allowedPlaytime = elapsedS * 1.05 + MAX_INTERVAL_SLACK_S;
        if (playtimeDelta > allowedPlaytime) {
          implausible = true;
          playtimeDelta = Math.floor(allowedPlaytime);
        }
        const tickDelta = Math.max(0, env.simTick - prev.simTick);
        if (tickDelta > playtimeDelta * hz * 1.05 + hz * 2) implausible = true;
      }
      if (meta.summary.shinePolished > contract.plotCount || !Number.isFinite(meta.summary.walletLumens))
        implausible = true;
      if (implausible) {
        flags.push("solo_implausible");
        ctx.audit({ kind: "solo_implausible", playerId });
      }

      const hours = playtimeDelta / 3600;
      const tenureCap = Math.floor(hours * maxTenure);
      const commendationCap = Math.floor(hours * maxCommendations);
      const credit = implausible
        ? { tenurePoints: 0, commendations: 0 }
        : {
            tenurePoints: Math.min(meta.profileDelta.tenurePoints, tenureCap),
            commendations: Math.min(meta.profileDelta.commendations, commendationCap),
          };
      if (
        !implausible &&
        (credit.tenurePoints < meta.profileDelta.tenurePoints || credit.commendations < meta.profileDelta.commendations)
      ) {
        flags.push("profile_delta_capped");
      }

      // 6. One transaction in the repository (Holder, solo, lease, fast-forward CAS, interval, cap, mirrors, credit).
      const result = await ctx.repo.commitSoloCheckpoint({
        contractId,
        playerId,
        deviceId: meta.deviceId,
        baseGeneration: meta.baseGeneration,
        overwrite: meta.overwrite,
        generation: meta.generation,
        parentGeneration: meta.parentGeneration,
        saveFormatVersion: env.saveFormatVersion,
        gameDataVersion: meta.gameDataVersion,
        simTick: env.simTick,
        header: {
          codec: SAVE_HEADER_CODEC,
          rawSize: verified.rawHeaderSize,
          checksum: verified.headerCrc,
          blob: p.header,
        },
        chunks: p.chunks.map((c) => ({
          chunkId: c.chunkId,
          codec: "deflate",
          rawSize: c.rawSize,
          checksum: c.crc32,
          blob: c.bytes,
        })),
        playtimeS: Math.max(0, Math.floor(claimedPlaytime)),
        shinePolished: Math.min(contract.plotCount, Math.max(0, Math.floor(meta.summary.shinePolished))),
        walletLumens: Number.isFinite(meta.summary.walletLumens)
          ? Math.min(1e12, Math.max(0, meta.summary.walletLumens))
          : 0,
        profileCredit: credit,
        minIntervalS,
        hardCapBytes: CONTRACT_HARD_CAP_BYTES,
      });
      switch (result.kind) {
        case "accepted": {
          const body: SoloCheckpointAccepted = {
            acceptedGeneration: result.generation,
            savedAt: result.savedAt.toISOString(),
            // A replay changed nothing: its flags and credit were decided by the first acceptance.
            flags: result.replayed ? [] : flags,
          };
          return { status: 200, body } as HttpResponse;
        }
        case "conflict": {
          const server = result.server;
          const body: SaveConflictBody = {
            error: "SAVE_CONFLICT",
            server: summaryOf(
              server ?? {
                generation: 0,
                parentGeneration: 0,
                originKind: "room",
                savedAt: now,
                simTick: 0,
                playtimeS: 0,
                shinePolished: 0,
                walletLumens: 0,
                saveFormatVersion: SAVE_FORMAT_VERSION,
                gameDataVersion: "unknown",
              },
            ),
          };
          return { status: 409, body };
        }
        case "generation_not_increasing":
          return rejected(ctx, playerId, "generation_not_increasing");
        case "too_soon":
          return fail("RATE_LIMITED", "checkpoint uploads are limited per Contract", {
            "retry-after": String(result.retryAfterS),
          });
        case "busy":
          return fail("CONTRACT_BUSY", "a live room holds this Contract");
        case "not_found":
          return notFound();
        case "not_holder":
          return rejected(ctx, playerId, "not_holder");
        case "not_solo":
          return rejected(ctx, playerId, "contract_not_solo");
        case "over_cap":
          return rejected(ctx, playerId, "size_limit");
      }
    });
  }

  async function head(playerId: string, contractId: string): Promise<HttpResponse> {
    const limited = await gate(ctx, [{ rule: "saveRead", key: playerId }]);
    if (limited !== undefined) return limited;
    const contract = await ctx.repo.getContract(contractId, playerId);
    if (contract === null) return notFound();
    const found = await ctx.repo.getSaveHead(contractId);
    return found === null ? notFound() : { status: 200, body: summaryOf(found) };
  }

  /** Data-model 3.7b load rule over the stored rows, then MCCK pages of at most 1 MB. */
  async function download(
    playerId: string,
    contractId: string,
    query: Readonly<Record<string, string>>,
  ): Promise<HttpResponse> {
    const limited = await gate(ctx, [{ rule: "saveRead", key: playerId }]);
    if (limited !== undefined) return limited;
    const q = parse(SaveDownloadQuerySchema, query);
    if (!q.ok) return q.response;
    const contract = await ctx.repo.getContract(contractId, playerId);
    if (contract === null) return notFound();
    const rows = await ctx.repo.loadSaveRows(contractId);
    if (rows.slots.length === 0) return notFound();

    // Charge: the header slots' stored raw sizes (the only thing a download inflates), at least 1 byte per slot.
    const downloadCost = rows.slots.reduce(
      (sum, slot) => sum + Math.min(SAVE_HEADER_MAX_BYTES, Math.max(1, slot.rawSize)),
      0,
    );
    const budgeted = await budget.run(downloadCost, async () => {
      let chosen: SaveSlotRow | undefined;
      for (const slot of [...rows.slots].sort((a, b) => b.saveSeq - a.saveSeq)) {
        if (slot.codec !== SAVE_HEADER_CODEC) continue;
        const raw = await gunzipBounded(slot.blob);
        if (typeof raw === "string") continue;
        const env = decodeEnvelope(raw);
        if (!env.ok) continue;
        chosen = slot;
        break;
      }
      if (chosen === undefined) return null;
      const byChunk = new Map<number, typeof rows.chunks>();
      for (const row of rows.chunks) {
        if (row.saveSeq > chosen.saveSeq) continue; // written by a newer, rejected header transaction
        byChunk.set(row.chunkId, [...(byChunk.get(row.chunkId) ?? []), row]);
      }
      // Review H1: chunk rows are NOT re-inflated. Each row was inflated, size-checked and CRC-checked in `upload` before it was
      // committed, and the stored metadata (rawSize, signed CRC, ver) is what the page index serves; the client re-verifies the
      // CRC on load. Download therefore costs reads and framing only, whatever the world's inflated size.
      const chunks: PackageChunk[] = [];
      for (const [chunkId, versions] of [...byChunk.entries()].sort((a, b) => a[0] - b[0])) {
        const row = [...versions].sort((a, b) => b.saveSeq - a.saveSeq)[0];
        if (row === undefined) continue;
        chunks.push({ chunkId, ver: row.ver, rawSize: row.rawSize, crc32: row.checksum >>> 0, bytes: row.blob });
      }
      return { chosen, chunks };
    });
    if (!budgeted.ok) return busy(budgeted.retryAfterS);
    const built = budgeted.value;
    if (built === null) return fail("INTERNAL", "no readable save");

    // Pack pages greedily: page 0 carries the header, every page stays within one request-size budget.
    const header = built.chosen.blob;
    const pages: PackageChunk[][] = [[]];
    let size = pageSize(header.byteLength, []);
    for (const chunk of built.chunks) {
      const add = pageSize(0, [chunk.bytes.byteLength]) - pageSize(0, []);
      const current = pages[pages.length - 1] as PackageChunk[];
      if (size + add > CHECKPOINT_PART_MAX_BYTES && current.length > 0) {
        pages.push([chunk]);
        size = pageSize(0, [chunk.bytes.byteLength]);
      } else {
        current.push(chunk);
        size += add;
      }
    }
    if (q.value.page >= pages.length) return notFound();
    const binary = encodePackage({
      contractId,
      generation: built.chosen.saveSeq,
      baseGeneration: built.chosen.saveSeq,
      header: q.value.page === 0 ? header : new Uint8Array(0),
      chunks: pages[q.value.page] as PackageChunk[],
    });
    return {
      status: 200,
      binary,
      headers: { "content-type": "application/octet-stream", [SAVE_DOWNLOAD_PAGES_HEADER]: String(pages.length) },
    };
  }

  return { upload, head, download };
}
