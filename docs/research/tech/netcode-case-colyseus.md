# Netcode Case: Colyseus as the Authoritative Multiplayer Framework

*Date: 2026-11-11 · Author: advocate subagent P2d · Type: advocacy research (honest case) · Research only, no code*

> **How to read this.** This is the case *for* Colyseus, written to hold up when the decider cross-checks it. Every factual claim cites a numbered source (title, URL, access date 2026-11-11) in **Sources**. Anything labelled **estimate** or **assumption** is my own arithmetic or engineering judgement, not a published figure. Where I could not verify something, I say so. The owner's later constraint (a **$0 budget**, so production runs on Render's **Free** web service) is assessed in §5 (bandwidth) and §7.6 (CPU and memory).

---

## Executive summary

- **Versions.** The current line is **0.18**, announced 2026-08-20 and described by the maintainer as "the last release before 1.0". As of 2026-11-11 the newest packages are `colyseus` **0.18.12** (Nov 7), `@colyseus/core` **0.18.28** (Nov 10), browser/JS client `@colyseus/sdk` **0.18.10** (Nov 10) and `@colyseus/schema` **5.0.47** (Nov 11, marked "Latest"). The license is MIT, the repo has about 7.5k GitHub stars, and releases ship several times a week. [1][3][4][5]
- **Our netcode model is built in.** Since 0.18 the framework ships client-side prediction, server reconciliation with smoothed corrections, remote-entity interpolation modes (lerp, extrapolate, damped, reckon), a fixed-timestep server loop whose tick rate is sent to clients in the join handshake, buffered inputs with acks, clock sync and lag compensation. A solo developer does not have to hand-build any of these primitives. [1][6][7][8]
- **The rest of the room server is built in too.** Rooms with lifecycle hooks, `joinOrCreate`, private invite rooms (`joinById`), room metadata with a live lobby listing, seat reservation, `onAuth`, automatic client reconnection with server-side seat holding and state resync, graceful SIGTERM shutdown, a unit-test harness and headless load-test bots. [2][16][17][18][19][20][21][22][24][25]
- **State sync is compact.** A changed field costs 1 byte plus its value. Quantized floats cost 1–2 bytes. Unchanged data costs 0 bytes. Without per-client views, each patch is encoded once and the same buffer goes to every client. **Estimate:** about **15 KB/s per client** for our entity set with the recommended design, versus about 54 KB/s naive (§5). [15][12]
- **The 163,842-sector dust field must not go through Schema.** At those indices a Schema collection costs about 6 bytes per changed cell, and the join snapshot would be roughly 1 MB (estimate). The docs also say StateView "is not optimized" for large datasets. Use Colyseus' raw binary channel (`sendBytes`, `broadcastBytes`, `onMessageBytes`) with our own chunked delta format. That part is custom code whichever framework we pick. [14][15][16]
- **Render works, but over TCP only.** WebSockets are supported (one public port, `wss://`, no maximum connection duration). Render offers no public UDP, so Colyseus' experimental WebTransport transport and its unreliable channel cannot be used there. This costs Colyseus little, because its default and recommended transports are WebSocket-based. [9][10][11][30][32]
- **Every deploy or restart disconnects all players.** Clients receive close code `SERVER_SHUTDOWN` (4001), which does not trigger auto-reconnect. Colyseus provides the hooks: Render sends SIGTERM, rooms are locked, and async `onBeforeShutdown` and `onDispose` can checkpoint to MySQL. The rejoin-and-restore flow is our own code. [17][19][20][30]
- **On the $0 Free tier (0.1 CPU / 512 MB):** memory is not a concern. CPU is plausible but unproven for one 16-player room at 30 Hz, and no published per-room CPU benchmarks exist. To make it fit: encode-once broadcast (no StateView), the uWebSockets.js transport, the new opt-in auto-batching, and low-rate sync for robots. Prove it in week 1 with `@colyseus/loadtest` against a real Free instance. [3][11][15][24][26][29]
- **Bandwidth is the harder $0 ceiling, and it applies to every framework.** Render Hobby includes **5 GB/month** of outbound traffic, WebSocket messages count toward it, and with no card on file Render spins services down until next month. That works out to about **5–6 full 16-player hours per month** (estimate, §5). [31]
- **Main risks.**
  - TCP head-of-line blocking under packet loss.
  - Maturity: the netcode module and Schema 5 are about 3 months old, and ArraySchema desync fixes were still landing in Oct–Nov 2026.
  - A single maintainer.
  - API churn in 0.17 and 0.18, so AI agents' built-in knowledge of Colyseus is stale. [1][2][4]
- **Verdict.** On Render, Colyseus is the lowest-risk path to a correct authoritative server with prediction and reconciliation for a solo dev working with agents. The genuinely hard parts (dust-field sync, continuity across deploys, the $0 bandwidth and CPU limits) need custom work under every option, and Colyseus removes most of the rest. [1][6][16][21][30][31]

---

## 1. Version, license, maintenance, community

### 1.1 Current versions (as of 2026-11-11)

| Package | Version | Released | Source |
|---|---|---|---|
| `colyseus` (server meta-package) | 0.18.12 | 2026-11-07 | [3] |
| `@colyseus/core` | 0.18.28 | 2026-11-10 | [3] |
| `@colyseus/sdk` (JS/TS client) | 0.18.10 | 2026-11-10 | [3] |
| `@colyseus/schema` | 5.0.47 (marked "Latest") | 2026-11-11 | [4] |
| `@colyseus/ws-transport` | 0.18.5 | 2026-11-10 | [3] |
| `@colyseus/uwebsockets-transport` | 0.18.5 | 2026-11-10 | [3] |
| `@colyseus/h3-transport` (WebTransport) | 0.18.6 | 2026-11-10 | [3] |
| `@colyseus/bun-websockets` | 0.18.5 | 2026-11-10 | [3] |

GitHub's release lists show day and month without a year for current-year entries. The year 2026 is inferred from today's date and their position at the top of the lists [3][4].

### 1.2 Release history

- **0.17, 2026-02-06** [2]:
  - Automatic client reconnection.
  - `defineServer()` with end-to-end typed clients.
  - Typed HTTP routes with a playground UI.
  - `QueueRoom`, `maxMessagesPerSecond`, `room.ping()` and latency-based server selection.
  - Breaking changes: `onLeave(client, code)` now receives a close code instead of a boolean; `Room<{state, metadata, client}>` generics.
- **0.18, 2026-08-20** [1]:
  - Netcode module (prediction, reconciliation, lag compensation).
  - Schema 5.0: encoder about 2.4× faster than 4.0, quantized floats, delivery modifiers, experimental streaming.
  - Request/response messages, room plugins.
  - `@colyseus/database` and `@colyseus/admin` (beta).
  - Smaller browser SDK: about 58 KB gzip, down from about 191 KB.
  - Breaking changes:
    - A Schema can hold at most 63 fields.
    - `setMetadata` replaces metadata instead of merging.
    - `client.id` removed.
    - The fossil-delta serializer removed.

### 1.3 License and maintenance

- **License.** MIT [5].
- **Maintainer.** Endel Dreyer. The project describes itself as solo-maintained, independent and sponsor-funded, with 1.0 as the next target [1][2].
- **Activity.**
  - `@colyseus/core` 0.18.27 shipped on Nov 5 and 0.18.28 on Nov 10.
  - Schema went from 5.0.38 to 5.0.47 between Oct 12 and Nov 11, 2026 [3][4].
- **Repo metrics at access time.** 7.5k stars, 687 forks, 2,312 commits, 13 open issues, 3 open PRs [5].

### 1.4 Client SDK

- The client is now `@colyseus/sdk`, released from the main repo [3].
- A search-engine excerpt reported that the old `colyseus.js` repo was archived on 2026-03-15 [33]. I did not verify that directly.

### 1.5 Community and shipped games

- The official blog links a Discord [1]. I did not verify the member count.
- The release posts thank sponsors including Scorewarrior, Pixels.xyz, Bloxd, Poki and Wavedash [1][2]. Sponsorship does not prove production use.
- **I could not verify a list of shipped titles in this session.** The site footer links a "Success Stories" page [1], which I did not fetch.

### 1.6 Runtime

- **Node.js version requirement: not verified.** None of the docs pages I fetched state an `engines` constraint [11][26]. Check `engines` at install time.
- Bun is supported through a dedicated transport [3][9].

---

## 2. Architecture against our requirements

| Our need | Colyseus feature | Notes | Src |
|---|---|---|---|
| Room per moon session (≤16 players) | `Room` class; `maxClients` (default `Infinity`, auto-locks when full) | Set 16. Reconnecting clients can still reclaim seats in a locked room. | [16][22] |
| Lifecycle | `onCreate`, `onAuth`, `onJoin`, `onDrop` (0.17+), `onReconnect` (0.17+), `onLeave(client, code)`, `onDispose` (async), `onBeforePatch`, `onBeforeShutdown`, opt-in `onUncaughtException` | Server-side `defineRoom()` options override client-supplied options. `onDispose` is the documented place to persist data. | [17] |
| 30 Hz authoritative sim | `setFixedTimestep(step, tickRate)` | Accumulator loop; the tick rate is sent to clients in the join handshake; optional `subSteps`. `setTimestep()` (variable step, default 16.6 ms) replaces `setSimulationInterval()`. | [7][16][1] |
| 15–20 Hz snapshots | `patchRate`, default 50 ms (20 Hz) | `patchRate = null` disables automatic patches, then call `broadcastPatch()` manually. | [16] |
| Gameplay messages | `messages` map / `onMessage` | String or number types, MsgPack-encoded. Zod `validate()`. `"*"` fallback. Unhandled types disconnect with 4002. Request/response with `ctx.reject()`. Rate limit via `maxMessagesPerSecond`. | [16][1][2] |
| Large binary deltas (dust field) | `onMessageBytes` (raw `Uint8Array`, skips MsgPack); `client.sendBytes`; `broadcastBytes` (supports `except`) | First-class raw binary channel. | [16] |
| Delta state sync | `@colyseus/schema` | Patches and full-state syncs are separate channels. Per-change wire costs are published (§5). | [12][15] |
| Transient vs. join-only data | `.patchOnly()`, `.fullStateOnly()`, `.noSync()` | `.unreliable()` exists but works only on WebTransport (experimental). | [12] |
| Interest management | `StateView` per client: `.view()` / `@view(tag)`, `view.add/remove/has/subscribe` | Any `.view()` field forces per-client encoding. Docs: "not optimized" for large datasets. | [14][15] |
| Spawn bursts / nearest-first | Streaming collections, `t.stream(X)` | `maxPerTick` default 32, per-client priority callback. **Experimental**. | [13] |
| Quick-play matchmaking | `joinOrCreate`, `create`, `join`, `joinById`; `filterBy`, `sortBy` | `matchMaker.controller.exposedMethods` can block client-side creation. | [21] |
| Private rooms / invite codes | `private` flag via `setPrivate()` / `setMatchmaking()` | Private rooms are reachable only through `joinById`. Docs recommend this for "invite links and party codes". A Custom Room ID recipe exists (not fetched). | [22] |
| Lobby list | `LobbyRoom` plus `enableRealtimeListing()`; `metadata`; `unlisted` | `metadata` is replaced, not merged (0.18 change). | [21][22][1] |
| Seat reservation | All SDK joins go through the matchmaker and return a seat reservation the SDK consumes | `seatReservationTimeout` defaults to 15 s. | [21][16] |
| Reconnection | `onDrop`, then `allowReconnection(client, seconds \| "manual")`, then `onReconnect` | `sessionId`, `auth`, `userData` and `view` are kept; the token is regenerated. Client SDK details in the next table. | [18][19] |
| Auth | `onAuth`: static `(token, options, context)` or instance form; `context` exposes `token`, `headers`, `ip` | The return value becomes `client.auth`. `UniqueSessionPlugin` enforces one session per user. | [17][16][1] |
| Multi-process scaling | `RedisPresence` / `RedisDriver` | A room lives on one process, and clients connect directly to that process through a per-process `publicAddress`. Single process needs no Redis. | [23] |
| Transports | `ws` (default); uWebSockets.js (recommended for production); WebTransport (experimental); Bun | uWS: inbound `maxPayloadLength` 4096 B; `idleTimeout` 120 s; compression off; `maxBackpressure` 1 MiB. Express works through `uwebsockets-express`. | [9][10][11] |
| Shutdown | Handles SIGTERM, SIGINT and SIGUSR2: locks rooms, calls `onBeforeShutdown` (default: disconnect), waits for rooms to dispose | Async hooks are awaited. | [20] |

**Reconnection details** [18][19][1]:

| Behaviour | Value | Src |
|---|---|---|
| Client SDK auto-reconnect | Exponential backoff | [19] |
| `maxRetries` | 15 | [19] |
| `delay` / `minDelay` | 100 ms | [19] |
| `maxDelay` | 5,000 ms | [19] |
| `minUptime` | 5,000 ms (auto-reconnect only if the client was connected at least this long) | [19] |
| `maxEnqueuedMessages` | 10 (sends queued during the gap) | [19] |
| Codes that trigger reconnect (`onDrop`) | 1001, 1005, 1006, 4010 | [19] |
| Codes that go to `onLeave` (no reconnect) | 4000–4010 reserved, including `SERVER_SHUTDOWN` (4001) | [19] |
| State on rejoin | Reconciled into the existing decoded tree, keeping object identity and callbacks; entities removed while offline are pruned | [18][1] |
| After a page reload | `client.reconnect(token)` with a token kept in `sessionStorage` | [18] |

**Modularity.**

- Rooms can be composed from plugins: `definePlugins()`, `IdleKickPlugin`, `UniqueSessionPlugin` [1].
- Transports are swappable without touching room code [9].
- Schema is a separate package, and its encoder is usable on its own [4].

---

## 3. Prediction, reconciliation, interpolation

**Status: built in since 0.18 (2026-08-20).** The netcode docs list the 0.18-only APIs: `room.input()`, `Predict`, `defineInput()`, `setFixedTimestep()` and `allowRewindState()`. The framework runs the predict, reconcile and rewind loops. We supply a deterministic step function shared by client and server [6].

### 3.1 Server side [7]

- `defineInput(type, options)` declares the input format.
  - Inputs must be a flat schema.
  - `bufferMaxSize` defaults to 32 per client, about 1 s at 30 Hz.
  - Sanitizers clamp values (NaN maps to the floor).
  - The default `idle` policy skips empty ticks.
- Inputs are consumed with `for…of`, `next()` or `drain()`.
- Acks:
  - `consumedCount` is the reconcile ack the client sees.
  - `lastProcessed` advances when inputs are drained.
- The design assumes a reliable, in-order channel. That matches WebSocket on Render.
- `setFixedTimestep` passes `dt = 1/tickRate` to each step and sends `tickRate` and `subSteps` to clients in the join handshake.

### 3.2 Client side [8]

- **Setup.**
  - `Predict.get(room, { mode, delay })` creates the predictor; the documented default `delay` is 100 ms.
  - `predict.tick(now)` runs once per render frame, and each fixed step's input is sent once.
- **Smoothing modes for remote entities.**
  - `lerp`: render in the past, by `delay`.
  - `extrapolate`.
  - `damped`, with `smoothMs` defaulting to 50.
  - `reckon`: dead reckoning through a step function.
  - `raw`.
  - Options: `snap` (teleport threshold) and `angle` (shortest-arc interpolation for rotations).
- **Own avatar.** `predict.reconciler(self, { input, step, smoothMs })` replays unacknowledged inputs after each ack.
  - Corrections fade over `smoothMs`, which defaults to one patch interval, unless they exceed `snap`.
  - Drift telemetry is exposed as `drift.ema` and `drift.peak`.
- **Vehicles.** `predict.sim(...)` handles "composite state (paddle + puck, vehicle + cargo)" and physics engines such as Rapier through `adopt` and `pose` hooks (JavaScript only).
  - Caveat: engine-internal state such as contact caches and solver accumulators is not rolled back, so position and velocity must be reseeded explicitly.
- **Optimistic actions.** For example, the local dust-erasing visual.
  - `predict.defineEvent` and `ctx.predict` mark an action as predicted.
  - An unconfirmed prediction auto-rejects after `graceTicks`, default 10.
  - `ctx.memo` freezes random rolls so replays reproduce them.
- **Clock.**
  - `room.clock` runs clock sync during the join handshake.
  - It exposes `jitter()`, `smoothedRtt()` and a slew-limited `renderNow()` timeline.
- **Packet loss.**
  - On WebSocket, inputs are sent reliably and TCP retransmits them.
  - The unreliable input mode with redundancy (`historySize`) is WebTransport-only, JS-only and experimental.

### 3.3 Tooling and learning material

- `@colyseus/sdk/debug` adds a drift telemetry panel and a latency simulator [1].
- The open-source **Prediction Playground** has twelve labs covering reconciliation, interpolation, dead reckoning and lag compensation [1][6][35].
- A Phaser tutorial implements interpolation by hand [6].
- `create-colyseus-app` has a `realtime-action` preset [1].
- Premium demos, including a kart racer, are sponsor-only source [1][6].

### 3.4 How it maps to our game

| Entity | Approach |
|---|---|
| Local avatar | Reconciler with a shared TypeScript step function |
| Local vehicle | `predict.sim` |
| Remote avatars and vehicles | `lerp` at about 100 ms delay |
| Helper robots | `reckon` or `lerp` |
| Conveyor items | Deterministic client-side simulation from belt ID and spawn tick, with no per-tick sync (design assumption) |

### 3.5 Honest caveats

- The module is about 3 months old.
- The JS SDK is the reference implementation; other SDKs lack some features [8].
- I found no published loss or latency test results.
- Our 30 Hz step must be fully deterministic across browser and Node. That is our responsibility [6].

---

## 4. Large-state strategy: the 163,842-sector dust field

**Arithmetic, not a claim.** 163,842 = 10·4⁷ + 2, which is the vertex count of a 7-times-subdivided icosahedron. Likewise 642 = 10·4³ + 2. A natural chunking is therefore 642 parent cells of about 255 sectors each.

### Option A: Schema `ArraySchema<uint8>` with 163,842 entries. Not recommended.

- **Delta cost.** A changed collection entry costs 1 B plus its index plus the value. Indices are sized like refIds: 3 B below 65,536 and 5 B above [15].
  - About 60% of our indices are 65,536 or higher.
  - Average: about **6.2 B per changed cell** (estimate).
- **Join snapshot.** About **1 MB** (estimate, assuming full-sync entries cost about the same as patch entries; the full-sync wire format is not documented).
- **No help from views or streaming.**
  - StateView "is not optimized" for large datasets [14].
  - Streaming cannot apply to arrays and requires Schema elements [13].
- **Correctness risk.** ArraySchema has had recent desync fixes [4].

### Option B: chunk Schemas (`uint8` fields). Not recommended.

- The 63-field limit [12] means at least 2,601 chunk instances.
- Each changed chunk also pays a 2–6 B instance header [15].
- It is awkward to work with and gives no compact join snapshot.

### Option C: Colyseus raw binary channel. Recommended.

Built on `onMessageBytes`, `sendBytes` and `broadcastBytes` [16]:

1. **Authority.** The room holds one `Uint8Array`: 160 KB at 1 byte per sector, or 80 KB packed at 4 bits.
2. **Dirty tracking.** The simulation records changed sectors each tick in a dirty set.
3. **Deltas.** At 5–10 Hz, emit delta messages at **3 B per changed sector** (estimate): an 18-bit index (2¹⁸ = 262,144 > 163,842) plus a 6-bit level. Coalesce repeated changes to the same sector within the window.
4. **Per-client interest.**
   - Fine deltas only for chunks near each player.
   - A low-rate coarse map for everything else: about 642 B for all chunk averages.
   - This is our own code. With 16 clients, per-client `sendBytes` is cheap to implement.
5. **Join-in-progress.**
   - Send the coarse map first (about 642 B).
   - Then send fine chunks nearest-first in slices of a few KB per patch, so one large burst does not stall entity patches behind it on TCP.
   - Total: 80–160 KB raw. It is likely compressible, but I did not verify a ratio.
   - Keep each binary message small. uWS defaults to a 4,096 B *inbound* limit [11]; outbound limits are not verified.
6. **Cleaning-stroke events.** Small per-client messages within a radius of the stroke (`client.send` / `sendBytes`) [16].
7. **Persistence.** Checkpoint the packed field to MySQL periodically, and in `onBeforeShutdown` / `onDispose` (both async) [17][20].

**Honest framing.** For the dust field, Colyseus contributes the transport, room lifecycle and per-client send API. The format, interest filtering and snapshot pacing are custom code, and they would be the same work on raw `ws`.

---

## 5. Bandwidth estimate (server → each client, 16 players, 20 Hz patches)

### 5.1 Published wire-cost rules [15]

| Item | Cost |
|---|---|
| Changed instance | 1 B + refId (1 B if the refId is < 128, 2 B if < 256, 3 B if < 65,536, otherwise 5 B) |
| Changed field | 1 B + value |
| Collection entry | 1 B + index + value |
| Value types | 16-bit quantized = 2 B; `uint8` = 1 B; `float32` = 4 B |
| Unchanged data | 0 B |
| Encoding without `.view()` fields | Encoded once and reused for all clients |
| refIds | Never recycled |
| Doc's worked example | 60 entities with x and y as 16-bit quantized values at 20 Hz = 9.4 KB/s |

### 5.2 Assumptions (mine)

- **A1.** Positions use 3 axes at 16 bits and angles use 16 bits, so each changed field costs 3 B.
- **A2.** The instance header averages 3 B. It grows as refIds climb, since they are never recycled.
- **A3.** Per-entity patch size: avatar 4 fields plus about 1 B of misc = **16 B**; vehicle 6 fields = **21 B**; robot 4 fields = **15 B**.
- **A4.** Dust changes: 16 players × about 76 cells/s (a brush of about 19 cells, each stepping about 4 times per second) plus 64 robots × about 10 cells/s ≈ **1,856 changes/s**.
- **A5.** Payload bytes only. WebSocket, TLS and TCP framing add roughly 5–15% at these frame rates (estimate). Which layers Render meters is not documented.

### 5.3 Scenario N: naive (everything in Schema, every entity moving, dust as ArraySchema)

| Item | Calculation | B/s per client |
|---|---|---|
| Avatars | 16 × 16 B × 20 | 5,120 |
| Vehicles | 16 × 21 B × 20 | 6,720 |
| Robots | 64 × 15 B × 20 | 19,200 |
| Conveyor items (100, one progress field each) | 100 × 6 B × 20 | 12,000 |
| Misc (scores, machines) | 50 B × 20 | 1,000 |
| Dust (ArraySchema) | 1,856 × 6.2 B | 11,507 |
| **Total** | | **≈ 55.5 KB/s (≈ 444 kbit/s)** |

For 16 clients, server egress is about 889 KB/s, or **about 3.2 GB per hour**.

### 5.4 Scenario R: recommended Colyseus design

| Item | Calculation | B/s per client |
|---|---|---|
| Avatars | 16 × 16 B × 20 Hz | 5,120 |
| Vehicles (half moving) | 8 × 21 B × 20 Hz | 3,360 |
| Robots (half moving; fields written every 3rd patch, smoothed on the client with `lerp`/`reckon`) | 32 × 15 B × 6.7 Hz | 3,216 |
| Conveyor items (spawn and remove only; deterministic belt motion on the client) | ~5 events/s × 12 B | 60 |
| Dust deltas (binary, 5 Hz, ~50% coalesced, 3 B per change) | 928 × 3 B + framing | ~2,830 |
| Stroke events near the player | assumption | ~500 |
| Misc | assumption | ~500 |
| **Total** | | **≈ 15.6 KB/s (≈ 125 kbit/s)** |

- For 16 clients, server egress is about 250 KB/s, or **about 0.9 GB per full-room hour**.
- **Join snapshot:** entities about 2 KB (estimate) plus the dust field at 80–160 KB raw, streamed in slices.
- **Inbound inputs:** about 0.3–0.6 KB/s per client (estimate). Render does not bill inbound traffic [31].
- **Further levers:**
  - 8-bit quantization for robots [12].
  - `patchRate` 15 Hz.
  - Event-only robot waypoints.
  - Per-client rates by distance. These require StateView, which forces per-client encoding and costs CPU [15].

### 5.5 What the $0 budget means [31]

- Render Hobby includes **5 GB of outbound bandwidth per month**, and WebSocket messages sent to clients are billed traffic.
- Overage is $0.15/GB with a card on file. **Without a card, Render spins the services down until the start of the next month.**
- Scenario R therefore gives about **5–6 full 16-player hours per month**.
- A typical 4-player session (robots assumed to scale with players) costs about 4.6 KB/s per client, or about 66 MB per hour, which gives **about 75 hours per month** (estimate).
- This limit applies to every framework. Colyseus' zero-byte unchanged fields and quantization help, but they do not remove it.

---

## 6. Testing and load testing

- **Unit and integration tests: `@colyseus/testing`** [25].
  - Setup: `boot(appConfig)`, then `createRoom`, `connectTo(room)` (a simulated client) and `sdk.joinOrCreate/create/join/joinById`.
  - Waits: `waitForNextPatch()`, `waitForMessage(type)`, `waitForNextMessage()`, and `waitForNextTimestep()` (requires 0.18.2 or later).
  - HTTP route testing through `colyseus.http`.
  - Works with Vitest, Mocha or Jest.
- **Load testing: `@colyseus/loadtest`** [24].
  - Included by default in projects created with `create-colyseus-app`.
  - Command: `npx tsx loadtest/<script>.ts --room <name> --numClients 16 --endpoint <url>`.
  - The script exports `main(options)` and joins through the normal SDK, so bots are headless Node clients.
  - All bots in a run share one Node process, and a terminal UI shows the load tester's own CPU use.
  - Guidance: one process per core; run it on a different machine from the server; compare server CPU with `top` or the Monitoring Panel. Note that `clientId` restarts at 0 in each process.
  - **16 bots fit easily in one process.** For netcode realism, bots should send inputs at 30 Hz like real clients.
- **Observability** [1].
  - `@colyseus/admin` (beta) has a live room inspector across processes.
  - The Playground has a CPU-profiling tab.
  - `basicAuth()` protects the monitor and playground routes.
  - `@colyseus/sdk/debug` adds a drift panel and latency simulator.
- **Not found in the docs: packet-loss simulation.** Use OS-level network emulation, which is outside Colyseus.
- **New `@colyseus/tunnel` (0.18.0, 2026-11-07).** It shares a local server on a public subdomain [3], which could support $0 playtests from the dev machine. Its limits and terms are not verified.

---

## 7. Deployment on Render

### 7.1 WebSockets on Render [30]

- Web services accept public WebSocket connections on a **single public port** (default 10000).
- Clients must use `wss://`. Plain `ws://` gets a 301 redirect.
- Render enforces **no maximum WebSocket duration**, and recommends ping/pong keepalives.
- Colyseus serves matchmaking HTTP and WebSocket from the same server and port [9][21], which fits Render's single-port model.
- The Vercel-hosted client calls matchmaking cross-origin. **I did not verify Colyseus' CORS defaults**, so test them.

### 7.2 No UDP

- Render routes public traffic to one HTTP port [30].
- A Render staff forum answer says public connectivity is HTTPS-only and UDP is not on the roadmap [32]. I saw this only as a search-engine excerpt and did not fetch the thread directly.
- So `@colyseus/h3-transport` cannot be used on Render. It is also experimental and "hasn't been battle tested" [10].
- WebSocket transports have no unreliable channel. `.unreliable()` fields stop updating after the full state sync [10][12].

### 7.3 Health checks

- Any plain HTTP route on the Colyseus server (typed routes via `createEndpoint`) can serve a health check [2].
- **I did not verify Render's health-check settings in this session.**

### 7.4 Deploys and graceful shutdown

1. Render sends SIGTERM and allows **30 s** for shutdown. A shutdown delay can extend this to **300 s** [30].
2. Colyseus handles SIGTERM in this order [20]:
   - Stops selecting this process for new rooms.
   - Locks every room.
   - Runs each room's `onBeforeShutdown`. The default disconnects clients, and it can be overridden to warn players first.
   - Waits until the local room count reaches 0.
   - Closes transport, presence and driver, then exits.
3. During shutdown, matchmaking requests return a **503 `MatchMakeError`** (core 0.18.27) [3].
4. Clients receive `onLeave` with `SERVER_SHUTDOWN` (4001). That is a reserved non-reconnect code, so **SDK auto-reconnect does not apply** [17][19].
5. Render's load balancer sends new connections to a random instance and does not guarantee reconnects reach the same one [30].

**Recommended flow (design, not code).**

- **Room:** override `onBeforeShutdown` to broadcast a "restarting" notice, checkpoint the world to MySQL (async), then disconnect.
- **Client:** show an overlay, then retry matchmaking with backoff until the new instance creates the room from the checkpoint.
- **Not an option:** `devMode` room caching is a development-only feature. Its hooks are documented as devMode-only [17], and a search-indexed copy of the devMode page says not to use it in production [34]. The page returned 404 to my direct fetch.

### 7.5 Single vs. multi-instance

- Render Free does not scale beyond one instance [28].
- Multi-process Colyseus needs Redis and a public address per process, with the load balancer routing to the owning process [23]. Render's random routing [30] does not offer that.
- Conclusion: **run a single instance with no Redis.** That matches Colyseus' simplest setup and is enough for 16-player rooms.

### 7.6 The $0 Free tier: CPU and memory feasibility

**Free web service facts** [28][29]:

| Item | Value |
|---|---|
| Resources | 0.1 CPU, 512 MB RAM |
| Spin-down | After 15 min with no inbound traffic (HTTP requests and WebSocket messages count) |
| Spin-up | About 1 minute |
| Restarts | Render "might restart a Free web service at any time" |
| Hours | 750 free instance hours per workspace per month |
| Disk | No persistent disk |

**What is published about Colyseus overhead.**

- The FAQ says a small 1 vCPU / 1 GB server "can typically handle 1,000–2,000 concurrent connections for simple games", that complex games with large state handle fewer, and that each connection uses about 2–5 KB, growing with state size [26].
- The FAQ gives **no per-room CPU numbers**, and I found no published per-room encoder benchmark.
- Schema 5's encoder is about 2.4× faster than 4.0 [1].
- Any `.view()` field switches the room from encode-once to encode-per-client [15].
- uWS "handles more connections with fewer resources" and is "recommended for production" [11].
- Core 0.18.28 adds **opt-in auto-batching** that sends a tick's messages in one socket write to cut CPU [3].

**Workload per second for one 16-player room (counts, not timings).**

| Work item | Count per second |
|---|---|
| Fixed simulation steps | 30 |
| Patch encodes | 20 (one per patch with no StateView; 320 if per-client) |
| Patch frames sent | 320 (fewer socket writes with auto-batching) |
| Binary dust messages | 80–160 |
| Input messages received | 480 |
| Typed-array dust writes | ~1,900 |
| Entity updates | ~100 per step |

**CPU budget.** 0.1 CPU is about 100 ms of CPU per wall-clock second, or about 3.3 ms per 30 Hz tick for simulation, encoding, I/O and GC together. Render does not document whether Free CPU is burstable [29]. If it is a hard container quota, bursts beyond it show up as **tick stalls and jitter**, which degrade reconciliation and interpolation. That is an inference, not a documented behaviour.

**Memory: not a constraint.**

- The dust field is 160 KB.
- 16 connections at 2–5 KB each is under 100 KB [26].
- The Node and Colyseus baseline is not published (unverified), but 512 MB leaves wide margin.
- Pin Schema to 5.0.47 or later, past the memory-growth fix in 5.0.41 [4].

**Verdict: realistic only with discipline, and unproven until measured.** Required design rules:

1. No `.view()` / StateView in room state. Do dust interest filtering in our own binary path.
2. Use the uWebSockets.js transport and turn on auto-batching.
3. Use the Scenario R sync rates.
4. Amortize robot pathfinding across ticks.
5. Run `@colyseus/loadtest` with 16 bots against a real Free instance in week 1, and watch for tick-time jitter.

**Fallbacks if it does not fit:**

- 20 Hz simulation, 15 Hz patches, robots at about 5 Hz.
- Render Starter: 0.5 CPU / 512 MB [29]. The price was not verified in this session, and it breaks the $0 budget.

Cold starts and random restarts are UX and continuity problems no framework fixes. Handle them with a "waking server" screen on the client and MySQL checkpoints [28].

### 7.7 Colyseus Cloud (note only)

- Starts at **$15/mo**.
- "Unlimited bandwidth", no CCU limits, managed SSL.
- No free Cloud tier [27].
- It would remove the 5 GB ceiling but is outside the $0 budget.

---

## 8. Known issues and limits relevant to us

| Issue | Evidence | Mitigation |
|---|---|---|
| ArraySchema desync/hang bugs fixed only recently: remove plus insert in one patch (5.0.43); `sort()` desync (5.0.44); `splice` edge cases "desync clients or hang the server" (5.0.45); setting an index to null (5.0.47) | [4] | Use `MapSchema` keyed by entity ID. Avoid reordering arrays. Pin exact versions and soak-test. |
| Memory growth from replaced child instances (fixed 5.0.41); client retained classes after leaving rooms (fixed 5.0.40) | [4] | Pin 5.0.47 or later. Run long-lived room soak tests. |
| StateView not optimized for large datasets; per-view encode cost | [14][15] | Broadcast entities to all 16 players. Use the custom binary path for the dust field. |
| Streaming collections are experimental, and the API may change | [13] | Do not depend on them. If used, pin the schema version. |
| WebTransport experimental; `.unreliable()` freezes on WebSocket | [10][12] | Not applicable on Render. Do not use `.unreliable()`. |
| 63 fields per Schema; metadata replace semantics; `client.id` removed (0.18 breaking changes) | [1][12] | Keep schemas small and nested. Follow the migration guide. |
| refIds never recycled, so instance headers grow over time in high-churn rooms | [15] | Do not model conveyor items as Schema instances (event-only). Recreate rooms per session. |
| Reconnect queue holds only 10 messages; auto-reconnect requires 5 s of uptime | [19] | Drop inputs during the gap; let the reconciler resync. Handle early drops by rejoining manually. |
| uWS: 4,096 B inbound payload and 4 KiB header defaults | [11] | Keep client messages small. Raise the limits if auth headers need it. |
| No published per-room CPU benchmarks | [26] | Measure (§7.6). |
| `@colyseus/database` and `@colyseus/auth` user store documented for SQLite/PostgreSQL only; MySQL not listed | [1] | Write our own MySQL persistence and auth. `onAuth` is enough. |

The 13 open GitHub issues [5] were not reviewed one by one in this session.

---

## 9. Self-scored table (1–5)

| Criterion | Score | Justification | Src |
|---|---|---|---|
| Reliability under loss/latency/reconnects | **3** | **Strengths:** reliable, ordered delta sync cannot drift because of packet loss; auto-reconnect with backoff, server seat hold and identity-preserving resync; graceful-shutdown hooks. **Weaknesses:** TCP head-of-line blocking under loss; every deploy or restart is a full disconnect; reconnect shipped Feb 2026; ArraySchema desync fixes through Nov 2026. | [1][2][4][18][19][20] |
| Prediction/reconciliation fit | **4** | First-party reconciler, `predict.sim` for vehicles, interpolation modes, fixed timestep with tick rate in the handshake, input acks, clock sync, debug panel. **Weakness:** about 3 months old, with no published field results. | [1][6][7][8] |
| Bandwidth efficiency | **4** | About 1 B per field change, 0 B when unchanged, 8/16-bit quantization, encode-once broadcast; about 15 KB/s per client estimated (§5). **Weaknesses:** no unreliable channel on WebSocket; refId growth. | [12][15] |
| Interest management | **3** | StateView with tags and `subscribe`, plus nearest-first streaming. **Weaknesses:** per-client encode cost, "not optimized" for large data, streaming is experimental. | [13][14][15] |
| Large-state sync (163,842 cells) | **2** | Schema is the wrong tool for this. A good raw binary channel exists, but chunking, filtering and snapshot pacing are custom code. | [14][15][16] |
| Hosting fit on Render (incl. $0) | **3** | **Fits:** WebSocket on a single port, single-process default, SIGTERM integration. **Doesn't:** no UDP for the WT transport; multi-instance unsuitable; 0.1 CPU is tight and unbenchmarked. | [10][20][23][28][29][30] |
| Rooms/matchmaking/reconnect features | **5** | `joinOrCreate`, private rooms with `joinById`, metadata, `LobbyRoom`, `QueueRoom`, seat reservation, `onAuth`, auto-reconnect, rate limits. | [2][16][18][21][22] |
| Testing/load-testing tooling | **4** | `@colyseus/testing`, `@colyseus/loadtest` with headless bots, playground with CPU profiling, admin inspector (beta), latency simulator. **Weakness:** no built-in packet-loss simulation found. | [1][24][25] |
| Solo-dev simplicity & agent familiarity | **4** | **Simplicity:** batteries included, end-to-end TypeScript types, presets. **Agent familiarity:** the 0.17/0.18 API changes (`defineServer`, `onDrop`, close codes, the builder schema syntax) postdate much of the agents' prior knowledge, so docs must be fed to them. | [1][2] |
| Maintenance/license/community | **4** | MIT; releases several times a week; 7.5k stars; 13 open issues. **Weaknesses:** single maintainer; pre-1.0 breaking changes in each minor release. | [1][3][4][5] |

---

## 10. Honest weaknesses, risks and mitigations

| # | Weakness / risk | Impact on us | Mitigation |
|---|---|---|---|
| 1 | **TCP only on Render.** Head-of-line blocking under loss; no unreliable channel. [10][30][32] | Remote entities stutter on lossy Wi-Fi; corrections after retransmit stalls. | Interpolation delay of about 100 ms (tunable) plus `snap` thresholds [8]. Small frames; drop stale inputs. **Shared by every option hosted on a Render web service.** |
| 2 | **Large-state sync is DIY.** [14][15] | Most of the custom netcode lives in the dust path. | Option C (§4): typed array plus dirty set, 3-byte deltas, coarse/fine interest, paced snapshot. Unit-test it with `@colyseus/testing` [25]. |
| 3 | **Maturity and churn.** Netcode and Schema 5 date from Aug 2026; ArraySchema desync fixes in Oct–Nov 2026; 1.0 announced as next. [1][4] | Latent desync bugs; migration work. | Pin exact versions. Avoid ArraySchema reorders. Soak tests. Upgrade deliberately with migration guides [1]. |
| 4 | **Single maintainer (bus factor).** [1][2] | Slower fixes if the maintainer is unavailable. | MIT license allows forking. Keep the game simulation in framework-independent TypeScript modules so the room layer is replaceable. |
| 5 | **Stale agent knowledge.** APIs changed in 0.17/0.18. [1][2] | Agents write 0.15/0.16-style code (old `onLeave` signature, `setSimulationInterval`, decorators). | Put links to the docs and migration guides in agent briefs. Enforce the TypeScript types end to end [2]. |
| 6 | **Deploys and restarts drop every room.** [17][19][20][28][30] | Free tier may restart at any time; each deploy kicks all players. | MySQL checkpoints; override `onBeforeShutdown`; client rejoin overlay with backoff; deploy during quiet hours. |
| 7 | **Free-tier CPU (0.1) is unproven.** [26][29] | Tick jitter hurts reconciliation. | §7.6 rules; week-1 load test; fallback rates; Starter plan if the budget changes. |
| 8 | **$0 bandwidth ceiling: 5 GB/month.** [31] | About 5–6 full-room hours per month (estimate), then services spin down. | Scenario R and further quantization; add a usage meter; consider a card with an overage cap, or other hosting. Applies to all options. |
| 9 | **StateView CPU trap.** [15] | One `.view()` field makes encoding per client. | Keep all Schema state broadcast; do custom interest management in the binary path only. |
| 10 | **Colyseus persistence packages don't target MySQL.** [1] | Cannot reuse `@colyseus/database` or its user store. | Write our own thin MySQL layer; `onAuth` verifies our own tokens [17]. |

**Bottom line for the decider.** Weighed against the brief (visual quality, then netcode reliability, then solo-dev simplicity, then modularity), Colyseus brings:

- First-party prediction, reconciliation and interpolation that serve both visual smoothness and reliability.
- The most complete room, matchmaking and reconnect stack of the options being compared, which serves simplicity.
- Swappable transports and room plugins, which serve modularity.

Its weak spots are the dust field and the $0 hosting limits. Under raw `ws` those are equally custom, and on a Render web service WebRTC/WebTransport cannot use UDP at all [30][32].

---

## Sources

1. Colyseus 0.18 is here! (Colyseus blog, 2026-08-20) — https://colyseus.io/blog/colyseus-018-is-here/ — accessed 2026-11-11
2. Colyseus 0.17 is here! (Colyseus blog, 2026-02-06) — https://colyseus.io/blog/colyseus-017-is-here/ — accessed 2026-11-11
3. Releases · colyseus/colyseus (GitHub) — https://github.com/colyseus/colyseus/releases — accessed 2026-11-11
4. Releases · colyseus/schema (GitHub) — https://github.com/colyseus/schema/releases — accessed 2026-11-11
5. colyseus/colyseus repository (GitHub) — https://github.com/colyseus/colyseus — accessed 2026-11-11
6. Netcode overview (Colyseus docs) — https://docs.colyseus.io/netcode — accessed 2026-11-11
7. Server Input & Fixed Timestep (Colyseus docs) — https://docs.colyseus.io/netcode/server-input — accessed 2026-11-11
8. Client Prediction (Colyseus docs) — https://docs.colyseus.io/netcode/client-prediction — accessed 2026-11-11
9. Transport overview (Colyseus docs) — https://docs.colyseus.io/server/transport — accessed 2026-11-11
10. WebTransport transport (Colyseus docs) — https://docs.colyseus.io/server/transport/webtransport — accessed 2026-11-11
11. uWebSockets.js transport (Colyseus docs) — https://docs.colyseus.io/server/transport/uwebsockets — accessed 2026-11-11
12. Schema (Colyseus docs) — https://docs.colyseus.io/state/schema — accessed 2026-11-11
13. Streaming Collections (Colyseus docs) — https://docs.colyseus.io/state/streaming — accessed 2026-11-11
14. StateView (Colyseus docs) — https://docs.colyseus.io/state/view — accessed 2026-11-11
15. Optimizing State (Colyseus docs) — https://docs.colyseus.io/state/optimization — accessed 2026-11-11
16. Rooms (Colyseus docs) — https://docs.colyseus.io/room — accessed 2026-11-11
17. Room Lifecycle Events (Colyseus docs) — https://docs.colyseus.io/room/lifecycle — accessed 2026-11-11
18. Reconnection (Colyseus docs) — https://docs.colyseus.io/room/reconnection — accessed 2026-11-11
19. SDK Connection & Reconnection options (Colyseus docs) — https://docs.colyseus.io/sdk/connection — accessed 2026-11-11
20. Graceful Shutdown (Colyseus docs) — https://docs.colyseus.io/server/graceful-shutdown — accessed 2026-11-11
21. Matchmaking (Colyseus docs) — https://docs.colyseus.io/matchmaker — accessed 2026-11-11
22. Visibility & Access (Colyseus docs) — https://docs.colyseus.io/matchmaker/visibility — accessed 2026-11-11
23. Scalability (Colyseus docs) — https://docs.colyseus.io/scalability — accessed 2026-11-11
24. Load Testing (Colyseus docs) — https://docs.colyseus.io/tools/loadtest — accessed 2026-11-11
25. Unit Testing (Colyseus docs) — https://docs.colyseus.io/tools/unit-testing — accessed 2026-11-11
26. FAQ (Colyseus docs) — https://docs.colyseus.io/faq — accessed 2026-11-11
27. Pricing (Colyseus / Colyseus Cloud) — https://colyseus.io/pricing — accessed 2026-11-11
28. Deploy for Free (Render docs) — https://render.com/docs/free — accessed 2026-11-11
29. Compute plans (Render docs) — https://render.com/docs/compute-plans.md — accessed 2026-11-11
30. WebSockets on Render (Render docs) — https://render.com/docs/websocket — accessed 2026-11-11
31. Outbound Bandwidth (Render docs) — https://render.com/docs/outbound-bandwidth — accessed 2026-11-11
32. Opening up a UDP port for incoming traffic (Render community forum) — https://community.render.com/t/opening-up-a-udp-port-for-incoming-traffic/821 — accessed 2026-11-11 (staff statement seen via a search-engine excerpt; thread not fetched directly; post date not verified)
33. Releases · colyseus/colyseus.js (GitHub) — https://github.com/colyseus/colyseus.js/releases — accessed 2026-11-11 (archival date seen via a search-engine excerpt; not fetched directly)
34. Development Mode (Colyseus docs) — https://docs.colyseus.io/devmode — accessed 2026-11-11 (direct fetch returned HTTP 404; the production warning was seen only in a search-index excerpt)
35. Prediction Playground (Colyseus) — https://prediction-colyseus.vercel.app/ — accessed 2026-11-11 (linked from [1] and [6]; not fetched)
