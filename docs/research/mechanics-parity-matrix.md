# Mechanics parity matrix — Moon Sweepers (Steam) · Clean The Moon!

Status: **Draft v3, reference-mode reconciliation (2026-11-12).** Author: game-designer (planning). Inputs: [moon-sweepers-mechanics.md](moon-sweepers-mechanics.md) (**M§**), [moon-sweepers-reception.md](moon-sweepers-reception.md) (**R§ / R C#** = complaint row). Our design: [../design/GDD.md](../design/GDD.md), [../design/progression-and-economy.md](../design/progression-and-economy.md) (**E§**), [../design/scope-tiers.md](../design/scope-tiers.md).

**Current owner direction:** close recreation of Moon Sweepers mechanics, presentation and world/map progression.
[REFERENCE_TARGET](../design/REFERENCE_TARGET.md) governs default behavior, optional custom additions and source confidence.
Common descriptive names are allowed. Older ★ entries below are proposals, not automatically better or required.
Each implementation wave must reconcile its affected rows before build; do not call a renamed divergent system parity.
**RB§ citations** point to a retired Roblox comparison file that is no longer in the repo; they are historical labels only.
Rows changed by the reference-mode pass are tagged **RF-06** and listed with status, deviation and evidence in §0.

**Columns:**
- **Ours** = the tier where it ships: MVP / v1.0 / Polish / later (post-launch) / not planned.
- **★** = an authored deviation proposal; classify required technical adaptation versus optional custom design before implementation. A blank ★ cell means intended parity, not proof of completion.

## 0. Reference-mode reconciliation (RF-06, 2026-11-12)

Status key: **verified** = official Steam store/patch notes; **inferred** = community research in
[moon-sweepers-mechanics.md](moon-sweepers-mechanics.md) with its own confidence label; **estimated** = our tuning or
browser adaptation without reference data. "Optional ★" = parked custom progression ([GDD §18](../design/GDD.md),
[economy §24](../design/progression-and-economy.md), [scope-tiers §2.1](../design/scope-tiers.md)), not baseline scope.

| Row (section) | Reference behaviour (status) | Baseline now | Deviation | Acceptance evidence |
| --- | --- | --- | --- | --- |
| Starter tool (§2) | Tiny toothbrush (verified: "tiny starter brush") | Desk Duster model; Toothbrush/Starter Brush label allowed | None in role/scale; authored asset | RF-01 tool-in-hand comparison; RF-02 timed first loop |
| Capstones gated (§3) | No (inferred) | No capstone gated (Golden Handshake gate removed) | None | Data check: no `gateReviewId` in `promotions-board.json` |
| Tree vs fleet cost (§3) | Tree ≈0.9× one global robot (inferred) | Tree 0.58M vs Albatross fleet 57.9M (Flight Plan parked) | Estimated tuning | Regenerated balance-sim spend table |
| Behemoth / Tile Sinterer / Field Gate gates (§5, §7) | Money + garage/build prerequisites (inferred; depots verified on store page) | Money + Motor Pool / Assembly Gun | None | Data check; RF-05 integrated route |
| Late vehicle progression (§5) | None (inferred) | Tier ladder + 7 upgrade lines; Refit optional ★ | None | Data check |
| Carryall automation (§5) | Driven transport (inferred) | Driven; Carryall Convoy optional ★ | None | — |
| First local robot in MVP (§6) | Bought with money (inferred) | Bought with money on a pre-built pad; MVP cap 3; tutorial suggestion only | MVP pre-built pad (no Assembly Gun in MVP) is a staging limit | RF-02 fresh-save playtest: robot bought without a quest; sim `mvp` first-Roost row |
| Robot activity rate (§6) | Off-screen robot work since 1.0.4 (verified) | Calibrated base rate while the room is active; no Effort/On-Shift/Unattended | Room suspends when empty (free hosting) | RF-05 scenario test: output identical with 1 vs 16 clients and with idle clients; suspend/resume test |
| Robot sale price (§6, §10) | Full material price (inferred) | Ordinary material price; processing adds value; Bulk Rate retired | None | RF-05 unit test: a Bale kg pays the same as a player kg, exactly once |
| Robot count limit (§6, §7) | None; lag with hundreds (inferred) | Fixed visible caps 24 Roosts / 24 Albatross / 14 machines; MVP 3 Roosts | Estimated browser/server budget adaptation | Max-cap perf run (M3 E4) within budgets; UI shows "n / cap" and disabled reason |
| Robot upgrades, Work Front, Auto-Relocate, Homing (§6, §9) | None (inferred) | None; parked as optional ★ | None | — |
| Machine tiers (§7) | None (inferred) | One size each; Grades II–III optional ★ | None | Data check |
| Sell from anywhere (§7) | Not in Steam game | Not baseline; Remote Assay optional ★ | None | — |
| Surface finishes (§8) | 5 styles (inferred) | 6 finishes, all from the start | Set of 6 is estimated, not required to differ | Visual review only |
| Settle payout (§8) | Build on dust since 1.0.5 (verified); payout undocumented | Footprint cleared at own tool rate, paid 25% | Estimated anti-exploit tuning | Exploit hunt in economy §22.7 |
| Milestones (§9, §13) | Achievements at 1/10/50/100% (inferred) | Shine milestone celebrations; unlock nothing | Extra 5/25/75% toasts (cosmetic) | Data check: no unlocks keyed to Shine |
| Late game, crew scaling, pacing (§10) | Upgrades done early; no crew scaling (inferred) | Same shape; Repeat Requisition/Standard Issue kept; Reviews, Docket, On-Shift parked | Repeat Requisition/Standard Issue are estimated ★ fairness changes | Regenerated balance-sim report (reference-mode policy) before gameplay acceptance |
| Meta / session chores (§11, §12) | No meta layer in Steam game | Contracts, Locker, achievements; Tenure, Commendations, Certifications, Benefits, Docket, Review rewards optional ★ | None | — |

## 1. Core loop and cleaning

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Hold-to-sweep with held tool | LMB/RT sweeps | MVP | Sweep | | M§2.1 |
| Tool width, depth, reach, stroke time | Yes | MVP | Width / Depth / Reach / Stroke | ★ Depth versus terrain dust levels makes tiers matter on Mare and Crater Floor | M§2.1, RB§2.2 |
| Lockable sweep angle for lanes | Yes | MVP | Lane Lock | ★ Lane Broom gets +15% speed while locked, a reason to use it | M§2.1 |
| Dust as a layer with thickness | Implied, undocumented | MVP | Dust levels 0–15 (4-bit ledger) | ★ Explicit Highland / Mare / Crater Floor depths | M§2.1, E§1 |
| Cleaned ground visible and synced to all | Yes; reworked in 1.0.4 | MVP | Plot ledger + stroke replay | ★ Server-authoritative ledger from day one [R C6] | M§2.1, R§6 |
| Region scan key | G shows sector #, edges, % | MVP | Plot Card (C) | ★ Different verb and key; adds state and credit | M§2.1 |
| First completion very early | First sector ≈5–15 min | MVP | Landing Apron (6 thin-dust plots) | ★ First Stamp ≈6 min; Shine to four decimals from the first plot | M§7, E§1, E§18 |
| Dust "graffiti" on the shared world | Emergent (incl. offensive drawings) | v1.0 | (emergent) | ★ Clean-up Order (Albatross) or Brightside Service Call (before Albatross) finishes the flagged plot | R§3 |
| Steep terrain limits | Undocumented | v1.0 | Steep plots (>25°) | ★ Vehicles can't climb; hand tools keep a late role via traits [R C2] (estimated) | E§1 |
| Oxygen / stamina / damage | None (praised) | not planned | — | Cosy no-fail kept; no battery/overheat friction | M§3h, R§5, RB§2.2 |

## 2. Hand tools and containers

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Absurdly small free starter tool | Toothbrush | MVP | Desk Duster (ceremonial, from Brightside's tender pitch) | RF-06: same role and scale; authored model and Brightside lore; display alias Toothbrush allowed | M§3a, RB§9 |
| 6 hand tools, bought per player | Yes, ~×2–3 price per tier | MVP T1–T4, v1.0 T5–T6 | Desk Duster, Crescent Squeegee, Bristle Broom, Lane Broom, Static Rake, Ion Curtain | ★ Per-tool traits (Detailing, Flick, Sure Footing, Lane Lock, Charge, Twin Pass) [R C2]; Static Rake priced as a real step before vehicles | M§3a, E§4 |
| Separate building tool | ~1/3 top tool price | v1.0 | Assembly Gun | | M§3a, M§3f |
| Per-tool container, 3 levels | ×2/×4/×8, flat cost per kg | MVP | Dust Cell I/II/III | Our own curve (×1.75/×2.75/×4) | M§3b, E§5 |
| Global container multiplier | Compactor, 3 levels | MVP | Densifier (2 lv) | | M§3b |
| Full container stops pickup | Yes | MVP | — | | M§2.2 |
| Pack 1-kg capsule, drop/carry/throw, empty back into tool | Yes | MVP | Dust Puck (F / Q) | ★ Hold F bands the Cell into a Puck Stack (≤20 kg, one rail unit) | M§2.2, RB§2.3, E§5 |
| Auto-pack when full | Capstone | v1.0 | Overflow Former | ★ Earnable, not paid; forms one Puck Stack, not a trail of pucks | M§2.2, RB§5.1 |
| Container levels shared by crew | Yes | MVP | Shared Dust Cells | | M§3b |
| Late-tier tool gate | None (money only) | v1.0 | Ion Curtain (money only) | Parity (v1's Review 1 gate removed, review M3) | M§3a, RB§2.2 |
| Tray "sell" button vs hold-to-pour | Tray sell button | MVP | Hold-to-pour at the Assay Counter (4 pour slots) | ★ Pour slots stop 16-player queues | M§2.3, E§10 |

## 3. Upgrade tree

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| 23-node tree, hub + 5 branches | Yes | MVP subset (10), v1.0 full | Promotions Board: Employee Badge + Storage, Technique, Fitness, Haulage, Accounts | | M§3g, E§6 |
| 3-level roots, 2-level secondaries, 1-level capstones | Yes | MVP (roots Broad Strokes, Cadence, Quick Pour, Rate Review + Scour, Densifier); v1.0 full | (same shape) | | M§3g |
| Cleaning branch (width/depth/reach/+%) | Yes | MVP/v1.0 | Broad Strokes, Scour, Telescoping Pole, Master Stroke | ★ Master Stroke also widens vehicles | M§3g |
| Suit branch (speed/jump/+%) | Yes | MVP/v1.0 | Cadence, Loft, Second Wind | ★ Second Wind also adds a Hop Pack burst and trims vehicle trips | M§3g |
| Logistics branch (deposit time, pickup, throw) | Yes | MVP/v1.0 | Quick Pour, Puck Magnet, Strong Arm, Smooth Handoff | ★ Smooth Handoff also snaps thrown pucks onto rails and speeds vehicle unloads | M§3g |
| Economy branch (payout %, discount, sector bounty) | Yes; ×1.28 max | MVP/v1.0 | Rate Review, Rebate, Stamp Premium, Golden Handshake | ★ Golden Handshake extends Stamp Premium to robot plots (no co-op penalty) | M§2.4, M§3g |
| Tree shared by crew | Since 1.0.3 | MVP | Shared | ★ Shared from day one [R C6] | M§6, R§6 |
| Capstones gated by milestones | No | v1.0 | Not gated (parity) | RF-06: Golden Handshake's Review 2 gate removed | E§6 |
| Whole tree ≈ 0.9× one global robot | Yes (pacing cliff) | v1.0 (different ratio) | — | RF-06: tree 0.58M vs 57.9M for the Albatross fleet (Flight Plan 79.1M parked); estimated, sim to regenerate | M§3g, E§17 |

## 4. Suit gear

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Quick-slot belt, 5 levels (2→6) | Yes | MVP L1, v1.0 all | Holster Rig | | M§3h |
| Jetpack bursts, 3 levels | Yes | v1.0 | Hop Pack | | M§3h, RB§2.2 |
| Gravity toggle boots | B key | v1.0 | Ballast Soles | ★ Also an accessibility comfort default | M§3h |
| Helmet lamp, 4 levels | Yes | MVP L1, v1.0 all | Crown Lamp (Clip Light → Spot Ring → Wide Halo → Searchlight) | | M§3h |
| Night vision, N cycles | Added 1.0.4 | v1.0 | Lowlight Visor | ★ Minimum-visibility floor, so gear helps but isn't mandatory | M§3h, R§6 |
| Suit gear shared by crew | Yes | MVP | Shared | | M§3h |

## 5. Vehicles

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| 5 vehicles: walk-behind → mega | Yes | MVP Trundle, v1.0 all | Trundle, Skiff, Carryall, Bulldust, Behemoth | ★ Each tier a real area-rate step (×3.0/×1.9/×1.4) | M§3c, RB§2.1, E§8 |
| 8-seat transport, no cleaning | Yes | v1.0 | Carryall | RF-06: driven transport (parity); Carryall Convoy optional ★ | M§3c |
| Garage required (building) | Yes | MVP pre-built; v1.0 buildable | Motor Pool | | M§3c |
| One vehicle out per garage; relocation when the garage is removed | Yes | v1.0 | Motor Pool rule | Vehicles go to the nearest other Motor Pool or storage | M§3c, E§8 |
| Bought with crew money, owned per player | Yes | MVP | Personal vehicles | ★ Repeat Requisition: copies 40% of list | M§6, E§2 |
| Unload pad → silo → capsules on belt | Yes | MVP (Dump Plate→Gate), v1.0 | Dump Plate, Dust Vault | ★ Dust Vault outputs Puck Stacks (no belt wall) | M§3c, E§8 |
| Vehicle capsule slots and loading (T) | Yes | v1.0 | Puck slots (T) | Carry pucks or Puck Stacks | M§3c, E§8 |
| 7 upgrade lines, 16 levels | Yes | v1.0 (none in MVP) | Gear Ratio, Cargo Expander, Afterburner, Throttle Lock, Wide Mouth, Fast Tip, Running Lamps | ★ Wide Mouth is a net gain (×1.25 at max) | M§3c, E§8.1 |
| Late vehicle progression | None | optional ★ | Refit I–III (parked) | RF-06: baseline parity (none) | E§8.2, E§24.5 |
| Transport uses 4 lines | Yes | v1.0 | Carryall: 4 lines | | M§3c |
| Bigger = wider, bigger hopper, slower | Yes | MVP | — | | M§3c |
| Vehicle tricks, capped bonus, wipeout | Yes | v1.0 | Hang Time, Moonshot!, Lunar Loop, Corkscrew, Faceplant | ★ Driver only; per-driver and per-shift caps (no co-op ramp farming) | M§3c, E§2 |
| Vehicles knock players flying | Yes | v1.0 (Private toggle) | Bump | ★ Ghosting in Open shifts (griefing) | M§3c, R C6 |
| Follow camera toggle | Added 1.0.5 | MVP | Settings | ★ At launch [R C11] | R§6 |
| Vehicle battery / self-driving car | — | not planned | — | Throttle Lock covers the convenience | RB§5.3 |

## 6. Robots

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Local robot Mk I: 19 hexes (2 rings) around dock | Yes | MVP (≤3 Roosts, bought with money), v1.0 | Roost + Sandpiper | RF-06: no Pilot Review gate; in MVP to prove robot sim and sync and show the tool→vehicle→robot arc (review M14) | M§3d, RB§2 |
| Local robot Mk II: 37 hexes | Yes | v1.0 | Plover (upgrade in place) | ★ Upgrade the unit, don't replace it | M§3d |
| Dock delivers capsules via belt | Yes | v1.0 (MVP: Roost Uplink pays on arrival) | Roost → Glide Rail (Puck Stacks) | ★ Stacks: no hidden rail wall (review M5) | M§3d, E§10 |
| Local robots idle when patch done | Yes ("All clean") | MVP | Patch Picked Clean / Resting | ★ Free one-click Re-site + DOT prompt (Auto-Relocate optional ★) | M§3d, E§9 |
| Robot switch-off | Yes (Switched off) | v1.0 | Ground (state Grounded) | | M§3i, E§9.1 |
| Global robot: whole Moon, nearest dusty sector | Yes; ~80× basic price | v1.0 | Albatross | RF-06: base rate, nearest dusty plot; fixed technical cap 24 | M§3d |
| Global robots skip unreachable hexes | Yes | v1.0 | — | Every plot is reachable; ground under buildings is already clean (Settle) | M§3d, E§9.1 |
| Player directs where the global robots work | No | optional ★ | Work Front, Flock Formations (parked) | RF-06: baseline parity (no) | E§24.6 |
| Global robot fires capsules to catchers | Yes; group rule (100 m, 80%) | v1.0 | Bales → Nests | ★ Bale Chute feeds Gates and machines directly (no belt bottleneck) | M§3d, E§9.1 |
| Works with no player nearby | Only since 1.0.4 | MVP | Base rate while the room is active | RF-06: parity from day one; room suspends when empty (hosting) | M§3d, R§6, E§9.3 |
| Robot map layer and states | Since 1.0.4 | MVP states; v1.0 map layer | Survey Globe robot layer; 9 states | ★ Our own state set (not 11-for-11) | M§3i |
| Robot count cap / upkeep | None (hundreds → lag) | MVP (3), v1.0 | Fixed technical caps (24 Roosts / 24 Albatross), visible | RF-06: estimated browser and 0.1-CPU server adaptation [R C4]; no Review permits | M§3d, R C4, E§9.2 |
| Robot upgrades | None (only more robots) | optional ★ | Flight Plan (parked) | RF-06: baseline parity (none) | M implications 1, E§24.4 |
| Robots scale with co-op | No | — (parity) | — | RF-06: On-Shift Bonus parked (optional ★) | E§9.3, E§24.3 |
| Robot income vs active play | Full price (idle snowball) | v1.0 | Ordinary material price | RF-06: parity; Effort, Unattended and Bulk Rate retired (optional ★) | R§8, E§2, E§24.7 |
| Paid automation slot | — | optional ★ | Fleet Voucher (Benefit) | Not baseline | RB§5.1 |

## 7. Logistics, production, power

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Belts carry capsules (belt is the bottleneck) | Yes | v1.0 | Glide Rail (2 units/s) | ★ Rails carry Puck Stacks and Bales (×20 throughput); Gates take 3 rails; Rail Run drag tool | M§3e, E§10 |
| Splitter / merger | Yes; alternating merge since 1.0.4 | v1.0 | Rail Fork / Rail Join | ★ Fork overflow mode | M§3e |
| Packager (player dust → capsules → belt) | Yes | v1.0 | Puck Former | ★ Outputs Puck Stacks | M§3e |
| Station belt intakes pay on arrival | Since 1.0.3 | MVP (Gate fed by Dump Plate), v1.0 | Receiving Gate | | M§2.3 |
| Placeable depot / selling point | Store copy only | v1.0 | Field Gate (money-gated) | RF-06: inferred from the store's "depots"; spec estimated [R C16] | M§2.3, R§7 |
| Sell from anywhere | — | optional ★ | Remote Assay (parked) | RF-06: not baseline | E§24.8 |
| Production 1 (×3 value) | Pressure chamber → sand | v1.0 | Bead Kiln → Glass Beads (×3.2) | | M§3e, RB§2.1 |
| Production 2 (×7 value; dust + product) | Stone press | v1.0 | Tile Sinterer → Sinter Tiles (×7.5) | | M§3e |
| Machine tiers | — | optional ★ | Grades II–III (parked) | RF-06: baseline one size each | E§11, E§24.8 |
| Machine count limit | None | v1.0 | Plant cap 14 (fixed, visible) | RF-06: estimated perf adaptation | E§9.2 |
| 3 solar sizes (largest tracks) + batteries | Yes; 92% efficiency | v1.0 | Sun Sprig, Sun Fan, Heliostat, Night Cell | ★ Output follows sun elevation (no free 24/7 solar at the Twilight Strips) | M§3e, E§11 |
| Wireless power radius | Yes | v1.0 | Power radius | | M§3e |
| Machines stop below low supply | <8% | v1.0 | <10% stop, linear above | ★ Status line explains why | M§3e, R C10 |
| Entity cap on loose capsules | 10k → 90k | MVP | 20 per player, 200 per contract; merge on touch; 10-min auto-collect at 50% | ★ Flows, not physics items [M implications 6] | M§3d, E§5 |
| Product/dust provenance | — | not planned | — | RF-06: price by material only; provenance pricing retired | E§10, E§24.7 |

## 8. Building

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| ~98 pieces in 5 tabs | Yes | v1.0 | Services, Logistics, Production, Power, Structures (98) | | M§3f, E§12 |
| Foundations, catwalks, railings, walls/window/door × 3 heights | Yes | v1.0 | Deck Plates, Gantries, Handrails, Panels (solid/porthole/archway/louvre × 2 widths + Shine display) | Authored panel set; comparable wall/window/door roles are allowed | M§3f |
| 5 cosmetic surface styles | Yes | v1.0 | 6 finishes: Brushed, Regolith Cast, Anodised, Enamel, Patina, Chrome | RF-06: all available from the start (Review 3 gate removed); set size estimated, not required to differ | M§3f |
| Build on dust, snapping, 30° hex rotate | Since 1.0.5 | v1.0 | Settle | RF-06: footprint dust cleared at your own tool rate and paid at 25% (estimated): no soft-lock, no free cleaner (review B4) | M§3f, E§12 |
| Move mode carries attachments | Since 1.0.5 | v1.0 | Reposition | | M§3f |
| 100% refund on removal | Since 1.0.5 | v1.0 | Reclaim | ★ Refund = price actually paid (free items refund 0) | M§3f, E§2 |
| "Why isn't it working" messages | Partial (garage, 1.0.5) | v1.0 | Status lines | ★ On every machine, Roost, Nest and Gate | R C10, R C12 |
| Author tags + mass revert | — | v1.0 | Incident Report → Revert | ★ Open-shift griefing; no-build zones around services | R C6 |

## 9. World, navigation, day/night

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Sphere ~2 km radius | Yes | MVP | The Moon (LOLA terrain) | | M§4 |
| 163,842 hex cells (GP 7 subdivisions) | Yes | MVP | Plots (GP(128,0)) | | M§4 |
| Started at ≥0.1%, done at ≤1%, empty auto-done | Yes; stuck-99.9% bugs | MVP | Opened / Polished | ★ Integer thresholds + recount [R C8] | M§4, R§6 |
| Completion pays flat bonus | Yes | MVP | Inspector's Stamp (50 LM) | ★ Satisfying stamp VFX; all plots pay | M§2.4 |
| Map colors untouched/started/done | Orange/blue/green | MVP (Plot Card), v1.0 (Survey Globe) | Grimy/Opened/Polished (umber/cyan/ivory + patterns) | ★ Colorblind-safe patterns | M§3i |
| Map available only at stations | Yes (complaint) | v1.0 | Survey Globe anywhere | ★ [R C8] | R C8 |
| 4 stations at poles + equator | Yes | MVP Boreal; v1.0 all 4 | Outposts Boreal, Austral, Dawnside, Duskside | | M§4 |
| Teleport to visited stations, fee, not in vehicle | Yes | v1.0 | Relay Pad (50 LM) | | M§3i |
| "Back to base" hold action | Yes (unverified) | v1.0 | Outpost Recall (100 LM) | | M§3i |
| Home-direction indicator | Yes | MVP | Compass nearest-outpost arrow | | M§3i |
| 12 shared waypoints, 150 m beams | Yes; only one visible | v1.0 | Flare Beacons (all 12 on compass) | ★ [R C8] | M§3i, R C8 |
| Compass with colored stations | Yes | MVP | Compass | | M§3i |
| Nearest-unfinished ping | — (requested) | MVP | Spot Check | ★ [R C8] | R§8 |
| Remaining-plot list / straggler robots | — | v1.0 | Punch List (ungated), Spot Check, Clean-up Orders | ★ Last-1% fix [R C8]; RF-06: Homing, Final Walkthrough, Closing Bonus optional ★ | GDD§16, E§24.8 |
| Zones with barriers | — | not planned | — | Shine milestones celebrate progress without walls or gates | RB§2.2 |
| 60-min day/night (30/30), no skipping | Yes | MVP | Day/night | | M§5 |
| Field manual (H) | Yes | MVP | DOT Handbook | | M§3i |
| Lore delivery (intro slides, manual chapters, diary notes) | Yes | v1.0 | DOT site memos, "slide deck" snippets in Shine milestone toasts, Postcard Rack | ★ No paperwork/agreement screens (review M17) | M§3i, GDD§14 |
| Locker / avatar editor | Yes (YOUR ASTRONAUT) | v1.0 | Locker | | M§8, GDD§12 |
| Scoreboard (Tab) | Yes | MVP | Shift Roster | | M§3i |
| Collectibles: 195 flags + 26 real mission sites | Yes; ≈ all personal progression | MVP 6 Near Parcels, v1.0 all | 150 Stray Cargo + 24 Survey Points | ★ Pays ~24% of personal total, not ~100% (estimated); small near outposts; RF-06: Core Samples optional ★ | M§4, M exec 7, E§15 |
| Station amenities (games, bunks, radio) | Yes | v1.0 (Polish: activities) | Break Room: Rock Garden, Postcard Rack, Earthview Window, Hold Music | Authored set; comparable amenities are allowed | M§3f |

## 10. Economy and pacing

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Pay per kg into one shared wallet | Yes | MVP | Lumens, shift wallet | | M§2.4–2.5, RB§3 |
| Material multipliers ×3 / ×7 | Yes | v1.0 | Beads ×3.2, Tiles ×7.5 | | M§2.4 |
| Payout multiplier upgrades | +28% max | MVP | Rate Review, Golden Handshake (+23%) | ★ No paid doubling | M§2.4, RB§5 |
| Tool/container discount | −10% | v1.0 | Rebate (−10%, incl. vehicles) | | M§2.4 |
| All upgrades bought by 0.5–5% of Moon | Yes (#1 complaint) | v1.0 (likely similar) | — | RF-06: baseline keeps the reference shape; Reviews, Flight Plan, Grades, Refits optional ★ [R C1] | R C1, E§20 |
| First 15–20% of playtime holds all unlocks | Yes | v1.0 (likely similar) | — | RF-06: purchase-gap target P50 ≤45 min, max ≤90 min kept; Review cadence optional ★ | M§7, E§18.4 |
| Pacing benchmarks: tool minutes; vehicle 1–2 h; global robot 4–8 h; full clear 35–40 h solo | Yes | v1.0 | — | Ours (estimated): Stamp + tool 6 min / Trundle 1.5 h / Albatross ≈6.0 h; full clear regenerated by balance-sim (31.1 h candidate) | M§7, RB§7, E§18 |
| Late game becomes idle waiting | Yes (complaint) | v1.0 (parity) | — | RF-06: Effort/Unattended, Work Front, Briefs, Refits optional ★ | R C1, C9, E§24 |
| No scaling with crew size | Yes (bigger crews pay more) | v1.0 | Repeat Requisition, Standard Issue | ★ estimated fairness change; RF-06: On-Shift Bonus and Docket optional ★; co-op times regenerate | M§6, E§19 |
| Exploration as early accelerator | Yes (very large) | v1.0 | Stray Cargo, Survey Points | ★ Bounded | M§3j |

## 11. Co-op, sessions, persistence

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| 1–16 players | Yes | MVP (Private ≤16) | Shift | | M§6, RB§3 |
| Lobby types | Friends / Public / Invite | MVP Solo+Private; v1.0 Open | Solo / Private / Open Shift | ★ Private by default; Open stops admitting Temps without a lead online | M§6 |
| Public lobby list | Join game list | v1.0 | Shift Board | ★ Shows Shine %, language, "Temps welcome" | M§6, R§7 |
| Host-owned save; host leaving ends session | Yes | MVP | Contract on the server | ★ Persistent; nobody's exit ends others' shift | M§6, R C7 |
| Kick / ban | Since 1.0.3 | MVP kick/ban; v1.0 roles | Holder / Supervisor / Staff / Temp | ★ Roles, Loaner Kit, Revert, vote-kick (incl. Temps), no-build zones | M§6, R C6 |
| Text chat + TTS | Yes | v1.0 | Chat + Read Aloud | ★ Rate-limit, mute, report | M§6 |
| Shared upgrades / containers / suit gear | Since 1.0.3 | MVP | Shared | | M§6 |
| Per-player tools and vehicles | Yes | MVP | Personal | ★ Repeat Requisition | M§6 |
| Join in progress | Implied | MVP | Join-in-progress + Orientation Packet + Standard Issue | ★ Explicit catch-up | M§6 |
| Milestone rewards for absent members | — | v1.0 (achievement only) | Participation threshold | Contract Fulfilled achievement to everyone with ≥10 plots or ≥30 active min; RF-06: Review rewards optional ★ | E§24.1 |
| Version mismatch handling | Must match | MVP | Protocol handshake + "refresh" | | M§6, R§8 |
| Backups and save repair | 5 local backups | MVP | Server checkpoints (≤30 s) + snapshots | ★ Continuous, server-side [R C7] | M§6 |
| Session length ~20–25 min | — | v1.0 | Shift Briefing, Next Requisition, Shift Report | ★ Every session has a payoff; RF-06: Shift Docket optional ★ | RB§7, E§24.9.1 |
| Offline progress | Not documented | later | Night Shift (capped) / Offline Solo worker | Post-launch, with re-tuned targets; robots run at base rate while the room is active (idle clients close after 30 min) | RB§4 |

## 12. Meta layer (Roblox-style) and retention

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Lobby + separate moon instances | — | v1.0 | Main menu + Contracts (hold 3) | | RB§1.1, RB implication 10 |
| Multiple moons / runs | One moon per save | v1.0 (Standard); later (Moonlet, new moons) | Contracts | | RB§2 |
| Persistent meta currency | — | optional ★ | Commendations | RF-06: not baseline | RB§2 |
| Prestige level | — | optional ★ | Tenure (1–50, ranks) | RF-06: not baseline | RB§2 |
| Classes | — | optional ★ | Certifications (7, fixed ladder) | No gacha if pulled in | RB§2.1–2.2 |
| Class slots | — | optional ★ | Slots at Tenure 20 / 40 | | RB§5.2 |
| Permanent lobby upgrades | — | optional ★ | Benefits Package | | RB§2.2 |
| Head start per moon | — | optional ★ | Signing Bonus, Pre-Approved Motor Pool | | RB§5 |
| Infinite capacity / sell anywhere / fast legs / fast vehicles / 2x cash | — | v1.0 (Overflow Former, Rate Review); optional ★ (rest) | Overflow Former, Rate Review; Remote Assay, Lope Training, Comfort Seat parked | Earnable, never paid | RB§5.4 |
| Cash packs / FINISH NOW / currency packs | — | not planned | — | ★ $0, not monetized | RB§5 |
| Sequential quests | — | MVP Induction, v1.0 Probation | Induction / Probation Checklists | | RB§2.2 |
| Achievements / badges | 33 Steam | MVP 3, v1.0 33 | Achievements | ★ No AFK grind tiers [R C15]; names are editable catalog defaults | M§5, RB§7 |
| Codes, like-goals, group rewards | — | CTM codes | not planned | — | RB§4 |
| Daily login rewards | — | Not found | not planned | — | RB§4 |
| Limited-time / seasonal events | — | later | Seasonal events (cosmetic) | | RB§4, RB§6 |
| Random server events (crash, raids, boss) | — | later | Cargo Spill | ★ Non-combat, rewards everyone | RB§2.2 |
| Hard modes / second planet | — | later | Deep Dust contracts / new moons | | RB§2.2 |
| Pets, rebirth | — | not planned | — | Off-tone | RB§2.3 |
| Trading | — | not planned | — | | RB§3 |
| Leaderboards | — | later (opt-in) | Contract leaderboards | | RB§4 |

## 13. Endgame

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Ending sequence at 100% | 25.4 s, praised | v1.0 | Contract Fulfilled (~60 s) | | M§5, R§5 |
| What happens after | Unknown; v1.1 promised | v1.0 | Showcase Moon + Overtime + Beacon Run | ★ Defined post-game [M§5] | M§5, RB§2.1 |
| Progress-% milestones | Achievements at 1/10/50/100% | v1.0 | Shine milestones 1/5/10/25/50/75% + achievements | RF-06: celebrations only; Performance Reviews with Briefs optional ★ | M§5, E§13, E§24.1 |
| Roadmap content (machines, materials) | v1.1 Dec 2026 | later | New moons and materials | | M§1, RB§6 |
