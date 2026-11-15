# M1-W3-T08-restore: MoonRoomSim checkpoint restore API

Task / status: M1-W3-T08-restore / in-review / 2026-11-14 / gameplay-systems-engineer / Opus 5.5

**Done:** The previous worker's code was already on disk and complete. I found no live writer: the files did not change during this session. I verified it and ran prettier on it; there were no logic edits. `MoonRoomSim.captureCheckpoint(): SimCheckpoint` writes the META v1 and PLAYERS v1 section bodies. `MoonRoomSim.restoreCheckpoint(ck): SimRestoreResult` reads them back. Together they cover tick, day phase, wallet, Standard Issue mask, Repeat Requisition counts, suit gear, and for each actor the full avatar state, owned tools, Holster slot and swap timer, every Dust Cell's grams, tool-head state, input edges and lamp. Restore decodes and validates the whole checkpoint before it changes anything. Bad input gets a typed `{ok:false, code, detail}` result and increments `counters.restoresRejected`; it never throws. Values limited by tunable settings are clamped and counted. Layout: `packages/sim/src/room/checkpoint.ts`.

**Hash / bytes:** The golden hash is still 4037918216 (golden test plus the 10-point restore test). `stateHash` and `step` are unchanged, and nothing new is allocated per tick. The capture is new, so no existing bytes changed. The host's interim v0 sections are untouched.

**Exact host call (apps/client/src/sim-host; not edited):**
- Save (`sim-checkpoint.ts` `encodeSimCheckpoint`): `const ck = sim.captureCheckpoint();` Set the sections to `{id: SAVE_SECTION_ID.META, version: ck.metaVersion, length: ck.meta.length}` and `{id: SAVE_SECTION_ID.PLAYERS, version: ck.playersVersion, length: ck.players.length}`, with bodies `[ck.meta, ck.players]`.
- Load (`worker-core.ts` `boot`): build the sim with the fresh options, call `sim.addActor(SELF, cfg.player)`, then `const res = sim.restoreCheckpoint({ metaVersion, meta, playersVersion, players })`, taking the bodies and versions by section id. On `!res.ok`, post a warning and fall back to the current version-0 path for old saves. Set `lastSavedHash` after the restore.

**Next:** sim-host owner switches the host to v1 (calls above) and adds a host round-trip test.

**Files:** packages/sim/src/room/checkpoint.ts, packages/sim/src/room/moon-room-sim.ts, packages/sim/src/index.ts, packages/sim/test/unit/checkpoint.test.ts, packages/sim/test/golden/replay.ts (now steps one tick at a time and has `attach`; golden values unchanged).

**Evidence:** Node 26.13.1 (fnm). In packages/sim, run 17:03 CST after prettier --write: `tsc -p tsconfig.json` exit 0; `eslint .` exit 0; `prettier --check src test` clean; `vitest run` 4 files, 76/76 passed. Baseline was 23; the 53 new tests are the checkpoint suite. That suite covers restore at 10 golden ticks matching the golden hashes, matching events and per-tick hashes after a restore, rejection tests for each field, and a 4000-iteration byte-damage fuzz.

**Blockers / notes:**
- The dust ledger is not part of these sections; it belongs to the DustLedgerPort owner. After a reload the Solo stand-in ledger starts fresh, so dust on plots does not round-trip yet.
- Sim observation, not changed (changing it would alter the golden hash): `detailCooldownMs` keeps falling while the player Details without footing. After landing, that produces a burst of catch-up strokes. Restore accepts negative values because this state is legitimate.

Commit suggestion: `feat(sim): versioned MoonRoomSim checkpoint capture/restore with validation`
