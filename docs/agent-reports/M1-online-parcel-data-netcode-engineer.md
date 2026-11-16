# M1 online parcel data (netcode-engineer)

Status: **PARTIAL.** Near Parcels, outposts, Plot Card and Hop now reach the online HUD with no protocol change. Two limits remain: late joiners miss parcels collected before they joined, and the Crown Lamp and price quotes are not fed online. Date: 2026-11-15. No git. No servers left running.

## How it works (no server code changed)
The server already sends everything the client needs:
- **Contract id.** Parcel placement is deterministic per Contract: `placeNearParcels(seedOfString(id))`. The join route lower-cases the id, so the client lower-cases it too.
- **`collectible.found` sim_events** (`stray_cargo` / `near_parcel`). The event carries no parcel index. The client marks the uncollected parcel nearest to any avatar it knows: its own predicted pose plus the interpolated remote avatars.

What the client derives:
- **Outposts:** `BOREAL_STAND_IN_OUTPOSTS`.
- **Plot Card:** from the dust mirror ledger at the predicted pose, using the same formula as `MoonRoomSim.plotCard`. `creditedSlot` is null because the server sends no per-plot credit.
- **Hop:** from the predictor state.
- **Lamp:** shown as level 0, off.
- **Quotes:** -1, so the Desk and Board keep list price.

Files:
- New: `apps/client/src/app/online-readouts.ts`, the `OnlineReadouts` class. It is a `HostReadoutSource`, lives in the lazy online chunk and allocates nothing on reads.
- Edited: `apps/client/src/app/online-room.ts`. It adds `readouts` and routes `onControl` sim_events to it; this runs only when a message arrives.
- Edited: `apps/client/src/app/remote-room-host.ts`. It adds `readouts` and a no-op `setReadoutRequest`, so the existing `ReadoutLink` / `ParcelFeed` in boot attach automatically.

Solo cost: none. These are lazy-chunk files only, and the solo path was not touched.

## Contract proposals (contracts-architect; not edited)
1. Append `nearParcelsCollected: uint8` (dynamic) at the end of `SHIFT_STATE_SCHEMA_FIELDS` and of shared `ShiftStateSchema`. The server would set it on frame ticks from `sim.nearParcel(k)`. This fixes late join and makes the client's nearest-avatar guess unnecessary.
2. Optional: add `index?: number` to `CollectibleFoundEvent`.
3. The Crown Lamp and price quotes online need the `suitGear` / `sharedUpgrades` Schema sync plus a remote ShiftStateView adapter. The fields already exist, so this is net/app work, not a contract change.

## Evidence
- Client vitest run on `online-readouts.test` (4 new tests), `online-room`, `online-loop.integration`, `round5-wiring` and `src/net`: 11 files, 75 passed, 1 skipped (the existing allocation test).
- `apps/server` `vitest src/net/shift`: 38/38 passed.
- Client `tsc`: exit 0. eslint on the changed files: exit 0. prettier applied.
- Goldens: `packages/sim` was not touched; the goldens were not re-run.

## NOT RUN
- `pnpm verify`.
- A live browser 2-client check.
- netsim.
- An end-to-end ShiftRoom test of a parcel being collected.
