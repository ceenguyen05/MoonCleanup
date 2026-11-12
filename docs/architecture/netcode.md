# Netcode — Clean The Moon!

> **Current execution correction (2026-11-12):** [ADR-0029](../adr/0029-single-deploy-branch-main.md) governs deployment: `main` only, Vercel production + one Render service.
> Use local/test fixtures and read-only live checks; hosted load tests need an explicitly approved isolated safe fixture.
> [MODEL_POLICY](../handoff/MODEL_POLICY.md) governs model/reading/review overhead; technical acceptance criteria remain.


Status: **Planning baseline (2026-11-12, revised after the principal-engineer review)** · Owner: netcode-engineer (`packages/protocol`, `apps/*/src/net`) · Contracts: `packages/shared/src/protocol/*`, `sim/input.ts`, `world/stroke.ts` (contracts-architect).
Canonical: [tech-stack.md §3](tech-stack.md) (Colyseus 0.18 + uWS + custom bytes, Schema without StateView), [module-boundaries.md](module-boundaries.md), [ADR-0025](../adr/0025-netcode-model-revision.md) (supersedes ADR-0015). **Dust semantics** (chunking, plot ids, stroke records, ledger, robots, dust interest radii, echo/reconcile, drift check, join-snapshot contents) are canonical in [world-and-dust-simulation.md](world-and-dust-simulation.md) ("WDS"); this doc only frames them on the wire and never restates their numbers.
Evidence: [netcode-case-colyseus.md](../research/tech/netcode-case-colyseus.md), [netcode-case-raw-websocket.md](../research/tech/netcode-case-raw-websocket.md), [terrain-and-dust-techniques.md §7](../research/tech/terrain-and-dust-techniques.md), [platform-limits.md](../research/tech/platform-limits.md).

## 1. Principles

| # | Rule |
| --- | --- |
| N1 | Server is authoritative for everything. Clients send **intents** (inputs, purchase/build requests), never positions, strokes or amounts. |
| N2 | `RoomSim` (`packages/sim`) is pure TypeScript with no Colyseus, DOM or Node imports. The Colyseus `Room` in `apps/server/src/net` is a thin adapter. The same `RoomSim` runs in the client for prediction and (v1.0) in a Web Worker for offline Solo. |
| N3 | Two channels over one WebSocket: **Schema** (Colyseus `@colyseus/schema` 5.x, encode-once, no `.view()`/StateView) for low-rate shared state; **bytes** (`sendBytes`/`onMessageBytes`, our codec in `packages/protocol`) for everything per-client or high-rate. Colyseus typed messages (msgpack) for rare control requests. |
| N4 | Default free-tier rates: `SIM_TICK_HZ=20`, `SNAPSHOT_HZ=10`. Supported alternative: **30 / 15** (paid instance only). `SNAPSHOT_HZ` must divide `SIM_TICK_HZ` (boot refuses otherwise). All rates and cadences derive from these two env vars; nothing hard-codes 20, 10 or "every 2 ticks". |
| N5 | TCP is reliable and ordered: deltas are against **what this client was last sent**, no ack round-trip for state. Only inputs are acked (for reconciliation). |
| N6 | We do **not** use Colyseus' built-in `Predict`/`defineInput` module (coupled to Schema and Colyseus types). The **reconciler** (input ring, replay, correction smoothing) lives in `packages/sim` (gameplay-systems-engineer) and is shared by the client and `tools/bots`. `packages/protocol` only encodes and decodes (plus the pure interpolation buffer); `apps/client/src/net` wires codec, reconciler and transport together ([module-boundaries.md §1/§3](module-boundaries.md)). |
| N7 | `permessage-deflate` is **off** (CPU/memory on 0.1 CPU). Large payloads (dust snapshot, ledgers, structures) are deflate-compressed **once** and cached. |
| N8 | Server → client bytes messages ≤ 4,096 B each (bigger payloads are sliced); client → server messages ≤ 2,048 B (uWS `maxPayloadLength` lowered from its 4,096 default, [security.md §5](security.md#5-rate-limiting)). |
| N9 | One live room per Contract, enforced by an in-process registry plus a compare-and-set DB lease (§9.3); clients never call `joinOrCreate`. |

## 2. Channels and encoding

| Channel | Transport | Encoding | Used for | Validation |
| --- | --- | --- | --- | --- |
| `schema` | Colyseus state patches; **automatic patching disabled**, the fixed-step driver calls `broadcastPatch()` on frame ticks (§3) | Schema 5 binary, encode once for all clients | `ShiftState` (§4.4): wallet, shared upgrades, roster, beacons, permissions | Server-only writes |
| `bytes` | `sendBytes` / `onMessageBytes` | Little-endian; 1-byte message type; bit-packed sections, **byte-aligned at record boundaries** | Inputs, `FRAME` (entities + dust sections + events), dust bulk messages (WDS §5.1), structures, markers, ping | Exact length/bounds checks in the decoder; unknown type → drop + violation counter |
| `control` | Colyseus `room.send(type, obj)` | msgpack (Colyseus default) | Purchases, building, roles, kicks/bans, quick chat, notices, visibility | zod schema per message type at the room edge |

Quantization constants (in `packages/shared/src/protocol/channels.ts`; moon radius **R = 2,000 m** is canonical per WDS §0; ranges include relief and the flight ceiling):

| Quantity | Encoding | Resolution / range |
| --- | --- | --- |
| World position (others) | 3 × 20-bit signed, moon-centred frame | 6.25 mm, ±3,276.8 m |
| World position (own, for reconciliation) | 3 × 24-bit signed | 0.49 mm, ±4,096 m |
| Position delta | 2-bit size class per axis: 0 = unchanged, 1 = 8-bit (±0.79 m), 2 = 13-bit (±25.6 m), 3 = absolute 20-bit | 6.25 mm |
| Velocity (own) | 3 × 16-bit signed | 1/256 m/s, ±128 m/s |
| Avatar yaw (about local up) | 10-bit | 0.35° |
| Look/tool pitch | 6-bit | 2.9° over ±90° |
| Vehicle orientation | smallest-three quaternion: 2-bit index + 3 × 10-bit | ≈ 0.1° |
| Vehicle orientation (own, reconciliation) | 2 + 3 × 15-bit | ≈ 0.003° |
| Plot ID, chunk ID, plot-local coordinates, stroke fields, dust remaining | **As defined in WDS §2.3–§2.7, §4.4, §5.1** (PlotId 18 b, chunkId 0–640, int16 mm in the 25.6 m plot frame) | — |
| Tick | u32 | 20 Hz → 6.8 years |

Server rule: at the end of every tick the server **quantizes the state of predicted entities (own avatar, driven vehicle) to the wire precision**, so client replays start from bit-identical state.

## 3. Tick loop (server)

Driver: `apps/server/src/sim` (gameplay-systems-engineer). One drift-compensated fixed-step accumulator per process, stepping every room in turn; `dt = 1 / SIM_TICK_HZ` (50 ms default). At most 3 catch-up steps per wake; beyond that the room's clock is slipped and `tick_overrun` is counted. Let F = `SIM_TICK_HZ / SNAPSHOT_HZ` (2 at defaults).

| Step | Every | What happens |
| --- | --- | --- |
| 1 Drain inputs | tick | Per client, consume inputs by the **sequencing rules of §5.1**: exactly one sequence number per tick (two if the backlog > 4); a missing input is substituted and its sequence number is consumed; late inputs with `seq ≤ lastConsumedSeq` are dropped, so no input is ever applied twice. Record `lastConsumedSeq` and the remaining buffer depth. |
| 2 Control requests | tick | Apply queued purchase/build/teleport/role requests in arrival order (validated, §11) |
| 3 `RoomSim.step(dt)` | tick | Avatars, vehicles (kinematic raycast suspension), tool strokes from **server** tool-head positions, economy, Glide Rails, machines; robots: motion every tick, AI decisions for ¼ of robots per tick (staggered). **Ledger ops of the tick are applied in the fixed order of WDS §4.5a** (players by slot, vehicles, robots) |
| 4 Collect | tick | Accepted strokes and robot chunks, Dust Cell results, changed plots, catalog events |
| 5 Interest | tick | `InterestService` recomputes entity **and** dust sets (§7) for `ceil(clients / (SIM_TICK_HZ/2))` clients per tick → each client every 0.5 s |
| 6 Frames | every F ticks | Encode one `FRAME` per client (§4.2) and `sendBytes`; then call `broadcastPatch()` so the Schema patch leaves in the same event-loop turn. The M0 spike verifies that uWS coalesces both into one socket write per client (the §14 overhead row assumes it) |
| 7 Low-rate | 0.2 Hz / 1 Hz | `DUST_CHECK` (WDS §5.5), `ROSTER_MARKERS` (staggered so they never share a tick) |
| 8 Slices | when in progress | ≤ 1.5 ms CPU per tick for checkpoint serialization/compression, **save decoding on room creation**, and snapshot compression (§9.4) |
| 9 Metrics | tick (cheap counters) | tick ms histogram, bytes out per message type, GC pause observer |

Ack: every `FRAME` header carries `ackInputSeq` = last input sequence consumed for that client, and `inputBufferDepth`.

## 4. Message catalog

The single catalog (type ids, bit layouts, rates, direction) is `packages/shared/src/protocol/messages.ts`, written by contracts-architect as the **first Wave-0 task, before any codec work**. The tables below are its specification.

### 4.1 Client → server

| Name | Channel / type id | Rate | Wire size | Fields (type, quantization) | Validation |
| --- | --- | --- | --- | --- | --- |
| `INPUT` | bytes `0x01` | `SIM_TICK_HZ` while visible; may carry 1–2 inputs if the client fell behind | **10 B** per input (+1 B count) | `seq` u16 (wraps); `moveX`,`moveY` i8 (stick/WASD ×127, server normalises length ≤ 1); `yaw` u16 (camera yaw, 65,536 steps); `pitch` i8 (±90°); `buttons` u16 bitfield: jump, hopPack, lope, toolPrimary, toolSecondary, interact, brake/descend, boost, ballast, lampCycle, holsterNext, holsterPrev, seatSwitch (names per game-feel §9; the Plot Card is UI-only); `toolParam` u8 (aim distance 0–255 → 0–reach) | Exact length 1 + 1 + 10·n (n ≤ 2); `seq` newer than last received (mod 2¹⁶ window 1,024) else dropped as late; token bucket derived from `SIM_TICK_HZ` (§11); NaN impossible (integers) |
| `PING` | bytes `0x02` | every 2 s (also while tab hidden; keeps Render awake while in a room) | 5 B | `clientTimeMs` u32 | Length 5; ≤ 2/s |
| `DUST_REQUEST` | bytes `0x03` | ≤ 1 per 2 s | ≤ 34 B | WDS §5.1 `dust.request` (≤ 8 PlotIds or one chunkId) | Bounds (PlotId < plotCount, chunkId ≤ 640); only plots/chunks inside the client's dust radius |
| `ready` | control | once after the blocking join snapshot is applied | ~20 B | `{}` | zod |
| `visibility` | control | on tab hide/show, ≤ 1/s | ~15 B | `{hidden: boolean}` | zod |
| `dust_interest` | control | on join and on preset change, ≤ 1/5 s | ~20 B | `{residencyRadiusM: 60–220}` (WDS §5.2) | zod, clamped |
| `purchase` | control | on demand | ~60 B | `{requestId: uuid, itemId: string (game-data id), quantity?: 1}` | zod; idempotent by `requestId` (§11) |
| `build_place` | control | on demand | ~70 B | `{requestId, pieceId, plotId (0–163,841), local: [x,y] (cm, snapped), rot: 0–23 (15° steps), finish: enum}` | zod + snap/collision/permission in sim |
| `build_shift` | control | on demand | ~60 B | `{requestId, structureId: u32, local, rot}` | zod + ownership/permission |
| `build_reclaim` | control | on demand | ~40 B | `{requestId, structureId}` | zod + permission |
| `relay_teleport` | control | on demand | ~40 B | `{requestId, outpostId: enum of 4}` | Visited, not in vehicle, near a Relay Pad, fee affordable |
| `beacon_set` | control | ≤ 1/s | ~30 B | `{index: 0–11, plotId \| null}` | Permission |
| `quick_chat` | control | ≤ 1/s burst 3 | ~10 B | `{phraseId: enum}` (no free text in MVP) | Enum |
| `ping_marker` | control | ≤ 1/s | ~20 B | `{plotId, local: [x,y]}` | Bounds |
| `set_permissions` | control | Holder only | ~40 B | `{tempCanBuild, tempCanSpendShared, tempCanDriveShared}` booleans | Role = `holder` |
| `appoint_role` | control | Holder only | ~50 B | `{playerId: uuid, role: "supervisor" \| "staff"}` | Role = `holder`; target is a member |
| `set_shift_type` | control | Holder only | ~30 B | `{shiftType: "solo" \| "private" \| "open"}` (applies to the live room, §9.3) | Role = `holder`; solo only when alone |
| `kick` / `ban` | control | Holder; Supervisor (kick, 24 h ban) | ~50 B | `{playerId: uuid, reasonCode: enum}` | Role = `holder` or `supervisor`; not self; not the Holder |
| `vote_kick` | control | Staff, only when no Holder or Supervisor is online | ~40 B | `{targetPlayerId, vote: boolean}` | Role = `staff`; target role = `temp` ([security.md §8](security.md#8-abuse-in-open-shifts)) |
| `report_player` | control | ≤ 1 per 60 s | ~60 B | `{playerId, reasonCode: enum}` | zod; writes an audit row |

### 4.2 Server → client (bytes)

| Name | Type id | Rate | Typical size | Contents |
| --- | --- | --- | --- | --- |
| `FRAME` | `0x20` | `SNAPSHOT_HZ` per visible client; 1 Hz Self-only while hidden | 120–600 B (cap 1,000 B) | Header **9 B**: `type` u8, `serverTick` u32, `ackInputSeq` u16, `inputBufferDepth` u8, `flags` u8 (keyframe, hasSlotChanges, hasEntities, hasStrokes, hasRobotIntents, hasDustPlots, hasEvents). Sections in order: **Self** (always; includes Dust Cell grams = `dust.ack`), **SlotChanges**, **Entities**, **DustStrokes** (WDS `dust.strokes`, incl. own-stroke echoes), **RobotIntents** (WDS `robot.plot`), **DustPlots** (WDS `dust.plots`, every `SNAPSHOT_HZ/2`-th frame), **Events** |
| `DUST_SNAPSHOT` | `0x21` | join, hidden-tab return, resync; sliced, ≤ 2 slices per frame | WDS §5.4 | `sliceIndex` u16, `sliceCount` u16, `snapshotVersion` u32, deflate payload per WDS §5.4 |
| `DUST_LEDGER` | `0x22` | on dust-radius entry, on `DUST_REQUEST` | WDS §5.1 | One plot's ledger, deflated |
| `DUST_LOG` | `0x23` | within 60 m on entry, on `DUST_REQUEST` | WDS §5.1 | One plot's stroke log as chains |
| `DUST_CHECK` | `0x24` | 0.2 Hz; detail mode on request | WDS §5.1/§5.5 | Chunk hashes, or per-plot hashes of one chunk |
| `STRUCTURES_CHUNK` | `0x25` | on chunk entering structure range (§7), then events | 0.1–4 KB | deflate of structure records `{structureId u32, pieceId u16, plotId 18 b, local 2×12 b (cm in the plot frame), rot 5 b, finish 3 b, ownerSlot 5 b}` |
| `ROSTER_MARKERS` | `0x26` | 1 Hz | 10–200 B | Players and robots **outside** entity interest: `slot` u8 + `plotId` 18 b (Survey Globe markers) |
| `PONG` | `0x27` | reply to `PING` | 9 B | `clientTimeMs` u32, `serverTick` u32 |

`FRAME` sections:

| Section | Encoding | Size |
| --- | --- | --- |
| Self | own avatar: position 3×24 b, velocity 3×16 b, yaw 10 b, move-state 5 b (grounded, airborne, hopping, seated, anchored…), hop charges 3 b, Dust Cell grams u16 (0.1 kg) ; if driving: vehicle position 3×24 b, orientation 2+3×15 b, linear vel 3×16 b, angular vel 3×16 b, steer i8, gear/boost 4 b | 20 B (on foot) / 52 B (driving) |
| SlotChanges | per-client slot table (0–254 → `entityId` u32 + kind 3 b): assign / release | 6 B per change |
| Entities | `count` u8, then per record: `slot` u8, `recType` 2 b (FULL / DELTA / REMOVE). Unlisted slot = unchanged. FULL on slot assign, after a skipped frame, and as a **staggered keyframe**: slot s is refreshed when `(frameIndex + s) mod (5 × SNAPSHOT_HZ) == 0`, so each slot is keyed every 5 s but never all in one frame. If FULL records would exceed the 1,000 B cap, the excess spills to the next frames (those entities keep interpolating) | see §4.5 |
| DustStrokes, RobotIntents, DustPlots | Bit layouts per WDS §5.1 | WDS §5.3 |
| Events | compact: Glide Rail puck spawn/despawn (`railSegmentId` u16, `spawnTick` offset u8, `kind` 2 b), machine state change (`structureId` u32, state 3 b), structure placed/shifted/reclaimed (record as above), `plot.polished` (PlotId 18 b, creditedSlot 6 b) | 3–14 B each |

### 4.3 Server → client (control messages)

| Name | When | Payload |
| --- | --- | --- |
| `purchase_result` | reply to `purchase` | `{requestId, ok, code?, walletAfter?}` |
| `build_result` | reply to `build_*` | `{requestId, ok, code?, structureId?}` |
| `teleport_result` | reply to `relay_teleport` | `{requestId, ok, code?}` |
| `error` | rejected control message, rate limit | `{code, ref?}` (`RATE_LIMITED`, `FORBIDDEN`, `INVALID`) |
| `shutdown_notice` | SIGTERM drain (§9.3) | `{reason, secondsUntilClose}` |
| `kick_notice` | just before close 4102 / 4103 | `{by: role, reasonCode, until?}` |
| `vote_kick_state` | vote opened / updated / resolved | `{targetPlayerId, yes, needed, endsAt, result?}` |
| `role_changed` | Holder appoints or demotes | `{playerId, role}` (also mirrored in Schema) |
| `shift_type_changed` | Holder changes Solo/Private/Open on the live room | `{shiftType}` |
| `report_ack` | reply to `report_player` | `{ok}` |
| `capacity_notice` | admission control starts refusing new joins (§15) | `{reason: "at_capacity"}` |

### 4.4 Server → client (Schema `ShiftState`, patched on frame ticks)

| Field | Schema type | Notes |
| --- | --- | --- |
| `contractId`, `shiftType` | string, string enum | `shiftType` changes in place via `set_shift_type` |
| `protocolVersion`, `simTickHz`, `snapshotHz` | uint16, uint8, uint8 | Static after create |
| `walletLumens` | number (float64) | Shared shift wallet |
| `shinePolished`, `plotCount` | uint32, uint32 | Shine Index = ratio |
| `sharedUpgrades` | MapSchema<uint8> (Promotions Board node id → level) | Shared |
| `suitGear` | MapSchema<uint8> (Holster Rig, Hop Pack, Ballast Soles, Crown Lamp, Lowlight Visor, Dust Cell lines) | Shared |
| `visitedOutposts` | uint8 bitmask | Relay Pad eligibility |
| `beacons` | ArraySchema<Beacon{plotId uint32, active boolean}> (12) | Flare Beacons |
| `players` | MapSchema<PlayerInfo> by sessionId | `playerId`, `displayName`, `slot` (0–15), **`role` (`holder` \| `supervisor` \| `staff` \| `temp`, [GDD §7.5](../design/GDD.md))**, `tenureLevel`, `equippedCosmetics` (string ids), `connected`, `afk`, `hidden`, `toolsOwned` (uint8 bitmask), `equippedTool` (uint8), `vehicleIds` (owned) |
| `vehicles` | MapSchema<VehicleInfo> | `type`, `ownerPlayerId`, `upgrades` (MapSchema<uint8>), `occupied` |
| `robotCounts` | MapSchema<uint16> (type → count) | Detailed robot positions go through bytes |
| `permissions` | Permissions{tempCanBuild, tempCanSpendShared, tempCanDriveShared} | Holder-controlled |
| `fulfilled` | boolean | Contract Fulfilled |

Expected Schema traffic: ≤ 200 B/s per client (wallet and cell changes dominate).

### 4.5 Entity record sizes

| Entity | FULL | DELTA (moving, typical) | Rate |
| --- | --- | --- | --- |
| Avatar (other player) | 13 B: pos 60 b, yaw 10 b, pitch 6 b, anim state 6 b, toolId 4 b, flags 6 b (cleaning, hop thrust, lamp, visor, seated, afk) | ≈ 8 B | every frame inside entity interest (§7) |
| Vehicle | 16 B: pos 60 b, orientation 32 b, steer 6 b, speed 8 b, driverSlot 8 b, flags 8 b (lights, boost, intake, hopper level 4 b) | ≈ 11 B | as avatars |
| Robot (Sandpiper, Plover, Albatross) | 10 B: pos 60 b, heading 8 b, state 4 b (9 UI states, naming bible), cargo 3 b | ≈ 6 B | every 2nd frame inside entity interest; markers only beyond |
| Dust Puck on Glide Rail | not streamed: simulated on the client from rail graph + `spawnTick` events | 0 | — |

## 5. Prediction and reconciliation

| Entity | Predicted by | Method | Correction |
| --- | --- | --- | --- |
| Own avatar | Owning client (reconciler in `packages/sim`) | Run the shared avatar step for each local input at `SIM_TICK_HZ`. Keep a ring of the last 64 inputs + predicted states. On `FRAME`: reset to Self state, replay inputs with `seq > ackInputSeq` | Visual offset = old displayed − new predicted; decays exponentially over 150 ms. Snap if error > 2 m or teleport flag (Relay Pad, respawn) |
| Own driven vehicle | Driver's client | Same, using the vehicle step (kinematic raycast suspension, analytic height function) with the Self-vehicle state | Position offset decays over 200 ms; rotation offset slerped over 200 ms; snap if > 4 m or > 30° |
| Passenger seat (Carryall) | Not predicted | Rides the interpolated vehicle | — |
| Own tool strokes | Owning client | Per **WDS §4.4** (two ledger views, echo with `inputSeq`, sweep phase from `inputSeq`) | Dust Cell grams from Self overwrite the predicted gauge (eases over 300 ms) |
| Purchases, building | Not predicted | UI shows pending state until `purchase_result` / `build_result` | — |
| Interact (pour at Assay Counter, enter vehicle, pick up puck) | Predicted animation only | Outcome waits for server | Animation cancels if rejected |

Drift telemetry: client tracks EMA and peak reconciliation error per entity type and reports them in the F3 perf HUD and in Sentry breadcrumbs when error > 0.5 m more than 3× per minute.

### 5.1 Input sequencing and clock steering (never double-apply)

| Rule | Detail |
| --- | --- |
| Buffer | Per client the server holds inputs keyed by `seq` (≤ 16 ahead of `lastConsumedSeq`); duplicates of a buffered seq are dropped |
| One seq per tick | Each tick consumes `expectedSeq = lastConsumedSeq + 1` if buffered. With a backlog > 4 it consumes two seqs as two sim sub-steps (the client also simulated them as two ticks) |
| Substitution consumes the seq | If `expectedSeq` is missing, the server repeats the last input (edge-triggered buttons cleared) **and consumes `expectedSeq`** for up to 3 consecutive ticks. When the real input for a substituted seq arrives later it has `seq ≤ lastConsumedSeq` and is **dropped** (counted as `late_input`, not a violation). An input is therefore applied at most once |
| Starvation | After 3 substitutions the server applies a neutral input **without consuming seqs** until inputs resume (hidden tab, long stall); the next real input is then `expectedSeq` again |
| Client replay | The client replays only `seq > ackInputSeq`; substituted seqs are inside the ack, so the replay starts from server state that already contains the substitution. Error appears only for substituted ticks |
| Clock steering | `inputBufferDepth` in every `FRAME` is the number of inputs left buffered after the tick. The client time-dilates its fixed-step clock by ±2–5 % to keep 1–2 inputs buffered (never skips or repeats a seq), which absorbs clock drift between client and server |
| Test | netsim at 120 ms ± 30 ms with 1 % loss: own-avatar correction p95 < 5 cm on flat ground, visible snaps ≤ 1 per 10 min, zero double-applied inputs (server counter) |

## 6. Interpolation buffer (remote entities)

| Parameter | Value |
| --- | --- |
| Timeline | Server tick time reconstructed from `serverTick` + clock offset (from `PING`/`PONG`, EMA of RTT/2) |
| Target delay | `clamp(1.5 × snapshotInterval + 2 × jitterP95, 150 ms, 250 ms)`; start at 200 ms |
| Adaptation | Playback rate slewed between 0.97× and 1.03× to reach the target; never jumps. Jitter = p95 of frame inter-arrival deviation over the last 64 frames |
| Interpolation | Avatars/robots: linear position, shortest-arc yaw. Vehicles: Hermite using finite-difference velocity, quaternion slerp |
| Underflow | Extrapolate up to 250 ms past the newest frame, then hold. Entity flagged "signal lost" in UI after 1 s |
| Buffer length | 32 frames per entity |

## 7. Interest management (`InterestService`, `apps/server/src/net`)

One service computes **both** the entity sets and the dust sets (WDS §5.2) per client every 0.5 s (staggered) from the client's **focus point** (own avatar, or driven/occupied vehicle). Interest is **horizon-aware**: on a 2 km moon two standing avatars see each other only to ≈ 170 m, so nothing below the horizon is streamed at entity rate.

| Set | Rule | What the client gets |
| --- | --- | --- |
| Entity interest | Target t is in interest when distance d ≤ min(400 m, d_vis(focus, t)), with d_vis = √(2R·h_focus) + √(2R·h_t) + 40 m. h = height above the 30 km low-pass ground at that point (from the bake), floored at 1.5 m; 40 m margin covers crater-rim relief. Hysteresis: leave at +20 m. Two standing players: ≈ 210 m | Avatars, vehicles every frame; robots every 2nd frame |
| Dust | WDS §5.2 (client-declared residency radius + 20 m) | `FRAME` dust sections, ledgers, logs, chunk checks |
| Structure range | Chunks whose bounding cap intersects min(600 m, d_vis with h_t = 30 m tallest structure) | `STRUCTURES_CHUNK` on enter + structure events |
| Everything else | — | `ROSTER_MARKERS` 1 Hz, `DustPlots` (whole moon, 2 Hz), Schema state |
| Hidden tab | Client sent `visibility {hidden: true}` | Only a 1 Hz Self-only `FRAME` + Schema patches + `PONG`. On `hidden: false`: keyframe `FRAME` and a fresh `DUST_SNAPSHOT` (no replay of missed deltas) |

Slot table: per client, ≤ 255 slots; entity kinds capped per client (16 avatars, 32 vehicles, 64 robots nearest-first) and keyframes staggered (§4.2) so a frame never exceeds 1,000 B.

## 8. Dust on the wire

Everything about dust content is in **WDS**: stroke records and chains (§4.4, §5.1), ledger ops and tick sequencing (§4.5, §4.5a), robots as intents (§4.8), interest radii (§5.2), rates (§5.3), join snapshot (§5.4), drift check (§5.5). This doc adds only the framing of §4.2: per-frame dust records are `FRAME` sections; bulk/on-demand records are the `0x21–0x24` messages; the client request is `DUST_REQUEST` (`0x03`). Codecs and golden vectors live in `packages/protocol`; ledger vectors in `packages/world`.

## 9. Join-in-progress, reconnection and restarts

### 9.1 Join snapshot

| Order | Payload | Size (compressed, estimate) | Pacing |
| --- | --- | --- | --- |
| 1 | Schema full state (Colyseus on join) | 2–6 KB | immediate |
| 2 | `FRAME` keyframe (self + entities in interest) | ≤ 1 KB | immediate |
| 3 | `DUST_SNAPSHOT` blocking part (WDS §5.4) | typ. 15–25 KB, worst ≈ 80 KB | ≤ 4 KB slices, ≤ 2 slices per frame |
| — | Client sends `ready` | | Player can move |
| 4 | Streamed ledgers (WDS §5.4) + `STRUCTURES_CHUNK` in structure range | typ. ≈ 10–30 KB, worst ≈ 240 KB | ≤ 8 KB/s shared budget, nearest first |
| — | **Blocking total** | **typ. ≈ 20–35 KB, worst ≈ 90 KB** | |

Entity frames continue at full rate during the stream (slices interleave), so a joiner never stalls others.

### 9.2 Seat hold (network drop)

| Rule | Value |
| --- | --- |
| Seat hold | `allowReconnection(client, SEAT_HOLD_S = 60 s)` on any non-consented close |
| Avatar during hold | Frozen, flagged "signal lost" (hologram flicker); excluded from collision; vehicle stops |
| Client | Colyseus SDK auto-reconnect with backoff 0.5, 1, 2, 4, 8 s… within 60 s; refresh access token first if < 60 s from expiry |
| On success | Server sends keyframe `FRAME`, plus `DUST_SNAPSHOT` only if > 10 s disconnected; otherwise ledgers for plots changed meanwhile inside the dust radius |
| After 60 s | Seat released; profile flushed; player may rejoin normally |
| Duplicate session | Same `playerId` joining the same Contract again kicks the older connection (close 4106) |

### 9.3 One room per Contract, deploy and restart (SIGTERM)

**Joining (N9, M4).** There is one room name, `shift`; the Contract's `shiftType` (solo / private / open) is room state, so `PATCH /v1/contracts/:id` and `set_shift_type` change the live room instead of creating another. Clients never call `joinOrCreate`: public matchmake methods are disabled (`matchMaker.controller.exposedMethods = []`, verify in M0) and `onAuth` also requires a short-lived join ticket issued by REST.

| Step | Rule |
| --- | --- |
| 1 Client | `POST /v1/contracts/:id/join` (Bearer; membership/ban checked) |
| 2 Registry | In-process map `contractId → roomId`. If a room exists: `matchMaker.reserveSeatFor(room)`; full → 4105 `ROOM_FULL`; room draining → 503 `RETRY_LATER` |
| 3 Create | If none: admission control (§15) → lease compare-and-set (below) → `matchMaker.createRoom("shift", {contractId})` → registry entry → reserve seat. The registry entry is inserted before the async save load, so a concurrent join waits on the same room instead of creating a second one |
| 4 Response | Seat reservation + join ticket → client `consumeSeatReservation` → WSS |
| Lease (CAS) | `UPDATE contracts SET lease_instance=$me, lease_room_id=$room, lease_expires_at = now() + interval '35 seconds' WHERE id=$c AND (lease_instance IS NULL OR lease_expires_at < now() OR (lease_instance=$me AND lease_room_id=$room)) RETURNING id` — **DB clock only** (`now()`), never app clocks. 0 rows → 409 `CONTRACT_BUSY` (another instance or room holds it; client retries). Renewal every 10 s uses the same statement keyed by `(lease_instance, lease_room_id)`; a failed renewal stops the room's checkpoints and closes it with 4108 after a final attempt |
| Dispose | Registry entry removed and lease cleared (`WHERE lease_room_id=$room`) after the final checkpoint |

Render sends SIGTERM and allows `maxShutdownDelaySeconds` (30 s; the 300 s maximum is unverified on Free, [platform-limits.md §B4](../research/tech/platform-limits.md)).

```mermaid
sequenceDiagram
  participant R as Render
  participant S as Old instance
  participant N as New instance (deploy only)
  participant D as Aiven PG
  participant C as Client
  R->>S: SIGTERM (t=0)
  S->>S: draining=true (/readyz 503), registry closed, join → 503
  S-->>C: control "shutdown_notice" {reason, secondsUntilClose: 5}
  S->>S: stop accepting inputs at t+1 s, run final ticks
  S->>D: checkpoint every room (dirty or not), sequential, ≤ 3 s each
  S->>D: release Contract leases (WHERE lease_room_id = room)
  S-->>C: close 4001 SERVER_SHUTDOWN (t ≤ 20 s)
  S->>S: flush Sentry/logs, exit 0 (t ≤ 25 s)
  C->>C: overlay "Brightside is restarting the servers"; keep last frame rendered
  loop backoff 1, 2, 4, 8, 10 s (≤ 5 min)
    C->>N: GET /healthz then POST /v1/contracts/:id/join
    N-->>C: 409 CONTRACT_BUSY (lease held) → retry
  end
  N->>D: lease CAS, load save (sliced)
  N-->>C: seat reservation → join snapshot → play resumes from last checkpoint
```

| Rule | Detail |
| --- | --- |
| Close code | 4001 is Colyseus' `SERVER_SHUTDOWN`, which the SDK does not auto-reconnect; our client treats it as "rejoin with restore" |
| Client restore | Client keeps `{contractId}` in `sessionStorage`; server restores pose, equipped tool, Cell fill and vehicle from the save (never from the client) |
| Crash / OOM (no SIGTERM) | Up to 30 s of progress lost; lease expires after ≤ 35 s; client retries as above |
| Data at risk | ≤ 30 s (checkpoint cadence); profile deltas ≤ 60 s |

### 9.4 Checkpoint, save decode and room creation on 0.1 CPU

Serialization (header blob + dirty dust chunk versions, [data-model.md §3.7/§3.7b](data-model.md)) and deflate cost an estimated 10–40 ms CPU per checkpoint; decoding a save on room creation (up to 641 chunk rows) costs similar. Doing either in one tick would exhaust a 10 ms/100 ms CPU quota and stall **every** room in the process. Both are **sliced** at ≤ 1.5 ms CPU per tick (chunk ranges per tick, streaming deflate/inflate), then the write is one transaction issued off the tick. Room creation never builds grid or neighbour tables (they are precomputed and shared per process, WDS §2.5). On SIGTERM the slicing limit is lifted.

## 10. Wake-up, heartbeats and idle

| Item | Rule |
| --- | --- |
| Wake probe | Client `GET /healthz` on the **first user interaction on the title screen** (pointer down, key press or Clock In hover), not on page load; assets keep streaming from page load. 3 s timeout, every 3 s until our JSON arrives; non-JSON/CORS failure = Render waking page ([system-overview.md §3](system-overview.md#3-boot-and-cold-start-sequence)). **Never** probed when `navigator.webdriver` is true, the user agent matches the bot/crawler list, the page is prerendering or the tab is hidden; hub visitors who bounce never wake the server |
| Keep-alive while in a room | Inputs at `SIM_TICK_HZ`; when the tab is hidden, `PING` every 2 s (throttled browsers still fire ≥ 1/min, below the 15-min spin-down window) |
| AFK | No non-neutral input for 10 min → `afk` flag in roster; 30 min → close 4107 `IDLE_TIMEOUT` (saves instance hours) |
| Spin-down | After the last client leaves, Render stops the instance after 15 min of no inbound traffic; nothing is lost |
| Tests | Automated tests (e2e, bots, perf) target **local** by default; `tools/bots`, `tools/perf` and the e2e config refuse the production server URL unless a hosted run is explicitly opted into for an isolated, Cee-authorized test window on the one Render service (environments.md §3) |

## 11. Rate limits (per connection, in-memory `rate-limiter-flexible`)

| Stream | Limit | On violation |
| --- | --- | --- |
| `INPUT` messages | refill **1.5 × `SIM_TICK_HZ`/s**, burst **2 × `SIM_TICK_HZ`** (30/s burst 40 at 20 Hz; 45/s burst 60 at 30 Hz) | Drop extra; violation +1 |
| `PING` | 2/s | Drop |
| `DUST_REQUEST` | 1 per 2 s, ≤ 8 plots | Drop |
| Control messages (all) | 10/s, burst 20 | Drop + `error` reply |
| `purchase` | 5/s | Reject `RATE_LIMITED` |
| `build_*` | 10/s | Reject |
| `quick_chat`, `ping_marker` | 1/s, burst 3 | Drop |
| `report_player` | 1 per 60 s | Drop |
| Malformed message | — | Drop; violation +1 |
| Violations | > 50 in 10 s | Close 4104 `RATE_LIMITED`, `abuse_events` row |
| Inbound bytes | > 8 KB/s sustained 5 s | Close 4104 |

HTTP and join limits are in [security.md §5](security.md#5-rate-limiting).

## 12. Close codes

| Code | Name | Source | Client behaviour |
| --- | --- | --- | --- |
| 1000/1001/1006 | normal / going away / abnormal | WebSocket | 1006 → seat-hold reconnect |
| 4000 | CONSENTED | Colyseus | No reconnect (player left) |
| 4001 | SERVER_SHUTDOWN | Colyseus | Rejoin with restore (§9.3) |
| 4100 | PROTOCOL_MISMATCH | ours | `update_required` flow (§13) |
| 4101 | AUTH_INVALID | ours | Refresh token, retry once, else re-auth |
| 4102 | KICKED | ours | Message; rejoin blocked 15 min |
| 4103 | BANNED | ours | Message; Contract hidden from list |
| 4104 | RATE_LIMITED | ours | Message; rejoin after 30 s |
| 4105 | ROOM_FULL / AT_CAPACITY | ours | "Shift is full" / "Brightside at capacity — join an Open Shift or try later" |
| 4106 | DUPLICATE_SESSION | ours | Message in the older tab |
| 4107 | IDLE_TIMEOUT | ours | "Clocked out for inactivity"; Clock In again |
| 4108 | CONTRACT_UNAVAILABLE | ours | Save failed to load (incl. newer save format) or lease lost; report to Sentry |

Exact Colyseus reserved values must be checked against the 0.18 `CloseCode` enum during M0; our codes stay in 4100–4199.

## 13. Versioning and release order

| Item | Rule |
| --- | --- |
| `PROTOCOL_VERSION` | Integer in `packages/shared/src/protocol/messages.ts`. Bumped on any wire-incompatible change (bytes layout, Schema fields, control payload). Commit footer `BREAKING CHANGE:` |
| Handshake | Client sends `{protocolVersion, clientBuild}` with the join request; mismatch → 4100 with `{serverProtocol, serverBuild}`. `/healthz` exposes the same values so the mismatch is caught before Clock In |
| Compatibility | Strict equality for required messages. Optional message types may be added server-first within one protocol version (unknown bytes types are ignored by the client) |
| **Release order ([ADR-0029](../adr/0029-single-deploy-branch-main.md))** | A push to `main` deploys the client (Vercel) and the server (Render, `autoDeployTrigger: checksPass`) independently; there is no deploy gate. On a protocol-changing commit the new client can be live minutes before the server, so the newer-client flow below is a **required, tested path from M1**. Recovery: Vercel Instant Rollback for the client, Render rollback or fix-forward for the server. Before pushing: `/verify` and `/release-checklist` |
| Client after mismatch | Older client: "New shift orders — reload" (reload `index.html`, short TTL). Newer client (expected briefly after a protocol-changing push, ADR-0029): "Brightside is updating the servers", probe `/healthz` every 30 s for ≤ 10 min; after 10 min stop probing, show "Still updating — try again in a few minutes" with a Retry button (restarts one 10-min wait) and send one Sentry event `protocol_wait_timeout` |
| `SAVE_FORMAT_VERSION` | Independent; see [data-model.md §6](data-model.md#6-save-format-and-versioning) |

## 14. Bandwidth budget (server → client)

Assumptions: busy 16-player Private Shift, everyone inside each other's horizon-aware interest (clustered), 8 vehicles moving, 32 robots moving in interest, all players cleaning; default rates 20/10. Overhead: ≈ 80 B per socket write (TLS record + WebSocket header + TCP/IP), with `FRAME` (incl. dust sections) + Schema patch coalesced into one write per frame interval (verified in M0, §3).

| Item | Math | B/s per client |
| --- | --- | --- |
| Frame header + Self | (9 + 20) × 10 | 290 |
| Other avatars | 15 × 8 B × 10 | 1,200 |
| Vehicles | 8 × 11 B × 10 | 880 |
| Robots | 32 × 6 B × 5 | 960 |
| Dust strokes incl. own echoes (WDS §5.3 worst) | 16 × 4 B × 10 + headers 100 | 740 |
| Dust plots (L0, 2 Hz) | WDS §5.3 | 200 |
| Robot intents, dust checks | WDS §5.3 | 30 |
| Events (rails, machines, stamps) | | 100 |
| Schema patches | | 200 |
| Roster markers, pong | 50 + 5 | 55 |
| Ledger/structure streaming (amortized while moving) | | 300 |
| Socket/TLS/TCP overhead | ≈ 11 writes/s × 80 B | 880 |
| **Total busy** | | **≈ 5.8 KB/s (≈ 47 kbit/s)** |

| Scenario (per month, 5 GB = 5,000 MB Render Hobby egress) | Per client | Room egress | MB per room-hour | Room-hours per 5 GB |
| --- | --- | --- | --- | --- |
| 16 players busy, 20/10 | 5.8 KB/s | 94 KB/s | ≈ 337 | **≈ 15** (≈ 240 player-hours) |
| 16 players busy, 30/15 | ≈ 8.3 KB/s | 132 KB/s | ≈ 477 | ≈ 10 |
| 8 players mixed, 20/10 | ≈ 4.0 KB/s | 32 KB/s | ≈ 115 | ≈ 43 |
| 4 players typical, 20/10 | ≈ 2.5 KB/s | 10 KB/s | ≈ 36 | ≈ 140 |
| Solo Shift, 20/10 | ≈ 1.6 KB/s | 1.6 KB/s | ≈ 5.8 | ≈ 860 |
| Hidden tab (any room) | ≈ 0.3 KB/s | — | — | — |
| Joins | ≈ 0.05–0.3 MB each | — | — | 1,000 joins ≈ 0.1 GB |

Upstream per client ≈ 20 × (10 + 6 + ~60) B ≈ 1.5 KB/s (inbound is not metered by Render per [netcode-case-raw-websocket.md §6](../research/tech/netcode-case-raw-websocket.md)). Owner accepted the suspension risk: no cap, but bytes out are logged per room per minute, persisted daily (`ops_usage_daily`) and shown month-to-date on `/status`. **Hosted test runs share the same egress:** hosted bot runs (isolated test window only) are capped at 5 min and soaks run locally in a CPU-limited container ([performance-budgets.md §8](performance-budgets.md)).

## 15. Server CPU budget (0.1 CPU)

0.1 CPU ≈ 100 ms CPU per wall second; if enforced as a CFS quota, ≈ 10 ms per 100 ms period — bursts above that stall the whole process ([netcode-case-raw-websocket.md §8.5](../research/tech/netcode-case-raw-websocket.md)). At 20 Hz a tick has 5 ms of process budget for **all** rooms. V8's GC helper threads draw on the same quota.

| Work item (one 16-player room, 64 robots) | Cost per occurrence (est.) | Amortized ms per tick |
| --- | --- | --- |
| Input decode + validate | 16 × 3 µs | 0.05 |
| Avatar + vehicle step (32 kinematic bodies, height sampling) | 32 × 10 µs | 0.32 |
| Robots: motion (64 × 2 µs) + AI (16 decisions × 15 µs) | | 0.37 |
| Stroke rasterization into ledgers (≈ 250 point tests per stroke) | WDS §4.5 | 0.15 |
| Robot ledger ops (≤ 150 chunks/s per process × 20 µs, WDS §4.8) | 3 ms/s | 0.15 |
| Economy, Glide Rails, machines | | 0.10 |
| `InterestService`: entity + dust sets (staggered, horizon test per pair) | 16 × 0.15 ms / 10 ticks | 0.24 |
| Frame encode per client (every F ticks) | 16 × 45 µs | 0.36 |
| Schema patch encode (every F ticks) | 0.1 ms | 0.05 |
| Socket writes (uWS, coalesced) | ≈ 12 × 10 µs | 0.12 |
| Checkpoint slices (avg over 30 s) | 30 ms / 600 ticks | 0.05 |
| Minor GC, runtime, metrics | | 0.30 |
| **Total** | | **≈ 2.3 ms/tick ≈ 45 % of 0.1 CPU** |

Not in the steady-state table, gated separately:

| Item | Plan | Gate |
| --- | --- | --- |
| Major GC | A V8 major GC on a 100–300 MB heap costs tens of ms of CPU → 0.3–1 s process stall under the quota. M0 spike evaluates heap cap 192–256 MB (vs 384), `--max-semi-space-size`, `--single-threaded-gc`; typed arrays (ledgers, grid) live off-heap; no per-tick allocation in hot paths | **Max stall with GC traced ≤ 50 ms** over a 10-min 16-bot run |
| Boot | Bundle load + height map (12.6 MB) + precomputed grid binaries (WDS §2.5): ≈ 150 ms on a full core ≈ 1.5 s at 0.1 CPU | Boot to listening ≤ 5 s measured at 0.1 CPU |
| Room creation | Per-room allocation + sliced save decode (§9.4) | No live room's tick p95 rises > 0.5 ms during another room's creation |

| Gate | Value |
| --- | --- |
| Room tick p95 (16 bots) | ≤ 3.5 ms; max ≤ 8 ms (excluding traced major GC, gated above) |
| Process CPU (EWMA 60 s) | ≤ 60 % of quota with one full room |
| Event-loop delay p99 | ≤ 20 ms |
| Tech-stack revisit trigger | One 16-bot room > 50 % CPU at 20 Hz on real Render Free → replace Colyseus edge with custom uWS adapter |
| **Admission control (M10)** | A new room is admitted only if **all** hold: rooms < `MAX_ROOMS` (**hard ceiling, default 3**); Σ measured room tick p95 (EWMA) + estimate for the new room (0.5 ms, then measured) ≤ `TICK_BUDGET_MS` (default 3.5 ms = 70 % of the 5 ms tick); process CPU EWMA ≤ 70 %; clients < `MAX_CLIENTS` (24). Joins into a live room are refused (4105) while process tick p95 > 4 ms for 30 s. Refusal → 4105 "Brightside at capacity" |

**Capacity reality on the free tier:** one 0.1-CPU instance hosts **only a few live Contracts at once** — typically one busy shared shift plus a couple of Solo or small shifts, never more than `MAX_ROOMS`. Every Solo Shift is a server room in the MVP. Players without a Contract slot are steered to **existing Open Shifts, which share rooms**; the Open Shifts list sorts by free seats. The Worker-based offline Solo (dev flag today) is the v1.0 relief valve.

## 16. Failure modes

| Failure | Detection | Behaviour | Player sees |
| --- | --- | --- | --- |
| Server asleep | `/healthz` timeout / Render page | Probe every 3 s (after first title interaction) | "Waking the moon…" |
| Deploy / restart | SIGTERM | §9.3 | Overlay, auto-rejoin ≤ ~60 s |
| Process crash / OOM | Socket 1006, `/healthz` fails | Seat-hold reconnect fails → rejoin loop; lease expiry 35 s | Overlay, ≤ 30 s progress lost |
| TCP stall / packet loss | Frame gap > 250 ms | Extrapolate ≤ 250 ms then hold; substituted inputs consumed (§5.1) | Brief freeze of others; own avatar keeps moving |
| Client tab hidden | `visibility` message / inputs stop | Self-only 1 Hz frames; neutral input after 3 substitutions; AFK after 10 min | Avatar idles |
| Client too slow (backpressure) | uWS buffered amount > 64 KB | Skip frames for that client; next frame FULL records (spilled under the cap) | Choppier others |
| DB powered off / unreachable | Query error, `/readyz` | Running rooms continue; checkpoints retry with backoff (1 → 30 s), dirty state kept in memory; new rooms refused (4108) | Running shift unaffected; new Clock In shows records offline |
| Save fails to decode | Checksum / version | Room create fails 4108, Sentry alert, rows untouched | "Contract unavailable" |
| Second room for a Contract | Registry + lease CAS | Impossible by construction (§9.3); a lost lease closes the room 4108 before any further write | — |
| Dust drift | `DUST_CHECK` mismatch | WDS §5.5 | Invisible |
| Protocol mismatch | Handshake | 4100 | Reload / waiting message |
| Render bandwidth exhausted | Render suspends services | None in code (owner decision) | Site cannot reach server until next month |
| Render free hours exhausted | Render suspends all free services | None in code; instance-hours logged month-to-date | Same |
| CPU overload | Tick p95 > 4 ms for 30 s | Admission control refuses new rooms and joins; robots shed first, then dust radius lowered to 100 m (WDS §11) | Possible rubber-banding |

## 17. Test strategy

| Layer | Tool | What | Gate |
| --- | --- | --- | --- |
| Codec | Vitest (property-based round-trip + fuzz) in `packages/protocol` | Every message type in the catalog encodes/decodes bit-exact; truncated/oversized input never throws past the decoder boundary; test vectors checked in | 100 % message types covered |
| Sim determinism | Vitest | Same inputs → same quantized state on Node and in a browser worker (Vitest browser mode) for avatar and vehicle step | Zero divergence over 10,000 ticks |
| Input sequencing | Vitest + netsim | Substitution, late-drop, starvation, double-step backlog; clock steering keeps buffer depth 1–2 under ±2 % clock drift | Zero double-applied inputs |
| Reconciliation | Vitest + netsim | 120 ms ± 30 ms RTT, 1 % loss: own-avatar correction | p95 < 5 cm on flat ground; snaps ≤ 1 per 10 min |
| Room uniqueness | Vitest + `@colyseus/testing` | Concurrent joins, full room, drain lock, shift-type change, two instances against one DB | Exactly one room per Contract |
| Network conditions | `tools/netsim` (in-process conditioner) + Toxiproxy | Profiles: good (40 ms RTT), typical (120 ms, 15 ms jitter), bad (250 ms, 50 ms jitter, 1 % loss → TCP stalls), outage (5 s blackhole) | No desync; reconnect inside 60 s |
| Load | `tools/bots` (headless bots using `packages/protocol` + the `packages/sim` reconciler) + `@colyseus/loadtest` | 16 bots per room: walk, clean, drive, buy, build; join/leave churn every 30 s. **1 h soaks run locally** in a CPU-limited (0.1 CPU) container, never on the hosted service | §15 gates; bytes/client ≤ budget §14 |
| Restart | Bots + scripted SIGTERM | Drain completes ≤ 25 s; all bots rejoin and positions match checkpoint | 100 % rejoin |
| Gate command | `/bot-test`: 16 headless bots via `tools/bots`, netsim 120 ms ± 30 ms, 1 % loss, 10 min **locally**; reports tick p50/p95/max, GC stalls, bytes per client per message type, desync (checksum mismatches, reconciliation error) | Local | §14–15 budgets; zero unrecovered desync |
| Real host | `/bot-test --hosted-spike`: same scenario during an isolated, Cee-authorized test window on the one Render service (environments.md §3), **≤ 5 min**, no live player data, bytes recorded in `ops_usage_daily` (M0 netcode spike and before launch only) | Hosted window | Tech-stack revisit trigger |
| E2E | Playwright (local; hosted only in an approved isolated test window, never against live player data) | Cold start (server asleep) → first title interaction → Waking screen → join; protocol mismatch flow; bots/crawlers do not probe | |

## 18. Open issues

1. **Colyseus close-code values** other than 4001 are from memory of earlier releases; verify against 0.18 before coding. Also verify `exposedMethods`, `reserveSeatFor` and `broadcastPatch` with automatic patching disabled.
2. **`maxShutdownDelaySeconds` on Free** is unverified; design assumes 30 s.
3. **Render health checks and spin-down:** whether `healthCheckPath` traffic counts as inbound traffic (would keep prod awake) is unverified; M0 checks it and drops `healthCheckPath` on Free if it does ([environments.md §8](environments.md)).
4. **Research bandwidth guard** ([netcode-case-raw-websocket.md §8.6](../research/tech/netcode-case-raw-websocket.md) "refuse rooms past 4.5 GB") is **not** adopted, per owner decision; only logging and `/status`.
5. **GC tuning flags** (heap cap, `--single-threaded-gc`) are decided by the M0 spike; `NODE_OPTIONS` stays `--max-old-space-size=384` until then.
