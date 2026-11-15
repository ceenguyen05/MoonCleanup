# M1-W3-T03: packages/sim RoomSim core

Task / status: M1-W3-T03 / in-review (core done; ready for review and for W3-T08 / W3-T05 integration) / 2026-11-14 / gameplay-systems-engineer / Opus 5.5

**Done:** `MoonRoomSim implements RoomSim` (shared/sim/room-sim v1), deterministic and environment-agnostic.
- **Fixed step:** 20 Hz from game-data, plus `SNAPSHOT_HZ` for strokes. `step(dt)` always uses the config `dt`; any other value passed is counted in `dtMismatch`. Input is applied by seq, with button edges derived from levels.
- **Low-g movement:** capsule bottom on `GroundHeight`; accel, release and reverse; walk, Lope and sweep-walk; slope slowdown and slide above 42°; jump, jump cut, coyote time, buffer; Touchdown; air control; Hop Pack (bursts come from suit-gear); landing classes up to Faceplant; sub-steps clamped to 2..8; pole-safe heading frame with a hysteresis bit; sine table and polynomial atan; end-of-tick 2^-16 quantisation.
- **Tool head:** sweep phase comes from `inputSeq` (integer ms). Contact is 70% of the cycle, with lift above 5.5 m/s and drop below 5.0 m/s. At most one `StrokeRecord` per frame interval, quantised to mm in the anchor frame through `PlotGrid`. Desk Duster Detailing makes 0.5 m discs at depth16 255. Crescent Squeegee Flick keeps cleaning airborne up to 1.2 m. Night penalty applies to depth16.
- **Dust Cell:** capacity is checked before the ledger op. A milligram accumulator feeds whole grams into the Cell, clamped at capacity. A full Cell stops pickup. Emits `dust.collected`, `cell.near_full` and `cell.full`; `drainCell` hook for later cargo work.
- **Sun clock:** integer ticks, dawn/day/dusk/night, `daynight.changed`.
- **Tool purchases:** Standard Issue (free for everyone once anyone owns it) and Repeat Requisition pricing, both from economy.json. `select_tool` and holster cycling work.
- **Barrels:** root plus `movement/`, `tools/`, `cargo/`, `economy/`, `vehicles/`; the last three are placeholders.

**Stubs behind interfaces:** `DustLedgerPort` (applyStroke/isEmptyPlot), default `ApproxDustLedger` (per-plot mg budget, NOT ADR-0026) until W3-T01. No plot.opened/polished, Shine, cargo/pour, vehicles, robots, structures/OBB collision, Ballast Soles, Lane Guide, Steep-plot ×0.6, holsterSlots limit.

**Next:** W3-T01 swaps in the real ledger behind `DustLedgerPort`. W3-T08 hosts `MoonRoomSim` in the worker and reads strokes through `strokeCount`/`strokeAt`. contracts-architect adds the movement.json/tool-feel.json keys of game-feel §10 (feel defaults are in `MOVEMENT_FEEL`/`TOOL_FEEL`) and a `yawFrame` input bit if needed. Review: code/perf/balance.

Files: `packages/sim/src/**` (config, math, dust, clock, movement, tools, room, cargo, economy, vehicles, index), `packages/sim/test/**`, `packages/sim/vitest.config.ts`, `packages/sim/vitest.browser.config.ts`, `packages/sim/tsconfig.json` (include test).

Evidence (Node 26.13.1, fnm prefix, packages/sim, final file state):
- tsc, eslint and prettier: OK. `vitest run`: 18/18 pass, covering unit, property and the 10,000-tick golden replay (stateHash 4037918216, 3,975 strokes, 56,640 g).
- Chromium browser lane: golden replay matches. Firefox and WebKit: NOT RUN (Playwright binaries are not installed).
- Measured, per actor-tick with 6 actors on fixture terrain (noisy, single machine): avatar alone 6.2 µs; avatar + tool + stroke + stub ledger 8.6–13.2 µs. The avatar step meets ≤ 10 µs. The full sweeping path is borderline.

Blockers / requests: contracts-architect: feel keys; the Detailing size is radiusM 0.5 in traits.json but a 500 mm diameter in the contract. terrain-dust-engineer: real ledger port.

Commit suggestion: `feat(sim): deterministic RoomSim core with low-g movement, tool strokes and Dust Cells`

## Repoint (config v1.3 feel keys, 2026-11-14)

**Done:** `packages/sim` now reads every feel value from game-data; `MOVEMENT_FEEL`, `TOOL_FEEL` and the `FLICK_MAX_HEIGHT_M` export are gone.
- `createSimConfig` resolves `movement.json` into `config.feel` (`MovementFeel`) and `tool-feel.json` into `config.toolFeel` (`ToolFeel`) once, frozen, using the key mapping from `M1-W3-T03-feel-keys.md`. Hot paths read `cfg.feel` / `cfg.toolFeel` (no new allocation per tick). `holsterSwapS` comes from `movement.json`, `sweepFacingTurnDegPerS` from `tool-feel.json`. `hopCos35`/`hopSin35` are `Math.cos/sin(hopBurstAngleDeg * pi / 180)` at config time.
- `DETAILING_DIAMETER_MM` is no longer used by the sim. `SimConfig.detailingWidthCm` and `detailingDiameterMm` derive from `trait.detailing` `params.diameterM` (0.5 m gives 50 cm and 500 mm). `tool.ts` uses the width, and `ApproxDustLedger` takes a new required `detailingDiameterMm` option for zero-width discs. `createSimConfig` throws if the trait param is missing. contracts-architect can now remove the constant from `packages/shared/src/world/dust.ts` and its two tests (`dust.test.ts`, `bundle.schema.test.ts`).
- New `test/unit/config-driven.test.ts` (5 tests): an unedited bundle clone reproduces the baseline; `SimConfig` mirrors the tables; editing `movement.groundAccelMps2`, `tool-feel.detailingMoveMult` or `traits` Detailing `diameterM` each changes the replay hash (the last also changes `detailingWidthCm`). `runGoldenReplay` gained an optional `data` argument.
- Doc: `docs/design/progression-and-economy.md` row 512 (E section 21 traits) `radiusM: 0.5` becomes `diameterM: 0.5`.

**Evidence (Node 26.13.1 fnm prefix, packages/sim):** tsc OK; eslint OK; prettier applied; vitest 23/23 (18 existing, including the 10,000-tick golden: stateHash 4037918216, strokeHash 2027053455, 3,975 strokes, 56,640 g, all unchanged; plus 5 new). Browser lane not re-run.

**Risk note:** `hopCos35`/`hopSin35` now come from `Math.cos/sin` at config time. They are bit-identical in V8 (golden passes); other engines use fdlibm-class implementations, but the Firefox/WebKit golden lanes are still NOT RUN.

**Next:** contracts-architect removes `DETAILING_DIAMETER_MM`. The stale `sim-config MOVEMENT_FEEL` mentions in comments of `packages/shared/src/config/{movement,tool-feel}.schema.ts` and the game-data test comment can now say `config.feel` / `config.toolFeel`.
