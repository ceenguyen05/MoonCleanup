M1-W3-T05 default boot = playable Solo game / in-review / 2026-11-17 / integrator / Opus 5.5

## Done
- **Default launch** (no `?scene=`, no `?play=1`, Solo host on) is the game: the player's own Contract (real identity, IndexedDB saves, checkpoint sync as before) on the dust worksite (regolith ground + GPU dust layer) centred on Outpost Boreal, with player input, Solo prediction, camera rig and tools.
  - `launch-policy.ts`: `wantsGameWorksite`, `gameModuleSearch` (modules get `scene=dust`), `GAME_SITE_DIRECTION` (+Y = Boreal), `screenBearingDeg`.
  - `boot.ts`: `gameLaunch` builds the `SoloDustView` + feed on the Boreal site plot (`grid.plotAtXYZ(0,1,0)`); gameplay mapper = `PlotFrameMapper` on that plot; the real Solo host gets `onHost: view.attach(host)` (re-attached when save sync restarts the host). The default spawn (57 m) and the sell points (15 m) lie on the 150 m patch. `wantsPlayerInput("")` is true.
  - Dev scenes unchanged: `?scene=*` (incl. `dust` with its own memory Contract and sweeper, `moon`), `?play=1` (hello world + input), `?solo=0` / `?capture=1` (hello world parity mesh).
- **Dust-scene mirror**: input-to-screen was already consistent (gameplay tests). The remaining mirror defect was the HUD: in the mirrored plot frame the compass heading scrolled against the view and bearings (parcels, outposts, objective marker) sat on the wrong side. Fixed in `boot.ts`: bearings go through `screenBearingDeg(b, mirrored)` and the UI bridge reads a mirrored yaw (`mirroredHeadingInput`, a getter, no per-frame allocation). Applies to the game launch and `?scene=dust&bot=0`.
- **Objective distance**: `ObjectiveMarkers` is now built in the lazy game-data chunk with `moonRadiusM` (chip seen in the smoke: "Assay Counter 157 m").
- **markerSink shim removed** from boot (`setMarkerBearing: (id, deg) => uiModule.setMarkerBearing(id, deg)`); `markerSink` itself still lives in `objective-markers.ts` (other worker's file) and its test.
- **saveArchived notice (add-on)**: `online-room.ts` gains optional `OnlineRoomOptions.store` and the session handler `onSaveArchived` dispatching `notices.push` (`notice.save_archived`, priority progress, mergeKey `save_archived`, actionId null; shape from M1-saveArchived-client.md); boot passes `store` in the online base options. Test: source-level only (boot-wiring); no runtime HELLO test (OnlineRoom needs a grid build + session).
- `camera-rig.ts`: not edited (no change needed there; the frame's handedness is fixed by the visuals scene).

## Evidence
- `tsc --noEmit -p apps/client`: exit 0 (final run, after the add-on).
- vitest final: `launch-policy.test.ts`, `boot-wiring.test.ts`, `online-room.test.ts`: 3 files, 40/40 pass. Earlier: `objective-markers.test.ts` pass. `gameplay/solo-prediction.test.ts` 9/9 alone; its "PlotFrameMapper (dust scene axes)" case timed out at 5 s twice under load (grid build, untouched code; load-sensitive).
- eslint on boot.ts, launch-policy(.test).ts, boot-wiring.test.ts, online-room.ts: exit 0; prettier applied.
- The smoke ran before the saveArchived add-on and the prettier pass (neither touches the Solo path). Dev server :5471 is gone (0 listeners).
- Headless smoke (software WebGL2/SwiftShader, own vite on :5471, script in the session scratchpad `default-boot-smoke.mjs`), URL `/?perf=1` (perf only installs dev hooks): ready 17.8 s; pointer lock true; host local/running; strokes reach sim (388 chains acked) and the main-thread dust view (388 applied, 0 decode errors, 0 ledger growths); `viewConstructMs` 440 ms; Induction steps advanced: `first_stroke`, `fill_cell` (cell 4000 g), `open_plot_card`. Console: warnings only (no WebGPU adapter, ReadPixels stall, font preload), no errors.

## Not run
- `pnpm verify`; real GPU / WebGPU; perf numbers (SwiftShader fps is meaningless); pour at the Assay Counter, buys and Near Parcel steps in the browser (need steering to the station; the teleport hook moves only the presentation); visual review.

## Defects / returned to owners
1. **Terrain not in the default path (visuals + terrain owners).** The CDLOD moon (`?scene=moon`) has no dust layer and the visuals module hosts one scene; the dust layer exists only on the flat 150 m worksite (`visuals/dust/dust-worksite.ts`, `GROUND_RADIUS_M = 150`). The default game therefore runs on the worksite, not the terrain. Needs a dust lookup on the terrain material (or the worksite on terrain heights) plus the worker on the height cube (`solo-host.ts` passes `world: { kind: "flat" }`).
2. (Fixed in round 2: patch follows the player.) **Player can walk off the patch (visuals owner).** The smoke ended 157 m from Boreal, past the 150 m cap edge: no ground drawn (sky only). Needs a larger / avatar-following patch and atlas residency (`dust-worksite.ts` fixes `cam` at the site centre), or a play fence.
3. (Fixed in round 2; HUD compensation removed.) **Scene mirror at the source (visuals owner).** `visuals/dust/flat-lookup.ts` maps world z = +v (det = -1). Making it z = -v (and `PlotFrameMapper` z negated) would remove the input flip and the HUD compensation.
4. Boot cost: the game launch now awaits the sim-host chunk + `SoloDustView` (grid build, 440 ms in the smoke) before render init.

## Round 2 (status, updated as items finish)
1. Patch follow: DONE (browser-verified). In the induction smoke the patch moved 7 times (`siteMoves` 7, site 49025). The player ended 67.6 m from Boreal with the ground drawn under them (screenshot `ind1.png` in the session scratchpad). Strokes: 363 applied, 0 decode errors, 0 ledger growths.
   - `flat-lookup.ts`: tables are re-centrable: `beginRecentre(site)` builds spare tables in slices (`stepRecentre(ms)`), `commitRecentre()` swaps them with one upload (same textures, same shader graph).
   - `dust-worksite.ts`: optional `DustFeedPort.follow` (`DustSiteFollow`). Atlas residency centres on the avatar each frame. Past 40 m from the site, the avatar's plot tables are built in 1 ms slices. The move is staged on the frame mapper and committed in the frame the mapper applies it, so camera, avatar and ground move together.
   - `camera-rig.ts` `PlotFrameMapper`: `requestSite`, `sitePending`, `applyPendingSite`, `site`, `siteVersion`. A staged move is applied by the next `point()` (the gameplay present, first in the frame). Cost when idle: one compare per `point()`.
   - `boot.ts`: one `PlotFrameMapper` shared by gameplay and the worksite. `follow.avatar` reads `gameplay.rig.feet`. Feed info adds `siteMoves` and `site`.
   - Tests: `dust-replay.test.ts` "recentres in budgeted slices..." (sliced build equals a fresh build); `solo-prediction.test.ts` "a staged site move...".
2. Mirror fixed at source: DONE.
   - `flat-lookup.ts`: world z = -v (cells, plot table z column negated, `directionAt`). `PlotFrameMapper` z is negated (point and direction), so `mirrored` is false and input no longer flips.
   - Dust scene view poses have z negated.
   - HUD compensation removed: `screenBearingDeg`, `mirroredHeadingInput` and their tests.
   - Tests updated: `dust-replay.test.ts` (right-handed check), `solo-prediction.test.ts` (z = +2, mirrored false, D gives moveX +127).
   - Browser check: mouse +x raised yaw (+0.22 rad per 140 px). Walking turned clockwise about the up vector (k = -0.999), which is a right turn, and the frame is now right-handed, so the screen turns right. The pixel column-shift probe was inconclusive (0 px on plain ground); the turn direction comes from the numeric check.
3. CDLOD terrain + dust in default path: NOT DONE. It was not safely completable this round. What remains:
   - **Dust on the terrain material.** `DustFlatLookup` maps flat (x, z) to a plot. The CDLOD surface (`terrain/cdlod/*`, `terrain-scene.ts`) needs a sphere-direction-to-plot lookup in TSL (per-fragment unit direction → cell table on a cube or tangent frame around the avatar → plot affine). It also needs `maskSource` plumbed into `createPlainTerrainMaterial` / the regolith terrain factory (`visuals/materials/terrain-regolith-provider.ts`, not mine). That is new shader work with its own fetch and perf budget, which must be measured on UHD 620.
   - **One scene.** The visuals module hosts one `LookScene` (`visuals/module.ts`, not mine). The game needs terrain, dust layer, sun rig and follow in one scene: a new `GameScene` or `TerrainScene` + `DustLayer` composition, and a visuals `module.ts` route.
   - **Sim on terrain heights.** `app/solo-host.ts` starts the worker with `world: { kind: "flat" }`. The worker supports `kind: "cube"`, but the client predictor `ground` (`GameplayModule` `ground` option) must be the same `GroundHeight`, or every tick corrects. The baked cube must be loaded before the host starts (`terrain/height-asset.ts`, about 7+ MB fetch). The save `bakeHash` changes (re-bake policy: archive old saves).
   - **Render frame.** On terrain the camera mapper must be moon-centred (identity, or a floating origin; the CDLOD world is moon-centred), not the plot frame.
   - Until that lands, the default game runs on the flat dust worksite (regolith + dust, now following the player), and the terrain stays on `?scene=moon`.
4. Browser-verified pour / buy / Near Parcel: DONE. Smoke script `induction-smoke.mjs` (session scratchpad), headless SwiftShader WebGL2, default URL `/?perf=1&lm=3000` (the dev wallet makes the buy affordable). The avatar was driven by real W and mouse input with closed-loop steering, no teleport:
   - Dust Cell filled.
   - Walked to the Assay Counter (0.85 m) and held E: `pour_at_counter`.
   - Walked to the Desk (0.6 m), E opened it, bought the Crescent Squeegee (row status `owned`): `buy_crescent_squeegee`.
   - Walked about 60 s to the nearest Near Parcel (0.6 m): `find_near_parcel`.
   - Induction at the end: `first_stroke`, `fill_cell`, `pour_at_counter`, `buy_crescent_squeegee`, `find_near_parcel`. Not reached: `open_plot_card` (round 1 proved it), `polish_apron_plot`, `buy_dust_cell`.
   - 0 console errors or page errors.
   - New dev/perf-only hook `__mcParcels()` in `boot.ts`, next to `__mcStations`.
5. Roster port wiring: DONE. New `app/online-roster.ts` `createRosterPort(slot)` (current, subscribe and kick through the open room's session; with no room: empty, no-op, false). `boot.ts` passes `roster: createRosterPort(online)` in `OnlineEntryPort`. Test `online-roster.test.ts`.

Other notes this round:
- **Known side effects.**
  - A patch move shifts render space by about 40 m in one frame. Camera-only velocity (TRAA) sees one frame of wrong motion, a possible one-frame smear. Resetting history on `siteVersion` needs `visuals/module.ts` (not mine).
  - The re-centre build is about 50k plot queries in 1 ms slices, plus one ~0.3 MB cell upload at commit. It was not profiled on a real GPU.
  - Look-dev `?scene=dust` captures now show the un-mirrored ground (view poses have z negated), so earlier dust-scene goldens or screenshots may differ.
- **Processes.** Vite on :5471 and :5472 is stopped, and no Playwright or vite processes are left (checked).
- **Final check.** tsc exit 0. vitest `boot-wiring`, `online-roster`, `launch-policy` and `solo-prediction`: 4 files, 38/38.
- **Not run.** `pnpm verify`, real GPU / WebGPU, perf, visual review.

## Round 3 (terrain + dust default path; status updated as steps finish)
- Plan: (a) sphere-to-plot dust lookup in the terrain TSL material; (b) one combined scene (terrain + dust layer + follow); (c) moon-centred camera mapper; (d) worker + predictor on the height cube; (e) launch-policy switch, worksite stays default until measured on this machine's UHD 620 (off-screen Chrome).
- **Status: PAUSED on the owner's request, half-done and not wired.** The default is unchanged: the working flat worksite with follow.
  - Checks: tsc exit 0. vitest `boot-wiring`, `launch-policy` and `src/terrain`: 4 files, 44/44.
  - No processes left running.
  - Nothing new was run in a browser this round.
- **Done (compiles; no runtime effect yet):**
  - `terrain/terrain-scene.ts`: new options `asset?: Promise<TerrainAsset>` (shares one load with the Solo host) and `poseCamera?: boolean`. With `false`, the views and fly paths leave the camera alone and the sun is read in Boreal's frame. Defaults keep `?scene=moon` as before.
  - `visuals/dust/flat-lookup.ts`: `sourceLevel0`, the same taps with explicit level-0 atlas samples, so they can run inside a TSL `If`.
  - `visuals/dust/dust-worksite.ts`: `DustSiteFollow` is now `{ avatar, frame? }` with a `DustSiteFrame` type. `boot.ts` passes `frame: mapper`, and the flat worksite follow behaves as before.
  - `app/launch-policy.ts`: switch `GAME_GROUND_DEFAULT = "flat"`, `wantsTerrainGame(search)` (`?ground=terrain` / `?ground=flat`), `GAME_TERRAIN_SCENE_ID = "moon"`, and `gameModuleSearch(search, terrain)`. `wantsTerrainGame` is not called anywhere yet.
- **Half-done (written, unused, untested):**
  - `visuals/dust/terrain-dust.ts`: `TerrainDustGround`, which owns the atlas, replay and flat lookup.
    - `regolithLayer` is the terrain `RegolithLayer`. It projects each fragment gnomonically onto the site plot's tangent plane, giving lookup (x, z) = (u, -v), using precise camera-relative `local` plus a CPU-double `camToSite` uniform. Inside the ±112 m square it does 8 fetches in a branch. It outputs thickness, berm slope converted to the regolith's projection plane, and a polish albedo.
    - Follow: residency is centred on the avatar. Re-centres are built in 1 ms slices and swapped at once, with no render-space move.
  - `app/terrain-game.ts`: `MOON_CENTRED_MAPPER` (identity `RenderMapper`), `SharedGround` (the predictor's ground, delegating to `GroundHeight`), `groundOptionsOf`, `terrainHostOptions(asset)` (cube copy, layout, ground, bake hash), and `TERRAIN_GAME_STORAGE_PREFIX` (separate Solo identity while opt-in).
- **Next steps for the terrain item, in order:**
  1. `visuals/materials/terrain-regolith-provider.ts`: accept extra `layers` (constructor option) and pass them into `createTerrainRegolithMaterial`.
  2. `visuals/module.ts`: for scene `moon` with `options.dustFeed`, build `TerrainDustGround` first and give the regolith provider its `regolithLayer`. Build `TerrainScene` with `poseCamera: false` and `asset: options.terrainAsset` (new option). In `update`, call `ground.preRender(renderer, camera)` (as for `this.dust`). Also call `bindRenderer` and `dispose`, and report `dustAtlas` and `dustFeed` in `info`. `setDustFeed` stays a no-op there (online on terrain is not supported yet).
  3. `app/boot.ts`, when `wantsTerrainGame`:
     - start `loadTerrainAsset({ baseUrl: "/assets/terrain/" })` at boot;
     - module search with `scene=moon`;
     - dust feed with `follow: { avatar }` and no frame;
     - gameplay `mapper: MOON_CENTRED_MAPPER` and `ground: sharedGround`;
     - once the asset is in: `sharedGround.ground = new GroundHeight(asset.cube, groundOptionsOf(asset))`, then `startHost()` with `hostOverrides: terrainHostOptions(asset)` and the prefixed identity;
     - no checkpoint sync while opt-in.
  4. Tests:
     - a unit test that `regolithLayer` builds;
     - a CPU twin of the projection (u, -v) checked against `fromPlotLocal`;
     - `wantsTerrainGame` cases;
     - boot source assertions.
  5. Browser:
     - headless smoke with `?ground=terrain`: strokes reach the sim, dust is visible on the terrain, follow re-centres, the Induction steps advance;
     - then off-screen headed Chrome on this machine's UHD 620 at Medium: frame-time p50/p95 against the flat worksite and `?scene=moon`.
     - Flip `GAME_GROUND_DEFAULT` to `"terrain"` only if within budget; drop the identity prefix then (old saves are archived on the bake-hash change; the owner has accepted this).
  6. The one-frame view shift on re-centre is moot on terrain (render space is moon-centred and does not move); on the flat worksite it remains (TRAA history reset needs `visuals/module.ts`).

Tests this round: `tsc` exit 0. vitest on `online-roster`, `launch-policy`, `boot-wiring`, `solo-prediction` and `dust-replay`: all pass except `dust-replay` "keeps the main-thread cost of a frame inside the millisecond budget". That test's atlas `frame()` p99 was 1.17 to 1.58 ms against a < 1.0 bound. It is a timing test of `tile-atlas.ts`, which is unchanged; STATUS already lists this tail latency for W3-T02. Two other atlas tests timed out only under parallel load and passed alone.

## Resume 2026-11-17 (terrain worker)
- In progress: completing opt-in terrain/dust composition and shared cube prediction/worker wiring. Flat remains default pending measured UHD 620 evidence.
- Not run yet: focused tests, browser smoke, hardware performance. No processes started.

### Resume implementation checkpoint
- DONE in source: opt-in `?ground=terrain` builds one CDLOD terrain scene with the dust regolith layer, atlas replay, avatar residency and sliced recentring. Renderer bind/rebind/disposal and dust info hooks are included.
- DONE in source: one decoded terrain asset supplies the scene, main-thread `SharedGround` predictor and copied transferable worker cube; identity is separately prefixed and cloud checkpoint sync disabled while experimental. Online entry explicitly rejects this experiment because the online host remains flat.
- Fixed latent projection defect: use exact grid normal/east/north axes instead of finite differences (the latter included radial skew). Added height-invariant sphere projection tests at poles and cube seams. Fixed `moon` scene ownership in launch policy so moon no longer includes smoke/starts an unintended Solo host.
- Current checks: client tsc exit 0 before the last added terrain-game test; projection/layer and launch tests passed. First combined boot-wiring test run had a 60 s dynamic-import timeout under contention plus two stale whitespace/source assertions; assertions corrected, rerun pending.
- NOT RUN yet: browser compile/play smoke, WebGPU/WebGL2 parity, actual clean-trail visual review, real UHD 620 terrain-vs-flat budget. Profiler owns GPU lane; waiting for handoff. No browser/server started by this worker. `GAME_GROUND_DEFAULT` remains flat.
- Half-done validation paths: `terrain-dust.test.ts`, `terrain-game.test.ts`, `boot-wiring.test.ts`; implementation paths are wired but browser shader compilation remains unverified.

- Focused final validation: 32/32 tests passed (launch-policy, boot-wiring, terrain-game, terrain-dust); tsc exit 0 including terrain-game tests; ESLint exit 0. Follow-up review added a positive-facing hemisphere guard so the antipode cannot sample the local dust patch. Browser smoke script prepared in TEMP; still no server/browser started.

### Final terrain worker handback (2026-11-17)
- Headless WebGL2/SwiftShader functional smoke PASS at `?ground=terrain&perf=1&backend=webgl2&preset=low&audio=0`, 640x360. Worker local/running, 74 tool inputs, 62 chains acknowledged and 62 strokes applied/forwarded/replayed, 2 resident atlas tiles, 1 lookup recentre, 676 g collected, 0 decode errors, 0 ledger growths, 0 page/console errors. Terrain shader compiled and terrain visibly rendered. Normal warnings only (software ReadPixels stalls and font preload).
- First smoke at 960x540 proved boot/movement but missed tool input because the click had not settled pointer lock; second smoke waited for lock and demonstrated the full stroke path above. No performance conclusion from software rendering. Stationary prediction correction ~0.00021 m; moving maximum 0.43 m during software-rendered stalls is not a real-device feel result.
- Evidence: `C:/Users/caseyn/AppData/Local/Temp/moon-terrain-resume.json`, `.png`, and `moon-terrain-resume-smoke.cjs`. Screenshot inspected; proves terrain presence, not final clean-trail visual acceptance.
- All started processes stopped: Vite :5481 exited, no listener remains, no Playwright Chrome process remains. GPU/browser lane returned to lead for character capture.
- Remaining NOT RUN / gates: WebGPU game shader smoke, native-resolution trail/contact visual and motion acceptance, terrain-vs-flat real UHD 620 Medium frame budget, long-distance recentre/restore and full induction on terrain. No `pnpm verify`. Flat remains default. This completes opt-in functional wiring, not W3-T05 final visual/performance acceptance.
- Source paths completed: `visuals/module.ts`, `visuals/materials/terrain-regolith-provider.ts`, `visuals/dust/terrain-dust.ts`, `app/boot.ts`, `app/launch-policy.ts`; tests in corresponding app/dust locations. Existing `app/terrain-game.ts` is now used. No half-wired source paths remain for the experiment; hardware/default-flip acceptance remains deliberately open.
