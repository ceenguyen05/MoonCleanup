// Minimal reader/patcher of the (uncompressed) save header envelope v1 (layout: @moon-cleanup/shared save/format).
// The sync module never interprets sections: it reads the fixed header facts the upload metadata needs and, for the
// "Keep this device" overwrite and "restore backup", rewrites `generation` / `parentGeneration` and the trailer CRC.
// Envelope encode/decode for the sim lives in sim-host/save-envelope.ts; the layout is the shared contract.

import {
  SAVE_FORMAT_VERSION,
  SAVE_HEADER_FIXED_BYTES,
  SAVE_HEADER_LAYOUT,
  SAVE_MAGIC,
  SAVE_SECTION_ENTRY_BYTES,
  SAVE_TRAILER_BYTES,
  type SaveOriginKind,
} from "@moon-cleanup/shared";
import { crc32 } from "./crc32";

const L = SAVE_HEADER_LAYOUT;

export interface EnvelopeFacts {
  readonly saveFormatVersion: number;
  readonly gridM: number;
  readonly radiusM: number;
  readonly plotCount: number;
  /** 64 lower-case hex chars. */
  readonly bakeHash: string;
  readonly simTick: number;
  readonly generation: number;
  readonly parentGeneration: number;
  readonly originKind: SaveOriginKind;
}

function getU64(v: DataView, at: number): number | null {
  const high = v.getUint32(at + 4, true);
  return high > 0x1f_ffff ? null : v.getUint32(at, true) + high * 0x1_0000_0000;
}
function setU64(v: DataView, at: number, value: number): void {
  v.setUint32(at, value % 0x1_0000_0000, true);
  v.setUint32(at + 4, Math.floor(value / 0x1_0000_0000), true);
}

/** Verifies magic, section table arithmetic and trailer CRC; returns the fixed facts, or null when anything is off. */
export function readEnvelopeFacts(raw: Uint8Array): EnvelopeFacts | null {
  if (raw.byteLength < SAVE_HEADER_FIXED_BYTES + SAVE_TRAILER_BYTES) return null;
  for (let i = 0; i < 4; i++) if (raw[i] !== SAVE_MAGIC.charCodeAt(i)) return null;
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const end = raw.byteLength - SAVE_TRAILER_BYTES;
  const sectionCount = v.getUint16(L.sectionCount.offset, true);
  const tableEnd = SAVE_HEADER_FIXED_BYTES + sectionCount * SAVE_SECTION_ENTRY_BYTES;
  if (tableEnd > end) return null;
  let bodies = 0;
  for (let i = 0; i < sectionCount; i++) {
    bodies += v.getUint32(SAVE_HEADER_FIXED_BYTES + i * SAVE_SECTION_ENTRY_BYTES + 4, true);
  }
  if (tableEnd + bodies !== end) return null;
  if (crc32(raw, 0, end) !== v.getUint32(end, true)) return null;
  const saveFormatVersion = v.getUint16(L.saveFormatVersion.offset, true);
  const simTick = getU64(v, L.simTick.offset);
  const generation = getU64(v, L.generation.offset);
  const parentGeneration = getU64(v, L.parentGeneration.offset);
  if (simTick === null || generation === null || parentGeneration === null || generation < 1) return null;
  const origin = raw[L.originKind.offset];
  if (origin !== 0 && origin !== 1) return null;
  let bakeHash = "";
  for (let i = 0; i < L.bakeHash.bytes; i++) {
    bakeHash += (raw[L.bakeHash.offset + i] as number).toString(16).padStart(2, "0");
  }
  return {
    saveFormatVersion,
    gridM: v.getUint16(L.gridM.offset, true),
    radiusM: v.getUint16(L.radiusM.offset, true),
    plotCount: v.getUint32(L.plotCount.offset, true),
    bakeHash,
    simTick,
    generation,
    parentGeneration,
    originKind: origin === 1 ? "solo" : "room",
  };
}

/** True when this build can read and write the envelope version. */
export function isSupportedFormat(facts: EnvelopeFacts): boolean {
  return facts.saveFormatVersion === SAVE_FORMAT_VERSION;
}

/** Copy of `raw` with a new generation and parent (and the CRC recomputed). `raw` must pass `readEnvelopeFacts`. */
export function withGeneration(raw: Uint8Array, generation: number, parentGeneration: number): Uint8Array {
  if (!(generation > parentGeneration) || parentGeneration < 0) {
    throw new RangeError("generation must exceed its parent");
  }
  const out = raw.slice();
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  setU64(v, L.generation.offset, generation);
  setU64(v, L.parentGeneration.offset, parentGeneration);
  const end = out.byteLength - SAVE_TRAILER_BYTES;
  v.setUint32(end, crc32(out, 0, end), true);
  return out;
}
