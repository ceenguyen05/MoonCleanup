// Dust bytes messages (world-and-dust-simulation.md section 5.1): DUST_REQUEST (0x03, c2s), DUST_SNAPSHOT (0x21),
// DUST_LEDGER (0x22), DUST_LOG (0x23), DUST_CHECK (0x24). Decoded shapes are the world/dust payloads of
// @moon-cleanup/shared. These are cold or low-rate messages (join, dust-radius entry, 0.2 Hz checks), so decoders of
// the bulk ones return plain objects; every count read from the wire is capped and checked against the bytes that
// remain BEFORE anything is allocated, and no decoder throws (a failure returns `null` / `false`).
//
// Layouts (all little-endian; bit fields LSB first as BIT_PACKING; the unused high bits of the last byte are zero and
// are checked). Section framing here is a v1 decision [R] (the shared contracts give widths, not message layouts):
//   DUST_REQUEST : id | kind 1 (0 plots, 1 chunk) | plots: count 4 (1..8), count x plotId 18 | chunk: chunkId 10
//   DUST_CHECK   : id | mode 1 (0 chunks, 1 detail) | chunks: count 8, count x (chunkId 10, xorHash 32)
//                      | detail: chunkId 10, count 9 (0..256), count x (plotId 18, ledgerVersion 32, hash 32)
//   LOG ENTRY    : plotId u24 | refTick u32 | chainCount u16 | chainCount x stroke chain (dust-wire.ts); a stroke
//                  older than 255 ticks before refTick decodes as exactly 255 ticks old (8-bit tickOffset)
//   DUST_LOG     : id | LOG ENTRY
//   LEDGER RAW   : version u32 | remainingUnits u32 | initialUnits u32 | ownedTexels u16 | mgPerUnit u32 | hash u32 |
//                  contributionCount u8 | count x (actorSlot u8, units u32) | 1,024 texel bytes
//   DUST_LEDGER  : id | plotId u24 | deflate(LEDGER RAW)
//   DUST_SNAPSHOT: id | sliceIndex u16 | sliceCount u16 | snapshotVersion u32 | slice of the deflate stream of
//                  SNAPSHOT RAW = plotCount u32 | plotStates ceil(plotCount/4) B | openedRemaining (one byte per
//                  Opened plot in plotStates) | ledgerCount u16 | ledgerCount x (plotId u24, LEDGER RAW) |
//                  logCount u16 | logCount x LOG ENTRY
// Compression is injected (`Deflate` / `Inflate`): the server uses Node zlib, the client fflate or DecompressionStream
// in a worker; this package stays free of Node and DOM.

import {
  DUST_MESSAGE_SLICE_MAX_BYTES,
  DUST_REQUEST_MAX_PLOTS,
  DUST_SNAPSHOT_SLICE_HEADER_BYTES,
  LEDGER_BYTES,
  LEDGER_CONTRIBUTION_BYTES,
  LEDGER_HEADER_FIXED_BYTES,
  LEDGER_MAX_CONTRIBUTIONS,
  MESSAGE_CATALOG,
  PlotState,
  CHUNK_COUNT,
  type DustCheckPayload,
  type DustRequestPayload,
  type PlotId,
} from "@moon-cleanup/shared";
import { BitReader, BitWriter } from "./bits";
import { PLOT_ID_BITS } from "./dust-wire";
import { readStrokeChain, strokeChainBytes, writeStrokeChain } from "./dust-wire";
import { StrokeChainBuffer } from "./frame-state";

export const DUST_REQUEST_ID = MESSAGE_CATALOG.DUST_REQUEST.id;
export const DUST_SNAPSHOT_ID = MESSAGE_CATALOG.DUST_SNAPSHOT.id;
export const DUST_LEDGER_ID = MESSAGE_CATALOG.DUST_LEDGER.id;
export const DUST_LOG_ID = MESSAGE_CATALOG.DUST_LOG.id;
export const DUST_CHECK_ID = MESSAGE_CATALOG.DUST_CHECK.id;

/** Caps against untrusted counts. */
export const DUST_CHECK_MAX_CHUNKS = 255;
export const DUST_CHECK_MAX_DETAIL_PLOTS = 256;
export const DUST_LOG_MAX_CHAINS = 256;
export const DUST_LOG_MAX_CONTINUATIONS = 4096;
/** Highest contribution actor slot a LEDGER RAW carries (player slots; readLedgerRaw rejects more). */
export const LEDGER_WIRE_ACTOR_SLOT_MAX = 15;
export const DUST_SNAPSHOT_MAX_SLICES = 64;
export const DUST_SNAPSHOT_MAX_LEDGERS = 1024;
export const DUST_SNAPSHOT_MAX_LOGS = 256;
/**
 * Largest SNAPSHOT RAW the encoder emits and the decoder inflates (1.5 MiB). One ledger is at least 3 + 23 + 1024 = 1050
 * bytes (up to 1070 with 4 contributions), so a full DUST_SNAPSHOT_MAX_LEDGERS (1024) snapshot is ~1.1 MB plus the
 * plot-state arrays (~200 KB at 163,842 plots): the cap must sit above that or the client would refuse a snapshot the
 * server legitimately built. The encoder rejects anything larger, so both sides always agree. The join bar is still
 * <= 150 KB compressed and today's worst case ~250 KB raw. Not to be confused with the 32 MiB per-package inflate budget
 * of solo checkpoint uploads (apps/server/src/api/checkpoints, a separate REST path). The wire ceiling is separate:
 * DUST_SNAPSHOT_MAX_SLICES x (4,096 - 9) = 261,568 deflated bytes (world-and-dust-simulation.md 5.4).
 */
export const DUST_SNAPSHOT_MAX_RAW_BYTES = 3 << 19;
export const LEDGER_RAW_MAX_BYTES =
  LEDGER_HEADER_FIXED_BYTES + LEDGER_MAX_CONTRIBUTIONS * LEDGER_CONTRIBUTION_BYTES + LEDGER_BYTES;
const MAX_PLOT_COUNT = 1 << PLOT_ID_BITS;

export type Deflate = (raw: Uint8Array) => Uint8Array;
/** Returns the inflated bytes, or null on corrupt input or when the result would exceed `maxBytes`. Must not throw. */
export type Inflate = (data: Uint8Array, maxBytes: number) => Uint8Array | null;

function padOk(br: BitReader): boolean {
  const pad = (8 - (br.bitPos & 7)) & 7;
  return pad === 0 || br.readBits(pad) === 0;
}

/** True when the reader consumed exactly `length` bytes with no error. */
function doneAt(br: BitReader, length: number): boolean {
  return !br.error && padOk(br) && !br.error && br.bitPos === length * 8;
}

// ---- DUST_REQUEST --------------------------------------------------------------------------------------------------

/** Writes a DUST_REQUEST message at `out[0]`. Returns its length (<= 20), or 0 when the request is invalid. */
export function encodeDustRequest(req: DustRequestPayload, out: Uint8Array): number {
  const bw = new BitWriter(out);
  bw.writeBits(DUST_REQUEST_ID, 8);
  if (req.kind === "plots") {
    const n = req.plotIds.length;
    if (n < 1 || n > DUST_REQUEST_MAX_PLOTS) return 0;
    bw.writeBits(0, 1);
    bw.writeBits(n, 4);
    for (const id of req.plotIds) {
      if (!(id >= 0 && id < MAX_PLOT_COUNT)) return 0;
      bw.writeBits(id, PLOT_ID_BITS);
    }
  } else {
    if (!(req.chunkId >= 0 && req.chunkId < CHUNK_COUNT)) return 0;
    bw.writeBits(1, 1);
    bw.writeBits(req.chunkId, 10);
  }
  bw.align();
  return bw.overflow ? 0 : bw.byteLength;
}

/** Decodes a DUST_REQUEST (exact length). `plotCount` bounds plot ids. Returns null when invalid. */
export function decodeDustRequest(message: Uint8Array, plotCount: number): DustRequestPayload | null {
  if (message.byteLength < 3 || message.byteLength > 20 || message[0] !== DUST_REQUEST_ID) return null;
  const br = new BitReader(message);
  br.readBits(8);
  if (br.readBits(1) === 0) {
    const n = br.readBits(4);
    if (n < 1 || n > DUST_REQUEST_MAX_PLOTS) return null;
    const ids: PlotId[] = [];
    for (let i = 0; i < n; i++) {
      const id = br.readBits(PLOT_ID_BITS);
      if (br.error || id >= plotCount) return null;
      ids.push(id as PlotId);
    }
    return doneAt(br, message.byteLength) ? { kind: "plots", plotIds: ids } : null;
  }
  const chunkId = br.readBits(10);
  if (br.error || chunkId >= CHUNK_COUNT) return null;
  return doneAt(br, message.byteLength) ? { kind: "chunk", chunkId } : null;
}

// ---- DUST_CHECK ----------------------------------------------------------------------------------------------------

/** Writes a DUST_CHECK message. Returns its length, or 0 when invalid or it does not fit `out`. */
export function encodeDustCheck(check: DustCheckPayload, out: Uint8Array): number {
  const bw = new BitWriter(out);
  bw.writeBits(DUST_CHECK_ID, 8);
  if (check.mode === "chunks") {
    if (check.chunks.length > DUST_CHECK_MAX_CHUNKS) return 0;
    bw.writeBits(0, 1);
    bw.writeBits(check.chunks.length, 8);
    for (const c of check.chunks) {
      if (!(c.chunkId >= 0 && c.chunkId < CHUNK_COUNT)) return 0;
      bw.writeBits(c.chunkId, 10);
      bw.writeBits(c.xorHash, 32);
    }
  } else {
    if (check.plots.length > DUST_CHECK_MAX_DETAIL_PLOTS || !(check.chunkId >= 0 && check.chunkId < CHUNK_COUNT)) {
      return 0;
    }
    bw.writeBits(1, 1);
    bw.writeBits(check.chunkId, 10);
    bw.writeBits(check.plots.length, 9);
    for (const p of check.plots) {
      bw.writeBits(p.plotId, PLOT_ID_BITS);
      bw.writeBits(p.ledgerVersion, 32);
      bw.writeBits(p.hash, 32);
    }
  }
  bw.align();
  return bw.overflow ? 0 : bw.byteLength;
}

/** Decodes a DUST_CHECK (exact length). Returns null when invalid. */
export function decodeDustCheck(message: Uint8Array, plotCount: number): DustCheckPayload | null {
  if (message.byteLength < 2 || message[0] !== DUST_CHECK_ID) return null;
  const br = new BitReader(message);
  br.readBits(8);
  if (br.readBits(1) === 0) {
    const n = br.readBits(8);
    if (br.remainingBits() < n * 42) return null;
    const chunks: { chunkId: number; xorHash: number }[] = [];
    for (let i = 0; i < n; i++) {
      const chunkId = br.readBits(10);
      const xorHash = br.readBits(32);
      if (chunkId >= CHUNK_COUNT) return null;
      chunks.push({ chunkId, xorHash });
    }
    return doneAt(br, message.byteLength) ? { mode: "chunks", chunks } : null;
  }
  const chunkId = br.readBits(10);
  const n = br.readBits(9);
  if (br.error || chunkId >= CHUNK_COUNT || n > DUST_CHECK_MAX_DETAIL_PLOTS || br.remainingBits() < n * 82) return null;
  const plots: { plotId: PlotId; ledgerVersion: number; hash: number }[] = [];
  for (let i = 0; i < n; i++) {
    const plotId = br.readBits(PLOT_ID_BITS);
    const ledgerVersion = br.readBits(32);
    const hash = br.readBits(32);
    if (plotId >= plotCount) return null;
    plots.push({ plotId: plotId as PlotId, ledgerVersion, hash });
  }
  return doneAt(br, message.byteLength) ? { mode: "detail", chunkId, plots } : null;
}

// ---- Little-endian helpers over a plain byte cursor -----------------------------------------------------------------

/** Byte cursor over a Uint8Array for the byte-oriented parts (ledger raw, snapshot raw). Sticky `error`. */
class Cursor {
  pos = 0;
  error = false;
  constructor(readonly b: Uint8Array) {}
  left(): number {
    return this.b.length - this.pos;
  }
  u8(): number {
    if (this.pos + 1 > this.b.length) {
      this.error = true;
      return 0;
    }
    return this.b[this.pos++] ?? 0;
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u24(): number {
    return this.u8() | (this.u8() << 8) | (this.u8() << 16);
  }
  u32(): number {
    return (this.u8() | (this.u8() << 8) | (this.u8() << 16) | (this.u8() << 24)) >>> 0;
  }
  bytes(n: number): Uint8Array | null {
    if (n < 0 || this.pos + n > this.b.length) {
      this.error = true;
      return null;
    }
    const v = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
}

function put32(out: Uint8Array, at: number, v: number): void {
  out[at] = v & 0xff;
  out[at + 1] = (v >>> 8) & 0xff;
  out[at + 2] = (v >>> 16) & 0xff;
  out[at + 3] = (v >>> 24) & 0xff;
}

// ---- Ledger raw ---------------------------------------------------------------------------------------------------

export interface LedgerRawInput {
  readonly header: {
    readonly version: number;
    readonly remainingUnits: number;
    readonly initialUnits: number;
    readonly ownedTexels: number;
    readonly mgPerUnit: number;
    readonly hash: number;
    readonly contributions: readonly { readonly actorSlot: number; readonly units: number }[];
  };
  readonly texels: Uint8Array;
}

/** Bytes of the LEDGER RAW of `ledger`. */
export function ledgerRawBytes(ledger: LedgerRawInput): number {
  return (
    LEDGER_HEADER_FIXED_BYTES + ledger.header.contributions.length * LEDGER_CONTRIBUTION_BYTES + ledger.texels.length
  );
}

/** Writes LEDGER RAW at `out[at]`. Returns the bytes written, or 0 when invalid or it does not fit. */
export function writeLedgerRaw(ledger: LedgerRawInput, out: Uint8Array, at = 0): number {
  const h = ledger.header;
  const n = h.contributions.length;
  const len = ledgerRawBytes(ledger);
  if (n > LEDGER_MAX_CONTRIBUTIONS || ledger.texels.length !== LEDGER_BYTES || at + len > out.length) return 0;
  // Review S2: never write what readLedgerRaw rejects (one bad ledger would void a whole snapshot).
  if (!(h.ownedTexels >= 0 && h.ownedTexels <= LEDGER_BYTES) || h.remainingUnits > h.initialUnits) return 0;
  for (const c of h.contributions) if (!(c.actorSlot >= 0 && c.actorSlot <= LEDGER_WIRE_ACTOR_SLOT_MAX)) return 0;
  put32(out, at, h.version);
  put32(out, at + 4, h.remainingUnits);
  put32(out, at + 8, h.initialUnits);
  out[at + 12] = h.ownedTexels & 0xff;
  out[at + 13] = (h.ownedTexels >>> 8) & 0xff;
  put32(out, at + 14, h.mgPerUnit);
  put32(out, at + 18, h.hash);
  out[at + 22] = n;
  let p = at + LEDGER_HEADER_FIXED_BYTES;
  for (const c of h.contributions) {
    out[p] = c.actorSlot & 0xff;
    put32(out, p + 1, c.units);
    p += LEDGER_CONTRIBUTION_BYTES;
  }
  out.set(ledger.texels, p);
  return len;
}

export interface DecodedLedger {
  readonly header: {
    readonly version: number;
    readonly remainingUnits: number;
    readonly initialUnits: number;
    readonly ownedTexels: number;
    readonly mgPerUnit: number;
    readonly hash: number;
    readonly contributions: readonly { readonly actorSlot: number; readonly units: number }[];
  };
  /** A copy (1,024 bytes). */
  readonly texels: Uint8Array;
}

function readLedgerRaw(c: Cursor): DecodedLedger | null {
  const version = c.u32();
  const remainingUnits = c.u32();
  const initialUnits = c.u32();
  const ownedTexels = c.u16();
  const mgPerUnit = c.u32();
  const hash = c.u32();
  const n = c.u8();
  if (c.error || n > LEDGER_MAX_CONTRIBUTIONS || ownedTexels > LEDGER_BYTES || remainingUnits > initialUnits) {
    return null;
  }
  if (c.left() < n * LEDGER_CONTRIBUTION_BYTES + LEDGER_BYTES) return null;
  const contributions: { actorSlot: number; units: number }[] = [];
  for (let i = 0; i < n; i++) {
    const actorSlot = c.u8();
    const units = c.u32();
    if (actorSlot > LEDGER_WIRE_ACTOR_SLOT_MAX) return null;
    contributions.push({ actorSlot, units });
  }
  const texels = c.bytes(LEDGER_BYTES);
  if (c.error || texels === null) return null;
  return {
    header: { version, remainingUnits, initialUnits, ownedTexels, mgPerUnit, hash, contributions },
    texels: texels.slice(),
  };
}

/** Decodes a whole LEDGER RAW buffer (exact length). */
export function decodeLedgerRaw(raw: Uint8Array): DecodedLedger | null {
  const c = new Cursor(raw);
  const l = readLedgerRaw(c);
  return l !== null && c.pos === raw.length ? l : null;
}

/** Writes a DUST_LEDGER message (id, plotId u24, deflated raw). Returns the bytes written, or 0 on failure. */
export function encodeDustLedger(plotId: number, ledger: LedgerRawInput, deflate: Deflate, out: Uint8Array): number {
  if (!(plotId >= 0 && plotId < MAX_PLOT_COUNT)) return 0;
  const raw = new Uint8Array(ledgerRawBytes(ledger));
  if (writeLedgerRaw(ledger, raw) === 0) return 0;
  const z = deflate(raw);
  if (4 + z.length > out.length) return 0;
  out[0] = DUST_LEDGER_ID;
  out[1] = plotId & 0xff;
  out[2] = (plotId >>> 8) & 0xff;
  out[3] = (plotId >>> 16) & 0xff;
  out.set(z, 4);
  return 4 + z.length;
}

export interface DecodedDustLedger extends DecodedLedger {
  readonly plotId: PlotId;
}

/** Decodes a DUST_LEDGER message. Returns null on any failure (bad id, plot, inflate, ledger layout). */
export function decodeDustLedger(message: Uint8Array, inflate: Inflate, plotCount: number): DecodedDustLedger | null {
  if (message.byteLength < 5 || message[0] !== DUST_LEDGER_ID) return null;
  const plotId = (message[1] ?? 0) | ((message[2] ?? 0) << 8) | ((message[3] ?? 0) << 16);
  if (plotId >= plotCount) return null;
  const raw = inflate(message.subarray(4), LEDGER_RAW_MAX_BYTES);
  if (raw === null) return null;
  const ledger = decodeLedgerRaw(raw);
  return ledger === null ? null : { plotId: plotId as PlotId, ...ledger };
}

// ---- Log entry (DUST_LOG and snapshot logs) ------------------------------------------------------------------------

/** Bytes of a LOG ENTRY with `chains` (only chains `0 ..` of `buf`). */
export function logEntryBytes(buf: StrokeChainBuffer): number {
  let n = 3 + 4 + 2;
  for (let i = 0; i < buf.chainCount; i++) n += strokeChainBytes(buf, i);
  return n;
}

/** Writes a LOG ENTRY at `out[at]`. Returns the bytes written, or 0 when invalid or it does not fit. */
export function writeLogEntry(
  plotId: number,
  refTick: number,
  buf: StrokeChainBuffer,
  out: Uint8Array,
  at = 0,
): number {
  const len = logEntryBytes(buf);
  if (!(plotId >= 0 && plotId < MAX_PLOT_COUNT) || buf.chainCount > DUST_LOG_MAX_CHAINS || at + len > out.length) {
    return 0;
  }
  // Review S2: the decoder caps one entry at DUST_LOG_MAX_CONTINUATIONS continuations in total.
  let continuations = 0;
  for (let i = 0; i < buf.chainCount; i++) continuations += buf.contCount[i] ?? 0;
  if (continuations > DUST_LOG_MAX_CONTINUATIONS) return 0;
  const view = out.subarray(at, at + len);
  const bw = new BitWriter(view);
  bw.writeBits(plotId, 24);
  bw.writeBits(refTick >>> 0, 32);
  bw.writeBits(buf.chainCount, 16);
  for (let i = 0; i < buf.chainCount; i++) writeStrokeChain(bw, buf, i, refTick);
  return bw.overflow ? 0 : len;
}

export interface DecodedLog {
  readonly plotId: PlotId;
  readonly refTick: number;
  readonly chains: StrokeChainBuffer;
}

/** Reads one LOG ENTRY from `c`; the chain buffer is sized from the chain count and the bytes that remain. */
function readLogEntry(c: Cursor, plotCount: number): DecodedLog | null {
  const plotId = c.u24();
  const refTick = c.u32();
  const chainCount = c.u16();
  if (c.error || plotId >= plotCount || chainCount > DUST_LOG_MAX_CHAINS) return null;
  const remainingBytes = c.left();
  if (chainCount * 18 > remainingBytes) return null;
  const contCap = Math.min(DUST_LOG_MAX_CONTINUATIONS, Math.floor((remainingBytes - chainCount * 18) / 4));
  const chains = new StrokeChainBuffer(chainCount, contCap);
  const br = new BitReader(c.b);
  br.bitPos = c.pos * 8;
  for (let i = 0; i < chainCount; i++) {
    if (!readStrokeChain(br, chains, refTick, plotCount)) return null;
  }
  if (br.error) return null;
  c.pos = br.bitPos >>> 3;
  return { plotId: plotId as PlotId, refTick, chains };
}

/** Writes a DUST_LOG message (id + LOG ENTRY). Returns the bytes written, or 0. */
export function encodeDustLog(plotId: number, refTick: number, buf: StrokeChainBuffer, out: Uint8Array): number {
  if (out.length < 1) return 0;
  out[0] = DUST_LOG_ID;
  const n = writeLogEntry(plotId, refTick, buf, out, 1);
  return n === 0 ? 0 : n + 1;
}

/** Decodes a DUST_LOG message (exact length). Returns null on any failure. */
export function decodeDustLog(message: Uint8Array, plotCount: number): DecodedLog | null {
  if (message.byteLength < 10 || message[0] !== DUST_LOG_ID) return null;
  const c = new Cursor(message);
  c.pos = 1;
  const log = readLogEntry(c, plotCount);
  return log !== null && c.pos === message.length ? log : null;
}

// ---- DUST_SNAPSHOT --------------------------------------------------------------------------------------------------

/** Number of slices needed for `deflatedBytes`. */
export function snapshotSliceCount(deflatedBytes: number): number {
  const per = DUST_MESSAGE_SLICE_MAX_BYTES - DUST_SNAPSHOT_SLICE_HEADER_BYTES;
  return Math.max(1, Math.ceil(deflatedBytes / per));
}

/** Writes slice `index` of `deflated` as a DUST_SNAPSHOT message. Returns the bytes written, or 0. */
export function writeSnapshotSlice(deflated: Uint8Array, index: number, version: number, out: Uint8Array): number {
  const per = DUST_MESSAGE_SLICE_MAX_BYTES - DUST_SNAPSHOT_SLICE_HEADER_BYTES;
  const count = snapshotSliceCount(deflated.length);
  if (index < 0 || index >= count || count > DUST_SNAPSHOT_MAX_SLICES) return 0;
  const part = deflated.subarray(index * per, Math.min(deflated.length, (index + 1) * per));
  if (DUST_SNAPSHOT_SLICE_HEADER_BYTES + part.length > out.length) return 0;
  out[0] = DUST_SNAPSHOT_ID;
  out[1] = index & 0xff;
  out[2] = index >>> 8;
  out[3] = count & 0xff;
  out[4] = count >>> 8;
  put32(out, 5, version);
  out.set(part, DUST_SNAPSHOT_SLICE_HEADER_BYTES);
  return DUST_SNAPSHOT_SLICE_HEADER_BYTES + part.length;
}

/**
 * Reassembles DUST_SNAPSHOT slices. Slices may arrive in any order; a slice with a different `snapshotVersion` restarts
 * the assembly (a newer snapshot replaces an unfinished one). Memory is bounded: at most DUST_SNAPSHOT_MAX_SLICES
 * slices of the slice size, allocated on the first slice from its (checked) count.
 */
export class SnapshotAssembler {
  version = -1;
  sliceCount = 0;
  received = 0;
  private parts: (Uint8Array | undefined)[] = [];

  /** Adds a slice message. Returns "complete", "pending" or "invalid" (dropped). */
  add(message: Uint8Array): "complete" | "pending" | "invalid" {
    if (message.byteLength <= DUST_SNAPSHOT_SLICE_HEADER_BYTES || message.byteLength > DUST_MESSAGE_SLICE_MAX_BYTES) {
      return "invalid";
    }
    if (message[0] !== DUST_SNAPSHOT_ID) return "invalid";
    const index = (message[1] ?? 0) | ((message[2] ?? 0) << 8);
    const count = (message[3] ?? 0) | ((message[4] ?? 0) << 8);
    const version =
      ((message[5] ?? 0) | ((message[6] ?? 0) << 8) | ((message[7] ?? 0) << 16) | ((message[8] ?? 0) << 24)) >>> 0;
    if (count < 1 || count > DUST_SNAPSHOT_MAX_SLICES || index >= count) return "invalid";
    if (version !== this.version || count !== this.sliceCount) {
      this.version = version;
      this.sliceCount = count;
      this.received = 0;
      this.parts = new Array<Uint8Array | undefined>(count).fill(undefined);
    }
    if (this.parts[index] === undefined) {
      this.parts[index] = message.slice(DUST_SNAPSHOT_SLICE_HEADER_BYTES);
      this.received++;
    }
    return this.received === this.sliceCount ? "complete" : "pending";
  }

  /** The concatenated deflate stream once complete, else null. */
  take(): Uint8Array | null {
    if (this.sliceCount === 0 || this.received !== this.sliceCount) return null;
    let total = 0;
    for (const p of this.parts) total += p?.length ?? 0;
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of this.parts) {
      if (p === undefined) return null;
      out.set(p, at);
      at += p.length;
    }
    this.sliceCount = 0;
    this.received = 0;
    this.parts = [];
    return out;
  }
}

export interface SnapshotRawInput {
  readonly plotCount: number;
  /** 2 bits per plot, ceil(plotCount / 4) bytes (DustSnapshotPayload.plotStates). */
  readonly plotStates: Uint8Array;
  /** One byte per Opened plot of `plotStates`, in PlotId order. */
  readonly openedRemaining: Uint8Array;
  readonly ledgers: readonly { readonly plotId: number; readonly ledger: LedgerRawInput }[];
  readonly logs: readonly { readonly plotId: number; readonly refTick: number; readonly chains: StrokeChainBuffer }[];
}

const PLOT_STATE_OPENED = PlotState.Opened;

/** Counts the Opened (state 1) plots in a 2-bit state array of `plotCount` plots. */
export function countOpened(plotStates: Uint8Array, plotCount: number): number {
  let n = 0;
  const opened = PLOT_STATE_OPENED; // hoisted: a namespace property read per plot dominated the loop (13-20 ms -> <1 ms)
  for (let p = 0; p < plotCount; p++) {
    if ((((plotStates[p >>> 2] ?? 0) >>> ((p & 3) * 2)) & 3) === opened) n++;
  }
  return n;
}

/** Serialises SNAPSHOT RAW (before deflate). Returns null when the input is inconsistent. */
export function encodeSnapshotRaw(s: SnapshotRawInput): Uint8Array | null {
  const stateBytes = Math.ceil(s.plotCount / 4);
  if (s.plotCount < 1 || s.plotCount > MAX_PLOT_COUNT || s.plotStates.length !== stateBytes) return null;
  if (s.openedRemaining.length !== countOpened(s.plotStates, s.plotCount)) return null;
  if (s.ledgers.length > DUST_SNAPSHOT_MAX_LEDGERS || s.logs.length > DUST_SNAPSHOT_MAX_LOGS) return null;
  let total = 4 + stateBytes + s.openedRemaining.length + 2 + 2;
  for (const l of s.ledgers) total += 3 + ledgerRawBytes(l.ledger);
  for (const l of s.logs) total += logEntryBytes(l.chains);
  if (total > DUST_SNAPSHOT_MAX_RAW_BYTES) return null; // the decoder would refuse it (inflate cap)
  const out = new Uint8Array(total);
  put32(out, 0, s.plotCount);
  let at = 4;
  out.set(s.plotStates, at);
  at += stateBytes;
  out.set(s.openedRemaining, at);
  at += s.openedRemaining.length;
  out[at++] = s.ledgers.length & 0xff;
  out[at++] = s.ledgers.length >>> 8;
  for (const l of s.ledgers) {
    out[at] = l.plotId & 0xff;
    out[at + 1] = (l.plotId >>> 8) & 0xff;
    out[at + 2] = (l.plotId >>> 16) & 0xff;
    const n = writeLedgerRaw(l.ledger, out, at + 3);
    if (n === 0) return null;
    at += 3 + n;
  }
  out[at++] = s.logs.length & 0xff;
  out[at++] = s.logs.length >>> 8;
  for (const l of s.logs) {
    const n = writeLogEntry(l.plotId, l.refTick, l.chains, out, at);
    if (n === 0) return null;
    at += n;
  }
  return at === total ? out : null;
}

export interface DecodedSnapshot {
  readonly plotCount: number;
  readonly plotStates: Uint8Array;
  readonly openedRemaining: Uint8Array;
  readonly ledgers: readonly DecodedDustLedger[];
  readonly logs: readonly DecodedLog[];
}

/** Decodes SNAPSHOT RAW (exact length). `plotCount` of the grid must equal the encoded one. Returns null on failure. */
export function decodeSnapshotRaw(raw: Uint8Array, expectedPlotCount: number): DecodedSnapshot | null {
  const c = new Cursor(raw);
  const plotCount = c.u32();
  if (c.error || plotCount !== expectedPlotCount || plotCount < 1 || plotCount > MAX_PLOT_COUNT) return null;
  const plotStates = c.bytes(Math.ceil(plotCount / 4));
  if (plotStates === null) return null;
  const opened = countOpened(plotStates, plotCount);
  const openedRemaining = c.bytes(opened);
  if (openedRemaining === null) return null;
  const ledgerCount = c.u16();
  if (
    c.error ||
    ledgerCount > DUST_SNAPSHOT_MAX_LEDGERS ||
    c.left() < ledgerCount * (3 + LEDGER_HEADER_FIXED_BYTES + LEDGER_BYTES)
  ) {
    return null;
  }
  const ledgers: DecodedDustLedger[] = [];
  for (let i = 0; i < ledgerCount; i++) {
    const plotId = c.u24();
    const ledger = readLedgerRaw(c);
    if (ledger === null || plotId >= plotCount) return null;
    ledgers.push({ plotId: plotId as PlotId, ...ledger });
  }
  const logCount = c.u16();
  if (c.error || logCount > DUST_SNAPSHOT_MAX_LOGS || c.left() < logCount * 9) return null;
  const logs: DecodedLog[] = [];
  for (let i = 0; i < logCount; i++) {
    const log = readLogEntry(c, plotCount);
    if (log === null) return null;
    logs.push(log);
  }
  if (c.pos !== raw.length) return null;
  return { plotCount, plotStates: plotStates.slice(), openedRemaining: openedRemaining.slice(), ledgers, logs };
}

/** Inflates and decodes an assembled snapshot stream. */
export function decodeSnapshotStream(
  deflated: Uint8Array,
  inflate: Inflate,
  expectedPlotCount: number,
): DecodedSnapshot | null {
  const raw = inflate(deflated, DUST_SNAPSHOT_MAX_RAW_BYTES);
  return raw === null ? null : decodeSnapshotRaw(raw, expectedPlotCount);
}
