// P2 prototype: checkpoint serialisation (WDS section 6, data-model 3.7b shape) against an in-memory stand-in for
// the PostgreSQL rows. One header blob in two alternating slots (A/B) and, per dust chunk, two payload versions
// stamped with the save_seq that wrote them; a save writes the header and the dirty chunks "in one transaction"
// (here: one synchronous function). Load rule: newest valid header; per chunk the newest version with
// save_seq <= header.save_seq. No database is involved (a prototype may not hold secrets or installs).
//
// Chunk payload (deflated as a whole): version u8, chunkId u16, bake byte u8, plot count u16, 2-bit states,
// touched count u16, then per touched plot: local index u16, ledger (version u32, initialUnits u32, ownedTexels u16,
// contributions, 1,024 texel bytes), up to 32 most recent strokes (16 B each).
// Environment-agnostic (compression comes from the server's codec).

import { LEDGER_BYTES, MAX_CONTRIB, STATE_POLISHED } from "./dust-view";
import type { P2Server } from "./server";
import { ByteReader, ByteWriter } from "./util";

const HEADER_MAGIC = 0x50325356; // "P2SV"
const CHUNK_PAYLOAD_VERSION = 1;
const SAVED_LOG_MAX = 32;

interface ChunkVersion {
  saveSeq: number;
  payload: Uint8Array;
}

export class DurableStore {
  headers: (Uint8Array | null)[] = [null, null];
  readonly chunks = new Map<number, (ChunkVersion | null)[]>();
  saves = 0;
  lastSaveBytes = 0;
  lastSaveChunks = 0;

  /** Bytes currently stored (both header slots and both versions of every chunk). */
  bytes(): number {
    let n = 0;
    for (const h of this.headers) n += h?.length ?? 0;
    for (const v of this.chunks.values()) for (const c of v) n += c?.payload.length ?? 0;
    return n;
  }
}

function fnv(buf: Uint8Array, len: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < len; i++) h = Math.imul(h ^ buf[i]!, 0x01000193);
  return h >>> 0;
}

function readHeader(h: Uint8Array | null): { saveSeq: number; tick: number; r: ByteReader } | null {
  if (h === null || h.length < 16) return null;
  if (fnv(h, h.length - 4) !== new ByteReader(h.subarray(h.length - 4)).u32()) return null;
  const r = new ByteReader(h);
  if (r.u32() !== HEADER_MAGIC) return null;
  const saveSeq = r.u32();
  const tick = r.u32();
  return { saveSeq, tick, r };
}

/** Writes the header and every dirty chunk. Returns the save_seq written. */
export function saveWorld(server: P2Server, store: DurableStore): number {
  const a = readHeader(store.headers[0] ?? null);
  const b = readHeader(store.headers[1] ?? null);
  const lastSeq = Math.max(a?.saveSeq ?? 0, b?.saveSeq ?? 0);
  const saveSeq = lastSeq + 1;
  const t = server.t;
  const v = server.view;
  const codec = server.opt.codec;
  let bytes = 0;
  let chunks = 0;

  for (let ch = 0; ch < t.chunkCount; ch++) {
    if (server.chunkDirty[ch] === 0) continue;
    server.chunkDirty[ch] = 0;
    const from = t.chunkStart[ch]!;
    const n = t.chunkStart[ch + 1]! - from;
    const w = new ByteWriter(4096);
    w.u8(CHUNK_PAYLOAD_VERSION);
    w.u16(ch);
    w.u8(0);
    w.u16(n);
    const bits = new Uint8Array((n + 3) >> 2);
    let touched = 0;
    for (let i = 0; i < n; i++) {
      const p = t.chunkPlots[from + i]!;
      bits[i >> 2] = bits[i >> 2]! | (v.state[p]! << ((i & 3) * 2));
      if (v.slotOf[p]! >= 0) touched++;
    }
    w.bytes(bits, 0, bits.length);
    w.u16(touched);
    for (let i = 0; i < n; i++) {
      const p = t.chunkPlots[from + i]!;
      const slot = v.slotOf[p]!;
      if (slot < 0) continue;
      w.u16(i);
      w.u32(v.version[slot]!);
      w.u32(v.initial[slot]!);
      w.u16(v.owned[slot]!);
      for (let k = 0; k < MAX_CONTRIB; k++) {
        w.u8(v.contribActor[slot * MAX_CONTRIB + k]!);
        w.u32(v.contribUnits[slot * MAX_CONTRIB + k]!);
      }
      w.bytes(v.texels, slot * LEDGER_BYTES, LEDGER_BYTES);
      const have = server.log.count(p);
      const keep = have < SAVED_LOG_MAX ? have : SAVED_LOG_MAX;
      w.u8(keep);
      for (let k = have - keep; k < have; k++) for (let j = 0; j < 4; j++) w.u32(server.log.word(p, k, j) >>> 0);
    }
    const payload = codec.deflate(w.buf.subarray(0, w.len));
    let pair = store.chunks.get(ch);
    if (pair === undefined) {
      pair = [null, null];
      store.chunks.set(ch, pair);
    }
    // Overwrite the older of the two versions.
    const v0 = pair[0] ?? null;
    const v1 = pair[1] ?? null;
    const slotIx = v0 === null ? 0 : v1 === null ? 1 : v0.saveSeq <= v1.saveSeq ? 0 : 1;
    pair[slotIx] = { saveSeq, payload };
    bytes += payload.length;
    chunks++;
  }

  const h = new ByteWriter(1024);
  h.u32(HEADER_MAGIC);
  h.u32(saveSeq);
  h.u32(server.tick);
  for (let s = 0; s < 64; s++) {
    h.u32(server.grams[s]!);
    h.u16(server.mgAcc[s]!);
  }
  const plans = server.plans;
  let active = 0;
  for (let id = 0; id < plans.n; id++) if (plans.active[id] === 1) active++;
  h.u16(active);
  for (let id = 0; id < plans.n; id++) {
    if (plans.active[id] === 0) continue;
    h.u16(id);
    h.u24(plans.plot[id]!);
    h.u32(plans.startTick[id]!);
    h.u16(plans.widthCm[id]!);
    h.u8(plans.depth16[id]!);
    h.u16(plans.speedCmPerS[id]!);
    h.u32(plans.mask0[id]!);
    h.u32(plans.mask1[id]!);
  }
  h.u32(fnv(h.buf, h.len));
  // Alternate header slots: overwrite the older one.
  const target = a === null ? 0 : b === null ? 1 : a.saveSeq <= b.saveSeq ? 0 : 1;
  store.headers[target] = h.take();
  bytes += h.len;
  store.saves++;
  store.lastSaveBytes = bytes;
  store.lastSaveChunks = chunks;
  return saveSeq;
}

/** Loads the newest consistent save into a FRESH server. Returns false when the store holds no valid header. */
export function loadWorld(server: P2Server, store: DurableStore): boolean {
  const a = readHeader(store.headers[0] ?? null);
  const b = readHeader(store.headers[1] ?? null);
  const head = a === null ? b : b === null ? a : a.saveSeq >= b.saveSeq ? a : b;
  if (head === null) return false;
  const t = server.t;
  const v = server.view;
  const codec = server.opt.codec;
  server.tick = head.tick;
  const hr = head.r;
  for (let s = 0; s < 64; s++) {
    server.grams[s] = hr.u32();
    server.mgAcc[s] = hr.u16();
  }
  const active = hr.u16();
  for (let k = 0; k < active; k++) {
    const id = hr.u16();
    const plot = hr.u24();
    const start = hr.u32();
    const width = hr.u16();
    const depth = hr.u8();
    const speed = hr.u16();
    const m0 = hr.u32();
    const m1 = hr.u32();
    server.plans.set(id, plot, start, width, depth, speed, m0, m1, 0);
  }

  for (const [ch, pair] of store.chunks) {
    let pick: ChunkVersion | null = null;
    for (const c of pair) {
      if (c !== null && c.saveSeq <= head.saveSeq && (pick === null || c.saveSeq > pick.saveSeq)) pick = c;
    }
    if (pick === null) continue;
    const raw = codec.inflate(pick.payload);
    const r = new ByteReader(raw);
    if (r.u8() !== CHUNK_PAYLOAD_VERSION) throw new Error("p2 save: unknown chunk payload version");
    if (r.u16() !== ch) throw new Error("p2 save: chunk id mismatch");
    r.u8();
    const n = r.u16();
    const from = t.chunkStart[ch]!;
    const bitsAt = r.pos;
    r.pos += (n + 3) >> 2;
    for (let i = 0; i < n; i++) {
      const st = (raw[bitsAt + (i >> 2)]! >> ((i & 3) * 2)) & 3;
      if (st === STATE_POLISHED) v.setPolished(t.chunkPlots[from + i]!);
    }
    const touched = r.u16();
    for (let k = 0; k < touched; k++) {
      const p = t.chunkPlots[from + r.u16()]!;
      const version = r.u32();
      const initial = r.u32();
      const owned = r.u16();
      const contribAt = r.pos;
      r.pos += MAX_CONTRIB * 5;
      const slot = v.installLedger(p, raw, r.pos, version, initial, owned);
      r.pos += LEDGER_BYTES;
      for (let c = 0; c < MAX_CONTRIB; c++) {
        v.contribActor[slot * MAX_CONTRIB + c] = raw[contribAt + c * 5]!;
        v.contribUnits[slot * MAX_CONTRIB + c] = new ByteReader(raw.subarray(contribAt + c * 5 + 1)).u32();
      }
      const nLog = r.u8();
      for (let j = 0; j < nLog; j++) {
        const w0 = r.u32() | 0;
        const w1 = r.u32() | 0;
        const w2 = r.u32() | 0;
        const w3 = r.u32() | 0;
        server.log.pushPacked(p, w0, w1, w2, w3);
      }
    }
  }
  v.drainDirty();
  v.polishedN = 0;
  server.chunkDirty.fill(0);
  return true;
}
