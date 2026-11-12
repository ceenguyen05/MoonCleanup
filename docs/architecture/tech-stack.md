# Tech stack — Clean The Moon!

> **Current execution correction (2026-11-12):** [ADR-0029](../adr/0029-single-deploy-branch-main.md) governs deployment: `main` only, Vercel production + one Render service.
> Older `release`-branch, branch-promotion and separate-staging setup instructions below are superseded; do not execute them.
> Use local/test fixtures and read-only live checks; hosted load tests need an explicitly approved isolated safe fixture.
> [MODEL_POLICY](../handoff/MODEL_POLICY.md) governs model/reading/review overhead; technical acceptance criteria remain.


Status: **Accepted (planning session 2026-11-11/12)** · Owner: lead/orchestrator · Changes only via a new ADR.
Evidence: [`docs/research/tech/`](../research/tech/) (advocate reports, platform limits, tooling versions).
Every row below links to its ADR in [`docs/adr/`](../adr/README.md).

## 1. Hard constraints that shaped every decision

| Constraint | Source | Consequence |
| --- | --- | --- |
| **$0 forever** hosting budget | Owner decision 2026-11-11 | Free tiers only: Vercel Hobby, Render Free web service, Aiven **PostgreSQL** Free, GitHub Free, Sentry Developer |
| Render Free = **0.1 CPU / 512 MB**, spins down after 15 min idle (WebSocket messages count as traffic), ~1 min cold start, restarts "at any time", 750 instance-h/month per workspace | [platform-limits.md](../research/tech/platform-limits.md) §B | Lean server: **no server physics**, 20 Hz sim / 10 Hz snapshots by default, checkpoint to DB every ≤30 s, cold-start-aware client |
| Render Hobby **5 GB outbound/month**; no card → services suspended for the rest of the month | platform-limits §A8 | Bit-packed deltas, interest management, bandwidth telemetry. Owner **accepted suspension risk** (no hard cap logic) — see OPEN_QUESTIONS Q4 |
| **Aiven free MySQL retired** (6 Nov 2026) | platform-limits §C, data-auth-observability §0 | Owner chose **Aiven PostgreSQL Free** (1 CPU, 1 GB RAM, **1 GB storage**, powers off when idle) |
| Vercel Hobby: static client only, non-commercial use | platform-limits §A | No monetization; Functions not used for realtime |
| No UDP on Render | netcode-case-webrtc-webtransport.md | WebSocket (TCP) only; transport abstraction keeps a WebTransport door open |
| Visual bar = heaviest weight | brief | WebGPU-first renderer with a real WebGL2 path; budgets per hardware tier |
| Built by AI agents in parallel | brief | Familiar APIs, pinned versions, stable contracts, small packages with single owners |

## 2. Weighted decision matrix — rendering engine (ADR-0003)

Weights: visual quality & performance **40%**, (netcode reliability n/a for engine), solo-dev simplicity **25%**, parallel-workstream modularity **15%**, agent familiarity/ecosystem **20%**. Scores 1–5 are the lead's normalization of the three advocate reports (advocates self-scored on different scales).

| Criterion (weight) | Three.js r187 WebGPURenderer + TSL | Babylon.js 9.35 | PlayCanvas 2.24 |
| --- | --- | --- | --- |
| Visual ceiling (15%) | 5 — CSMShadowNode, AgX/ACES/Neutral, GTAO, TRAA/SMAA, SSR/SSGI, compute particles | 5 — nearly all built in; no AgX/SMAA built-in | 4.5 — AgX, SMAA, TAA-upscale just added |
| Performance control (15%) | 3.5 — issue #30560 CPU/UBO overhead on WebGPU path; mitigate with BatchedMesh/instancing/chunking | 4.5 — snapshot rendering, frame graph | 4 |
| WebGPU maturity + WebGL2 fallback (10%) | 3.5 — "experimental" label, auto fallback, compute atomics missing on WebGL2 | 4.5 — WebGPU "complete" | 3 — WebGPU "Beta" |
| Terrain/compute suitability (agent-built custom sphere LOD + dust masks) (incl. above) | 4.5 — TSL compute + storage textures, one shader source → WGSL/GLSL | 4 — WGSL-only compute | 3 |
| Solo-dev simplicity (25%) | 3.5 — renderer, not an engine; we assemble | 4 — batteries included | 4 |
| Modularity for parallel agents (15%) | 4.5 — small composable modules; no engine scene conventions to fight | 4 — frame graph DAG | 4 |
| Agent familiarity/ecosystem (20%) | 4.5 — 35.6M weekly downloads, official `llms.txt`; risk: legacy WebGL habits | 3 — ~1% of three's downloads; `llms.txt` + MCP help | 2.5 — editor-style code in the wild |
| First-load JS | ~200 KB gz core (est.) | ~675 KB gz for a PBR glTF scene (Babylon team) | ~730 KB gz |
| **Weighted total** | **4.05** | **3.98** | **3.45** |

**Decision: Three.js r187 (`three@0.187.0`, pinned exactly) with `WebGPURenderer` + TSL; vanilla (no React Three Fiber).**
It wins narrowly on the combination of agent familiarity, one-source TSL shaders for both backends (the dust system needs a WebGL2 path) and load size. Babylon is the documented runner-up.
**Mitigations:** draw-call discipline (BatchedMesh, instancing, chunked terrain, ≤ 600 draws Tier A), a ban-list lint rule for legacy APIs (`WebGLRenderer`, `EffectComposer`, `ShaderMaterial` GLSL, `renderAsync`, `PostProcessing`), vendored docs snapshot in `docs/vendor/three-r187/` (M0 task), M0 render spike.
**Revisit trigger:** the M0-W2 render spike shows WebGPU-path CPU frame time > 6 ms on Tier B for the MVP scene, or a blocking WebGPURenderer bug persists > 2 releases → prototype the same scene in Babylon 9 under the competing-approach rule.

## 3. Netcode framework matrix (ADR-0014, ADR-0015 superseded by ADR-0025)

| Criterion (weight) | Colyseus 0.18 (+uWS transport, raw-bytes hot path) | Custom on uWebSockets.js | WebRTC/WebTransport | Socket.IO 4.8 |
| --- | --- | --- | --- | --- |
| Reliability (loss/reconnect) (30%) | 4 — seat holding, auto-reconnect, SIGTERM hooks | 3.5 — all ours to build | n/a — **infeasible on Render** (no UDP) | 3.5 |
| Prediction/reconciliation fit (20%) | 4 — built-in module (new) or our own | 4 | — | 2.5 |
| Bandwidth efficiency (15%) | 4 — encode-once schema + our bytes | 5 | — | 3 |
| CPU on 0.1 core (15%) | 3.5 — unproven; uWS + no StateView | 4.5 | — | 2.5 |
| Solo-dev simplicity (20%) | 4.5 — rooms, lobby listing, `joinById`, loadtest bots included | 2.5 — +9–11 agent-days of plumbing | — | 3.5 |
| **Weighted** | **4.0** | **3.75** | — | 3.1 |

**Decision:** Colyseus `0.18.x` server (`colyseus`, `@colyseus/core`, `@colyseus/schema` 5.x, `@colyseus/sdk` client) on the **uWebSockets.js transport**; entity state through Schema **without StateView** (encode once, broadcast); the dust field, strokes and compact snapshots through **`broadcastBytes`/`sendBytes` with our own codec** in `packages/protocol`. The room simulation lives in `packages/sim` and does not import Colyseus (so it can run in a Web Worker for offline solo later, and the transport can be swapped).
**Revisit trigger:** M0-W2 netcode spike on a real Render Free instance shows one 16-bot room > 50% of the 0.1-CPU budget at 20 Hz → replace the Colyseus edge with the custom uWS adapter (ADR-0014 alternative).

## 4. The full stack

| Layer | Choice (pinned) | ADR |
| --- | --- | --- |
| Language | TypeScript **6.0.3** everywhere (`tsgo` 7.0.2 optional for fast CLI typecheck) | 0001 |
| Runtime | **Node.js 26 LTS** (`.nvmrc` 26.13.1, `engines.node: 26.x`) — Active LTS since 2026-10-28; Vercel default 26.x; Render reads `.nvmrc`; uWS ships Node 26 binaries | 0001 |
| Package manager / monorepo | **pnpm 11.28.9** workspaces (pinned via `packageManager`; Corepack is not bundled with Node ≥ 25 → installed by `pnpm/action-setup` in CI and by explicit install command on Vercel/Render) + **Turborepo 2.x** task graph | 0001 |
| Bundler / dev server | **Vite 8.3.x** (Rolldown) | 0001 |
| Renderer | **three 0.187.0**, `WebGPURenderer` + TSL, auto WebGL2 backend | 0003, 0004 |
| Post / look | Three node post pipeline (`RenderPipeline`): HDR half-float, **AgX** (ACES selectable), bloom, GTAO, TRAA (High/Ultra) / SMAA (Low/Medium), dynamic resolution via per-pass `setResolutionScale` | 0005 |
| Shadows | `CSMShadowNode`, 3 cascades (Low 2, Ultra 4), filtered PCF; contact-hardening off by default | 0006 |
| World grid | Icosahedral hex grid (Goldberg GP(m,0)), 10m²+2 plots; diamond (i,j) indexing; contract sizes Moonlet m=64 / Standard m=128 | 0007 |
| Terrain | **CDLOD on a spherified cube** + resident height cube map (NASA LOLA LDEM_16/64 baked, vertical exaggeration) + procedural near-field detail | 0008 |
| Dust | Server: per-plot scalar + 32×32×8-bit **coarse ledger** (absolute, coverage-weighted removal; order-independent) for partly cleaned plots; clients: GPU **stroke replay** into a per-plot tile atlas (64²–128²) + high-res detail ring; orbit view from per-plot values on the level-k icosphere. Canonical spec: [world-and-dust-simulation.md](world-and-dust-simulation.md) | 0009, 0026 |
| Movement / physics | Shared deterministic-ish **kinematic sim** in `packages/sim` (analytic height function, capsule/OBB primitives, raycast-suspension vehicles). **No physics engine on the server.** Rapier 0.21 client-only for cosmetic props/debris (v1.0, optional) | 0010 |
| Animation | glTF skinned characters, `AnimationMixer` blend layers (locomotion 1D/2D blend, additive upper-body tool layer), procedural foot IK + low-g bounce; sources: original/commissioned, CC0, Mixamo **never committed** | 0011 |
| UI | DOM overlay: **React 19** + **Motion** (`motion/react`) springs, CSS Modules + CSS custom-property design tokens, Lucide (ISC) base icons + custom SVG; game↔UI via a typed external store (`useSyncExternalStore`) | 0012 |
| Assets | glTF 2.0 + **meshopt** + **KTX2** (UASTC for normals/hero, ETC1S for bulk) via glTF-Transform; Opus/WebM + AAC fallback audio | 0013 |
| Asset storage | No Git LFS by default; commit only compressed game-ready derivatives (budgeted); raw/source art outside git with a manifest | 0017 |
| Netcode | Colyseus 0.18 + uWS + custom binary hot path; one room per Contract via REST join + lease CAS; horizon-aware interest | 0014, 0025 |
| REST API | Served by the same Node process as the rooms. Default: Colyseus 0.18's built-in HTTP routing on the uWS transport; the M0 netcode spike (M0-W2) confirms it, else plain handlers registered directly on the uWS app. No Express. Routes: `/healthz`, `/readyz`, `/status`, `/v1/*` (the only REST prefix; see system-overview.md §2.1) | 0014 |
| Protocol encoding | Schema for entity state; hand-rolled bit-packed `DataView` codec for dust/strokes/compact snapshots | 0023 |
| Validation / config schemas | **zod 4** (message validation at the API edge, balance config validation, env parsing) | 0024 |
| Database | **Aiven for PostgreSQL Free** + **Drizzle ORM 0.45.x** + `drizzle-kit 0.31.x` + `postgres` driver; migrations generated by `backend-data-engineer`, reviewed in PR, applied in the Render **build command** | 0016 |
| Auth | Guest-first: opaque refresh token (hashed in DB) + 15-min `jose` JWT access token; Bearer header for REST; token in Colyseus join options → `onAuth`; account linking (Discord/Google/GitHub OAuth) post-launch | 0018 |
| Hosting | Vercel Hobby (static client) · Render Free web service ×2 (prod tracks `release`, staging tracks `main`) · Aiven PG Free (two logical DBs) | 0002 |
| Observability | Sentry Developer (browser + node 11.12.x, source maps via `@sentry/vite-plugin`), **pino 10** JSON logs, 1 "room stats" log line/room/min, `/healthz` + `/readyz`, UptimeRobot free (optional) | 0020 |
| Testing | **Vitest 5.1** (unit + browser mode), **Playwright 1.65** (e2e + screenshots, two lanes: CI software WebGL2 smoke, local real-GPU baselines), in-process network conditioner + Toxiproxy, `@colyseus/loadtest` + custom headless bots (16 players) | 0019 |
| Lint / format | ESLint 9 flat config + typescript-eslint 8.72 + Prettier 3 (ban-list rules for legacy three APIs and cross-package imports) | 0001 |
| Platform scope | Desktop browsers (keyboard/mouse + gamepad). Mobile/touch: post-launch | 0021 |
| Architecture style | Plain TS sim with typed component stores + **typed event bus**; no ECS library | 0022 |

Exact versions are in each `package.json`; `docs/research/tech/tooling-and-libraries.md` has the evidence. Dependabot ignores majors of engine-level packages (ADR required).

## 5. What is deliberately NOT used

| Not used | Why |
| --- | --- |
| React Three Fiber | WebGPU only in v10 alpha; reconciler overhead in the game loop |
| WebGLRenderer / EffectComposer | Legacy path; all new three work targets WebGPURenderer |
| Server-side physics engine | 0.1 CPU budget; kinematic sim is replayable and cheap |
| Prisma | `latest` is 8.0 RC with a new API; MySQL/PG churn; shadow DB requirement |
| WebRTC / WebTransport / geckos.io | Render exposes no UDP |
| Git LFS (default) | 10 GiB/month bandwidth shared with every Vercel build |
| Cookies across origins | `*.vercel.app` ↔ `*.onrender.com` are different sites |
| WASM threads / SharedArrayBuffer | Needs COOP/COEP; Safari lacks `credentialless`; not needed for MVP |
| Gacha / paid convenience | Not monetized; Roblox paid conveniences become earnable upgrades |
