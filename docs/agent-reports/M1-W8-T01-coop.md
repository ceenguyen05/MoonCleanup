# M1-W8-T01 co-op (server side) - netcode-engineer

Status: server gaps closed; client work remains for other owners.

## Assessment (before)
- Join-in-progress: already worked (addSeat any time, DUST_SNAPSHOT + keyframe on join; shift-room.test late joiner). Seat cap 6 (+1 spare for 4106/4105), 6 per IP (admission) already in place.
- Reconnect-within-grace: already implemented (onDrop holdSeat + allowReconnection, onReconnect resumeSeat + HELLO). No test existed.
- Kick: Holder-only handler existed, but: could kick the Holder role, could not kick a held (dropped) seat, no ban at all (kicked player rejoined instantly), no tests. BAN message is RESERVED/post-MVP.

## Done
- `packages/shared/src/protocol/payloads.ts`: `KickPayload` gains optional `ban?: boolean` (additive; PROTOCOL_VERSION stays 1).
- `apps/server/src/net/shift/shift-room.ts`:
  - kick: target must not be self or a Holder-role seat; works on live or held seats (held seat is released immediately).
  - `ban: true`: closes 4103 BANNED; player added to a session-scoped in-room set (cap 64, room lifetime); `onAuth` throws BANNED for later joins.
  - `onReconnect` with a released seat now closes the client (4102) instead of silently accepting.
- Test `apps/server/src/net/shift/shift-room-coop.test.ts` (real sockets): join-in-progress, staff/self/Holder kick FORBIDDEN, kick 4102 + kick_notice + rejoin allowed, ban 4103 + rejoin refused, 7th player 4105, held-seat kick, reconnect within grace keeps same seat.
- Solo path: no cost (checks only run on kick/join/reconnect).
- Results: coop test 2/2, shift-room.test 8/8, shared protocol tests 69/69, tsc clean for apps/server and packages/shared.

## Gaps left
- Lasting (24 h) ban and supervisor kick: api layer / post-MVP (BAN, VOTE_KICK stay RESERVED).
- 16-vehicle netsim smoothness (120+-30 ms) not measured here; needs qa bots (W8-T04). Cap is 6 per owner decision.
- Reconnect test closes ws with 4010 (SDK auto-reconnect), not a true network drop.

## Client side (done in a second pass)
- Already present: close codes 4102/4103 classify as non-retryable failures (`classifyClose`), `failureOfCloseCode` maps them to strings, a ban at join (consume error 4103) fails without re-joining.
- `apps/client/src/net/room-session.ts`: new `sendKick(playerId, reasonCode, ban?)` (only when joined; `ban` key sent only when true), `kickNotice` (last validated `kick_notice`, reset on start), `roster()` / `onRoster(listener)` read from Schema patches (computed only while a listener exists, so no cost otherwise), exported `rosterOf`/`RosterEntry`.
- `apps/client/src/ui/online`: `RosterList.tsx` on the on-shift view (Holder sees "Clock out" and "Remove for this shift" with a confirm step, only on rows that are not self and not a Holder; staff see the roster only); `OnlineEntryPort.roster?` (optional `OnlineRosterPort`: current/subscribe/kick) plus `canModerate`; CSS classes; strings in `ui/strings.ts` (`online.onShift.roster`, clearer `errors.banned`).
- Tests: room-session.test 27/27 (kick/ban verdicts, no re-join on ban, sendKick payload, roster), online tests (roster controls Holder-only, 4102/4103 text); together 59/59 passed; apps/client tsc clean. No processes started.

## Wiring follow-up (not my files)
- The app owner (online-launch / remote-room-host) must pass `roster` in the `OnlineEntryPort` it builds: `current: () => session.roster()`, `subscribe: session.onRoster`, `kick: (id, reason, ban) => session.sendKick(id, reason, ban)`. Until then the roster list does not render (absent port field).
- Optionally show `session.kickNotice.reasonCode` next to the kicked/banned message.
