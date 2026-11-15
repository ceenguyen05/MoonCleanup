// Pure rules shared by the PostgreSQL and in-memory save implementations (data-model.md sections 3.7 and 3.7b), so both
// drivers choose slots, chunk versions and CRC representations identically.

import type { SaveSlotName } from "./types.ts";

/** CRC32 columns are signed int32 (an unsigned 32-bit value does not fit `integer`): unsigned -> signed. */
export const toSignedCrc = (unsigned: number): number => unsigned | 0;

/** Signed int32 column value -> unsigned CRC32. */
export const fromSignedCrc = (signed: number): number => signed >>> 0;

/**
 * The header slot a new checkpoint overwrites: the missing one (the first save goes to A), otherwise the one with the
 * lower `save_seq` (a tie goes to A). The newer slot is never touched. `expectedSeq` is the compare-and-set value
 * (`null` when the slot has no row yet).
 */
export function pickOlderSlot(existing: readonly { slot: SaveSlotName; saveSeq: number }[]): {
  slot: SaveSlotName;
  expectedSeq: number | null;
} {
  const a = existing.find((s) => s.slot === "A");
  const b = existing.find((s) => s.slot === "B");
  if (a === undefined) return { slot: "A", expectedSeq: null };
  if (b === undefined) return { slot: "B", expectedSeq: null };
  return b.saveSeq < a.saveSeq ? { slot: "B", expectedSeq: b.saveSeq } : { slot: "A", expectedSeq: a.saveSeq };
}

/** The version of one chunk a new write overwrites: the missing one (first write goes to 0), else the lower `save_seq`. */
export function pickOlderVersion(existing: readonly { ver: 0 | 1; saveSeq: number }[]): 0 | 1 {
  const v0 = existing.find((r) => r.ver === 0);
  const v1 = existing.find((r) => r.ver === 1);
  if (v0 === undefined) return 0;
  if (v1 === undefined) return 1;
  return v1.saveSeq < v0.saveSeq ? 1 : 0;
}
