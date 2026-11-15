# dust-sim / p3-client-paint-minmerge

Approach P3 of the dust contest (world-and-dust-simulation section 10): **clients paint, the server stores opaque
64 x 64 4-bit tiles per plot and merges uploads by per-texel minimum.** Prototype quality. Not a workspace package;
production code is read by relative import of the source barrels; nothing in `apps/` or `packages/` imports this folder.

Status: CPU half built and measured on the real GP(128,0) grid. **GPU half NOT RUN** (no TSL or WebGPU code exists here).

## Hypothesis

If the shared dust state is plain data (a 0.4 m, 16-level tile per plot) instead of a replayed stroke history, then

1. any client brush works without a server change ("brush freedom"),
2. concurrent edits never conflict (minimum is commutative, associative and idempotent),
3. the server is cheap (no rasterisation of player strokes) and joins / restores are small (tiles compress well),

at the price of client-reported scoring, tile-delta bandwidth in both directions and a coarse shared picture.

## What is built

`src/core` (no DOM, Node, three.js or Colyseus; `tsconfig.core.json` proves it):

| File                              | Role                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `geom.ts`                         | Per-plot frame, texel ownership mask (nearest centre among the plot and the plots sharing its frame) and neighbours, from the ContestGrid subset only                          |
| `painter.ts`                      | The brush (client code, also used by the server for robots): lattice coverage per 0.4 m texel, flat or soft-edged, segment or disc                                             |
| `client.ts`                       | Paints its own tiles (private 8-bit `fine` plane + shared 4-bit level), uploads texels whose level dropped, min-merges what the server relays, drift check, GPU upload staging |
| `server.ts`                       | Tile store, min merge, bounds (reach, rate, ownership), plot states, credit, interest sets, join snapshot, robots painted server-side, checkpoint                              |
| `codec.ts`, `bytes.ts`, `hash.ts` | Sparse delta and RLE tile codecs, reusable byte buffers, incremental (Zobrist) tile hash                                                                                       |

`harness-adapter.ts` is the contest adapter; `grid.ts` exports `createGrid()` = packages/world GP(128,0).

Wire, per flush (default 10 Hz, `P3_FLUSH_TICKS=2`):

- C -> S `paint`: per plot, the texels whose shared level dropped since the last upload (gap-coded indices + nibbles).
- S -> C: `tile delta` (the merged texels of every tile the client holds; skipped for a client that is the only author
  of that tile in the window), `tile full` (interest entry, join), `tile resync` (refused paint), L0 `plots`
  (4 B per changed plot, 2 Hz, state changes at once), `ack` grams, `interest` drops, `robot` intent, `check` hash.

## The honest story on authority, determinism, join, checkpoint, cheating

CLAUDE.md and security section 1 say the sim is authoritative and clients send inputs/intents only. **P3 breaks that
rule by design**: a client sends results (cleaned texels), not intents. What the server can and cannot own:

| Topic                 | P3 answer                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server authority      | Owns the merged tile (the only copy that counts), plot states, credit, L0, robots. Does **not** own what a player cleaned: it only bounds each upload                                                                                                                                                                                                   |
| Bounds (tested)       | Texel owned by the plot; value lower than stored; within tool reach of the server-side pose (current or the last 8 ticks); removal rate at most 1.25 x the server-known tool at top sweep speed (2 s burst); plot within the dust radius before any state is created. Refused texels are skipped and the tile is resynced to the sender                 |
| Determinism           | Not needed across machines: state is merged by value, never replayed, so there is no four-engine golden requirement and no stroke log. The price: the result depends on **when** each client heard of the others. Two cleaners on one lane inside one latency window remove about half of what they remove one after the other (test "is not additive") |
| Consistency           | Every client is byte-identical to the server for the tiles it holds once messages are delivered (100 % in S4 and S6). Check: 5 B hash every 5 s; a mismatch asks for a resync                                                                                                                                                                           |
| Late join / reconnect | Never from stroke history: L0 for the moon + RLE tiles within 60 m (blocking), tiles out to the dust radius streamed at 8 KB/s. The private `fine` plane is lost (at most one level per texel of unfinished work)                                                                                                                                       |
| Checkpoint            | Whole world in one blob: economy, Polished list, one RLE tile per touched plot, CRC-32; refused when corrupt; `isDirty` flag. Robot jobs in flight and the server's robot `fine` planes are not saved                                                                                                                                                   |
| Robots                | Cannot be replicated as intents: the server paints lanes itself (1 s chunks, 150 chunks/s cap) and near clients receive tile deltas; far clients only L0                                                                                                                                                                                                |
| Anti-cheat            | See "Cheating surface"                                                                                                                                                                                                                                                                                                                                  |

### Cheating surface (acceptance criterion; security section 2 "No client strokes accepted")

Measured by `test/p3.test.ts`:

- **Accepted without any sweep**: a modified client that stands still and claims 5 cleared texels per second inside
  its reach is never refused (0 rejects) and earns **2.70 x** an honest player sweeping at 3 m/s for the same 30 s
  (7,438 g against 2,757 g). The rate bound caps the gain at the tool's legal maximum; it cannot tell a sweep from a claim.
- **Depth is not checked**: a texel can go from 15 to 0 in one upload whatever the tool's Depth; only the level budget counts.
- **Coverage is not checked**: lanes, overlap and tool width are whatever the client says.
- **Order steals credit**: the first upload to reach the server gets the credit for a texel; a low-latency client wins contested ground.
- Not possible: re-dirtying (minimum only goes down), painting outside reach or on another plot's texels, exceeding
  the legal maximum rate, creating server state far from the pose, crashing either side with malformed bytes (tested).
- Closing the gap means the server deriving the paint from inputs itself, which is P2.

## How to run (repo root, Node 26 on PATH)

- Tests: `node_modules/.bin/vitest run --root prototypes/dust-sim/p3-client-paint-minmerge`
- Types: `node_modules/.bin/tsc -p prototypes/dust-sim/p3-client-paint-minmerge/tsconfig.json` and `.../tsconfig.core.json`
- Harness: `cd tools/bots && P=../../prototypes/dust-sim/p3-client-paint-minmerge && node --import tsx ../../prototypes/dust-sim/harness/src/cli.ts run --adapter $P/harness-adapter.ts --grid $P/grid.ts --results $P/results/standard`
  (`--scenarios S4`, `--realtime --max-sim-seconds 60`, `P3_FLUSH_TICKS=1|2|4` for 20 / 10 / 5 Hz)
- Benches: `cd tools/bots && node --expose-gc --import tsx $P/bench/p3-bench.ts`, `.../bench/alloc-probe.ts [--split]`, `.../bench/s4-cap6.ts [bots] [seconds]`

## Numbers

See `docs/agent-reports/M1-W1-T05-terrain-dust-engineer.md` (same table as P1 and P2) and `results/`.

## Limits (open)

1. No GPU code: no dust shading, no detail ring, no captures, no edge width. The shared picture is 0.4 m texels at
   16 levels; a crisp ring can only exist for the local player's own strokes (remote strokes are unknown to a client),
   and is lost on rejoin.
2. The harness pose and tool are proxies (stroke end point, stroke tool); the scene setup batch bypasses the bounds
   (`trustNextUpload`) because it paints 80 m in one tick, which the bounds correctly refuse.
3. The drift check is only valid when the client has nothing unsent; a real client needs an acknowledged view
   (a second level plane per tile) or a per-tile "pending" exclusion. A local tile for a plot the server never
   touched is detected but not repaired by `resyncAll`.
4. Dust Cell capacity is not modelled (a full cell must stop pickup; here the client would have to be resynced).
   Inspector's Stamp credit shares (contributions) are not kept. All plots are Highland (the harness grid has no classes).
5. Interest entry scans every touched tile when a pose crosses a plot border (linear; fine for thousands of tiles).
   Streamed tiles are not sent nearest-first. 32 client slots, 1,024 robots.
6. Checkpoint is one blob, not the per-chunk two-version rows of data-model 3.7; in-memory store, not PostgreSQL.
7. Hash values are kept as signed int32 inside the core so they stay small integers on 64-bit Node; in a browser with
   31-bit small integers half of them box when they cross a call that is not inlined (not measured).
