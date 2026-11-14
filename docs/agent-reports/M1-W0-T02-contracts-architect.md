# M1-W0-T02 — Protocol, input, sim and REST contracts v1 (contracts-architect)

Task / status: in-review / 2026-11-13 / contracts-architect / Sonnet 5.5
Done: all acceptance items. `PROTOCOL_VERSION = 1`; MVP message catalog (46 entries: 24 active, 19 post-MVP reserved, 3 spike); FRAME layout, bit tables and golden vectors; INPUT wire and vectors; Self / entity / slot-change tables; ShiftState plain shape plus Schema field table; `sim/{input,components,shift-state,room-sim}`; REST DTOs v0.2.0 incl. solo checkpoint DTOs and `CHECKPOINT_REJECT_REASONS`; close codes verified; a zod schema for every active client to server payload.
Next: lead updates netcode 4/12 and module-boundaries rows; T06 adds `client/room-host.ts`; apps/server fixes `health.test.ts:66`.
Files: `packages/shared/src/{ids,units,protocol,sim,api}/**` (+ tests), `src/index.ts` header v1, one-line `src/index.test.ts` (`PROTOCOL_VERSION` 0 to 1). New: `protocol/{limits,frame,shift-state-schema}.ts`, `sim/{input,components,shift-state}.ts`; tests `protocol/{frame,protocol-v1}.test.ts`, `sim/{input,sim}.test.ts`, `api/rest-v2.test.ts`.
Evidence (Node 26.13.1, repo root): `tsc -p packages/shared` and `packages/game-data` exit 0; `eslint packages/shared packages/game-data` exit 0; `prettier --check` clean; vitest packages/shared 28 files / 428 tests pass, game-data 41 pass. Not run: root `pnpm verify`. Read-only consumer tsc: packages/protocol, apps/server, tools/bots clean; apps/client has 1 pre-existing T03 error (`render/tier.ts:129`, QualitySettings new groups). `apps/server src/api/health.test.ts` now fails (hard-coded `protocolVersion: 0`).

## Verified
- Colyseus 0.18 close codes read from `@colyseus/shared-types@0.18.3/build/Protocol.d.ts`: 1000/1001/1005/1006, CONSENTED 4000, SERVER_SHUTDOWN 4001, WITH_ERROR 4002, FAILED_TO_RECONNECT 4003, MAY_TRY_RECONNECT 4010. SDK 0.18.10 `Room.mjs` reconnects only on 1005/1006/1001/4010; 4001 and all 4100-4108 end the room (matches netcode 12). `client.leave(code, data)` passes the code to ws/uWS as is. Recorded as `FOREIGN_CLOSE_CODES` / `SDK_RECONNECT_CLOSE_CODES` (netcode 18 item 1 closed; 4002/4003/4010 are missing from the netcode table). `exposedMethods`, `broadcastPatch`, `reserveSeatFor` (netcode 18) were NOT checked here.
- NOT verified: bit layouts are checked against a test-local reference packer, not against a real `packages/protocol` FRAME codec (none exists yet).

## Decisions flagged [R] (differ from or extend the docs)
1. INPUT wire carries button LEVELS; the sim derives edges. Substitution repeats the last input verbatim (no phantom edge). Clarifies netcode 5.1.
2. 16 logical buttons (netcode's 13 plus `laneLock`, `puckForm`, `pickupDrop`); driver/passenger/build meanings come from context (`INPUT_BUTTON_MEANING`): `laneLock` = Throttle Lock, `holsterNext` = Wide Mouth cycle, `seatSwitch` = load/unload, `jump` = handbrake.
3. New control messages not in the netcode tables: `select_tool` (c2s, slot 0-5) and `sim_events` (s2c, batched `SimEventMap` events except `dust.collected`). The compact FRAME `plot.polished` event is superseded; the FRAME events section is v1.0 only (rails, machines, structures).
4. Self carries `cellGrams` u24 (= `dust.ack`, WDS 5.1): Self is 21 B on foot / 49 B driving (netcode said 20 / 52).
5. After Self, every FRAME section has a u16 byte-length prefix. Record sizes incl. the 10-bit prefix: avatar 13 B, vehicle 17 B, robot 11 B.
6. Pitch is an unsigned 6-bit code (0 = -90, 63 = +90 deg). Move state is a 5-bit enum; avatar action state is the animation-spec P1 u6 enum (41 used).
7. HTTP_METHODS gained `PUT` (checkpoint parts). Added `QUOTA_EXCEEDED` (409) to API codes. `ROOM_FULL` REST status 409 is my choice.
8. MVP active set: kick and set_shift_type are active; build, teleport, beacon, chat, ban, appoint, vote, report, structures, roster markers stay reserved.

## Open items
1. **Hot-path frame source** is not defined: `RoomSim.snapshot()` is cold path (saves, tests, join assembly). packages/sim and packages/protocol must agree a reusable-buffer interface (per-client Self / entity views) before the FRAME encoder is written; proposal `RoomSim.readSelf(actor, out)` plus an interest-set iterator.
2. `RoomSim` gained `tick`, `applyIntent`, `addActor`, `removeActor` beyond the card (the host needs them); `applyInput` sets the input for the NEXT step (the sequencer picks the seq per netcode 5.1).
3. PROTOCOL 0 to 1: strict equality means v0 clients get 4100.

## Consumers that must change (next wave)
- apps/server `src/api/health.test.ts:66`: replace hard-coded `protocolVersion: 0` with `PROTOCOL_VERSION` (currently fails).
- apps/server/src/net, packages/protocol: codecs for INPUT, FRAME (Self, entities, slot changes), dust messages against `frame.ts` tables and `vectors.ts`; Colyseus Schema from `SHIFT_STATE_SCHEMA_FIELDS`; rate limits from `limits.ts`; sequencer per `INPUT_SEQUENCING`; zod-validate every control message with `PAYLOAD_SCHEMAS`.
- apps/server/src/api + persistence, packages/db: routes from `API_ROUTES`, DTOs of `api/rest`, `API_ERROR_STATUS`, checkpoint verify with `CHECKPOINT_REJECT_REASONS`.
- apps/client/src/net: RemoteRoomHost (Schema to `ShiftStateView` array form, `sim_events` to `onEvent`), auth and contracts calls.
- packages/sim: implement `RoomSim`; edges from levels; `applyIntent` returns `IntentResult`.
- apps/client/src/{gameplay,animation}: use `AvatarActionState`, `MoveState`, `INPUT_BUTTON_MASK`.
- tools/bots: v1 fixtures and INPUT layout.
- Lead: netcode 4.1/4.2/4.3/12 text, module-boundaries section 2 rows.

## What T06 (`client/room-host.ts`) can import now
`ControlIntent`, `IntentResult`, `ShiftType` (`SHIFT_TYPES`, `MvpShiftType`), `ShiftState`, `ShiftStateView` (= ShiftState + `tick`), `RoomSimEvent` (`{name, payload}`), `SimInputCommand`, `ContractRole`, `Tick`, `ContractId`, `Unsubscribe`, and for `saveSync`: `SoloCheckpointSummary` (api/rest). `RoomHostFrame.ackInputSeq` matches the FRAME header field.
