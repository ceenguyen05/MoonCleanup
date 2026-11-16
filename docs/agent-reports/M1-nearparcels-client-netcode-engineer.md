M1 Near Parcels client mask / in-review / 2026-11-15 / netcode-engineer / Opus 5.5

Done: the client reads `ShiftState.nearParcelsCollected` (schema v1.1, uint8, bit k = Near Parcel k), so late joiners see parcels collected before they joined.
- `online-readouts.ts`: new `noteState(state)`. It reads one property and allocates nothing. An integer 0..255 is masked to the parcel count and replaces the collected set; the first value seen makes the mask authoritative (`authoritativeMask`). Absent field (older server): no change, and the nearest-avatar guess on `collectible.found` stays the fallback. Invalid values are counted (`stats.maskInvalid`) and ignored. Once authoritative, find events are skipped (`stats.skipped`); the next patch (at most 100 ms later) carries the bit.
- `online-room.ts`: `tapFrames` takes an optional `stateTap`. It wraps the session's own single `onStateChange` callback (session first, then readouts), so no extra Colyseus listener is added and room-session.ts is unchanged. Colyseus fires it on the first full state, which covers late join. `onSimEvents` skips gathering avatar positions once the mask is authoritative.
- `remote-room-host.ts`: unchanged. No Schema-to-`ShiftStateView` adapter exists there yet (`onShiftState` is registered but never fed), so contracts step 1 has nothing to copy. When that adapter is written, it should copy the field.

Solo cost: none. Only lazy online-chunk files changed.

Evidence (Node 26.13.1):
- vitest: `online-readouts.test`, `online-room.test`, `online-loop.integration` and `round5-wiring` gave 4 files, 19 passed. That includes the new late-join tests: mask 0b100101 marks parcels 0, 2 and 5 with no events; the absent field and the fallback; invalid values; the bits above the count; skipped events; and the session's equippedTool still flowing through the tapped callback.
- `src/net`: 58 passed, 1 skipped.
- tsc --noEmit exit 0. eslint exit 0 on the 4 touched files. prettier applied.

NOT RUN: `pnpm verify`, live 2-client browser check, netsim.
Blockers: none. Later: sim `snapshot()` may set the field for solo parity (packages/sim owner).
Files: apps/client/src/app/online-readouts.ts, online-readouts.test.ts, online-room.ts, online-room.test.ts.
