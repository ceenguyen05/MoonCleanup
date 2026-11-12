# Performance budgets — Clean The Moon!

Status: **Planning baseline (2026-11-12)** — engineering targets to be validated by the M0-W2 render and netcode spikes · Owner: performance-profiler (measurement), each subsystem owner (staying inside its line).
Canonical: [tech-stack.md](tech-stack.md) (three r187 WebGPURenderer + WebGL2 backend, ≤ 600 draws Tier A, 20/10 Hz server). Evidence: [browser-feasibility.md "Recommended budgets"](../research/browser-feasibility.md), [netcode.md §14–15](netcode.md), [terrain-and-dust-techniques.md §4.4](../research/tech/terrain-and-dust-techniques.md), [moon-sweepers-reception.md §4 C4](../research/moon-sweepers-reception.md) (performance collapse at scale is a top complaint).

A budget is a **ceiling** at the 95th percentile of frames during the reference scenes (§9). Anything over budget is a `/perf-check` failure, not a note.

## 1. Hardware tiers

| Tier | Reference devices | Backend | Output | Internal render scale (dynamic) | Default preset | Target |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | RTX 4060 Laptop (reference), RTX 4050/5050/5060 Laptop | WebGPU | 1920×1080 – 2560×1440 | 0.75–1.0, DPR cap 1.5 | High | **Locked 60 FPS** (16.7 ms) |
| **B** | Intel Iris Xe 96EU, Intel Arc 140V, AMD Radeon 780M | WebGPU | 1920×1080 | Low 0.50–0.75 / Medium 0.60–0.85, DPR cap 1.0 (canonical: rendering-pipeline §14) | Low/Medium | **30+ FPS** (33.3 ms), stretch 45 |
| **C** | Any device without WebGPU (≈ 11–19 % of visitors, [browser-feasibility.md §1.2](../research/browser-feasibility.md)) | WebGL2 fallback (three auto backend) | 1920×1080 | 0.5–0.75, DPR cap 1.0 | Low | **30 FPS** on Tier-B-class hardware; best effort elsewhere |
| Ultra (preset, not a tier) | RTX 4070+ desktop | WebGPU | up to 3840×2160 | 0.85–1.00, DPR cap 2.0 (canonical: rendering-pipeline §14) | Ultra | 60 FPS |

Naming: **hardware tiers A/B** are device classes; **Tier C** is any device on the WebGL2 backend (backends `webgpu` / `webgpu-compat` / `webgl2`; the old G1/G2/G3 names are retired). Preset knobs (cascade count and size, ring and atlas sizes, render-scale ranges, particle counts) are **not** restated here: [rendering-pipeline.md §14](rendering-pipeline.md) is the canonical preset table (TAD F2); `shared/render/quality.ts` is generated from or checked against it. This doc owns only ceilings per tier.

Adapter-based default preset selection at first run; dynamic resolution steps the render scale to hold the target (GPU timestamps where available, CPU frame-time heuristic otherwise).

## 2. Frame-time split (main thread CPU)

Frame order from [module-boundaries.md §4](module-boundaries.md): input → net ingest → sim predict → gameplay → animation → terrain/dust → visuals/VFX → render → audio → UI flush.

| Subsystem (owner path) | Tier A (ms) | Tier B (ms) | Tier C (ms) |
| --- | --- | --- | --- |
| Input + net ingest (decode frames, interpolation buffer) — `gameplay`, `net` | 0.5 | 0.8 | 0.8 |
| Sim predict (fixed steps, replay on ack) — `packages/sim` via `gameplay` | 1.0 | 1.5 | 1.5 |
| Gameplay (interaction, camera rig, tool aim) — `gameplay` | 0.5 | 0.8 | 0.8 |
| Animation (mixers, foot IK, ≤ 16 skinned avatars + robots) — `animation` | 1.5 | 2.0 | 2.5 |
| Terrain/dust CPU (CDLOD selection, stroke batching, atlas residency) — `terrain` | 1.0 | 1.5 | 2.0 |
| Visuals/VFX CPU (particle emit, light updates) — `visuals` | 0.5 | 0.7 | 0.7 |
| Render submit (culling, BatchedMesh/instancing updates, encode) — `render` | 2.0 | 3.5 | 4.5 |
| Audio — `audio` | 0.2 | 0.3 | 0.3 |
| UI flush (store updates ≤ 15 Hz, React commit) — `ui` | 0.3 | 0.6 | 0.6 |
| GC / slack | 0.5 | 2.3 | 1.3 |
| **Total main thread** | **≤ 8.0** | **≤ 14.0** | **≤ 15.0** |

Workers (off main thread): KTX2 transcoding, meshopt decode, gzip inflate of dust payloads, terrain tile prep. Rule: no per-frame allocations in sim, net, animation and render hot loops; major GC pause p95 ≤ 5 ms.

## 3. GPU frame-time split

| Pass | Tier A (ms) | Tier B (ms) | Tier C (ms) |
| --- | --- | --- | --- |
| Shadows (CSM; A per §14; B (Medium) 3 × 1024², C (Low) 2 × 1024²; includes the own-lamp shadow and the night Earth CSM) | 2.5 | 4.0 | 4.0 |
| Terrain + opaque (CDLOD, structures, vehicles, avatars) | 5.0 | 10.0 | 10.0 |
| Dust (stroke replay into atlas, detail ring, rebuilds; compute on WebGPU, fragment pass with reverse-subtract blending on WebGL2, [WDS §7.3](world-and-dust-simulation.md)) | 0.5 | 1.0 | 1.5 |
| Ambient occlusion (GTAO; half-res on B/C) | 1.5 | 3.0 | 2.5 |
| Particles / VFX | 1.0 | 2.0 | 2.0 |
| Sky (stars, Earth, sun disk) | 0.3 | 0.5 | 0.5 |
| Post (bloom, AgX, TRAA on A / SMAA on B/C) | 1.5 | 3.0 | 3.0 |
| UI composite | 0.2 | 0.5 | 0.5 |
| Headroom | 1.5 | 4.0 | 4.0 |
| **Total GPU** | **≤ 14.0** | **≤ 28.0** | **≤ 28.0** |

## 4. Draw calls, triangles, memory

| Budget | Tier A | Tier B | Tier C |
| --- | --- | --- | --- |
| Draw calls per frame (all passes incl. shadows) | **≤ 600** | **≤ 350** | **≤ 350** |
| Shadow-pass share of draws | ≤ 200 | ≤ 100 | ≤ 100 |
| Triangles per frame (all passes) | ≤ 4 M | ≤ 1.5 M | ≤ 1 M |
| Pipelines/programs created during gameplay | 0 | 0 | 0 |
| GPU memory total (own accounting) | ≤ 3.0 GB | ≤ 1.25 GB | ≤ 1.0 GB |
| — texture pool (incl. KTX2 materials) | ≤ 1.5 GB | ≤ 600 MB | ≤ 500 MB |
| — terrain height cube map (6 × 1024² r16uint + mips) | 16 MiB | 16 MiB | 16 MiB |
| — dust + terrain total (RGBA8 atlas + direction R8 + scratch + RGBA8 ring + direction R8 + height + plot data + horizon map, per [WDS §9](world-and-dust-simulation.md)) | ≤ 129 MiB (Ultra), ≤ 105 MiB (High) | ≤ 67 MiB (Medium), ≤ 55 MiB (Low) | ≤ 55 MiB |
| — dust tile atlas (RGBA8, [WDS §7.2](world-and-dust-simulation.md)) + direction R8 texture | 32 MiB (High 4096×2048) + 8 MiB | 16 MiB (Medium 2048²) + 4 MiB | 8 MiB (Low 2048×1024) + 0 |
| — detail ring (RGBA8, [WDS §7.5](world-and-dust-simulation.md)) + direction R8 texture | 16 MiB (2048²) + 4 MiB | 4 MiB (1024²) + 1 MiB | 4 MiB (1024²) + 1 MiB |
| — far-occluder horizon map (6 × 512², 8 azimuths; [WDS §3.2](world-and-dust-simulation.md)) | 12 MiB | 12 MiB | 12 MiB |
| — Survey Globe hex mode (lazy, not on Low) | +16 MiB | +16 MiB | +16 MiB |
| — shadow maps | ≤ 53 MiB | ≤ 16 MiB | ≤ 9 MiB |
| — render targets (HDR half-float chain at internal res) | ≤ 300 MB | ≤ 120 MB | ≤ 120 MB |
| JS heap (used, steady state) | ≤ 400 MB | ≤ 300 MB | ≤ 300 MB |
| Skinned characters on screen | 16 avatars + 24 robots full rate | 16 + 12 (rest LOD/impostor) | same as B |
| Simultaneous animated robots | ≤ 32 near, rest frozen/instanced | ≤ 16 | ≤ 16 |
| Particles (dust grains) | GPU line of §3 only | same | WebGL2 CPU pool within the VFX CPU line; **minimum-juice floor**: on Low and WebGL2 emit fewer but larger grains (≥ 2 px at 3–4 m) rather than a thinner cloud, so every stroke still shows (TAD F14; counts in `quality.ts`) |

Rationale and sources: [browser-feasibility.md §3.2, §4](../research/browser-feasibility.md) (iGPU memory = shared half-RAM; no WebGPU budget API, so the engine keeps its own allocation ledger), [terrain-and-dust-techniques.md §4.4](../research/tech/terrain-and-dust-techniques.md) (atlas and ring sizes). Draw-call limits are tighter than research's general guidance because three's WebGPU path has per-draw CPU/UBO overhead (tech-stack §2, issue #30560).

## 5. Download and load time

| Budget | Value | Notes |
| --- | --- | --- |
| Download to first interactive lobby / title (compressed, cold cache) | **≤ 20 MB** | JS ≤ 1.5 MB gz total (three core ≈ 200 KB gz, React + Motion ≈ 70 KB gz, app), CSS ≤ 100 KB, fonts ≤ 300 KB, lobby moon (low-mip height map + orbit material) ≤ 6 MB, menu audio ≤ 1.5 MB, decoders (Basis, meshopt wasm) ≤ 1 MB |
| Download to first in-world frame (Low/Medium pack) | ≤ 50 MB cumulative | Outpost area, avatar, Desk Duster, nearby terrain tiles |
| High pack (streamed after first session starts) | ≤ 120 MB cumulative | Tier A only |
| Total streamed budget (all packs, Ultra) | ≤ 250 MB | |
| Lobby interactive, 50 Mbit/s, cold cache | ≤ 5 s | Tier A and B |
| Lobby interactive, warm cache | ≤ 2 s | Hashed immutable assets |
| Clock In → first in-world frame (server awake) | ≤ 8 s A / ≤ 12 s B | Includes the blocking join snapshot (typ. 20–35 KB, ≤ 150 KB, [netcode.md §9.1](netcode.md)) |
| Clock In → first in-world frame (server asleep) | ≈ server wake (~60 s) + 3 s, counted from the first title-screen interaction | Assets stream from page load; the wake probe starts at the first title interaction, so streaming overlaps most of the wake ([system-overview.md §3](system-overview.md#3-boot-and-cold-start-sequence)) |
| Shader / pipeline warm-up | All permutations from the pipeline manifest compiled async behind the lobby: ≤ 4 s A, ≤ 8 s B, ≤ 10 s C (rendering-pipeline) | Gameplay pipeline creations = 0 |
| LCP / INP / CLS (DOM shell) | ≤ 2.5 s / ≤ 200 ms / ≤ 0.1 | |

Delivery: Vercel Brotli/gzip for JS/JSON/WGSL; KTX2 (UASTC normals/hero, ETC1S bulk) with Zstd; `immutable` caching for hashed files, short TTL for `index.html` and the asset manifest ([browser-feasibility.md §5](../research/browser-feasibility.md)).

## 6. Server budgets (Render Free, 0.1 CPU / 512 MB)

| Budget | Value | Derivation |
| --- | --- | --- |
| Process CPU per tick at 20 Hz (all rooms) | 5 ms | 100 ms CPU per s ÷ 20 |
| One 16-player room, tick p50 / p95 / max | ≤ 2.3 / ≤ 3.5 / ≤ 8 ms (max excludes traced major GC) | [netcode.md §15](netcode.md#15-server-cpu-budget-01-cpu) |
| One full room share of CPU | ≤ 50 % (tech-stack revisit trigger), target ≈ 45 % (incl. robot ledger ops and dust interest) | |
| Max process stall with GC traced | ≤ 50 ms (10-min 16-bot run) | M0 evaluates heap cap 192–256 MB, semi-space size, `--single-threaded-gc` |
| Solo Shift room, tick p95 | ≤ 0.4 ms | |
| Event-loop delay p99 | ≤ 20 ms | |
| Process static (shared by all rooms) | ≈ 21 MB | Precomputed grid, neighbours, class/area arrays, height map ([WDS §4.3](world-and-dust-simulation.md)) |
| Memory per 16-player room | typical ≈ 12 MB, heavy ≤ 48 MB | Dust per WDS §4.3 (Uint8 states + Uint8 L0 cache 320 KB, ledgers 1.1 KB each: typ. 4–8 MB, heavy ≤ 40 MB incl. log share) + entities/structures ≤ 4 MB + client buffers ≈ 1.2 MB + save build ≤ 2 MB + snapshot cache ≈ 0.4 MB |
| Process RSS | ≤ 300 MB (baseline 50–80 MB + static 21 MB + ≤ 3 rooms); V8 heap cap 384 MB until the M0 GC evaluation | `NODE_OPTIONS=--max-old-space-size=384` |
| Rooms per instance | Admission by measured tick budget (`TICK_BUDGET_MS` 3.5) with **`MAX_ROOMS` = 3 as a hard ceiling**; `MAX_CLIENTS` 24. The free tier hosts only a few live Contracts at once; Open Shifts share rooms | [netcode.md §15](netcode.md#15-server-cpu-budget-01-cpu) |
| Checkpoint slice | ≤ 1.5 ms CPU per tick | Avoids CFS quota stalls |
| Bandwidth per client | ≤ 6.0 KB/s busy, ≤ 3 KB/s typical (20/10); hidden tab ≈ 0.3 KB/s | [netcode.md §14](netcode.md#14-bandwidth-budget-server--client) |
| Join snapshot | Blocking part typ. 20–35 KB, ≤ 150 KB; streamed ledgers afterwards at ≤ 8 KB/s | [WDS §5.4](world-and-dust-simulation.md), [netcode.md §9.1](netcode.md) |
| Boot to listening (cold) | ≤ 5 s of our code **measured at 0.1 CPU** (Render adds the rest of the ~1 min wake) | Lazy DB connect, no migrations at boot, precomputed grid binaries (no table generation at boot or in `onCreate`) |
| Room creation | Save decode sliced ≤ 1.5 ms per tick; no live room's tick p95 rises > 0.5 ms meanwhile | [netcode.md §9.4](netcode.md) |
| SIGTERM drain | ≤ 25 s | [netcode.md §9.3](netcode.md#93-deploy--restart-sigterm) |

### 6.1 DB writes per day

| Source | Per busy room-hour | Example: 10 room-hours/day |
| --- | --- | --- |
| Checkpoints (≤ every 30 s when dirty: header ≈ 0.1 MB + dirty chunks ≈ 0.15 MB, one transaction) | 120 transactions, ≈ 30 MB | 1,200, ≈ 0.3 GB |
| Lease renewals (10 s, CAS) | 360 tiny | 3,600 |
| Profile flushes (60 s per active player) | ≤ 960 tiny (16 players) | ≤ 9,600 |
| Usage / achievements / audit | < 50 | < 500 |

### 6.2 5 GB/month egress → playable hours

| Session shape (20/10 Hz) | Egress per room-hour | Room-hours per month | Player-hours per month |
| --- | --- | --- | --- |
| 16 players, busy | ≈ 337 MB | ≈ 15 | ≈ 240 |
| 8 players, mixed | ≈ 115 MB | ≈ 43 | ≈ 345 |
| 4 players, typical | ≈ 36 MB | ≈ 140 | ≈ 560 |
| Solo Shift | ≈ 5.8 MB | ≈ 860 | ≈ 860 |
| 16 players at 30/15 Hz | ≈ 477 MB | ≈ 10 | ≈ 170 |

Math: per-client bytes from [netcode.md §14](netcode.md#14-bandwidth-budget-server--client) × players × 3,600 s; 5 GB taken as 5,000 MB. Client assets come from Vercel (100 GB/month Hobby), not Render. Owner accepted suspension risk; usage is logged (room stats line, `ops_usage_daily`, month-to-date on `/status`). **Staging egress counts against the same 5 GB**: a 10-min 16-bot run costs ≈ 60 MB and a 1-h soak ≈ 340 MB, so staging bot runs are capped at 5 min (≈ 30 MB) and soaks run locally (§8).

### 6.3 Render instance hours

750 h/month per workspace shared by prod and staging. Prod sleeps when nobody plays; the wake probe fires only on the first title-screen interaction and never for bots/crawlers, so page views alone do not wake prod; staging is woken only for tests. Planning split: prod ≤ 600 h, staging ≤ 100 h, 50 h reserve ([environments.md §5](environments.md#5-render-free-tier-caveats)). Instance-seconds are logged to `ops_usage_daily` and shown month-to-date on `/status`; M0 verifies that Render health checks do not keep the instance awake.

## 7. Netcode budgets on the client

| Item | Budget |
| --- | --- |
| `FRAME` decode | ≤ 0.2 ms (A) / ≤ 0.4 ms (B) per message |
| `DUST_SNAPSHOT` / `DUST_LEDGER` inflate + apply | worker; ≤ 1 ms main-thread apply per message |
| Reconciliation replay (≤ 16 inputs) | ≤ 0.5 ms (A) / ≤ 1 ms (B) |
| Own-avatar correction p95 (120 ms ± 30 ms, 1 % loss) | ≤ 5 cm on flat ground; visible snaps ≤ 1 per 10 min |
| Interpolation delay | adaptive 150–250 ms |

## 8. How budgets are measured

| Budget group | Command / tool | Method | Where |
| --- | --- | --- | --- |
| FPS, CPU per subsystem, GPU per pass, draws, triangles | `/perf-check` (performance-profiler; `tools/perf` + F3 perf HUD in `apps/client/src/debug`) | Scripted camera paths over the reference scenes (§9); 60 s capture after 10 s warm-up; per-module `performance.mark` spans; GPU `timestamp-query` per pass (WebGPU; Chrome rounds to 100 µs), WebGL2 `EXT_disjoint_timer_query_webgl2` where present, else CPU-only; p50/p95/p99 reported | Real GPUs (Tier A laptop, Tier B iGPU laptop) — not CI |
| GPU memory | `/perf-check` | Engine allocation ledger (textures, buffers, render targets) vs budget; device-loss count | Real GPUs |
| JS heap, GC | `/perf-check` | `performance.measureUserAgentSpecificMemory` where available, else DevTools heap snapshot via CDP; GC pauses from trace | Chrome |
| Download size, load time | `/perf-check` + CI size check | Built `dist/` sizes by asset group (fail CI if first-load group > 20 MB); Playwright cold/warm load with 50 Mbit/s throttling; pipeline warm-up timer | CI (sizes), local (timings) |
| Pipelines during gameplay | `/perf-check` | Counter of pipeline creations after "warm-up complete" must be 0 | Real GPUs |
| Server tick, CPU, memory, GC stalls | `/bot-test` | 16 headless bots, netsim 120 ms ± 30 ms, 1 % loss, 10 min; room stats lines parsed; `process.cpuUsage` vs 0.1-CPU quota; GC trace | **Local** CPU-limited (0.1 CPU) container; staging Render Free only via `/bot-test --staging`, **≤ 5 min**, for the M0-W2 spike and before releases |
| Bandwidth per client | `/bot-test` | Bytes per message type per client from server counters; compared with [netcode.md §14](netcode.md#14-bandwidth-budget-server--client) | Same |
| DB writes, save size | `/bot-test` (1 h soak variant) | Checkpoint count, sizes, durations from room stats; DB size query at start/end | **Local** Docker Postgres (never a 1 h run on staging: it would spend ≈ 340 MB of the shared egress) |
| Production drift | Room stats line + `ops_usage_daily` | Weekly review of tick p95, bytes out per day, month-to-date egress | Prod logs |

Software-rendered CI (SwiftShader/WebGL2) is used for smoke and size checks only, never for frame-time budgets ([browser-feasibility.md §8](../research/browser-feasibility.md)).

## 9. Reference scenes

| Scene | Contents | Tiers |
| --- | --- | --- |
| S1 Outpost day | Outpost Dawnside, 16 avatars, 4 vehicles, Requisitions Desk, Glide Rails with 200 Dust Pucks, 3 machines | A, B, C |
| S2 Field cleaning | 4 avatars + Bulldust cleaning a partly Opened area, detail ring active, 10 Sandpipers | A, B, C |
| S3 Factory late game | 4,000 structures in view range, 64 robots, rails | A, B |
| S4 Orbit / Survey Globe | Whole moon with per-plot coverage, markers | A, B, C |
| S5 Night lamp | Crown Lamp Searchlight + Running Lamps, shadows on | A, B |

## 10. Open issues

1. Tier C (WebGL2) budgets are estimates; three's WebGL2 backend cost for TSL node materials is unmeasured. **Plan (TAD F22):** a WebGL2 capture of the real terrain shader (not a stand-in) in M0-W3 and an M1-W3 WebGL2 gate (S02/S03 on Tier C Low); half-res GTAO or a height-gradient cavity term stays on Low so contact shading survives.
2. Research suggested ≤ 2,500–4,000 draws for Tier A; canonical ≤ 600 is kept (it is the conservative choice for three's WebGPU overhead).
3. Radeon 780M throughput was never obtained ([browser-feasibility.md §3.2](../research/browser-feasibility.md)); validate Tier B on all three iGPUs in the M0 spike.
4. **Tier B validation (TAD F3):** a real Tier B iGPU device is a **measurement input** (Q21); missing hardware blocks that verdict, not unrelated development; a laptop dGPU forced to its iGPU only yields a provisional verdict. The M0 bench must include a worst-case terrain-shader stub with the full fetch/ALU count of [WDS §7.7](world-and-dust-simulation.md) and rendering-pipeline §7 (3 detail layers, plot lookup, ring + atlas, sparkle), and a second capture after look-dev; ADR-0003 is decided on that run.
5. **Pre-declared Tier B fallback ladder** if the 7 ms terrain line (WDS §9) or the 10 ms terrain + opaque line fails: the ladder lives in [rendering-pipeline.md §14.2](rendering-pipeline.md) (5 steps, each a `quality.ts` value change measured by `/perf-check`); its result is recorded in ADR-0003's follow-up note.
