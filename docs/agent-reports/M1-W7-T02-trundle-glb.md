# M1-W7-T02 Trundle authored GLB (technical-artist) - DONE (light gates)

2026-11-18. No git, no STATUS.md edits, no solo-avatar/animation/poser/compass/boot edits. Node 26 via fnm alias.
Processes: every Vite (5481) and headed Chrome I started was stopped; Blender ran only via the pipeline (exited). gpu.lock released.

## Deliverables
- Blender script `assets/models/vehicles/trundle.py` (Brightside palette: ivory body, teal frame/arms, yellow hub caps/T-bar, graphite
  tyres, smoked hopper, banded bristle drum, steel axle/hubs, white lens + amber rear lamps). Built through the pipeline:
  `node tools/asset-pipeline/node_modules/tsx/dist/cli.mjs src/build.ts --only trundle --out apps/client/public/assets/vehicles`.
- Pipeline: `assets.ts` entry, new `vehicle` budget class (8000/4000/2000 tris, pieces chassis/lamps/drum/wheels, 0 textures, 1 material,
  512 KiB). Result `trundle.37d6cdb27fd9.glb` 133,776 bytes, LOD tris [7376, 2456, 1128], assets:check PASS (0 errors, 0 warnings).
- Nodes per published spec: chassis, lamps, drum_pivot>drum, wheel_pivot>wheels (+ trundle_root). **4 meshes = 4 draws** (same as procedural,
  within the +10-12 baseline); shadow-casting only the chassis; COLOR_0 = linear albedo x vertex AO, one vertex-colour material + lens material.
- Loader `visuals/vfx/vehicles/trundle-glb.ts` (GLTFLoader + meshopt, dynamic import from `TrundlePresenter.attach` -> `upgrade()`; cold chunk,
  zero boot cost; any failure logs one warning and keeps the procedural `buildTrundle` model). Presenter edit: `parts` now mutable, `upgrade()`,
  `loadAuthored` flag. Test `trundle-glb.test.ts`; vehicles tests 5/5 pass; apps/client tsc clean.
- Ledger row `model-trundle` appended to `docs/ASSET_LICENSES.md`.
- Lab (dev-only): `visuals/vfx/vehicles/verify/{index.html,page.ts,run-lab.mjs}`, `?model=glb|procedural`, `__mcTrundle`.

## Evidence (real GPU, headed off-screen, webgpu, Medium, 1280x720 native, `typical` scene) in `M1-W7-T02-trundle-glb-evidence/`
- VT-M1-35 turntable: `tt-noon-{0..315}.png`, `tt-night-{0..315}.png` (8 views at 45 deg, noon sun 38 and night-near sun -6 with lamps on).
- Look-check: `spray-front.png` (front: 61 live drum grains flying off the drum, both head lamps lit on dark regolith) and
  `spray-side.png` (side: 67 grains, lamps, drum with yellow hub cap, wheel). Lab json `lab-webgpu.json` (model glb, meshes 4).
- Not run: WebGL2 backend capture, `?onboarding=0` in-game capture (the lab has no onboarding UI; in-game path unchanged apart from the swap), pnpm verify.

## Notes / caveats
- Only LOD0 is used at runtime (Trundle is always near); LOD1/2 exist for the pipeline chain/impostor work.
- Smoked hopper reads as a dark rounded blob (opaque, no transmission/dust inside yet); steel parts are not metallic (single material).
- Console in the lab: "7-11 pipelines created after warm-up" warnings (first-use materials in the lab, not game flow).
