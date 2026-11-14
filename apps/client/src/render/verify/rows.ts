// Registry of the 15 rows of rendering-pipeline.md section 21 (M0-W2-T07), in matrix order.

import { GPU_ROWS } from "./rows-gpu";
import { MORE_ROWS } from "./rows-more";
import { POST_ROWS } from "./rows-post";
import { SHADOW_ROWS } from "./rows-shadow";
import type { RowDef } from "./types";

export const VERIFY_ROWS: readonly RowDef[] = [...SHADOW_ROWS, ...GPU_ROWS, ...POST_ROWS, ...MORE_ROWS].sort(
  (a, b) => a.id - b.id,
);

export function findRow(id: number): RowDef | null {
  return VERIFY_ROWS.find((row) => row.id === id) ?? null;
}
