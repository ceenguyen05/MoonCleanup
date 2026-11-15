# M1-W4-T02 / T02b / W5-T07 / T07b: server security review (netcode-security-reviewer)

Date 2026-11-14. Read-only (no source edits, no git). Opus 5.5.
Scope: (1) the raw-body/binary adapter in `apps/server/src/net/**`, both the uWS and Node paths; (2) the checkpoint routes, service and repository (`apps/server/src/api/checkpoints/**`, `packages/db` save code); (3) `splitCheckpointUploadBody` and the T07b contract; (4) ShiftRoom join/auth.

## Verdict

**FAIL (one blocking finding, H1), scoped to the checkpoint feature.** Scope items 1, 3 and 4 PASS with non-blocking findings.

| Scope | Verdict |
| --- | --- |
| 1 Binary adapter (uWS + Node) | PASS, non-blocking M1, L2 |
| 2 Checkpoint routes/service/repo | **FAIL** (H1). Medium M2. CAS, slots and cross-user isolation PASS |
| 3 Framing codec + T07b contract | PASS |
| 4 ShiftRoom join/auth | PASS |
| Earlier M0 close-out PASS | Still holds for the M0 surface. NB1 is addressed (per-IP seat cap, IdleWatch) and so is NB4 (`connectionsCheckingInterval` 2 s, `ws-transport.ts:28`). |

## Blocking

### H1. Decompression amplification in checkpoint verify and download starves the shared CPU (room tick)
- **Where:**
  - Upload verify: `apps/server/src/api/checkpoints/service.ts:189-205`.
  - Download: `service.ts:379-405`. Every page request re-gunzips the slot and re-inflates EVERY chunk.
  - Limits: `rate-limits.ts:27-29`. Upload is 60/h per player. `saveRead` is 40/min per player.
  - Per-chunk bound: `mcck.ts:88,101`. There is a per-chunk bound (256 KiB) but no per-package total.
- **Exploit sketch:**
  1. Create a guest, then a solo Contract.
  2. Upload a valid MCCK with 641 chunks (ids 0-640). Each chunk is 256 KiB of zeros, deflated to 277 B, about 178 KB on the wire. The server inflates 641 x 256 KiB = **160 MiB** and CRCs it.
  3. If any chunk is wrong the upload is rejected, but the cost is still paid. If it is valid it is stored: about 180 KB, far under the 8 MB cap.
  4. Then `GET .../save?page=0` 40 times a minute. Each call re-inflates 160 MiB.
  5. Extra guest accounts add more of the same (guest creation is 5/h per IP, with no IPv6 /64 grouping).
- **Repro (RUN):** `C:\Users\caseyn\AppData\Local\Temp\claude\430d3d07c3d5e4f4\662a92b8-25f6-41a0-b81e-bd8243d1afb8\scratchpad\bomb\bomb.mjs` (Node 22.20, this laptop) uses the same `inflate` options as the service.
  - One verification takes **1.1-1.5 s wall and about 1.5 s CPU**. Of that, about 100 ms is synchronous `crc32` on the main thread.
  - A 20 Hz timer was up to 24.6 ms late even on a multi-core desktop.
  - The libuv inflate threads share the process CPU quota. On Render free (0.1 CPU) that is roughly 15 s of quota per verification, so 40 downloads a minute from one account saturates the instance. Every ShiftRoom tick and every REST route stalls.
  - NOT RUN: the end-to-end upload+download through the harness, and anything on Render.
- **Fix:**
  - Cap the package total: sum of `rawSize` (and header raw size) at or below a budget sized from the real worst-case save. Reject anything above with `size_limit` before inflating.
  - Download must not re-inflate. Either trust the rows verified at upload (check only a stored CRC of the compressed blob), or cache the built pages per `save_seq`.
  - Add a process-wide inflate-bytes budget per minute, so verification can be shed with 503 while rooms are busy (the room-load 503 is already listed as NOT BUILT).

## Non-blocking

### M1 (medium). Unauthenticated clients can hold every raw-upload slot
- **Where:** `net/http-routes.ts:283-301` and `396-403`, `net/client-ip.ts:19-25`.
- Only the `Bearer ` prefix is checked before `gate.tryAcquire`. The JWT is verified after the whole body is read.
- **Sketch:** send `Authorization: Bearer x` with `content-length: 1052674`, then trickle 1 byte every 9 s (under uWS's 10 s idle timeout). That slot is held for 30 s (15 s on Node, see L2).
  - With 4 source IPs, or 4 addresses out of one IPv6 /64 (addresses are not grouped by prefix), every upload in the process gets 503.
  - Impact is upload availability only. Memory stays bounded at about 4 MiB.
- **Fix:**
  - Verify the JWT (a cheap HMAC) before acquiring the slot, and key the slot per account as well as per IP.
  - Add a minimum-throughput rule, for example abort when under 32 KB/s after 5 s.
  - Group IPv6 addresses by /64.
- Repro NOT RUN (the author's slow-body test covers the deadline itself).

### M2 (medium). Profile credit bound is weaker than the trust model states
- **Where:** `service.ts:245-247` (first upload) and `service.ts:238` (slack).
- **First upload:** when `prev === null`, up to 24 h of playtime is credited regardless of the Contract's age. That is 14,400 tenure and 144 commendations at the placeholder caps, per new solo Contract. At `contractCreate` 10/day, that is about 240 h of credit per day per account.
- **Slack:** the 120 s slack applies per upload. With an upload every 20 s, 141 s counts per 20 s, about 2.35x the wall-clock rate. `simTick` is attacker-chosen to match.
- **Fix:**
  - For the first upload, bound credit by `now - contract.createdAt`.
  - Apply the slack once per window, not once per upload.
- Repro NOT RUN (the finding comes from reading the code). Tenure and commendations are shared surfaces.

### L1 (low). The verify queue can run two jobs at once
- **Where:** `service.ts:101-111`. `finally` sets `running = false` before the woken waiter resumes. A caller entering in that microtask gap sees `running === false` and runs too.
- **Repro (RUN):** `...\scratchpad\bomb\excl2.mjs` uses a verbatim copy of the function. At microtask depth 2 it reached max concurrency **2**. This compounds H1.
- **Fix:** hand ownership directly to the waiter (keep `running` true when one is woken).

### L2 (low/info). On the Node path, `requestTimeout` cuts raw uploads at 15 s, not 30 s
- **Where:** `ws-transport.ts:26` vs `http-routes.ts:37`.
- Clients slower than about 0.56 Mbit/s fail a 1 MiB upload on `TRANSPORT=ws`. The gate slot is still released (the socket closes, so `!req.complete` aborts the read).

### Info
- `checkpoints: { expectedBakeHash, knownGameDataVersions }` is not passed in `app/server.ts:123-131`, so the bake and game-data checks only compare the metadata against the envelope. The author already disclosed this.
- `/v1/contracts/:id/join` still returns `joinTicket`. It is harmless (onAuth ignores client tokens), but the field can be dropped.

## Checked and PASS
- **Adapter:**
  - The pre-check order 401 -> 400 -> 413 -> 503 runs before `readBody`, and `onData` is attached synchronously (`http-routes.ts:263-307`).
  - `BodyBuffer` is pre-sized only from a capped, safe-integer length. `bytes()` returns `subarray(0,total)`, so no uninitialized memory can leak.
  - Overflow drops the buffered data.
  - Abort, timeout and handler-finish all release the slot (`finally` at `:338-340`, uWS `onAbort` at `:395`, Node `close`/`error` at `node-http.ts:156-165`).
  - Header dedupe means one content-type. Errors stay JSON, and handler errors never reach a stack trace.
  - CORS: an exact allowlist, `expose-headers` only on non-public answers, and allow-headers/methods unchanged.
  - No tokens or bodies are logged (grepped every `logger.*` in `apps/server/src`).
- **Checkpoints:**
  - The path id, the package `contractId` and the metadata `contractId` must all agree (`service.ts:153,181`).
  - Holder, solo, lease and CAS are re-checked inside one transaction under `SELECT ... FOR UPDATE` on the Contract (`postgres.ts:716-737`).
  - Only the older slot is overwritten, with a CAS on its `save_seq` (`:819-837`). Zero rows rolls back.
  - The 8 MB cap rolls back. All queries go through Drizzle and are parameterized.
  - A stranger gets 404 (`getContract` joins on active membership).
  - Gunzip and inflate are bounded per call (`maxOutputLength`).
  - `decodePackage` bounds every length against `end` before reading (`mcck.ts:69-113`).
  - Rejections return only a reason code.
- **Codec** (`packages/protocol/src/codec/checkpoint-upload.ts:53-68`):
  - `metaLen` is limited to 1..4096 and checked against the body length before the slice.
  - An empty package and anything over 1 MiB are refused.
  - It never throws and never allocates. It matches T07b Decisions 1-3.
- **Join/auth:**
  - The JWT is verified at REST, never in a URL. The ticket is kept server-side, keyed by the reserved sessionId (`join-ticket.ts:57-74`). It is an HMAC, compared with `timingSafeEqual`, single use, valid 30 s, and the replay set fails closed.
  - `onAuth` uses the server-side reserved options and ignores `_authToken` (`shift-room.ts:227-237`).
  - Solo, deleted and banned Contracts get 403 (`app/server.ts:86-95`).
  - Duplicate sessions close with 4106, a full room with 4105, and a protocol mismatch with 4100 (`shift-room.ts:239-260`). Kick is Holder-only.

## Evidence (same file state)
- Ran the authors' tests on Node 26.13.1: `vitest run src/net/raw-body.test.ts src/net/shift src/api/checkpoints src/app/server.test.ts` gave **5 files, 55 passed**. These cover the behaviour on the "Checked and PASS" list. They do not exercise H1, M1 or M2.
- RUN: `bomb.mjs` (H1 cost) and `excl2.mjs` (L1 race), both in the scratchpad.
- NOT RUN:
  - The H1 end-to-end upload+download through the harness.
  - The M1 trickle attack on a live socket.
  - The M2 credit sequence.
  - Render 0.1-CPU measurements.
  - Real Postgres `FOR UPDATE` contention across sessions.
  - A browser CORS check.
  - `pnpm verify`.

## Update: re-review (2026-11-14, fixes only)

**Verdict: PASS. All five findings are closed. No blocking issue remains. Two low residuals are recorded below; neither blocks.** I did not edit any source. The fixes I read: `net/http-routes.ts` (gate, `ipSlotKey`, `watchBodyRead`, held body, `executeRoute`), `net/node-http.ts`, `net/ws-transport.ts:32`, `app/server.ts:153`, `api/checkpoints/{service,exclusive}.ts`.

| Finding | Status | Evidence |
| --- | --- | --- |
| H1 amplification | **Closed** (now low residual R1) | Details below |
| M1 unauthenticated slot hold | **Closed** (low residual R2) | Details below |
| M2 credit bound | **Closed** (low residual R3) | Details below |
| L1 queue race | **Closed** | Details below |
| L2 Node 15 s cut | **Closed** | Details below |

**H1, amplification.**
- Upload: the sum of declared `rawSize` must be at most 32 MiB, checked before any inflate (`service.ts:190-192`). Each inflate is also bounded by its own declared size (`:123-126,208`).
- Download: chunk rows are no longer inflated (`:412-420`). Only the header slot is gunzipped, bounded to 1 MiB.
- Measured (`scratchpad/bomb/bomb32.mjs`, Node 22): the largest package the budget still accepts costs 0.24-0.32 s wall and about 0.44 s CPU, against about 1.5 s before. The 160 MiB package is rejected before any inflate (the authors' test passes).

**M1, unauthenticated slot hold.**
- The JWT is verified with the body held, before `tryAcquire` (`http-routes.ts:423-456`).
- Slots are capped per account, per IP and per IPv6 /64.
- A minimum rate of 32 KB/s applies after 5 s.
- **Live uWS probe RUN** (`scratchpad/bomb/trickle.mts`, production defaults, real 9 s trickle gaps):
  - 4 forged Bearers -> 401 each, and they took no slot.
  - 4 real accounts trickling held all 4 slots, then were all closed at **5,065 ms** and the gate returned to 0.

**M2, credit bound.**
- A cumulative bound against Contract age (`service.ts:248-253`) means a first upload can no longer claim 24 h.
- The per-interval slack is now 20 s (`:254-260`).

**L1, queue race.** `exclusive.ts` hands ownership straight to the woken waiter, and `running` stays true. The authors' test covers microtask depths 0-7.

**L2, Node 15 s cut.** `HTTP_REQUEST_TIMEOUT_MS = BODY_READ_TIMEOUT_MS + 5 s` (`ws-transport.ts:32`).

New holes checked, none found:
- **Held body, uWS:** the stash is capped at 64 KB, then the connection closes.
- **Client goes away during verify:** the abort is checked, the body is discarded, and no slot is taken.
- **Slot release:** `release` decrements both the address key and the account key.
- **`ipSlotKey`:** normalizes case, zero padding, zone ids and v4-mapped forms. The address comes from the edge header, so a client cannot choose its formatting.
- **Download without re-verify:** it serves only the caller's own rows, which were verified at upload, and the client re-checks the CRCs.
- **Auth checks:** the adapter-level 401 and the handler's `authed` use the same verifier.

Residuals (low, non-blocking):
- **R1.** An accepted upload can still inflate up to 32 MiB, about 0.44 s CPU here and roughly 4 s of the quota on Render's 0.1 CPU. That is 60/h per player. There is no process-wide inflate budget and no room-load shed yet (the author deferred it), and the guest-create limit is per IP, not per /64. Recommend that budget/shed once the room-load signal exists, and retuning the 32 MiB budget to real save sizes.
- **R2.** Authenticated accounts can still hold slots for about 5 s per attempt, and gate attempts are not rate-limited. Four guest accounts on four addresses could keep uploads at 503 by reconnecting. The attacker is now attributable. Optionally consume `soloUpload`/`ipRest` at the adapter.
- **R3.** Credit is bounded per Contract, so with `CONTRACT_QUOTA_PER_PLAYER` = 3 one player can earn about 3x wall-clock credit. A per-player wall-clock bound would close it. Separately, a legitimate player who creates the Contract after long offline play gets their first upload flagged `solo_implausible` (no credit). That is a product/design note, not a hole.

Same-state evidence:
- Node 26.13.1: `vitest run src/net src/app src/api` gave **20 files, 223 passed**.
- Probes RUN: `trickle.mts` (live uWS) and `bomb32.mjs`.
- NOT RUN: Node-transport live trickle (the authors' rate-harness test covers it), Render 0.1 CPU, real Postgres contention, browser CORS, `pnpm verify`.
