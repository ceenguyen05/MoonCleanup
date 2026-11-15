# M1-W3-T05 solo input, prediction, camera rig, tool aim (+ boot wiring): gameplay-systems-engineer

**Status:** in-review. Not yet run in a browser. Date: 2026-11-15. Model: Opus 5.5. No git.

Not touched: `packages/sim`, goldens, visuals, terrain, render.

## Done

### `apps/client/src/gameplay/`

**Input**
- `input/bindings.ts`: device bindings stored as plain data, so they can be rebound. Covers keyboard, mouse, wheel and the standard gamepad, mapped to the 16 logical buttons plus movement, slots 1–6 and the camera toggle.
- `input/input-state.ts`:
  - buttons are sent as levels, and a tap shorter than one tick is latched so it still reaches the sim;
  - a jump while airborne also sets `hopPack`;
  - yaw and pitch are quantised to the input contract;
  - `peek()` reads the live input without consuming latches;
  - `mirrored` flips turning and strafing for mirrored scene frames.
- `input/dom-input.ts`: the first click takes pointer lock without swinging the tool. Blur, a hidden tab or losing pointer lock clears all input. Text fields keep their keys. Gamepads are polled only after one connects.
- `input/input-pump.ts`: sends exactly one input per sim tick (at most 2 in a frame after a hitch). A `listener` hook lets prediction step on each input sent.

**Pose, prediction and camera**
- `avatar/pose-source.ts`:
  - `FrameAvatarSource` decodes FRAME Self, interpolates it and forwards each Self to `selfListener`.
  - `PredictorPoseSource` wraps the online predictor.
- **`avatar/solo-predictor.ts` (E13):**
  - The main thread runs the worker's own pure `stepAvatar` with the same MoveIntent derivation, on each input as it is sent.
  - Reconciliation follows the online rules: restore the prediction recorded at the ack, apply Self, replay up to 16 inputs, and smooth the difference with an 80 ms half-life render offset.
  - Between sends, the pose blends toward a speculative step of the live input. A key press therefore moves the avatar on the next frame, and the blend lands exactly on the next predicted tick. No extra inputs are sent.
  - Ground: `FLAT_GROUND`, the same as the Solo worker (`app/solo-host.ts` uses `{ kind: "flat" }`).
- `camera/camera-rig.ts`: first-person view (third-person on V), heading taken from the sim's `headingBasis`, and tool aim converted to `toolParam`. Two mappers:
  - `TangentPlaneMapper`, which keeps the origin near the player;
  - `PlotFrameMapper` for the dust scene.
- `module.ts`:
  - Solo predictor: loaded from a lazy chunk with game data and config.
  - Equipped tool: read from shift state (slot 0).
  - Online: the app's online slot is checked once per frame, then `setOnline(room, new PredictorPoseSource(room.predictor))`.
  - Placeholder avatar: a capsule plus an aim ring.

### `app/boot.ts`

**(1) Gameplay registration.** `GameplayModule` is registered when `wantsPlayerInput` is true:
- `?play=1`, or `?scene=dust&bot=0` (with the dust scene's `PlotFrameMapper`);
- never with `capture` or `solo=0`.

The dust-scene bot and perf-capture camera are unchanged.

**(A) Sync wiring:**
- Clock In passes `soloRegistration`.
- Sign-in uses `signInUntilReady`, and `stopSignIn` runs in teardown.
- One shared lazy `loadGuestAuth` serves both checkpoint sync and the online UI.

**(B) Online UI:**
- `UiModule` gets `online: onlinePort`.
- `createOnlineDevHooks` is created in every build; the room code still loads only inside `open` (dynamic import).
- The `__mcOnline` console hook is still dev/perf only.

## Finding: the dust scene frame is a mirror image

`det(east, up, north) = -1`: `flat-lookup` maps render z to +v (north). Without a fix, mouse-right turned left on screen. Fix: `PlotFrameMapper.mirrored`, so the input flips yaw and strafe. Render owner: decide whether to make the scene frame right-handed (z = -v); the input then needs no flip.

## Evidence

- `tsc -p apps/client`: clean for my files.
- `eslint` and `prettier`: clean on gameplay, `boot.ts` and `boot-wiring.test.ts`.
- `vitest` on src/gameplay, app, ui, sim-host and sync: 200 tests. Everything passed except one new boot-wiring test that timed out at 5 s (importing `boot.ts` takes about 6 s). After raising its timeout to 60 s, the boot-wiring and gameplay files pass 30/30.
- Tests added:
  - a move press shows on the next frame, before any send;
  - the blend is continuous (difference under 1e-9 m);
  - a worker running the same steps produces 0 correction;
  - the offset halves in 80 ms;
  - dust-scene axes and mirroring;
  - zero allocation in input, rig and predictor (heap flat over 100k–200k frames);
  - 3 boot-wiring tests.

## QA follow-ups (2026-11-15, from M1-solo-smoke-qa-test-engineer.md)

### D2: dev readout `__mcGameplay()`

- **What it shows:** pose, input seq, inputs sent, inputs sent with the tool held, worker tick, ack, decoded frames, stroke chains acked, last stroke tick, Dust Cell grams (`cellGrams`), prediction stats and host state.
- **When it exists:** `GameplayModule({ debugHost })`. `boot.ts` passes `perfEnabled ? win : null`, so production installs nothing and does no extra per-frame work (only integer counters).
- **Tests:** module test (installed and removed; absent without a debug host), tool-input count, and a boot-wiring line.

### Stroke smoke (headless Chromium, SwiftShader WebGL2)

Script: scratchpad `stroke-smoke.mjs` (click, then hold the mouse and W for 3 s). Server: a dev server already listening on :5193 (PID 36680, not mine; my own vite failed to bind because that port was taken, so check whether that server was orphaned).

| Scene | Before (inputs / chains / grams) | During (3 s hold) | After | Ledger hash (view = worker) | Errors | Off-origin requests |
|---|---|---|---|---|---|---|
| `scene=dust&bot=0` | 10 / 0 / 0 | 40 sent, 28 with tool; 23 chains; 273 g | 25 chains, 297 g | 0 = 0, then 1541338224 = 1541338224, then 4060276532 = 4060276532 | none | none |
| `play=1` | 17 / 0 / 0 | 81 sent, 62 with tool; 23 chains; 342 g | 24 chains, 359 g | (no ledger view in this scene) | none | none |

**Result:** proven. Tool strokes reach the worker, the Dust Cell fills, and the dust ledger changes, with the main-thread view hash equal to the worker hash. Acks follow the sent inputs within 1–3 seqs.

**Prediction:** corrections are about 0.0001 m while walking. While walking and sweeping they reached 0.11–0.33 m. Likely cause: tool or holster timing that is not predicted (the online predictor has the same limit). The 80 ms offset smooths it. **Next:** find which sweep term differs.

### D1: guest sign-in

- **Before:** it ran whenever the Solo host started.
- **Now:** `wantsCheckpointSync(search, VITE_SERVER_HTTP_URL)` decides. It runs only when the build sets a server URL; `?sync=1` forces it on and `?sync=0` turns it off. The dev and preview runs above made 0 off-origin requests.
- **When it does run:**
  - it starts after the host, from lazy chunks, and never awaits on the boot or solo input path;
  - network failures return `false` (no throw, no JS console error) and back off 30 s, doubling to 5 min;
  - the browser itself still logs each failed request (`ERR_CONNECTION_REFUSED`), at that backoff.
- **Open (net owner):** `AppNetModule` also wakes the server on the first interaction (an E13 "zero network during play" question). I did not check its request.

## Sweep prediction error and net wake (2026-11-15, follow-up 3)

### (1) The 0.1–0.33 m correction while sweeping

**The predictor is exact** (`gameplay/solo-authority.test.ts`). It was compared against the real `MoonRoomSim` (flat world, the worker's sim) with one input consumed per tick. Corrections stay under 1e-9 m for both walking and walking + sweeping, so the tool's sweep and face-aim speed effects are modelled.

**The error comes from worker ticks with no input.** A starved tick makes the worker repeat the last input without consuming a seq, so every acked prediction is off by one tick of motion. The test reproduces corrections above 3 cm. In the browser it is visible in the worker queue counters (smoke, `scene=dust&bot=0`, my own dev server on :5197, now stopped):
- During a 3 s hold: 34 inputs sent over about 49 ticks; worker substitutions went from 9 to 24; corrections 0.22–0.40 m.
- The cause is headless SwiftShader running at about 3 fps (300 ms or longer frames). The old pump capped sends at 2 per frame and dropped the backlog.

**Fixes:**
- `INPUT_PREFILL = 1`: the pump sends one extra input when a host appears or resumes, so the worker queue has one tick of slack. This costs one tick of authoritative latency, which prediction hides.
- `MAX_INPUTS_PER_FRAME = 3`, which covers the frame loop's 100 ms dt clamp.

**Check:** a test drives the real `InputQueue` (sim-host) with 60 fps frames (±4 ms jitter, a 40 ms hitch every 2 s), worker ticks at ±3 ms, and 10 clock phases. Result: 0 substitutions and 0 double-steps; every tick consumed a fresh input.

**Not proven:** the jitter model did not starve the worker even without the prefill, so the prefill is a margin, not a proven fix for 60 fps. Real hardware has not been measured. Below about 20 fps, starvation still happens; the 80 ms offset smoothing keeps it from snapping.

**Next:** run `?perf=1` on a real GPU and read `__mcDustFeed.stats().host.worker.inputsSubstituted`.

### (2) The net module woke the server on the first click in solo

**Cause:** `app/modules.ts` `AppNetModule.init` registered one-shot `pointerdown` and `keydown` listeners that called `session.wake()`, the health probe to the server. The first solo click therefore made a request (an E13 violation). The fix is in `app/` only; `net/` is unchanged.

**Fix:**
- `AppNetModule` no longer listens for clicks or keys.
- `wakeForOnline()` (runs once) starts the probe.
- `boot.ts` calls it only on online intent: `onlinePort.auth()`, which the entry UI calls, and `onlinePort.open()`.
- `?wake=1` automation still wakes at boot.

**Test:** a boot-wiring test checks that the module registers no `pointerdown`/`keydown` listener and calls `fetch` 0 times, and that `boot.ts` wires `wakeForOnline` into `auth()`.

**Evidence:**
- `tsc`: clean for my files. Pre-existing errors remain in `src/animation/avatar-animator.ts` (another owner).
- `eslint`: clean.
- `vitest src/gameplay src/app`: 105/105.
- Smoke (before the wake fix): 0 off-origin requests, 0 console errors.

## Risks / Next

- **Other owner:** `src/animation/avatar-animator.ts:248,252` currently has tsc errors.
- **Terrain:** when Solo gets a height cube, pass the same `GroundHeight` as `GameplayModule({ ground })`.
- **Hop Pack:** `hopMaxCharges` is not predicted; offset smoothing absorbs the difference.
- **Not run yet:** E13 browser capture, pointer lock, gamepad, and a real online room.

**Commit suggestion:** `feat(client-gameplay): input, solo prediction, camera rig, tool aim; wire sign-in retry and online entry UI`
