# CODEX W5-T03 outpost placement — 2026-11-18

Status: in progress. Temporary Codex worker; narrow ownership visuals/outpost. Read CLAUDE, STATUS checkpoint and owner decisions, MODEL_POLICY, REFERENCE_TARGET, and M1-W5-T03-outpost-art. No policy changes.

Scope: renderer-detected KTX2 + meshopt loading of existing authored kit; shared-resource LOD layout matching authoritative sell points; focused regression tests. Boot wiring is owned by lead. No GPU/browser/server work started. Visual acceptance remains NOT RUN.

## Implemented

- `apps/client/src/visuals/outpost/assets.ts`: manifest-driven existing GLB load, meshopt decoder, renderer-detected KTX2 loader (two workers), Vite-emitted local Basis JS/WASM from installed three revision, worker disposal after load, all twelve LOD validation, export/quantization transforms preserved, shared geometry/material/texture disposal.
- `apps/client/src/visuals/outpost/view.ts`, `index.ts`: 13 authored hardware placements (counter, four plates exactly on authoritative sell points, gates 2.6 m outward facing inward, four diagonal masts), three distance LODs, shadows, mapped placement updated after frame recentering. Flat mode keeps hardware upright; terrain mode maps radial up.
- `apps/client/src/app/outpost.ts`: cold gameplay visuals wrapper; renderer recreation reload; late-load generation guard and resource cleanup; boundary error reporting.
- `apps/client/src/app/boot.ts`: with lead authorization after audio writer released path, lazy wrapper registered for gameLaunch with gameplay and mapper; existing VisualsModule reference remains available to feed swaps.

## Focused verification

Node 26.13.1 via `fnm exec --using=26 node` (fnm could not spawn bare pnpm; using package binaries directly).
- `node ../../node_modules/vitest/vitest.mjs run src/visuals/outpost/outpost.test.ts src/app/outpost.test.ts`: 2 files, 5 tests PASS. Actual committed GLB rejects missing KTX2 decoder; real meshopt geometry yields all twelve pieces; CPU texture decoder stub verifies all four embedded KTX2 signatures (not GPU transcode proof). Additional tests cover sale-point alignment, gate inward travel, retained export transforms, required LOD failure, deduplicated disposal, frame recentering, single LOD visibility, and load completion after shutdown.
- Initial client tsc PASS before audio integration. Later tsc found only concurrent audio-worker errors (RoomHostPublisher.set test calls and VehicleState.entityId); worker notified. Final tsc pending.
- Prettier applied to owned source paths and boot integration.

## Remaining / limitations

Real-GPU KTX2 transcode/material look and in-game placement capture NOT RUN yet (GPU owned by lead). VT-M1-21/35, VM-04, official-media comparison remain unverified. Terrain hardware uses radial sphere placement; terrain height sampling is not added, so uneven terrain contact remains a gap. Flood emissive hardware exists but no new local light rig was added. No authoritative collision changes, world-layout changes, balance changes or goldens.

No server/browser/Blender process started by this worker. No git mutations, STATUS edits, policy edits, or pnpm verify.
