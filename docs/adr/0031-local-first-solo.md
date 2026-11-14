# ADR-0031: Local-first Solo Shift (sim in a Web Worker), server for auth, saves and multiplayer rooms

- **Status:** Accepted, owner decision 2026-11-13 (CLAUDE.md "Product priority: SOLO PLAY FIRST").
- **Amends:** [ADR-0025](0025-netcode-model-revision.md) (and historical [ADR-0015](0015-netcode-model-authority-rates.md)) **for Solo Shifts only**. ADR-0025 stays authoritative for every server room (Private/Open Shifts and a Solo Shift opened to friends).
- **Deciders:** Cee (owner); drafted by contracts-architect for the lead.
- **Details:** [netcode.md §19](../architecture/netcode.md#19-solo-local-vs-room-server-adr-0031) (authority per mode), [data-model.md §3.7c](../architecture/data-model.md#37c-solo-checkpoint-upload-and-verify-adr-0031) (upload/verify, save generation), [system-overview.md §4.1](../architecture/system-overview.md#41-solo-session-local-first-adr-0031), [module-boundaries.md §3](../architecture/module-boundaries.md#3-file-ownership-map) (`apps/client/src/sim-host/**`). Contract proposal: [M0-adr-0031-local-first.md](../agent-reports/M0-adr-0031-local-first.md).

## Context

Solo play is the product priority: tools, cleaning, vehicles and robots must respond instantly and never lag. Under ADR-0025 every Solo Shift is a server room on the one Render Free instance (0.1 CPU, sleeps after 15 min, ≈1 min wake), so solo feel depends on RTT, cold starts and `MAX_ROOMS`. `packages/sim` and `packages/world` are already environment-agnostic (module-boundaries rule 3) and were planned to run in a Worker in v1.0.

## Options considered

1. **Server-authoritative + client prediction (ADR-0025 as is).** Own avatar is predicted, but dust results, robots, purchases and Dust Cells wait one RTT; Render cold start blocks Clock In; solo rooms consume `MAX_ROOMS`. Rejected for solo.
2. **Local-first solo (chosen).** The browser runs the authoritative sim for Solo; the server stores and sanity-checks checkpoints and hosts multiplayer rooms.
3. **Hybrid lockstep (local sim, server replays inputs to confirm).** Full server CPU cost per solo player on 0.1 CPU and a network dependency again. Rejected.
(Sim on the main thread was rejected for GC/save-encode stall isolation; it remains a test/debug fallback `?simhost=main`.)

## Decision

- **Solo Shift:** the deterministic `RoomSim` (`packages/sim` + `packages/world`) runs in a dedicated module Web Worker (`apps/client/src/sim-host`, `LocalRoom`). Inputs and intents go to the worker over a `MessagePort`; no WebSocket and no request sits on the input → sim → render path. The main thread keeps the same own-avatar/vehicle/tool-head prediction path as multiplayer (`packages/sim` reconciler), so the first visual response lands in the next rendered frame; acks arrive within the same frame, so corrections are effectively zero.
- **Server (Render) roles:** (a) guest auth; (b) persistence: periodic solo checkpoint uploads into the existing save tables, resume/restore on any device; (c) light verification of uploads (auth/ownership, format and version, CRC, size and rate limits, plausibility flags). It does not replay or trust solo state for correctness. It protects the DB and shared surfaces (profiles, achievements, any future leaderboard). (d) Authoritative Colyseus rooms for multiplayer (≤ 6 players), unchanged.
- **Open to friends:** the client writes a final local checkpoint and uploads it (must be accepted). The Holder switches `shiftType` and joins via REST; the server room loads that save and becomes authoritative, and the worker is suspended. "Return to solo" ends the shared shift: final room checkpoint, dispose, then the client downloads the newest save and resumes locally.
- **Offline / server asleep:** solo starts and plays from the local sim and IndexedDB. Checkpoints queue locally (latest per Contract only), and the waking screen appears only for multiplayer, restore on a new device or explicit sync. A new Solo Contract may be created locally (client UUIDv7 + seed) and is registered on first sync (quota ≤ 3 checked then). The Vercel page itself must load (no PWA cache in scope).
- **Rates:** the worker uses fixed steps at `SIM_TICK_HZ` (20, or the supported 30). Solo is not bound by the network budget, so the lead may pick 30 after the M1 latency measurement. Saves are tick-rate-agnostic.

## Consequences

- Solo uses no server room, so `MAX_ROOMS`/admission apply to multiplayer only; Render egress and CPU for solo become a few small uploads (default every 120 s when dirty, plus pause/Clock Out).
- Pure room logic now planned in `apps/server/src/{sim,world}` (dust authority, fixed-order ledger sequencing, chunk serialization, input rules, interest sets) must live in `packages/sim`/`packages/world`; server dirs keep only adapters (Colyseus, interest wiring, persistence). Save envelope encode/decode + CRC32 become pure code reused by both hosts.
- One client gameplay path, two hosts: a `RoomHost` contract with `LocalRoomHost` and `RemoteRoomHost` variants. Frames use the `packages/protocol` FRAME layout in both modes (one decode path, shared golden vectors).

## Risks and rules

- **Two sim hosts must stay byte-identical:** one deterministic package set and golden-hash tests over ≥ 10,000 ticks on Node and in a browser **Worker** (Chromium in CI; Firefox/WebKit when available). State-affecting code avoids engine-dependent `Math.*` transcendentals (own deterministic helpers) and wall-clock/random sources other than the seeded PRNG.
- **Save format/versioning:** the header gains `generation`, `parentGeneration`, `originKind`, `originId`, folded into the planned `SAVE_FORMAT_VERSION = 1` (no prod saves exist yet). Older formats are upgraded on load; a server never accepts a format newer than its own.
- **Anti-cheat stance:** cheating in your own solo game is acceptable. The server rejects malformed/oversized/too-frequent uploads, flags implausible progress (`abuse_events`), and bounds per-upload profile/achievement deltas so shared surfaces and the 1 GB DB stay safe.
- **Conflicts (local vs server copy):** last writer by monotonic save generation. An upload carries `baseGeneration` (last server generation this device saw) and is accepted only if it equals the server's newest (fast-forward); otherwise it gets `409 SAVE_CONFLICT`. A copy that strictly descends from the other wins silently. A real divergence shows an explicit **"Which copy?"** prompt (playtime, Shine %, wallet, saved-at, device). Nothing is overwritten silently, and the losing copy is kept locally as a backup. One tab per Contract via the Web Locks API.
- **Render-thread budget:** the worker runs the fixed-step accumulator. Snapshots travel as transferable `ArrayBuffer`s from a fixed pool of 3 (double-buffer ping-pong, returned after decode; no `SharedArrayBuffer`, so no COOP/COEP). Inputs are written into pooled buffers. Steady-state allocation per frame is zero on both threads. Checkpoint encode/gzip (`CompressionStream`) and IndexedDB writes happen in the worker, sliced ≤ 2 ms per tick. Main-thread host cost ≤ 0.3 ms/frame.
- **Storage eviction** (Safari ITP 7-day, quota): call `navigator.storage.persist()`, sync to the server when reachable, and warn in the UI on quota errors.

## Revisit trigger

Golden-hash divergence between worker and Node that cannot be fixed in `packages/sim`; solo input-to-visual > 1 frame budget on UHD 620 after tuning; solo upload volume threatening the 1 GB DB.
