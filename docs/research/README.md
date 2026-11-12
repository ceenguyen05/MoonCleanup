# Research — index, synthesis and resolved contradictions

Collected 2026-11-11/12 by parallel research subagents (briefs required source URL + access date for every claim). These files are **evidence**: briefs cite specific sections; nobody needs to read them end to end.

## Index

| File | Topic |
| --- | --- |
| [moon-sweepers-mechanics.md](moon-sweepers-mechanics.md) | Reference game systems, unlock order, world (163,842 plots), pacing, **do-not-use names §8** |
| [moon-sweepers-reception.md](moon-sweepers-reception.md) | Reviews, complaints → mitigations, patch history, virality |
| [roblox-references.md](roblox-references.md) | Sweep The Moon / Clean the Moon! and clones: meta layers, retention, **do-not-use names §9** |
| [visual-analysis.md](visual-analysis.md) | Reference board (links), visual breakdown, lunar photometry, measurable criteria |
| [browser-feasibility.md](browser-feasibility.md) | WebGPU/WebGL2 support, hardware tiers, budgets, mobile verdict, headless testing |
| [asset-and-data-licensing.md](asset-and-data-licensing.md) | NASA/LOLA/LROC/SVS, stars, CC0 libraries, Mixamo, audio, fonts, Git LFS |
| [mechanics-parity-matrix.md](mechanics-parity-matrix.md) | Every mechanic: reference vs Roblox vs ours (MVP/v1.0/later) + our names |
| [tech/](tech/) | Rendering advocates (three.js, Babylon, PlayCanvas), netcode advocates (Colyseus, raw WebSocket, WebRTC/WebTransport), platform limits, data/auth/observability, terrain & dust techniques, tooling versions, Claude Code formats |

## Synthesis — what the research changed

1. **The genre is real and hot.** Moon Sweepers (DragDrop Games, 23 Oct 2026, $8.99, Unity, 1–16 co-op) peaked at 83k concurrent; ~78% positive. Roblox copies appeared within days (Sweep The Moon ~33k CCU peak). Hook: "clean the whole Moon starting with a comically tiny tool"; satisfying visible clean strips; co-op chaos; streamer "100%" videos.
2. **Mechanics to mirror** (structure, not names/numbers): 6 hand tools + build tool; per-tool containers ×3 levels; 23-node/5-branch tree; 5 suit lines; 5 vehicles + 7 upgrade lines; 2 local robot tiers + 1 global; belts/splitter/merger/packager; 2 production machines + 3 solar sizes; 4 fixed stations; teleport-to-visited; 12 shared waypoints; 60-min day/night; 163,842 hex plots, R ≈ 2 km, done at ≤1%.
3. **#1 complaint = pacing cliff:** every upgrade is bought by 0.5–5% of the moon (~6–8 h), then ~30 h of robot-fleet waiting; hundreds of robots also tank FPS. → Our economy spreads unlocks across the whole contract and uses fewer, upgradable robots (see progression-and-economy.md).
4. **The reference look is stylized** (chibi astronauts, toy-like machines, washed-out white ground, blue nebula sky). Its strength is readability of cleaned strips. → Ours: "bright, readable stylized realism" with original designs and real lunar lighting cues.
5. **Platform reality for $0:** Render Free 0.1 CPU/512 MB, 15-min spin-down, ~1-min cold start, 5 GB/month egress; Aiven free **MySQL retired** → PostgreSQL Free; Vercel Functions can't host 30 Hz rooms; no UDP on Render.
6. **Browser reality:** WebGPU ~81–89% coverage (Chrome/Edge all desktop, Safari 26, Firefox Win/macOS); plan ~11–19% WebGL2 fallback. Mobile out of scope. Tier A = RTX 4060 Laptop-class; Tier B ≈ 0.3–0.4× (Iris Xe / Arc 140V / 780M).

## Contradictions and how we resolved them

| Topic | Conflict | Resolution |
| --- | --- | --- |
| Gaia star data license | Brief assumed CC BY-SA 3.0 IGO; ESA says **CC BY-NC 3.0 IGO** | Don't use Gaia; use HYG (CC BY-SA 4.0) |
| Vercel WebSockets | Changelog says GA (2026-10-20), KB says beta; 300 s max duration on Hobby | Irrelevant: static client only on Vercel |
| Node version | Platform report: pin 24.x; tooling report: 26 is Active LTS since 2026-10-28, Vercel default 26.x | **Node 26 LTS** (uWS has Node 26 binaries) |
| Three.js vs Babylon scores | Advocates self-scored on different scales (36/50 vs 43/50) | Lead normalized with brief weights → three.js 4.05 vs Babylon 3.98; Babylon is the documented fallback (ADR-0003) |
| Moon Sweepers peak CCU | 62k / 70k / 83k on different dates | Not contradictory; SteamDB 83,138 on 2026-11-01 |
| Sweep The Moon crew size | "up to 4 friends" vs 20 per server | 20 = server cap, 4 = per-moon party (M confidence) |
| Upgrades shared vs personal (reference) | Manual says personal; patch 1.0.3 made them shared | Shared (patch notes win) — we mirror shared |
| Global robot speed (reference) | ~5 min/sector (pre-1.0.4) vs ~70 s | Use post-patch figures for pacing benchmarks |
| HowLongToBeat | Blocked; snippets claim ~35 h | Use post-1.0.4 player reports (30–40 h solo) |
