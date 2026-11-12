# The Case for Unreliable Transports (WebRTC/geckos.io, WebTransport), plus Socket.IO, and Whether They Work on Render

**Date:** 2026-11-11 · **Author:** advocate subagent P2f · **Status:** planning research only (no code) · **Context:** authoritative Node.js/TypeScript server on a Render **free** web service ($0 budget), static client on Vercel, up to 16 players per room, 30 Hz tick, 15–20 Hz snapshots.

> Reading notes. Numbers in square brackets refer to the **Sources** list at the end (all accessed 2026-11-11). Text marked **(estimate)** or **(inference)** is my own analysis built on the cited facts, not a sourced fact. A few sources could only be read through a search engine's index because the site blocked or failed direct fetching. Those are flagged in the Sources list.

## Executive summary

- **Verdict: unreliable transports are not feasible on Render.** Render forwards public traffic to *one HTTP port* per web service through a load balancer that terminates HTTPS. Private services can't be reached from the internet, and a "Support UDP" request has been open since 2019 [1][2][3][7]. geckos.io (WebRTC over UDP) and WebTransport (QUIC over UDP) both need the server to accept UDP from the internet.
- **WebTransport can't get in through Render's edge either.** Render's docs mention HTTP/2 but not HTTP/3 [1]. Render says it uses Cloudflare's DDoS infrastructure [6], and Cloudflare says HTTP/3 to the origin "is not yet supported" [10].
- **Socket.IO is the only one of the three that works on our plan.** It uses WebSocket, with HTTP long-polling as a fallback, and Render supports inbound WebSockets [4][39].
- **The benefit of unreliable transports is real but modest for a co-op game.** Over TCP, one lost packet holds up every later snapshot until it is resent [44]. At 15–20 Hz that means remote entities freeze for about 0.1–0.3 s and then jump forward (estimate). A 100–150 ms interpolation buffer absorbs part of that [45].
- **Our dust field needs reliable delivery anyway.** That's about 163,842 sectors with frequent partial updates. This shrinks what UDP would gain us (inference).
- **On Render Free, platform behavior is a bigger reliability risk than packet loss.** The service spins down after 15 minutes idle, takes about a minute to start, can be restarted "at any time", and Render says not to use Free for production [5]. Reconnect and full-state resync matter more than the transport choice.
- **geckos.io 3.1.0** (2026-03-27): BSD-3-Clause, effectively one maintainer, and it pins the native `node-datachannel` at 0.32.1 while npm is at 0.33.6. It needs a TCP signaling port plus UDP ports. It has one data channel per client, and its "reliable" mode just resends each message 10 times [13][14][20][21].
- **WebTransport browser support is now broad:** Chrome 97+, Edge 98+, Firefox 114+, Safari 26.4+ (macOS and iOS), about 92% of global usage [30][31]. The Node server side is immature. `node:quic` is "early development" behind a flag. The practical library is `@fails-components/webtransport` 1.6.11, a native libquiche addon [34][35][36].
- **Socket.IO 4.8.4** (2026-09-25, MIT) gives us rooms, acks with timeouts, buffering and auto-reconnect, connection state recovery, and binary payloads. Use the msgpack parser so binary goes out as one frame. "Volatile" events still run over TCP; they are not UDP [40][41][42][43].
- **Recommended path:** ship on WebSocket now, but write the netcode as if packets can be lost, behind a two-lane transport abstraction (§5). Then WebTransport datagrams can be added later without a rewrite. For that future, WebTransport is the better bet than geckos.io [30][34].
- **If we ever leave Render:** Fly.io supports public UDP, with caveats: dedicated IPv4 at $2/month, smallest machine $2.19/month [23][24]. Hathora's game hosting shut down in spring 2026 [29]. Edgegap charges per vCPU-minute [27]. Cloudflare TURN costs $0.05/GB after 1,000 GB free [26].
- **Self-scores (8 criteria, max 40):** Socket.IO **32**, WebTransport **22**, geckos.io **20**. Both unreliable options score 1 for hosting fit on Render, which rules them out (§6).

---

## 1. Why unreliable transports matter for action games, and how much they matter for us

### 1.1 The mechanism: head-of-line blocking

- TCP, and so WebSocket and Socket.IO, delivers one ordered byte stream. When a segment is lost, everything sent after it waits until the lost segment is resent and arrives. Glenn Fiedler puts it this way: new data "gets put in a queue, and you cannot access it until that lost packet has been retransmitted", while "the game only cares about the most recent data". He concludes: "you should never use TCP when networking time-critical data!" [44].
- Valve's Source engine runs over UDP. It defaults to a 100 ms interpolation period at about 20 snapshots per second, "so that even if one snapshot is lost, there are always two valid snapshots to interpolate between" (wording from the Valve wiki via search index) [45]. With an unreliable transport, a single lost snapshot is invisible.
- Browsers offer two ways to get that behavior:
  - **WebRTC data channels** set to unordered with no retransmissions. These are geckos.io's defaults: `ordered` false, `maxRetransmits` 0 [13]. libdatachannel defines the unordered/unreliable/max-retransmits options [22].
  - **WebTransport datagrams**, carried alongside reliable streams on the same connection [32].

### 1.2 Size of the effect at our rates (estimate)

Assumptions: snapshots at 15–20 Hz (50–67 ms apart), inputs sent at about 30 Hz, round-trip time (RTT) of 50–120 ms, and remote entities interpolated 100–150 ms in the past.

| Situation | Unreliable transport (UDP-style) | Reliable ordered transport (WebSocket/TCP) |
|---|---|---|
| One snapshot lost | Interpolation covers the gap; nothing visible [45] | The whole stream waits about one RTT plus loss-detection time (roughly **100–300 ms** here, longer if a retransmission timeout fires). Then 2–5 snapshots arrive at once. If the wait is longer than the interpolation buffer, remote avatars, vehicles and robots freeze or extrapolate, then snap. |
| One input packet lost | The next packet repeats the last few inputs, so nothing is lost | Inputs reach the server late, all at once. The server either waits (an input buffer) or simulates without them, and the player sees a correction. **Sending inputs redundantly does not help over TCP**, because the copies are stuck behind the same lost segment [44]. |
| How often (random 1% loss, 20 packets/s) | About one loss every 5 s in each direction; invisible | About one stall every 5 s; visible as a hitch. At 0.1% loss, about one every 50 s. |

The frequency row is plain arithmetic on assumed loss rates. Real loss comes in bursts and depends on the network (Wi-Fi and mobile are worse).

**Bandwidth context (estimate).** There are 96 dynamic entities (16 avatars, 16 vehicles, 64 robots). At about 12 quantized bytes each, a full snapshot is about 1.2 KB. At 20 Hz that's about 24 KB/s per client, so about 0.4 MB/s from the server for a full room, or roughly 1.4 GB per room-hour before delta compression. Every transport adds a few tens of bytes of headers per packet. That's about 1–2 KB/s per client, around 5% of the payload. **The serialization format, delta compression and interest management matter far more for bandwidth than the transport choice.** Render Free counts outbound traffic against an included allowance and bills anything over it [5], so bandwidth discipline matters on a $0 budget.

### 1.3 What this means for a co-op game

- There are no fairness disputes over hit registration or lag compensation. Everyone cooperates against the environment. A remote entity that hitches for 200 ms is a cosmetic problem, and the local player's own movement stays responsive because it is predicted on the client.
- **TCP-side mitigations are cheap** (inference):
  - Interpolate remote entities about 150 ms in the past; co-op can tolerate that.
  - Size the jitter buffer adaptively.
  - Extrapolate briefly, with smoothing, when the buffer runs dry.
  - Keep a server input buffer of 1–3 ticks.
  - Skip a stale snapshot instead of queuing it when the send buffer is backed up.
- **The dust field changes the calculation.** About 163,842 sectors with frequent partial updates have to converge exactly on every client. On a reliable channel, each change is sent once. On an unreliable channel we would need per-client acknowledgement tracking and resending of the latest values, which is more code to write and test. Part of our traffic belongs on a reliable lane whichever transport we use (inference).
- **Conclusion for §1:** an unreliable transport would make remote motion smoother and avoid input bursts under loss. For this co-op game that is a nice-to-have, not a deciding factor. Hosting feasibility (§2–§3) decides it.

---

## 2. geckos.io (WebRTC data channels)

### 2.1 Version and maintenance status (Nov 2026)

- **Latest release:** `@geckos.io/server` **3.1.0**, published 2026-03-27. Earlier: 3.0.2 (2025-04-19), 3.0.1 (2024-11-24), 3.0.0 (2023-12-10) [20].
- **Package facts:** license BSD-3-Clause; `engines` node ">=18"; depends on `node-datachannel` **pinned at "0.32.1"** [20]. The current `node-datachannel` on npm is **0.33.6** (MPL 2.0, node ">=18.20.0") [21], so geckos.io is a minor version behind on its native dependency.
- **Recent activity:**
  - A batch of commits on 2026-03-27: v3.1.0, `node-datachannel@0.32.1`, and "Add reliable option for server.room().emit() (#301)".
  - A `node-datachannel` 0.31.0 update on 2026-01-02.
  - A CodeQL workflow change on 2025-11-08 [14].
- **Community:**
  - About 1.5k stars, 90 forks and 4 open issues [12][15].
  - Issue #269, "Separate (underlying) datachannels for unreliable and reliable messages", is labeled "help wanted". A bot marked it stale on 2026-10-24 [17].
- **Assessment (inference):** maintained, but slowly, essentially by one maintainer (yandeu) with occasional outside contributors [14].

### 2.2 Requirements

- **Ports:** the README says to deploy "to a server which forwards all traffic on ports **9208/tcp**" for signaling. It also says "The peer connection itself will be on a random port between 1025-65535/udp" (the default `portRange`). With `multiplex` (the default), "the first available port in the port range will be used for all connections" [13].
- **Native dependency:** `node-datachannel`, described as "WebRTC For Node.js and Electron. libdatachannel node bindings." [21]. geckos.io v2 moved to it from `wrtc` [12].
- **ICE, STUN and TURN:**
  - geckos.io ships a default ICE server list for testing. The README adds: "In production, you should probably use your own STUN and TURN servers." [13].
  - The server code passes `iceServers` (URL strings only), `bindAddress`, `enableIceUdpMux` and the port range through to `node-datachannel` [18].
  - The server code rejects a relay-only `iceTransportPolicy` and switches it to `'all'` [19].
- **Reliability model:** there is one data channel, unreliable by default. "Reliable" messages work by "transferring multiple messages after each other": 10 sends 150 ms apart, with the receiver discarding duplicates. The README says "This is **NOT** meant to be used as the default." [13].
- **Known deployment pain:** issue #245, "Datachannel connection failing when server running in docker", has 39 comments and never reached a confirmed root cause. One contributor concluded "its not so much a geckos.io issue as a webrtc ICE resolution issue" [16].

### 2.3 Does Render support it? No.

- **Web services:** "Render forwards inbound traffic to only one HTTP port per web service." Extra ports can be bound only "to receive traffic over your private network". "Render's load balancer terminates SSL for inbound HTTPS requests" [1].
- **Private services:** they "aren't reachable via the public internet" and "do not receive an onrender.com subdomain". They can "listen on almost any port" and "communicate using any protocol", but only inside the private network [2][3].
- **Feature request:** "Allow connecting to non-HTTP services from outside Render", which absorbed the "Support UDP" request. It is "open", has about 150 votes, was created 2019-09-03, and has no written staff reply [7].
- **Staff forum reply:** an older reply from Render staff said: "We only permit http to services, if it's possible to use webrtc over HTTP then it should work - but if it's not then I'm afraid not." [8]. It is old and I read it through a search index.
- **Verdict:** geckos.io's UDP ports can't be reached from browsers on any Render plan. **Infeasible.**
- **A theoretical workaround (unverified, not recommended):**
  - The idea: browser and server both relay through a third-party TURN service, so the Render server only needs *outbound* UDP.
  - Render doesn't document whether outbound UDP is allowed.
  - geckos.io passes only ICE server URL strings and won't accept a relay-only policy [18][19], so the credential and policy handling is unproven.
  - Cloudflare's TURN does not do TCP relaying ("does not implement RFC6062") [26].
  - Every packet would take an extra relay hop.
  - Cost: $0.05/GB after 1,000 GB free [26].
  - Treat this as a curiosity, not a plan.

### 2.4 If we ever move hosts (outside the $0 budget; brief)

| Option | UDP from browsers? | Rough cost | Caveats |
|---|---|---|---|
| **Fly.io** | Yes, with a dedicated IPv4: "You'll need a dedicated IPv4 address for your app to accept UDP packets." [23] | Dedicated IPv4 $2.00/month. `shared-cpu-1x` 256 MB $2.19/month. Egress $0.02/GB (North America/Europe) [24] | Must bind UDP to `fly-global-services`. "We don't support UDP over public IPv6." "There's no per-flow load balancing for UDP." "QUIC isn't supported through UDP services", though "You can technically get it working, but with a lot of caveats" [23]. WebRTC servers (LiveKit) have been run this way after binding to `fly-global-services` [25]. geckos.io passes a `bindAddress` option through to node-datachannel [18], which is the hook this would need. Needs a spike. |
| **Hathora** | n/a | n/a | Acquired by Fireworks AI. Game Developer reported Hathora "is winding down its service at the end of April" 2026 [29]. **Not an option.** |
| **Edgegap** | Container ports (unverified for Node WebRTC or WebTransport) | $0.00115 per vCPU-minute (about $0.069 per vCPU-hour); egress $0.10/GB; free trial with a 60-minute uptime cap per deployment [27] | Oriented to Unity and Unreal. Its WebGL guidance steers browser clients to WS/WSS ports [28]. |
| **Cloudflare Realtime TURN/STUN** | Relay only, not hosting | TURN $0.05/GB after 1,000 GB free; STUN at `stun.cloudflare.com` "free and unlimited" [26] | Helps with NAT traversal; doesn't host the game server. |
| **A plain VPS (e.g., Hetzner)** | Not researched in this pass ($0 budget) | n/a | n/a |

---

## 3. WebTransport (HTTP/3 over QUIC)

### 3.1 Browser support, November 2026

| Browser | First supported version |
|---|---|
| Chrome | 97 [30] |
| Edge | 98 [30] |
| Firefox | 114 [30] |
| Safari (macOS) | 26.4 [30][31] |
| Safari (iOS) | 26.4 [30] |
| Opera / Samsung Internet | 83 / 18.0 [30] |
| Chrome for Android | Current versions (caniuse lists 157) [30] |

- **Global usage:** caniuse puts it at 92.37% [30].
- **Safari 26.4 fallback:** WebKit's Safari 26.4 post says WebTransport can also run over HTTP/2 and TCP as a fallback, with the same API (read via search index) [31]. That fallback is TCP, so it brings no head-of-line benefit (inference).
- **Standards status:** the HTTP/3 mapping was still an Internet-Draft in the version I found (draft-ietf-webtrans-http3-15) [33]. I did not check whether it has since become an RFC.

### 3.2 Node.js server options

- **Built-in `node:quic`:** "Stability: 1.0 - Early development". It needs a Node binary built with experimental QUIC, started with `--experimental-quic`. HTTP/3 is its only built-in application protocol; WebTransport would have to be built on its JavaScript API [34][35]. **Not production-ready.**
- **`@fails-components/webtransport` 1.6.11:** BSD-3-Clause, node ">=20". It describes itself as "A component to add webtransport support (server and client) to node.js using libquiche" [36]. It is a native addon, and MDN points to it for Node.js [32][37].
- **Socket.IO on WebTransport:** "Support for WebTransport has been added in version 4.7.0". It uses `@fails-components/webtransport`. WebTransport "only works in secure contexts (HTTPS)". Self-signed development certificates must have a validity period that does "NOT exceed two weeks" and use ECDSA P-256. If WebTransport fails, Socket.IO falls back to WebSocket [39]. The page doesn't say it uses datagrams, so assume reliable streams only (inference).
- **Outside Node:** quic-go (Go) documents a WebTransport implementation [38]. Using it would mean a non-TypeScript sidecar next to our server, which fits our stack poorly (inference).

### 3.3 Does Render support it? No.

- **Protocols:** Render's web service docs list HTTP/2 and WebSockets. They don't mention HTTP/3, QUIC or UDP. Public traffic reaches one HTTP port through an HTTPS-terminating load balancer [1].
- **Render's edge:** Render says "We're using Cloudflare's industry-leading DDoS protection infrastructure behind the scenes" [6]. If public traffic passes through Cloudflare's proxy (inference), Cloudflare's own docs say HTTP/3 "is for connection between the user and Cloudflare. HTTP/3 connection to the origin is not yet supported." [10]. A Cloudflare community answer also says proxied (layer 7) traffic doesn't support WebTransport (read via search index) [11].
- **Render community:** a thread asking Render about WebTransport (April 2025) exists. I found no staff answer [9].
- **Verdict:** **infeasible on Render.** WebTransport is technically the best of the three and is a standard shipped in every major browser. It belongs on the roadmap for a host that passes UDP/443 straight through, and even Fly.io warns about QUIC through its UDP services [23].

---

## 4. Socket.IO

- **Version:** **4.8.4**, published 2026-09-25. MIT license. Depends on `engine.io` ~6.6.0 and `socket.io-parser` ~4.2.4 [43].
- **Recent history:** 4.8.1 (2024-10-25), 4.8.2 and 4.8.3 (December 2025), 4.7.0 (2023-06-22) [43].
- **Transports:** clients start with "HTTP long-polling first" and then "quietly upgrade to more performant transports, like WebSocket or WebTransport" [39]. On Render that means WebSocket.
- **Features:**
  - **Rooms**, which connection state recovery preserves [40].
  - **Acks:** a callback "called once the other side acknowledges the event". "Starting with Socket.IO v4.4.0, you can now assign a timeout to each emit" [42].
  - **Buffering:** "by default, the events are buffered until reconnection" [42].
  - **Binary payloads** are supported [42].
  - **Connection state recovery:** restores "the `id`, the rooms and the `data` attribute" plus missed packets, within `maxDisconnectionDuration`. Its limits:
    - The docs warn "the recovery will not always be successful".
    - It works with the in-memory, Redis Streams and MongoDB adapters, but not Redis pub/sub [40].
    - With the in-memory adapter it can't survive a process restart, because the saved state lives in process memory (inference). That matters on Render Free [5].
  - **Volatile events:** "will not be sent if the underlying connection is not ready (a bit like UDP, in terms of reliability)". The docs suggest them for "the position of the characters in an online game" [42]. **They are still TCP.** Volatile only avoids building a backlog while the connection isn't writable; it does nothing about head-of-line blocking (inference from [42][44]).
- **Parser:**
  - The default parser sends "packets with binary content … as two distinct WebSocket frames".
  - `socket.io-msgpack-parser` sends them "as one single WebSocket frame" and "may result in smaller payloads (especially when using a lot of numbers)". The downside: it is "harder to debug in the Network tab" [41].
  - **For a binary game protocol, use msgpack.**
- **Overhead compared with raw `ws` (inference):**
  - Socket.IO adds its own protocol layer: Engine.IO and Socket.IO packet types, an event name on each message, and heartbeats.
  - It also ties the client to the Socket.IO client library.
  - With msgpack and one short event name for snapshots, the extra bytes per message are small next to a ~1 KB snapshot (§1.2).
- **Is it sensible for a 30 Hz binary game protocol?** **Workable, but not the leanest choice.** It earns its place through reconnection, acks and rooms. A minimal raw WebSocket protocol is leaner (another advocate covers that). It runs over TCP, so it inherits the head-of-line blocking in §1.
- **Render fit:** excellent.
  - "Render web services can accept inbound WebSocket connections" and "Render does not enforce a maximum duration for WebSocket connections" [4].
  - Connections still drop when the instance is replaced: on deploys and maintenance, Render sends SIGTERM with a 30 s grace period, extendable to 300 s [4].
  - "Clients are not guaranteed to reconnect to the same instance after a disruption" [4].

---

## 5. Hybrid: WebSocket now, an optional unreliable lane later

The aim is to make a later move (most likely to WebTransport datagrams) a **change of transport adapter, not a netcode rewrite**. In prose:

1. **Layers.** Split the stack into five layers:
   - **Netcode:** ticks, snapshots, inputs, acks, interpolation and reconciliation.
   - **Session:** identity, a resume token, and full-state resync.
   - **Lanes:** the message channels described in point 2.
   - **Transport adapter:** WebSocket today; WebTransport or WebRTC later.
   - **Codec:** binary schema and quantization, independent of transport.

   Game code only ever talks to the netcode and session layers. If Socket.IO, Colyseus or `ws` is chosen, it sits inside the adapter, and its events or rooms don't leak into game code.
2. **Two lanes with explicit meanings.**
   - **Reliable-Ordered:** join and leave, room and lobby events, RPCs and acks, chat, dust-field changes.
   - **Latest-Wins:** snapshots, inputs, and short-lived effects. Every Latest-Wins message carries a sequence number and tick, and the receiver throws away anything older than the newest it has seen.

   How the lanes map onto each transport:
   - **WebSocket:** both lanes share one TCP stream, tagged by a lane byte.
   - **WebTransport:** Latest-Wins uses datagrams; Reliable-Ordered uses one bidirectional stream [32].
   - **WebRTC:** two data channels, one unordered with zero retransmits and one ordered and reliable [22]. geckos.io doesn't provide the second channel today [17], so this would mean using `node-datachannel` directly or accepting geckos.io's resend-based reliability.
3. **Write the netcode as if packets get lost.**
   - Acknowledge snapshots at the application level.
   - Delta-encode snapshots against the **last snapshot the client acknowledged**, not the last one sent.
   - Send the last N inputs in every input message.
   - Never assume Latest-Wins messages arrive in order.

   Over TCP this costs a few bytes. Over UDP it is essential, and it's what lets the swap be cheap.
4. **Keep messages small and self-contained.** Each Latest-Wins message should decode on its own and fit in one datagram. Split large snapshots by entity group. A cap of about 1,100–1,200 bytes is my rule of thumb. Fly's UDP docs warn "Don't assume a particular MTU for UDP" [23]. libdatachannel exposes `mtu` and `maxMessageSize` settings [22].
5. **Handle backpressure in the adapter.** When the TCP send buffer is backed up, a Latest-Wins message should be dropped rather than queued, since stale snapshots only add latency. Socket.IO's volatile emit does the same when the connection isn't ready [42]. The Reliable-Ordered lane never drops anything.
6. **Measure in the netcode, not the transport.** Use one connection lifecycle everywhere (connecting, open, closed with a reason). Compute RTT, jitter and loss from the application's own pings and acks, so the numbers mean the same thing on every transport.
7. **Choose the transport at runtime.** The Vercel client reads the server's endpoints from configuration. It checks whether the browser supports WebTransport (support is broad as of Safari 26.4 [30]) and falls back to WebSocket. The server can offer both during a migration.
8. **Make the session layer transport-independent.** Reconnect with a resume token, then do a full-state resync. Render requires this anyway: connections drop on instance replacement [4] and Free instances restart and spin down [5].
9. **Build a test harness that simulates loss.**
   - An in-memory loopback transport with seeded latency, jitter, loss, reordering and duplication, for deterministic tests in CI. AI agents are well suited to writing these.
   - A debug "lossy WebSocket" mode that randomly drops Latest-Wins messages at the application layer. This exercises loss handling in a production-like setup long before any UDP exists.

---

## 6. Self-scored table

Scale: 1 = poor and 5 = excellent, **for our Render-based, $0, solo-developer plan**.

| Criterion | geckos.io (WebRTC) | WebTransport | Socket.IO |
|---|---|---|---|
| **Reliability under loss, latency and reconnects** | **3**. No head-of-line blocking for snapshots (unordered, zero retransmits by default) [13]. But reliability means resending 10 times on a single channel [13][17], and ICE/NAT setup failures are known [16]. | **4**. Unreliable datagrams and reliable streams in one connection [32]. The app must build its own reconnection (inference). | **3**. TCP head-of-line blocking [44]. Strong reconnection: buffering, acks with timeouts, state recovery [40][42]. Recovery "will not always be successful" and the in-memory version won't survive a restart [40] (inference). |
| **Fit for prediction and reconciliation** | **4**. Latest-wins delivery and raw binary messages [13]. Acks and deltas are ours to build; the reliable lane is weak [17]. | **5**. Datagrams for inputs and snapshots plus a reliable stream for dust and control, all in one connection [32]. | **3**. Workable. Volatile emits avoid a backlog while disconnected [42], but ordering is still TCP's. |
| **Bandwidth efficiency** | **4**. Raw ArrayBuffer messages [13]; no stale bursts. Header overhead similar to WebSocket (estimate). | **4**. Compact datagrams. Packets must fit the path MTU [23] (inference). | **3**. The default parser splits binary into two frames; msgpack uses one frame and smaller payloads [41]. Event names and heartbeats add a little (inference). |
| **Hosting fit on Render** | **1**. Needs inbound UDP; Render forwards one HTTP port only [1][2][7][13]. | **1**. Needs UDP/QUIC to the server; HTTP/3 isn't available to the origin [1][10][11]. | **5**. Inbound WebSockets with no maximum duration [4]; long-polling fallback [39]. |
| **Features** | **2**. Rooms, events, raw messages, resend-based "reliable" [13][14]. No session recovery. | **2**. A low-level building block [32]; rooms, acks and sessions are all ours to build. | **5**. Rooms, acks with timeouts, buffering, volatile events, state recovery, binary, msgpack [40][41][42]. |
| **Testing tooling** | **2**. Native module; realistic tests need real ICE and UDP; known Docker problems [16][21]. | **2**. Native libquiche addon (node >= 20) or an experimental custom Node build; certificates required [34][36][39]. | **4**. Pure-JavaScript dependencies [43]; easy to run in-process in tests (inference). Can't simulate loss, like any TCP transport. |
| **Solo-dev simplicity and agent familiarity** | **2**. Ports, STUN/TURN and NAT to manage; small community (about 1.5k stars) [12][13]. | **1**. Immature Node server path, certificate handling, QUIC hosting caveats [23][34][36][39]. | **5**. High-level API, widely documented, mature 4.x line [43] (familiarity is inference). |
| **Maintenance, license and community** | **2**. BSD-3-Clause. About one release a year; native dependency pinned behind current; stale issues [14][15][20][21]. | **3**. A W3C/IETF standard shipped in all major browser engines [30]. The Node libraries are thin: one native library and an experimental core module [34][36][37]. | **4**. MIT. 4.8.4 released 2026-09-25, though releases have slowed (4.8.1 in October 2024, then 4.8.2 in December 2025) [43]. |
| **Total (max 40)** | **20** | **22** | **32** |

**How to read this:** treat "Hosting fit on Render" as a pass/fail gate. A score of 1 there rules an option out of the current plan whatever its total.

---

## 7. Feasibility verdict for our Render-based plan, and honest weaknesses

### Verdict

| Option | On Render (Free, or any plan) | Why |
|---|---|---|
| geckos.io / WebRTC data channels | **Infeasible** | Browsers can't reach the server over UDP. Render forwards public traffic to one HTTP port only. Private services aren't public. The UDP request has been open since 2019 [1][2][7]. |
| WebTransport (HTTP/3, QUIC) | **Infeasible** | No QUIC or UDP to the server. Cloudflare doesn't carry HTTP/3 to the origin. Proxied traffic doesn't support WebTransport [1][6][10][11]. |
| Socket.IO (over WebSocket) | **Feasible** | Render supports inbound WebSockets, and Socket.IO falls back to long-polling [4][39]. |

**My recommendation, as the advocate for unreliable transports:**

- **Don't plan around UDP while we're on Render.**
- **Pick a WebSocket-based stack now.** Socket.IO is acceptable. Raw `ws` and Colyseus are being assessed by the other advocates.
- **Build the two-lane, loss-tolerant netcode from §5,** so that adding WebTransport datagrams later is a contained change.

**What would change this verdict:**

- Render ships public UDP or QUIC. The feature request to watch is [7].
- The budget rises above $0. Then the cheapest experiment is about $4.19/month on Fly.io: the smallest machine at $2.19 plus a dedicated IPv4 at $2.00, plus egress [24]. Run a spike there with WebTransport first and geckos.io second, bearing in mind Fly's QUIC caveat [23].

### Weaknesses of the unreliable-transport case

1. **It doesn't run on our chosen host.** That decides it for the current plan [1][2].
2. **The benefit is modest for a co-op game.** Under loss it smooths remote motion and avoids input bursts. Interpolation and input buffering recover much of that over TCP (§1.3).
3. **The server side is immature.** `node:quic` is early development [34]. `@fails-components/webtransport` is a native addon from a small project [36][37]. geckos.io is maintained by about one person, pins an older native dependency, and has Docker/ICE problems plus a single-channel reliability workaround [14][16][17][20][21].
4. **It is more work to operate:** TLS certificates for WebTransport [39], UDP ports and STUN/TURN for WebRTC [13], and NAT traversal. All of these are harder for a solo developer and AI agents to debug (inference).
5. **The dust field needs reliable delivery anyway,** so UDP would need extra state-sync code to be worthwhile (inference).
6. **On Render Free, platform behavior dominates.** Restarts "at any time", spin-down after 15 idle minutes, about 1-minute cold starts, and "Do not use them for production applications" [5]. Reconnect and resync are worth more effort than the transport.

### Weaknesses of Socket.IO, for balance

- It carries TCP head-of-line blocking [44].
- Both client and server are tied to the Socket.IO protocol and libraries (inference from [39][41]).
- Connection state recovery helps with brief blips, not process restarts [40].
- The default parser is a poor fit for binary data until msgpack is configured [41].
- Releases have slowed [43].

---

## Sources

All accessed 2026-11-11. "(via search index)" means the page blocked or failed direct fetching, and its content was read through the web-search tool's index.

1. Render Docs — Web Services — https://render.com/docs/web-services — accessed 2026-11-11
2. Render Docs — Private Services — https://render.com/docs/private-services — accessed 2026-11-11
3. Render Docs — Private Network — https://render.com/docs/private-network — accessed 2026-11-11
4. Render Docs — WebSockets on Render — https://render.com/docs/websocket — accessed 2026-11-11
5. Render Docs — Deploy for Free (Free instance limits) — https://render.com/docs/free — accessed 2026-11-11
6. Render Docs — DDoS Protection — https://render.com/docs/ddos-protection — accessed 2026-11-11
7. Render Feedback — "Allow connecting to non-HTTP services from outside Render" (merged "Support UDP") — https://feedback.render.com/features/p/support-udp — accessed 2026-11-11
8. Render Community — "Webrtc/udp server possible (the render.com server will be the central peer)?" — https://render.discourse.group/t/webrtc-udp-server-possible-the-render-com-server-will-be-the-central-peer/4109 — accessed 2026-11-11 (via search index; direct fetch failed DNS resolution)
9. Render Community — "WebTransport support" — https://community.render.com/t/webtransport-support/36585 — accessed 2026-11-11 (via search index; the direct fetch redirected to a host that could not be resolved)
10. Cloudflare Docs — HTTP/3 (with QUIC) — https://developers.cloudflare.com/speed/optimization/protocol/http3/ — accessed 2026-11-11
11. Cloudflare Community — "Is WebTransport supported by CloudFlare?" — https://community.cloudflare.com/t/is-webtransport-supported-by-cloudflare/587646 — accessed 2026-11-11 (via search index; direct fetch returned 403)
12. GitHub — geckosio/geckos.io (repository page) — https://github.com/geckosio/geckos.io — accessed 2026-11-11
13. geckos.io README (master branch) — https://raw.githubusercontent.com/geckosio/geckos.io/master/README.md — accessed 2026-11-11
14. GitHub — geckos.io commit history (master) — https://github.com/geckosio/geckos.io/commits/master — accessed 2026-11-11
15. GitHub — geckos.io open issues — https://github.com/geckosio/geckos.io/issues — accessed 2026-11-11
16. GitHub — geckos.io issue #245, "Datachannel connection failing when server running in docker" — https://github.com/geckosio/geckos.io/issues/245 — accessed 2026-11-11
17. GitHub — geckos.io issue #269, "Separate (underlying) datachannels for unreliable and reliable messages" — https://github.com/geckosio/geckos.io/issues/269 — accessed 2026-11-11
18. geckos.io source — packages/server/src/wrtc/connectionsManager.ts — https://raw.githubusercontent.com/geckosio/geckos.io/master/packages/server/src/wrtc/connectionsManager.ts — accessed 2026-11-11
19. geckos.io source — packages/server/src/geckos/server.ts — https://raw.githubusercontent.com/geckosio/geckos.io/master/packages/server/src/geckos/server.ts — accessed 2026-11-11
20. npm registry — @geckos.io/server (metadata, publish times, latest) — https://registry.npmjs.org/@geckos.io/server — accessed 2026-11-11
21. npm registry — node-datachannel (latest) — https://registry.npmjs.org/node-datachannel/latest — accessed 2026-11-11
22. libdatachannel — DOC.md (rtcConfiguration and data channel reliability) — https://raw.githubusercontent.com/paullouisageneau/libdatachannel/master/DOC.md — accessed 2026-11-11
23. Fly Docs — Running apps on UDP and TCP — https://docs.fly.io/networking/udp-and-tcp — accessed 2026-11-11
24. Fly.io — Pricing — https://fly.io/pricing/ — accessed 2026-11-11
25. Fly.io Community — "Running LiveKit (livekit-server + livekit-sip) on Fly: the fly-global-services UDP bind requirement, and a specific fix" — https://community.fly.io/t/running-livekit-livekit-server-livekit-sip-on-fly-the-fly-global-services-udp-bind-requirement-and-a-specific-fix/28316 — accessed 2026-11-11 (via search index)
26. Cloudflare Docs — Realtime TURN FAQ — https://developers.cloudflare.com/realtime/turn/faq/ — accessed 2026-11-11
27. Edgegap — Pricing — https://edgegap.com/resources/pricing — accessed 2026-11-11
28. Edgegap Docs — Mirror WebGL (WebSocket ports for browser builds) — https://docs.edgegap.com/docs/sample-projects/unity-netcodes/mirror-on-edgegap-websocket — accessed 2026-11-11 (via search index)
29. Game Developer — "Stormgate rushing offline mode after losing server access to an AI company" (2026-04-02) — https://www.gamedeveloper.com/business/stormgate-rushing-offline-mode-after-losing-server-access-to-an-ai-company — accessed 2026-11-11
30. Can I use — WebTransport — https://caniuse.com/webtransport — accessed 2026-11-11
31. WebKit Blog — "WebKit Features for Safari 26.4" — https://webkit.org/blog/17862/webkit-features-for-safari-26-4/ — accessed 2026-11-11 (via search index)
32. MDN Web Docs — WebTransport API — https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API — accessed 2026-11-11 (via search index)
33. IETF Datatracker — draft-ietf-webtrans-http3-15 (WebTransport over HTTP/3) — https://datatracker.ietf.org/doc/html/draft-ietf-webtrans-http3-15 — accessed 2026-11-11 (via search index)
34. Node.js — doc/api/quic.md (node:quic, stability "1.0 - Early development") — https://github.com/nodejs/node/blob/main/doc/api/quic.md — accessed 2026-11-11 (via search index)
35. Node.js Blog — "Node.js Interactive 2026: A Recap" — https://nodejs.org/en/blog/events/nodejs-interactive-2026 — accessed 2026-11-11 (via search index)
36. npm registry — @fails-components/webtransport (latest) — https://registry.npmjs.org/@fails-components/webtransport/latest — accessed 2026-11-11
37. GitHub — fails-components/webtransport — https://github.com/fails-components/webtransport — accessed 2026-11-11 (via search index)
38. quic-go Docs — WebTransport — https://quic-go.net/docs/webtransport/ — accessed 2026-11-11 (via search index)
39. Socket.IO — "Socket.IO with WebTransport" — https://socket.io/get-started/webtransport — accessed 2026-11-11
40. Socket.IO Docs (v4) — Connection state recovery — https://socket.io/docs/v4/connection-state-recovery — accessed 2026-11-11
41. Socket.IO Docs (v4) — Custom parser — https://socket.io/docs/v4/custom-parser/ — accessed 2026-11-11
42. Socket.IO Docs (v4) — Emitting events (volatile events, acknowledgements, timeouts) — https://socket.io/docs/v4/emitting-events/ — accessed 2026-11-11
43. npm registry — socket.io (metadata, publish times, latest) — https://registry.npmjs.org/socket.io — accessed 2026-11-11
44. Gaffer On Games — Glenn Fiedler, "UDP vs. TCP" (2008-10-01) — https://gafferongames.com/post/udp_vs_tcp/ — accessed 2026-11-11
45. Valve Developer Community — Source Multiplayer Networking — https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking — accessed 2026-11-11 (via search index; direct fetch returned 403)
