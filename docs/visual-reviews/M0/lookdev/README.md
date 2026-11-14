# M0-W3-T03 look-dev v0 captures

Native 1280x720, DPR 1, `?capture=1` stepped frames, headed Chrome on the Intel UHD 620 laptop (gpu lane). No Tier A/B claim.
Folders: `webgpu/` (S01, S05, S06 views), `webgl2/` (same scenes, forced `backend=webgl2`, Medium), `vt04b/` (S05 at sun 60/15/4/1 deg:
post, boulder, boots, slope views, High), `vt15/` (P4 flyover frame t=0.5 at sun 4 deg, Medium, horizon term on / off, both backends, plus
row-luma profiles), `vt16/` (noon fill probes: canopy shadow, ramp shadow, wall). File names carry scene, view and backend.

## Reproduce

The visuals module is not registered in `app/boot.ts` yet (integrator). `driver/` holds the scratch composition (`entry.ts`: RenderModule +
VisualsModule + FrameLoop + harness hooks) and the Playwright drivers. Copy `driver/` somewhere outside the repo, then:

1. `node apps/client/node_modules/vite/bin/vite.js --config <copy>/vite.config.mjs` (port 5191; edit the repo path inside the config / drivers).
2. `node run.mjs --out out --lane gpu --backend webgpu --jobs "name|query|steps;..."`, e.g.
   `"s01a|scene=s01&preset=high&time=dawn&view=a|30;s06|scene=s06&preset=high&view=pool|30"`.
   Scenes: `scene=s01|s05|s06`; S01 `time=dawn|morning|noon`, `view=a|b|wide|close|fly:<0..1>`, `earthDeg=`; S05 `sun=<deg>&az=<deg>&view=wide|post|boulder|boots|slope|wall|shade|shadeSlope&slope=away|toward`.
3. `node measure.mjs --views shade,shadeSlope,wall` (VT-M0-16 patch luma and b*), `node fly.mjs --preset medium --backend webgpu`
   (VT-M0-15 A/B; needs `terrain=/@fs/<repo>/assets/terrain/`, added by the script), `node sky.mjs <png...>` (sky block check).
