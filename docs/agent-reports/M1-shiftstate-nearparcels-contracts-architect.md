M1 ShiftState nearParcelsCollected / in-review / 2026-11-15 / contracts-architect / Opus 5.5 medium

Done: Appended `nearParcelsCollected: uint8` (bitmask, bit k = Near Parcel k of `placeNearParcels(seedOfString(contractId))`, k < `MVP_SCOPE.nearParcelCount` = 6, capped at 8) as the last ShiftState Schema field.
- Contracts: `protocol/shift-state-schema` v1 to v1.1 (table appended), `sim/shift-state` v1 to v1.1 (`ShiftStateSchema` adds `U8.optional()`, `ShiftState.nearParcelsCollected?: number`).
- Versioning: appending a Schema field is wire-compatible (client decodes by reflection; existing field indexes unchanged), so `PROTOCOL_VERSION` stays 1 (netcode.md section 13 bumps only on wire-incompatible change).
- Optional on purpose (add, migrate, remove): the sim `snapshot()` (packages/sim moon-room-sim.ts:2176) and the client `hud-writer.test.ts` fixture omit it and still compile. Absent means "unknown". Make it required in a later contracts wave once the sim snapshot sets it.
- Server: `ShiftStateSchemaClass` + `SHIFT_STATE_CLASS_FIELDS` appended. New allocation-free `nearParcelsMask(sim)` in shift-state.ts. shift-room.ts sets the mask in `buildState` and on frame ticks (change-guarded, same as wallet/shine).

Next (netcode worker, apps/client; not edited here):
1. RemoteRoomHost Schema-to-`ShiftStateView` conversion (remote-room-host.ts): copy `nearParcelsCollected` (it is `undefined` on an older server).
2. online-readouts.ts: when the value is a number, set the collected set from `(mask >>> k) & 1` on every state change, including the first full state (late join). Keep the nearest-avatar guess on `collectible.found` only as a fallback when the field is undefined, or drop it.
3. Add a client test: a late-join state with mask 0b100101 marks parcels 0, 2 and 5 collected without any events.
Other consumers: none must change. Later: sim `snapshot()` may set it for solo parity (packages/sim owner), then make the field required.

Files: packages/shared/src/sim/shift-state.ts, packages/shared/src/sim/sim.test.ts, packages/shared/src/protocol/shift-state-schema.ts, packages/shared/src/protocol/protocol-v1.test.ts, apps/server/src/net/shift/shift-state.ts, apps/server/src/net/shift/shift-state.test.ts (new), apps/server/src/net/shift/shift-room.ts, apps/server/src/net/shift/shift-core.test.ts (title only).

Evidence (Node 26.13.1, current file state):
- shared vitest: 32 files, 474 passed.
- server vitest src/net: 17 files, 170 passed. This includes the new reflection round trip for full state, patch and late joiner.
- protocol vitest: 123 passed. One test failed once while the run was loaded in parallel with others and passed on rerun; it does not touch ShiftState.
- sim test/golden: 2 passed (goldens unchanged, no sim edits).
- tsc --noEmit is clean for shared, protocol, sim, server and client.
- eslint on the changed files is clean.

Blockers: none.
Commit suggestion: feat(protocol): append ShiftState.nearParcelsCollected bitmask (schema v1.1, additive)
