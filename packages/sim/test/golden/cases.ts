import { expect, test } from "vitest";
import { GOLDEN_TICKS, runGoldenReplay, runWorldLedgerGoldenReplay } from "./replay";

/**
 * The script on the sim's default ledger, the ApproxDustLedger stand-in. Recorded on Node 26.13.1 (M1-W3-T03).
 * Still the reference for every test that builds a MoonRoomSim without a `ledger` option; no host runs this ledger.
 *
 * Re-recorded for the Detailing cooldown fix (M1-B1, 2026-11-15; both goldens below changed together): the cooldown
 * used to keep counting down with no floor while the actor was airborne, so after landing discs fired on every stroke
 * tick (100 ms) until the debt was repaid. It is now floored at zero. A stroke-by-stroke diff of the two runs shows
 * every sweep stroke identical; only Detailing discs differ (31 old discs -> 15 new, 16 sub-period bursts removed).
 * Values before the fix: stateHash 4037918216, strokeHash 2027053455, strokes 3975, gramsCollected 56640.
 *
 * Re-recorded for Holster gating (M1-W6-T02, 2026-11-15, owner-approved; both goldens below changed together): without
 * a Holster Rig an actor carries one tool, and a newly bought tool replaces it and is equipped at once. The script's
 * Crescent Squeegee purchase at tick 400 now equips it on that tick (it used to wait for the select_tool at 420, which
 * is now a no-op: one slot), so actor 1 sweeps with the Squeegee 20 ticks earlier and every later stroke shifts.
 * Values before: stateHash 3938942926, strokeHash 786224438, strokes 3959, gramsCollected 55661.
 */
export const GOLDEN_REPLAY = { stateHash: 1076468633, strokeHash: 4164540033, strokes: 4023, gramsCollected: 55784 };

/**
 * The same script on the real dust ledger (`WorldDustLedger` of packages/world): what the Solo worker runs since
 * M1-W3-T01b. Recorded on Node 26.13.1.
 *
 * Re-recorded once for the lattice pitch snap (M1-W3-T01b lattice follow-up, 2026-11-14; the DUST_MODEL_VERSION
 * 1 -> 2 change): the ledger's lattice pitch is snapped to a divisor of the 800 mm texel edge (packages/world
 * `latticePitchMm`), so a fully covered texel collects exactly its area. The values before the snap were stateHash
 * 634894361, gramsCollected 67192, dustHash 4087304160; strokeHash, strokes, ledgers and polished did not change
 * (strokes do not depend on the ledger). GOLDEN_REPLAY above did not change: the stand-in ledger has no lattice.
 *
 * Re-recorded again for the Detailing cooldown fix (M1-B1, 2026-11-15; see GOLDEN_REPLAY above). Values before the
 * fix: stateHash 1669990435, strokeHash 2027053455, strokes 3975, gramsCollected 67504, dustHash 3965169329; ledgers
 * and polished did not change.
 *
 * Re-recorded for Holster gating (M1-W6-T02, 2026-11-15; see GOLDEN_REPLAY above). Values before: stateHash
 * 3774476554, strokeHash 786224438, strokes 3959, gramsCollected 66779, dustHash 2946260242, ledgers 25.
 *
 * Re-baselined once for the Landing Apron cover (M1 apron cover, 2026-11-18, owner-approved; packages/world
 * DUST_INIT_REVISION 1): createRoomDustLedger now starts the 6 Apron plots at level 2 on 20 % of their owned texels.
 * The script anchors 40 accepted strokes in Apron plots, which now remove less dust. Values before: stateHash
 * 1838396500, gramsCollected 66455, dustHash 2469925789. strokeHash 4164540033, strokes 4023, ledgers 24 and
 * polished 0 did not change (strokes do not depend on the ledger). GOLDEN_REPLAY above did not change.
 *
 * What changed against GOLDEN_REPLAY (same inputs, same sim code) and why:
 * - gramsCollected 55661 -> 66779 and stateHash: the two ledgers remove different amounts for the same stroke. The
 *   stand-in charged swept length x width x depth against one milligram budget of the anchor plot; the real ledger
 *   rasterises the stroke over the 32 x 32 texels of the anchor plot and its neighbours (WDS section 4.5). Dust Cell
 *   grams and the milligram accumulators are hashed, so the state hash follows the grams.
 * - strokes and strokeHash are the SAME (3959, 786224438): strokes come from movement and tool timing, and the
 *   script drains a Cell the tick it fills, so no stroke was rejected in either run.
 * - dustHash, ledgers, polished are new (the stand-in had no texels to hash). `polished` is 0: two actors wandering
 *   for 500 s finish no plot, so this replay does not cover the Inspector's Stamp (packages/world's ledger vectors do).
 */
export const GOLDEN_REPLAY_WORLD_LEDGER = {
  stateHash: 1159199513,
  strokeHash: 4164540033,
  strokes: 4023,
  gramsCollected: 65689,
  dustHash: 3306081474,
  ledgers: 24,
  polished: 0,
};

export function registerGoldenCases(lane: string): void {
  test(`[${lane}] ${GOLDEN_TICKS}-tick RoomSim replay matches the recorded hashes`, () => {
    const got = runGoldenReplay();
    expect(got).toEqual(GOLDEN_REPLAY);
  });

  test(`[${lane}] ${GOLDEN_TICKS}-tick RoomSim replay on the real dust ledger matches the recorded hashes`, () => {
    const got = runWorldLedgerGoldenReplay();
    expect(got).toEqual(GOLDEN_REPLAY_WORLD_LEDGER);
  });
}
