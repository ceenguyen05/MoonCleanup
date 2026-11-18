# Landing Apron 20% cover investigation

2026-11-18. Temporary Codex worker. Owner decision: consistent Landing Apron cover across Solo, online and saves, with existing goldens unchanged. Scope: world and terrain bake inputs only; coordinate consumer changes. No partial authority changes will be landed if the consistency and golden constraints cannot both be met.

Outcome: **design/blockers only; no authoritative partial change**. Existing report `M1-apron-forwarding.md` records forwarding complete and thinning absent; exact current source confirms the missing cover representation. Implementing only the world hook would not meet consistent Solo/online/save/visual behavior, and applying the new initial world through today's shared factory would change the world-ledger replay inputs.

## Measured golden conflict

An isolated temporary diagnostic test used the unchanged `makeWorldLedger()` and `GoldenRun`, queried the sim's actual Apron directions, converted them to grid plot IDs, and ran all 10,000 recorded input ticks. Node v26.13.1, command from `packages/sim`: `fnm exec --using=26 node ../../node_modules/vitest/vitest.mjs run test/unit/apron-investigation.test.ts`.

- Apron IDs: `65280, 65409, 81793, 16257, 32512, 48896`.
- **40 accepted strokes anchored in Apron plots.** Two Apron plots have allocated/changed ledgers at the end: `81793`, `16257`.
- Result matches the existing world golden: stateHash `1838396500`, strokeHash `4164540033`, dustHash `2469925789`, 4,023 strokes, 66,455 g collected, 24 ledgers, 0 polished.
- The diagnostic first passed, but this project's test reporter suppresses console output. A second intentional assertion failure printed its measured object (4.90 s) for exact evidence. This was an investigation output mechanism, **not a product regression failure**, and not a failed implementation check. The temporary diagnostic file was deleted afterward; no failing test remains.

This disproves the assumption that current goldens avoid the Apron. A correct new world cannot be assumed compatible with those recorded bytes. No new golden or hidden test-only exemption was created. No production code, data, manifest, hash, save or tests changed in this investigation.

## Exact implementation gaps

1. `packages/world/src/dust/ledger.ts`: constructor accepts optional integer `dustLevelOf`, but no initial cover. `allocLedger` initializes **every owned texel** to `16 * level`. `installLedger` reconstructs initial units as `16 * level * ownedTexels`. `reset` restores every non-empty plot to full L0 fraction 255. A 20% initial mask must be used by all of allocation, validation/clamping, initial mass, restore, reset and snapshots.
2. `mgPerUnitOf` computes mass as `kgPerM2PerLevel * level * fullPlotArea`. Merely zeroing 80% of texels would concentrate the full plot mass in the remaining 20%. Both physical cover and collectible mass need consistent initialization; initial blank texels must never count as player removal/contributions or create a free Stamp reward.
3. `packages/sim/src/dust/room-ledger.ts`: `createRoomDustLedger` is the common authority/mirror factory, used by the Solo worker, server, online client, Solo dust view **and the golden fixture**. It currently supplies uniform Highland attributes, never level/cover overrides. A world-only helper is inert until this factory wires one common initialization revision.
4. `tools/terrain-bake/src/manifest/manifest.ts` ends with `grid.status` explicitly deferring per-plot dust class/grid baking. Its hash has no Apron dust field. Cover initialization requires an explicit deterministic artifact/recipe included in identity, not an unversioned runtime change behind the old bake hash.
5. `apps/client/src/visuals/dust/tile-atlas.ts`: absent per-plot ledger defaults every texel to full dust; `flat-lookup.ts` also treats absent atlas tiles as full dust. Fresh cover must be visible before the first stroke and must survive tile eviction/rebuild. The presentation path needs the same base cover, not just server zeros.
6. Chunk saves omit pristine chunks; untouched Apron cover must reconstruct from the identified world baseline on both restore paths. Existing ledger restore clamps only to level, so it would accept dust in initially blank locations unless the baseline mask participates. `TERRAIN_BAKE_HASH` must stay equal to the actual manifest; no manual fake hash.

## Safe design and migration

Use a deterministic, versioned initial-dust recipe baked for the grid and outpost positions: fixed selected Apron IDs, level 2, and a spatial texel mask covering approximately 20% of owned area. The contract must state integer rounding (owned texel counts are not always divisible by five), mask seed and layout. Prefer coherent small patches; using fractional depth everywhere would mean thin dust over 100% of the area and would not satisfy cover.

Use the exact recipe in the world ledger and rendering mirror, bake it into manifest identity, and let all hosts obtain it through one factory. Keep geometric ownership separate from initial dusty texels; use the latter for maximum per-texel dust, initial units, mass, completion thresholds and restore validation. Zero base texels stay blank without marking removed dust or crediting players. Test dirty/reset/pristine reconstruction as well as saved changed chunks and authoritative/client parity.

To preserve existing goldens honestly, introduce a **named old-world revision fixture** for the existing recorded replay and retain its current hashes, while adding separate new-world Apron fixtures/replays. This requires explicit lead/owner acceptance of revision-pinned golden fixtures; silently changing `makeWorldLedger()` to bypass production initialization is not acceptable. If all goldens must continue exercising the current production default world unchanged, the requirement conflicts with the new world data at the measured Apron intersections.

For live saves, a new baseline needs a new world identity. The existing owner-approved bake-mismatch policy archives known old stamped worlds and starts fresh; it must be applied consistently in Solo/cloud/online. Existing server `durable-dust-store.ts` still loads unversioned legacy (`bakeHash=null`) saves unchanged. A new baseline therefore also needs a defined legacy rule (pin to the legacy recipe or explicit migration); do not reinterpret missing chunks as the new Apron while retaining old touched chunks, payouts and contributions. Retain recoverable archives, never mint a cleanup reward during migration. Contracts/host/persistence/render paths must be coordinated before activation.

Exit gates for implementation: approve revision-pinned old goldens and the legacy-save rule; coordinate sim factory, render and save owners; write failing tests for deterministic 20% cover/level2, untouched/fresh + reset equality, changed/pristine chunk restore, old-world fixture preservation, Solo/server/client initial bytes, no reward for pre-cleared area, mass scaling and real-GPU fresh/cleaned visual checks. Then implement as one coherent initialization/identity change. This worker stopped before a partial hook because these conditions are not resolved by narrow world/bake edits.

## Checks and limits

No persistent new regression tests or production change was made, so there is no claimed Apron feature PASS. No bake, install, server, browser, GPU capture, full verify, git mutation, STATUS edit or policy edit. Diagnostic process exited; its file was removed. A real-GPU look-check is required when implementation changes visible initial cover; it is NOT RUN here. Report formatting and diff checks are run separately.
