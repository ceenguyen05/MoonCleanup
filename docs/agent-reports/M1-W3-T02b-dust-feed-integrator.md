# M1-W3-T02b Dust atlas stroke feed from the Solo host (integrator)

Task / status: **implemented; tests and one browser run pass; ready for review** / 2026-11-15 / integrator / Opus 5.5
Node 26.13.1 (fnm PATH prefix), i7-8650U + UHD 620, Windows 11, Chrome (Playwright, headed, `channel: chrome`). No git. Dev server on port 5191, stopped afterwards; no browser left running.

## What is wired

The game's own strokes now reach the dust atlas: worker sim -> FRAME -> main-thread ledger view -> `atlas.onStroke` -> GPU replay -> regolith shader, in `?scene=dust`.

- **Ledger view** `apps/client/src/sim-host/dust-view.ts` (`SoloDustView`, exported from the sim-host barrel). It holds a `WorldDustLedger` built like the worker's (`createRoomDustLedger`, same game data, grid and attributes, plus ledger-zero events). Each host FRAME is decoded with the protocol `FrameReader`, which is the same decode path as a server room. Each stroke goes to the ledger with `applyStroke`, then to the target with `onStroke`, followed by `onLedgerZero` and `onPolished`. The work runs in the host's frame message handler, not in the render step and not on the input path.
  - **No per-frame allocation:** the frame bytes are copied into a fixed scratch buffer, the exact-length views are cached once per length, the record objects and callbacks are reused, and the host frame is released right after the copy. The host now exposes the view it already builds (`frameBytes`), so no second `Uint8Array` is made.
  - **Checkpoint restore, through the atlas rebuild path:** the worker posts its whole dust state when asked (`dustsync` -> `dust`, every non-pristine chunk, transferred). The view restores it into a spare ledger in budgeted slices (`pump()`, 1 ms), then swaps it in one step and calls `atlas.rebuildAll()`, so the screen never shows a half-restored moon. Strokes that arrive during a restore are queued and applied before the swap. The host asks again by itself after a worker reboot while a view is listening.
  - **Other cases:** if the frame encoder drops strokes, or a frame fails to decode, the view resyncs from a new dust state. If no frame renders for a long time (hidden tab), the view stops feeding live strokes and asks for a rebuild instead (`LIVE_FORWARD_CAP` 2048).
- **sim-host edits** (allowed by the brief):
  - `messages.ts`: `dustsync` and `DustStateMessage`; protocol version 2 -> 3.
  - `worker-core.ts`: `postDustState`, the deferred `dustsync` at boot, and the resync on dropped strokes.
  - `sim-frame-encoder.ts`: `dropPendingStrokes`.
  - `local-room-host.ts`: `onDustState`, `requestDustState`, `frameBytes`, `PooledFrame.view`, the `dust` dispatch, and an automatic `dustsync` on reboot.
  - The netcode-engineer edited `worker-core.ts` and `local-room-host.ts` at the same time. I re-checked that my blocks are intact and did not revert anything of theirs.
- **visuals** (`visuals/dust` was released to me mid-task):
  - `DustWorksite` takes an optional `DustFeedPort`. With a feed it uses the feed's grid and ledger (`DustLayer.create`) and calls `feed.pump()` then `layer.update()` before the main render. Without one, it runs the seeded scenario exactly as before.
  - `DUST_SCENE_SITE` and `DustFeedPort` are exported from the dust barrel and the visuals barrel.
  - `LOOKDEV_SCENE_IDS` now includes `dust` (the pinning test in `perf-pass.test.ts` is updated). `VisualsModuleOptions.dustFeed` was added. `__mcLook.info()` gains `dustFeed`, and `dustAtlas` now reads `layer.atlas`.
- **app:**
  - `launch-policy.ts`: `VISUALS_SCENE_IDS` gains `dust`, `SOLO_FED_SCENE_IDS` is new, and `wantsSoloHost` turns on for `dust` (off with `&solo=0` or `capture=1`). `wantsHostDustFeed` is new.
  - `dust-feed.ts` (new): the port adapter. It also sets the dust scene's host options: its own Contract identity (prefixed storage keys, never the player's Contract), the memory store, and a spawn on the site plot. It also has `DustSceneSweeper`, a scripted sweeper with the primary tool held on a closed path, one input per 50 ms; `&bot=0` turns it off.
  - `boot.ts`: for the dust scene with solo on, it loads the sim-host chunk before the visuals module is built, creates the view, and attaches it to the host in `onHost`. In dev or with `?perf=1` it installs `__mcDustFeed` (stats, crashWorker, checkpoint, hash, viewHash, sweep).
  - `solo-host.ts`: `startSoloHost` is now generic over the host type and has an `onHost` hook.

## Evidence

| Check | Result |
| --- | --- |
| `tsc --noEmit -p apps/client` | clean |
| `vitest run src/sim-host src/app src/visuals` | **207 / 207**, 24 files (new: `sim-host/dust-view.test.ts` 4, `app/dust-feed.test.ts` 2, plus extended launch-policy cases) |
| eslint on the touched folders/files | clean |
| prettier `src/sim-host src/app src/visuals` | clean |
| Browser, `?scene=dust&perf=1&preset=medium&view=top`, WebGPU, UHD 620 | see below |

**What the Node tests prove:** the tests run the host and the worker core over a real MessageChannel.
- Every stroke reaches the target exactly once (`target.strokes == strokesApplied ==` the reference sim's strokes).
- The view's `worldHash()` equals the worker's `dustHash` and the reference sim's.
- No ledger pool growth, `framesSkippedNoBuffer` 0, no dropped strokes.
- A view attached mid-game restores the state, then follows live in parity.
- Strokes queued during a sliced restore end up in the published ledger.
- Checkpoint -> 80 unsaved ticks -> crash -> reboot: the view returns to the saved dust hash, `rebuildAll` fires once, and parity holds over another 320 ticks.

**Browser run** (`docs/agent-reports/M1-W3-T02b-evidence/`: `dust-feed-check.json`, PNGs, driver `dust-feed-check.mjs`):
- **Live:** `dust-feed-top-live.png` shows cleaned rings drawn by the host's strokes (59 strokes in 7 s, all forwarded, 0 decode errors). View hash equals worker dust hash (4030671638). HUD: 58.5 fps, visuals CPU avg 0.35 / p95 1.2 ms with live strokes; T02 measured 0.25 / 0.9 with the scenario.
- **Crash and reboot:** after a crash the worker rebooted from the checkpoint (`reboots` 1). The view took the new state (`restores` 2, 7 slices, 116 ms wall, longest slice 2.9 ms) and the hashes match again (824384687). `dust-feed-top-after-crash.png` shows the ring rebuilt from the checkpoint. The red banner is the intended test-hook error going through the error boundary.
- **Fallback:** `&solo=0` falls back to the seeded scenario (`dust-feed-top-solo0-scenario.png`; `dustFeed` null, 17 tiles, 634 strokes).
- **Discarded:** a first run sat in a throttled background window (1 fps). A "resumed" capture was discarded because a Vite full reload (other agents editing sim-host) restarted the page mid-run.

## Open issues / not done

- **Strokes stop after about 14 s:** the 4 kg Dust Cell fills (about 276 strokes) and the sim has no pour yet. This is the sim's current behaviour, not the feed's. Gameplay or the sim owner should add the pour.
- **View restore slice overshoots:** the longest slice was 2.9 ms against a 1 ms budget. One `DustRestoreJob` step is coarser than the budget; the same issue as the open worker restore-slice overshoot. `packages/world` was not touched; the Fable restore-slice task should look at it.
- **One-off view construction cost at dust-scene boot** (grid plus plot attributes, before the first frame): measured and reported in `__mcLook.info().dustFeed.viewConstructMs`, but not written down here. The game launch (no dust scene) does not create the view.
- **Not run:** WebGL2 lane, Low preset, Tier A, a heap/allocation measurement in the browser, a real dropped-stroke resync (tested only by code path), a hidden-tab overflow run, and root `pnpm verify` (excluded by the brief).
- **The real ground is not wired:** the curved-terrain lookup is still missing (the flat patch only). The main game does not show the atlas yet.

## Next

1. Review: the sim-host message additions (protocol v3) and `dust-view.ts` (gameplay-systems-engineer); the `DustWorksite` feed path (technical-artist).
2. When the terrain ground exists, create the view at game boot and feed the CDLOD ground's atlas the same way (`DustFeedPort`).
3. Restore-slice granularity (world owner); Cell pour (sim).
