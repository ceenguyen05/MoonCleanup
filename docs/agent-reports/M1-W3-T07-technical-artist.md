# M1-W3-T07 First-playable art: blockout custodian, Desk Duster v0, grains v0

Task / status: **in-review** (deliverables built and captured on WebGPU; WebGL2 and review not run) / 2026-11-16 / technical-artist / Opus 5.5 High
Machine: i7-8650U + UHD 620, Windows 11, headed Chrome off-screen, 1280 x 720, DPR 1, Medium, Node 26.13.1. No git.

## Done
- **Blender kit** `tools/asset-pipeline/src/blender/ctm_blockout.py`: parametric shells (superellipsoid, loft, torus, patch). Each face carries a material slot and a rigid part id in glTF COLOR_0 (R = slot/15, G = baked AO, B = part/15). Both ids decode exactly after 8-bit quantisation. The material uses no textures.
- **Custodian** `assets/models/characters/blockout/custodian_blockout.py`:
  - Size: 1.857 m tall; helmet 0.40 x 0.36 m, so **4.64 helmet-heights** (art-direction 4.1). Shoulders 0.61 m with pauldrons.
  - LOD triangles: **5504 / 3072 / 1876 / 560**.
  - Material slots: suit ivory, teal bellows, graphite, steel, hazard yellow (0.26 % of area), smoked visor (no LED eyes) and Clip Light lens.
  - Player colour (16 slots): crown ring, shoulder plates, pack strip, Dust Cell window.
  - Sockets: hand R/L, name tag, lamp, plus 8 limb pivots.
- **Desk Duster v0** `assets/models/tools/blockout/desk_duster_v0.py`:
  - Comically tiny handled brush (17.8 cm): wood, brass ferrule, graphite tufts. Origin is the grip; `socket_contact` sits at the bristle tips.
  - LOD triangles: 1056 / 300 / 144.
- **Pipeline:**
  - Assets added in `assets.ts`, budget classes `custodianBlockout` and `handTool` in `budgets.ts`.
  - `io.ts` now uses `prune({ keepLeaves: true })` so socket empties survive. Rock and module outputs have no leaves, so they are unchanged.
  - Built to `apps/client/public/assets/blockout/`: custodian 135 KB, duster 20 KB, plus `manifest.json` with `placeholder: true` and `replaceBy: M1-W4-T07`.
  - `assets:check` **PASS**, with 1 warning: the duster LOD0 is under the 1.5k advisory minimum.
- **Runtime** `apps/client/src/visuals/characters/blockout/`:
  - `BlockoutCast.load()` reads the manifest and lazy-imports GLTFLoader + meshopt. It dequantises the geometry and creates one shared TSL `MeshStandardNodeMaterial`.
  - The material has per-object uniforms (player colour, lamp, limb angles). The vertex stage rotates the limbs (normals too; shadows follow). AO applies to indirect light only. There is no compute, so the material runs on both backends.
  - `spawn(i)` returns a `BlockoutCustodian` with a three-level hierarchy (`object` > yaw > body), `handAnchor` (follows the forearm; holds the duster LOD), `nameTagAnchor` and `lampAnchor`.
  - `CustodianMotion` is allocation-free. It handles turn-to-velocity, low-g lope bob (g·T²/8), lean/roll and counter-swinging limbs, plus a Desk Duster scrub when `toolActive`.
- **Grains v0** `apps/client/src/visuals/vfx/grains/`:
  - `GrainPool` is a CPU ring buffer with a seeded `emitStroke` (0.5–1.5 m/s, 20–60°, 1–3 cm, 15 % glints) and tangent-plane landing. `sample()` exposes the telemetry for VT-M1-16.
  - `GrainLayer` draws one instanced call with a closed-form parabola on the GPU, velocity-stretched round quads and a 2 px minimum. Grains are lit as spheres by the scene lights, have coverage alpha and vanish 0.1 s after landing.
- **Lab:** `verify/index.html`, `page.ts` and `run-lab.mjs` run the real Render + Visuals modules on `?scene=typical`.
- **Licence rows:** 2 rows added to `ASSET_LICENSES.md`.

## Evidence (`docs/agent-reports/M1-W3-T07-evidence/`; WebGPU, Medium)
| Item | Result |
| --- | --- |
| VT-M1-35 turntable (placeholder bar) | `webgpu/tt-{noon,night}-{0..315}.png`: 8 views x noon (sun 38) + night-near (sun -6). Real shader, sun rig and post |
| VT-M1-18 32 px silhouette | `webgpu-b/px32-crop-{200,290,20}.png`: 32.3–32.4 px tall at 44.6 m; reads as a person with a helmet. 4.64 helmet-heights |
| VT-M1-19 player colours | `webgpu-b/lineup-{day,night}.png` at 12 m. Colours read on the crown and plates; faint at night. The 50 m check was not run |
| VT-M1-16b grain read | `webgpu-b/stroke-grains*.png` vs `stroke-nograins*.png`: 28 grains tracked, 27 visible, 27 at ≥ 15 luma (share 1.0) at 0.4 s. Noon, clean ground. Grime ground not measured |
| VT-M1-16 ballistics | `grains.test.ts`: apex and range exact to x(t); gone ≤ 0.15 s after landing. 12-frame sequence `stroke-seq-*.png` |
| Motion | `webgpu-b/walk-0..7.png` (lope). Bob, swing and turn covered by unit tests. No clip review (RF-03 needs W5-T04) |
| Tests / static | vitest `visuals/characters` + `visuals/vfx` **14/14** (the GLB is loaded in node). Pipeline vitest 11/11. `tsc` clean (client, asset-pipeline). eslint clean. Prettier clean |

## Deviations / decisions
- **Desk Duster shape.** It is a handled brush, following the naming bible ("Tiny handled starter brush", "wood and brass") and REFERENCE_TARGET (toothbrush allowed). This conflicts with art-direction 5.3 and VT-M1-20, which ask for a palm puck. Lead/docs-keeper: please align those two rows.
- **No compositing after AA.** Grains render in the scene pass under `roots.vfx`. `GrainLayer.layerScene` exists, but the look-stages hook is not mine.
- **Ground hit.** It uses the tangent plane on both backends (CPU path), not the height-texture compute.

## Not run / open
- WebGL2 captures.
- Night stroke and the grime-ground grain contrast.
- Perf numbers: frame and GPU ms with 16 custodians, grains upload cost.
- Visual-QA and code review.
- The `pnpm verify` run.

## For integrator (W3-T05)
- Replace the gameplay capsule with `cast.spawn(slot)`. Set `object` to the feet position and tangent frame, feed `input.vx/vz/toolActive/airborne` each frame, and call `update(dt)`.
- Call `grains.pool.emitStroke` on stroke events and `grains.update(dt, renderer)` each frame.
- Known gap: the v0 arm does not reach the ground. The lab emits grains 0.55 m ahead of the feet.

## What M1-W4-T07 must replace
Production suit mesh, rig and clips (the vertex-shader limbs become skinning). Texture-driven slots (base / ORM / player mask) in place of the per-slot constants. Production T1–T4 tools. Dust patina, the face behind the visor, and the Crown Lamp levels.

## Files
`tools/asset-pipeline/src/blender/ctm_blockout.py`, `tools/asset-pipeline/src/{assets.ts,budgets/budgets.ts,gltf/io.ts}`, `assets/models/{characters,tools}/blockout/*.py`, `apps/client/public/assets/blockout/**`, `apps/client/src/visuals/characters/blockout/**`, `apps/client/src/visuals/vfx/grains/**`, `docs/ASSET_LICENSES.md` (2 rows), evidence folder.
