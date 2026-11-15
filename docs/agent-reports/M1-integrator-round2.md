# M1 integrator round 2: Steep prediction, PUCKS save section, remote avatars, entry chunk (integrator)

**Status: 3 of 4 done (focused tests pass), item 4 not done (blocked on owners).** Date: 2026-11-15. Model: Opus 5.5. No git.
Not touched: terrain, dust, render, visuals, `packages/*`, sim goldens, apps/server.

| # | Item | State |
| --- | --- | --- |
| 1 | Steep rule in `solo-predictor.ts` | done |
| 2 | Hosts save/load the `pucks` body (PUCKS, id 8) | done for the Solo host; server has no sim checkpoint at all (see Open) |
| 3 | Remote avatars into the animation pool | done (bound on room open, unbound on close; integration test) |
| 4 | Online code out of the entry chunk | not done; measured only |

## 1. Steep rule (solo prediction)
- `apps/client/src/gameplay/avatar/solo-predictor.ts` `stepWith`: same rule as `MoonRoomSim.stepActor` (moon-room-sim.ts:822-830). When sweeping (not Detailing) and `tool.steepSweepMult !== 1`, it calls `groundSlopeTan` into a reused `Float64Array(1)` and multiplies `speedMult` when the slope is above `cfg.tanSteepSlope`. No per-step allocation; the probe is skipped for Sure Footing / Charge, so it costs nothing for those tools.
- Test (`gameplay/solo-prediction.test.ts`, new describe): on a tilted plane the Desk Duster sweep speed at 32 deg / 20 deg equals its `steepSweepMult` (0.6) to 2 decimals; Bristle Broom (Sure Footing) ratio is 1. The file passes 7 of 7, including the existing "allocate nothing per frame" test.

## 2. PUCKS save section (Solo host)
- `apps/client/src/sim-host/sim-checkpoint.ts`: `encodeSimCheckpoint` writes a third section `{ id: PUCKS, version: ck.pucksVersion }` with the sim's body whenever `captureCheckpoint()` returns it. `decodeSimCheckpoint` picks the PUCKS section and passes `pucksVersion`/`pucks` to the sim, which validates or rejects them. Saves without PUCKS, and the empty interim v2 body from the shared vectors, restore with no pucks. `worker-core.ts` needed no change (it hands `decoded.sim` to `restoreCheckpoint`).
- Tests (`sim-host/sim-host.test.ts`, new describe "PUCKS save section (id 8)"): (a) a sim with formed and carried pucks (the sim's PUCKS test script): save, decode, restore into a fresh sim gives the same pucks bytes, cargo grams and `stateHash`; (b) with no PUCKS section, or with v2 and an empty body, restore succeeds with 0 cargo grams. Both pass. The rest of the file passed 29 of 29 in the same run (one of the new tests first timed out at 5 s because `directSim` is slow, so the describe now uses the file's usual 60 s timeout).

## 3. Remote avatars into the animation pool
- `app/boot.ts`: `AnimationModule` is now constructed and registered (slot "animation" in the fixed order; update order net, then gameplay, then animation, per `MODULE_UPDATE_ORDER`). In Solo it stays unbound, so `update` does only `events.clear()` and a null check (no Solo frame cost). It is passed to the online hooks as `animation`.
- `app/online-launch.ts`: `openRemoteHost` also builds the `RemoteAvatarFeed` (in the lazy online chunk). On open: `animation.bind(feed.provider, FLAT_ANIM_GROUND, room.config.moonRadiusM)`. On close: `bind(null, null, 0)`. The ground is flat, matching the online predictor's default (the server room is flat until terrain gives the sim a height cube).
- Test: `app/online-loop.integration.test.ts` now binds B's feed into a real `AnimationModule` and updates it every pump. After A sweeps for 3 s, `animatorFor(0)` is active and `lastUpdated >= 1`. Passed (real server in-process, ws transport).
- `tsc --noEmit -p apps/client` clean; `eslint src/app src/gameplay` plus the sim-host files clean.

## 4. Entry-chunk split: NOT done
- `vite build` on this tree: entry `index-*.js` **2,096,472 B** (gzip 660 kB); `online-room-*.js` 13.5 kB lazy. Earlier baseline 2,042,264 B (M1-W4-T06); the +54 KB includes this round's `AnimationModule` registration and other workers' sim growth since then (not split out). Artifacts: scratchpad `build-r2/`.
- Same blockers as M1-W4-T06 section 7: a deep import made the entry bigger (rolldown hoisted game-data and protocol chunks). Rolldown also warns `INEFFECTIVE_DYNAMIC_IMPORT`: `packages/sim` is dynamically imported by `gameplay/module.ts` but statically by `solo-predictor.ts`, `camera-rig.ts`, `net/predictor.ts`, `sim-host/dust-view.ts`, `app/online-room.ts`.
- Needed from owners:
  1. **devops:** `"sideEffects": false` in `apps/client/package.json`, or an `advancedChunks` group for net/protocol; then redo the deep import of `../net/session` in `modules.ts`/`services.ts`.
  2. **net:** make the top-level `S2C_BYTES_IDS` / `S2C_CONTROL` tables in `net/room-session.ts` lazy, so the barrel tree-shakes.

## Open / returned to owners
1. **net (`apps/client/src/net/predictor.ts:252`):** the online `OwnAvatarPredictor` has the same missing Steep rule; online prediction will drift on Steep ground while sweeping. Same three-line fix as item 1.
2. **server/sim-host owners:** apps/server never calls `captureCheckpoint`/`restoreCheckpoint`; server rooms persist only the dust ledger, so META/PLAYERS/PUCKS are not saved online. This is larger than the PUCKS section.
3. **animation:** `animator.test.ts` "AN-M1-09 < 32 KB heap growth" failed once in a combined run (`src/app src/gameplay src/animation`, 160 of 161) and passed 12 of 12 alone. It is load-sensitive; animation files were not changed.
4. Own avatar in the online pool: the feed maps every avatar entity, including our own; `setLocalSlot` is not called (the map order changes with joins). Needs a mapping from the session's own entity slot (net/animation).
5. Not run: `pnpm verify`, browser 2-client run, real GPU, netsim (no toxiproxy binary).

## Files
- Edited: `apps/client/src/gameplay/avatar/solo-predictor.ts`, `apps/client/src/gameplay/solo-prediction.test.ts`, `apps/client/src/sim-host/sim-checkpoint.ts`, `apps/client/src/sim-host/sim-host.test.ts`, `apps/client/src/app/boot.ts`, `apps/client/src/app/online-launch.ts`, `apps/client/src/app/online-loop.integration.test.ts`.
