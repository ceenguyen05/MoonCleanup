# M1 client online/gameplay batch - code review

Reviewer: code-reviewer. Read-only. Verdict: **APPROVED** (no blocking defects in scope; 4 non-blocking notes; 1 out-of-scope red test).

## Evidence run (Node 26 PATH prefix applied)
- `vitest run src/app src/gameplay src/ui src/visuals`: 50 of 51 files pass, 424 of 425 tests.
  The single failure is `src/visuals/lighting/shadow-filter.test.ts` ("far kernel floor ... grazing sun"): `ReferenceError: farKernelFloorX is not defined`. This is outside the batch (a concurrent shadow-filter edit by another writer). `shadow-filter.ts:145` now exports `farKernelFloorX`, while `visuals/module.ts` still imports and sets `farKernelFloor` (`?kernelfloor`). Lead should confirm that writer is finished; it may break client tsc and the visuals import.
- Client `tsc --noEmit -p apps/client/tsconfig.json`: clean (run before that concurrent edit landed; not re-run).

## Verified, no defect
- **Stale taps / listener leaks across room open/close/rejoin**: `tapFrames` (`online-room.ts`) guards the FRAME and state taps with a `left` flag (set by `leave()` and by `onLeave`) and a `connGen` check, so only the newest consumed connection feeds taps, and nothing fires once the room is disposed. `RemoteRoomHostImpl.close` nulls `frameTap`, `statusListener`, `shiftStateTap` and `simEventsTap` before `leave()` and `dispose()`. No extra Colyseus listener is added for state (it reuses `onStateChange`). A new `OnlineReadouts` per room, so no Near Parcel mask carries over on rejoin.
- **Dust feed rebuild** (`visuals/module.ts:354 setDustFeed`, `online-launch.ts:110,143,161`): old `DustWorksite.dispose` unbinds its feed, removes the group, and disposes the material, geometry, lookup and layer. The new scene binds the new feed (`rebuildAll`), so there is no double bind. Open then close ends with the Solo feed rebound and rebuilt. Early returns cover non-dust scenes, a call before `init`, and an unchanged feed. The superseded-open path leaves and disposes its room without binding. The cold path runs only on room open/close, so Solo frames pay nothing.
- **Solo untouched**: the Solo path adds no per-frame work. `ParcelFeed` adds one boolean check. The online-readouts chunk is imported only by `online-room.ts` (lazy). `sendIntent` on the Solo host is unchanged.
- **Tool-select / purchase intents** (`gameplay/module.ts:229`, `remote-room-host.ts:144`, `online-room.ts:447`): the guard removal now routes `select_tool` through `host.sendIntent`, which is the remote host online. There is one send path (grep shows no second `sendControl` caller), so no duplication. Purchases go `hud-interaction -> sendIntent -> sendControl`. The ids come from `MESSAGE_CATALOG`, and the server zod-validates them (`shift-room.ts:253`).
- **Invite link** (`online-model.ts:63 parseInviteLink`): the code is run through `parseEntryTarget` (alphabet-regex, canonical 8 characters), so injection is not possible, and it is rendered by React text. It is never auto-redeemed: `initialInvite` only pre-fills the code and sets the initial view. `vercel.json` already has an SPA rewrite for `/join/<code>`, and assets are absolute (`/src/main.ts`, vite base `/`), so deep links load.
- **Clipboard** (`ui/online/clipboard.ts`): the async API goes first, with a textarea `execCommand` fallback; it never rejects, the textarea is removed and focus restored.
- Near Parcel fallback id matches the server emit (`moon-room-sim.ts:2076-2080`: `kind "stray_cargo"`, `id NEAR_PARCEL_SIZE`).

## Non-blocking findings
1. `online-room.ts:447 sendControl`: allows the `resyncing` phase, and `conn.send` on a dropped socket is silently discarded by the browser. `controlsSent` and `intentsSent` count it, and `hud-interaction.purchase` returns a requestId and keeps the pending entry, so a purchase issued mid-resync can stay pending with no reject. Suggest allowing only `joined`, or adding a pending timeout. This is the lowest-risk spot I found.
2. `DustWorksite` constructor (`dust-worksite.ts`) resets `state.sun*` and calls `setView("play")` on every rebuild, so room open/close in `?scene=dust` resets the camera and sun. This is dev-scene only.
3. `parseInviteLink`: a `/join/<bad>` path returns null without falling back to `?join=`. Edge case only.
4. If a host fails or closes itself (retries exhausted) without going through `onlineHooks.close()`, the dust and animation bindings stay on the dead room. This is the same pattern as before for animation, not new in this batch.

## Not reached
`remote-avatars.ts`, `ui-store` and `hud-interaction` pending-purchase timeout semantics, the content of the new tests (counts only, not mutation-checked), and e2e/visual behaviour of the invite UI. `shiftStateViewOf` was read for the cap and fallback logic only; no defect found.
