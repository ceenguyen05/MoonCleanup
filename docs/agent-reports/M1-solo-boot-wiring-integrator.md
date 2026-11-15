# M1 solo boot wiring (integrator)

Status: wired, checks green, one audio-startup hitch found (owner action) · 2026-11-14 · Sonnet 5.5
Scope: `apps/client/src/app/**` only. No edits to packages/sim, apps/server, sim-host, audio, STATUS or task rows.

## Wiring changes (all in `apps/client/src/app/`)
- `boot.ts`
  - Registers the `roomHost` service facade right after `uiStore` (current === null, every module can bind in `init`).
  - Registers `AudioModule({ env: browserEnv(win) })` in the fixed slot (after `net`, before `ui`; debug stays last). Skipped for `?audio=0` and `?capture=1`.
  - After `frameLoop.start()` it calls `startSoloHost(...)`, so the first frame never waits for it. The sim-host barrel is loaded with a dynamic `import("../sim-host")` (own chunk). Disposal goes through the existing reverse-order disposer: `solo.stop()` publishes `null`, then `host.close("clock_out")` (final checkpoint, worker terminate, Web Lock release). A start still in flight is cancelled; a host that finished creating after `stop()` is closed.
  - Failures (locked by another tab, worker failed twice, start rejection) go to `boundary.report` (non-fatal banner), never swallowed.
- `solo-host.ts` (new): `createRoomHostService` (publisher facade), `loadSoloIdentity` (contractId / playerId / originId in localStorage, UUIDv7 via `crypto.getRandomValues`, ephemeral if storage is blocked), `startSoloHost`, `uuidv7`.
- `launch-policy.ts`: `wantsSoloHost(search)` (on for the game launch, hello world and hud-test; off for `?scene=bench|verify|s01..|typical` and `?capture=1`; `?solo=0|1` overrides) and `wantsAudio(search)`.
- `services.ts`: `roomHost` added to `REQUIRED_SERVICES`.
- Tests: `solo-host.test.ts` (new, 8 tests), `launch-policy.test.ts` (+3).

Design notes
- Solo input path: the app adds nothing between input and `LocalRoomHostImpl.sendInput` (it is the host's own synchronous echo plus a pooled transferable post). No per-frame work was added to the composition root: no new `update()` loop, no allocation. Audio `update()` is the module's own 30 Hz throttled, allocation-free tick.
- World is `{ kind: "flat" }` (see mismatches); nothing consumes frames yet, so the host runs and drops frames (`framesDroppedNoListener`, released immediately).

## Gates
| Check | Result | Evidence |
| --- | --- | --- |
| `tsc -p apps/client/tsconfig.json` | PASS, 0 errors | run after final edits |
| `eslint src/app --max-warnings=0` | PASS | |
| `prettier --check src/app` | PASS | |
| `vitest run` (whole apps/client) | PASS, 409/409 (src/app 43/43) | |
| `vite build` (production) | PASS | below |
| `pnpm verify` | NOT RUN here (lead runs the single final one; another worker is editing packages/sim) | |

## Production build: worker chunks (Vite 8, `apps/client/dist/assets`, raw / gzip)
- `render-worker-39ZGxBbG.js` 22,437 B / 7,868 B (audio cue synthesis Worker): emitted.
- `sim.worker-BzRYwO0P.js` 267,937 B / 75,342 B (sim + world + game-data + protocol): emitted.
- `sim-host-DVbXhZJm.js` 17,233 B / 6,354 B (host, dynamic chunk, loaded after the first frame).
- Main `index-CAnmMcaD.js` 1,984,308 B / 606,097 B (was 1,916,356 B before this wiring; +67,952 B raw: the AudioModule, graph, player and router code plus the main-thread fallback recipes).
- Both workers were also seen loading at runtime in Chromium (resource entries), see below.

## Browser measurement (MEASURED: Chrome channel, Playwright, this laptop, production preview, `preset=low`, 1280x720, headed; script outside repo in the session scratchpad)
Main-thread CDP `TaskDuration` per second, hello-world scene (render cost dominates and is noisy run to run: baseline itself ranged 228-287 ms/s). One run per variant, so treat deltas under about 50 ms/s as noise.

| Variant | 6 s before gesture | 4 x 2.5 s after first click | 6 s steady after | longtasks >50 ms after click |
| --- | --- | --- | --- | --- |
| baseline (`solo=0&audio=0`) | 287 ms/s | 286 / 262 / 228 / 260 | 251 | 0 |
| audio only (`solo=0`) | 246 | 202 / 210 / 156 / 158 | 148 | 1 x 317 ms |
| solo + audio (default) | 204 | 213 / 201 / 177 / 208 | 196 | 1 x 267 ms |

- Steady-state main-thread cost with audio and the Solo worker running is not above baseline (the lower numbers are run-to-run render variance, not a saving). JS heap at the end 13 MB vs 21 MB baseline (noise-level, not a saving).
- Workers confirmed running in the default variant: `sim-host` + `sim.worker` + `render-worker`; IndexedDB database `moon-cleanup-solo` created. No console errors from the wiring (only pre-existing font-preload and powerPreference warnings).
- **Audio startup hitch (finding):** every variant with audio shows one long task of 267-317 ms at the first click. Isolated cause, measured in the same Chrome with no game code: `new AudioContext({ latencyHint: "interactive" })` takes 328.9 ms on the main thread (`resume()` 0.1 ms). That is browser/OS audio-device initialisation on this Windows machine, not the module's synthesis (which is in the Worker). It lands on a frame in the middle of play at the first key/click.
- NOT RUN: UHD 620 numbers, WebGL2/Firefox/Safari, multi-minute heap growth, audible check, solo input-to-visual latency (no gameplay consumes the host yet), `pnpm verify`.

## Mismatches and requests returned to owners (not patched)
1. **audio-engineer, `apps/client/src/audio/module.ts:206-227` (`unlock`)**: constructs the context inside the first gesture, producing the 270-330 ms main-thread stall above. Proposal: an option (for example `eagerContext`) that constructs the `AudioContext` once at idle shortly after boot (browsers allow a suspended context before a gesture; `resume()` on the gesture was 0.1 ms) so the hitch happens at the load screen. Then the composition root can pass it. Until then it affects the first click of every session.
2. **sim-host / terrain owner**: `createLocalRoomHost` needs a height cube (`world: { kind: "cube", cube, layout, ground }`); the app has no terrain module yet and the baked cube loader lives in `render/bench/terrain-loader.ts` / `visuals/lookdev/terrain-patch.ts`. The app uses `{ kind: "flat" }`. When the terrain module exists it should expose the cube so the app can pass a copy.
3. **sim owner (already known)**: restore covers tick, wallet and pose only until packages/sim has a state import/export codec (T08 report). The app passes `restore` default true.
4. **sim-host owner (to confirm)**: the host checkpoints on `visibilitychange: hidden` only; a `pagehide` without visibilitychange (some Safari paths) is not covered.
5. Nothing yet consumes `roomHost.current.onFrame`, `onEvent` or `onShiftState`; gameplay/terrain/ui modules must bind in `onChange`. Until then frames are dropped by design.

## Open issues
- Contract identity is one per device (localStorage); there is no Contract picker. Clearing site data loses the pointer to the IndexedDB save.
- `?solo=1` forces the host on harness scenes; default launch only.
- Audio and Solo host are not under `?capture=1`, so visual-review lanes are unaffected.

## Recommendation
Accept the wiring. Before calling solo audio done, have the audio engineer remove the first-gesture AudioContext construction stall (item 1); measure again on the UHD 620 after the gameplay module consumes the host.
