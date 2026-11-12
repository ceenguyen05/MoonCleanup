# Planning fix pass: engineering (architecture docs, ADRs, deploy config)

Date: 2026-11-12 · Agent: architecture fix agent · Inputs: [planning-review-principal-engineer.md](planning-review-principal-engineer.md) (all 31 findings) and the [planning-review-technical-art-director.md](planning-review-technical-art-director.md) findings that target `world-and-dust-simulation.md` (WDS) or `performance-budgets.md` (PB).
Scope rule: only owned files were edited (planning-only: Markdown/config; no code, git, installs or secrets). Everything else is listed under **Cross-file items**.

## Lead decisions applied

| Decision | Where it now lives |
| --- | --- |
| B1: WDS is the canonical dust spec; netcode keeps framing only | WDS header "Canonical scope"; netcode.md header, §2, §4.2, §8; ADR-0009 amendment |
| B2: order-independent ledger that can reach Polished | WDS §4.4–§4.5b; new ADR-0026 |
| Save layout = data-model §3.7/§3.7b, crash-safe chunk rows | data-model §3.7/§3.7b; WDS §6 defers; ADR-0016 amendment |
| 1 GB capacity policy | data-model §4, §5.1; ADR-0016 amendment |
| One room per Contract | netcode §9.3; system-overview §2.1/§2.2/§4; ADR-0025 |
| Input dedupe by sequence | netcode §3, §5.1; security §2 |
| Roles holder/supervisor/staff/temp | netcode §4.1/§4.4; security §8; data-model §3.5/§3.6; system-overview |
| Horizon-aware interest | netcode §7; WDS §5.2 |
| Wake probe on first title interaction; no bots; tests never hit prod | netcode §10; system-overview §3; environments §3/§5; PB §5/§6.3; ADR-0002 amendment |
| `MAX_ROOMS` = hard ceiling 3, admission by tick budget | netcode §15; system-overview §1; PB §6; environments §7.2/§9; render.yaml; ADR-0025 |
| Token grace window; Render-documented IP header only | security §3/§5; data-model §3.3; ADR-0018 amendment |
| vercel.json / turbo.json / render.yaml match the docs | the three files rewritten; environments §4.1/§4.2/§4.3; CI contract check |

## Principal-engineer findings

| # | Finding | Fix | Files |
| --- | --- | --- | --- |
| B1 | Two incompatible dust-sync specs | WDS made canonical (641 chunks × 256 plots, chunk 640 = poles; int16 mm strokes with `actorSlot` 6 b + `inputSeq` + `depth16`; own-stroke echo; dust radius; two-level ledger-hash drift check; R = 2,000 m). Netcode rewritten to frame WDS records: per-frame dust records are **FRAME sections** (decision recorded), bulk records are `0x21–0x24` messages, client request `DUST_REQUEST 0x03`; §8 replaced by links; §14 overhead/dust rows redone; open issue 1 deleted. DM chunk_id 0–640, SEC chunkId ≤ 640. Single `protocol/messages.ts` catalog made the first Wave-0 task | world-and-dust-simulation.md, netcode.md, data-model.md, security.md, module-boundaries.md, ADR-0009 (amendment) |
| B2 | Ledger stalls above 1 %; order-dependent | Texels in 1/16-level units (8-bit, 1 KiB/plot); initial 16 × class dust level (5/8/13); removal r = round(depth16·C/A), ≥ 1 unit when C ≥ A/64; u ← max(0, u − r). State-independent → commutes; every touch makes progress; full pass = Depth levels (matches design passes). Server applies a tick's ops in fixed order (players, vehicles, robots) and broadcasts results (accepted strokes, Dust Cell grams, plot states, chunk hashes). Depth/Deep Clean/Master Stroke/night penalty → `depth16`; Charge and Detailing = 255. Inspector's Stamp at ≤ 1 %. Test vectors V1–V5 (golden 4-engine, permutations, per-tool reachability ±20 %, over-collection, client two-view convergence) | world-and-dust-simulation.md §0, §4.1–§4.8, §7.3, §10, §12; ADR-0026 (new); tech-stack.md |
| M1 | Ledger radius < tile residency | Dust radius = client-declared residency + 20 m (100–240 m, `dust_interest` control); invariant + bot test; ledgers beyond 60 m streamed after `ready` | world-and-dust-simulation.md §5.1/§5.2/§5.4; netcode.md §4.1 |
| M2 | Save layout three ways; dust rows not crash-safe | One layout: A/B header slots (no per-plot dust) + `contract_dust_chunks` with **two versions per chunk** stamped with header `save_seq`; header written first; zero-row guard → `ROLLBACK`; load rule "newest valid header H, per chunk newest valid version ≤ H" with consistency proof and fallback-write rule; plot state stored in the chunk row; lease is CAS on DB `now()` with `lease_room_id`. WDS §6 table names/magic removed; sizes reconciled | data-model.md §1, §3.5, §3.7, §3.7b, §6, §7; world-and-dust-simulation.md §6; ADR-0016 amendment |
| M3 | No 1 GB capacity policy | Single budget (reserve 200 / staging 100 / prod accounts 100 / prod saves 600 MB); ≤ 3 owned Contracts (GDD); per-Contract soft 4 MB / hard 8 MB caps; compaction at 30 d (logs) and 90 d (ledgers); refuse new Contracts > 800 MB (507 `STORAGE_FULL`, `/readyz`, `/status`); daily admin metrics in `ops_usage_daily`; measure in P2 | data-model.md §3.5, §3.12, §4, §5.1; security.md §5; system-overview.md §2.1; ADR-0016 amendment |
| M4 | Duplicate rooms per Contract | One room name `shift` (`shiftType` in state, changed live); REST-only `POST /v1/contracts/:id/join`; in-process `contractId → roomId` registry inserted before async load; public matchmake disabled + join ticket; lease CAS keyed by room id | netcode.md N9, §9.3, §12, §16, §17; system-overview.md §2.1, §2.2, §3, §4; security.md §3; data-model.md §3.5; ADR-0025 |
| M5 | Inputs double-applied; no rate steering; sweep phase | Substitution consumes the seq; late seq ≤ lastConsumed dropped; starvation mode; `inputBufferDepth` in FRAME + ±2–5 % client time dilation; sweep phase from `inputSeq`; netsim test at 1 % loss | netcode.md §3, §4.2, §5.1, §17; world-and-dust-simulation.md §4.4; security.md §2 |
| M6 | Reconciliation ownership vs dependency graph | Reconciler in `packages/sim`; `protocol` encode/decode + interpolation buffer only; `client/net` wires; bots reuse sim reconciler | netcode.md N6; module-boundaries.md §1, §3 |
| M7 | Role enum named three ways | `holder | supervisor | staff | temp` in DB, Schema, REST, control messages; `appoint_role`, `vote_kick`; `tempCan*` permissions; open issues closed | netcode.md §4.1, §4.4; security.md §8, §12; data-model.md §3.5; system-overview.md §2, §7 |
| M8 | Interest ignores horizon; hidden tabs; staging egress | Horizon-aware entity interest (√(2R·h₁)+√(2R·h₂)+40 m, ≤ 400 m), structures ≤ 600 m; `visibility` → 1 Hz Self-only; staging bot runs ≤ 5 min, soaks local; `bot_bytes_out`; month-to-date egress on `/status` | netcode.md §7, §14, §17; PB §6.2, §8; environments.md §3, §5; data-model.md §3.12; system-overview.md §2.1 |
| M9 | Wake probe every page load | Probe on first title-screen interaction; never for bots/crawlers/prerender/hidden; instance-seconds logged; M0 verifies health-check traffic and drops `healthCheckPath` if needed | netcode.md §10; system-overview.md §3; environments.md §4.1, §5, §8; PB §5, §6.3; render.yaml; ADR-0002 amendment |
| M10 | `MAX_ROOMS=2` worldwide, defaults disagree | Admission by measured tick budget (`TICK_BUDGET_MS` 3.5) with `MAX_ROOMS` 3 hard ceiling, same value everywhere; capacity stated plainly; Open Shifts share rooms; at-capacity UX state | netcode.md §15; system-overview.md §1, §3; PB §6; environments.md §7.2, §9; render.yaml; .env.example; ADR-0025 |
| M11 | CPU model ignores GC, boot, per-room static data | Grid/neighbour/class tables precomputed at build, hash-checked, shared per process; room creation and save decode sliced; robot ledger and interest rows added (≈ 2.3 ms/tick); GC gate "max stall traced ≤ 50 ms"; heap/GC flags evaluated in M0; boot measured at 0.1 CPU | netcode.md §3, §9.4, §15; world-and-dust-simulation.md §2.5, §4.3, §4.8; PB §6 |
| M12 | No failure path for client-ahead-of-server | Vercel auto-deploy of `release` disabled; new `release-client.yml` waits for prod `/healthz` protocolVersion then calls the deploy hook; client behaviour after 10-min wait specified | netcode.md §13; system-overview.md §3; environments.md §1, §4, §4.3, §9; vercel.json; .github/workflows/release-client.yml; ADR-0002 amendment |
| M13 | Refresh rotation destroys guests | 60 s predecessor-only grace window (supersede unused successor, 409 on cross-tab race); `replaced_at`, `superseded`; recovery codes ≥ 80 bits; global failed-recover throttle + audit | security.md §3, §5, §11; data-model.md §3.2, §3.3, §3.11; ADR-0018 amendment |
| M14 | Client IP spoofable | Only the Render-documented header (`CLIENT_IP_HEADER`, default `true-client-ip`, confirm in M0); XFF right-most only; missing header → tight `unknown` bucket; forged-XFF M0 test | security.md §5, §11, §12; environments.md §7.2, §9; render.yaml; apps/server/.env.example |
| M15 | vercel.json misses the contract | CSP (static header + per-env meta CSP), COOP, `/hub/(.*)` ACAO + 3600 s; `VITE_BUILD_VERSION=$VERCEL_GIT_COMMIT_SHA`; rewrite only extension-less paths; Vite output `/_app/`, pipeline `/assets/` content-hashed with short-TTL manifest; bake outputs hashed; CI checks the contract and hashed asset names | vercel.json; security.md §4.4; environments.md §4.2; module-boundaries.md §3; world-and-dust-simulation.md §3.2; ci.yml; asset-validation.yml |
| M16 | Turbo strict env strips build vars | `passThroughEnv` for Sentry, commit SHAs, `BUILD_VERSION`; test/e2e/bots/perf pass-throughs; `globalPassThroughEnv` for CI vars | turbo.json |
| M17 | render.yaml drifts from ENV | Prod `checksPass`; `MAX_ROOMS` 3; staging pool 2 / log `info`; `BUILD_VERSION` removed (derived); seed step added; `REFRESH_TOKEN_PEPPER` `generateValue`; region marked as placeholder to confirm; render.yaml declared source of truth and ENV tables regenerated | render.yaml; environments.md §3, §4.1, §7.2, §9; apps/server/package.json (`seed`) |
| m1 | REST prefix | `/v1/*` only | tech-stack.md |
| m2 | Arithmetic/config | INPUT 10 B; alt rates 30/15 (divisible, boot check); no "every 2 ticks"; staggered per-slot keyframes under the 1,000 B cap; input bucket = 1.5×/2× `SIM_TICK_HZ` | netcode.md N4, §3, §4.1, §4.2, §11; world-and-dust-simulation.md §0, §4.4; environments.md §9 |
| m3 | ADR-0015 stale | Superseded by new ADR-0025 (status line updated) | ADR-0015, ADR-0025, ADR README |
| m4 | PB stale vs WDS/RP | RGBA8 dust memory per WDS §9, height 16 MiB, warm-up 4 s, reverse-subtract WebGL2 dust, Uint8 L0, room memory recomputed, preset knobs delegated to `quality.ts` | performance-budgets.md §1, §3, §4, §5, §6, §7 |
| m5 | Colyseus patch clock | Automatic patching off; driver calls `broadcastPatch()`; M0 verifies write coalescing | netcode.md §2, §3 |
| m6 | S→C control messages not catalogued | New §4.3 table (purchase/build/teleport results, error, shutdown, kick notice, vote-kick, role/shift-type changes, report ack, capacity) + C→S `visibility`, `dust_interest`, `appoint_role`, `set_shift_type`, `vote_kick`, `report_player` | netcode.md §4.1, §4.3 |
| m7 | Whole-workspace installs | Filtered installs on Render and Vercel; Vercel `ignoreCommand` for docs-only commits | render.yaml; vercel.json; environments.md §4.1, §4.2 |
| m8 | CI misses promised gates | Added format check, `pnpm audit --prod`, four-engine golden job, save-fixture job, first-load size check, vercel contract check, action-pin check (**warn-only** until SHAs are resolved; see cross-file) | .github/workflows/ci.yml |
| m9 | Migration tool; uWS bundling | Programmatic Drizzle migrator (placeholder text + DM §8); esbuild `--external:uWebSockets.js` noted in the build placeholder; seed moved to the server package (db must not import game-data) | packages/db/package.json; apps/server/package.json; data-model.md §8; render.yaml |
| m10 | Two Colyseus entry points | Dropped the `colyseus` meta package; server depends on `@colyseus/core` 0.18.28 only (+ uWS transport, schema). Verify single resolution with `pnpm why @colyseus/core` at the next install | apps/server/package.json |
| m11 | Two interest systems | One `InterestService` in `apps/server/src/net` producing entity and dust sets | netcode.md §3, §7; world-and-dust-simulation.md §5.2, §8; module-boundaries.md §3 |
| m12 | Holder expiry destroys shared moons | Holder transferred to most active Supervisor, else Staff, before cascade; audit + notice | data-model.md §5; security.md §9; ADR-0016 amendment |

## Technical-art-director findings (WDS / PB targets only)

| # | Finding | Fix | Files |
| --- | --- | --- | --- |
| F1 | Albedo contradicts luma targets | Grime ≈ 0.085, clean ≈ 0.34 linear (AD §3.2 single source); target stated as sRGB luma after AgX ≥ 1.9; calibrate with AgX on | world-and-dust-simulation.md §7.7 |
| F2 | Preset numbers conflict | WDS §7.2/§7.5/§7.6 values declared seeds for `shared/render/quality.ts` (canonical); PB no longer restates preset knobs, keeps per-tier ceilings only; tier naming clarified | world-and-dust-simulation.md §7.2, §7.5; performance-budgets.md §1, §3, §4 |
| F3 (PB part) | Tier B unvalidated | Real iGPU = owner gate G1; bench needs the worst-case terrain-shader stub + second capture; pre-declared Tier B fallback ladder | performance-budgets.md §10 |
| F10 | Partial removal not specified | Replay strength s = depth16/(16·L_P) so multi-pass terrain thins per pass; presence mask + thickness term gives a monotonic luma ramp; berm scales with R; ledger-zero clear keeps visuals = economy; thinning checks listed | world-and-dust-simulation.md §7.3, §7.7 |
| F11 | Stroke edge / ring handoff / sub-texel | Ring-edge handoff test (width ≤ 1 px, berm delta ≤ 20 %); edge ≤ 2 cm world target; sub-texel strokes via analytic coverage, P2 decides SDF/finer tile with the 12 cm-at-20 m capture | world-and-dust-simulation.md §7.2, §7.5 |
| F12 | Lane stripes unsupported | Decision [R]: no direction channel in MVP; tonal bands from G; M1-W1 gate; ADR needed to add the channel | world-and-dust-simulation.md §7.2 |
| F13 | Footprint tread and lifetimes | Tread as normal-map stamp; per-channel lifetimes (grime prints vs 30 s clean-ground prints); subtractive fade with stochastic rounding | world-and-dust-simulation.md §7.6 |
| F14 (PB part) | Grain readability | PB minimum-juice floor line (fewer but larger grains on Low/WebGL2) | performance-budgets.md §4 |
| F22 (PB part) | WebGL2 TSL cost unmeasured | M0-W3 WebGL2 capture of the real terrain shader, M1-W3 WebGL2 gate, keep AO/cavity on Low | performance-budgets.md §10 |

## Cross-file items (not owned; need their owners)

1. **rendering-pipeline.md** (lead/rendering): strike "clean ≈ 0.22", "2.4×" and "ratio ≥ 1.8" in §1, §7, §19 (F1); move preset numbers to `quality.ts` (F2); backend tier names G1/G2/G3 vs hardware A/B/C (F2).
2. **art-direction.md / visual-target.md** (technical-artist): add the WDS §7.7 thinning checks (F10), ring-edge handoff and ≤ 2 cm edge width (F11), VM-05 stripe wording per the WDS §7.2 decision (F12), VT-M1-15 tread/lifetime thresholds (F13), grain readability metric (F14).
3. **docs/milestones/M0-foundation.md** (lead): `MAX_ROOMS` default 2 → 3 plus `TICK_BUDGET_MS` and `CLIENT_IP_HEADER` in the env-schema task (lines ~185, 248, 576); add Wave-0 task "single `protocol/messages.ts` catalog before codecs"; M0 verification tasks: health-check traffic, Render client-IP header + forged-XFF test, Colyseus `exposedMethods`/`reserveSeatFor`/manual `broadcastPatch` coalescing, GC flags, Vercel deploy hook with `deploymentEnabled.release=false`, Tier B G1 device + terrain-shader stub (F3), WebGL2 capture (F22); precomputed grid binaries build step.
4. **docs/milestones/M1-mvp.md** (lead): acceptance criteria at ~567 and ~603 still name `DUST_CHUNK`/`DUST_RESYNC` → `DUST_SNAPSHOT`/`DUST_LEDGER`/`DUST_REQUEST`; add ledger test vectors V1–V5 to the dust task.
5. **docs/ROADMAP.md** row 6 (`MAX_ROOMS` 2 vs 4): resolved as ceiling 3 + tick budget.
6. **.github/actions/setup-workspace/action.yml** (devops): pin `pnpm/action-setup`, `actions/setup-node`, `actions/cache` by commit SHA; also pin `actions/checkout` in all workflows, then set `PIN_ENFORCE: "true"` in ci.yml (SHAs need a network lookup; not fabricated here).
7. **apps/client Vite config** (integrator/devops): `build.assetsDir = "_app"` and the meta-CSP `connect-src` injection from `VITE_SERVER_*_URL`; **apps/client/README.md** line ~44 describes the old `/assets/(.*)` rule.
8. **tools/asset-pipeline, tools/terrain-bake, assets/*/README.md** (technical-artist / terrain-dust-engineer): content-hashed output names + `manifest.json` (now enforced by asset-validation.yml).
9. **docs/SETUP_CHECKLIST.md** (docs-keeper): confirm Render region before the first Blueprint apply; create the Vercel Deploy Hook (branch `release`), GitHub secret `VERCEL_PROD_DEPLOY_HOOK_URL`, GitHub variable `PROD_SERVER_HTTP_URL`; `REFRESH_TOKEN_PEPPER` is now Render-generated.
10. **.claude/commands/bot-test.md, perf-check.md, release-checklist.md** (lead): `/bot-test` runs locally by default, `--staging` ≤ 5 min, never production; release checklist gains "release-client workflow green / manual promote" and a `/status` egress + instance-hours check.
11. **tools/bots, tools/perf, tests/e2e** (qa-test-engineer, at implementation): refuse `PROD_SERVER_HTTP_URL`; bots use the `packages/sim` reconciler.
12. **GDD / progression-and-economy** (game-designer): confirm dust-class bake shares, Detailing as a depth-255 0.5 m disc, and that the 30/90-day compaction notice wording is acceptable.
13. **pnpm install** (devops, between waves): after removing the `colyseus` meta package, run `pnpm why @colyseus/core` to confirm one resolution.

## Not changed / judgement calls

- `NODE_OPTIONS` stays `--max-old-space-size=384` until the M0 GC evaluation (reviewer asked to evaluate, not to change blindly).
- `render.yaml` keeps `region: oregon` as an explicitly marked placeholder (Blueprints need a value; the real choice depends on Aiven's assigned region).
- Contracts per player follows the GDD (3), not the reviewer's 1–2; per-Contract caps and compaction carry the capacity load instead.
