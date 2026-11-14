// Golden ledger vectors of the P2 prototype (prototype form of WDS 4.5b V1): 1,000 seeded strokes over about 20
// plots covering every tool of the table (hand tools, Detailing discs, Charge, vehicle intakes, robot lanes).
// The same function runs in Node (ledger.test.ts) and in real browsers (golden.browser.test.ts); the digests must be
// bit-identical everywhere. No Node or DOM imports.
import { applyAll, freshView, fullDigest, realTables, seededStrokes, SEED } from "./support";

export interface GoldenResult {
  readonly ledgers: number;
  readonly polished: number;
  readonly remainingUnits: number;
  readonly worldHash: number;
  readonly digest: number;
}

export function computeGolden(): GoldenResult {
  const view = freshView();
  applyAll(view, seededStrokes(realTables(), 1000, SEED));
  let remaining = 0;
  for (let s = 0; s < view.slotHigh; s++) if (view.plotOfSlot[s]! >= 0) remaining += view.remaining[s]!;
  return {
    ledgers: view.ledgerCount,
    polished: view.polishedAllN,
    remainingUnits: remaining,
    worldHash: view.hashWhere(null),
    digest: fullDigest(view),
  };
}

/** Recorded on Node 26.13.1 (2026-11-14); see README "Golden vectors". */
export const GOLDEN_EXPECTED: GoldenResult = {
  ledgers: 18,
  polished: 0,
  remainingUnits: 902_306,
  worldHash: 692_792_533,
  digest: 2_761_559_337,
};
