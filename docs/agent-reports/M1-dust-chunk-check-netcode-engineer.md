# M1 dust.check chunk summary, server send + client compare (netcode-engineer)

Task / status: **in-review** / 2026-11-16 / netcode-engineer / Sonnet 5.5. Node 26.13.1 (fnm PATH prefix). No git.

## Spec and protocol

WDS 5.1 / 5.5 (`world-and-dust-simulation.md` lines 384 and 435), netcode.md 110. The message already exists:
`DUST_CHECK` 0x24, chunks mode (`chunkId` 10 bits + XOR hash 32 bits) and detail mode, `DUST_REQUEST` chunk kind, codecs and
golden vectors in `packages/protocol`. **No protocol or shared change, PROTOCOL_VERSION unchanged, nothing additive needed.**

## Done

- `apps/server/src/net/shift/shift-dust.ts`: new `chunkCheckBody(sent)`. One pass over the ledger slots; per chunk it XORs
  `mixPlotHash(plotId, ledgerHash)` over the Opened ledgers this seat's client was sent (`sent[plot] === 1`), ascending chunk id,
  max 255 chunks. It reuses `checkOut` and per-chunk scratch arrays (allocated once in the constructor). New counter `chunkChecksSent`.
- `shift-core.ts` (minimal hookup): `Seat.nextCheckTick`, `checkEveryTicks = DUST_CHECK_INTERVAL_S * simTickHz` (5 s from the shared
  constant, not a magic number), armed on the first idle frame tick after a snapshot (reset to -1 by `requestDustSnapshot`), and
  sent in `sendDust` after the stream loop. **At most one summary build per frame tick across seats** (a second due seat waits for
  the next frame tick). Hidden, held and snapshot-pending seats are skipped. Order guarantee: sent after the FRAMEs, same rule as
  ledgers. Solo never touches ShiftCore, so solo cost is zero.
- `apps/client/src/net/remote-dust.ts`: `DUST_CHECK` chunks mode is now handled. Per chunk it compares `ledger.chunkHash(id)` with
  the server value. A mismatch queues the chunk (cap 16) and `nextRequest` sends a chunk `DUST_REQUEST` (plots first, else a chunk).
  The detail answer queues the mismatching plots for a ledger request, then the ledger install repairs them. `wantedCount` now counts
  plots plus chunks, so `online-room.ts` (spacing 2.5 s poll) needed **no change**. Ignored before the snapshot (`ready` false).
  New stat `chunkMismatches`.
- Benign case: the client can hold ledgers the server does not count (it created one from a stroke before the server's
  0.5 s interest pass marked it sent, or kept one beyond the 20 m hysteresis). The summary then differs but the detail has nothing
  to fetch; that (server, client) hash pair is remembered, so it is not re-requested every 5 s. A changed hash asks again.

## Tests (all pass)

- Client `remote-dust.test.ts` (+2): a deliberately corrupted texel in a client ledger is flagged by the chunk summary, then chunk
  request, detail names exactly that plot, plots request, server ledger answer, and `worldHash` equals the server's again; the next
  summary is clean. Benign suppression; truncated or garbage DUST_CHECK refused without throwing; ignored before the snapshot.
- Server `shift-dust.test.ts` (+1, one existing assertion narrowed to detail-mode checks): 2 seats, summaries every 100-104 ticks per
  seat, two seats never built on the same frame tick, `chunkChecksSent` matches, the last summary equals each client's own
  `chunkHash` and the server's, and a one-texel client corruption changes the chunk hash.
- Run: vitest `apps/server src/net src/world` 18 files 180 passed; `apps/client src/net` 7 files 60 passed (1 skipped, pre-existing);
  `apps/client src/app` 18 files 119 passed; `packages/shared src/protocol src/world` 8 files 129 passed. tsc (server and client)
  clean, eslint clean, prettier clean on the 5 edited files.

## Cost

- Build: 0.149 ms per summary for 1,500 Opened ledgers (0.019 ms for 5); 6 seats cost about 0.9 ms per 5 s (about 0.2 ms/s CPU)
  and at most one build per frame tick. Allocation: only the small chunk array and encoder per summary, once per 5 s per seat, none per tick.
- Wire: 87 B for 14 chunks (6 B per chunk plus 3 B header), about 17 B/s per player. A detail answer is on mismatch only.

## Not met / Next

1. Summary hashes cover ledgers the server sent (`sent === 1`). A ledger created by a stroke is on the client first, so a sweeping
   client sees an occasional transient mismatch, costing one extra chunk request plus detail (at most about 2.5 KB) that the benign
   rule absorbs. Optional refinement: also count `sent === 0` plots inside the dust radius.
2. No real-socket run (soak or bots with `tools/netsim`); the pair is verified through unit and in-process tests only.
3. `packages/protocol` has no dedicated chunks-mode vector assertion in this task (existing `DUST_CHECK_CHUNKS_VECTOR` covers the codec).
