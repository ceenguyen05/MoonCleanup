# M1-W3-T07 First-playable art: blockout custodian, Desk Duster v0, grains v0, animator hookup

Task / status: **paused by owner, in-review** / 2026-11-17 (round 2; round 1 was 2026-11-16) / technical-artist / Opus 5.5 High
Pause state:
- Paths compile: client `tsc` exit 0, eslint and prettier clean on `visuals/characters`.
- Every process I started is stopped (Vite on port 5291, the lab runner, headless Chrome).
- Capture coverage is listed under Evidence.
Machine: i7-8650U + UHD 620, Windows 11, Node 26.13.1 (fnm). Round 2 captures: **headless** Chrome (real GPU, WebGPU backend), 1280 x 720, DPR 1, Medium. No git.

## Round 2 (2026-11-17): the W5-T04 animator now drives the blockout

### Done
- **`rig-adapter.ts`** is the blockout's "mixer adapter".
  - `blockoutRigGeometry(custodian, duster)` reads the joints from the GLB pivots and sockets.
  - `blockoutRigProfile()` turns them into a `RigProfile` for the animator: hip 0.905 m (2.5 cm stance drop keeps the knees soft), thigh 0.425 m, calf 0.41 m.
  - `BlockoutPoser.apply(animator, custodian)` reads `AvatarPose`, the foot-IK sole targets (or the placeholder gait in far LOD buckets), and the tool layer. It writes:
    - Body: pelvis offset (gait bounce + landing compression + IK pelvis), lean and slope stance, and the tool twist, all pivoting about the hips.
    - Legs: each ankle target is moved into body space and solved with a planar two-bone, knee forward.
    - Arms: counter-swing from the legs, and a hold pose for the held tool.
    - **Desk Duster work pose.** When the custodian stands still with the tool down, it drops to hands and knees. The bristle tips are IK-pinned to a stroke point that follows the sim push/lift phase (`clipPhase`, `inContactFrac`), and the left palm is planted. When walking with the tool down, it bends over and reaches instead (a standing v0 arm cannot reach the ground).
    - Air: legs tuck and split, arms rise.
  - Optional `headLocal` / `headValid` let the sim's head point move the stroke centre.
  - The math is plain arithmetic: no three objects and no doubles passed through calls.
- **`avatar-view.ts`: `CustodianAvatarView`** replaces the gameplay capsule.
  - Per pool slot: it reads `AnimationModule.animatorFor(slot)` and lazily spawns a custodian (cold, once per slot).
  - It places the custodian at `pose.root` with the pose's tangent frame through a `RenderMapper`-shaped mapper. The basis is `up x fwd`, so it stays right-handed when the mapper is mirrored.
  - It sets `animator.rig` to the blockout profile, shows the Desk Duster for the palm class, and hides the local slot in first person (`hideLocal`).
  - It feeds `setProjectedHeight` back for the LOD buckets.
- **`custodian.ts`**:
  - `applyPose()` is public and rewritten allocation-free.
  - New `toolContact` anchor (the Desk Duster `socket_contact` under the hand) and `setToolVisible()`.
- **`motion.ts`**: new `bodyX`, `bodyZ` and `twist` joint fields. The procedural motion leaves them at 0.
- **Lab** (`verify/page.ts`, `run-lab.mjs`):
  - `lab=anim&act=idle|walk|lope|sweep|sweepwalk|jump|cycle` runs the real `AvatarAnimator` through `CustodianAvatarView`, with foot IK on the raycast lab ground. Grains come off the bristle tips at each push.
  - Deterministic frozen stepping (`state.pending`) gives 1/60 s sequences.
  - The runner is now **headless by default**: `--headless 0` gives the old off-screen headed mode, for GPU timing only.
- Removed the scratch test that broke client tsc (`blockout/__scratch/`).

### Evidence
- **vitest** `src/visuals/characters` + `src/animation`: **70/70**. New `rig-adapter.test.ts` has 10 tests, all checked by forward kinematics that mirror the material's vertex transform:
  - two-bone exactness and bend side;
  - idle: ankles on the IK targets with soft knees;
  - walking 3 s: worst ankle error < 3 cm, during the low-g hop stretch only, and the arms counter-swing;
  - Desk Duster scrub: kneel 1.0, knees < 12 cm off the ground, bristle tips < 4.5 cm through the push and lifted on the return, stroke > 12 cm, reach error < 3 cm, scene-graph contact matches the shader FK within 2 cm;
  - walking with the tool down: bends instead of kneeling; standing back up when the tool lifts;
  - air tuck;
  - the view's placement, hiding and LOD feedback.
- **Allocation.** 96,000 poses (16 custodians x 6,000 frames) after warm-up grow the heap by **4.5 KB**; the positive control grows 2.6 MB. A 600-frame window carries a constant 0.2–0.3 MB of JIT tier-up that does not scale with the window.
- **CPU.** Poser for 16 custodians, Node: p50 0.03–0.06 ms, p95 0.07–0.2 ms per frame.
- **Static checks.** `tsc -p apps/client` clean. eslint and prettier clean on `visuals/characters`.
- **Headless captures (real GPU, 1280 x 720 native, Medium, noon sun 38).** Strips are deterministic, one frame per 4 fixed 1/60 s steps:
  - **WebGPU**, `M1-W3-T07-evidence/anim-webgpu/`:
    - `anim-idle-az{120,200}-00..11.png`
    - `anim-walk-az{120,200}-00..11.png`: walk with counter-swing; the Desk Duster is held up in the hold pose.
    - `anim-lope-az120-00..04.png`: partial, cut by the pause.
  - **Desk Duster scrub.** Captured in earlier WebGPU runs today. Those files were overwritten by the re-run and not recaptured before the pause, so the only proof today is the readout below plus the unit tests.
    - Earlier frames I viewed: the hands-and-knees scrub with grains coming off the bristles reads clearly from the side and from front-left.
    - Bristle-tip height above the lab ground (from `__mcLab.anim()`): 0–9 mm in the push, about 35 mm in the lift. Reach error ≤ 1 cm.
  - **WebGL2**: walk captured in a killed run and not kept. The backend renders the custodian correctly (frame viewed: `anim-walk-az120-05`), but **no WebGL2 strip is on disk**.
- **Lab fix, important for any re-run.** Captures stalled for 20–30 s per frame, so Playwright timed out. The cause was the lab's per-probe whole-scene raycast: foot IK takes 6 probes per step, times 90 settle steps. The lab ground is now memoised on a 4 cm bilinear grid; a screenshot takes about 0.17 s.
- **Retries.** The runner retries a strip up to 4 times. Other writers' edits under `apps/client/src` make Vite full-reload open pages.

### Next steps (resume here)
1. Start Vite: `apps/client`, `../../node_modules/.bin/vite --port 5291 --strictPort` on Node 26.
2. Recapture the remaining strips headless:
   - `node apps/client/src/visuals/characters/blockout/verify/run-lab.mjs --out docs/agent-reports/M1-W3-T07-evidence/anim-webgpu --backend webgpu --parts anim --acts lope,sweep,sweepwalk,jump`
   - The same with `--az 270 --acts sweep` (front-left scrub view).
   - `--backend webgl2 --acts walk,sweep,jump` into `anim-webgl2`.
   - Run it while nobody edits `apps/client/src`, or accept the retries.
3. View the sweep and jump strips, tune `DEFAULT_POSER_TUNING` if needed, update this report. Stop Vite and Chrome.
4. Integrator hookup (below), then visual-QA and code review.

### Not run / open
- Strips not on disk: lope (partial), sweep, sweepwalk, jump on WebGPU; every **WebGL2** strip.
- In-game hookup: I don't own those files. **Integrator:**
  1. In `app/boot.ts`, bind a **Solo** `AnimInputProvider`. Today Solo leaves the pool unbound. Feed it from `SoloPredictor` state the way `RemoteAvatarFeed.fillOwn` does: pos, vel, facing, grounded, heightAboveGround, jumped, lastImpactMps. Add the tool class, active state and phase (`toolClassOf(equippedTool)`, sim stroke phase and period) and the ground (`GroundHeight.heightsAt`).
  2. Construct `CustodianAvatarView(await BlockoutCast.load(), animation, gameplay mapper)` (lazy chunk) and add `view.root` to `roots.world`.
  3. Each frame, after `AnimationModule.update`, call `view.update(dt, camera, viewportHeight)` and set `view.hideLocal = rig.mode === "first"`.
  4. Pass `placeholder: false` to `GameplayModule`, or keep its aim ring only.
- Not done:
  - No first-person held-tool viewmodel (RF "readable held tool" in first person).
  - No local-player shadow in first person.
  - No seated (vehicle) pose.
  - No models for tool classes other than palm: the duster is hidden for them.
  - Remote avatars at U2+ buckets move at the bucket rate (spec design).
- Clip sidecar foot-plant data does not apply to the blockout (procedural gait plant masks). It is needed with the W4-T07 rig and clips.
- Visual-QA and code review; `pnpm verify`.

## Round 1 (2026-11-16), unchanged
- **Assets.**
  - Blender kit `tools/asset-pipeline/src/blender/ctm_blockout.py`.
  - Custodian `assets/models/characters/blockout/custodian_blockout.py`: 1.857 m, 4.64 helmet-heights. LOD triangles 5504 / 3072 / 1876 / 560. Ivory suit, teal bellows, smoked visor, backpack, Clip Light, player-colour crown, plates and Dust Cell window. Sockets: hands, name tag, lamp, 8 limb pivots.
  - Desk Duster v0 `assets/models/tools/blockout/desk_duster_v0.py`: a tiny 17.8 cm wood-and-brass handled brush with graphite tufts. LOD triangles 1056 / 300 / 144.
  - Built to `apps/client/public/assets/blockout/`: custodian 135 KB, duster 20 KB, `placeholder: true`. `assets:check` PASS.
  - 2 rows in `ASSET_LICENSES.md`.
- **Runtime.** One shared TSL `MeshStandardNodeMaterial` with vertex-stage rigid limbs and per-object uniforms. No compute, so the same path runs on both backends.
- **Grains v0.** `visuals/vfx/grains/`.
- **Evidence** (WebGPU, headed off-screen) in `M1-W3-T07-evidence/webgpu*`:
  - VT-M1-35 turntable;
  - VT-M1-18 32 px silhouette;
  - VT-M1-19 lineup;
  - VT-M1-16 / 16b grains: 27/27 visible at ≥ 15 luma.
- **Deviation (lead/docs).** The Desk Duster is a handled brush, following the naming bible and REFERENCE_TARGET (toothbrush allowed, no palm puck required). Art-direction 5.3 and VT-M1-20 still say "palm puck".
- **M1-W4-T07 replaces:**
  - the suit mesh with a skinned rig and clips (the poser becomes a three mixer adapter on the same `AvatarPose`);
  - the per-slot constants with textures;
  - the duster with the T1–T4 tools.

## Files
- `apps/client/src/visuals/characters/blockout/{rig-adapter,avatar-view,custodian,motion,index}.ts`
- `apps/client/src/visuals/characters/blockout/rig-adapter.test.ts`
- `apps/client/src/visuals/characters/blockout/verify/{page.ts,run-lab.mjs}`
- Round 1 files as listed above
- Evidence: `docs/agent-reports/M1-W3-T07-evidence/{webgpu,webgpu-b,anim-webgpu}/`

## Resume checkpoint 2026-11-17
Review in progress. Existing blockout and animation integration remain as described above; gameplay boot hookup, first-person tool/shadow, seated pose, other tools, visual/code review and missing motion strips remain open. No server or browser started in this checkpoint. Changes are restricted to visuals/characters; boot integration belongs to the integrator.

### Current review checkpoint
- Reviewed adapter/view and existing task acceptance; no character source changes made so far. Solo binding and the other missing items above remain open.
- Node 26 focused vitest: 69/70; with the project 30 s test timeout the animator CPU test reported p95 2.649 ms vs 1 ms under concurrent work. An earlier run with Vitest default 5 s timed out in the poser performance test. These are not passes; repeat on a quiet machine. GPU capture deferred pending coordination with profiler.
- Half-done paths: existing apps/client/src/visuals/characters/blockout/{rig-adapter,avatar-view,custodian,motion}.ts; no boot.ts ownership. Missing evidence and gameplay wiring remain as listed above.

### Resume capture outcome
- Headless WebGPU runner completed with exit 0, Medium 1280x720: anim-resume-webgpu/ contains 12 frames at each of az120 and az200 for lope, sweep, sweepwalk and jump (96 PNGs total), plus anim.json and lab-webgpu.json. Viewed representative sweep and jump frames: kneeling sweep and airborne pose are readable; this is a partial visual inspection, not full RF-03 approval or integrated gameplay evidence.
- Browser console recorded a 404 resource error (URL not captured), powerPreference ignored on Windows, and repeated already-non-indexed BufferGeometry warnings. Investigate the 404 before clean-console signoff.
- NOT RUN: requested az270 sweep and WebGL2 strips, full visual/code review, quiet-machine performance repeat, integrated gameplay and final verify. No source changes in this checkpoint; prior paths remain half-done pending integration and review.
- Capture runner exited normally and Vite on 5291 was stopped; no browser or server left running by this worker. GPU returned to lead.
