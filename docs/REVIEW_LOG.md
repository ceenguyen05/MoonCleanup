# Review log

Chronological record of independent reviews and what changed because of them.
Planning-session reviews come first; during the build, the lead appends one entry per review gate
(detailed reviewer reports live in `docs/agent-reports/`).

| Date | Gate / scope | Reviewer(s) | Verdict | Changes made | Link |
| --- | --- | --- | --- | --- | --- |
| 2026-11-12 | Planning handoff — architecture & netcode | principal engineer (independent subagent) | Not ready for dust/netcode/persistence: 2 BLOCKER · 17 MAJOR · 12 MINOR | All fixed | [review](agent-reports/planning-review-principal-engineer.md) · [fix](agent-reports/planning-fix-engineering.md) |
| 2026-11-12 | Planning handoff — progression, pacing, parity, naming | game designer (independent subagent) | Not ready: 5 BLOCKER · 19 MAJOR · 10 MINOR | All fixed; ~30 names replaced | [review](agent-reports/planning-review-game-designer.md) · [fix](agent-reports/planning-fix-design.md) |
| 2026-11-12 | Planning handoff — visual bar vs budgets | technical art director (independent subagent) | Conditional pass: 4 BLOCKER · 17 MAJOR · 9 MINOR | All fixed | [review](agent-reports/planning-review-technical-art-director.md) · [fix](agent-reports/planning-fix-art.md) |
| 2026-11-12 | Planning handoff — can Fable start? | Fable dry run (independent subagent reading only handoff docs) | 3 BLOCKER · 12 MAJOR · 21 MINOR | All fixed | [review](agent-reports/planning-review-fable-dry-run.md) · [fix](agent-reports/planning-fix-handoff.md) |
| 2026-11-12 | Cross-file routing + gap audit + final consistency | lead + router/docs-keeper subagents | — | See below | [architecture](agent-reports/planning-route-architecture.md) · [visual](agent-reports/planning-route-visual.md) · [milestones](agent-reports/planning-route-milestones.md) · [final](agent-reports/planning-final-consistency.md) |

## Planning session (2026-11-11/12) — what changed because of the reviews

### Architecture & netcode (principal engineer)
- **One dust spec:** `world-and-dust-simulation.md` is canonical (chunking, stroke encoding, ledger, interest radii, echo/reconcile, drift check); netcode/data-model/security reference it instead of restating it.
- **Ledger fixed:** plots can reach Polished with starter tools; ops are sequenced per tick by the server so client ledgers can't drift (ADR-0026, test vectors required).
- **Saves:** A/B header slots + dirty dust-chunk rows written in one transaction, two versions per chunk stamped with `save_seq`; load rule defined (ADR-0016 amendment).
- **1 GB DB capacity policy** (≤3 owned Contracts/player, per-Contract caps, compaction of abandoned Contracts, 800 MB refuse line).
- Lease + matchmaking by contract id (no duplicate rooms); input sequence dedupe; roles Holder/Supervisor/Staff/Temp everywhere; horizon-based interest management; wake probe on first title-screen interaction only; `MAX_ROOMS` = 3 ceiling with tick-budget admission; refresh-token reuse grace window; client IP from the documented Render header only.
- `render.yaml`, `vercel.json`, `turbo.json`, CI rewritten to match the docs; ADR-0025 (netcode revision) supersedes ADR-0015.

### Design (game designer)
- Solo late game keeps player agency (robots run at full rate only while someone is actively cleaning; player-directed robot targeting; hands-on Performance Review tasks).
- On-Shift Bonus anti-farm rules; shift-level Shift Docket (no compounding); building-on-dust rule; complete balance-sim spec; first Inspector's Stamp at ~6 min; Roost + Sandpiper in MVP.
- Pacing re-verified: solo ≈31 h, 4 players ≈15 h, 16 players ≈9 h.
- ~30 names that were close variants of the reference "do not use" lists were replaced (rename map in the fix report, applied repo-wide).

### Visual bar (technical art director)
- Contrast gate made achievable under AgX (ratio ≥ 1.45 and ≥ 50 sRGB codes; albedos 0.085/0.34).
- `rendering-pipeline.md` §14 is the single canonical quality-preset table; tiers named Tier A/B/C, backends `webgpu`/`webgpu-compat`/`webgl2`.
- Shadow checks at 60°/15°/4°/1° sun; up-facing fill; metal reflection probe; shadowed Crown Lamp; horizon map; measurable dust thinning, ring↔atlas handoff, footprints; lane stripes supported via an R8 stroke-direction texture; objective comparator that never stores reference images; 3D-asset production plan (art-direction §13, ADR-0027).

### Handoff (Fable dry run)
- One explicit install exception (M0-W0-T02 performs the first install; afterwards only devops between waves); Gate G0b; wave file written before launch; permission-mode guidance; T03 owns the bootstrap stubs; prototype install rule; render spike moved after look-dev on the real height cube; 3D-art tasks added to M1.

### Lead's own audit
- Added the three missing build specs: `docs/design/animation-spec.md`, `game-feel-and-controls.md`, `ui-screens-and-flows.md`.
- Wave cap set to 6 tasks per wave, never more than 3 running at once (one stage per usage window).
- All GitHub Actions pinned to verified commit SHAs; pin check enforced; actionlint clean.
- Title renamed to **Moon Cleanup** (slug `moon-cleanup`, packages `@moon-cleanup/*`) repo-wide.
- Sun path decided (great circle through both poles at longitude 45°/225°; Twilight Strips); Earth 2.4°; Offline Solo is post-launch.
