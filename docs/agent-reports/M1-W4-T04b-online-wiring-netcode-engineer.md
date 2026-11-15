# M1-W4-T04b online wiring: netcode-engineer

**Status:** in-review (items 1 to 3 done; item 4 blocked: no input module). Date: 2026-11-15. Model: Opus 5.5. No git run; `packages/sim` and goldens not touched.

**Done**
1. `RoomSession.sendDustRequest(body)`: sends only while `joined`. `OnlineRoom` no longer wraps `consume` or keeps the connection; it sends `requestBuf.subarray` with no per-request copy, because the SDK copies into its shared buffer.
2. Equipped tool: `RoomConnection` has optional `sessionId` and `onStateChange`. On each Schema patch the session reads its own `players.get(sessionId).equippedTool` with `equippedToolOf`, which is defensive and returns -1 when absent. It calls `handlers.onEquippedTool` only when the value changes, and exposes `session.equippedTool`. `OnlineRoom` passes the value to `setEquippedTool` and on to `predictor.setTool`.
3. `net/guest-auth.ts` `GuestAuth` (an `AccessTokenSource`):
   - Endpoints: `POST /v1/auth/guest` and `/v1/auth/refresh`.
   - Token storage: the refresh token goes in localStorage (`moon-cleanup.auth.refresh`). The access token stays in memory and is refreshed 30 s before it expires.
   - Request handling: one request at a time. On 409 TOKEN_SUPERSEDED it re-reads storage and retries once. On 401 it forgets the account. Network errors and 5xx keep the stored token.
   - Account creation: `getAccessToken` never creates an account; only `signIn()` does.
   - Wiring in `boot.ts`: `startCheckpointSync` deep-imports `../net/guest-auth`, so the room and protocol code stay out of the solo background chunk. It passes the auth to `createSaveApi` and calls `signIn()`, then `sync.notifyAuthChanged()`.
   - Solo first-frame path: unchanged.

**Not done:** see item 4 under Blockers.

**Files:** apps/client/src/net/{room-session.ts, room-session.test.ts, guest-auth.ts, guest-auth.test.ts, index.ts}, apps/client/src/app/{online-room.ts, online-room.test.ts, boot.ts}

**Evidence**
- `tsc --noEmit -p apps/client`: clean.
- `eslint` on the touched paths: 0 problems.
- `vitest run apps/client/src/net app/online-room.test.ts app/boot-wiring.test.ts`: 8 files, 49 tests passed. This includes new tests for the equipped tool, sending DUST_REQUEST only while joined, the `equippedToolOf` guards, and 6 guest-auth tests.
- After the Prettier rewrite I ran the same tests 3 more times. One run had 1 failure (48 of 49 passed); the next 2 runs passed 49 of 49. I did not capture which test failed, so one test in these files may be flaky under load. Next: look at the failing name in a verbose run before `pnpm verify`.
- Prettier: my files were rewritten. `boot.ts` still has one older long line at about line 444 (`clockIn`) that was there before my change.

**Blockers / requests**
- Item 4 (owner: gameplay/input): `apps/client/src/gameplay/` is empty. The only input producer is the dev `DustSceneSweeper` (app/dust-feed.ts). I did not create a player controller. When one exists, it should call `OnlineRoom.sendInput(cmd)` online and `host.sendInput` in solo.
- Auth UI (owner: UI or backend):
  - showing `takeRecoveryCode()`;
  - Web Locks / BroadcastChannel coordination between tabs (for now this relies on the server's 60 s rotation grace and the 409 retry);
  - `online-launch` still takes a dev token by hand.
- save-sync (W5-T08 owner): I have not checked whether `notifyAuthChanged` re-runs a `clockIn` that was held, or whether the server Contract row for the solo `contractId` exists before upload.

**Commit suggestion:** `feat(client-net): dust request send, schema equipped tool, guest auth token source for save sync`
