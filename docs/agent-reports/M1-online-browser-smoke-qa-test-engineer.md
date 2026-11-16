# M1 online browser smoke (local server) - qa-test-engineer

Setup: server apps/server on :2571 (PERSISTENCE_DRIVER=memory, ALLOWED_ORIGINS=http://localhost:5311), client Vite on :5311 (watch/HMR disabled via a temporary config because concurrent source edits kept page-reloading the app), Playwright Chromium on SwiftShader (render fell back to webgl2 tier C, as expected). Node 26.13.1. No source edits; temp probe/config files deleted. Run cut short by turn limit: PARTIAL.

| Check | Result | Notes |
|---|---|---|
| Server + client boot, guest sign-in (POST /v1/auth/guest 201, /refresh 200) | PASS | Server boot 2.5-12 s. |
| Page A creates Private Shift (POST /v1/contracts 201, join 200, /healthz) | PASS | Invite code shown as "XXXX XXXX" (with a space). |
| A reaches in-room; snapshots flow | PASS | `__mcOnline.stats()`: phase "joined", framesApplied 270-341, keyframes 1, snapshotsInstalled 1, snapshotsRefused 0, dust snapshots 1. Inputs not exercised (inputsSent 0). |
| Console errors on A | PASS | Only expected GPU/adapter warnings. |
| B joins via /join/<code> | BLOCKED / not verified | Run 1: B's guest creation got 429 (guest_create_limited); B showed only the launcher. Run 2 (fresh server): B stage did not finish within the 100 s script timeout; no result captured. Not concluded as a product bug. |
| Remote dust on B reflects A's polish | NOT RUN | Needs B in room; also no UI-free way to polish a plot online (`__mcDustFeed.sweep` is solo-only). |
| ShiftState on B | NOT RUN | As above. |
| Reconnect (close/reopen B) | NOT RUN | |
| Save-sync indicator false conflict | NOT RUN | hud-sync present on A, no conflict seen, but not exercised with two clients / sync forced. |
| Real (non-guest) sign-in | BLOCKED | Guest tokens only; no credentials. |

## Continuation (B stage, headless Playwright Chromium, SwiftShader; server restarted, CLIENT_IP_HEADER blank, memory store)

| Check | Result | Notes |
|---|---|---|
| 429 root cause | EXPLAINED | Server needs ENV_NAME/JWT_SECRET/REFRESH_TOKEN_PEPPER (dummy values) to boot. Earlier 429s were the shared "unknown" IP bucket plus 5/h guestCreate; a restart with CLIENT_IP_HEADER= (socket IP) gave no 429 in the final run. |
| A in room | PASS | phase joined, snapshots 1 to 3, refused 0, shiftStates 3, rtt 3 ms. |
| B joins via /join/<code> (code without space) | PASS (with caveat) | Page loads the launcher; the join form is NOT auto-opened or filled by the link in my probe. The join-code input held "0PFB 5EY6" only after I clicked the launcher, then join-private. B reached phase joined, online-chip=connected, leave-shift visible, snapshots 1 to 2, refused 0. Whether the link pre-fills the form (OnlinePanel initialInvite) was not isolated: my probe clicked the launcher first. |
| ShiftState on B | PASS (weak) | host.shiftStatesEmitted 1, shiftStatesInvalid 0. |
| Remote dust on B | NOT VERIFIED | B dust snapshots 1 to 2, ready true, but strokes 0 and deltas 0 on both clients: A's held sweep produced no strokes (A held at a point in a 640x400 viewport; no online-polish UI path). Not a product verdict. |
| Reconnect (close/reopen B) | INCONCLUSIVE | B2 page showed no data-testid ids within 6 s. Not concluded. |
| Environment | NOTE | Two SwiftShader pages in ONE Chromium process starved or crashed ("Page crashed", goto timeouts, 320x200 B page loaded only in a separate browser process). Use one browser process per client for local multi-client runs. Vite also died once between runs and had to be restarted. Joined B showed rtt 2761 ms in its first sample (software rendering stall), 3 ms later. |

## Findings
1. Guest-create rate limit is 5 per hour per IP (RATE_RULES.guestCreate). Each fresh browser context consumes one, so multi-client local testing hits 429 fast; a server restart resets it (memory store). Suggest a dev-only override, or reuse storageState in tests. Whether B's 429 in run 1 was exactly this was not confirmed (guest calls per page load not counted).
2. Vite dev server page-reloads on every concurrent-writer edit (e.g. SaveConflictPrompt.tsx), breaking long browser runs; use a no-watch config or wait for edits to settle.
3. Invite code is displayed with a space; /join/<code> was given without it. Client tolerance of the space not verified.

## Cleanup
(Continuation: servers on 2571/5311 killed again, probe and temp vite config deleted, all browsers headless and closed by the script, no listeners remain.) Servers on 2571 and 5311 stopped; Playwright browsers were closed by the script. Ports 2571/2581/5311 confirmed not listening. Temp files tests/e2e/_probe.mjs and apps/client/_qa.vite.config.mjs removed.

## Follow-up: headless Node protocol-level verification (no browser)

New files (only): `tools/bots/harness/online-sync.e2e.ts`, `tools/bots/harness/vitest.e2e.config.ts` (opt-in, not in any package `test`; harness dir is outside tools/bots tsconfig).
Run: `cd tools/bots; pnpm exec vitest run --config harness/vitest.e2e.config.ts` (add `NETSIM=typical` for 120 ms +/- 30, 1% loss via tools/netsim, one proxy per client). Node 26.13.1 via PATH prefix. Real server in-process (`startServer`, ws transport, memory store, dummy secrets, per-client `true-client-ip` so no guest 429) plus two real client stacks (apps/client OnlineRoom, RoomSession, @colyseus/sdk 0.18.10). Nothing left running (everything is in-process; proxies and rooms closed in afterAll).

| Check | Result | Evidence |
|---|---|---|
| Existing `apps/client/src/app/online-loop.integration.test.ts` | PASS (32 s) | A strokes reach B mirror, worldHash equal, avatars seen, ShiftStateView valid. |
| Remote dust deltas (A polishes, B receives) | PASS clean and typical | clean: B strokes 25, deltas 2, 43 frames; typical: strokes 23, deltas 1, 42 frames; ledgersInvalid 0, checkMismatches 0, mirrors equal and changed from start. |
| In-place drop of B (SDK close 4010, seat hold) | PASS clean and typical | phases reconnecting, resyncing, joined; SDK reconnect on attempt 1; 1 keyframe + 1 dust snapshot reinstalled; B hash == A hash after A kept sweeping. Absence only ~0.5 s here (first SDK retry). |
| Network kill of B (netsim proxy closed, restarted after A swept 3 s; typical only) | PASS | B retried 4 times (0.5/1/2/4 s), recovered 4.2 s after proxy return; A hash changed while B away; B hash == A after resync; failure null. |
| Consented leave, fresh join of same player | PASS | join 131 ms clean, 662 ms typical; snapshot installed; mirror == A after more sweeping. |

Defects: none found in the product code. Observations: (1) clean run only, A's own session logged 1 resync / 2 keyframes (framesAwaitingKeyframe 1) around B's drop; not seen in the typical run; reason not isolated, no divergence resulted. (2) Delta count is low (1-2) because strokes mostly arrive in FRAME stroke sections (23-25); the DUST_LOG path is exercised lightly. (3) Browser-only items still unverified: `/join/<code>` form prefill, space-tolerant invite code, UI reconnect indicator.
