# M1 tipS balance (game-designer)

Decision: keep `tipS` = 2.0 s. Fast Tip multipliers stay 0.6 / 0.3, which gives 1.2 s and 0.6 s (40 / 24 / 12 ticks). No data or doc edits.

Rationale
- progression-and-economy.md §8.1 defines Fast Tip as unload -40% (0.10) and -70% (0.30). The 0.6 / 0.3 multipliers already match that.
- Economy is not affected. The balance model uses a 100 s vehicle round trip (§8, §20). A 2 s tip is 2% of it, and Fast Tip max saves 1.4 s, about 1.4%. The real trip-time effect is carried by the `vehicleTripTimeMult` stat, which is unchanged.
- Feel: 2 s is a readable tip animation that is snappy and never feels like a stall. At 0.6 s the animation (0 to 40 degrees, hold, 0.8 s return, animation-spec §hopper tip) still plays; the return is cosmetic and can overlap the departure.
- Smooth Handoff's -20% vehicle unload is separate and unaffected.

Evidence
- Review only. No change was made, so no golden, test or balance-sim re-run was needed; GOLDEN_REPLAY stateHash 1076468633 and strokeHash 4164540033 are untouched.
- Not run: balance-sim. The effect is far below its resolution.

Limits and open issues for balance-reviewer
- The tip needs a stopped vehicle at a Dump Plate. At 0.6 s, repeated stop-and-go at a plate is cheaper than the long haul, so it is a sell-loop candidate. The 100 s trip model still bounds income, because Dump Plates sit at the Gate.
- If a future feel pass wants a heavier tip, raise `tipS` to 2.5 s. That is the only change needed (0.6 s becomes 0.75 s at max).
