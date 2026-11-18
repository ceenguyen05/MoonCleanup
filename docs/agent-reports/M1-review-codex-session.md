# M1 review of the Codex session (read-only; code-reviewer)

Scope read: app/solo-avatar.ts (+test), the boot.ts wiring, app/terrain-game.ts, visuals/dust/terrain-dust.ts, the terrain save isolation, and gameplay/input/dom-input.ts.
Focused run: solo-avatar, terrain-game, input/* and terrain-dust tests, 6 files / 38 tests, all pass (Node 26).
I did not run any GPU or browser checks.

## Verdict
No blocking defects found in the reviewed paths. The terrain game is opt-in (`GAME_GROUND_DEFAULT = "flat"`). Solo cost looks low. Four non-blocking findings are below, ranked.

## Findings (ranked)

1. MEDIUM, save isolation relies on one mechanism. `app/boot.ts:743-747` isolates terrain saves only by prefixing the Solo identity, which gives a separate contractId.
   - `sim-host/local-room-host.ts:408` still uses the shared IndexedDB `moon-cleanup-solo`, and `terrainHostOptions` does not set `dbName`.
   - The checkpoint rows are keyed by `contractId` (`checkpoint-store.ts:120-122`), so the saves do not collide today. I judge corruption risk low.
   - The risk is that any code reading the "latest" or only row, or the Web Lock, would span both games. Recommend `dbName: "moon-cleanup-solo-terrain"` in `terrainHostOptions` as defense in depth.
   - There is no test that asserts the terrain contract and DB differ from flat. `terrain-game.test.ts` has no identity or dbName assertion; I did not check it beyond running it.

2. MEDIUM, boot has no fallback if the terrain asset fails. `app/boot.ts:299` awaits `loadTerrainAsset` with no try/catch.
   - I saw a `throw` at `src/terrain/height-asset.ts:164` (a missing manifest key) and no handler around the call.
   - A 404 or bad manifest under `?ground=terrain` therefore aborts the whole boot instead of falling back to flat.
   - It is opt-in today, but it must be fixed before a default flip. Catch, report via `boundary.report`, and set `terrainGame=false`. That needs `terrainGame` to become a `let` and be computed after the load.

3. LOW, `gameplay/input/dom-input.ts:174-196`. `detach()` removes the `pointerlockchange` listener and then calls `releaseLock()`, but never sets `this.locked = false`.
   - If the lock was held, `locked` stays true after detach, and a re-attach starts with a stale flag.
   - `attach()` also does not sync `locked` from `document.pointerLockElement`.
   - The rest of the hygiene looks correct: clear on blur, hidden, pagehide, freeze and lock loss; `requestPointerLock` rejection swallowed; no lock while suspended or hidden; no allocation in the handlers.

4. LOW, `app/solo-avatar.ts`.
   - Line 141: the held tool is set only from `onShiftState` changes. `LocalRoomHost.onShiftState` does not replay the current state on subscribe (`local-room-host.ts:263`).
     - After `bindHost` calls `feed.reset()` (tool = none), the restored equipped tool shows as none until the next state push. This is probably tick-rate, so the delay is small.
     - `reset()` on every host change also clears the tool; a cheap fix is to seed from the last state.
   - Line 40: `jumped` is consumed on a `seq` change. If several predicted ticks run per frame, or the pump seq does not advance on a frame that jumped, the jump flag can be dropped. The test covers only the single-seq case.
   - `dispose()` (lines 155-162) does not null the `offHost` or `offShift` handles. Calling it twice is safe only if the unsubscribes are idempotent.
   - The provider returns false while driving (line 24). There is no test that the avatar view is hidden or held while seated. This is listed as open in the report.

5. INFO, `visuals/dust/terrain-dust.ts`. Correct as read.
   - `preRender` does not allocate. `camToSite` is set after `follow()`, so it is consistent with the site uniforms after a recentre.
   - `setSite` uses exact grid axes.
   - `dispose` unbinds the feed, the lookup and the layer.
   - Gap: there are no GPU or shader acceptance results, as the session summary already says. `projectTerrainDustPoint` is covered by the CPU test.

## Checked, no issue
- Boundaries: solo-avatar and terrain-game live in `apps/client`. They import three only through `visuals/characters/blockout` and `three/webgpu` (type only). I found no `shared`, `sim`, `world`, `protocol` or `game-data` imports of DOM or three, and no client import of `packages/db`.
- Hot path: the `SoloAvatarFeed.provider` per-frame body reuses the `input` buffers and does no allocation. `SharedGround.heightAtXYZ` is one indirection.
- Online: the `soloRestoringBinder` test covers unbind and restore of Solo and the local slot. Online open is explicitly refused in terrain mode (`app/boot.ts:437-440`), so no cube-versus-flat host mismatch.
- Checkpoint sync is skipped for the terrain game (`app/boot.ts:774`), so the experimental saves never upload.
- `SoloAvatarModule`: the `worksiteMapper!` non-null assertion is safe because `avatarResources` implies `gameLaunch`, which sets `worksiteMapper` (when not terrain).
