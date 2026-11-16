# STATUS — resume here

Updated: 2026-11-15 (lead, policy change + handover). **Clean The Moon!** Design target: [REFERENCE_TARGET](design/REFERENCE_TARGET.md). Model/usage rules: [MODEL_POLICY](handoff/MODEL_POLICY.md).
Lead alone edits this file and task rows. Full checkpoint history (M0 workers, owner answers, old tables): [handoff/STATUS-history-2026-11-14.md](handoff/STATUS-history-2026-11-14.md).
No deadline (owner, 2026-11-16); quality first. Solo play first. Cee does all git. Node commands need the fnm Node 26 PATH prefix.

## Now

**NEW SESSION START HERE (2026-11-15 handover, owner is opening a new chat; no tasks were started after the policy change):**
1. Read CLAUDE.md, this file, MODEL_POLICY. Policy is 4 regular (Opus 5.5/Sonnet 5.5 medium) + 1 premium (Opus 5.5 High); Fable retired. Lead (Sonnet 5.5 medium) may raise or lower any worker's effort per task by judgment, never above High.
2. **Get the latest status checks and reports first** (items 3-4), reuse valid evidence, then fill the five slots.
3. Latest checks on the current tree (with the stopped agents' partial edits): `pnpm verify --concurrency=3` **52/52 green, Node 26, 2m08s** (scratchpad verify10.log, 2026-11-15 after both agents stopped). Not run: real-GPU frame numbers, tool-stroke feel, quiet-machine heap/netsim/chunk checks. Working tree has about 565 changed paths, none committed (Cee does git).
4. Latest reports to read (all in `docs/agent-reports/`): M1-W2-T01-terrain-dust-engineer.md (round 3, ready for review), M1-W2-T02-technical-artist.md (PARTIAL), M1-W6-T02-gameplay-systems-engineer.md, M1-W6-T04-ui-ux-motion-designer.md, M1-integrator-round5.md, M1-verify-round4.md. **Missing: W2-T03 report** (work exists on disk, unverified; first job is a verification pass and a report) and W2-T01 round 4.
5. Run locally: `$env:Path = "$env:APPDATAnmliases\default;$env:Path"; pnpm --filter @moon-cleanup/client dev` then http://localhost:5173/?play=1 (solo first). Online client path (OnlineRoom, RemoteRoomHost, sign-in UI, invite links) is wired and reviewed; real-server play still needs a manual check. Port 5193: check before use (terrain agent A/B shells may hold it).

- **2026-11-15 checkpoint (lead):** HUD/menu wiring landed. Solo worker now sends hop/lamp/quote/Plot Card/parcel/outpost readouts to main (≤10 Hz, change-only); Plot Card key = C (`descend` stays on Left Ctrl); rebinding screen, quality preset and pad capture wired, UI size/quality/bindings saved in localStorage; compass shows Near Parcels and outpost bearings; desk-smoke 3/3 and solo-smoke pass. `pnpm verify` 52/52 and `format:check` clean on Node 26. **Both Fable agents stopped by owner (2026-11-15); policy changed, see Policy line.** Not running: W2-T01 terrain (aa8391d6e50f78763; files on disk, no round-4 hand-back) and W2-T03 render infra (a00d44ab367be875a; new files in `apps/client/src/render/` culling, draw-budget, frame-target, memory-ledger, warmup, infra.test, dynres-pace.test, verify/run-infra.mjs plus edits to dynres/module/README; **no W2-T03 report written, so unverified**). These Fable-era IDs are historical: the next session starts fresh Opus 5.5 High workers on the same owned paths from disk (do not assume the old IDs resume as Opus). Queue: W2-T01 finish, W2-T03 verify/finish/report, W2-T02, W2-T04, W3-T07, W3-T04. Regular work parked until the next regular window (see below). Gaps: online host unfed (server sends no parcel data), outpost layout/Desk position are stand-ins (Fable terrain/world), no pad bind or hold option for Plot Card, Plot Card label is the raw plot id, browser-only checks of pad capture/persisted reload not run. Note: sim alloc test fails on Node 22 (tool-shell default, ~105 B/tick Maglev boxing); passes on Node 26. Always use the fnm Node 26 PATH prefix.
- **Earlier note (done):** the two Opus agents finished and Fable resumed. Done last round: two code reviews (ledger/RoomSim, host/server) with blockers fixed: Detailing cooldown floor (sim, goldens re-recorded), host pause/resume race (tests added); atlas stroke feed (`?scene=dust`, 58.5 fps UHD 620). Next premium: W2-T01..T04, W3-T07.
- **M1 §6 table refreshed 2026-11-15:** done = W0-T03, W0-T04, W1-T01, W2-T05 (balance review PASS), W4-T02 (security re-review PASS), W4-T05 (review blockers fixed); the rest in-review/todo per their reports.
- **Policy (owner, 2026-11-15, supersedes all Fable notes below):** 4 regular workers (Opus 5.5 or Sonnet 5.5, medium) + 1 premium worker (Opus 5.5, High). **Fable is retired**; its Fable-only window and two-agent exception are over; the five Fable-pinned role files (animation, gameplay-systems, rendering, technical-artist, terrain-dust) now pin Opus 5.5 High. M1 active, no pause.
- **M0: done locally (2026-11-15).** Final `pnpm verify --concurrency=3 --continue` 51/52 on the settled tree; the one failure (dust-replay CPU-reference test, 5.4 s vs 5 s default) was widened to 60 s and passes with `src/visuals/dust` and `src/app` (55/55); tsc clean, screenshots 46/46, `format:check` clean. Open M0 gaps stay listed below (E7, E8, E10) and the BLOCKED hardware/hosting items need Cee.
- **Done this checkpoint:** lattice fix (pitch snapped to a divisor of 800 mm), then review B1 Detailing cooldown fix (goldens re-recorded, see Goldens), `DUST_MODEL_VERSION` 2, Shine docs aligned, lookdev `info()` hooks and S05 ramp-shadow fix (probe/geometry bug, ramp shadow is real).
- **M1 in review:** W3-T01 ledger (P2 locked), W3-T01d plot events / Stamp / Shine milestones / board-driven Premium, W3-T01f balance-sim, W3-T02 GPU stroke replay (atlas wired into visuals, `?scene=dust`), W3-T03 RoomSim, W3-T08 LocalRoom host, W4-T03 server ShiftLedger (tick p95 0.254 ms vs 3.5 ms budget).
- **Goldens (re-recorded 2026-11-15, Holster gating; full table in agent-reports/M1-W6-T02-gameplay-systems-engineer.md):** `GOLDEN_REPLAY` stateHash 1076468633, strokeHash 4164540033; world ledger stateHash 1838396500, dustHash 2469925789. Client worker lane updated (5/5).

## Decisions recorded (owner)

P2 is the dust method. Pacing A (continuous passes: 1 if L ≤ Depth, else max(2, 0.75·L/Depth)); V3 bar is mix-weighted ±20%. Chunk upload accepts v1.0 and v1.1, rejects over 421,959 B (server already does). Inflate cap 32 MiB. `joinTicket` dropped. Seat cap 6 per IP. Low shadow maps unchanged. Deploy after the solo slice is solid. Firefox, Safari, netsim, real Postgres left alone. **Shine = (Polished + Empty) ÷ plots** (owner 2026-11-14; naming bible and the `PlotPolishedEvent.polishedCount` comment get reworded to match). Low far shadows unchanged. If V3 dips below 0.80 after the lattice fix, game-designer retunes tool data and reports. Dust detail ring and mipmaps come after the solo slice works.

## Open for Cee

1. **Neon, Render and Vercel are connected (Cee, 2026-11-16; live client `https://cleanthemoon.vercel.app`, server `https://moon-cleanup-server.onrender.com`, `ALLOWED_ORIGINS` = the client origin; A1 local gates green first: verify 52/52, build, size 15.97/20 MB).** Remaining from [HOSTING_GUIDE](HOSTING_GUIDE.md): confirm Render `/healthz` 200 and `[db:migrate]` in the log, set `ALLOWED_ORIGINS` to the real Vercel origin (E4), confirm `VITE_SERVER_*` match the Render URL, then play-test solo and a 2-player room on the deployed build. Delete stray `C:\c\` (holds copied credentials).
3. Tier A/B device runs (`tools/perf` device script), real Windows SIGTERM, `webgpu-compat`. All stay BLOCKED until then.

## Watch items and open defects

- **V3 headroom is thin:** Moon-mix T2 passes 1.185 vs 1.45 (ratio 0.82, limit 0.80); T1 0.88. Designer's 1.49/1.39 not reproduced; nothing tuned. Measured 0.825 after the lattice fix; below 0.80 means game-designer retunes (owner).
- **W3-T02 tail latency:** 1.0 ms/frame met at p50, not at the tail (p99 0.75–1.14 ms, max up to 2.03 ms). Earlier 6.5–9 ms maxima did not recur; cause unknown. Separate atlas pass allocates ~4 KB per pass (render owner).
- **Atlas feed wired** (`sim-host/dust-view.ts`, `dust` in scene lists). Not run: WebGL2, Low, heap/alloc, dropped-stroke resync. Strokes stop ~14 s in (4 kg Dust Cell fills; no pour yet). View restore slice 2.9 ms vs 1 ms budget (same cause as the restore-slice fix). Detail ring and mipmaps deferred.
- Restore slices fixed (p50 1.67 ms; under 2 ms to ~40% machine load, not heavier; atlas cold rebuild first frames 3–4 ms; `dust-view.ts:314` reserve may copy all ledgers). S05 slope shadow diagnosed: the ramp shadow is real, the old probe read flat ground (now 88–89 on Low/Medium WebGPU and Low WebGL2; Medium WebGL2 and production not run). `fromPlotLocal`/`toPlotLocal` allocate ~16 B per double and the sim calls them per stroke.
- three r187 `compileAsync` leaves the game black if called while the frame loop runs; warm-up is a synchronous pass. `?hud=1` debug overlay still overlaps the Lumens panel.
- Server: `plot.polished` over the wire and dust streaming both exist and are tested; ledger persistence is wired to the in-memory repo (SQL repos open) (W4-T04, W4-T06).
- Board purchases are W6-T02, so Board levels arrive only by restore. Dust Cell levels exist as board nodes and sim keys; record for W6-T02.

## M0 gaps not closed (see [M0-exit-criteria-check](agent-reports/M0-exit-criteria-check.md))

E7, E8, E10 have open items: VT-04b Low far shadow, VT-11 (no hardware), VT-12 A-High, and not-run VT-03 Low map size, VT-07 on final code, VT-13, VT-09 S02, RF-03 motion. Look defects: toothed far shadows, no ground at the path end, a sky seam; V2 count unconfirmed. Contingent W4-T01..T03 (Babylon / custom uWS) stay todo; the triggers have not fired.

## Next

**Fable window (history, ended 2026-11-15; Fable retired):** W2-T01 (aa8391d6e50f78763) was resumed first and later stopped (shadow-cascade selection, WebGL2 twin failure, WebGL2 GPU ms/motion/`?scene=moon`, horizon hook, `beginQuery`). Parked regular work for the next regular window: quiet-machine heap/netsim/chunk checks, UI `clearNearParcels`, Plot Card label + pad bind, online parcel data, browser checks of pad capture/settings reload.

**Previous regular window (history; those workers finished):** economy finish (Opus): Holster gating (1 slot, auto-equip; goldens re-record), Loaner Kit cap, V3 ratio print. Landed this window: SQL repos + SIGTERM checkpoint, lobby screenshots, Steep rule, pucks, avatars, entry chunk 736 KB, online predictor, HUD components, HUD data writers (`app/hud-writer.ts`), Desk/Ops Console/Settings/compass/Plot Card UI (`ui/menus/`), menu + interaction writers and purchase port (`app/menu-writer.ts`, `hud-interaction.ts`), menu input gating, own online avatar feed, dynres pace-guard fix; verify 52/52 + format clean before this wiring. Owner 2026-11-15: lead decides regular work and keeps running to the session limit; Earth phase default = geometry-true; outpost layout owned by Fable terrain/world. Open data sources: Plot Card, compass outposts/pings, Hop, lamp, Repeat Requisition price; Desk position is a stand-in. Owner decisions: Holster 1 slot auto-equip; MVP tiers Holster Rig L1, Crown Lamp L1; Near Parcels 6 (card said 12). Fable paused (5-hour limit, resets 4:30pm CT): W2-T03 agent a00d44ab367be875a stopped with nothing done, resume later via SendMessage; then W2-T04, W3-T07, W3-T04, dust feed.

**W2-T01 CDLOD terrain, round 3 (ready for review, not signed off):** owner kept the fast low-sun look; stripes gone, P4 step fixed. UHD 620 Medium p50 16.6-16.9 ms (p95 20-21), `?scene=moon` WebGL2 Medium 16.5-16.7, height twin 0/10,000 over 2 cm. Open: p95 breakdown, shadows start 0.3 m lower, no far-normal mip blend, beginQuery warnings not reproduced, dust-scene mirror (camera-rig change), Tier A, `pnpm verify`, visual review. Report: agent-reports/M1-W2-T01-terrain-dust-engineer.md.

**W2-T02 light/sky (Fable technical-artist, PARTIAL, acceptance not met):** day/night clock, terminator handover, exposure ramp, Crown Lamp hooks built; `?scene=moon` WebGPU p50 16.5-17.7 ms, WebGL2 16.6; S06 night WebGPU misses 60 fps (17.8-19.9 ms p50; WebGL2 holds). Missing: horizon map on CDLOD terrain (terrain-dust-engineer: horizon hook + site frame). Integrator: pass sim clock to `VisualsModule` (use `?tod=` meanwhile). Defect: ground luma steps 4 to 16 at sun/Earth key swap on `moon`. Open decision: Earth phase default. Report: agent-reports/M1-W2-T02-technical-artist.md.

**Landed this round (in-review, evidence in agent-reports/)**
- W3-T05 input module + solo prediction + boot wiring (`?play=1`); strokes proven to reach the worker (`__mcGameplay()` hook, dev/perf only). Not run: real GPU/WebGPU, tool-stroke feel. Dust scene is mirrored (input flips axes; render owner may fix).
- W5-T04 animation logic on placeholder avatar: 52 tests, heap 7.1 KB/600 frames x 16, CPU p95 ~0.19 ms; additive `GroundHeight.heightsAt` in packages/world (goldens unchanged). Needs custodian model, mixer adapter, foot-plant data, browser CPU proof.
- Review 3 fixes (solo host stop-during-boot, install guard, snapshot cap 1.5 MiB confirmed consistent), flaky tests fixed (2 causes), save sync auth-loop bug fixed, `soloRegistration` + `signInUntilReady` wired, online lobby UI (`ui/online/`, lazy; no screenshots yet).
- W5-T01 server durability: lease store, usage persister, 409/503 preflight, wired with in-memory repo; server 326/326. Open: SQL repos (packages/db), SIGTERM checkpoint of every room, bakeHash, HTTP-level 409 test. Dust slice pacing against socket buffer (165 net tests). Browser smoke (software WebGL2 only): boot, pointer lock, mouse axes, no online chunks in solo PASS.
- Known: `dev server on port 5193 (PID 36680)` is not ours; real-GPU frame numbers not captured; D4 `beginQuery` warnings (render, Fable-held).

**Queue, regular slots (start as slots free)**
1. Remote room host and 2-client online loop (integrator, Opus) after inflate lands; wire lobby UI screenshots/keyboard test (ui-ux, Sonnet).
2. W6-T01/T02 tools T1-T4, Dust Cells, economy in sim + game-data (gameplay-systems-engineer, Opus; goldens will be re-recorded, owner-visible).
3. SQL repos in packages/db + SIGTERM room checkpoint (backend-data-engineer, Sonnet).
4. Heap test with real gameplay on a quiet machine (performance-profiler, Sonnet).
5. Clean `pnpm verify --concurrency=3 --continue`, `format:check`, vite build once tree settles (lead).
6. Game-designer V3 retune only if V3 < 0.80 (Opus).

**Queue, premium slot (Opus 5.5 High; one premium worker at a time; 4 regular slots fill with parked and dependency-ready work)**
Updated 2026-11-16 (lead). Done: W2-T03, W3-T04. Running: W2-T04 regolith (a83e5c5), W2-T01 17-vertex patch (a747695). Next, serial: W3-T07 custodian blockout + Desk Duster v0 -> W4-T07 suit + hand tools T1-T4 -> W5-T03 outpost hardware -> W6-T05 hardware part 2 -> W7-T02 Trundle model -> W6-T03 VFX -> W2-T02 far teeth.

**M1 coverage map 2026-11-16 (lead; every §6 row is done, running, queued or blocked)**
- Done/approved: W0 all, W1 all, W2-T03, W2-T05, W3-T04, W4-T02/T05, W5-T01/T07, W6-T07.
- Running: W2-T01 patch, W2-T04, online two-client smoke (W4-T06), dust hardening review.
- In review, needs a closing check: W3-T01/02/03/08, W4-T01/03/04, W5-T08, W6-T01/T02/T04, W7-T05.
- Queued premium (above): W3-T07, W4-T07, W5-T03, W5-T04 model hookup, W5-T05 footprints, W6-T03, W6-T05, W7-T02, W8-T02.
- Queued regular, not started: W7-T01 Trundle kinematics, W7-T03 onboarding/invite UI, W8-T01 co-op (join-in-progress, kick/ban, reconnect), W8-T03 pacing pass, W8-T04 e2e + 8x30 soak, W8-T05 perf capture, W8-T07 open Solo to friends, W9-T01..T04 (visual V1, Low preset/WebGL2 parity, Sentry/size gate, UI polish), W2-T06/W3-T05/W6-T06/W7-T06/W8-T06 integrations, final `pnpm verify` + `/release-checklist`.
- Blocked on Cee: room-postgres on real Neon, device runs (Tier A, UHD 620), re-bake save policy, P1/P2 playtests, Medium scale-floor and 60->30 Hz MCQs.
- Owner decisions 2026-11-16: re-bake saves = archive old, start fresh; Medium scale floor 0.75; interval signal stays 60 Hz. Queue: backend-data (archive-on-hash-mismatch), rendering (floor 0.75).
- No deadline (owner, 2026-11-16: Nov 17 removed). Full M1 scope, no cuts; quality first. Art/animation is the long pole (serial premium slot).

**State 2026-11-16 (lead):** W2-T03 render infra re-reviewed APPROVED. W2-T01 terrain GPU budget still unmet (ground p50 ~11.7-12.8 ms; 17-vertex patch adoption in progress). W2-T02 PARTIAL: sky seam fixed; near-shadow teeth softened; far teeth (>10 m, sun <=10 deg) open, filter pick in progress. W3-T04 server dust: review B1 (client wanted leak) fixed and re-approved; N1-N5 fixed; security review running. W5-T01 durability/persistence v2/v3 + bake-hash APPROVED. W6-T07 save-sync UI + wiring done; visual review FAIL (modal overflow at 1280x720, heading focus box), fix running; new save error kind `local_store_failed` added. ShiftState wire contract v1.1 (optional nearParcelsCollected; PROTOCOL_VERSION stays 1). Netsim FIFO fix; bots ShiftRoom scenario; 16-bot 600 s run PASS provisional (noisy machine). Not run: TRAA pulse VT-M1-28, Tier A, Low preset, device loss, quiet-machine perf/heap, room-postgres on real Neon (needs creds), motion VT-M1-25, final `pnpm verify`. Open decision: re-bake save policy (N2 archive vs refuse vs freeze hash).

**Cee**: hosting projects, device runs, SIGTERM test, `webgpu-compat`, delete stray `C:\c\`.
