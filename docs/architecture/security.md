# Security — Moon Cleanup

Status: **Planning baseline (2026-11-12)** · Owners: backend-data-engineer (auth, API, DB), netcode-engineer (room edge), devops-engineer (headers, env, CI), gameplay-systems-engineer (sim-side validation).
Canonical: [tech-stack.md](tech-stack.md) (guest-first auth: opaque hashed refresh token + 15-min `jose` JWT, Bearer, token in Colyseus join options; zod 4; rate-limiter-flexible). Evidence: [data-auth-observability.md §5, §7](../research/tech/data-auth-observability.md), [platform-limits.md](../research/tech/platform-limits.md), [moon-sweepers-reception.md §4 C6, §8](../research/moon-sweepers-reception.md).

Scope: a free, non-commercial co-op game with no payments and no personal data beyond a display name. The main risks are **griefing**, **cheating that ruins shared Contracts**, **resource exhaustion of the $0 tier**, and **token theft via XSS**.

## 1. Server authority

| Domain | Client may send (intent) | Server computes / decides |
| --- | --- | --- |
| Movement | Input vector, camera yaw/pitch, buttons (`INPUT`) | Position, velocity, grounding, collisions, Hop Pack fuel, Ballast Soles gravity, speed limits |
| Vehicles | Throttle/steer/brake/boost via `INPUT`; interact to enter | Vehicle pose, seat assignment, ownership checks, knock-back |
| Cleaning | Tool-active button, aim pitch, aim distance | Tool-head path, strokes, ledger rasterization, dust removed (kg), Cell fill, plot state (Grimy/Opened/Polished), Inspector's Stamp bonus |
| Selling | Interact at Assay Counter / puck onto Receiving Gate | Weight, price from game-data, payout to the shared wallet |
| Purchases | `purchase {requestId, itemId}` | Proximity to Requisitions Desk / Ops Console / Motor Pool, prerequisites and tier order, price (incl. Rebate discount), wallet balance, role permission, result |
| Building | `build_*` with snapped placement | Snapping, collision, piece caps, cost/refund (Reclaim = 100 % refund), ownership, permission |
| Robots / automation | Nothing (purchases only) | All robot behaviour, Glide Rail flow, machines (Puck Former, Bead Kiln, Tile Sinterer), power |
| Teleport | `relay_teleport {outpostId}` | Visited, near a Relay Pad, not in a vehicle, fee |
| Progress | Nothing | Shine Index, achievements, Tenure, Commendations, Contract Fulfilled |
| Identity | Display name (REST), cosmetics choice (owned only) | Player ID, role, membership, bans |

Anything a client claims beyond intent (e.g., a position in an input) does not exist in the protocol, so it cannot be spoofed.

## 2. Anti-cheat basics

| Check | Where | Rule | Action |
| --- | --- | --- | --- |
| Input rate | Room edge | One input sequence number consumed per tick (2 during backlog catch-up); substituted seqs are consumed and late duplicates dropped, so an input is never applied twice ([netcode.md §5.1](netcode.md)); token bucket derived from `SIM_TICK_HZ` (1.5 × rate, burst 2 × rate, [netcode.md §11](netcode.md#11-rate-limits-per-connection-in-memory-rate-limiter-flexible)) | Extra inputs dropped — "speed hacking by input flooding" is impossible |
| Input values | Decoder + sim | Move vector length clamped to 1; integers only; enums range-checked | Clamp |
| Speed invariant | `RoomSim` post-step | Displacement per tick ≤ max speed of current mode (walk, hop, vehicle type + Afterburner) × dt × 1.2 | Snap back + `speed_violation` audit (signals a sim bug or exploit) |
| Teleport invariant | `RoomSim` post-step | Position change > 10 m in one tick without a teleport event | Snap back + `teleport_violation` audit |
| Stroke validity | Sim (server strokes only) | Strokes are produced from the server tool-head path: reach ≤ tool reach (+ Telescoping Pole), width/strength from tool tier + upgrades | No client strokes accepted |
| Interaction range | Sim | Distance from server pose to target ≤ interact radius (game-data) | Reject |
| Purchase validation | Sim, atomic in tick | `requestId` dedupe (last 64 per player); price recomputed; wallet ≥ price; prerequisites; role permission | `purchase_result {ok:false, code}` |
| Build validation | Sim | Snapped grid, no overlap, per-plot and per-Contract piece caps, ownership for Shift/Reclaim | Reject |
| Economy sanity | Room stats | Lumens/min per room above 5× expected curve (balance-sim) | Log + Sentry warning (no auto-punish) |
| Determinism abuse | — | Client prediction is never trusted; reconciliation always resets to server state | — |

## 3. Authentication and token lifecycle

| Item | Specification |
| --- | --- |
| Guest creation | `POST /v1/auth/guest {displayName?}` → player + profile + recovery-code identity. Returns refresh token, access JWT and a **one-time recovery code** (shown once, "save this to recover your account") |
| Refresh token | 256-bit random, base64url; stored only as HMAC-SHA256 with `REFRESH_TOKEN_PEPPER`; TTL 180 days; **rotated on every use** |
| Rotation grace window (M13) | A lost response (cold-start proxy timeout, tab closed mid-request) makes the client retry with the token it already sent. So, when the presented token was replaced **≤ 60 s ago** (`replaced_at`, DB clock) and is the **immediate predecessor** of the family's newest token: (a) if that successor has never been used, it is revoked (`superseded`) and a fresh successor is issued — the retry succeeds and the family survives; (b) if the successor has already been used (another tab or browser won the race), reply 409 `TOKEN_SUPERSEDED` without revoking anything — the client re-reads `localStorage` / waits for the other tab's BroadcastChannel message. Only reuse of a token **older than the immediate predecessor, or after 60 s**, counts as theft → revoke the whole family + `token_reuse` audit |
| Access token | JWT, HS256 via `jose`, signed with `JWT_SECRET`; 15-min `exp`; claims `sub` (playerId), `iat`, `exp`, `iss` = `moon-cleanup`, `aud` = `mc-<ENV_NAME>` (a staging token is rejected by prod), `jti` |
| Key rotation | Optional `JWT_SECRET_PREVIOUS` accepted for verification for ≤ 15 min after a rotation |
| Client storage | Refresh token in `localStorage` (for a guest the token *is* the account); access token in memory only. One tab refreshes at a time (Web Locks / BroadcastChannel); others pick up the new token |
| REST | `Authorization: Bearer <access JWT>`; no cookies anywhere → no CSRF surface ([data-auth-observability.md §5.1](../research/tech/data-auth-observability.md)) |
| Rooms | Client calls `POST /v1/contracts/:id/join` with the Bearer JWT (never in a URL); the server checks membership/ban, reserves a seat in the Contract's single room ([netcode.md §9.3](netcode.md)) and returns the seat reservation plus a 30-s single-use **join ticket** (HMAC over playerId, roomId, expiry). `onAuth` verifies the ticket and the JWT's signature, `exp`, `aud`. Public Colyseus matchmake methods are disabled. The WebSocket URL carries only Colyseus' single-use seat reservation id. Auth is checked at join; an established room connection is not cut when the JWT expires |
| Reconnect | Client refreshes the JWT if < 60 s left, then reconnects; server checks the seat's `playerId` matches |
| Recovery | `POST /v1/auth/recover {code}` → verifies HMAC against `identities`, revokes all families, issues a new family + new recovery code. Codes are **≥ 80 bits** (16 Crockford base32 characters from a CSPRNG), so online guessing is hopeless even before throttling. Throttles: per IP (§5) **and global**: > 100 failed recovers in 1 h → the endpoint returns 429 for 15 min for everyone, Sentry alert, `recover_global_lock` audit; every failure writes a rate-limited `recover_failed` audit row |
| Logout | Revokes the current family |
| Account linking (post-launch) | OAuth (PKCE) adds an `identities` row to the existing player ([data-auth-observability.md §5.4](../research/tech/data-auth-observability.md)) |

## 4. Transport, origins and headers

### 4.1 CORS (REST and Colyseus matchmake routes)

| Environment | `ALLOWED_ORIGINS` (exact, comma-separated, no wildcards, no suffix matching) |
| --- | --- |
| production | The Vercel production origin only (e.g. `https://moon-cleanup.vercel.app`) |
| staging | Vercel branch URL of `main` (`https://moon-cleanup-git-main-<scope>.vercel.app`) + an explicit, short list of specific preview branch URLs added by Cee when needed + `http://localhost:5173`…`http://localhost:5182` (dev ports) |
| local | `http://localhost:5173+N` |

Rules: response echoes the request origin only on exact match; `Access-Control-Allow-Credentials` never set; allowed headers `Authorization, Content-Type`; methods `GET, POST, PATCH, DELETE`; preflight cache 600 s. Exception: `GET /healthz` returns `Access-Control-Allow-Origin: *` (no data, needed for wake probing). Never match `*.vercel.app` ([data-auth-observability.md §7.3](../research/tech/data-auth-observability.md)).

### 4.2 WebSocket origin check

At upgrade (uWS transport hook) the `Origin` header must be in `ALLOWED_ORIGINS`; otherwise 403 before the socket opens. Bots in tests send an allowed `Origin`. This blocks drive-by pages; it is not authentication (non-browser clients can forge it), which is why `onAuth` exists.

### 4.3 TLS

| Hop | TLS |
| --- | --- |
| Browser ↔ Vercel / Render | HTTPS / WSS only (both terminate TLS; HTTP redirected) |
| Server ↔ Aiven PG | TLS with the Aiven project CA from `DATABASE_CA_CERT` (PEM), full verification (CA + hostname); connection refused otherwise. Never `rejectUnauthorized: false` |

### 4.4 Client response headers (`vercel.json`, devops-engineer)

| Header | Value |
| --- | --- |
| `Content-Security-Policy` (header, static in `vercel.json`) | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://*.onrender.com wss://*.onrender.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io; img-src 'self' data: blob:; style-src 'self'; font-src 'self'; media-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'` |
| CSP (meta, per environment) | The client build injects `<meta http-equiv="Content-Security-Policy" content="connect-src 'self' <VITE_SERVER_HTTP_URL origin> <VITE_SERVER_WS_URL origin> <Sentry ingest origin>">` into `index.html` (Vite HTML transform). Browsers enforce **both** policies, so the effective `connect-src` is the exact per-environment origins while `vercel.json` stays static (one file serves production and staging). `frame-ancestors` can only come from the header, which is why it stays there |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `gamepad=(self)`, `fullscreen=(self)` (pointer lock needs no policy) |
| `Cross-Origin-Opener-Policy` | `same-origin` (no COEP: no SharedArrayBuffer in MVP) |
| `/hub/*` | `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=3600` (public metadata kit) |

No third-party scripts, no analytics tags; fonts self-hosted. This CSP pair is the main XSS mitigation for the `localStorage` refresh token. CI checks that `vercel.json` carries the headers above (environments.md §4.2).

## 5. Rate limiting

`rate-limiter-flexible`, **in-memory** store (single instance; counters reset on restart — acceptable).

**Client IP (M14):** derived **only** from the single client-IP header that Render documents for its edge, named by `CLIENT_IP_HEADER` (default `true-client-ip`; the M0 spike confirms the name from Render's docs and a live request). Arbitrary `X-Forwarded-For` chains are **never** trusted and the left-most entry is never used (an attacker controls it). If Render documents only `X-Forwarded-For`, set `CLIENT_IP_HEADER=x-forwarded-for` and the server takes the **right-most** entry (the one Render's edge appended). If the header is missing on a request, the request is keyed by a constant `unknown` bucket with a tighter limit and logged once per minute (never by the proxy's socket address, which would put everyone in one bucket silently). M0 test: a request with a forged `X-Forwarded-For: 1.2.3.4` must be keyed by the real client address.

| Key | Limit | Response |
| --- | --- | --- |
| `POST /v1/auth/guest` per IP | 5 per hour, 20 per day | 429 + `guest_create_limited` audit |
| `POST /v1/auth/refresh` per IP | 60 per hour | 429 |
| `POST /v1/auth/recover` per IP | 5 per hour | 429 (brute-force guard) |
| `POST /v1/auth/recover` global (failures) | 100 per hour | 429 for 15 min, Sentry alert (§3) |
| `POST /v1/contracts/join-by-code` per IP | 10 per min, 50 per hour | 429; code space 32⁸ ≈ 1.1 × 10¹² |
| `POST /v1/contracts` per player | 10 per day (plus the 3-owned quota and the storage refusal of [data-model.md §5.1](data-model.md)) | 429 / 507 |
| `POST /v1/contracts/:id/join` per player | 20 per min | 429 |
| Other REST per player | 120 per min | 429 |
| Other REST per IP | 300 per min | 429 |
| Room joins per IP | 30 per min | 429 |
| Concurrent WebSockets per IP | 8 | Reject at upgrade |
| In-room messages | See [netcode.md §11](netcode.md#11-rate-limits-per-connection-in-memory-rate-limiter-flexible) | Drop / close 4104 |
| Request body size | REST 16 KB; WS inbound message 2 KB (uWS `maxPayloadLength`) | 413 / close |

## 6. Input validation

| Edge | Mechanism |
| --- | --- |
| REST bodies, query, params | zod 4 schemas from `packages/shared/src/api/rest.ts`; unknown keys stripped; strings length-bounded; UUIDs validated |
| Control messages | zod schema per message type at the room edge; failure → drop + violation counter |
| Bytes messages | Hand-written decoders in `packages/protocol` check exact/maximum length **before** reading, range-check every enum/ID (plotId < plotCount, chunkId ≤ 640 per [WDS §2.4](world-and-dust-simulation.md)), only accept dust requests inside the client's dust radius, never allocate from a client-supplied length |
| Env vars | zod schema at boot; the server refuses to start on a missing/invalid variable (see [environments.md](environments.md)) |
| Display names | NFC-normalised; 3–20 chars; letters, digits, space, `-`, `_`, `.`; no leading/trailing spaces; blocklist (profanity + reserved: DOT, Brightside, admin, moderator, staff); rendered as text only (React escaping, never `innerHTML`) |
| Contract names | 3–32 chars, same character rules |
| Balance data | game-data tables validated by `shared/config` zod schemas in CI and at server boot |

## 7. Secrets handling

| Secret | Lives in | Never in |
| --- | --- | --- |
| `JWT_SECRET`, `JWT_SECRET_PREVIOUS`, `REFRESH_TOKEN_PEPPER` | Render dashboard (per service; Render "generate value" or 32+ random bytes base64) | Repo, Vercel, logs, Sentry |
| `DATABASE_URL` (contains password) | Render dashboard; Cee's local `.env` for admin only | Repo, Vercel, CI logs |
| `SENTRY_AUTH_TOKEN` (source-map upload) | Vercel dashboard (build-time, non-`VITE_`) | Client bundle |
| `DATABASE_CA_CERT` | Render dashboard (public certificate, kept with the other DB settings for convenience) | — |
| `VITE_*` | Vercel dashboard — **public by definition**, baked into the bundle | Must never hold a secret |

Rules: every package with env vars has a `.env.example` listing names and placeholders only (owned by devops-engineer); real `.env*` files are git-ignored; GitHub secret scanning + push protection enabled; pino redacts `authorization`, `token`, `refreshToken`, `code`, `password`, `DATABASE_URL`; Sentry `sendDefaultPii: false` with a `beforeSend` scrubber for the same keys; a leaked secret is rotated in the dashboard and the service redeployed (rotating `JWT_SECRET` logs everyone out within 15 min; rotating `REFRESH_TOKEN_PEPPER` invalidates all refresh tokens and recovery codes — avoid unless compromised).

## 8. Abuse in Open Shifts

Lessons: griefing, kicks and public-lobby surprises were top multiplayer complaints for the reference game ([moon-sweepers-reception.md §4 C6, §8](../research/moon-sweepers-reception.md)).

| Control | Behaviour |
| --- | --- |
| Private by default | New Contracts default to Private Shift; making one Open requires a confirm dialog: **"Strangers can change your moon."** (cleaning, selling and anything you allow below) |
| Joiner warning | Joining an Open Shift shows "This is someone else's Contract; the owner can remove you." |
| Roles | One enum everywhere — DB (`contract_members.role`), Schema (`PlayerInfo.role`), REST DTOs and control messages: **`holder`** (contract owner, one), **`supervisor`** (appointed by the Holder via `appoint_role`), **`staff`** (redeemed Private invite), **`temp`** (Open Shift drop-in). Names and permissions per [GDD §7.5](../design/GDD.md) |
| Temp defaults (GDD §7.5) | Can clean, deliver and sell (income to shared wallet), place builds (tagged with the author), use Relay Pads. Spending is **Loaner Kit** only: at most the lower of 2% of the wallet and 25,000 LM per 10 min, own tools and vehicles only. Cannot buy shared items (Promotions, Flight Plan, robots, machines), cannot sell or drive others' vehicles, cannot Shift/Reclaim others' builds (own only), only 1 personal ping instead of Flare Beacons. Holder toggles `tempCanBuild`, `tempCanSpendShared`, `tempCanDriveShared` |
| Staff / Supervisor | Staff: everything except kick/ban, rename, delete, permissions, invite rotation; `vote_kick` of Temps when no Holder or Supervisor is online (majority of online Staff, 60 s vote, `vote_kick_state` messages, `vote_kick` audit). Supervisor: also kick and 24 h ban. Only the Holder changes room type and appoints roles |
| Kick | Holder (and Supervisor); immediate close 4102; same player blocked from that Contract for 15 min (in memory); `kick` audit |
| Ban | Holder (Supervisor: 24 h ban only); persisted in `contract_members.status = banned`; enforced in `onAuth` and join-by-code; `ban` audit; unban via member list |
| Ban evasion | New guest accounts are rate-limited per IP (§5); the Holder can switch the Contract to Private instantly (kicks no one, blocks new Temps) |
| Invite code | 8-char Crockford base32; the Holder can rotate it any time (old code dies, existing members stay) |
| Communication | No free-text chat in Open Shifts at MVP: quick-chat phrases and ping markers only (decision recorded in GDD §7.5) |
| Reports | "Report player" → `report` audit row (reviewed by Cee; no moderation staff) |
| Protecting progress | Reclaim is limited to the placer (or Holder/Supervisor); purchases by Temps capped by Loaner Kit and permissions; Holder-only Contract deletion |

## 9. Privacy

| Topic | Rule |
| --- | --- |
| Data collected | Random player ID, display name, gameplay progress, timestamps, token hashes. No email, no real names, no IP addresses stored (only monthly-salted IP hashes in `abuse_events`, 90 days) |
| Cookies | None. `localStorage`: refresh token, settings, quality preset |
| Sentry | No PII, IP storage disabled in project settings, tokens scrubbed, session replay off |
| Logs | Render 7-day retention; no tokens or raw IPs at `info` level |
| Deletion | Locker → "Delete my data" → `DELETE /v1/me` (re-auth with a fresh token) → owned Contracts with other active members get a new Holder (most active Supervisor, else Staff, [data-model.md §5](data-model.md#5-retention)); the rest are deleted; memberships removed, audit references set null |
| Inactive guests | Removed after 365 days ([data-model.md §5](data-model.md#5-retention)); stated in the Locker |
| Notice | A short privacy page in the client (Credits/Settings) states the above |
| Children / regional law | Out of scope for this doc (Open issue 3) |

## 10. Dependencies and supply chain

| Rule | Detail |
| --- | --- |
| Pinned versions | Exact versions in every `package.json`; `pnpm-lock.yaml` committed; installs with `--frozen-lockfile` in CI, Vercel and Render |
| uWebSockets.js | Not on npm: install from the GitHub release tag pinned to an exact version/commit; verify the tag in review |
| Install scripts | pnpm's build-script allowlist lists only the packages that need it (e.g., uWS binary, esbuild-class tools) |
| Dependabot | Weekly, grouped minor/patch per area; engine-level majors ignored (ADR required, [tech-stack.md §4](tech-stack.md)) |
| Audit | `pnpm audit --prod` in CI (high/critical fail on server deps) |
| GitHub Actions | Third-party actions pinned by commit SHA; `GITHUB_TOKEN` least privilege; no secrets for PRs from forks |
| New dependency | Needs an ADR and installation between waves by devops-engineer ([module-boundaries.md §3](module-boundaries.md)) |
| Assets | Licence ledger per asset (ASSET_LICENSES); no runtime CDN scripts |

## 11. Threat model

| # | Threat | Asset | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- | --- |
| T1 | Speed / teleport / infinite-dust cheats | Shared Contract fairness | Med | High | Input-only protocol, server sim, invariants (§1–2) |
| T2 | Purchase or economy exploits (replay, negative quantity, race) | Shared wallet | Med | High | Server pricing, idempotent `requestId`, atomic tick application, zod |
| T3 | Griefing in Open Shifts (Reclaim, spending, blocking) | Contract progress | High | High | Private default, permissions, kick/ban, invite rotation (§8) |
| T4 | XSS steals refresh token | Player account | Low | Med | Strict CSP, no third-party scripts, React escaping, token rotation + reuse detection |
| T5 | Stolen/replayed refresh token | Account | Low | Med | Rotation, family revoke outside a 60 s predecessor-only grace window, hashed storage, ≥ 80-bit recovery codes with per-IP and global throttles |
| T5b | Legitimate retry mistaken for theft → guest account loss | Account + owned Contracts | Med | High | Grace window (§3); 409 `TOKEN_SUPERSEDED` for cross-tab races |
| T6 | Invite-code brute force | Private Contracts | Low | Med | 40-bit codes, per-IP limits, rotation |
| T7 | Guest account farming / ban evasion | DB size, moderation | Med | Med | Per-IP guest limits, retention, ban list per Contract |
| T8 | DoS of the 0.1-CPU server (message floods, many sockets, huge payloads) | Availability | Med | High | Per-connection limits, per-IP socket cap, payload caps, admission control |
| T9 | Bandwidth exhaustion → Render suspension | Availability for the month | Med | High | Efficient protocol, logging; owner accepted risk (no cap) |
| T10 | Malformed binary crashes decoder | Availability | Med | High | Bounds-checked decoders, fuzz tests, per-message try/catch at the edge |
| T11 | DB credential leak | All data | Low | High | Dashboard-only secrets, TLS with CA, per-env roles, rotation |
| T12 | Cross-environment token use | Prod data | Low | Med | `aud` per env + distinct secrets |
| T13 | Malicious dependency / compromised action | Everything | Low | High | Pinning, lockfile, audit, SHA-pinned actions, review |
| T14 | Save corruption by bug | Contract | Med | High | Validate-before-write, CRC, optimistic `save_seq`, golden fixtures |
| T15 | Split-brain (two instances or two rooms own one Contract) | Contract | Low | High | Room registry + REST-only joins, lease CAS on DB `now()`, `save_seq` guard with full-transaction rollback |
| T16 | Origin spoofing from a hostile page | Player actions | Low | Low | Exact CORS + WS origin check; Bearer tokens not sent automatically |
| T17 | IP spoofing via forged `X-Forwarded-For` to dodge per-IP limits | Availability, abuse limits | Med | Med | Render-documented header only, right-most entry if XFF (§5); M0 forged-header test |

## 12. Open issues

1. Research ([data-auth-observability.md §5.3](../research/tech/data-auth-observability.md)) preferred an auth-message-first WebSocket handshake; canonical decision is the JWT in Colyseus join options. Kept canonical; the token travels in the matchmake POST body, not a URL, so the research concern (tokens in URLs/logs) is met.
2. The exact name of Render's documented client-IP header is unverified; the rule of §5 is fixed, only `CLIENT_IP_HEADER`'s value may change after the M0 check.
3. Age/regional privacy requirements (e.g., children's privacy rules) are not assessed; needed before public promotion.
4. *(Closed 2026-11-12)* Role enum is `holder | supervisor | staff | temp` in every layer (§8); contracts-architect writes it in the Wave-0 contracts.
