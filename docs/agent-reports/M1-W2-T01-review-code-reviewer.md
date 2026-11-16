# M1-W2-T01 review (round 3): CDLOD sphere terrain

Task / status: **changes requested (no blocking code defect found; completion still blocked on budget evidence)** / 2026-11-15 / code-reviewer / Opus 5.5 medium
Scope read: `docs/agent-reports/M1-W2-T01-terrain-dust-engineer.md`, `apps/client/src/terrain/cdlod/{cdlod-terrain,select,terrain-surface}.ts`, `terrain/height/height-twin.ts`, `terrain/terrain-scene.ts`, `terrain/terrain.test.ts` (selection tests), `visuals/module.ts:295-306`, `visuals/lighting/sun-rig.ts:342-368`, `app/launch-policy.ts:69-76`. Static review only: no build, no browser run, no source edits. `apps/client/src/render/**` not touched (W2-T03 live).

## Checklist

| Item | Result |
| --- | --- |
| Boundaries | `packages/world/src` has no three/DOM/`Math.random`/`Date.now` (rg: only a doc comment mentioning `performance.now` in `dust/chunk-codec.ts:780`). Terrain imports `@moon-cleanup/world` via the barrel. OK |
| Stack rules | rg in `terrain/**`: no `WebGLRenderer`, `EffectComposer`, `ShaderMaterial`, `renderAsync`, `PostProcessing`, `@ts-ignore`. TSL node materials only. `any` covered by file-level eslint-disable with a reason (loose TSL typing). OK |
| Per-frame allocation | `CdlodTerrain.update` / `updateShadowCascades` and `CdlodSelector.select` reuse `Float64Array`/`Float32Array` buffers and views; `visuals/module.ts:302-304` reuses `cascadeEnds`. Only one-time `pendingCasters.splice(0)`. `TerrainScene.info()` allocates but is diagnostic. OK |
| LOD seams | Main mesh: same LOD distance on CPU (`select.ts:328`) and GPU (`terrain-surface.ts:186`), bit-identical vertex positions inside a face, skirts on cube-face edges. Casters: I checked the `casterRangeScale = 0.5` fix by hand. Caster indices are all even, so stage 0 does nothing, and stage 1 morphs over `[0.7, 1] * range[L]`. That puts a level-L caster at the border on the level L-2 grid, which matches the level L-1 caster beside it. The fix is correct. |
| Height twin parity | Exact integer decode (`G*256+R`), own `atanUnit`, unrolled crater loops for ANGLE; measured max 0.28 / 0.32 mm on WebGPU / WebGL2 (report). OK |
| Tests | 243/243 (report); the caster-selection test (`terrain.test.ts:322`) covers detail floor, LOD floor, extra planes. No test of real caster capacity (256) or the GPU caster morph (covered only by the P4 pixel metric). |
| Disposal | Casters, geometries, material, mips, horizon placeholders disposed; shared height texture / min-max owned by the scene. OK (one edge, F8). |

## Findings (ranked)

**F1 (medium, perf, hot path): the main view still keeps every node within 60 m that lies outside the frustum, even after per-cascade casters took over shadow casting.** `cdlod-terrain.ts:220` (`frustumExemptM = 60`) and `terrain-scene.ts:267` (`exempt` default 60). This exemption was there so the main mesh could cast shadows into view (`select.ts:15-16`). Since round 2 the main mesh has `castShadow = false` whenever cascade casting runs (`cdlod-terrain.ts:275`). So the leaf nodes behind and beside the camera, which run the full crater and noise vertex loops plus 5 base samples per vertex, are drawn for nothing every frame. Failure scenario: Medium ground view on the UHD 620 pays extra vertex work in the main pass. This may be part of the 20-21 ms p95. Fix: when `cascadeCasting` is on, use a small exemption (near-plane slack, about 2 m) and keep 60 m only for `percascade=0` / no casters. Measure the GPU ms before and after.

**F2 (medium, correctness, silent): caster instance capacity is 256 with no overflow reporting.** `cdlod-terrain.ts:350`. When a cascade box needs more nodes, `select.ts:341-343` drops the rest of the traversal. Faces are visited in order, so it drops whole regions. Shadows then disappear from part of a cascade, with no error. `TerrainScene.info()` reports overflow only for the main selector (`terrain-scene.ts:430`). Casters run with no horizon culling (`cdlod-terrain.ts:353`) and their box reaches back to the shadow camera near plane, so the rim, high and orbit views are where this happens. Fix: report per-cascade `stats.overflow` in `info()`. Assert 0 in the verify run for every view, or size the capacity from the measured worst case.

**F3 (medium, visual, open item 2): the far normal uses a hard mip pick and has no gutter at cube edges.** `terrain-surface.ts:273` rounds `log2(texelsPerPixel)` to one level with no blend. As the camera moves, those level boundaries become rings that crawl across slopes (orbit zoom, rim view). The P4 check runs at a constant 30 m height, so it cannot show this. Separately, the mips are built without a gutter (`height-twin.ts:85-131`, `pad: 0` at `:345`), and `levelSample` clamps at the face border. The slope therefore goes flat across a cube edge on mip levels 1 to 3, so a lighting seam is likely along cube edges in the orbit and far views. Fix: blend two levels with the fractional `log2`, which doubles the taps only inside the `w > 0` branch. Either add a 1-texel gutter to each mip, copied from the neighbouring face (the level-0 cube already has one), or fall back to the vertex normal within one texel of a face edge. Capture a cube edge.

**F4 (medium-low, visual): `CASTER_DROP_M` is a vertical 0.3 m drop, so its effect grows as the sun gets lower.** `cdlod-terrain.ts:95`, `terrain-surface.ts:250`. The contact shadow loses `0.3 / tan(elevation)` metres: 1.2 m at 14 degrees, 3.4 m at 5 degrees, and more at the terminator, where Moon Sweepers-style low sun matters most. Ridges under 0.3 m stop casting at all. Acceptable for now. Better: scale the drop with sun elevation (for example `drop * clamp(sinEl / sin14deg, 0.3, 1)`), or offset along the light direction, then re-check the stripes at 5 and 30 degrees. The 30 degree capture exists but was not viewed (open item 6).

**F5 (low-medium): `RECEIVER_REACH = 1.7` is a constant that assumes a 60 degree FOV at 16:9.** `cdlod-terrain.ts:89`, used at `:318`. At 21:9 with a 60 degree vertical FOV the corner factor is about 1.77, and a wider FOV or a photo/zoom mode pushes it higher. The far corners of each cascade then lose terrain casters. Fix: compute `sqrt(1 + tan²(v/2) * (1 + aspect²))` from the main camera each frame, which is free, or pass it in.

**F6 (low, open item 4): casters use the shadow camera matrices from the previous frame.** `cdlod-terrain.ts:299-308`. After a teleport, respawn or `setView`, one frame draws terrain without shadows or with misplaced shadows. This is visible as a one-frame pop on respawn. Fix: add an `invalidate()` that, for one frame, sets an infinite margin or turns cascade culling off (or lets the main mesh cast). Call it from camera cuts.

**F7 (low): the caster morph chain uses only 2 of its `MORPH_STAGES = 3` stages.** In `terrain-surface.ts:183-192`, stage 0 does nothing for the even-index caster patch. Main-view neighbours are only tested to differ by `<= MORPH_STAGES` levels (`terrain.test.ts:215`), so casters 3 levels apart would show a T-junction crack in the shadow map. Casters also get no skirts, including on cube-face edges (`:250`). Both are low risk: R = 2000 puts the cube edges more than 650 m beyond the fence. Fix: either assert that neighbours differ by at most 2 levels, or add a fourth stage for shadow passes only.

**F8 (low, edge): `ownsShared` is decided by `minMax` alone.** `cdlod-terrain.ts:160,393`. If a caller passes `heightTexture` without `minMax`, the terrain disposes a texture it does not own. Fix: track ownership of each resource separately.

**F9 (low, cost): every `rebuildTerrain` (preset change) rebuilds the 3 mip textures** (`cdlod-terrain.ts:172`; 4.1 MB plus a CPU box filter), even though the scene shares the height texture and min-max. Fix: share them the same way.

**F10 (nit): `URLSearchParams.get("percascade")` runs every frame.** `terrain-scene.ts:406`. Cache it at construction, like `castOff`.

**F11 (nit, outside the owned path): `sun-rig.ts:349` uses `continue` when a shadow is undefined,** so `cascadeCameras[k]` can stop lining up with layer `KEY_CASCADE_LAYER_BASE + k` and with `cascadeInfo[k]`. In practice this cannot happen today. Push a placeholder, or index explicitly.

## Open items from the author's report: risk call

| Open item | Call |
| --- | --- |
| 1. Medium p95 20-21 ms, not broken down; High not re-measured | **Risky, blocks done.** Budgets block the completion claim (CLAUDE.md). Check F1 first. Also measure the CPU time of the 4 caster `select` calls, which is not in `selectMs` (`terrain-scene.ts:396-398` times only the main selection). |
| Shadows start 0.3 m lower | Acceptable at 14 degrees; risky at very low sun (F4). |
| No far-normal mip blend | Risky for orbit and far views (F3); not measured by any moving-camera check. |
| beginQuery warnings | Acceptable. Production enables timestamps only on WebGPU (`launch-policy.ts:74-75`), and `three-renderer.ts:50-51` turns them off on WebGL. A likely source: `visuals/dust/verify/page.ts:60` builds `WebGPURenderer({ forceWebGL, trackTimestamp })`, which allows WebGL timer queries. Dev tooling only. |
| Dust-scene mirror | Not reviewed (untouched, out of scope). Acceptable to defer. |
| Specks in the rim shadow (3), missing far craters (5) | Specks: undiagnosed, could be F7 or the caster cut-off; low. Far craters: acceptable (the player is always inside the fade range). |

## Must fix (next W2-T01 premium worker)

1. F1: drop the 60 m frustum exemption when per-cascade casting is on. Re-measure Medium GPU and frame p50/p95.
2. Break down the Medium p95 (open item 1), including the CPU time of caster selection. Re-measure High.
3. F2: report caster overflow per cascade in `info()`. Show 0 in ground, rim, high and orbit, or raise or derive the capacity.
4. F3: blend between far-normal mip levels and fix the cube-edge seam (gutter or fallback). Capture orbit motion and a cube edge.
5. F4: view `r3/ground-sun30.png` and a 5 degree capture. Scale `CASTER_DROP_M` with sun elevation if contact shadows look detached.
6. Run `pnpm verify` once the integrated state is final (not yet run).

Should fix: F5, F6. Optional: F7-F11.

## Next

Lead: route items 1-6 to the W2-T01 premium worker. visual-qa-reviewer: low sun, high sun and orbit motion after F3/F4.
