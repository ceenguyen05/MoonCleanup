# M1-W5-T03 outpost + moments real-GPU acceptance (technical-artist, 2026-11-18)

Status: PARTIAL. Outpost WebGPU look-check done. Moments shader NOT yet GPU-verified. WebGL2 fallback NOT yet verified. No source changes made.

## Verified (real UHD 620, headed Chrome off-screen, Medium, dynres=off, flat Solo, WebGPU backend)
- KTX2 transcode works on the real GPU: 13 placements built; embedded textures are CompressedTexture, format 36492 (BC7/BPTC), 1024x1024.
- Console: 0 errors, 0 warnings (excluding powerPreference/font-preload noise) on the WebGPU run.
- Look: overview capture shows counter at centre, four plates with gates, four masts; matte white/teal hardware with correct shadows, scale plausible vs avatar-sized plates. Gate "rail" bar beside each plate reads slightly odd (not changed).
- Cost: frame p50 20.7 ms (outpost visible) vs 21.3 (hidden) vs 21.1 (visible again): inside noise on a loaded machine. Triangles/frame +16.7k (159,515 vs 142,827). HUD draws: 45 (default view, hardware off-screen) vs 66 (overview, all in view): up to +21 draws.
- Not seen: in default spawn camera no hardware is in frame (camera looks away from the outpost); Codex's earlier capture did show it.

## Not verified / defects open
- Sell-point alignment measured only by Codex's unit tests, not by a world-space probe on GPU.
- My camera-override helper only applied the first override in the first run (screenshots 2 and 3 duplicated the overview); fixed in script, rerun pending.
- Moments: first runs had no `window.__momentsKit` (hook via route-patch of visuals/module.ts missed; script now logs `modHit`). Shader never compiled yet, so no pass claimed. Static read of moments-layer.ts found no obvious TSL misuse.
- WebGL2 (`&backend=webgl2`): first run failed in my measurement step (`__outpostCapture` undefined), cause unknown (possible page reload on fallback; script now logs navigations).

## Tools / commands
- Own vite: `node apps/client/node_modules/vite/bin/vite.js --port 5391 --strictPort --host 127.0.0.1` (pid in Temp/claude/vite5391.pid; to be stopped at the end).
- Capture: scratchpad `cap.mjs <webgpu|webgl2>` wrapped by `run.sh` (takes `gpu.lock`, runs both backends, `rmdir`s lock). Screenshots in the scratchpad `shots/` dir.
- Focused tests (Node 26): `vitest run src/visuals/outpost src/visuals/vfx/moments` = 4 files, 20 tests pass.
- GPU lock was held by another lane for about 45 minutes, which cost most of the turns.

## Left
Rerun capture (queued in `run.sh`, waits on lock) for moments + WebGL2 + counter/gate close-ups; fix defects in `visuals/outpost` / `visuals/vfx/moments` if found; update this report.

## UPDATE 2 (same day): captures completed

Harness: scratchpad `outpost-gpu/cap.mjs` + `run.sh` (takes and releases gpu.lock; vite :5391 stopped). Screenshots in scratchpad `outpost-gpu/shots/` (1280x720, Medium, flat Solo, both backends). The earlier shared scratchpad files were overwritten by another lane; this subfolder is the valid set.

Verified:
- WebGPU and WebGL2 fallback both render the outpost (13 pieces, KTX2 BC7 textures, no errors). Counter and gate close-ups look correct (counter sits on ground with shadow, plate and gate frame placed, masts upright). Only warning: "pipelines created after warm-up" (lazy first draw).
- Frame cost: WebGPU p50 21.0 visible / 20.6 hidden / 21.7 visible (noise); WebGL2 16.7 / 16.6 / 16.6. Draws 45 (default view) -> 66-67 with outpost in view.
- Moments TSL material compiles on WebGPU and WebGL2 with no errors. Stamp outline sweep + emblem + glow visible on both; grains draw.

DEFECT FOUND AND FIXED: moments quads were invisible on both backends. The ground-flat quad winds clockwise seen from above (corner.y maps to world z), so FrontSide culled it. Fix: `m.side = DoubleSide` in `apps/client/src/visuals/vfx/moments/moments-layer.ts`. Moments tests 16/16 pass.

Remaining: pour flash and Railshot glow quads not seen in a shot (short-lived; only Stamp captured). Emblem is flat blown-out white (radiance 2.5), not changed. Sell-point alignment on GPU still only unit-tested. Default spawn camera shows no hardware. Stamp timing not measured (slow dt on loaded UHD 620).
