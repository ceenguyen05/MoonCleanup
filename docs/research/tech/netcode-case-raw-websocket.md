# Netcode Case: Custom Layer on Raw WebSockets (uWebSockets.js / ws)

**Date:** 2026-11-11 · **Author:** advocate subagent P2e · **Scope:** planning research only (no code) · **Constraint update received mid-task:** $0 hosting budget → production on Render **Free** web service (0.1 CPU / 512 MB RAM, spins down when idle, cold starts)

> **Conventions.** `[n]` = numbered source at the end (all accessed 2026-11-11). Figures marked **(est.)** are this author's engineering estimates with the stated assumptions. They are not measurements and not claims from a source. This is an advocacy document. Its weaknesses are listed in §9 (scores) and §10 (risks), and the decider should cross-check both.

---

## Executive summary

- **On Render, every browser-facing option rides TCP.** Render web services expose one public HTTP port. WebSockets are supported, and TLS is terminated at Render's load balancer. Render documents no public UDP, and staff forum replies say public access is HTTPS / ports 80/443 only. WebRTC data-channel servers and WebTransport (which needs HTTP/3, i.e. QUIC over UDP) therefore cannot be hosted on Render web services. The real decision is who owns the protocol on top of WebSocket, not which transport to use [17][19][25][26][51].
- **Versions (2026-11-11).** uWebSockets.js **v20.71.0**: published 2026-09-16, Apache-2.0. It is GitHub-only ("We aren't in the NPM registry") and ships prebuilt binaries only for Node 22/24/26 on glibc Linux, macOS and Windows. **ws 8.22.2**: published 2026-11-08, MIT, on npm, pure JavaScript [1][3][7][8][12][13].
- **With the $0 budget, outbound bandwidth is the binding limit.** Render's Hobby workspace includes **5 GB of outbound bandwidth per month**, with $0.15/GB beyond that. Render's Free page says that without a payment method, overage suspends Free services for the rest of the month [20][21]. Naive JSON snapshots would use up 5 GB in about 11 player-hours. The bit-packed, delta-compressed, interest-managed protocol proposed here stretches it to about 270 player-hours, roughly 17 full 16-player room-hours (est., §6).
- **CPU is the second limit.** 0.1 CPU is about 100 ms of CPU per wall-clock second. If Render enforces it like a Linux CFS quota (default period 100 ms), bursts beyond about 10 ms per period stall the process until the next period, which players would see as hitches [22][27]. One 16-player room looks plausible at **20 Hz tick / 10 Hz snapshots** (about 10–50% of budget, est.). The spec's 30 Hz / 20 Hz is marginal (about 15–75%, est.). This must be measured in a week-1 spike on the real instance.
- **Recommended Free-tier profile (est.):**
  - simulation at 20 Hz and snapshots at 10 Hz;
  - adaptive interpolation delay of about 150–250 ms;
  - dust deltas at 5 Hz near the player and 0.5 Hz summaries elsewhere;
  - conveyor items simulated on the client from belt state;
  - one room per instance.

  Return to 30 Hz / 20 Hz if a paid instance is ever approved.
- **Transport pick: uWS.js in production, behind a thin adapter.** It does framing and pub/sub fan-out in native code, has an explicit backpressure API, and sends pings automatically. Bun's WebSocket server is built on uWS, and Bun reports about 7× the messages per second of Node + ws in an old chatroom benchmark. **ws** stays as the drop-in fallback and as the bot/test client [10][11][16].
- **Protocol: hand-rolled, bit-packed binary with quantization.** Each snapshot is a delta against the *last sent* snapshot, because TCP guarantees delivery and order. Clients that fall behind get a Quake-3-style per-client baseline ring. Expect about 4–6 bytes per moving entity and 1 bit per idle entity (est.), consistent with Fiedler's measurements [28][38].
- **Dust field (163,842 sectors).** Split it into 1,280 chunks of about 128 sectors and send chunk-local dirty lists. The join snapshot is 80–160 KiB raw and an estimated 1–40 KB after deflate, streamed nearest chunk first. Cleaning strokes are rendered from interpolated tool paths [50].
- **Effort.** The whole netcode is about 27–37 agent-days (est.). Only about 9–11 of those are plumbing a framework would supply: rooms, lobby, reconnect, heartbeats and shutdown. The rest is needed with any framework: prediction, delta codec, dust sync, interest management and the test harness.
- **Reliability.** TCP gives delivery and ordering for free. Head-of-line blocking under packet loss is the main problem; it can be mitigated by buffer sizing but not avoided on Render. Render "might restart a Free web service at any time" and spins it down when idle, so resuming from a checkpoint is mandatory for every option, not just this one [20][29].
- **Testing tools are mature.** Toxiproxy injects real TCP faults, `tc netem` adds kernel-level delay and loss, k6 has `k6/websockets`, and Artillery has a `ws` engine. Custom headless bots and deterministic replay cover the rest [41][42][43][57].
- **A hybrid is credible.** Colyseus 0.18 on its uWebSockets transport, using `sendBytes` for our binary hot path, keeps the framework's rooms and reconnection plus our byte efficiency. Build the codec, dust sync and prediction as transport-agnostic packages so either option can sit at the edge [44][45][46].

---

## 1. Libraries: uWebSockets.js and ws

### 1.1 uWebSockets.js (uWS.js) — facts as of 2026-11-11

| Item | Fact | Source |
|---|---|---|
| Latest version | **v20.71.0**, published 2026-09-16; headline is experimental HTTP micro-caching. The README install example still shows `#v20.70.0`; a v20.70.0 tag exists but has no release entry. | [1][3][4][5] |
| 2026 release cadence | 12 releases between v20.59.0 (2026-03-05) and v20.71.0 (2026-09-16) | [3] |
| Churn signal | v20.62.0 disabled the `WebSocket.send` fastcall variant and the remote-address cache added in v20.61.0 because of reported issues. v20.65.0 reverted a v20.63.0 string optimisation that could emit non-UTF-8 bytes. v20.64.0 shipped a backpressure fix in the core (v20.77.0). | [3] |
| License | Apache-2.0 | [1] |
| Distribution | Not on the npm registry ("We aren't in the NPM registry"). Install from a GitHub tag (`npm install uNetworking/uWebSockets.js#<tag>`). | [1] |
| Binaries at v20.71.0 | `uws_{darwin_arm64, darwin_x64, linux_arm64, linux_x64, win32_x64}_{127,137,147}.node` | [7] |
| Node compatibility | The loader `require`s `uws_<platform>_<arch>_<process.versions.modules>.node`. If that fails it throws: "supports only Node.js versions 22, 24 and 26 on (glibc) Linux, macOS and Windows, on Tier 1 platforms". Node's ABI registry maps 127 → Node 22 and 137 → Node 24; 147 is the Node 26 entry. v20.67.0 (2026-05-07) removed Node 20 and 25 and added 26. | [8][9][6] |
| Performance claims (vendor) | README: "13x faster than Fastify", "20x faster than Socket.IO", with no data on the page. v20.71.0 notes: Fastify hello-world ≈15k req/s; uWS ≈5× that uncached and ≈13× with micro-caching. These are **HTTP** numbers, not WebSocket. | [1][5] |
| WebSocket throughput signal | Bun's WebSocket server is "built on uWebSockets". Bun reports ≈700k vs ≈100k messages/s (Bun v0.2.1 vs Node 18.10.0 + ws, 16 clients, simple chatroom). The benchmark is old and run by the vendor, so treat it as directional only. | [16] |
| Backpressure API | `send()` returns **1** = sent, **0** = queued with backpressure, **2** = dropped at the limit. `getBufferedAmount()` reports queued bytes. `maxBackpressure` defaults to 64 KiB, and slow receivers "will be skipped until they catch up or timeout". `closeOnBackpressureLimit` defaults to false. There are `drain` and `dropped` handlers. | [10][11] |
| Pub/sub | `subscribe`, `unsubscribe`, `publish`, `isSubscribed` and `getTopics`. `publish` follows the maxBackpressure settings, and "Order is guaranteed since v20". | [10] |
| Keepalive and limits | `idleTimeout` defaults to 120 s (about 4 s granularity). `sendPingsAutomatically` is available. `maxPayloadLength` defaults to 16 KiB. `maxLifetime` takes 0 or 1–239 minutes. `compression` defaults to DISABLED, with shared and dedicated compressors available. | [11] |
| Send batching | `cork()` packs many sends "into one single syscall/SSL block" | [10] |
| Buffer lifetime | Native-provided ArrayBuffers are only valid during the callback; the `dropped` handler documents that the buffer "will be neutered". Treat every native buffer as borrowed and copy anything you keep. | [11] |

**What the GitHub-only, ABI-pinned distribution means for us:**

- **Render builds depend on GitHub.** Builds must fetch the git dependency from GitHub, and every Node major-version bump needs a matching uWS tag.
- **Pin Node 24.** Render's default Node version for services created on or after 2026-10-21 is **24.22.1** (ABI 137), which v20.71.0 supports. Render reads the version from `NODE_VERSION`, then `.node-version`, then `.nvmrc`, then `package.json` `engines`, in that order. Render warns that an unbounded `engines` range resolves to the latest Node release, which might have no uWS binary [23][7][8].
- **No musl/Alpine binary.** If we ever containerise, we need a glibc base image [8].
- **Windows development machines work**, because win32_x64 binaries ship [7].
- **No semver ranges or registry tooling** (assessment). Upgrades are deliberate tag bumps, so pin the tag and add a CI smoke test that loads the binary on Linux x64.

### 1.2 ws — facts as of 2026-11-11

| Item | Fact | Source |
|---|---|---|
| Latest version | **8.22.2** (2026-11-08). 8.22.1 (2026-10-31) uses `http.websocketMask()/websocketUnmask()` when available. 8.22.0 (2026-09-26) added a `protocols` option. Legacy lines 7.5.13, 6.2.6 and 5.2.7 were all patched on 2026-07-17. | [13] |
| License and pitch | MIT. "Simple to use, blazing fast and thoroughly tested WebSocket client and server for Node.js" | [12] |
| Native add-ons | `bufferutil` and `utf-8-validate` are now legacy polyfills and are not loaded on newer Node versions that have built-in alternatives | [12] |
| permessage-deflate | Off by default on the server and on by default in the client. It "adds a significant overhead in terms of performance and memory consumption". The README warns of "catastrophic memory fragmentation" with Node's zlib under high concurrency on Linux. Tuning options include `concurrencyLimit` (example: 10) and `threshold` (default 1024 B). | [12][14] |
| `maxPayload` | Default 104,857,600 B (100 MiB); a game must lower it | [14] |
| Keepalive | The README's heartbeat pattern pings every 30 s and calls `terminate()` if no pong arrives. `autoPong` defaults to true; `closeTimeout` defaults to 30 s. | [12][14] |
| Backpressure | `bufferedAmount` counts queued bytes including framing (0 if written immediately), and the `send` callback fires once data is written. There is no built-in drop policy. | [14] |
| Nagle | The socket gets `setNoDelay()`, so Nagle's algorithm is off | [15] |
| Browser side | The browser WebSocket API cannot slow a sender: incoming messages are buffered in memory without bound | [16] |

**permessage-deflate verdict (assessment).** Bit-packed, delta-compressed snapshots are high-entropy, so deflate gains little while costing CPU and memory, as both READMEs warn. Keep it off for both libraries. Compress only the one-off join snapshot, at the application level (§5).

### 1.3 CPU and memory efficiency on Render Free (0.1 CPU / 512 MB)

- **No TLS cost in our process.** Render's load balancer terminates SSL [19]. Neither library spends our 0.1 CPU on crypto, so the per-message cost is framing, a syscall, and (for ws) JavaScript allocations.
- **Message rate for one 16-player room (est.):**
  - spec rates (30 Hz input, 20 Hz snapshots): ≈480 messages in + 320 out ≈ **800 msgs/s**;
  - recommended Free rates (20 Hz input, 10 Hz snapshots): ≈320 in + 160 out ≈ **480 msgs/s**.
- **Socket CPU (est., unmeasured).** uWS ≈ 0.5–3 ms CPU per second; ws ≈ 2.5–12 ms per second. That is roughly 1–3% versus 3–12% of a 0.1-CPU budget. The Bun/uWS-versus-ws ratio [16] supports the direction, but the size of the gap must be measured.
- **Fan-out.** uWS `publish` sends one encoded buffer to every subscriber in native code [10]. With ws we loop in JavaScript; 16 iterations are trivial, but each send allocates and adds garbage-collection work.
- **Memory (est.).** Both libraries fit easily in 512 MB for up to 64 sockets. The dust field is 160 KiB per room. Cap V8's heap with `--max-old-space-size` (e.g. ~256–320 MB) so garbage collection runs before the container limit is hit [53].
- **Verdict.** At this scale neither library is the bottleneck; our simulation and serialisation are (§8.5). uWS still saves roughly 3–10% of the Free CPU budget and comes with a ready-made backpressure and auto-ping policy, so it is the production pick. ws is the fallback behind the same adapter, and the bot client.

---

## 2. What we build ourselves vs. what a framework gives us

An **agent-day** is one AI coding agent's working day including human review. All figures are est. (±50%).

| Component | Design sketch (raw WS) | Agent-days (est.) | Would a framework supply it? |
|---|---|---|---|
| Transport adapter (uWS, with ws fallback), framing, message registry, protocol version byte | One small interface (`onOpen/onMessage/onClose/send/publish/bufferedAmount`). uWS and ws implementations behind it. | 1.5–2 | Mostly |
| Auth handshake | The client gets a short-lived signed **join ticket** over HTTPS and opens `wss://…?t=<ticket>`. The server validates it, and the Origin header, in the uWS `upgrade` handler or ws `noServer`/`handleUpgrade` before accepting [11][14]. Bad tickets get HTTP 401 and never become a socket. | 1 | Partly (we still own ticket logic) |
| Rooms, invite codes, lifecycle, tick scheduler | In-memory room map; 6-character invite codes; maximum 16 seats; fixed-timestep loop per room [31] | 2–3 | Yes |
| Lobby listing | `GET /rooms` returning JSON. A single Free instance means no cross-node presence is needed [20]. | 0.5 | Yes |
| Join-in-progress | Keyframe of all entities, then dust baseline chunks nearest-first, then normal deltas (§5) | 1.5–2 | Partly (the dust part is custom anyway) |
| Reconnect and session resume (same process) | 128-bit resume token bound to the seat; seat held about 60 s; client retries with exponential backoff and jitter, as Render recommends [17]; on resume the server sends a fresh keyframe | 2–3 | Yes |
| Resume across process restarts | Checkpoint each room (entities plus compressed dust) to MySQL every 30–60 s and on SIGTERM; restore lazily when the first resume token arrives. Render Free can restart at any time [20]. | 1.5–2 | **No.** Any framework that keeps rooms in process memory needs this too. |
| Heartbeats, RTT, clock sync | uWS auto-ping and idleTimeout [11] (or the ws heartbeat pattern [12]), plus an app-level ping every ~2 s carrying timestamps for RTT and server-time offset | 1 | Partly |
| Backpressure / slow-client policy | If `getBufferedAmount()` is above ~16 KiB, skip that client's snapshot. If skipping lasts more than about 3 s, close with an application code in the 4000–4999 private range [47] so the client resumes with a keyframe. | 1 | Partly |
| Graceful shutdown and draining | On SIGTERM: stop admitting players, checkpoint, broadcast "restarting", close with **1012 (Service Restart)** [48], and exit inside Render's shutdown delay (default 30 s, maximum 300 s) [18]. | 1 | Partly |
| Metrics and bandwidth guard | `/metrics` JSON: rooms, sockets, tick p50/p95/p99, event-loop delay via `monitorEventLoopDelay` [52], `process.cpuUsage`, bytes out per minute and month-to-date against the 5 GB allowance [21] | 1 | No |
| Bit-packed codec, quantization, delta snapshots, tests | §3 | 3–4 | No (generic framework sync is less byte-efficient) |
| Prediction, reconciliation, interpolation (client) | §4 | 4–6 | No; no framework does this for us |
| Dust-field sync and interest management | §5 | 3–4 | No |
| Test harness: link conditioner, bots, replay, load tests | §7 | 3–5 | No |
| **Total** | | **≈27–37** | **Framework-replaceable ≈ 9–11** |

**Honest takeaway.** Going raw costs about 9–11 extra agent-days, roughly 30% of the netcode effort. The rest of the work exists with any framework. That plumbing is also where long-tail bugs live (§10).

---

## 3. Binary protocol

### 3.1 Options

All sizes are for one moving avatar and are est.

| Option | Bytes per moving avatar | CPU / allocations | Schema evolution | Fit |
|---|---|---|---|---|
| **Hand-rolled bit-packing** (bit writer/reader over `DataView` / 32-bit words, per Fiedler [32][33]) | ≈4–5 delta / ≈9 full | Lowest; can be allocation-free | Manual, guarded by a protocol version byte | **Hot path** (snapshots, dust, inputs) |
| msgpackr [54] | ≈25–45 (keys or record IDs, type tags, float encodings) | Fast for JS objects; allocates | Self-describing; its record extension avoids repeating keys | Control messages, debug mirror |
| protobuf-es [55] | ≈15–25 (varints, scaled ints) | Moderate; object allocations | Excellent (field numbers) | Control messages, persistence |
| FlatBuffers [56] | ≈30–50 (vtables, alignment) | Zero-copy reads | Good | Large static blobs, not tiny snapshots |
| JSON | ≈60–70 | Parse and allocation heavy | Trivial | Lobby and control only |

### 3.2 Recommendation

1. **Hot path: hand-rolled bit-packing.** One codec module with a declarative field table (field, bits, quantization range). Round-trip property tests and fuzzing are mandatory (§7).
2. **Cold path: JSON** for rare messages such as lobby, chat and errors. It is the most familiar format for agents. Use msgpackr only if profiling shows JSON matters.
3. **Quantization.**
   - Precision = span / 2^bits. With a moon radius of 1,000 game units and 16 bits per axis, that is 2,000 / 65,536 ≈ 3 cm (arithmetic).
   - Avatar yaw around the local surface normal: 10 bits ≈ 0.35° (arithmetic).
   - Vehicle orientation: Fiedler's **smallest-three** quaternion, 2 bits of index plus 3 × 9 bits = **29 bits** [28].
   - Animation, tool and robot state: small enums of 3–6 bits.
4. **Delta encoding.**
   - Each entity gets a **changed bit**.
   - Changed positions are sent as small signed per-axis deltas with an escape to absolute values when the delta is large, following Fiedler's relative encoding. He measured averages of about 26.1 bits for delta position, about 23.3 bits for delta smallest-three, and about 5.5 bits per relative index [28].
5. **Baseline policy (an advantage of WebSockets).**
   - With UDP, Fiedler and Quake 3 encode against the last *acked* snapshot, which is about one RTT old in steady state [28][38].
   - Over WebSocket, a message that was written and not dropped will be delivered in order, or the connection dies. The baseline can therefore be **the previous snapshot actually sent**, with no ack round-trip. Deltas then span one snapshot interval instead of RTT plus interval, so they are smaller.
   - All in-sync clients get **one shared delta, encoded once** and published to the room topic [10], followed by a 2-byte per-client tail carrying `lastProcessedInputSeq`.
   - A client whose snapshot was skipped because of backpressure gets a per-client delta against its last delivered snapshot, taken from a 32-entry ring (Quake 3 keeps the last 32 states per client [38]). If its baseline is older than that, it gets a keyframe.
6. **Framing.** Each message starts with a 1-byte message type. The handshake negotiates a protocol version. Snapshot headers carry tick (u16, wrapping) and an entity-presence mask (96 bits = 12 B) when entities spawn or despawn.

### 3.3 Expected bytes per entity (est.)

| Entity | Full (keyframe) | Delta, moving | Delta, idle |
|---|---|---|---|
| Avatar: position 48 b, yaw 10 b, state 6 b, flags 4 b | ≈9 B | ≈4.3 B | 1 bit |
| Vehicle: position 48 b, smallest-three 29 b, state 6 b, driver 5 b | ≈11 B | ≈6.1 B | 1 bit |
| Robot: position 48 b, heading 8 b, state 5 b, cargo 3 b | ≈8 B | ≈4.1 B | 1 bit |
| Conveyor item | Not streamed; simulated client-side from belt state, with spawn/remove events ≈5 B | — | — |

As a sanity check, Fiedler's 901-cube demo started at about 17.4 Mbps (60 Hz) with 321 bits per cube. Quantization and acked-baseline deltas bring a stationary scene to about 15 kbps against a 256 kbps target [28]. That is the same order of savings assumed here.

---

## 4. Prediction, reconciliation and interpolation

**Model.** We use the textbook model from Gambetta Parts II–III and Valve's Source networking article [34][35][37]:

- The client sends sequenced inputs at the simulation rate.
- The server applies them at a fixed tick and reports the last processed sequence number in every snapshot.
- The client re-applies its unacknowledged inputs on top of the authoritative state.
- Remote entities are rendered slightly in the past from server data only. Valve's default interpolation period is 100 ms, which tolerates one missing snapshot at Source's update rates [37].

Gambetta notes that client and server can disagree after reconciliation even in a deterministic world, so visual error smoothing is needed [34].

**Shared simulation.** One TypeScript module with a fixed `dt` runs on both server and client, following "Fix Your Timestep!" [31]. The client renders by interpolating between fixed steps.

**Local avatar and vehicle.** Predicted for their own player only. Corrections are blended over about 100–200 ms (est.) rather than snapped, except for teleports.

**Remote entities.**

- An interpolation buffer with **adaptive delay**: target ≈ 2 snapshot intervals plus p95 jitter, i.e. about 200 ms at 10 Hz (§8.5).
- Extrapolation is capped at about 250 ms during TCP stalls (est.).
- Vehicles use Hermite interpolation if velocity is sent; avatars and robots use linear interpolation.

**Library status and fit.**

| Option | Status (2026-11-11) | Fit |
|---|---|---|
| `@geckos.io/snapshot-interpolation` | Latest **1.1.1**, published 2025-02-22, BSD-3-Clause, "A Snapshot Interpolation library for Real-Time Multiplayer Games" [39][40]. No release in about 21 months. | Usable as a reference or vendored code. It works on object snapshots, so with typed-array snapshots we would duplicate decoding. Likely better to write our own ~300-line interpolator (est.). |
| Gambetta's sample code and live demo (JS) | Reference implementation of prediction, reconciliation and interpolation [36] | Good template for agents. Port the pattern, not the code. |
| Fiedler's articles | Snapshot interpolation, compression and fixed timestep [28][30][31] | Design reference |

Owning this layer costs about 4–6 agent-days (est.). That cost exists in every option, because frameworks synchronise state but do not predict for us.

---

## 5. Large-state sync: the 163,842-sector dust field

**Geometry.** 163,842 = 10·4⁷ + 2, the vertex count of an icosahedron subdivided seven times (arithmetic). Storing sectors in **hierarchical subdivision order** keeps each chunk contiguous in index space. That makes chunk operations, run-length encoding and deflate effective (assessment).

| Design element | Proposal (est. where numeric) |
|---|---|
| Storage | A `Uint8Array` of 163,842 bytes (160 KiB) per room, or 80 KiB if dust levels fit in 4 bits |
| Chunking | 20 base faces × 4³ = **1,280 chunks** of ≈128 sectors each. Each shared vertex is owned by exactly one chunk, so local indices need 7–8 bits. A dirty-chunk bitset is 1,280 bits = 160 B. |
| Delta encoding | Choose per chunk per batch: **(a) sparse list**: chunk id (11 b) + count (5 b) + n × (local index 8 b + level 4 b), about 12 bits per change plus a 16-bit header; **(b) dense mask**: 128-bit mask + 4 b per dirty sector, which wins above about 16 dirty sectors per chunk; **(c) global sparse**: 18-bit index + 4-bit level ≈ 22 bits per change, as a fallback. |
| Update rates | Near-field deltas at 5 Hz, carried inside the snapshot message so there is no extra per-message overhead. Far-field per-chunk mean levels (4 b each) for changed chunks only, at 0.5 Hz. |
| Interest management | Each client has a near set: chunks within its view or horizon radius plus hysteresis, recomputed at about 2 Hz. With uWS, region topics (for example 80 regions = 20 × 4) let shared region deltas be encoded once and published [10]. Per-client sets go through the per-client tail. |
| Cleaning strokes | Rendered from the **interpolated tool path** while the avatar's or robot's "cleaning" state bit is set, so they cost nothing extra. Explicit stroke events (about 8 B) only for discrete effects near the viewer. Clients may predict local cleaning visually, and authoritative deltas correct it. |
| Join-in-progress | Raw size is 80 KiB (4-bit) or 160 KiB (8-bit). After deflate it is about 1 KB for a pristine moon and about 10–40 KB for a patchy mid-game field (est.; **measure**). The server keeps a **pre-compressed per-chunk cache**, re-compressing at most about 2 dirty chunks per tick, so a join never causes a CPU burst on 0.1 CPU. The client inflates with `DecompressionStream` ("deflate"/"gzip") [50]. Chunks stream nearest-first in messages of 4 KiB or less (which also fits Colyseus' uWS transport default `maxPayloadLength` of 4096 if we go hybrid [44]). |
| Drift detection | A per-chunk 32-bit checksum for the near set at about 0.2 Hz; resend a chunk if it mismatches (assessment). |

---

## 6. Bandwidth per player: 16 players, busy moment

**Assumptions (all est.):**

- **Entities:** 16 avatars all moving, 16 vehicles (8 moving), 64 robots (40 moving).
- **Conveyor items:** simulated client-side; about 20 events/s × 5 B.
- **Cleaners:** 16 players + 64 robots = 80 cleaners, each changing about 20 sectors/s, so ≈1,600 sector changes/s across the room. An interest-managed client sees about 10 cleaners, ≈200 changes/s.
- **Transport overhead:** about **80 B per message** for TCP/IP, TLS record, and the 2–4 B WebSocket server frame header [47]. Whether Render meters bytes at this layer is undocumented.
- **Units:** 5 GB = 5,000 MB.

**Downstream per player (KB/s):**

| Profile | Entities | Dust | Strokes | Conveyor | Msg overhead | **Total** | kbps | MB per player-hour | Player-hours per 5 GB | 16-player room-hours per 5 GB |
|---|---|---|---|---|---|---|---|---|---|---|
| Naive JSON, 20 Hz (96 × ~65 B; dust excluded) | 130 | — | — | — | 1.6 | **≈131.6** | ≈1,050 | ≈474 | ≈10.5 | ≈0.7 |
| **A.** Binary full state, 20 Hz, no interest management; dust sparse at 10 Hz; stroke events for all cleaners | 17.6 | 4.4 | 6.7 | 0.1 | 2.4 | **≈31.2** | ≈250 | ≈112 | ≈45 | ≈2.8 |
| **B.** Binary delta, 20 Hz, interest management (spec rates) | 6.6 | 0.6 | 0.3 | 0.1 | 1.6 | **≈9.2** | ≈74 | ≈33 | ≈151 | ≈9.4 |
| **C.** Free-tier profile: delta, 10 Hz snapshots, interest management, strokes derived | 3.5 | 0.6 | 0.1 | 0.1 | 0.8 | **≈5.1** | ≈41 | ≈18.4 | **≈272** | **≈17** |

**How the rows are computed:**

- **Full snapshot:** 16 × 9 + 16 × 11 + 64 × 8 + ~48 B header ≈ 880 B.
- **Delta snapshot:** 16 × 4.3 + 8 × 6.1 + 40 × 4.1 + 32 idle bits + header ≈ 330 B at 20 Hz, or ≈354 B at 10 Hz (larger per-interval deltas).
- **Streamed conveyor items:** sending 200 items as entities would add about 4 B × 200 × 20 Hz = 16 KB/s, which is why they are simulated client-side.

**Upstream per player (est.).** Inputs are about 8 B of payload plus a 6 B masked client frame header [47] plus about 70 B of TCP/TLS, at 20 Hz ≈ 1.7 KB/s ≈ 13 kbps. Render's WebSocket page says *outbound* messages count toward bandwidth [17] and does not mention inbound.

**Room egress for profile C** is about 82 KB/s ≈ 0.65 Mbps. Under a 5 GB allowance, bandwidth efficiency is a hard budget item, not a nice-to-have. That is the core of the case for a custom protocol.

---

## 7. Testing strategy and tooling

1. **Codec unit tests.** Round-trip property tests and fuzzing. Check that quantization error stays within bounds and that decode(delta) equals decode(full) for random states.
2. **In-process link simulator** for client and server, without sockets. Model what TCP actually does:
   - order-preserving latency and jitter;
   - **loss as a stall of the whole stream** for at least one RTT and up to a retransmission timeout;
   - bandwidth caps and forced disconnects.

   Dropping individual messages would be the wrong model for WebSocket: TCP retransmits, and all later data waits behind the lost segment [29]. RFC 6298 says an RTO below 1 s should be rounded up to 1 s [49].
3. **Real-socket fault injection.** Run Toxiproxy between bots and the server. It is "a TCP proxy to simulate network and system conditions" with latency/jitter, bandwidth, slow_close, timeout, reset_peer, slicer and limit_data toxics. Its packet_loss toxic drops chunks of the byte stream, which corrupts WebSocket framing, so use it only for robustness tests [43]. `tc netem` on Linux, in CI or a VM, gives kernel-level delay and loss [57].
4. **Deterministic replay.** Fixed timestep [31], seeded PRNG, recorded per-player input logs and a per-tick state hash. Golden replays run in CI. Production sessions can record inputs only, for bug reproduction.
5. **Headless bots.** Node processes using the **ws client** with the real codec and scripted behaviour (wander, clean, drive, reconnect). The **week-1 spike** runs 16 bots against the actual Render Free instance and records CPU, event-loop delay p99 [52] and bytes out.
6. **Load tools.**
   - k6 `k6/websockets` implements the browser WebSocket API with k6 extras and receives binary as ArrayBuffer with `binaryType = "arraybuffer"`. The older `k6/experimental/websockets` module is deprecated in its favour, and `k6/ws` is "legacy" [41].
   - Artillery's `engine: ws` supports connect/send/think/loop/function actions. Binary payloads aren't documented, so use `function` steps [42].
   - For a binary protocol, custom bots are the primary tool; k6 is best for connection and reconnection storms.

---

## 8. Render specifics, Free-tier feasibility and recommended rates

### 8.1 Long-lived WebSockets on Render

- **What is supported.** Web services accept inbound WebSockets from the public internet [17]. Render **"does not enforce a maximum duration for WebSocket connections"**; a connection lasts until its instance shuts down [17].
- **Idle timeout.** Render's WebSocket page states none [17]. uWS defaults `idleTimeout` to 120 s and can send pings automatically [11].
- **Keepalive and reconnection.** Render recommends periodic keepalive messages in both directions, and client reconnection with **exponential backoff** [17].
- **No instance affinity.** "Clients are not guaranteed to reconnect to the same instance". The load balancer assigns each new WebSocket connection to a **random instance** [17].
- **Ports and protocols.** One public port (default 10000). Always use `wss` publicly [17][19]. Render's load balancer terminates TLS [19].
- **Instance swaps.** "Render periodically swaps out your web service's running instances" [17].

### 8.2 Deploys and shutdown

- Deploys are zero-downtime unless the service has a persistent disk. A new instance starts, and traffic moves to it once it is healthy [18].
- Render then sends **SIGTERM** to the original instance after 60 s. The shutdown delay is **30 s by default, configurable up to 300 s** (`maxShutdownDelaySeconds` in render.yaml or the API), and is followed by **SIGKILL** [18].
- Our plan: checkpoint, broadcast "restarting", close sockets with 1012 [48], and let clients resume against the new instance with their token (§2).
- The Free page does not describe Free-specific deploy or shutdown-delay behaviour [20], so verify it in the spike.

### 8.3 UDP status: why this is a WebSocket host

- **Web services.** Render's web-services docs mention only HTTP on one forwarded port [19].
- **Private network.** Services can use almost any port and protocol on the private network [24], but that network is not public. Free web services also cannot receive private traffic [20].
- **Forum replies.** Older staff replies, seen via search-engine excerpts, say public access is HTTPS only, that UDP "is not currently on our roadmap", and that web services are reachable on 80/443 only [25][26]. The forum host redirect failed DNS when accessed on 2026-11-11, so treat these as dated.
- **Consequence.** WebTransport needs HTTP/3 [51], and WebRTC data-channel servers need public UDP. Neither can be served from Render web services. On this host, WebSocket is the documented real-time path.

### 8.4 Free-tier facts

| Fact | Source |
|---|---|
| Free web service: **0.1 CPU, 512 MB RAM** (plan id `free`) | [22][21] |
| Spins down after **15 minutes without inbound traffic**. Inbound traffic includes HTTP requests and WebSocket messages on existing connections, and a new WebSocket connection also wakes the service. Spin-up takes **about one minute**. | [20] |
| **750 Free instance-hours** per workspace per month. All Free services are suspended when they run out. | [20] |
| "Render might restart a Free web service at any time"; no scaling beyond one instance; local files lost on restart; no persistent disk | [20] |
| Bandwidth counts against monthly included amounts. Without a payment method, overage suspends Free services for the rest of the month. Render may also suspend services with unusually high external traffic. | [20] |
| Hobby workspace: **5 GB of bandwidth included per month**; **$0.15/GB** beyond that | [21] |
| A third-party review dated July 2026 describes a 1 August 2026 plan change with a "20x bandwidth cut". This is unverified, but explains why older listings say 100 GB. | [58] |

### 8.5 Is one 16-player room realistic on 0.1 CPU?

**The CPU budget.** 0.1 CPU ≈ 100 ms of CPU per second. Render does not document how it enforces this. If it works like Linux CFS bandwidth control with the default 100 ms period, the group gets about 10 ms per 100 ms, and **throttled threads cannot run until the next period** [27]. The danger is therefore bursts, not just the average:

- a 30 Hz tick leaves about **3.3 ms of CPU per tick**;
- a 20 Hz tick leaves about **5 ms per tick**.

**CPU per second for one room (all est., unmeasured):**

| Cost item | 30 Hz tick / 20 Hz snapshots | 20 Hz tick / 10 Hz snapshots | Notes |
|---|---|---|---|
| Simulation (96 entities, dust kernel, belts, robot AI amortised) | 9–45 ms/s | 6–30 ms/s | 0.3–1.5 ms per tick of allocation-free TypeScript. Robot path queries are capped per tick. |
| Snapshot and dust encoding | 2–6 ms/s | 1–3 ms/s | Encoded once, plus per-client tails |
| Socket I/O, uWS / ws | 1–3 / 4–12 ms/s | 0.5–2 / 2.5–8 ms/s | ≈800 vs ≈480 msgs/s (§1.3) |
| Garbage collection, runtime, metrics | 3–10 ms/s | 3–10 ms/s | |
| **Total with uWS** | **≈15–64% of budget** | **≈11–45% of budget** | |
| **Total with ws** | **≈18–73% of budget** | **≈13–51% of budget** | |

**Memory (est.).** Node baseline is about 50–80 MB, sockets are under 5 MB, and room state plus caches and replay logs are under 10 MB. That is well under 512 MB. Cap the heap with `--max-old-space-size` [53].

**Verdict (est.):**

- **20 Hz tick / 10 Hz snapshots** for one 16-player room is realistic if the simulation is allocation-free:
  - robot AI decisions run at about 5 Hz, staggered across ticks;
  - conveyor items are simulated on the client;
  - dust compression is incremental.
- **30 Hz / 20 Hz** is possible only at the low end of the estimates, and it is fragile to CPU bursts.
- **Go/no-go gate:** in the week-1 bot spike, CPU p95 must stay under about 60% and event-loop delay p99 under about 20 ms.

### 8.6 Recommended rates

| Parameter | Spec (paid instance) | **Render Free recommendation** | Reason |
|---|---|---|---|
| Server simulation tick | 30 Hz | **20 Hz** | ≈5 ms per-tick CPU budget instead of ≈3.3 ms [27] |
| Snapshot rate | 15–20 Hz | **10 Hz** (every 2nd tick) | Halves bytes and sends against the 5 GB allowance [21] |
| Interpolation delay | ≈100 ms (Valve default [37]) | **Adaptive 150–250 ms** (start at 200 ms) | Keep at least 2 snapshot intervals plus jitter buffered |
| Client input rate | 30 Hz | **20 Hz** (one input per tick) | Matches the simulation tick |
| Dust deltas, near / far | ~10 Hz / — | **5 Hz / 0.5 Hz** | §5 |
| Robot AI decisions | Every tick | **5 Hz, staggered** | Smooths CPU bursts |
| Rooms per instance | Several | **1** (up to 16 players) | Single Free instance [20] |
| Keepalive | — | App-level ping every ~2 s, plus uWS auto-ping | Render recommends keepalives [17]. Inbound messages keep a Free instance awake while players are connected [20]. |

**Operational additions:**

- **Wake-up screen.** The Vercel client calls `/healthz` on landing so the about-one-minute spin-up [20] overlaps with the menu, and shows a "waking the moon base" screen.
- **Bandwidth guard.** Refuse new rooms once month-to-date egress passes about 4.5 GB [21].
- **Checkpoints** every 30–60 s and on SIGTERM.

---

## 9. Self-scored table (1 = poor, 5 = excellent)

| # | Criterion | Score | Justification | Sources |
|---|---|---|---|---|
| 1 | Reliability under loss, latency and reconnects | **3** | TCP gives delivery and ordering, so there is no ack/resend layer to write. Head-of-line blocking stalls the stream under loss. Reconnection and resume are ours to build, and Render restarts and spin-downs make them mandatory. | [29][17][20] |
| 2 | Prediction and reconciliation fit | **5** | Full control of input sequence numbers, fixed tick, and a per-client input ack in every snapshot. This is the textbook model. | [34][35][37] |
| 3 | Bandwidth efficiency | **5** | Quantized bit-packed deltas at ≈4–6 B per moving entity; ≈41 kbps per player on the Free profile versus ≈1 Mbps for naive JSON (est.). Decisive under a 5 GB allowance. | [28][21] |
| 4 | Interest management | **4** | Per-client chunk sets plus uWS region topics; completely flexible but entirely self-built | [10] |
| 5 | Large-state sync | **5** | Chunk-local dirty lists, compressed join baseline, nearest-first streaming, incremental compression cache | [50] |
| 6 | Hosting fit on Render | **4** | WebSocket is Render's documented real-time path, TLS is offloaded, and no UDP is needed. Downsides: uWS GitHub/ABI pinning and a single Free instance. | [17][19][23][8] |
| 7 | Rooms, matchmaking and reconnect features | **2** | Nothing out of the box; about 9–11 agent-days of plumbing (est.) | (est.) |
| 8 | Testing and load-testing tooling | **4** | k6 `k6/websockets`, Artillery `ws`, Toxiproxy and netem are all available. Binary payloads need custom bot code. | [41][42][43][57] |
| 9 | Solo-dev simplicity and agent familiarity | **3 (ws) / 2 (uWS)** | ws is ubiquitous. uWS idioms (borrowed buffers, `cork`) are less familiar. A custom codec needs rigorous tests. | [12][10][11] |
| 10 | Maintenance, license and community | **4** | ws: MIT, patched 2026-11-08. uWS: Apache-2.0 and active, but a single vendor, GitHub-only, with visible release churn. | [13][3][1] |
| + | *(added for the new constraint)* Free-tier CPU and memory efficiency | **4** | Likely the leanest stack possible on 0.1 CPU, but unmeasured, with CFS-style throttling risk | [16][27] |

---

## 10. Weaknesses, risks and mitigations, and the hybrid option

| # | Weakness or risk | Mitigation |
|---|---|---|
| W1 | **We own the plumbing**: rooms, reconnect, resume, shutdown. That is about 9–11 extra agent-days, plus long-tail bugs in unglamorous code (§2). | Explicit state machines for the connection and seat lifecycle. Chaos tests using Toxiproxy `reset_peer`/`timeout` and scripted SIGTERM [43]. Keep features minimal: invite codes plus a public list, no global matchmaking. |
| W2 | **TCP head-of-line blocking.** One lost segment stalls the whole stream for at least one RTT and up to an RTO [29][49]. This cannot be avoided on Render, which has no public UDP [19][25]. | Adaptive interpolation buffer and capped extrapolation (§4). Send state, not one-off events. Keep messages small with deflate off [12]. Nagle is off in ws [15]. Resync with a keyframe after long stalls. Show a connection-quality indicator in the UI. |
| W3 | **Free-tier fragility.** 0.1 CPU throttling, the 5 GB/month allowance (about 17 room-hours at best, est.), restarts at any time, and about a 1-minute cold start [20][21][27]. | The 20/10 Hz profile, the bandwidth guard and checkpoints from §8. A product decision is needed: adding a payment method would turn suspension into $0.15/GB overage [20][21]. |
| W4 | **uWS distribution and churn.** GitHub-only, binaries only for Node 22/24/26, glibc only, and 2026 releases that disabled or reverted changes [1][3][8]. | Pin the tag and Node 24 [23], add a CI smoke test that loads the binary, keep the ws fallback behind the adapter, and read release notes before every bump. |
| W5 | **Bit-level bugs and agent unfamiliarity** with custom codecs | One codec module driven by a field table, exhaustive round-trip and fuzz tests, and a development-only JSON mirror mode for debugging |
| W6 | **Abuse and resource limits.** Unauthenticated upgrade attempts, ws' 100 MiB default `maxPayload` [14], and input flooding | Authenticate in the upgrade handler. Use payload limits of 4–16 KiB (the uWS default is 16 KiB [11]). Accept at most one input per tick per player and drop the rest. |
| W7 | **Single-instance ceiling.** Render assigns new connections to random instances with no stickiness [17], and Free cannot scale anyway [20]. | One room per instance for now. Multi-instance room routing would need an external router on Render. This is a ceiling for every approach on this host, not only raw WebSockets. |

**Could a hybrid capture the best of both? Yes, credibly.**

- **What exists.** The Colyseus docs show **0.18** with an official `@colyseus/uwebsockets-transport@^0.18.0`. It ships a specific uWS.js version, which can be overridden with `overrides`/`resolutions`. Its defaults are `maxPayloadLength` 4096, `idleTimeout` 120 s, `sendPingsAutomatically` true, compression disabled and `maxBackpressure` 1 MiB [44]. Raw bytes can be exchanged with `room.sendBytes()` [45], which has been possible since Colyseus 0.15 [46].
- **How the hybrid works.** Colyseus handles rooms, matchmaking, lobby and in-process reconnection. Our bit-packed snapshots, dust deltas and input frames travel as `sendBytes` payloads, and the Colyseus schema state holds only room metadata.
- **What it gains.** It removes most of the 9–11-agent-day plumbing premium and keeps about 90% of the byte-efficiency case.
- **What it costs.**
  - Two mental models.
  - Framework CPU on 0.1 CPU (unmeasured).
  - A per-message framework envelope (size to be measured).
  - The uWS version is coupled to the transport package [44].
  - Resume across a process restart still needs our own MySQL checkpointing.
- **Recommendation.** Whichever edge is chosen, build the **codec, dust sync, interest management, prediction and interpolation as transport-agnostic packages**. Raw uWS is my default because it is leanest on the $0 host. Colyseus with `sendBytes` is the low-regret alternative if the decider weighs solo-dev simplicity above the last few percent of CPU and bytes. None of the protocol work is wasted either way.

---

## Sources

All accessed 2026-11-11. † = standard reference not re-fetched in this session; cited only for its general, well-known content. ‡ = content seen via search-engine excerpt only.

1. uNetworking/uWebSockets.js — README (GitHub) — https://github.com/uNetworking/uWebSockets.js — accessed 2026-11-11
2. uWebSockets.js — Releases — https://github.com/uNetworking/uWebSockets.js/releases — accessed 2026-11-11
3. GitHub REST API — uWebSockets.js releases (tag_name, published_at, notes) — https://api.github.com/repos/uNetworking/uWebSockets.js/releases?per_page=12 — accessed 2026-11-11
4. GitHub REST API — uWebSockets.js tags — https://api.github.com/repos/uNetworking/uWebSockets.js/tags?per_page=8 — accessed 2026-11-11
5. uWebSockets.js release v20.71.0 — https://github.com/uNetworking/uWebSockets.js/releases/tag/v20.71.0 — accessed 2026-11-11
6. uWebSockets.js release v20.67.0 ("Node.js 26") — https://github.com/uNetworking/uWebSockets.js/releases/tag/v20.67.0 — accessed 2026-11-11
7. GitHub REST API — uWebSockets.js contents at tag v20.71.0 (binary list) — https://api.github.com/repos/uNetworking/uWebSockets.js/contents?ref=v20.71.0 — accessed 2026-11-11
8. uWebSockets.js — uws.js loader at v20.71.0 — https://raw.githubusercontent.com/uNetworking/uWebSockets.js/v20.71.0/uws.js — accessed 2026-11-11
9. Node.js — doc/abi_version_registry.json — https://raw.githubusercontent.com/nodejs/node/main/doc/abi_version_registry.json — accessed 2026-11-11
10. uWebSockets.js API docs — Interface WebSocket — https://unetworking.github.io/uWebSockets.js/generated/interfaces/WebSocket.html — accessed 2026-11-11
11. uWebSockets.js API docs — Interface WebSocketBehavior — https://unetworking.github.io/uWebSockets.js/generated/interfaces/WebSocketBehavior.html — accessed 2026-11-11
12. websockets/ws — README (GitHub) — https://github.com/websockets/ws — accessed 2026-11-11
13. GitHub REST API — ws releases — https://api.github.com/repos/websockets/ws/releases?per_page=8 — accessed 2026-11-11
14. ws — API documentation (doc/ws.md) — https://github.com/websockets/ws/blob/master/doc/ws.md — accessed 2026-11-11
15. ws — lib/websocket.js source — https://raw.githubusercontent.com/websockets/ws/master/lib/websocket.js — accessed 2026-11-11
16. Bun Docs — WebSockets — https://bun.sh/docs/api/websockets — accessed 2026-11-11
17. Render Docs — WebSockets on Render — https://render.com/docs/websocket — accessed 2026-11-11
18. Render Docs — Deploying on Render — https://render.com/docs/deploys — accessed 2026-11-11
19. Render Docs — Web Services — https://render.com/docs/web-services — accessed 2026-11-11
20. Render Docs — Deploy for Free — https://render.com/docs/free — accessed 2026-11-11
21. Render — Pricing (Markdown version) — https://render.com/pricing.md — accessed 2026-11-11
22. Render Docs — Updates to Render Compute Plans — https://render.com/docs/compute-plans-update.md — accessed 2026-11-11
23. Render Docs — Setting Your Node.js Version — https://render.com/docs/node-version — accessed 2026-11-11
24. Render Docs — Private Network ‡ — https://render.com/docs/private-network — accessed 2026-11-11
25. Render Community — Opening up a UDP port for incoming traffic ‡ (forum redirect host failed DNS on access) — https://community.render.com/t/opening-up-a-udp-port-for-incoming-traffic/821 — accessed 2026-11-11
26. Render Community — Webrtc/udp server possible (the render.com server will be the central peer)? ‡ (same caveat) — https://community.render.com/t/webrtc-udp-server-possible-the-render-com-server-will-be-the-central-peer/4109 — accessed 2026-11-11
27. Linux Kernel Documentation — CFS Bandwidth Control — https://docs.kernel.org/scheduler/sched-bwc.html — accessed 2026-11-11
28. Glenn Fiedler (Gaffer On Games) — Snapshot Compression — https://gafferongames.com/post/snapshot_compression/ — accessed 2026-11-11
29. Glenn Fiedler (Gaffer On Games) — UDP vs. TCP ‡ — https://gafferongames.com/post/udp_vs_tcp/ — accessed 2026-11-11
30. Glenn Fiedler (Gaffer On Games) — Snapshot Interpolation † — https://gafferongames.com/post/snapshot_interpolation/ — accessed 2026-11-11
31. Glenn Fiedler (Gaffer On Games) — Fix Your Timestep! † — https://gafferongames.com/post/fix_your_timestep/ — accessed 2026-11-11
32. Glenn Fiedler (Gaffer On Games) — Reading and Writing Packets † — https://gafferongames.com/post/reading_and_writing_packets/ — accessed 2026-11-11
33. Glenn Fiedler (Gaffer On Games) — Serialization Strategies † — https://gafferongames.com/post/serialization_strategies/ — accessed 2026-11-11
34. Gabriel Gambetta — Fast-Paced Multiplayer (Part II): Client-Side Prediction and Server Reconciliation ‡ — https://gabrielgambetta.com/client-side-prediction-server-reconciliation.html — accessed 2026-11-11
35. Gabriel Gambetta — Fast-Paced Multiplayer (Part III): Entity Interpolation ‡ — https://gabrielgambetta.com/entity-interpolation.html — accessed 2026-11-11
36. Gabriel Gambetta — Fast-Paced Multiplayer: Sample Code and Live Demo ‡ — https://www.gabrielgambetta.com/client-side-prediction-live-demo.html — accessed 2026-11-11
37. Valve Developer Community — Source Multiplayer Networking ‡ — https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking — accessed 2026-11-11
38. Fabien Sanglard — Quake 3 Source Code Review: Network Model ‡ — https://fabiensanglard.net/quake3/network.php — accessed 2026-11-11
39. npm registry — @geckos.io/snapshot-interpolation metadata — https://registry.npmjs.org/@geckos.io/snapshot-interpolation — accessed 2026-11-11
40. geckosio/snapshot-interpolation (GitHub) — https://github.com/geckosio/snapshot-interpolation — accessed 2026-11-11
41. Grafana k6 Docs — k6/websockets — https://grafana.com/docs/k6/latest/javascript-api/k6-websockets/ — accessed 2026-11-11
42. Artillery Docs — WebSocket engine — https://www.artillery.io/docs/reference/engines/websocket — accessed 2026-11-11
43. Shopify/toxiproxy (GitHub) — https://github.com/Shopify/toxiproxy — accessed 2026-11-11
44. Colyseus Docs — uWebSockets.js Transport — https://docs.colyseus.io/server/transport/uwebsockets — accessed 2026-11-11
45. Colyseus Docs — Client SDK (room.sendBytes) ‡ — https://docs.colyseus.io/sdk — accessed 2026-11-11
46. endel/colyseus-0.15-protocol-buffers (GitHub) ‡ — https://github.com/endel/colyseus-0.15-protocol-buffers — accessed 2026-11-11
47. IETF RFC 6455 — The WebSocket Protocol † — https://datatracker.ietf.org/doc/html/rfc6455 — accessed 2026-11-11
48. IANA — WebSocket Protocol Registries (close codes, e.g. 1012 Service Restart) † — https://www.iana.org/assignments/websocket/websocket.xhtml — accessed 2026-11-11
49. IETF RFC 6298 — Computing TCP's Retransmission Timer † — https://datatracker.ietf.org/doc/html/rfc6298 — accessed 2026-11-11
50. MDN Web Docs — DecompressionStream † — https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream — accessed 2026-11-11
51. MDN Web Docs — WebTransport API † — https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API — accessed 2026-11-11
52. Node.js Docs — Performance measurement APIs (perf_hooks, monitorEventLoopDelay) † — https://nodejs.org/api/perf_hooks.html — accessed 2026-11-11
53. Node.js Docs — Command-line API (--max-old-space-size) † — https://nodejs.org/api/cli.html — accessed 2026-11-11
54. kriszyp/msgpackr (GitHub) † — https://github.com/kriszyp/msgpackr — accessed 2026-11-11
55. bufbuild/protobuf-es (GitHub) † — https://github.com/bufbuild/protobuf-es — accessed 2026-11-11
56. google/flatbuffers (GitHub) † — https://github.com/google/flatbuffers — accessed 2026-11-11
57. man7.org — tc-netem(8) Linux manual page † — https://man7.org/linux/man-pages/man8/tc-netem.8.html — accessed 2026-11-11
58. jwatte.com — "Render.com in Mid-2026: The Plan Change on 1 August, the 20x Bandwidth Cut…" (third-party, July 2026) ‡ — https://jwatte.com/blog/render-com-platform-review/ — accessed 2026-11-11
