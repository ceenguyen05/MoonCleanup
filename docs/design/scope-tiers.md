# Scope tiers — Clean The Moon!

Direction: `docs/design/REFERENCE_TARGET.md` overrides retired naming/style/custom-gate rules.

Status: **Draft v3, reference-mode reconciliation (2026-11-12).** Owner: game-designer; tier boundaries are approved by Cee.
Versions follow [ROADMAP.md](../ROADMAP.md): `v0.1.0` = M0 foundation, `v0.2.0` = M1 / MVP, `v1.0.0` = M2 / mechanics parity.
**Reference mode:** core purchases unlock by money plus ordinary equipment/upgrade-tree prerequisites; robots work at their calibrated base rate; robot dust sells at the ordinary material price. Custom ★ progression (Performance Reviews, Pilot Review, On-Shift/Effort/Unattended, Bulk Rate, Flight Plan, Refits, Work Front, Grades II–III, Dockets, meta layer) is listed in §2.1 as optional backlog, not baseline scope.
Every mechanic's tier is also listed in [mechanics-parity-matrix.md](../research/mechanics-parity-matrix.md). Numbers live in [progression-and-economy.md](progression-and-economy.md).

**Tier rules.**
- **MVP** = the smallest *fun, multiplayer* vertical slice that meets the visual bar in a small area. It must prove the risky things: the dust feel, the shared world over the network, persistence, **server-side robot simulation and sync**, and the first two hours of pacing — and it must show the genre's arc **tool → vehicle → robot**.
- **v1.0** = full reference-system parity; custom ★ additions are optional unless explicitly retained under REFERENCE_TARGET.
- **Polish** = no new systems, only quality.
- **Post-launch** = backlog, not promised.

---

## 1. MVP (`v0.2.0`) — "Boreal Pilot Area"

The full Moon (GP(128,0), 163,842 plots) exists and renders from orbit. Play is limited by a soft **Pilot Fence** to the **Boreal Pilot Area**: every plot within 900 m of Outpost Boreal, about 2.5 km² or 8,160 plots, mostly Highland. Numbers are the v1.0 ones; MVP pacing has its own sim policy (`mvp`, [economy §22](progression-and-economy.md#22-balance-sim-specification-toolsbalance-sim)) because MVP has no Puck Former, rails or Assembly Gun.

Changes from the v1 MVP plan (review M14): **added** the first local robot (Roost + Sandpiper); **cut** the Survey Globe, Flare Beacons, the Skiff, all vehicle upgrade lines, Holster Rig L2–3, Crown Lamp L2 and 7 of the 10 achievements.

| Area | MVP scope | Exit criteria |
| --- | --- | --- |
| World | Real sphere terrain (CDLOD, baked LOLA heights) for the whole Moon. Pilot Fence at 900 m with a DOT message. Terrain classes and dust levels per economy §1, including the outpost compound and the 6-plot **Landing Apron**. | Walk to the fence in all directions with no cracks or pops at Tier B quality |
| Visual bar | One hero scene: Outpost Boreal at low sun; dust trails readable at 1 m and from 50 m; Earth in the sky; day→night transition; Inspector's Stamp VFX | Passes `visual-target.md` screenshot review (visual-qa-reviewer) at native resolution |
| Plots | Grimy/Opened/Polished, server ledger, integer thresholds and recount, Plot Card (C), Inspector's Stamp (50 LM), Shine to four decimals + albedo readout | 8 bots × 30 min: zero stuck plots; client and server Shine agree |
| Hand tools | Desk Duster, Crescent Squeegee, Bristle Broom, Lane Broom (T1–T4) with traits Detailing, Flick, Sure Footing and Lane Lock | Sweeping feels good (internal playtest ≥4/5); Lane Lock works |
| Dust Cells | Levels I–III for T1–T4; full Cell stops pickup | — |
| Dust Pucks | Form (F) and band into Puck Stacks (hold F), carry, drop, throw (Q), pour back into a Cell; loose-puck caps (20 per player, 200 per contract) and merge | Pucks sync for 16 players |
| Selling | Assay Counter (hold-to-pour, 4 pour slots, ka-ching); Receiving Gate fed by the Motor Pool's Dump Plate; Railshot visual every 2 t | Payment server-authoritative; the wallet never desyncs |
| Promotions Board (subset) | Hub; Storage Cell lines T1–T4 + Densifier; Broad Strokes; Scour; Cadence; Quick Pour; Rate Review (10 of 23 nodes) | Shared purchase races resolved server-side |
| Suit gear (subset) | Holster Rig L1 (2 slots), Crown Lamp L1 (Clip Light) | — |
| Vehicles | Motor Pool **pre-built** at Boreal (no Assembly Gun in MVP). **Trundle only**, per player, no upgrade lines; Repeat Requisition | 16 players driving with no rubber-banding at 120 ms ±30 jitter |
| Robots | **Roost + Sandpiper** (no Plover, no Albatross). One Roost pad pre-built at Boreal (no Assembly Gun in MVP); the first Roost is **bought with money** (4,500 × 1.15^(n−1)) from its Equipment Card and deploys on that pad. Up to **3 Roosts** (MVP technical cap, shown as "Roosts 1 / 3"). Free one-click **Re-site** anywhere in the Pilot Area. MVP-only stand-in for rails: the Roost store pays on arrival at the ordinary dust price ("Roost Uplink"). Robot states, Equipment Card with status line. Robots work at their **calibrated base rate** whenever the room is active, independent of player count or activity | Server sim of 3 Roosts × 16 shifts within the tick budget; robot positions and plot changes sync to 16 clients within the bandwidth budget; robots keep working at base rate with nobody nearby; nothing accrues while the room is suspended |
| Day/night | 60 min (30/30), contract starts at sunrise, Clip Light, night penalty, minimum-visibility floor | — |
| Navigation | Compass (outposts, nearest-outpost arrow, pings) and Spot Check | — |
| Robot suggestion | Tutorial only: once the shift owns a Trundle and can nearly afford a Roost, DOT suggests buying one ("The pad is pre-built. The robot is not. Requisition pending."). No quest gate, no free robot; the Roost is purchasable from the start | See MVP pacing below |
| Exploration | 6 Near Parcels within 300 m of Boreal (Induction step 8) | — |
| Onboarding | Induction Checklist (8 steps), DOT text tips, DOT Handbook (H) | New tester buys the Crescent Squeegee in 5–10 min unaided |
| Co-op | **Solo Shift and Private Shift** (invite code/link, up to 16), shared wallet and upgrades, per-player tools and vehicles, join-in-progress with Standard Issue, reconnect grace, Holder kick/ban; one AFK policy (On Break after 10 min without input; idle clients closed after 30 min per netcode §10; the room checkpoints and suspends when no client is connected) | `/bot-test`: 16 bots, 10 min, within tick and bandwidth budgets; robot output identical with 1 or 16 bots connected |
| Accounts & persistence | Guest auth (opaque refresh + JWT). One Contract per player. Checkpoint ≤30 s, on empty, on SIGTERM. Resume after a Render cold start with a "waking server" screen | Kill the server mid-session: ≤30 s of progress lost; contract resumes |
| UI | HUD (wallet, Shine, Cell gauges, compass, suit icons, Next Requisition tracker), Requisitions Desk, Ops Console (board subset), Motor Pool UI, Roost panel, settings (remap, accessibility basics) | KBM and gamepad complete |
| Audio | Helmet-muffled SFX set (sweep, pour, stamp, Trundle, Sandpiper chirps), day and night ambient beds, DOT chime | — |
| Achievements | 3: First Light, Stamped, Shift Work | — |

**MVP pacing (policy `mvp`; hand-derived like economy Appendix B, to be confirmed by the sim):**

| Milestone | Target | Solo estimate | 4 players | Confidence |
| --- | --- | --- | --- | --- |
| First Inspector's Stamp | 5–8 min | 5.9 min | ≈3 min | Hand-derived (economy §18.2) |
| Crescent Squeegee | 5–10 min | 5.9 min | ≈3 min | Hand-derived |
| Trundle (Motor Pool pre-built, 1,800 LM) | 1–1.5 h | 1.1 h | ≈0.4 h | Hand-derived |
| First Roost bought (4,500 LM, pre-built pad) | 1.5–2 h | ≈1.5 h | <1 h | Estimate: Trundle income ≈12–14k LM/h from 1.1 h (economy Appendix B); replaces the former Pilot Review row (1.8 h); sim to confirm |

**Explicitly not in MVP:**
- Assembly Gun and building, Puck Former and rails.
- Plover, Albatross, Flight Plan, production and power.
- T5–T6, Skiff, Bulldust, Behemoth, Carryall, all vehicle upgrade lines, Refits.
- Survey Globe, Flare Beacons, Work Front.
- Hop Pack, Ballast Soles, Lowlight Visor, Holster L2+, Crown Lamp L2+.
- Other outposts and the Relay Pad.
- Open Shifts, Loaner Kit.
- Any optional ★ custom progression (§2.1), including the Pilot Review, On-Shift Bonus, Shift Docket and Tenure/Commendations.

## 2. v1.0 (`v1.0.0`) — mechanics parity (reference mode)

| Area | v1.0 scope |
| --- | --- |
| World | Whole Moon playable; 4 outposts (Boreal, Austral, Dawnside, Duskside) with Assay Counter, 4 Receiving Gates, Railshot, Requisitions Desk, Ops Console, Relay Pad, Break Room (Rock Garden, Postcard Rack, Earthview Window, Hold Music); Landing Aprons; Steep plots; Outpost Recall; Twilight Strips |
| Tools | All 6 tools + Assembly Gun with all traits; all 18 Dust Cell levels |
| Promotions Board | All 23 nodes and prerequisites; no capstone is milestone-gated (parity) |
| Suit gear | All 5 lines, 14 levels (Holster Rig, Hop Pack, Ballast Soles, Crown Lamp, Lowlight Visor) |
| Vehicles | Trundle, Skiff, Carryall (8 seats), Bulldust, Behemoth (all money-gated, Motor Pool required); all 7 upgrade lines; Motor Pool (one vehicle out each), Dump Plate, Dust Vault; tricks and callouts (Hang Time, Moonshot!, Lunar Loop, Corkscrew, Faceplant) with a capped, driver-only payout |
| Robots | Roost + Sandpiper → Plover, Albatross + Nests + Bale Chute; Equipment Cards, states, Grounded switch, Re-site and Survey Globe robot layer; calibrated base rate independent of player activity; ★ fixed visible technical caps (24 Roosts / 24 Albatross; economy §9.2) |
| Logistics | Puck Former, Puck Stacks, Glide Rail family with Rail Run, Rail Fork, Rail Join, Rail Stop, Receiving Gates (3 rail inputs + Bale Chute), ★ Field Gate (money-gated buildable selling point); one price per material regardless of origin |
| Production & power | Bead Kiln, Tile Sinterer (money-gated; ★ machine cap 14); Sun Sprig, Sun Fan, Heliostat, Night Cell; wireless power radius; sun-elevation solar model; status lines |
| Building | All 98 pieces; Place / Reposition / Reclaim (refund = price paid); snapping; ★ Settle on dust; 6 finishes (all from the start); no-build zones; author tags and Revert |
| Economy | Stamp + Stamp Premium + Golden Handshake + Charge, Repeat Requisition, Standard Issue, Relay and Recall fees; robot dust at the ordinary material price |
| Shine milestones | Celebrations at 1/5/10/25/50/75% (DOT toast, music layer, achievements); no unlocks or cash |
| ★ Last-1% toolkit | Survey Globe anywhere with heat layer, Spot Check, Punch List (ungated), Clean-up Orders and the Brightside Service Call |
| Exploration | 150 Stray Cargo (32 Near Parcels, 58 Parcels, 45 Crates, 15 Pallets), 24 Survey Points with DOT site memos |
| Co-op | Solo, Private and **Open** Shifts; Shift Board listing; Holder/Supervisor/Staff/Temp roles; Loaner Kit; Incident Report → Revert; vote-kick (including Temp vote-kick); persisted bans; one AFK policy; chat with rate limit, mute, report, Read Aloud |
| Session | Shift Briefing, Next Requisition tracker with partial-progress pings, Shift Report |
| Onboarding | Induction + Probation Checklists (suggestions, never gates); Field Trip; contextual DOT tips; DOT Handbook |
| Meta | Contracts list (hold 3); Locker cosmetics (defaults + achievement unlocks); all 33 achievements |
| End | Contract Fulfilled ending (~60 s), rewards, Showcase Moon free-roam |
| Tooling | `tools/balance-sim` implementing economy §22 in reference mode, regenerating the §17/§18 rows marked "regenerate" and meeting all `pacing-targets.json` rows; data in `packages/game-data` per economy doc §21 |
| Accessibility | Everything in GDD §13 |

### 2.1 Optional custom progression (★, backlog, not in the reference-mode baseline)

Parked per [REFERENCE_TARGET](REFERENCE_TARGET.md) and ADR-0030. Designs and numbers stay in [economy §24](progression-and-economy.md) and [GDD §18](GDD.md). None is v1.0 scope or a launch gate unless Cee pulls it in deliberately; it then needs a fresh balance-sim run and unlocks by money plus prerequisites unless the Review system comes with it.

| Item | Former tier | Baseline instead |
| --- | --- | --- |
| Performance Reviews 1–6 with Briefs, free issues, Review permits, participation rewards | v1.0 | Shine milestone celebrations; fixed technical caps |
| MVP Pilot Review (25 plots, granted the first Sandpiper) | MVP | Money purchase plus a DOT suggestion |
| On-Shift Bonus, Effort, Unattended ×0.5, subnet/Tenure anti-farm rules | MVP | Robots at base rate |
| Bulk Rate (25% raw Bales) and provenance pricing | v1.0 | One price per material |
| Flight Plan (5 lines, 15 levels), Auto-Relocate, Homing I/II | v1.0 | No robot upgrades (reference) |
| Refit I–III | v1.0 | Vehicle ladder + 7 upgrade lines |
| Work Front, Flock Formations, Escorted credit | v1.0 | Albatross take the nearest dusty plot |
| Machine Grades II–III | v1.0 | One size per machine |
| Remote Assay, Carryall Convoy, Final Walkthrough, Closing Bonus, Core Samples | v1.0 | Ordinary selling points, driven Carryall, last-1% helpers above |
| Shift Docket, Brightside Monument | v1.0 (Docket placeholder in MVP) | Next Requisition tracker |
| Tenure, Commendations, Certifications, Benefits Package | v1.0 (Tenure stub in MVP) | Contracts, Locker, achievements |

## 3. Polish (between v1.0 and wide release; no new systems)

| Item | Notes |
| --- | --- |
| Pacing tuning from playtests | Hit the target bands at P50 with P10–P90 inside ±20% |
| Photo mode | Free camera, hide HUD, filters, Earthrise presets (clip-friendly, cf. virality [R§3]) |
| Beacon Run time trials | Uses existing Flare Beacons and vehicles; cosmetic rewards; promoted to full feature in the Showcase Moon |
| Survey Globe and Punch List UX | Filters, search by Plot ID, export Flare Beacon routes |
| Performance passes | Tier A/B budgets with robots and machines at their technical caps, 16 players and a full solar farm |
| Audio polish | Full music layers per Shine milestone, Hold Music track list, mix pass |
| Localization pipeline | String tables (no machine-translated shipping text without human review ★ [R C13]) |
| Tutorial polish | Probation pacing, DOT barks, first-night experience |
| Break Room activities | Rock Garden pattern gallery per contract, Postcard Rack messages |
| Achievement balance | Make sure no achievement needs AFK grinding (and Tenure, if the optional meta ships) |

## 4. Post-launch backlog (not promised; order is a suggestion)

| Item | Why / notes |
| --- | --- |
| **Moonlet Contracts** (GP(64,0), 40,962 plots) | 8–10 h solo contracts for shorter commitment (tech-stack ADR-0007 sizes). Needs its own technical caps in `caps.json` |
| **Offline Solo worker** | Run `packages/sim` in a Web Worker for fully offline Solo Shifts (ADR-0015 keeps the sim transport-free); sync to the server later |
| **Night Shift** (capped offline robot catch-up) | On resume: credit min(offline, 2 h) × 25% fleet output (candidate). Must ship with a re-run balance sim showing the contract-active targets still hold (or with re-stated targets) |
| **Account linking** (Discord / Google / GitHub OAuth) | ADR-0018; moves guest progress to an account |
| **Mobile / touch** | ADR-0021: desktop first; needs a touch control scheme and UI scaling |
| **New moons and materials** | e.g. a second body with new dust types and machines, carrying the player profile over; mirrors the reference's v1.1 roadmap [M§1] |
| **Seasonal events** | Cosmetic-only Commendation offers, themed Stray Cargo; no paid items ever |
| **Random co-op events** | e.g. a "Cargo Spill" of Stray Cargo landing near a Flare Beacon, rewarding the whole shift (non-combat) |
| **Hard contracts** ("Deep Dust") | Dust levels +50%, technical caps −25% (candidate) |
| **Opt-in contract leaderboards** | Fastest Fulfilled by shift size; anti-cheat via server logs |
| **Shareable Showcase visits** | Read-only spectator links to Fulfilled moons |
| **Creator tools** | Exported Deck Plate blueprints shared between contracts |

## 5. What each tier proves

| Tier | Proves |
| --- | --- |
| MVP | Dust feel, 16-player shared world, persistence across Render cold starts, server-side robots at base rate and their sync, the money-driven tool → vehicle → robot arc, first ≈2 h of pacing, visual bar |
| v1.0 | The full reference-mode contract (length regenerated by the sim against the 30–35 h solo target); bounded robot performance; co-op 1–16 |
| Polish | Retention and readiness for wider sharing |
| Post-launch | Longevity without monetization |
