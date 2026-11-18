# M1-W4-T07 Custodian suit production model + hand tools T1-T4

Task / status: **implemented; focused tests pass; VT-M1-35 turntables + 32 px + lineup captured on the real GPU (round 2)** / 2026-11-18 / technical-artist / Opus 5.5
Machine: i7-8650U + UHD 620, Windows 11, Node 26.13.1 (fnm), Blender 4.5.10. No git, no STATUS edits; app/solo-avatar.ts, rig-adapter.ts and motion.ts untouched.

## Changes
- **`tools/asset-pipeline/src/blender/ctm_production.py`** (new). It extends the blockout kit:
  - per-face skin bone (rigid, weight 1);
  - decal UVs;
  - armature, skin and GLB export (skins, UVs, COLOR_0);
  - the procedural numeral glyph atlas: 512 px, 4x4 cells holding 1-16 as a signed-distance mask, in the normal slot so it is encoded as linear UASTC;
  - shared tool helpers: the hold-pose frame and `tool_main`.
- **`assets/models/characters/custodian_suit.py`** (new): the production custodian.
  - **Joints, sockets and rigid parts are identical to the blockout** (a test checks this), so the rig profile and poser tuning carry over unchanged.
  - Added detail:
    - Holster Rig belt, buckle, clips and chest straps;
    - chest control box with yellow tabs, buttons and a Brightside badge;
    - umbilical hoses;
    - quilt ribs and 3 waist bellows;
    - helmet brow, comm pods, neck seal and Clip Light;
    - player-colour shoulder plates with curved numeral decals;
    - pack with vents, handles, antenna, Hop Pack bells and the player strip;
    - Dust Cell with steel caps, a level band and the player window;
    - hip rings, thigh pocket, knee pads, double knee and elbow bellows;
    - boots with toe cap, strap, Ballast Sole and a yellow tab;
    - four-finger gloves with thumb, gauntlet and palm grip.
- **Tools** (`assets/models/tools/`): `desk_duster.py`, `crescent_squeegee.py`, `bristle_broom.py`, `lane_broom.py`.
  - **Desk Duster:** wood and brass handled brush, 17.8 cm. **Same grip and contact socket as v0**, so the scrub IK is unchanged.
  - **Crescent Squeegee:** ivory crescent with a teal inlay, black rubber blade 0.28 m, orange grip.
  - **Bristle Broom:** aluminium shaft, graphite and ivory head, 26 tufts, 0.45 m.
  - **Lane Broom:** steel T-bar, ivory head 0.75 m with a teal stripe and yellow end caps.
  - Head widths follow the sim `widthM`. **Deviation:** art-direction says 1.2 m for the Lane Broom; the sim says 0.75 m.
  - Brooms are modelled in the poser's hold-pose frame, so their heads sit on the ground ahead in the hold pose.
- **Pipeline:**
  - `budgets.ts`: new class `custodian` (18000 / 8000 / 3000 / 600, at most 3 materials, 1.5 MB).
  - `assets.ts`: 5 new rows.
- **Client** (`apps/client/src/visuals/characters/blockout/`):
  - `palette.ts`: slots 13 `glyph` (player plate with numeral ink), 14 `rubber`, 15 `orangeGrip`, and `GLYPH_INK`.
  - `material.ts`: optional glyph atlas. A per-object cell from `shading.glyph`, then smoothstep on the SDF, only on glyph faces. The blockout path is unchanged.
  - `assets.ts`:
    - `extractAsset` restores the skinned bind pose with `applyBoneTransform`. **glTF-Transform quantize moves the dequantisation of skinned meshes into the inverse bind matrices**, so the node transform is identity.
    - It also adds a uv attribute (zeros if missing) and picks up the glyph texture.
    - New `loadProductionAssets(renderer?)`: KTX2 with the local basis transcoder. Without a renderer it transcodes to RGBA8.
  - `index.ts`:
    - `BlockoutCast.load()` now loads the **production suit and tools first, and falls back to the blockout** on any error (with a warning).
    - Passing an explicit `base` or `production:false` loads the blockout only.
    - New fields `cast.tools` and `cast.production`.
  - `custodian.ts`: held-tool LOD per tool class; `setTool(class, visible)` swaps the model and the contact socket with no allocation; `setToolVisible` is kept; `setPlayer` sets the glyph cell.
  - `avatar-view.ts`: shows the model of the animator's tool class (previously the palm only).
  - `verify/page.ts`: lab parameter `tool=1..4`.
  - `production.test.ts` (new, 5 tests).
- `docs/ASSET_LICENSES.md`: 2 rows (source, web).
- Boot needed no change: `boot.ts` already calls `BlockoutCast.load()`, so Solo picks up production with the blockout as fallback. Optional for the integrator: pass `renderer` so KTX2 picks a GPU block format.

## Rig / skeleton spec (for W5-T04)
- **16 joints:** `root > pelvis > spine > head`; `spine > upperarm_{L,R} > forearm_{L,R} > hand_{L,R}`; `pelvis > thigh_{L,R} > shin_{L,R} > foot_{L,R}`.
- **Joint positions** (glTF metres, Y up, facing +Z; L is +X):
  - hip ±0.105 / 0.93 / 0
  - knee ±0.118 / 0.505 / 0.015
  - ankle ±0.12 / 0.17 / 0
  - shoulder ±0.222 / 1.36 / 0
  - elbow ±0.252 / 1.10 / 0
  - wrist ±0.262 / 0.875 / 0.03
  - pelvis 0.93, spine 1.05, head 1.46
- **Influences:** 1 per vertex, weight 1 (rigid suit segments with ball-joint bellows).
- **Runtime part mapping:** COLOR_0.B part is body (pelvis, spine, head), thigh, shin (shin, foot), upper arm, forearm (forearm, hand). The present runtime is the vertex-stage rigid TSL path, and the skin agrees with it in bind pose.
- **Sockets:**
  - `socket_hand_{L,R}` (30 deg about X; the tool frame);
  - `socket_nametag` at 2.08 m;
  - `socket_lamp`;
  - `pivot_*`;
  - each tool has `socket_contact`.
- **Note:** quantised IBMs differ per LOD mesh (3 skin copies in the GLB).

## Measurements
- **Custodian:**
  - LOD triangles 17212 / 7968 / 2768 / 560.
  - 1.861 m tall, 4.65 helmet-heights.
  - Area shares: hazard 0.2 %, suit 47 %, graphite 24 %, teal 12.5 %, steel 4.7 %.
  - GLB 404,564 B, including the KTX2 UASTC glyph atlas (82 KB).
- **Tools** (LOD triangles, GLB size):

| Tool | LOD triangles | GLB |
| --- | --- | --- |
| Desk Duster | 2472 / 600 / 168 | 44 KB |
| Crescent Squeegee | 2856 / 744 / 196 | 44 KB |
| Bristle Broom | 2736 / 792 / 156 | 41 KB |
| Lane Broom | 2576 / 776 / 192 | 48 KB |

- Total new download: about 0.62 MB, plus the basis transcoder that the outpost also uses.

## Commands / results (Node 26)
- **Asset build** (in `tools/asset-pipeline`), for `custodian_suit` and each tool:
  - `node node_modules/tsx/dist/cli.mjs src/build.ts --only <id> --out ../../apps/client/public/assets/{characters|tools}`
  - Result: `assets:check` **PASS** for both directories.
- **Focused tests** (in `apps/client`):
  - `node ../../node_modules/vitest/vitest.mjs run src/visuals/characters src/animation`: **76/76 PASS** (6 files).
  - The new tests prove: skinned bind-pose height; feet at 0; at most 64 joints with the published names; joints and sockets equal to the blockout; glyph UVs; tool budgets, widths and contacts; per-class tool visibility.
- **Static checks:** `tsc -p apps/client --noEmit` clean; eslint on `src/visuals/characters` clean; prettier applied.
- No Blender process left running (tasklist checked).

## Look-check (real UHD 620, WebGPU, headless Chrome, Medium, 1280x720, dynres off, gpu.lock held)
- **Setup:** lab page `lab=anim&act=idle|sweep&tool=1..4`, captured by the scratch script `tools-shots.mjs`. Vite ran on 5291 and was stopped afterwards; the lock was released.
- **Frames:** `docs/agent-reports/M1-W4-T07-evidence/` holds 11 PNGs (`tool{1-4}-az{120,250}`, `face-az180`, `shoulder-glyph`, `sweep-az250`).
- **No page errors.** The only console warnings are the known powerPreference and toNonIndexed ones.
- **Viewed:**
  - `shoulder-glyph.png`: P12 pink plate shows a crisp "12". The KTX2 atlas decode, cell lookup and orientation are correct.
  - `tool3-az120.png`: the suit reads as a slightly stylised EVA custodian, with the harness, teal bellows, knee pads, boots, pack and antenna visible. The Bristle Broom shaft runs from the glove to its head on the ground ahead.
  - `tool4-az250.png`: Lane Broom on its T-handle, with the wide ivory head and yellow cap flat on the ground.
- **Look issues:**
  - The Crescent Squeegee reads weakly in third person: a thin dark crescent, edge-on, with the orange grip hidden inside the glove. **It needs a thicker holder or a hold angle that shows the blade face** before VT-M1-20.
  - The broom head sits a bit far ahead in the idle hold.
  - Hands are open (no grip pose; animation owner).
- **Not compared** with official reference media (RF-01).
- This look-check is not a VT-M1-35 PASS.

## Not run / open
- **VT-M1-35 turntables at 1080p (8 views, noon and night-near)** for the custodian and each tool: not captured. Run `run-lab.mjs --parts turntable,px32,lineup` (now loads production), plus tool shots with `tool=1..4`.
- Crescent Squeegee silhouette fix (see the look-check above). The sweep frame (`sweep-az250.png`) was captured but not reviewed in this pass.
- The rubber and orangeGrip slots have no Blender palette report for the squeegee yet; turntable palette shares are not measured.
- Animation for non-palm tools: the poser only has the Desk Duster work pose. Other tools sit in the hold pose (broom heads on the ground ahead) and do no stroke. The left hand is not on the broom shafts. **Owner: animation-engineer (W5-T04).**
- No first-person held-tool viewmodel (unchanged from W3-T07).
- Art-direction 5.3 and VT-M1-20 say "palm puck, no handle" for the Desk Duster. We keep the handled brush per the naming bible and REFERENCE_TARGET (toothbrush allowed) and the W3-T07 decision. Lead/docs should reconcile.
- No procedural fabric weave or dust patina in the material; texel-density bar is not applicable (slot colours, no albedo texture). **This deviates from the art-direction 9 texture set (2048 base/ORM/normal); lead to accept or schedule.**
- `pnpm verify`: not run (light gates).

## Round 2 (lead decisions + fixes, 2026-11-18)

### Lead decisions recorded
- **Lane Broom stays 0.75 m.** Game data (`tools.json` widthM) is authoritative. The art-direction 5.3 figure of 1.2 m is **superseded**.
- **Desk Duster stays a handled brush**, per the naming bible and REFERENCE_TARGET. Art-direction 5.3 and VT-M1-20 ("palm puck, no handle") conflict with this; the lead will have the docs reconciled.
- **The flat-colour suit is accepted for M1.** The base/ORM/normal texture set (art-direction 9) and the texel-density bar (13.3) are an **open item scheduled for W9-T01 (visual V1)**.

### Fixes
- **Crescent Squeegee** (`assets/models/tools/crescent_squeegee.py`):
  - Holder radius 11 to 19 mm; rubber blade 5.5 to 9 mm; teal inlay and clips enlarged.
  - The orange grip is longer (now runs 0.14 m back from the glove) and thicker, so it shows behind the glove.
  - Contact socket moved to the new blade edge.
  - LOD triangles 2904 / 768 / 196.
- **Idle broom heads pulled back toward the custodian:** the Bristle Broom head is 0.14 m closer (y -0.56 to -0.42), the Lane Broom 0.16 m closer (-0.62 to -0.46). The shafts are steeper and the contact sockets follow.
- Rebuilt: `assets:check` **PASS** for 4 tools. `vitest src/visuals/characters` **24/24** (the production tests included).

### Captures (real UHD 620, WebGPU, headless Chrome, Medium, 1280x720, dynres off)
- **Lab captures:** `run-lab.mjs --parts turntable,px32,lineup` (frozen stepping, `freeze=1`) wrote to `docs/agent-reports/M1-W4-T07-evidence/lab-webgpu/`. The lab now loads the production cast.
  - Turntable `tt-{noon,night}-{0..315}.png`: 8 views at 45 deg, noon and night-near.
  - `px32-{crop,full}-{20,200,290}.png`: measured 32.3-32.4 px at 44.6 m.
  - `lineup-{day,night}.png`: all 16 player colours.
  - `lab-webgpu.json`.
- **Tool frames:** `tools-shots.mjs` re-captured `tool{1-4}-az{120,250}.png`, `face-az180.png`, `shoulder-glyph.png` and `sweep-az250.png` in the same folder.
- **Console:** only the known powerPreference and toNonIndexed warnings; no errors.
- **Process cleanup:** gpu.lock was held only for the captures and removed right after. Vite on 5291 is stopped. No Blender is running.

### Frames viewed
- `tt-noon-45.png`: the production suit reads cleanly at 3.5 m in noon light. Visible: player crown ring and plates, harness and chest box, teal bellows, knee pads, Ballast Soles, pack. Smoked visor with no LED eyes; the Earth backdrop is consistent.
- `px32-crop-200.png`: the silhouette is identifiable at 32 px (helmet, pack, legs).
- `lineup-night.png`: 16 custodians with their crown and plate colours visible at night-near. Telling all 16 apart at 50 m (VT-M1-19) was **not measured**, only viewed at 12 m.
- `tool2-az250.png`: the squeegee is now readable as a dark crescent head plus an orange grip below the glove. **It is still small and edge-on from the side.** It is better than round 1 but marginal for VT-M1-20 "identifiable in third person". A follow-up could be a hold angle that turns the blade face to camera; that is a tool-frame or hand-rotation change.
- `tool3-az120.png`: the Bristle Broom head now sits closer, under the reach line.

### Still open
- **VT-M1-35 formal bar:** palette shares, the at-least-24-segments check, bevel highlight and texel density are not measured by a harness. The turntables exist for visual-QA review; **no PASS is claimed**.
- **Texture set and texel density:** W9-T01 (accepted deferral).
- **Animation for the scrub agent / animation-engineer:**
  - stroke poses for the Crescent Squeegee, Bristle Broom and Lane Broom (only the Desk Duster has a work pose);
  - a closed-hand grip;
  - the left hand on the broom shafts and the Lane Broom T-bar;
  - a first-person held-tool viewmodel.
- **Squeegee silhouette:** possibly a hold-angle follow-up.
- Not run: the WebGL2 strips of these captures; RF-01 comparison with official reference media; `pnpm verify`.
