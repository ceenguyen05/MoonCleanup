# M1 review: W1-T01 plot grid, W3-T01/T01d dust ledger + plot events, W3-T03 RoomSim core (code-reviewer)

Status: review cut short by the turn limit / 2026-11-15 / code-reviewer / Opus 5.5. Read-only; no git; no source edits.
Node 26.13.1 (fnm PATH prefix).

## Evidence (same file state)
- `packages/world` vitest: 5 files / 100 tests pass. `packages/sim` vitest: 7 files / 106 tests pass. Both goldens are asserted in `packages/sim/test/golden/cases.ts`: GOLDEN_REPLAY stateHash 4037918216 and GOLDEN_REPLAY_WORLD_LEDGER stateHash 1669990435 (dustHash 3965169329). Both pass.
- Determinism and boundary scan of `packages/sim/src` and `packages/world/src`: no Math.random, Date, performance, DOM, Node, three or Colyseus. The only libm calls are `Math.cos/sin` at config time (`sim-config.ts:105-106`) and `Math.atan/tan` in the height code (see N1).
- Event payloads match `packages/shared/src/events/gameplay.ts`: plot.opened, plot.polished (polishedCount counts Polished only), shine.milestone (pcts drawn from SHINE_MILESTONE_PCTS, 100 % at the full plot count) and dust.collected (at most 8 plotIds).

## Verdicts
| Task | Verdict |
| --- | --- |
| M1-W1-T01 plot grid | ACCEPT. Point-to-plot is the face test, then bisection descent, then a greedy local-max safety walk, so hinted and full paths agree. Ties go to the lower id. Covered by tests and golden hashes. |
| M1-W3-T01 world dust ledger | ACCEPT. Lattice checked: the pitch is floor((w_mm+4)/8), clamped to 25..100, then snapped down through PITCH_SNAP to 25/32/40/50/80/100, all divisors of 800. nLat = floor((25600-1-half)/p)+1 gives exactly 25600/p points, so each texel gets (800/p)^2 points and a full-coverage texel collects A exactly. Removal is floor((d*C+A/2)/A) with the minimum of 1. The maximum 255*640000 fits in int32, so `|0` is safe. Thresholds, stamp credit (at least half, ties to the lower slot) and the hot path without allocation check out. |
| M1-W3-T01d plot events / Stamp / Premium / Shine | ACCEPT. Shine = Polished + Empty (`ledger.ts:705`). Thresholds come from integer ppm and are strictly increasing (schema plus sort). Queues are cleared when the sim takes the ledger. The restore job truncates its own queue entries. |
| M1-W3-T03 RoomSim core | CHANGES REQUESTED (one probable defect, B1: found by reading the code, not yet reproduced) |

## Blocking
- **B1 (probable; reproduce before fixing): Detailing cooldown debt has no floor.** In `packages/sim/src/tools/tool.ts:207-210`, `detailCooldownMs -= stepMs` runs on every Detailing tick. It is paid back (`+= periodMs`) only when a disc is emitted, which needs `stroke && footOk`. While Detailing is held airborne (`footOk` false), the debt keeps growing, and nothing resets it before tool-up (`:178-185`). Failure scenario: hold Detailing through a 5 s jump. On landing the debt is about -5000 ms, so a disc fires on every stroke tick (100 ms) instead of every 450 ms, until about 11 extra discs at depth 255 have repaid it. That is more dust and a faster Polish than the design allows. Suggested fix: clamp with `if (t.detailCooldownMs < 0 && !(stroke && footOk)) t.detailCooldownMs = 0`, or decrement only when the debt is above 0. Add a test: Detailing held through a jump yields at most 1 disc per periodMs after touchdown. The fix may move the golden only if the golden script details while airborne.

## Non-blocking
- N1: `GroundHeight` / `HeightCube` call `Math.atan` / `Math.tan` (`ground-height.ts:221,262`, `height-cube.ts:123`, `cube-mapping.ts:52,71`). The spec sanctions this (WDS 3.4 equal-angle mapping), but movement now runs on authoritative height. So a Firefox or WebKit replay or prediction can drift in the last bit. Those lanes are still NOT RUN; record this as a known cross-engine risk.
- N2: `ledgerRemovalUnits` doc (`ledger.ts:98`) says "halves rounding down". The code rounds halves up, consistent with shared `vectors.ts:9`. Fix the comment only.
- N3: `applyOp` re-derives the pitch inline (`ledger.ts:1134`, hard-coded `+4 >> 3`) instead of calling `latticePitchMm` or using LEDGER_LATTICE_PITCH_DIVISOR. The two drift apart if the divisor changes.
- N4: The ledger's projection computes `(R*1000)*dot` (`:1176`) and `sU*(1/1000/R)` (`:1080`). `IcoPlotGrid.toPlotLocal` / `fromPlotLocal` compute `R*dot*1000` and `u/1000/r`. Both are deterministic, but the comment "as PlotGrid.toPlotLocal" is not bit-exact on .5 mm rounding cases.
- N5: `resetPlot` / `installLedger` mark nothing dirty and do not bump `l0Version`. Restoring into a ledger that had live state leaves the dirty-plot consumers (`dust.plots`, client tiles) stale. Today restores start from a fresh ledger. Document this, or mark dirty on restore.
- N6: `installLedger` on an existing slot never moves a plot from Opened back to Grimy (`refreshL0` only ever advances the state). Harmless while dust only ever decreases.
- N7: `DustRestoreJob` slices. If the sim steps between slices, its queue truncation (`chunk-codec.ts:806`) can drop Stamp / Opened events that live strokes queued. Hosts must not step during a sliced restore; document it.
- N8: `quantiseSegment` writes the head's plot into `a.plotHint` (`tool.ts:333`). `snapshot()` then reports `avatar.plotId` from the head, not the body. This does not affect determinism (hinted and full paths are equal).
- N9: `stateHash` omits `standardIssueOwned`, `copiesBought`, `dayPhase` and the input `prevButtons`. Pricing or edge divergence after a restore would go undetected by the hash.
- N10: Dust removed beyond the remaining Cell room is destroyed (`moon-room-sim.ts:768`). That matches "clamped at capacity", but confirm with the designer.
- N11: A stroke whose anchor plot is Empty is skipped entirely (`:751`), even when its width reaches Grimy neighbours (pad edges).

## Not done
Not reviewed in depth: `checkpoint.ts`, `avatar.ts`, `chunk-codec.ts` encode, `stroke-log.ts`, `plot-attributes.ts`, the alloc test methodology, and the B1 reproduction.

## Next
gameplay-systems-engineer: reproduce and fix B1 with a test, then re-run the sim goldens. Then a short re-review of `tool.ts` only.
