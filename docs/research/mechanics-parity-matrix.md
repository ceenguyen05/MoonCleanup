# Mechanics parity matrix — Moon Sweepers (Steam) · Clean The Moon!

Status: **Draft v2 (2026-11-12, after the independent game-design review).** Author: game-designer (planning). Inputs: [moon-sweepers-mechanics.md](moon-sweepers-mechanics.md) (**M§**), [moon-sweepers-reception.md](moon-sweepers-reception.md) (**R§ / R C#** = complaint row). Our design: [../design/GDD.md](../design/GDD.md), [../design/progression-and-economy.md](../design/progression-and-economy.md) (**E§**), [../design/scope-tiers.md](../design/scope-tiers.md).

**Current owner direction:** close recreation of Moon Sweepers mechanics, presentation and world/map progression.
[REFERENCE_TARGET](../design/REFERENCE_TARGET.md) governs default behavior, optional custom additions and source confidence.
Common descriptive names are allowed. Older ★ entries below are proposals, not automatically better or required.
Each implementation wave must reconcile its affected rows before build; do not call a renamed divergent system parity.

**Columns:**
- **Ours** = the tier where it ships: MVP / v1.0 / Polish / later (post-launch) / not planned.
- **★** = an authored deviation proposal; classify required technical adaptation versus optional custom design before implementation. A blank ★ cell means intended parity, not proof of completion.

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
| Steep terrain limits | Undocumented | v1.0 | Steep plots (>25°) | ★ Vehicles can't climb; hand tools keep a late role (Briefs, Core Samples) [R C2] | E§1 |
| Oxygen / stamina / damage | None (praised) | not planned | — | Cosy no-fail kept; no battery/overheat friction | M§3h, R§5, RB§2.2 |

## 2. Hand tools and containers

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Absurdly small free starter tool | Toothbrush | MVP | Desk Duster (ceremonial, from Brightside's tender pitch) | ★ Original starter and lore, so we don't read as a clone (RB implication 9, review M17) | M§3a, RB§9 |
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
| Capstones gated by milestones | No | v1.0 | Not gated (parity), except Golden Handshake at Review 2 | ★ One economy capstone gated so "all personal upgrades" lands at ≈10–12 h | E§6 |
| Whole tree ≈ 0.9× one global robot | Yes (pacing cliff) | not planned | — | ★ Tree is 0.58M vs 57.9M for the Albatross fleet + 79.1M Flight Plan | M§3g, E§17 |

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
| 8-seat transport, no cleaning | Yes | v1.0 | Carryall | ★ Carryall Convoy (Review 2) automates a recorded route | M§3c |
| Garage required (building) | Yes | MVP pre-built; v1.0 buildable | Motor Pool | | M§3c |
| One vehicle out per garage; relocation when the garage is removed | Yes | v1.0 | Motor Pool rule | Vehicles go to the nearest other Motor Pool or storage | M§3c, E§8 |
| Bought with crew money, owned per player | Yes | MVP | Personal vehicles | ★ Repeat Requisition: copies 40% of list | M§6, E§2 |
| Unload pad → silo → capsules on belt | Yes | MVP (Dump Plate→Gate), v1.0 | Dump Plate, Dust Vault | ★ Dust Vault outputs Puck Stacks (no belt wall) | M§3c, E§8 |
| Vehicle capsule slots and loading (T) | Yes | v1.0 | Puck slots (T) | Carry pucks or Puck Stacks | M§3c, E§8 |
| 7 upgrade lines, 16 levels | Yes | v1.0 (none in MVP) | Gear Ratio, Cargo Expander, Afterburner, Throttle Lock, Wide Mouth, Fast Tip, Running Lamps | ★ Wide Mouth is a net gain (×1.25 at max) | M§3c, E§8.1 |
| Late vehicle progression | None | v1.0 | Refit I–III (Reviews 3–5) | ★ Late personal track; player area keeps growing (review B1) | E§8.2 |
| Transport uses 4 lines | Yes | v1.0 | Carryall: 4 lines | | M§3c |
| Bigger = wider, bigger hopper, slower | Yes | MVP | — | | M§3c |
| Vehicle tricks, capped bonus, wipeout | Yes | v1.0 | Hang Time, Moonshot!, Lunar Loop, Corkscrew, Faceplant | ★ Driver only; per-driver and per-shift caps (no co-op ramp farming) | M§3c, E§2 |
| Vehicles knock players flying | Yes | v1.0 (Private toggle) | Bump | ★ Ghosting in Open shifts (griefing) | M§3c, R C6 |
| Follow camera toggle | Added 1.0.5 | MVP | Settings | ★ At launch [R C11] | R§6 |
| Vehicle battery / self-driving car | — | not planned | — | Throttle Lock covers the convenience | RB§5.3 |

## 6. Robots

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Local robot Mk I: 19 hexes (2 rings) around dock | Yes | MVP (≤3 Roosts, via the Pilot Review), v1.0 | Roost + Sandpiper | ★ In MVP to prove robot sim and sync and show the tool→vehicle→robot arc (review M14) | M§3d, RB§2 |
| Local robot Mk II: 37 hexes | Yes | v1.0 | Plover (upgrade in place) | ★ Upgrade the unit, don't replace it | M§3d |
| Dock delivers capsules via belt | Yes | v1.0 (MVP: Roost Uplink pays on arrival) | Roost → Glide Rail (Puck Stacks) | ★ Stacks: no hidden rail wall (review M5) | M§3d, E§10 |
| Local robots idle when patch done | Yes ("All clean") | MVP | Patch Picked Clean / Resting | ★ Free one-click Re-site + DOT prompt; Auto-Relocate (15,000 LM) from the start | M§3d, E§9 |
| Robot switch-off | Yes (Switched off) | v1.0 | Ground (state Grounded) | | M§3i, E§9.1 |
| Global robot: whole Moon, nearest dusty sector | Yes; ~80× basic price | v1.0 | Albatross | ★ Upgradable via Flight Plan; bounded by Flock Permits | M§3d |
| Global robots skip unreachable hexes | Yes | v1.0 | — | Every plot is reachable; ground under buildings is already clean (Settle) | M§3d, E§9.1 |
| Player directs where the global robots work | No | v1.0 | Work Front, Flock Formations | ★ Spatial player agency late (review B1) | E§9.1 |
| Global robot fires capsules to catchers | Yes; group rule (100 m, 80%) | v1.0 | Bales → Nests | ★ Bale Chute feeds Gates and machines directly (no belt bottleneck) | M§3d, E§9.1 |
| Works with no player nearby | Only since 1.0.4 | MVP | Unattended (×0.5) | ★ From day one [R C9], at half rate so active play matters | M§3d, R§6, E§9.3 |
| Robot map layer and states | Since 1.0.4 | MVP states; v1.0 map layer | Survey Globe robot layer; 9 states | ★ Our own state set (not 11-for-11) | M§3i |
| Robot count cap / upkeep | None (hundreds → lag) | MVP (3), v1.0 | Roost / Flock Permits (≤24 each) | ★ Bounded for browser and 0.1-CPU server [R C4] | M§3d, R C4 |
| Robot upgrades | None (only more robots) | v1.0 | Flight Plan: Keen Beak, Deep Crop, Tailwind, Wide Wing, Homing | ★ Late-game progression and performance [R C1, C4] | M implications 1, E§9.4 |
| Robots scale with co-op | No | MVP | On-Shift Bonus | ★ ×(1+0.6√(A_eff−1)), Effort-weighted, one per account, ≤1.0 per IP subnet (no alt farming) | RB§3, E§9.3 |
| Robot income vs active play | Full price (idle snowball) | v1.0 | Effort, Unattended ×0.5, Bulk Rate (25% raw Bales) | ★ Automation multiplies play, not replaces it [R C1] | R§8, E§2, E§9.3 |
| Paid automation slot | — | v1.0 | Fleet Voucher (Benefit), Review 1 free Roost | ★ Earnable | RB§5.1 |

## 7. Logistics, production, power

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Belts carry capsules (belt is the bottleneck) | Yes | v1.0 | Glide Rail (2 units/s) | ★ Rails carry Puck Stacks and Bales (×20 throughput); Gates take 3 rails; Rail Run drag tool | M§3e, E§10 |
| Splitter / merger | Yes; alternating merge since 1.0.4 | v1.0 | Rail Fork / Rail Join | ★ Fork overflow mode | M§3e |
| Packager (player dust → capsules → belt) | Yes | v1.0 | Puck Former | ★ Outputs Puck Stacks | M§3e |
| Station belt intakes pay on arrival | Since 1.0.3 | MVP (Gate fed by Dump Plate), v1.0 | Receiving Gate | | M§2.3 |
| Placeable depot / selling point | Store copy only | v1.0 | Field Gate | ★ Requested feature [R C16] | M§2.3, R§7 |
| Sell from anywhere | — | v1.0 | Remote Assay (90%, cooldown) | ★ Earnable at Review 2 | RB§5.4 |
| Production 1 (×3 value) | Pressure chamber → sand | v1.0 | Bead Kiln → Glass Beads (×3.2) | | M§3e, RB§2.1 |
| Production 2 (×7 value; dust + product) | Stone press | v1.0 | Tile Sinterer → Sinter Tiles (×7.5) | | M§3e |
| Machine tiers | — | v1.0 | Grades I–III (Review 2 / 4) | ★ Production grows across the contract | RB§2.2, E§11 |
| Machine count limit | None | v1.0 | Plant Permits (≤14) | ★ Perf and pacing | E§9.2 |
| 3 solar sizes (largest tracks) + batteries | Yes; 92% efficiency | v1.0 | Sun Sprig, Sun Fan, Heliostat, Night Cell | ★ Output follows sun elevation (no free 24/7 solar at the Twilight Strips) | M§3e, E§11 |
| Wireless power radius | Yes | v1.0 | Power radius | | M§3e |
| Machines stop below low supply | <8% | v1.0 | <10% stop, linear above | ★ Status line explains why | M§3e, R C10 |
| Entity cap on loose capsules | 10k → 90k | MVP | 20 per player, 200 per contract; merge on touch; 10-min auto-collect at 50% | ★ Flows, not physics items [M implications 6] | M§3d, E§5 |
| Product/dust provenance | — | v1.0 | `full` / `bale` tags | ★ Bales can't be laundered to full rate | E§10 |

## 8. Building

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| ~98 pieces in 5 tabs | Yes | v1.0 | Services, Logistics, Production, Power, Structures (98) | | M§3f, E§12 |
| Foundations, catwalks, railings, walls/window/door × 3 heights | Yes | v1.0 | Deck Plates, Gantries, Handrails, Panels (solid/porthole/archway/louvre × 2 widths + Shine display) | ★ Our own panel set (not walls × thirds) | M§3f |
| 5 cosmetic surface styles | Yes | v1.0 | 6 finishes: Brushed, Regolith Cast, Anodised, Enamel, Patina, Chrome | ★ Different set size and concepts; Patina and Chrome at Review 3 | M§3f |
| Build on dust, snapping, 30° hex rotate | Since 1.0.5 | v1.0 | Settle | ★ Footprint dust cleared at your own tool rate and paid at Bulk Rate: no soft-lock, no free cleaner (review B4) | M§3f, E§12 |
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
| Remaining-plot list / straggler robots | — | v1.0 | Punch List, Homing, Final Walkthrough, Closing Bonus | ★ Last-1% fix [R C8] | E§13, GDD§16 |
| Zones with barriers | — | not planned | — | Reviews give milestone structure without walls | RB§2.2 |
| 60-min day/night (30/30), no skipping | Yes | MVP | Day/night | | M§5 |
| Field manual (H) | Yes | MVP | DOT Handbook | | M§3i |
| Lore delivery (intro slides, manual chapters, diary notes) | Yes | v1.0 | DOT site memos, Review "slide deck" snippets, Postcard Rack | ★ No paperwork/agreement screens (review M17) | M§3i, GDD§14 |
| Locker / avatar editor | Yes (YOUR ASTRONAUT) | v1.0 | Locker | | M§8, GDD§12 |
| Scoreboard (Tab) | Yes | MVP | Shift Roster | | M§3i |
| Collectibles: 195 flags + 26 real mission sites | Yes; ≈ all personal progression | MVP 6 Near Parcels, v1.0 all | 150 Stray Cargo + 24 Survey Points + 40 Core Samples | ★ Original concept; pays ~24% of personal total, not ~100%; small near outposts | M§4, M exec 7, E§15 |
| Station amenities (games, bunks, radio) | Yes | v1.0 (Polish: activities) | Break Room: Rock Garden, Postcard Rack, Earthview Window, Hold Music | ★ Our own set (no air-hockey, whiteboard or radio analogue) | M§3f |

## 10. Economy and pacing

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Pay per kg into one shared wallet | Yes | MVP | Lumens, shift wallet | | M§2.4–2.5, RB§3 |
| Material multipliers ×3 / ×7 | Yes | v1.0 | Beads ×3.2, Tiles ×7.5 | | M§2.4 |
| Payout multiplier upgrades | +28% max | MVP | Rate Review, Golden Handshake (+23%) | ★ No paid doubling | M§2.4, RB§5 |
| Tool/container discount | −10% | v1.0 | Rebate (−10%, incl. vehicles) | | M§2.4 |
| All upgrades bought by 0.5–5% of Moon | Yes (#1 complaint) | not planned | — | ★ Reviews to 75%, Flight Plan, Grades, Refits, Permits [R C1] | R C1, E§20 |
| First 15–20% of playtime holds all unlocks | Yes | not planned | — | ★ Review every 3–6 h with a qualitative unlock; purchase gap P50 ≤45 min, max ≤90 min | M§7, E§18.4 |
| Pacing benchmarks: tool minutes; vehicle 1–2 h; global robot 4–8 h; full clear 35–40 h solo | Yes | v1.0 | — | Ours: Stamp + tool 6 min / Trundle 1.5 h / Albatross 5.9 h / 31.1 h solo | M§7, RB§7, E§18 |
| Late game becomes idle waiting | Yes (complaint) | not planned | — | ★ Effort-gated robots (Unattended ×0.5), Work Front, Review Briefs, Refits; ≥50% of solo Shine progress player-attributable | R C1, C9, E§9.3, E§18 |
| No scaling with crew size | Yes (bigger crews pay more) | v1.0 | Repeat Requisition, Standard Issue, On-Shift Bonus, shift-level Docket | ★ 16 players ≈ 9.0 h | M§6, E§19 |
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
| Milestone rewards for absent members | — | v1.0 | Participation threshold | ★ Paid to everyone with ≥10 plots or ≥30 active min, online or not; no sniping | E§13 |
| Version mismatch handling | Must match | MVP | Protocol handshake + "refresh" | | M§6, R§8 |
| Backups and save repair | 5 local backups | MVP | Server checkpoints (≤30 s) + snapshots | ★ Continuous, server-side [R C7] | M§6 |
| Session length ~20–25 min | — | v1.0 | Shift Briefing, Shift Docket, Shift Report | ★ Every session has goals and a payoff; Docket is shift-level and can't be farmed | RB§7, E§16.1 |
| Offline progress | Not documented | later | Night Shift (capped) / Offline Solo worker | Post-launch, with re-tuned targets; open rooms run Unattended ×0.5 for ≤30 min | RB§4 |

## 12. Meta layer (Roblox-style) and retention

| Mechanic | Moon Sweepers | Ours | Our name | ★ Improvement? | Source |
| --- | --- | --- | --- | --- | --- |
| Lobby + separate moon instances | — | v1.0 | Main menu + Contracts (hold 3) | | RB§1.1, RB implication 10 |
| Multiple moons / runs | One moon per save | v1.0 (Standard); later (Moonlet, new moons) | Contracts | | RB§2 |
| Persistent meta currency | — | v1.0 | Commendations | ★ Earn-only | RB§2 |
| Prestige level | — | v1.0 | Tenure (1–50, ranks; ≈38 per solo contract) | | RB§2 |
| Classes | — | v1.0 | Certifications (7, fixed ladder) | ★ No gacha (RB implication 5) | RB§2.1–2.2 |
| Class slots | — | v1.0 | Slots at Tenure 20 / 40 | ★ Earned | RB§5.2 |
| Permanent lobby upgrades | — | v1.0 | Benefits Package | ★ Earnable versions of paid conveniences | RB§2.2 |
| Head start per moon | — | v1.0 | Signing Bonus, Pre-Approved Motor Pool | ★ Earned with Commendations | RB§5 |
| Infinite capacity / sell anywhere / fast legs / fast vehicles / 2x cash | — | v1.0 | Overflow Former, Remote Assay, Lope Training, Comfort Seat, Rate Review | ★ All earnable, effect ≤10% | RB§5.4 |
| Cash packs / FINISH NOW / currency packs | — | not planned | — | ★ $0, not monetized | RB§5 |
| Sequential quests | — | MVP Induction, v1.0 Probation | Induction / Probation Checklists | | RB§2.2 |
| Achievements / badges | 33 Steam | MVP 3, v1.0 33 | Achievements | ★ No AFK grind tiers [R C15]; names checked against the reference list | M§5, RB§7 |
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
| Progress-% milestones | Achievements at 1/10/50/100% | v1.0 | Performance Reviews 1/5/10/25/50/75% | ★ Milestones unlock content and need a hands-on Brief | M§5, E§13 |
| Roadmap content (machines, materials) | v1.1 Dec 2026 | later | New moons and materials | | M§1, RB§6 |
