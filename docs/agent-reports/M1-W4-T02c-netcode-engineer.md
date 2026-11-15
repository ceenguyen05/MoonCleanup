# M1-W4-T02c: resync keyframe + NB2 handshake check (netcode-engineer)

Task / status: M1-W4-T02c / in-review / 2026-11-14 / netcode-engineer / Opus 5.5
Scope: `apps/server/src/net/**` only. No client, protocol, shared, api, ops or git changes. No contract change.

## Done
1. **Resync keyframe** (T01b blocker 1).
   - `ShiftCore.setHidden(slot, false)` now ALWAYS requests a keyframe, also when the seat is already visible. This is what the client's `requestResync` sends, and matches netcode.md section 7 ("On `hidden: false`: keyframe FRAME").
   - New `ShiftCore.requestKeyframe(slot)` resets the seat's server SlotTable and then sets the keyframe flag. The client resets its table on every keyframe (session.ts keyframe contract), so the keyframe must re-assign every slot in interest. **Latent bug also fixed:** the hide-then-show keyframe used to keep the server table. Its FULL records then pointed at slots the client had just dropped, so the client could not decode the frame.
   - Cost: one keyframe per request. The existing visibility bucket allows at most 1 per second per client, and a request inside that second is dropped without counting as a violation. Solo pays nothing because the client was not touched.
2. **NB2: handshake shape checked before the per-IP slot is claimed.**
   - New `net/upgrade-handshake.ts`. It checks `Upgrade: websocket`, the `ws` key regex, version 13 only, and the subprotocol token list. A version refusal carries `sec-websocket-version: 13`.
   - **Both transports:** `beforeUpgrade` runs this check after the origin check and before `claimSocket`. It reads `context.headers`.
   - **uWS Request shape, verified in the installed adapter source:** the adapter builds those headers from `req.forEach`, i.e. every request header with a lower-case name. On uWS, a key that is not 24 characters long never reaches the upgrade handler, so no slot is claimed for it.
   - **ws only:** the AuthContext does not carry the HTTP method. The `listenForUpgrade` filter therefore refuses wrong method (405) or wrong shape (400) before Colyseus runs `beforeUpgrade`.

## Evidence (Node 26.13.1, this file state)
- `eslint src/net`: clean. `prettier --check src/net`: clean.
- `tsc --noEmit -p apps/server`: one error, in `src/api/checkpoints/checkpoints.test.ts` (missing `./exclusive`). That is the api owner's in-progress work. `src/net` has no errors.
- `vitest run src/net src/app`: **15 files, 152 passed**. The 4 touched files then passed twice more (55 tests each run).
- New tests:
  - Core: a resync while visible, and a hide-then-show, each give a keyframe that decodes from an empty table with 1 slot, followed by deltas. The other seat stays on deltas.
  - Room over ws: a visibility request gives a keyframe that decodes from empty. A second request within 1 s is dropped.
  - ws: 9 malformed kinds, two rounds each (18 bad upgrades, cap 3), all refused with 400/405 and 0 slots held. A valid upgrade then gets 101.
  - uWS: 4 malformed kinds, three rounds, all refused with 400 and 0 slots held. A short key gets no 101. A valid upgrade gets 101.

## NOT RUN
netsim, a real browser, Render, `pnpm verify`, and the client side of the resync (I did not touch the client).

## Blockers / Next
- DUST_SNAPSHOT on resync or join is still owned by W3-T04 (the client keeps `expectDustSnapshot:false`).
- The open `joinTicket` question to contracts-architect is unchanged.

Files: `apps/server/src/net/{upgrade-handshake,game-server,ws-transport,uws-transport,game-server.test,game-server-ws.test}.ts`, `apps/server/src/net/shift/{shift-core,shift-core.test,shift-room.test}.ts`.

Commit suggestion: `fix(server-net): keyframe on resync request; refuse malformed ws handshakes before slot claim`

## Update: R1/R2 wiring (patch from M1-W5-T07b-security-residuals-backend-data-engineer.md)
Status: in-review / 2026-11-14. Only `net/**` and `app/server.ts` changed. No api/db edits.

**R2: upload admission wired**
- `net/http-routes.ts`:
  - `RawBodyAuth` is now `(token, remoteAddress) => Promise<string | RawBodyRefusal | null>`. `RawBodyRefusal` is new and exported from the net barrel.
  - `executeRoute` passes the resolved client address to the verifier.
  - A refusal answers 429 `RATE_LIMITED` with `retry-after: ceil(retryAfterS)`, minimum 1, or 60 if the value is not finite. The held body is discarded and no slot is taken.
- `app/server.ts`: `rawBodyAuth: account.admitRawUpload`.

**R1: inflate budget from env**
- `app/server.ts` passes `checkpoints: { inflateBytesPerMinute: MiB*1024*1024, inflateMaxConcurrent, maxQueued }` to `createAccountApi`.

**New test** in `raw-body.test.ts`, on uWS and Node: a refused admission gets 429 + `retry-after: 8` (for 7.2 s) and the RATE_LIMITED body. The verifier received the edge client IP. No slot was taken and the handler did not run. The same IP with an admitted account then gets 200.

**Evidence (Node 26.13.1)**
- `tsc --noEmit -p apps/server`: clean (the earlier api error is gone).
- eslint and prettier on `src/net` and `src/app`: clean.
- `vitest run src/net src/app src/api`: 21 files, 241 passed. `raw-body` + `src/app` re-run: 35 passed.

**NOT RUN:** the R2 limits end to end with real 12/min churn over a socket (the rule values are covered by the api tests), Render, and `pnpm verify`.
