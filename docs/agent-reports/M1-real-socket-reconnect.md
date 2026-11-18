# M1 real-socket reconnect + invite join (follow-up to M1-online-entry-browser-check)

Test added (only file touched): `tools/bots/harness/reconnect-ui.e2e.ts` (opt-in vitest e2e, not in any package suite).
Run: `fnm exec --using=26 pnpm --dir tools/bots exec vitest run --config harness/vitest.e2e.config.ts harness/reconnect-ui` (~36 s).

Setup: real `apps/server` `startServer` in-process (memory persistence, `ws`, ephemeral port 0, fake secrets, no Render/Neon/internet),
two real client stacks (OnlineRoom -> RoomSession -> @colyseus/sdk), B routed via a clean netsim proxy so its socket can be killed.
Port 5193 untouched; no dev server started; after the run no listener of mine remained.

| Check | Result | Evidence |
|---|---|---|
| Invite parse (`/join/<code>` lower-case, `?join=` spaced, `/join/nope`) -> canonical code / null | PASS | forms JWXP7D7D, JWXP7D7D, null |
| Bad code rejected by server; real code redeemed via `joinByCode` -> same contractId; both clients join that room | PASS | badCodeRejected true |
| Two clients in same room, each sees the other's avatar slot, mirrors converge | PASS | slots "0" on both |
| Drop 1: SDK close 4010 on B | PASS | phases reconnecting -> resyncing -> joined; net.status lost -> connected (previous=connected) |
| Drop 2: hard network kill (proxy closed, 1006), restart after 1.5 s | PASS | phases joined -> reconnecting -> joined; net.status lost -> connected |
| Same seat/state after each drop | PASS | same sessionId, A's avatar slots unchanged (no duplicate seat), B's slots unchanged, worldHash A == B after A kept sweeping while B was away, failure null |
| UI reconnect chip follows | PASS (store + view model) | real event bus -> same `session.set` dispatch as AppNetModule -> real ui-store -> `connView`: chip sequence `lost/lost` -> `connected/connected` for both drops |

Caveats:
- The chip is verified at store + `connView` level (the exact inputs OnlineEntry renders as `data-conn` and label), not by rendering React/DOM; the DOM side was shown in the earlier sandbox check.
- Node `WebSocket` gets an Origin header via a test shim (same as the existing online-loop test); the browser/WebGPU boot path was NOT run.
- Observation, not a defect: during in-place SDK reconnection (`reconnecting` phase) the chip reads "lost" (connectionStateOf maps it to lost) and returns to "connected" at `resyncing`. Fine, but the label says "Signal lost" while it is actually retrying; consider a "reconnecting" label if desired.
- No defects found in net/room-session.ts; no non-test source edited; STATUS.md and git untouched.
