# M1-W5-T08 - Client checkpoint sync (netcode-engineer)

Task / status: in-review (implementation + Node tests done; browser, real-server and e2e lanes NOT RUN) / 2026-11-15 / netcode-engineer / Sonnet 5.5

## Done
New folder `apps/client/src/sync/` (barrel `index.ts`; no edits to sim-host, net, server or shared). Event/timer driven: no per-frame code, no allocation on the frame path, no awaited work in the `save.checkpointed` listener.
- **Upload queue (newest only):** marker per Contract (persisted in its own IndexedDB `moon-cleanup-sync`, memory fallback). At most every 120 s while dirty; urgent (hidden/pause/clock-out/handoff) but never under the server's 20 s; only after first user interaction; off for webdriver/bots (`shouldProbe`); held while `navigator.onLine` is false. Sends only dust rows written after `baseGeneration` (rows carry their generation), full set for an overwrite.
- **Retry/offline:** 30 s doubling to 5 min, +/-20% jitter, `retry-after` raises. Network error and Render's waking page (502/503/504 without our JSON) = `offline` (queue held, not an error). 429 = pending. 422/413/version/too-large = `error`, retried only on the next checkpoint or an explicit flush. 401 = one token refresh, then hold until `notifyAuthChanged()`. Online event and first interaction retry at once.
- **Package limits:** MCCK encode/decode (bounded, fuzzed); accepts v1.0 and v1.1 (chunk raw size <= 421,959 B, refused above); upload package <= 1 MiB (single request); inflated total capped at 32 MiB on build and on download; header inflate capped at 1 MiB; chunk inflate capped at its declared size.
- **Head check / restore / conflict** per `save/sync-rules.ts`: `decideHead` (pure, tested) -> silent upload, silent download (second device or server descends), `conflict` state with `save.conflict`. `keep_local` (server copy to backup first, overwrite with generation max+1 and full chunk set, then rebase local header via install port), `use_server` (local to backup, install server copy), `restoreBackup` (new generation on top, current copy swaps into the slot), 7-day retention. Download pages must share one generation (restart up to 2x), all chunks CRC/size verified.
- **Local-only Contracts:** `attach(id, {name, seed})` registers with `clientContractId` before first upload; quota/refusal keeps it `local_only` with `error` set.
- **Clock In without blocking:** `clockIn(id, {maxWaitMs})` returns `background` if the server is silent (cold start); a newer server copy found later becomes a prompt, never a silent swap under a running host.
- `flush(id, reason)` for pause/Clock Out/handoff: resolves `accepted | nothing_pending | conflict | failed | blocked` (open-to-friends needs `accepted`).
- Writes the `saveSync` slice through an injected `sink`; emits `save.queued/synced/upload_failed/conflict/resolved/restored/backup_stored`; consumes `saveSync.request` via `handleRequest` and clears it.

## Hook points needed (not edited, by instruction)
1. **sim-host `LocalInstallPort`** (app wires): stop/pause worker, `store.save(record, dust)`, reboot host so its generation counter continues after `record.generation` (used by restore, use_server, keep_local rebase with `dust: null`, restore backup).
2. **sim-host barrel** should export `CheckpointStore` types (sync uses structural copies) and, ideally, record `crc32` of the uncompressed payload on dust rows (`StoredDustChunk.crc32?`; sync uses it if present, else inflates once and caches).
3. **app**: `SaveSummaryProvider` (playtime, Shine, wallet, device label from the UI store; default `tickSummaryProvider` has no wallet/Shine), `gameDataVersion`, wire `events` + `sink` + `saveSync.request` + `notifyAuthChanged`, and call `clockIn` / `flush("clock_out"|"handoff")`. The main thread must read an IndexedDB store (a memory-fallback store is invisible to it).

## Risks / contract notes
- Package > 1 MiB cannot upload (server has no multi-part route): reported as `too_large`. Downloads cap at `CHECKPOINT_MAX_PARTS` = 4 pages while the server stores up to 8 MB: a very large save may be uploadable but not restorable.
- An overwrite cannot delete server chunks that local lacks (protocol has no delete); the server copy's extra chunks survive. Needs a server rule (replace-all on `overwrite`) or full-chunk semantics.
- Same-generation 409 after a lost response relies on the server's replay handling; no client heuristic.
- `src/sync/mcck.ts` is a candidate to move to `packages/protocol`.

## Evidence (Node 26.13.1, Windows, this file state)
`vitest run src/sync`: 2 files, 32 tests passed (CRC/envelope/MCCK round-trip, truncation and 300-mutation fuzz, 32 MiB bomb, mixed generation, backoff, classification, decideHead, upload queue, offline/backoff, waking page, online retry, too_large, second-device restore incl. multi-page, silent fast-forward down, divergence, keep_local, use_server + restore backup, registration/quota, background Clock In, flush). `tsc` clean for `src/sync`; `eslint src/sync` clean; `prettier --check src/sync` clean. Fake server honours fast-forward/409/429/paging; virtual clock. NOT RUN: real server/uWS, real IndexedDB, browser Playwright e2e (E15), netsim, `pnpm verify`.

Files: `apps/client/src/sync/{index,save-sync,save-api,copy,mcck,envelope,meta-store,gate,backoff,compress,crc32,yield,limits}.ts`, tests `codec.test.ts`, `save-sync.test.ts`, `test-support.ts`.

Commit suggestion: feat(client): background solo checkpoint sync with backoff, head check, restore and conflict handling (M1-W5-T08)
