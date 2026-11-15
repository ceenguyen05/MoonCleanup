# M1-W3-T01e Continuous passes (game-designer)

Task: owner decision A for the V3 pacing finding (T01c) / status: done (docs only) / 2026-11-14 / game-designer, Opus 5.5. No git, no code, no game-data change (`depthLevels` unchanged).

Done (all in `docs/design/progression-and-economy.md`):
1. §1.1 table header now says "continuous, §1.1 rule". Crater Floor at Depth 5 went 3 → **2**. Moon mean at Depth 5 went 1.55 → **1.45**. Other cells unchanged.
2. §1.1 outpost-mix line was "1.12 at Depth 5–6, 1.10 at Depth 7". It is now **"1.10 at Depth 5–7"**. The Depth 8 and 13 figures are unchanged.
3. §1.1 Depth bullet now says "by one stroke over a texel".
4. New §1.1 bullet with the rule. Effective depth per pass = Depth ÷ coverage (0.75 on foot, 0.8 for vehicles). n = coverage × L ÷ D. **passes = 1 if L ≤ D, else max(2, n)**.
5. New §1.1 bullet: the V3 bar is mix-weighted, ±20% on Moon mix and on outpost mix. Per-pair rows are diagnostic only.
6. §4 intro now points to the §1.1 rule.
7. §4 Moon-mix area rate changed for T1 (0.16 → **0.17** m²/s) and T2 (0.30 → **0.32**).
8. §22 hand-tool area-rate formula now names the rule and says "not ceil(L/D)".
§8 vehicle rates are unchanged: under the rule they recompute to the same values.

Deviation, needs a decision: I did not use the reviewer's pure max(1, 0.75 L/D). It predicts Mare/T1 at 1.2 passes against 2.07 measured, and Moon-mix T1 at 1.17 (−22%). The floor-2 rule fits every measured mix within 5% (T1 1.49 and T2 1.39 against 1.45; outpost 1.11 and 1.09 against 1.10).

Next:
- Owner of `docs/architecture/world-and-dust-simulation.md` (I don't own it): line 320 still says "ceil(L_P / D), exactly the design table". Line 334 (V3) needs the mix-weighted bar.
- game-designer: in a code pass, update `tools/balance-sim` `model.ts:92 passes()` to the rule, then re-run `balance:assert`. Expected first-hour shift is under 2%.

Files: `docs/design/progression-and-economy.md`, this report.
Evidence: T01c measurements, re-weighted by hand. The simulator was not re-run (no code change allowed).
Commit suggestion: `docs(design): describe dust passes as continuous effective-depth passes`

## Follow-up (lead accepted the floor-2 rule, 2026-11-14)

The file is `docs/architecture/world-and-dust-simulation.md`; the brief said `docs/design/`, but the file only exists under `architecture/`. The lead assigned it to me for this edit. No code, game-data or git changes.
1. §4.5 "Matches design Depth" row (line 320):
   - Before: passes = ceil(L_P / D), with Crater Floor at Depth 5 taking 3 passes.
   - After: effective depth per pass = D ÷ coverage, and passes follow the progression §1.1 rule: 1 if L_P ≤ D, else max(2, coverage × L_P ÷ D). The row says "not ceil".
   - Examples: Mare at Depth 5 → 2, Crater Floor at Depth 5 → 2 (n = 1.95), Depth 13 → 1. Notes the T01c measured range of 1.75–2.18.
2. §4.5b V3 pass bar (line 334):
   - Before: "stroke count within ±20 % of progression §4 times".
   - After: every pair reaches Polished, and mix-weighted passes per tool (Moon 55/35/10 and outpost 90/8/2) are within ±20 % of the §1.1 rule. Per-pair counts are diagnostic only (up to about ±15 % from overshoot and lattice residue).

Next (unchanged): change `tools/balance-sim` `model.ts:92 passes()` to the rule, then re-run `balance:assert`. The terrain-dust-engineer's V3 test must assert the mix-weighted bar.
Files (added): `docs/architecture/world-and-dust-simulation.md`.
