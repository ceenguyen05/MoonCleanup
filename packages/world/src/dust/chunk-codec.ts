// Dust chunk payload codec (contract shared/save/dust-chunk v1; WDS section 6, data-model 3.7b): the body of one
// `contract_dust_chunks` row before deflate. Pure, so the Solo worker and the server run the same code (ADR-0031).
// Deflate, CRC32 and the two-version row logic belong to the persistence layer / sim-host, not to this file.
//
//   encodeDustChunkPayload / decodeDustChunkPayload   the decoded form (DustChunkPayload) <-> bytes; allocating;
//                                                     for tools, tests and upload verification
//   DustChunkEncoder                                  WorldDustLedger -> bytes straight from the pools (one reused
//                                                     buffer), with the stroke log as chains
//   DustRestoreJob / restoreDustChunks                bytes -> WorldDustLedger, input NOT trusted, sliceable by a
//                                                     millisecond budget
//
// Stroke log bytes: chains in the chain wire format (shared/world/stroke; record framing as packages/protocol
// codec/dust-wire): header 136 bits LSB-first (anchor 18 | startU i16 | startV i16 | endU i16 | endV i16 |
// widthCm 10 | depth16 8 | toolCode 6 | actorSlot 6 | tickOffset 8 | inputSeq 16) | continuationCount u8 |
// count x (actorSlot 6 | dxMm i13 | dyMm i13). The log keeps no tick or inputSeq, so both are written as 0.

import {
  DUST_CHUNK_FIXED_BYTES,
  DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES,
  DUST_CHUNK_PAYLOAD_MAX_BYTES,
  DUST_CHUNK_PAYLOAD_VERSION,
  DUST_CHUNK_STROKE_CHAIN_PREFIX_BYTES,
  DUST_CHUNK_STROKE_LOG_MAX_BYTES,
  DUST_CHUNK_POLE_PLOTS,
  DUST_CHUNK_POLE_STATE_BYTES,
  DUST_CHUNK_STATE_BYTES,
  LEDGER_BYTES,
  LEDGER_CONTRIBUTION_BYTES,
  LEDGER_EDGE_TEXELS,
  LEDGER_HEADER_FIXED_BYTES,
  LEDGER_MAX_CONTRIBUTIONS,
  PLOTS_PER_CHUNK,
  PlotState,
  SAVED_STROKE_LOG_MAX,
  STROKE_DELTA_MM_MAX,
  STROKE_DELTA_MM_MIN,
  type DustChunkPayload,
  type DustChunkPlotRecord,
} from "@moon-cleanup/shared";
import { fnv1a32, remainingFraction255, type WorldDustLedger } from "./ledger";
import { LoggedStroke } from "./stroke-log";

const HEADER_BYTES = 17;
const CHAIN_PREFIX_BYTES = HEADER_BYTES + 1;
const CONTINUATION_BYTES = 4;
/** Bytes of a plot record before its contributions: localIndex, remainingFrac, fixed ledger header. */
const RECORD_HEAD_BYTES = 2 + LEDGER_HEADER_FIXED_BYTES;
/** Bytes after the texels: strokeCount u8, strokeLogBytes u16. */
const RECORD_TAIL_BYTES = 3;
/** Largest stroke log of one plot: every stroke its own chain (contract DUST_CHUNK_STROKE_LOG_MAX_BYTES, 576 B). */
const LOG_MAX_BYTES = DUST_CHUNK_STROKE_LOG_MAX_BYTES;

/**
 * Largest payload the v1 layout can produce: a full chunk, every plot touched, 4 contributions and 32 unchained
 * strokes each (421,959 B). Alias of the contract's DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES; since shared/save v1.1
 * (M1-W0-T08) the validate-before-write and upload limit DUST_CHUNK_PAYLOAD_MAX_BYTES equals it, so every payload
 * this encoder writes can be stored and uploaded with full logs.
 */
export const DUST_CHUNK_LAYOUT_MAX_BYTES = DUST_CHUNK_PAYLOAD_LAYOUT_MAX_BYTES;

export type DustChunkErrorCode =
  | "truncated"
  | "unsupported_version"
  | "bad_chunk_id"
  | "bad_count"
  | "bad_order"
  | "bad_state"
  | "bad_header"
  | "trailing_bytes"
  | "oversize"
  | "bake_mismatch";

export interface DustChunkError {
  readonly code: DustChunkErrorCode;
  readonly detail: string;
}

function fail(code: DustChunkErrorCode, detail: string): DustChunkError {
  return { code, detail };
}

function u16At(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function u32At(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}
function putU16(b: Uint8Array, o: number, v: number): void {
  b[o] = v;
  b[o + 1] = v >>> 8;
}
function putU32(b: Uint8Array, o: number, v: number): void {
  b[o] = v;
  b[o + 1] = v >>> 8;
  b[o + 2] = v >>> 16;
  b[o + 3] = v >>> 24;
}

/**
 * Writes the low `bits` bits (at most 18) of `value` at bit position `bitPos`, LSB-first: bit k of the stream is bit
 * (k & 7) of byte (k >> 3), as packages/protocol codec/bits. The target bits must be zero.
 */
function putBits(b: Uint8Array, bitPos: number, value: number, bits: number): void {
  const at = bitPos >> 3;
  const v = (value & ((1 << bits) - 1)) << (bitPos & 7); // at most 25 bits
  b[at] = b[at]! | (v & 0xff);
  if (v > 0xff) b[at + 1] = b[at + 1]! | ((v >>> 8) & 0xff);
  if (v > 0xffff) b[at + 2] = b[at + 2]! | ((v >>> 16) & 0xff);
  if (v > 0xff_ffff) b[at + 3] = b[at + 3]! | (v >>> 24);
}
/** Reads `bits` bits (at most 18) at bit position `bitPos`, LSB-first. Bytes past the end read as 0. */
function getBits(b: Uint8Array, bitPos: number, bits: number): number {
  const at = bitPos >> 3;
  const v = (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16) | ((b[at + 3] ?? 0) << 24);
  return (v >>> (bitPos & 7)) & ((1 << bits) - 1);
}
function signed(v: number, bits: number): number {
  return (v << (32 - bits)) >> (32 - bits);
}

// ---- structural scan (shared by the decoder and the restore job) ------------------------------------------------------

/** Offsets found by `scanDustChunk`. Reused. */
export class DustChunkScan {
  chunkId = 0;
  bakeCheck = 0;
  plotsInChunk = 0;
  stateOffset = 0;
  touchedCount = 0;
  /** Byte offset of each plot record. */
  readonly recordOffset = new Int32Array(PLOTS_PER_CHUNK);
}

function stateAt(bytes: Uint8Array, stateOffset: number, k: number): number {
  return (bytes[stateOffset + (k >> 2)]! >> ((k & 3) * 2)) & 3;
}

/**
 * Checks the structure of a payload (lengths, counts, order, record states) without touching any ledger and fills
 * `scan`. `poleChunkId` is the grid's pole chunk (640 for Standard). Returns null when the payload is well formed.
 */
export function scanDustChunk(bytes: Uint8Array, poleChunkId: number, scan: DustChunkScan): DustChunkError | null {
  if (bytes.length > DUST_CHUNK_LAYOUT_MAX_BYTES) return fail("oversize", `payload ${bytes.length} B`);
  if (bytes.length < DUST_CHUNK_FIXED_BYTES) return fail("truncated", "fixed fields");
  const version = u16At(bytes, 0);
  if (version !== DUST_CHUNK_PAYLOAD_VERSION) return fail("unsupported_version", `payloadVersion ${version}`);
  const chunkId = u16At(bytes, 2);
  if (chunkId > poleChunkId) return fail("bad_chunk_id", `chunk ${chunkId}`);
  const pole = chunkId === poleChunkId;
  const plots = pole ? DUST_CHUNK_POLE_PLOTS : PLOTS_PER_CHUNK;
  const stateBytes = pole ? DUST_CHUNK_POLE_STATE_BYTES : DUST_CHUNK_STATE_BYTES;
  const touched = u16At(bytes, 5);
  if (touched > plots) return fail("bad_count", `touchedCount ${touched}`);
  let pos = DUST_CHUNK_FIXED_BYTES + stateBytes;
  if (pos > bytes.length) return fail("truncated", "plot states");
  scan.chunkId = chunkId;
  scan.bakeCheck = bytes[4]!;
  scan.plotsInChunk = plots;
  scan.stateOffset = DUST_CHUNK_FIXED_BYTES;
  scan.touchedCount = touched;
  let previous = -1;
  for (let k = 0; k < touched; k++) {
    if (pos + RECORD_HEAD_BYTES > bytes.length) return fail("truncated", `record ${k}`);
    const local = bytes[pos]!;
    if (local >= plots) return fail("bad_order", `localIndex ${local} outside the chunk`);
    if (local <= previous) return fail("bad_order", `record ${k} not in ascending localIndex order`);
    previous = local;
    const state = stateAt(bytes, scan.stateOffset, local);
    if (state !== PlotState.Grimy && state !== PlotState.Opened) return fail("bad_state", `record ${k} state ${state}`);
    const contributions = bytes[pos + RECORD_HEAD_BYTES - 1]!;
    if (contributions > LEDGER_MAX_CONTRIBUTIONS) return fail("bad_count", `record ${k} contributions`);
    const tail = pos + RECORD_HEAD_BYTES + contributions * LEDGER_CONTRIBUTION_BYTES + LEDGER_BYTES;
    if (tail + RECORD_TAIL_BYTES > bytes.length) return fail("truncated", `record ${k} texels`);
    const strokeCount = bytes[tail]!;
    if (strokeCount > SAVED_STROKE_LOG_MAX) return fail("bad_count", `record ${k} strokeCount`);
    const logBytes = u16At(bytes, tail + 1);
    // Contract v1.1: a log holds at most one chain prefix per stroke.
    if (logBytes > strokeCount * DUST_CHUNK_STROKE_CHAIN_PREFIX_BYTES) {
      return fail("bad_count", `record ${k} strokeLogBytes ${logBytes} for ${strokeCount} strokes`);
    }
    const next = tail + RECORD_TAIL_BYTES + logBytes;
    if (next > bytes.length) return fail("truncated", `record ${k} stroke log`);
    scan.recordOffset[k] = pos;
    pos = next;
  }
  if (pos !== bytes.length) return fail("trailing_bytes", `${bytes.length - pos} B after the last record`);
  return null;
}

// ---- decoded form ---------------------------------------------------------------------------------------------------

/** Encodes the decoded form. Throws RangeError on a payload that breaks the layout (programming error, not input). */
export function encodeDustChunkPayload(payload: DustChunkPayload): Uint8Array {
  let size = DUST_CHUNK_FIXED_BYTES + Math.ceil(payload.states.length / 4);
  for (const p of payload.plots) {
    if (p.texels.length !== LEDGER_BYTES) throw new RangeError("ledger texels must be 1024 bytes");
    if (p.ledger.contributions.length > LEDGER_MAX_CONTRIBUTIONS) throw new RangeError("too many contributions");
    size +=
      RECORD_HEAD_BYTES +
      p.ledger.contributions.length * LEDGER_CONTRIBUTION_BYTES +
      LEDGER_BYTES +
      RECORD_TAIL_BYTES +
      p.strokeLog.length;
  }
  const b = new Uint8Array(size);
  putU16(b, 0, payload.payloadVersion);
  putU16(b, 2, payload.chunkId);
  b[4] = payload.bakeCheck;
  putU16(b, 5, payload.plots.length);
  payload.states.forEach((s, k) => {
    b[DUST_CHUNK_FIXED_BYTES + (k >> 2)] = b[DUST_CHUNK_FIXED_BYTES + (k >> 2)]! | (s << ((k & 3) * 2));
  });
  let pos = DUST_CHUNK_FIXED_BYTES + Math.ceil(payload.states.length / 4);
  for (const p of payload.plots) {
    b[pos] = p.localIndex;
    b[pos + 1] = p.remainingFrac;
    putU32(b, pos + 2, p.ledger.version);
    putU32(b, pos + 6, p.ledger.remainingUnits);
    putU32(b, pos + 10, p.ledger.initialUnits);
    putU16(b, pos + 14, p.ledger.ownedTexels);
    putU32(b, pos + 16, p.ledger.mgPerUnit);
    putU32(b, pos + 20, p.ledger.hash);
    b[pos + 24] = p.ledger.contributions.length;
    pos += RECORD_HEAD_BYTES;
    for (const c of p.ledger.contributions) {
      b[pos] = c.actorSlot;
      putU32(b, pos + 1, c.units);
      pos += LEDGER_CONTRIBUTION_BYTES;
    }
    b.set(p.texels, pos);
    pos += LEDGER_BYTES;
    b[pos] = p.strokeCount;
    putU16(b, pos + 1, p.strokeLog.length);
    pos += RECORD_TAIL_BYTES;
    b.set(p.strokeLog, pos);
    pos += p.strokeLog.length;
  }
  return b;
}

export type DustChunkDecodeResult =
  { readonly ok: true; readonly payload: DustChunkPayload } | { readonly ok: false; readonly error: DustChunkError };

/** Decodes a payload into the decoded form (copies texels and logs). Never throws on bad input. */
export function decodeDustChunkPayload(bytes: Uint8Array, poleChunkId: number): DustChunkDecodeResult {
  const scan = new DustChunkScan();
  const error = scanDustChunk(bytes, poleChunkId, scan);
  if (error) return { ok: false, error };
  const states: PlotState[] = [];
  for (let k = 0; k < scan.plotsInChunk; k++) states.push(stateAt(bytes, scan.stateOffset, k) as PlotState);
  const plots: DustChunkPlotRecord[] = [];
  for (let k = 0; k < scan.touchedCount; k++) {
    let pos = scan.recordOffset[k]!;
    const remainingUnits = u32At(bytes, pos + 6);
    const initialUnits = u32At(bytes, pos + 10);
    const ownedTexels = u16At(bytes, pos + 14);
    if (remainingUnits > initialUnits || ownedTexels > LEDGER_BYTES) {
      return { ok: false, error: fail("bad_header", `record ${k} ledger header`) };
    }
    const count = bytes[pos + 24]!;
    const contributions: { actorSlot: number; units: number }[] = [];
    const head = {
      localIndex: bytes[pos]!,
      remainingFrac: bytes[pos + 1]!,
      version: u32At(bytes, pos + 2),
      mgPerUnit: u32At(bytes, pos + 16),
      hash: u32At(bytes, pos + 20),
    };
    pos += RECORD_HEAD_BYTES;
    for (let c = 0; c < count; c++) {
      if (bytes[pos]! > 63) return { ok: false, error: fail("bad_header", `record ${k} contribution actor`) };
      contributions.push({ actorSlot: bytes[pos]!, units: u32At(bytes, pos + 1) });
      pos += LEDGER_CONTRIBUTION_BYTES;
    }
    const texels = bytes.slice(pos, pos + LEDGER_BYTES);
    pos += LEDGER_BYTES;
    const strokeCount = bytes[pos]!;
    const logBytes = u16At(bytes, pos + 1);
    pos += RECORD_TAIL_BYTES;
    plots.push({
      localIndex: head.localIndex,
      remainingFrac: head.remainingFrac,
      ledger: {
        version: head.version,
        remainingUnits,
        initialUnits,
        ownedTexels,
        mgPerUnit: head.mgPerUnit,
        hash: head.hash,
        contributions,
      },
      texels,
      strokeCount,
      strokeLog: bytes.slice(pos, pos + logBytes),
    });
  }
  return {
    ok: true,
    payload: {
      payloadVersion: DUST_CHUNK_PAYLOAD_VERSION,
      chunkId: scan.chunkId,
      bakeCheck: scan.bakeCheck,
      states,
      plots,
    },
  };
}

// ---- stroke log <-> chains ------------------------------------------------------------------------------------------

/**
 * Writes the `keep` most recent logged strokes of `plot` as chains into `out` at `offset` (which must be zeroed for
 * LOG bytes). Returns the bytes written. Consecutive strokes of one actor that share an end / start point and all
 * parameters become 4-byte continuations.
 */
function writeStrokeLog(
  ledger: WorldDustLedger,
  plot: number,
  keep: number,
  out: Uint8Array,
  offset: number,
  rec: LoggedStroke,
): number {
  const log = ledger.log;
  if (log === null || keep <= 0) return 0;
  const have = log.count(plot);
  let pos = offset;
  let countAt = -1;
  let hAnchor = 0;
  let hWidth = 0;
  let hDepth = 0;
  let hTool = 0;
  let hActor = 0;
  let lastU = 0;
  let lastV = 0;
  for (let k = have - keep; k < have; k++) {
    log.read(plot, k, rec);
    const dx = rec.endUMm - rec.startUMm;
    const dy = rec.endVMm - rec.startVMm;
    const continues =
      countAt >= 0 &&
      out[countAt]! < 255 &&
      rec.anchor === hAnchor &&
      rec.widthCm === hWidth &&
      rec.depth16 === hDepth &&
      rec.toolCode === hTool &&
      rec.actorSlot === hActor &&
      rec.startUMm === lastU &&
      rec.startVMm === lastV &&
      dx >= STROKE_DELTA_MM_MIN &&
      dx <= STROKE_DELTA_MM_MAX &&
      dy >= STROKE_DELTA_MM_MIN &&
      dy <= STROKE_DELTA_MM_MAX;
    if (continues) {
      const bit = pos * 8;
      putBits(out, bit, rec.actorSlot, 6);
      putBits(out, bit + 6, dx & 0x1fff, 13);
      putBits(out, bit + 19, dy & 0x1fff, 13);
      pos += CONTINUATION_BYTES;
      out[countAt] = out[countAt]! + 1;
    } else {
      let bit = pos * 8;
      putBits(out, bit, rec.anchor, 18);
      bit += 18;
      putBits(out, bit, rec.startUMm & 0xffff, 16);
      bit += 16;
      putBits(out, bit, rec.startVMm & 0xffff, 16);
      bit += 16;
      putBits(out, bit, rec.endUMm & 0xffff, 16);
      bit += 16;
      putBits(out, bit, rec.endVMm & 0xffff, 16);
      bit += 16;
      putBits(out, bit, rec.widthCm, 10);
      bit += 10;
      putBits(out, bit, rec.depth16, 8);
      bit += 8;
      putBits(out, bit, rec.toolCode, 6);
      bit += 6;
      putBits(out, bit, rec.actorSlot, 6);
      // tickOffset (8) and inputSeq (16) stay 0.
      countAt = pos + HEADER_BYTES;
      out[countAt] = 0;
      pos += CHAIN_PREFIX_BYTES;
      hAnchor = rec.anchor;
      hWidth = rec.widthCm;
      hDepth = rec.depth16;
      hTool = rec.toolCode;
      hActor = rec.actorSlot;
    }
    lastU = rec.endUMm;
    lastV = rec.endVMm;
  }
  return pos - offset;
}

/**
 * Reads `strokeCount` strokes stored as chains in bytes[offset .. offset + length) and appends them to the log of
 * `plot`. Returns false (and leaves the plot without a log) when the bytes are not exactly `strokeCount` valid strokes.
 */
function readStrokeLog(
  ledger: WorldDustLedger,
  plot: number,
  bytes: Uint8Array,
  offset: number,
  length: number,
  strokeCount: number,
): boolean {
  const log = ledger.log;
  if (log === null) return true;
  log.drop(plot);
  const end = offset + length;
  let pos = offset;
  let strokes = 0;
  let ok = true;
  while (pos < end && ok) {
    if (pos + CHAIN_PREFIX_BYTES > end) {
      ok = false;
      break;
    }
    let bit = pos * 8;
    const anchor = getBits(bytes, bit, 18);
    bit += 18;
    let sU = signed(getBits(bytes, bit, 16), 16);
    bit += 16;
    let sV = signed(getBits(bytes, bit, 16), 16);
    bit += 16;
    let eU = signed(getBits(bytes, bit, 16), 16);
    bit += 16;
    let eV = signed(getBits(bytes, bit, 16), 16);
    bit += 16;
    const width = getBits(bytes, bit, 10);
    bit += 10;
    const depth = getBits(bytes, bit, 8);
    bit += 8;
    const tool = getBits(bytes, bit, 6);
    bit += 6;
    const actor = getBits(bytes, bit, 6);
    const count = bytes[pos + HEADER_BYTES]!;
    pos += CHAIN_PREFIX_BYTES;
    if (anchor >= ledger.plotCount || width < 1 || pos + count * CONTINUATION_BYTES > end) {
      ok = false;
      break;
    }
    if (++strokes > strokeCount) {
      ok = false;
      break;
    }
    log.push(plot, anchor, sU, sV, eU, eV, width, depth, tool, actor);
    for (let k = 0; k < count; k++) {
      const cbit = pos * 8;
      const dx = signed(getBits(bytes, cbit + 6, 13), 13);
      const dy = signed(getBits(bytes, cbit + 19, 13), 13);
      sU = eU;
      sV = eV;
      eU += dx;
      eV += dy;
      pos += CONTINUATION_BYTES;
      if (
        getBits(bytes, cbit, 6) !== actor ||
        eU < -32_768 ||
        eU > 32_767 ||
        eV < -32_768 ||
        eV > 32_767 ||
        ++strokes > strokeCount
      ) {
        ok = false;
        break;
      }
      log.push(plot, anchor, sU, sV, eU, eV, width, depth, tool, actor);
    }
  }
  if (!ok || strokes !== strokeCount) {
    log.drop(plot);
    return false;
  }
  return true;
}

// ---- ledger -> bytes --------------------------------------------------------------------------------------------------

/**
 * Encodes chunks of a WorldDustLedger. One instance owns one reused buffer, so `encode` returns a VIEW that is
 * valid until the next `encode`; copy it (or deflate it) before encoding the next chunk. Not on the tick path.
 */
export class DustChunkEncoder {
  private buf = new Uint8Array(0);
  private readonly actors = new Uint8Array(LEDGER_MAX_CONTRIBUTIONS);
  private readonly units = new Uint32Array(LEDGER_MAX_CONTRIBUTIONS);
  private readonly rec = new LoggedStroke();
  /**
   * Strokes per plot kept by the last `encode`: always SAVED_STROKE_LOG_MAX since the contract limit equals the
   * layout maximum (shared/save v1.1). Kept for callers that report it.
   */
  lastStrokesPerPlot: number = SAVED_STROKE_LOG_MAX;
  /**
   * True when the last payload exceeds DUST_CHUNK_PAYLOAD_MAX_BYTES. Cannot happen for a well-formed ledger (every
   * v1 payload is at most the layout maximum, which is the limit); kept as a defensive flag for callers.
   */
  lastOversize = false;

  /**
   * Payload of `chunkId` (the caller checks `isChunkPristine` first: a pristine chunk is not stored). `bakeCheck` is
   * the first byte of the Contract's bakeHash. The ledger's dirty mark is NOT cleared: the host clears it with
   * `ledger.clearChunkDirty(chunkId)` once the row is written.
   */
  encode(ledger: WorldDustLedger, chunkId: number, bakeCheck: number): Uint8Array {
    const grid = ledger.grid;
    const pole = chunkId === grid.params.poleChunkId;
    const plots = pole ? DUST_CHUNK_POLE_PLOTS : PLOTS_PER_CHUNK;
    const stateBytes = pole ? DUST_CHUNK_POLE_STATE_BYTES : DUST_CHUNK_STATE_BYTES;
    const worst =
      DUST_CHUNK_FIXED_BYTES +
      stateBytes +
      plots *
        (RECORD_HEAD_BYTES +
          LEDGER_MAX_CONTRIBUTIONS * LEDGER_CONTRIBUTION_BYTES +
          LEDGER_BYTES +
          RECORD_TAIL_BYTES +
          LOG_MAX_BYTES);
    if (this.buf.length < worst) this.buf = new Uint8Array(worst);
    const b = this.buf;
    const size = this.write(ledger, chunkId, bakeCheck & 0xff, plots, stateBytes, SAVED_STROKE_LOG_MAX);
    this.lastStrokesPerPlot = SAVED_STROKE_LOG_MAX;
    this.lastOversize = size > DUST_CHUNK_PAYLOAD_MAX_BYTES;
    return b.subarray(0, size);
  }

  private write(
    ledger: WorldDustLedger,
    chunkId: number,
    bakeCheck: number,
    plots: number,
    stateBytes: number,
    strokes: number,
  ): number {
    const b = this.buf;
    const grid = ledger.grid;
    b.fill(0, 0, DUST_CHUNK_FIXED_BYTES + stateBytes);
    putU16(b, 0, DUST_CHUNK_PAYLOAD_VERSION);
    putU16(b, 2, chunkId);
    b[4] = bakeCheck;
    let pos = DUST_CHUNK_FIXED_BYTES + stateBytes;
    let touched = 0;
    for (let k = 0; k < plots; k++) {
      const plot = grid.plotAtChunkLocal(chunkId, k);
      const state = ledger.state[plot]!;
      b[DUST_CHUNK_FIXED_BYTES + (k >> 2)] = b[DUST_CHUNK_FIXED_BYTES + (k >> 2)]! | (state << ((k & 3) * 2));
      const slot = ledger.slotOf[plot]!;
      if (slot < 0) continue;
      touched++;
      const remaining = ledger.remaining[slot]!;
      const initial = ledger.initial[slot]!;
      b[pos] = k;
      b[pos + 1] = remainingFraction255(remaining, initial);
      putU32(b, pos + 2, ledger.version[slot]!);
      putU32(b, pos + 6, remaining);
      putU32(b, pos + 10, initial);
      putU16(b, pos + 14, ledger.owned[slot]!);
      putU32(b, pos + 16, ledger.mgPerUnit[slot]!);
      putU32(b, pos + 20, ledger.ledgerHash(plot));
      const n = ledger.topContributions(plot, this.actors, this.units);
      b[pos + 24] = n;
      pos += RECORD_HEAD_BYTES;
      for (let c = 0; c < n; c++) {
        b[pos] = this.actors[c]!;
        putU32(b, pos + 1, this.units[c]!);
        pos += LEDGER_CONTRIBUTION_BYTES;
      }
      ledger.copyTexels(plot, b, pos);
      pos += LEDGER_BYTES;
      const have = ledger.log === null ? 0 : ledger.log.count(plot);
      const keep = have < strokes ? have : strokes;
      b.fill(0, pos, pos + RECORD_TAIL_BYTES + keep * CHAIN_PREFIX_BYTES);
      const logBytes = writeStrokeLog(ledger, plot, keep, b, pos + RECORD_TAIL_BYTES, this.rec);
      b[pos] = keep;
      putU16(b, pos + 1, logBytes);
      pos += RECORD_TAIL_BYTES + logBytes;
    }
    putU16(b, 5, touched);
    return pos;
  }
}

/** One encoded chunk (the payload is a copy). */
export interface EncodedDustChunk {
  readonly chunkId: number;
  readonly payload: Uint8Array;
  /** Strokes per plot kept (always SAVED_STROKE_LOG_MAX since shared/save v1.1). */
  readonly strokesPerPlot: number;
  /** True when the payload exceeds DUST_CHUNK_PAYLOAD_MAX_BYTES (defensive; not reachable for a v1 payload). */
  readonly oversize: boolean;
}

/**
 * Encodes every dirty chunk (`onlyDirty` true, the checkpoint path) or every non-pristine chunk (a full save).
 * Allocates one copy per chunk; dirty marks are left for the host to clear after the write succeeds.
 */
export function encodeDustChunks(
  ledger: WorldDustLedger,
  bakeCheck: number,
  onlyDirty: boolean,
  encoder = new DustChunkEncoder(),
): EncodedDustChunk[] {
  const out: EncodedDustChunk[] = [];
  for (let chunk = 0; chunk < ledger.chunkCount; chunk++) {
    if (onlyDirty ? !ledger.isChunkDirty(chunk) : ledger.isChunkPristine(chunk)) continue;
    const view = encoder.encode(ledger, chunk, bakeCheck);
    out.push({
      chunkId: chunk,
      payload: view.slice(),
      strokesPerPlot: encoder.lastStrokesPerPlot,
      oversize: encoder.lastOversize,
    });
  }
  return out;
}

// ---- bytes -> ledger (untrusted input, millisecond budget) ----------------------------------------------------------

/**
 * Default budget of one `DustRestoreJob.run` slice in milliseconds. A slice ends BEFORE the budget: the job stops
 * ahead of the first step that is not expected to fit.
 */
export const DUST_RESTORE_SLICE_BUDGET_MS = 2;

// Steps of the restore job. Each is a bounded piece of work, small enough that a slice can stop between any two.
/** Once per job: count the incoming ledgers and size the ledger pool and the stroke-log slab in one allocation. */
const STEP_PREPARE = 0;
/** Once per payload: structural scan (nothing is changed) and the bake check. */
const STEP_SCAN = 1;
/** RESET_PLOTS_PER_STEP plots of the chunk: back to the starting state, stored Polished states installed. */
const STEP_RESET = 2;
/** Once per plot record: a ledger slot with an empty mask. */
const STEP_OPEN = 3;
/** MASK_ROWS_PER_STEP rows of the record's ownership mask (the nearest-centre test of 32 texels per row). */
const STEP_MASK = 4;
/** The record's 1,024 texels: clamp, recount. */
const STEP_TEXELS = 5;
/** The record's header check (with the ledger hash) and its contributions. */
const STEP_CHECK = 6;
/** The record's stroke log, then its thresholds (state and L0 byte). */
const STEP_LOG = 7;

const RESET_PLOTS_PER_STEP = 64;
const MASK_ROWS_PER_STEP = 8;
/** Smallest plot record: head, texels and tail, no contribution, no stroke log. */
const RECORD_MIN_BYTES = RECORD_HEAD_BYTES + LEDGER_BYTES + RECORD_TAIL_BYTES;

/**
 * Kept free at the end of a slice, in milliseconds: covers a clock that only ticks every 0.1 ms (browsers without
 * cross-origin isolation), the caller's own bookkeeping around `run`, and a settled step that suddenly takes a few
 * tenths of a millisecond (measured on a busy machine: up to 0.42 ms for a step that normally takes 7 us).
 */
const SLICE_SLACK_MS = 0.3;
/** Share of the previous estimate kept when a step was cheaper than estimated (a decaying maximum). */
const ESTIMATE_KEEP = 0.95;
/**
 * A step is started only when this many times its estimate still fits: a step that takes twice its estimate (a busy
 * machine, a cache miss, code that is not optimised yet) still ends inside the budget.
 */
const ESTIMATE_MARGIN = 2;
/**
 * A measured step enters the estimate at no more than this share of the budget: one step that was preempted for
 * milliseconds must not cut the following slices down to a single step each.
 */
const ESTIMATE_CAP_SHARE = 0.25;
/**
 * Estimated cost per step kind (index = STEP_ constant) in milliseconds before the job has run one: the first,
 * unoptimised call of each kind in a fresh process on an i7-8650U, Node 26, about one and a half times what a quiet
 * machine measures (prepare 0.43 to 0.58, scan 0.30 to 0.41, reset 0.30 to 0.38, open 0.16 to 0.19, mask 0.50 to
 * 0.55, texels 0.30 to 0.37, check and log together 0.66 to 0.78). With ESTIMATE_MARGIN these keep two expensive
 * first calls from sharing a slice. See docs/agent-reports/M1-restore-slices-terrain-dust-engineer.md.
 */
const COLD_STEP_ESTIMATE_MS: readonly number[] = [0.7, 0.5, 0.5, 0.3, 0.8, 0.5, 0.5, 0.6];

export interface DustRestoreResult {
  /** True when every payload was structurally valid (repairs do not make it false). */
  ok: boolean;
  chunksRestored: number;
  chunksRejected: number;
  /** Error of the first rejected payload, and its index in the input list (-1 = none). */
  firstError: DustChunkError | null;
  firstErrorIndex: number;
  /** Plots that got a ledger back. */
  ledgersRestored: number;
  /** Plots restored as Polished. */
  polishedRestored: number;
  /** Texels forced to a legal value (non-owned not 0, or above 16 x level). */
  texelsRepaired: number;
  /** Records whose stored remainingUnits / initialUnits / ownedTexels / mgPerUnit / hash differ from the recount. */
  headerMismatches: number;
  /** Plots whose stored 2-bit state differs from the state the thresholds give. */
  stateMismatches: number;
  /** Stroke logs dropped because their bytes were not valid chains (cosmetic: tiles rebuild from the ledger alone). */
  logsDropped: number;
  /** Records for plots that cannot hold a ledger (Empty in this bake). */
  recordsSkipped: number;
}

/**
 * Restores dust chunk payloads into a ledger, a bounded amount of work at a time.
 *
 * The payloads are NOT trusted (a Solo save comes from the player's disk): structure is checked before a chunk
 * changes anything; ownership, totals, mgPerUnit, hashes and states are recomputed from the texels and the grid
 * (never taken from the stored header); texel values are clamped. A structurally bad payload is rejected and its
 * chunk left untouched; the job continues with the next one. Nothing throws.
 *
 * A restored chunk replaces whatever the ledger held for that chunk. Stamp / Opened queues are left as they were
 * (no event is replayed); the chunk ends clean (not dirty) unless something had to be repaired.
 *
 * Slicing (measured, docs/agent-reports/M1-restore-slices-terrain-dust-engineer.md). The work is cut into steps of a
 * few microseconds each once the code is optimised (a plot record is 8 steps; rebuilding its ownership mask is most
 * of the cost and is itself cut into 4), and the first, unoptimised call of any step stays well below a millisecond.
 * `run(budgetMs, now)` reads the clock after every step, keeps a decaying maximum of the cost per step kind and stops
 * before a step unless twice its estimate still fits, so a slice ends under the budget instead of just over it. Only
 * the first step of a slice runs unconditionally (progress is guaranteed for any budget). What this cannot bound is
 * time the thread does not get: a step that is preempted or interrupted by a collection is as long as that takes. Memory is sized
 * once, in the first step: growing the ledger pool or the 16 MB stroke-log slab by doubling in the middle of a
 * restore copied megabytes inside one step.
 *
 * Between slices the chunk being restored is incomplete: do not read, save or stroke the ledger until `done`. The
 * result does not depend on where the slices fall (same bytes, same slots, same counters as one uninterrupted run).
 */
export class DustRestoreJob {
  readonly result: DustRestoreResult = {
    ok: true,
    chunksRestored: 0,
    chunksRejected: 0,
    firstError: null,
    firstErrorIndex: -1,
    ledgersRestored: 0,
    polishedRestored: 0,
    texelsRepaired: 0,
    headerMismatches: 0,
    stateMismatches: 0,
    logsDropped: 0,
    recordsSkipped: 0,
  };
  private readonly scan = new DustChunkScan();
  private index = 0;
  private phase = STEP_PREPARE;
  /** STEP_RESET: next local plot index, and the next record whose plot the loop will meet. */
  private resetAt = 0;
  private resetRecord = 0;
  /** Record being installed, its byte offset and plot, and the next mask row to build. */
  private record = 0;
  private recordAt = 0;
  private plot = 0;
  private maskRow = 0;
  private repairsAtChunkStart = 0;
  private polishedQ = 0;
  private openedQ = 0;
  private readonly estimateMs = Float64Array.from(COLD_STEP_ESTIMATE_MS);
  /** Steps done so far; a deterministic progress counter (it does not depend on the clock or on the slicing). */
  units = 0;
  /** Longest single step seen by `run` with a clock, in milliseconds (diagnostics: a slice cannot be shorter). */
  slowestStepMs = 0;

  constructor(
    private readonly ledger: WorldDustLedger,
    private readonly payloads: readonly Uint8Array[],
    /** When given, a payload whose bakeCheck byte differs is rejected (`bake_mismatch`). */
    private readonly bakeCheck?: number,
    /**
     * Free ledger slots (and stroke-log rings) the host wants after the restore. Default: the slots the ledger was
     * constructed with (`initialLedgerSlots`, the host's play headroom). The job sizes the pools once, to the restored
     * ledgers plus this, while they are still empty, so a host's own `reserve(ledgerCount + headroom)` after the
     * restore finds the room already there; asking for more than that afterwards copies every restored ledger in one
     * call.
     */
    private readonly headroomSlots?: number,
  ) {}

  get done(): boolean {
    return this.index >= this.payloads.length;
  }

  /**
   * Works until the job is done or the next step is not expected to end within `budgetMs` on the caller's clock
   * (`now` in milliseconds, for example `performance.now`). Returns true when the job is done. Without a clock the
   * job runs to its end.
   */
  run(budgetMs: number = DUST_RESTORE_SLICE_BUDGET_MS, now?: () => number): boolean {
    if (now === undefined) {
      while (!this.done) this.step();
      return true;
    }
    const est = this.estimateMs;
    const estimateCap = budgetMs * ESTIMATE_CAP_SHARE;
    const t0 = now();
    let t = t0;
    let ran = false;
    while (!this.done) {
      const kind = this.phase;
      if (ran && t - t0 + est[kind]! * ESTIMATE_MARGIN + SLICE_SLACK_MS > budgetMs) break;
      this.step();
      const t1 = now();
      let ms = t1 - t;
      if (ms > this.slowestStepMs) this.slowestStepMs = ms;
      if (ms > estimateCap) ms = estimateCap;
      const e = est[kind]!;
      est[kind] = ms > e ? ms : e * ESTIMATE_KEEP + ms * (1 - ESTIMATE_KEEP);
      t = t1;
      ran = true;
    }
    return this.done;
  }

  private repairs(): number {
    const r = this.result;
    return r.texelsRepaired + r.headerMismatches + r.stateMismatches + r.logsDropped + r.recordsSkipped;
  }

  /** One step of work (see the STEP_ constants). */
  private step(): void {
    this.units++;
    switch (this.phase) {
      case STEP_PREPARE:
        this.prepare();
        break;
      case STEP_SCAN:
        this.beginChunk();
        break;
      case STEP_RESET:
        this.resetPlots();
        break;
      case STEP_OPEN:
        this.openRecord();
        break;
      case STEP_MASK:
        this.ledger.buildMaskRows(this.plot, this.maskRow, this.maskRow + MASK_ROWS_PER_STEP);
        this.maskRow += MASK_ROWS_PER_STEP;
        if (this.maskRow >= LEDGER_EDGE_TEXELS) this.phase = STEP_TEXELS;
        break;
      case STEP_TEXELS:
        this.installTexels();
        break;
      case STEP_CHECK:
        this.checkRecord();
        break;
      default:
        this.finishRecord();
    }
  }

  /**
   * Sizes the ledger pool and the stroke-log slab for everything the payloads can install, in one allocation, before
   * anything is installed (the pools are then empty or small, so nothing big is copied). The count comes from the
   * payload headers and is bounded by the payload sizes, so a forged header cannot reserve more than its bytes could
   * hold; a payload the scan will reject is at worst counted.
   */
  private prepare(): void {
    this.phase = STEP_SCAN;
    const ledger = this.ledger;
    const pole = ledger.grid.params.poleChunkId;
    const expected = this.bakeCheck === undefined ? -1 : this.bakeCheck & 0xff;
    const inChunk = ledger.touchedInChunk.slice();
    let count = ledger.ledgerCount;
    let peak = count;
    for (let i = 0; i < this.payloads.length; i++) {
      const bytes = this.payloads[i]!;
      if (bytes.length < DUST_CHUNK_FIXED_BYTES || bytes.length > DUST_CHUNK_LAYOUT_MAX_BYTES) continue;
      if (u16At(bytes, 0) !== DUST_CHUNK_PAYLOAD_VERSION) continue;
      const chunk = u16At(bytes, 2);
      if (chunk > pole || (expected >= 0 && bytes[4] !== expected)) continue;
      const incoming = u16At(bytes, 5);
      if (incoming > (chunk === pole ? DUST_CHUNK_POLE_PLOTS : PLOTS_PER_CHUNK)) continue;
      if (incoming * RECORD_MIN_BYTES > bytes.length) continue;
      // A restored chunk replaces what the ledger holds for it.
      count += incoming - inChunk[chunk]!;
      inChunk[chunk] = incoming;
      if (count > peak) peak = count;
    }
    const asked = this.headroomSlots ?? ledger.initialSlots;
    const headroom = asked > 0 ? Math.floor(asked) : 0;
    const want = peak + headroom < ledger.plotCount ? peak + headroom : ledger.plotCount;
    ledger.reserve(want);
  }

  /** Scans the payload at `index`; a bad one is rejected whole and nothing is changed. */
  private beginChunk(): void {
    const ledger = this.ledger;
    const scan = this.scan;
    const r = this.result;
    let error = scanDustChunk(this.payloads[this.index]!, ledger.grid.params.poleChunkId, scan);
    if (error === null && this.bakeCheck !== undefined && scan.bakeCheck !== (this.bakeCheck & 0xff)) {
      error = fail("bake_mismatch", `chunk ${scan.chunkId} bakeCheck ${scan.bakeCheck}`);
    }
    if (error !== null) {
      r.ok = false;
      r.chunksRejected++;
      if (r.firstError === null) {
        r.firstError = error;
        r.firstErrorIndex = this.index;
      }
      this.index++;
      return;
    }
    this.repairsAtChunkStart = this.repairs();
    this.polishedQ = ledger.polishedQueueCount;
    this.openedQ = ledger.openedQueueCount;
    this.resetAt = 0;
    this.resetRecord = 0;
    this.phase = STEP_RESET;
  }

  /** Returns the next plots of the chunk to their starting state and installs the stored Polished states. */
  private resetPlots(): void {
    const ledger = this.ledger;
    const grid = ledger.grid;
    const scan = this.scan;
    const bytes = this.payloads[this.index]!;
    const r = this.result;
    const plots = scan.plotsInChunk;
    let k = this.resetAt;
    const end = k + RESET_PLOTS_PER_STEP < plots ? k + RESET_PLOTS_PER_STEP : plots;
    let record = this.resetRecord;
    for (; k < end; k++) {
      const plot = grid.plotAtChunkLocal(scan.chunkId, k);
      ledger.resetPlot(plot);
      if (record < scan.touchedCount && bytes[scan.recordOffset[record]!] === k) {
        record++;
        continue;
      }
      const stored = stateAt(bytes, scan.stateOffset, k);
      // Empty comes from the bake, never from the save; an Opened plot must carry a ledger record.
      if (ledger.levelOf[plot] === 0) {
        if (stored !== PlotState.Empty) r.stateMismatches++;
      } else if (stored === PlotState.Polished) {
        ledger.installPolished(plot);
        r.polishedRestored++;
      } else if (stored !== PlotState.Grimy) {
        r.stateMismatches++;
      }
    }
    this.resetAt = k;
    this.resetRecord = record;
    if (k < plots) return;
    this.record = 0;
    if (scan.touchedCount === 0) this.endChunk();
    else this.phase = STEP_OPEN;
  }

  private openRecord(): void {
    const scan = this.scan;
    const at = scan.recordOffset[this.record]!;
    const plot = this.ledger.grid.plotAtChunkLocal(scan.chunkId, this.payloads[this.index]![at]!);
    this.recordAt = at;
    this.plot = plot;
    if (!this.ledger.openLedger(plot)) {
      this.result.recordsSkipped++;
      this.nextRecord();
      return;
    }
    this.maskRow = 0;
    this.phase = STEP_MASK;
  }

  private installTexels(): void {
    const bytes = this.payloads[this.index]!;
    const at = this.recordAt;
    const texAt = at + RECORD_HEAD_BYTES + bytes[at + 24]! * LEDGER_CONTRIBUTION_BYTES;
    const repaired = this.ledger.installLedger(this.plot, bytes, texAt, u32At(bytes, at + 2));
    if (repaired < 0) {
      this.result.recordsSkipped++;
      this.nextRecord();
      return;
    }
    this.result.texelsRepaired += repaired;
    this.phase = STEP_CHECK;
  }

  /** Compares the stored header with the recount (a difference is counted, never trusted) and adds the credits. */
  private checkRecord(): void {
    const ledger = this.ledger;
    const bytes = this.payloads[this.index]!;
    const at = this.recordAt;
    const plot = this.plot;
    const contributions = bytes[at + 24]!;
    const texAt = at + RECORD_HEAD_BYTES + contributions * LEDGER_CONTRIBUTION_BYTES;
    const slot = ledger.slotOf[plot]!;
    if (
      u32At(bytes, at + 6) !== ledger.remaining[slot] ||
      u32At(bytes, at + 10) !== ledger.initial[slot] ||
      u16At(bytes, at + 14) !== ledger.owned[slot] ||
      u32At(bytes, at + 16) !== ledger.mgPerUnit[slot] ||
      u32At(bytes, at + 20) !== fnv1a32(bytes, texAt, LEDGER_BYTES)
    ) {
      this.result.headerMismatches++;
    }
    for (let c = 0; c < contributions; c++) {
      const co = at + RECORD_HEAD_BYTES + c * LEDGER_CONTRIBUTION_BYTES;
      ledger.addContribution(plot, bytes[co]!, u32At(bytes, co + 1));
    }
    this.phase = STEP_LOG;
  }

  private finishRecord(): void {
    const ledger = this.ledger;
    const bytes = this.payloads[this.index]!;
    const r = this.result;
    const at = this.recordAt;
    const plot = this.plot;
    const tail = at + RECORD_HEAD_BYTES + bytes[at + 24]! * LEDGER_CONTRIBUTION_BYTES + LEDGER_BYTES;
    if (!readStrokeLog(ledger, plot, bytes, tail + RECORD_TAIL_BYTES, u16At(bytes, tail + 1), bytes[tail]!)) {
      r.logsDropped++;
    }
    ledger.refreshPlot(plot);
    if (ledger.state[plot] !== stateAt(bytes, this.scan.stateOffset, bytes[at]!)) r.stateMismatches++;
    if (ledger.slotOf[plot]! >= 0) r.ledgersRestored++;
    else r.polishedRestored++;
    this.nextRecord();
  }

  private nextRecord(): void {
    this.record++;
    if (this.record >= this.scan.touchedCount) this.endChunk();
    else this.phase = STEP_OPEN;
  }

  private endChunk(): void {
    const ledger = this.ledger;
    ledger.truncateEventQueues(this.polishedQ, this.openedQ);
    if (this.repairs() === this.repairsAtChunkStart) ledger.clearChunkDirty(this.scan.chunkId);
    else ledger.setChunkDirty(this.scan.chunkId);
    this.result.chunksRestored++;
    this.phase = STEP_SCAN;
    this.index++;
  }
}

/** Restores `payloads` in one go (no budget). See DustRestoreJob for the trust and repair rules. */
export function restoreDustChunks(
  ledger: WorldDustLedger,
  payloads: readonly Uint8Array[],
  bakeCheck?: number,
): DustRestoreResult {
  const job = new DustRestoreJob(ledger, payloads, bakeCheck);
  job.run();
  return job.result;
}
