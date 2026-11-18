# M1-W5-T03 Outpost Boreal hero hardware v1 (technical-artist)

Task / status: M1-W5-T03 / in-progress (assets built + budget PASS; not placed in game, not visually verified) / 2026-11-17 / technical-artist (Opus 5.5, High)

## Done
- New source `assets/models/outpost/boreal_hero_kit.py` (headless Blender 4.5.10, kitbash v0 + new trim sheet v1): one GLB with four pieces sharing one material and one 1024 px KTX2 trim set: `assay_counter` (waist-high island, 4 grated weighing decks for the 4 pour slots, yellow grab rails, readout tower with 4 amber LED panels, teal beacon), `receiving_gate` (arch, scanner ring with teal emissive bore, Glide Rail end), `dump_plate` (4.3 m grated pad, chevron hazard edges, corner lamps; matches sim plate radius 2 m), `flood_mast` (6.2 m tripod mast, twin warm floods). Each is `<piece>_LOD0..2`, pivot = ground centre, +X = front (Gate puck travel / flood aim), plus anchor empties (`assay_counter_pour_0..3`, `_readout_0..3`, `_flash`, `receiving_gate_ring`, `_rail_end`, `dump_plate_center`, `flood_mast_lamp_0..1`).
- Pipeline: `ctm_trim.py` STRIPS_V1 (adds `grate`, `emit_warm`; v0 table unchanged), `ctm_kit.py` `v_bands` box UV banding (default off, so the M0 proof rebuilds unchanged), `turntable.py --piece`, per-piece budgets (`budgets.ts` class `outpostHeroKit`, `check.ts` PIECE_MISSING + per-piece caps, `io.ts` `pieceLodTriangles`), `assets.ts` row.
- Output: `apps/client/public/assets/outpost/boreal_hero_kit.ed50b1f0f171.glb` (1,244,436 B, meshopt, 4 KTX2 textures: ETC1S colour/emissive, UASTC normal/ORM) + `manifest.json`.

## Evidence
`tsx src/build.ts --out ../../apps/client/public/assets/outpost --only boreal_hero_kit` (Node 22, ktx v4.4.2): assets:check PASS, 0 errors, 0 warnings. Note: the checker caught real over-budget LOD1s on an earlier pass (counter 7876 > 7500, plate 3636 > 3000); fixed.

| Piece | LOD tris (cap) | Yellow share (mesh area) | Texel p05 / median px/m |
| --- | --- | --- | --- |
| assay_counter | 14060/5328/948 (15000/7500/3750) | 1.4 % | 287 / 305 |
| receiving_gate | 7052/3248/544 (15000/7500/3750) | 0 % | 253 / 370 |
| dump_plate | 5468/2324/300 (6000/3000/1500) | 5.9 % | 287 / 298 |
| flood_mast | 5480/2772/680 (6000/3000/1500) | 0 % | 296 / 475 |

Kit total LOD0 32,060; Boreal layout of 1 counter + 4 gates + 4 plates + 4 masts = about 85k LOD0 (outpost cap 250k). Raw metrics: `assets/models/.cache/boreal_hero_kit/report.json` (gitignored).

## Not done / not verified
- Not placed in the game: `apps/client/src/visuals/outpost/` (loader + layout from `borealStandInSellPoints`: counter at the pole, plates on the 4 gate points 15 m out, arch 2.6 m outward with +X inward, masts on the diagonals) is not written. Wiring needs the boot owner (boot.ts / visuals/module.ts are off-limits to me).
- Client has no KTX2Loader / basis transcoder yet; the integrator must provide a KTX2Loader (renderer-detected) and serve the transcoder.
- Tests added (`tools/asset-pipeline/src/budgets/check.test.ts`): committed kit passes assets:check with all 4 pieces, KTX2-only textures, 1 material; a kit missing pieces fails PIECE_MISSING / TRIANGLES_OVER_BUDGET. `vitest run` in tools/asset-pipeline: 2 files, 13/13 pass; `tsc -p tsconfig.json --noEmit` exit 0.
- Turntables: CPU Cycles method-preview renders were started in the background (Bash task `bwnclunmm`, output `assets/models/.cache/boreal_hero_kit/turntables/`). Auto mode denied my attempt to stop the Blender processes; the lead may need to stop them. Method previews are not VT-M1-35 (in-engine harness needed). VT-M1-21, VT-M1-35, VM-04 and on-screen palette share: NOT RUN.
- Custodian fixes (W4-T07 follow-up list): blocked, W4-T07 not run. W4-T07: not started.
- ASSET_LICENSES row: added below by this task (LicenseRef-Original).

## Files
`assets/models/outpost/boreal_hero_kit.py`; `tools/asset-pipeline/src/{assets.ts,budgets/budgets.ts,budgets/check.ts,budgets/check.test.ts,gltf/io.ts,blender/ctm_trim.py,blender/ctm_kit.py,blender/turntable.py}`; `apps/client/public/assets/outpost/**`; `docs/ASSET_LICENSES.md`.

## Next
The background turntable loop has since ended on its own (exit 255, partial frames only; nothing left running); write `visuals/outpost` layout + loader + tests; integrator wires it with KTX2; in-engine turntables + VT-M1-21/35.

Commit suggestion: `feat(assets): Outpost Boreal hero hardware kit v1 (Assay Counter, Receiving Gate, Dump Plate, flood mast)`
