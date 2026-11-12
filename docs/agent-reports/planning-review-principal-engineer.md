# Planning review: principal engineer (independent)

Date: 2026-11-12 · Reviewer: independent principal engineer (did not author the docs) · Scope: CLAUDE.md, `docs/architecture/*` (tech-stack, module-boundaries, system-overview, netcode, data-model, world-and-dust-simulation, rendering-pipeline, security, performance-budgets, environments), ADR index plus ADR-0009/0015/0016/0018, `render.yaml`, `vercel.json`, `turbo.json`, root and workspace `package.json` files, `.github/workflows/ci.yml` and `.github/actions/setup-workspace`.
Owner constraints were taken as given and not re-argued: $0 hosting (Vercel Hobby, Render Free 0.1 CPU / 512 MB with spin-down and 5 GB/month egress, suspension risk accepted, Aiven PG Free 1 GB), no git by agents, and original names.

Abbreviations: **NC** = netcode.md · **WDS** = world-and-dust-simulation.md · **DM** = data-model.md · **SO** = system-overview.md · **SEC** = security.md · **PB** = performance-budgets.md · **ENV** = environments.md · **MB** = module-boundaries.md · **TS** = tech-stack.md. Line numbers refer to the files as they are now.

## Verdict

**Not ready for implementation of dust, netcode or persistence. The rest of the stack is sound.**

The platform choices hold up well: the three.js r187 WebGPU/TSL renderer, Colyseus with a raw-bytes hot path, the shared kinematic sim, guest-first auth, the A/B save slots and the cold-start UX all fit the $0 constraints. The CPU and bandwidth math is carried out in the open, which is rare and useful.

The problems are concentrated in the hardest system:
- There are two incompatible specifications of the dust wire protocol, chunking and persistence (NC vs WDS vs DM).
- The coarse-ledger removal rule makes plots impossible to Polish with the starting hand tools.

Both must be resolved before the Wave-0 contracts (`shared/world/*`, `shared/protocol/*`, `shared/save/format.ts`) are written. Otherwise netcode-engineer, terrain-dust-engineer and backend-data-engineer will build three incompatible things in parallel.

Beyond those two, the main gaps are:
- several capacity and cost traps on the free tier (rooms, instance-hours, the 1 GB DB, egress spent by tests);
- account-loss and IP-spoofing gaps in auth;
- a set of config files that do not implement what the docs say.

Counts: **2 BLOCKER · 17 MAJOR · 12 MINOR**.

---

## BLOCKER

### B1. Two incompatible dust-sync specifications (NC vs WDS), plus DM and SEC built on the losing one
**Where:** NC §2 (l.28–44), §4.2 (l.88–98), FRAME sections (l.103–108), §7 (l.164–176), §8 (l.178–194), §9.1 (l.196–207), §14 dust rows, §18.1 · WDS §2.4 (l.79–86), §2.7 (l.108), §4.4 (l.273–284), §5 (l.329–381) · DM §3.7b (l.166) · SEC §6 (l.116) · ADR-0015.

**Problem:** the two docs disagree on nearly every element. An implementer cannot satisfy both:

| Topic | NC | WDS |
| --- | --- | --- |
| Chunks | 1,280 chunks × 128 plots (16 × 8); `chunkId = d·128 + (i÷16)·16 + (j÷8)`; poles folded into chunks 0 and 640 | 641 chunks × 256 plots (16 × 16); `chunkId = d·64 + …`; chunk 640 = the poles; player-facing "Plot 41-207" depends on this |
| Messages | `DUST_MAP`/`DUST_CHUNK`/`DUST_SUMMARY`/`CHUNK_CHECKSUMS`/`DUST_RESYNC` + Strokes/Dust sections inside `FRAME` | `dust.strokes`/`dust.plots`/`dust.ledger`/`dust.log`/`dust.check`/`robot.plot`/`dust.snapshot`/`dust.ack` |
| Stroke coords | 12-bit cm over a 40.96 m frame; width 6 b; actorSlot 8 b; no `inputSeq` | int16 mm over a 25.6 m frame; width 10 b cm; actorSlot 6 b + `inputSeq` |
| Own strokes | Originator never receives them | Server echoes them with `inputSeq` for reconciliation |
| Interest | Strokes 400 m; dust near 600 m at 5 Hz; summaries 0.5 Hz | Strokes/ledgers 150 m; logs 60 m; L0 for the whole moon at 2 Hz |
| Drift check | CRC32 of L0 per chunk (cannot detect ledger drift) | Per-plot ledger hash within 60 m |
| Robots | `ROBOT_SWEEP` 8 B, `patternId` | `robot.plot` ≈16 B, `laneMask`, 1-s chunks |
| Radius | "not canonical, R ≤ 3 km" | canonical R = 2,000 m (CLAUDE.md agrees) |
| Join snapshot | 35–130 KB, worst 0.25 MB | 20–30 KB, worst 150 KB |

DM (`chunk_id 0–1279`) and SEC (`chunkId < 1,280`) follow NC. WDS §6 follows its own layout.

**Fix:** declare WDS canonical for everything dust-related. It is the only spec computed at R = 2 km and the only one consistent with the ledger.
- Rewrite NC §2 (dust rows), §4.2 (0x21–0x24), the FRAME Strokes/Dust sections, §7 dust rows, §8, §9.1 and §14 as references to WDS §5.
- Fix DM §3.7b (`chunk_id 0–640`) and SEC §6 (`chunkId ≤ 640`). Delete NC open issue 1.
- Decide explicitly whether dust records ride inside `FRAME` (fewer socket writes) or travel as separate bytes messages, then redo the §14 overhead row.
- Have contracts-architect produce a single `protocol/messages.ts` catalog (type ids, bit layouts, rates) as the first Wave-0 task, before any codec work.

### B2. Ledger removal rule makes Polished unreachable with hand tools; it is also order-dependent
**Where:** WDS §4.5 step 4 (l.291–292), §4.2 (l.247–250), §4.4 "Order" (l.284), §5.5 (l.379) · ADR-0009 Decision ("application order does not matter") · progression-and-economy.md §4 (l.77–87).

**Problem 1 (unreachable Polish):**
- The rule is: partial cover removes `floor(d_t · E_t / A)`, and only a single stroke covering ≥ 90 % of a 0.8 m texel clears it.
- A partially covered texel therefore stalls once `d_t < A/E_t`. With 50 % cover it stalls at 1 level, which is 6.7 % of the texel, already above the 1 % Polished threshold.
- A Desk Duster stroke (0.15 m capsule, ~0.4 m per 10 Hz segment) covers at most ~15–19 % of a texel. Those texels stall at 5–7 of 15 levels, so 33–47 % remains forever.
- T1–T3 hand tools (≤ 0.45 m wide) can never reach 90 % cover. **No plot can ever be Polished with the starting tools.** Wider tools still leave texels at 1 level wherever swaths straddle texel edges.
- This contradicts the design pacing ("one Highland plot ≈ 21 min with the Desk Duster").
- The design's tool **Depth**, terrain "passes", **Detailing** (0.5 m circle to zero) and **Charge** (one pass clears any terrain) have no mapping onto the stroke `strength` at all.

**Problem 2 (not commutative):** the floor-proportional rule depends on order.
- Example: d = 7, two strokes with E/A = 0.3 and 0.6.
- Order A then B: 7 → 5 → 2. Order B then A: 7 → 3 → 3.
- Clients apply their own predicted strokes before strokes from other actors in the same tick, and replay robot chunks on their own clock. Client ledgers therefore diverge by construction, not "~0".
- The Dust Cell truncation in §4.6 has the same order dependence.

**Fix:** replace proportional-floor removal with location-exact, idempotent accumulation.
- Suggested design: a per-texel 4 × 4 sub-cell mask (0.2 m cells), or 2-bit per-cell pass counters for multi-pass terrain. Cost: 2–4 KB per plot instead of 512 B.
- A stroke clears or decrements the cells whose centre lies inside the capsule.
- Bit-AND and saturating decrement commute, cannot be farmed by rescrubbing, and work for 0.15 m tools.
- Define `strength`/passes from game-data (tool Depth vs terrain) and model Detailing and Charge explicitly.
- Recompute WDS §4.3/§6 and DM §4 sizes.
- Add two P2 acceptance tests:
  - every T1–T6 tool sweeping a Highland plot in realistic lanes reaches Polished within ±20 % of the progression §4 times;
  - a property test where random permutations of the same stroke set produce identical ledgers.

---

## MAJOR

### M1. Ledger/stroke interest radius is smaller than the tile residency radius
**Where:** WDS §5.2 (l.350: strokes/ledgers 150 m) vs §7.2 (l.434–435: High 160 m, Ultra 220 m residency).

**Problem:** on High and Ultra, plots 150–220 m away get atlas tiles but never receive a ledger or strokes. Those tiles are built from nothing and go stale.

**Fix:** set the stroke/ledger radius to at least max residency + hysteresis (≥ 240 m), or cap residency at 140 m. Add a test that every resident Opened tile has a ledger.

### M2. Save layout is specified three ways, and dust rows are not crash-safe
**Where:** DM §3.7 (l.159), §3.7b (l.172), §4 (l.234–235, 248), §6 (l.268–269, 275), §7 (l.289), §10.1 (l.314) · WDS §6 (l.387–409) · ADR-0016 (l.25).

**Problem (contradictions):**
- DM §3.7 says ledgers are *not* in the slot blob.
- DM §6 puts a `LEDGERS` section in the envelope, and §4/§7 size the blob as if they were in it.
- DM §10.1 calls chunk rows "a future ADR", although ADR-0016 already adopts them.
- WDS uses magic `MCDW` and tables `contract_world`/`contract_dust_chunk`, where DM uses `MCSV`, A/B slots and `contract_dust_chunks`. Each doc defers to the other as canonical, so the deference is circular.
- Sizes disagree. DM puts a typical save at 0.2–0.6 MB and heavy at 1.5–2.5 MB. WDS puts typical at 1.5 MB and heavy at 10 MB, and its pathological case (35 MB) breaks DM's "< 8 MB" write check and "> 4 MB" alarm.

**Problem (integrity):**
- Chunk rows are single-version and rewritten in place, so the A/B guarantee does not cover dust.
- If the newest header fails CRC, the loader pairs the older header with newer chunk rows. A plot Polished after that older header has its ledger freed, while the header still says Opened with no ledger: undefined state.
- The zero-row `save_seq` guard must abort the whole transaction. As written ("closes without further writes") it does not say so.
- Lease renewal is not compare-and-set, and it uses app clocks (DM §1 "time set by the app").

**Fix:**
- Make one canonical layout in DM and delete WDS §6's table names and magic.
- Store plot state inside each chunk row, so it lives with its ledger.
- Give chunk rows a `save_seq` and keep the previous version (`prev_blob` or A/B per chunk). The loader uses chunk versions with `save_seq ≤` the chosen header.
- Write the header first with the guard and `ROLLBACK` on 0 rows.
- Make leases `UPDATE … WHERE lease_instance = $me OR lease_expires_at < now()` using the DB's `now()`.

### M3. The 1 GB database has no enforced capacity policy
**Where:** DM §4 (l.238–248), §5 · WDS §6 (l.405) · SO §4 (≤ 5 Contracts per player).

**Problem:**
- Budgets disagree: DM gives prod 650 MB, WDS gives 700 MB.
- Capacity is roughly 160–300 mid-game Contracts, yet guests are unlimited, each may own 5 Contracts, and they are retained for 365 days.
- Compaction appears only in WDS ("idle > 30 days").
- When Aiven's disk fills, every checkpoint fails and dirty state is lost at room close.

**Fix:** add an owner-visible policy to DM §5:
- at most 1–2 non-pristine Contracts per guest;
- compact Contracts idle > 30 days (drop stroke logs) and > 90 days (drop ledgers, keep plot states);
- refuse new Contract creation above 800 MB, exposed via `/readyz`;
- measure real per-Contract size in P2 before launch.

### M4. One room per Contract is not guaranteed by `filterBy` + lease
**Where:** SO §2.2 (l.78–83), §4 (l.171) · NC §9.3 lease row (l.252).

**Problem:**
- Colyseus `joinOrCreate` creates a *new* room when the matching one is locked: full, or `lock()`ed during drain.
- A second room on the same instance can take the lease if the check accepts "mine".
- Changing `shiftType` via `PATCH` while a room is live allows a `shift_private` room and a `shift_open` room for the same Contract.
- Result: two `RoomSim`s on one save. One of them dies with 4108 after players have already played in it.

**Fix:**
- Keep an in-process `contractId → roomId` registry.
- Join through a server-side handler (REST `POST /v1/contracts/:id/join` → `matchMaker.reserveSeatFor`/`joinById`) that creates a room only when the registry is empty. A full room returns 4105.
- Use one room name with `shiftType` held in state, so type changes apply to the live room.
- Make the lease a compare-and-set keyed by room id.

### M5. Input-starvation rule double-applies inputs; no client rate steering
**Where:** NC §3 step 1 (l.53), §5 (l.143), §17 (l.398).

**Problem:**
- On a TCP stall the server repeats the last input for up to 3 ticks. When the late inputs arrive it applies them too, two per tick. The server therefore simulates up to 3 extra ticks of motion that the client's replay (`seq > ackInputSeq`) never contained.
- Combined with clock drift, which nothing corrects, this guarantees systematic corrections under the doc's own 1 % loss test, against a target of < 5 cm p95.
- The tool sweep "triangle wave" (WDS §4.4) has no defined phase source, so predicted strokes will not match the server's.

**Fix:**
- Substituted inputs consume their sequence number, and late inputs with `seq ≤ lastConsumedSeq` are dropped.
- `FRAME` carries `inputBufferDepth`, and the client time-dilates by ±2–5 % to keep 1–2 inputs buffered.
- Derive sweep phase from `inputSeq`.
- Add a netsim test at 1 % loss asserting correction p95.

### M6. Prediction/reconciliation ownership contradicts the dependency graph
**Where:** NC N6 (l.16) · MB §1 (l.20–24), §3 (l.69, 82, 83).

**Problem:**
- NC places prediction and reconciliation in `packages/protocol` + `packages/sim`, but `protocol` may only import `shared`.
- Three roles each own a piece of one loop: protocol ("client session state machine"), gameplay ("local prediction glue") and net ("snapshot ingestion into the sim").
- `tools/bots` needs the same session logic.

**Fix:**
- Put the reconciler (input ring, replay, smoothing) in `packages/sim` under gameplay-systems-engineer.
- `protocol` only encodes and decodes; `client/net` wires the two together.
- Alternatively, allow a `protocol → sim` edge explicitly.
- Update MB §1/§3 and NC N6 together.

### M7. The role enum is named three ways
**Where:** SO §7.3 (l.245) · NC §4.1 kick/ban (l.84), §4.3 `role` (l.122), §18.4 · SEC §8 (l.142), §12.4 vs DM §3.6 (l.129) and §5 (`role = temp`).

**Problem:**
- SO, NC and SEC use `owner/member/visitor`, with "Supervisor needs a contract change".
- DM already stores `holder/supervisor/staff/temp`.
- Permission checks will be coded against different enums.

**Fix:** use one enum, `holder | supervisor | staff | temp`, in the DB, Schema, REST DTOs and control messages. Update SO, NC §4.3 and SEC §8, and close the open issues.

### M8. Bandwidth: interest ignores the horizon; hidden tabs and staging tests spend the shared 5 GB
**Where:** NC §7 (l.168–176), §14 (l.319) · WDS §0 (l.21: horizon 82.5 m) · render.yaml l.15 · PB §8 (l.154–156).

**Problem:**
- On a 2 km moon, two standing avatars see each other only to about 165 m, yet NC streams every entity within 400 m at full rate and structures to 1,200 m. The 6.2 KB/s budget assumes "everyone within 400 m"; most of that traffic is for objects below the horizon.
- Hidden tabs keep receiving 10 Hz frames for up to 30 min before the AFK close.
- Staging shares the workspace egress. One 1-h 16-bot soak costs about 357 MB (7 % of the month); each 10-min `/bot-test` costs about 60 MB.

**Fix:**
- Make interest horizon-aware: visible if `d ≤ √(2R·h_obs) + √(2R·h_tgt) + margin`. Everything else goes to `ROSTER_MARKERS`.
- Add a `visibility` control message; hidden clients get 1 Hz Self + Schema only.
- Run soaks locally in a CPU-limited container. Cap staging bot runs at ≤ 5 min and record their bytes in `ops_usage_daily`.
- Surface month-to-date egress in `/status`.

### M9. Instance-hours: the wake probe runs on every page load
**Where:** SO §3 (l.99–100) · NC §10 (l.264) · ENV §5 (l.83), §8.1.

**Problem:**
- Every visitor, including hub browsers who bounce, wakes prod for at least 15 minutes. About three visits an hour spread through the day keep prod up 744 h/month, beyond the 600 h plan and close to the 750 h workspace limit, which suspends staging as well.
- The owner accepted the bandwidth risk, not the instance-hour risk.
- If Render's own health checks count as traffic (unverified), prod never sleeps.

**Fix:**
- Start the probe on first intent (title-screen interaction or Clock In hover) while still streaming assets at load.
- Log instance-hours month-to-date.
- Verify the health-check behaviour in M0, and drop `healthCheckPath` on Free if it keeps the instance awake.

### M10. `MAX_ROOMS=2` means two concurrent Contracts worldwide, Solo included
**Where:** render.yaml l.111–112, 194–195 · PB §6 (l.103) · NC §15 (l.372: default 4) · ENV §7.2 (l.145)/§9 (l.189: 4) · SO §2.2 (l.83).

**Problem:**
- Every Solo Shift is a server room in the MVP.
- With the game listed on a hub, the third concurrent player gets "Brightside at capacity".
- The default is 2 in two places and 4 in two others.

**Fix:**
- Split the cap into `MAX_SHARED_ROOMS` and `MAX_SOLO_ROOMS`. Solo tick p95 is ≤ 0.4 ms, so ≥ 8 solo rooms should fit with reduced rates and no interest recompute.
- Or bring the Worker-based Offline Solo (already a dev flag) into the MVP, with the server used only for saves.
- Reconcile the default across all four docs.

### M11. Server CPU model ignores GC stalls, boot work and per-room static data
**Where:** NC §15 (l.346–372) · PB §6 (l.102, 107) · WDS §4.3 (l.262–263), §4.8 (l.324).

**Problem:**
- A V8 major GC on a 100–300 MB heap (cap 384 MB) costs tens of milliseconds of CPU. Under a 10 ms / 100 ms quota that becomes a 0.3–1 s stall of the whole process, so the gates "max ≤ 8 ms" and "event-loop p99 ≤ 20 ms" cannot be met. V8's helper threads draw on the same quota.
- "Boot ≤ 5 s of our code" has to load the bundle and the 12.6 MB height map and generate the grid and neighbour tables: about 150 ms on a full core, roughly 1.5 s at 0.1 CPU.
- If those tables are built per room in `onCreate`, room creation stalls rooms that are already live.
- The §15 table omits robot ledger ops (≈3 ms/s) and dust interest.

**Fix:**
- Precompute grid, centre and neighbour tables at build time as hash-checked binaries, shared immutably per process.
- Slice room creation and save decoding the same way checkpoints are sliced.
- Evaluate a heap cap of 192–256 MB, semi-space tuning and `--single-threaded-gc` in the M0 spike, and add a "max stall with GC traced" gate.
- Add robot and dust rows to §15.

### M12. Strict protocol equality with independent deploys has no failure path
**Where:** NC §13 (l.311–313) · SO §3 `update_required` (l.131) · ENV §6 (l.104).

**Problem:**
- Vercel and Render both deploy on a push to `release`.
- If Render's build fails (migration error, Aiven powered off, build minutes exhausted), the new client is live against the old server. Every player waits 10 minutes, and what happens after that is unspecified.

**Fix:**
- Gate the Vercel production deploy on the server version: an Ignored Build Step that compares against `/healthz`, or a deploy hook fired by a Render deploy-success webhook, or a manual promote step in `/release-checklist`.
- Specify the client's behaviour after the 10-minute timeout.
- Optionally tolerate N−1 for optional message types.

### M13. Refresh-token rotation without a grace window will destroy guest accounts
**Where:** SEC §3 (l.45, 48, 52) · DM §3.3 · ADR-0018.

**Problem:**
- A lost response (cold-start proxy timeout, tab closed mid-request) makes the client retry with the old token. The server sees reuse and revokes the whole family.
- For a guest without a saved recovery code, the account and all owned Contracts are gone.
- Web Locks do not cover retries or a second browser.
- The recovery code's entropy is unspecified, and recover attempts are throttled only per IP.

**Fix:**
- Accept the immediately previous token for ≤ 60 s and return the same successor (idempotent). Treat only older reuse as theft.
- Specify recovery codes as ≥ 80 bits (e.g. 16 Crockford characters).
- Add a global failed-recover throttle and audit.

### M14. Client-IP derivation is spoofable as written
**Where:** SEC §5 (l.94).

**Problem:**
- "Take the left-most client address" means taking the attacker-supplied `X-Forwarded-For` entry. That defeats the guest-creation, recover, join-by-code and sockets-per-IP limits.
- If the proxy IP is used instead, everyone shares one bucket: five guests per hour for the whole game.

**Fix:**
- Use the right-most entry appended by Render's edge, or a Render-documented single-value header once verified.
- Add an M0 test that sends a forged `X-Forwarded-For`.

### M15. `vercel.json` does not implement the documented contract
**Where:** vercel.json vs SEC §4.4 (l.83–88), SO §5 (l.182), ENV §4.2 (l.77), MB §3 (l.85), WDS §3.2 (l.150–151).

**Problem:**
- Headers: no CSP, which SEC calls the main XSS defence for the `localStorage` token; no COOP; no `/hub/*` `Access-Control-Allow-Origin`/3600 s cache (only `metadata.json`, at 300 s).
- `VITE_BUILD_VERSION` is never set.
- The catch-all rewrite to `index.html`, combined with `/assets/(.*)` immutable caching, means a missing chunk after a deploy is served as HTML with status 200 and cached for a year.
- Vite's `assets/` output directory collides with pipeline output in `public/assets/`.
- The terrain bake writes fixed, unhashed names (`height-cube-1024.bin`, `plot-dust-q.bin`), which would be cached immutably forever.
- The CSP needs per-environment origins, but `vercel.json` is static.

**Fix:**
- Rewrite only extension-less paths, e.g. `/((?!assets/|hub/|.*\..*).*)`.
- Give the pipeline its own directory (e.g. `/game/`), content-hash the bake outputs, and keep the manifest on a short TTL.
- Add CSP (listing both prod and staging origins, or generate `vercel.json` during the build), COOP and the `/hub/(.*)` headers.
- Set `VITE_BUILD_VERSION=$VERCEL_GIT_COMMIT_SHA` in the build command.

### M16. Turborepo strict env mode will silently strip build variables
**Where:** turbo.json l.10 (`env: ["VITE_*"]` only).

**Problem:**
- Turbo 2 runs in strict env mode by default.
- `SENTRY_AUTH_TOKEN/ORG/PROJECT`, `VERCEL_GIT_COMMIT_SHA`, `RENDER_GIT_COMMIT` and `BUILD_VERSION` will not reach tasks. There will be no source maps and wrong build versions, with no error.
- Future DB tests that need `DATABASE_URL` will be stripped too.

**Fix:** add `passThroughEnv` for these variables on `build`, and `globalPassThroughEnv` for CI-only variables.

### M17. `render.yaml` drifts from ENV on values implementers code against
**Where:** render.yaml l.50, 78–79, 94–95, 112, 186–199 · ENV §4 (l.52), §4.1 (l.64, 67), §7.2 (l.135, 142, 145, 149), §9 (l.182) · DM §3.8 and §9.

| Item | render.yaml | ENV / DM |
| --- | --- | --- |
| Prod deploy trigger | `autoDeployTrigger: commit` | `checksPass` |
| `MAX_ROOMS` | 2 | 4 |
| Staging pool / log level | 4 / debug | 2 / info (DM §9 pool math uses 2) |
| `BUILD_VERSION` | hard-coded `0.0.0` | unset → derived from `RENDER_GIT_COMMIT` |
| Achievements seed step | missing from `buildCommand` | required |
| `REFRESH_TOKEN_PEPPER` | `sync: false` | "generate value" |
| Region | hard-coded `oregon` | chosen after Aiven assigns its region (immutable) |

With `BUILD_VERSION` stuck at `0.0.0`, `/healthz`, the Sentry release and lease ids all report 0.0.0.

**Fix:** treat `render.yaml` as the source of truth, regenerate the ENV tables from it, and fix each row.

---

## MINOR

### m1. REST prefix
TS l.75 says `/api/v1/*`; SO §2.1, SEC and DM use `/v1/*`. Pick one before `shared/api/rest.ts` is written.

### m2. Arithmetic and config inconsistencies
- `INPUT` is 10 B, not 11 (NC l.71: 2 + 1 + 1 + 2 + 1 + 2 + 1).
- `SNAPSHOT_HZ=20` does not divide `SIM_TICK_HZ=30`, yet NC N4 calls 30/20 supported and ENV l.188 requires divisibility.
- WDS hard-codes "every 2 sim ticks", against NC N4.
- A full keyframe at the slot caps (16×13 + 32×16 + 64×10 ≈ 1.36 KB) exceeds the 1,000 B frame cap (NC l.176). Stagger keyframes per slot.
- The input token bucket (30/s, burst 40) would drop legitimate inputs at 30 Hz. Derive it from `SIM_TICK_HZ`.

### m3. ADR-0015 is stale
- It says entities go out as "10 Hz Schema snapshots", but NC moves entities to bytes `FRAME`.
- Its egress trigger (> 900 KB per player-hour) is already exceeded about 25× by the planned 6.2 KB/s (≈ 22 MB per player-hour).
- "5–6 full 16-player hours" contradicts NC §14's ≈ 14.
- Its CPU trigger response (drop to 15 Hz) differs from TS §3 (replace the Colyseus edge).

Supersede it with a corrected ADR; ADRs are append-only.

### m4. PB is stale against WDS and rendering-pipeline
- Atlas and ring are "rg8" at 32/8 MiB in PB; WDS specifies RGBA8, 4 channels (High 4096×2048, Ultra 4096² = 64 MiB, ring 16 MiB).
- Height map: 12 MiB in PB vs 16 MiB with mips.
- Tier B shadows: 2×1024² in PB vs 3×1024² at Medium.
- Warm-up: 3 s in PB vs 4 s.
- WebGL2 dust: "ping-pong" in PB vs reverse-subtract blending.
- L0 storage: "640 KB" (float32) in PB vs a Uint8 cache in WDS.
- Room memory: 24 MB in PB vs 25–80 MB for dust alone in WDS.

### m5. Colyseus patch clock
Schema patches run on Colyseus' own `patchRate` timer, not on the fixed-step driver (NC §3 step 6 says "same tick"). Disable automatic patching and call `broadcastPatch()` from the driver. Verify in the spike that `FRAME` and the patch actually coalesce into one socket write, since NC §14's overhead row assumes it.

### m6. Server-to-client control messages are not catalogued
Missing from the catalog: `purchase_result`, `shutdown_notice`, `error`, build results, kick notice, vote-kick (SEC l.144), report, hidden-tab snapshot request (WDS l.375) and `visibility` (M8).

### m7. Install scope on Render and Vercel
Both install the whole workspace: Playwright, gltf-transform, three, and uWS from GitHub on Vercel. On Render this eats into the 500 build minutes (ENV l.90).
- Use `pnpm install --frozen-lockfile --filter @moon-custodians/server...` on Render and `--filter @moon-custodians/client...` on Vercel.
- Add a Vercel `ignoreCommand` for docs-only commits.

### m8. CI does not wire up what the docs promise
- SEC §10 requires SHA-pinned actions; ci.yml uses `actions/checkout@v7`, `pnpm/action-setup@v6` and `actions/setup-node@v7`.
- Also missing: `pnpm audit --prod` (SEC §10), the four-engine golden hash (WDS l.42), the ≤ 20 MB first-load size check (PB §8), golden save fixtures (DM §6) and `format:check`.

Add each as a job gated like the existing ones.

### m9. Migration tool and timeouts
`packages/db` `migrate` plans the `drizzle-kit migrate` CLI, while DM §8 and ENV §4.1 specify the programmatic Drizzle migrator with `lock_timeout=5s` / `statement_timeout=60s`, which the CLI does not set. Use the programmatic migrator. Mark `uWebSockets.js` as external in the esbuild bundle.

### m10. Colyseus package pins
apps/server pins both `colyseus@0.18.12` and `@colyseus/core@0.18.28`. Verify a single resolution with `pnpm why @colyseus/core`; two copies would mean two matchMaker singletons. Depend on one entry point.

### m11. Two interest systems with two owners
Entity interest is computed in the NC driver step 5; dust interest is in `apps/server/src/world` (WDS §8). Both iterate every client on different schedules. Define one `InterestService` that produces both sets.

### m12. Owner expiry or deletion destroys other members' moons
DM §5 cascades owned Contracts when a guest owner is inactive for 365 days or deletes their account. Staff and Supervisors lose a shared moon without warning. Consider transferring the Holder role to the most active Supervisor or Staff member first.
