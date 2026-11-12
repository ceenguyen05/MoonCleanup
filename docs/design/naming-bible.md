# Naming bible — Moon Cleanup

Status: **Editable.** Owner: game-designer (Cee may rename anything at any time). v2 (2026-11-12): names flagged by the independent game-design review as close variants of the do-not-use lists were replaced; see §A8 for the rename log.
Rule: every player-facing name in code, data, UI, audio and marketing comes from this file. `packages/game-data` stores **IDs** (`tool.desk_duster`) plus display names copied from here, so a rename is a one-row change here + one string change in game-data.

**Banned names.**
1. Every name in the "REFERENCE PROPER NOUNS — DO NOT USE" sections of [`moon-sweepers-mechanics.md` §8](../research/moon-sweepers-mechanics.md#8-reference-proper-nouns--do-not-use-in-our-game) and [`roblox-references.md` §9](../research/roblox-references.md), plus close variants.
2. Generic words the reference games use as exact item names (toothbrush, sweeper, rover, vacuum, canister, conveyor, intake, bay, crew, class, zone, hatch, shards, gems, cash, tank, backpack, hopper, bucket, sack, pan, roller, silo, tray) are not used as our item names or as the head word of one.
3. **Close-variant test (CI + review).** A name fails if, in the **same slot** (e.g. vehicle upgrade, achievement, robot state, suit level), it shares a content word with a banned name, is a near-homophone of one (Auto-Puck / Auto-Packer), or follows the same "[modifier] + [head word]" construction with a synonym (Long Arm / Long Reach). The CI check runs exact match plus token overlap within slot; anything it flags needs a designer note here.
4. **Avoid one-to-one semantic clones** of a reference *set* (e.g. the same five surface finishes or the same amenity list): change the set size and at least half the concepts.
5. **One meaning per word.** Don't reuse a distinctive word across two systems (v1 had "Shift", "Survey", "Haulage", "Motor Pool", "Bulk", "Rail" and "Inspection" doing double duty; v2 fixes them, §A8).

**Title exception:** the title 'Moon Cleanup' was chosen by the owner (2026-11-12); it is descriptive and not an existing game's title. The close-variant rule applies to all other names.

Structure note: the *systems* below deliberately mirror the genre structure documented in the research (tier counts, branches, roles). The *names, look, lore and numbers* are ours.

## 1. Identity

| Thing | Name | Description / visual concept |
| --- | --- | --- |
| Game title | **Moon Cleanup** | Slug `moon-cleanup`. Logo: clean geometric wordmark; the "O"s are a half-cleaned moon (dark grime / bright polished split). Owner decision; the review's title-proximity risk is accepted with mitigations (GDD §1): the **Brightside** mark sits prominently in key art, logo lock-up and store capsule |
| Employer | **Brightside Facilities Co.** ("Brightside") | Cheerful private facilities contractor that won the Moon tender on a very confident slide deck. Motto: *"We keep the bright side bright."* PR-voiced and wildly overconfident (not cheap: that beat belongs to the reference). Logo: a crescent squeegee |
| Dispatcher AI | **DOT** (Dispatch Operations Terminal) | Voice of tutorials, tips and contract reports. Dry corporate politeness. Appears as a small amber status light on HUD panels |
| Player job title | **Custodian** | Ranks shown on profile: Trainee → Custodian → Senior Custodian → Lead Custodian → Head Custodian |
| A saved world | **Contract** | "The Brightside contract for Luna": one persistent moon. Players start, resume, share contracts. Never shown as a signing/agreement screen |
| Session types | **Solo Shift** (1 player) · **Private Shift** (invite code/link, up to 16) · **Open Shift** (public drop-in, up to 16) | Room types; Solo/Private/Open are flags on a Contract session |
| Players together | **the shift** | Prose only ("your shift", "shift wallet"); never an item name or a build mode |

## 2. Currency, progress and meta

| Thing | Name | Notes |
| --- | --- | --- |
| Main currency | **Lumens** (symbol `LM`, icon: small sunburst) | Paid per kg sold; one shared shift wallet per contract |
| Global progress meter | **Shine Index** | % of plots Polished, shown to four decimals; secondary readout shows the moon's **albedo** rising (flavor) |
| Meta currency (profile, persists across contracts) | **Commendations** | Earned from contract milestones and achievements; spent on cosmetics and small quality-of-life perks |
| Profile prestige | **Tenure** (levels) | Grows with plots credited and dust you cleaned yourself; unlocks suit liveries |
| Completion of a contract | **Contract Fulfilled** | Ending sequence + Tenure bonus; contract becomes a free-roam "showcase moon" |

## 3. World

| Thing | Name | Description |
| --- | --- | --- |
| Grid cell (163,842 per contract) | **Plot** | Hexagonal (12 pentagons). IDs shown as e.g. `Plot 41-207` |
| Plot states | **Grimy** (untouched) · **Opened** (≥0.1% cleaned) · **Polished** (≤1% dust left) | Map colors: Grimy = deep umber, Opened = cool cyan, Polished = ivory glow |
| Plot completion stamp | **Inspector's Stamp** | Satisfying stamp VFX + small Lumens bonus when a plot hits Polished |
| Plot info panel (key `C`) | **Plot Card** | Shows plot outline, ID, state, % remaining, credited-to |
| Bases (4 fixed) | **Outpost Boreal** (north pole) · **Outpost Austral** (south pole) · **Outpost Dawnside** (equator, 90°E) · **Outpost Duskside** (equator, 90°W) | Pre-fab lunar modules with big Brightside signage and work lights |
| Thin-dust plots by each outpost | **Landing Apron** | 6 plots blasted mostly clean by landers; the first Stamp |
| Manual selling point | **Assay Counter** | Hold-to-pour dust onto a weighing deck; ka-ching readout |
| Rail-fed selling point | **Receiving Gate** | Accepts pucks, Puck Stacks and Bales; pays on arrival |
| Off-world shipping | **Railshot** | Electromagnetic mass driver at each outpost; fires cargo sleds to Earth orbit (visual payoff, "shipped" counter) |
| Shop for tools & suit gear | **Requisitions Desk** | At every outpost |
| Upgrade tree console | **Ops Console** | At every outpost; opens the Promotions Board |
| Map | **Survey Globe** | 3D rotatable moon with plot states, robots, beacons, outposts |
| Teleport | **Relay Pad** | Only to outposts the shift has visited; small Lumens fee; not from vehicles |
| Waypoints (12, shared) | **Flare Beacons** | Tall colored light pillars |
| Collectibles (exploration rewards) | **Stray Cargo** (150 pieces of lost Brightside freight: Near Parcels, Parcels, Crates, Pallets) · **Survey Points** (24 notable real craters/rilles to scan, e.g. a central peak) · **Core Samples** (40 on Steep plots, Review 3+) | Replaces the reference game's flags/mission sites with our own concept |
| Dust | **regolith dust** (prose) | Dark gray-brown, fine, clingy |

## 4. Hand tools (6 + building tool) — bought per player at the Requisitions Desk

| Tier | ID | Name | Visual concept |
| --- | --- | --- | --- |
| T1 (free) | `tool.desk_duster` | **Desk Duster** | Small ceremonial desk brush, polished wood and brass, from Brightside's winning tender presentation ("used to dust the model Moon"). The genre's "absurdly small start" — ours, without the cheap-employer joke |
| T2 | `tool.crescent_squeegee` | **Crescent Squeegee** | Hand squeegee shaped like Brightside's crescent logo; rubber blade, orange grip |
| T3 | `tool.bristle_broom` | **Bristle Broom** | Full-length broom with an aluminum shaft |
| T4 | `tool.lane_broom` | **Lane Broom** | Wide flat head on a T-handle; leaves lane-straight trails |
| T5 | `tool.static_rake` | **Static Rake** | Electrostatic comb that lifts charged dust (real lunar dust is electrostatically charged); faint blue crackle |
| T6 | `tool.ion_curtain` | **Ion Curtain** | ~1 m emitter bar projecting a shimmering collection field |
| Build tool | `tool.assembly_gun` | **Assembly Gun** | Chunky blueprint projector; unlocks the build menu |

Per-tool dust container: **Dust Cell** (levels I, II, III, bought once for the shift).

## 5. Promotions Board (upgrade tree: hub + 5 departments, 23 nodes)

Hub (owned from start): **Employee Badge**.

| Department | Root (3 lv) | Secondary nodes (2 lv) | Capstone (1 lv) |
| --- | --- | --- | --- |
| **Storage** (container capacity) | Dust Cell lines (6 per-tool nodes) | **Densifier** (+% all cells) | **Overflow Former** (a full cell bands itself into a Puck Stack at your feet) |
| **Technique** (cleaning) | **Broad Strokes** (width) | **Scour** (depth) · **Telescoping Pole** (reach) | **Master Stroke** |
| **Fitness** (suit) | **Cadence** (move speed) | **Loft** (jump) | **Second Wind** |
| **Haulage** (logistics) | **Quick Pour** (deposit time) | **Puck Magnet** (pickup reach) · **Strong Arm** (throw) | **Smooth Handoff** |
| **Accounts** (economy) | **Rate Review** (payout %) | **Rebate** (tool/vehicle discount) · **Stamp Premium** (Inspector's Stamp payout) | **Golden Handshake** |

## 6. Suit gear (5 lines) — Requisitions Desk, shared by the shift

| Line | Name | Levels | Concept |
| --- | --- | --- | --- |
| Quick slots | **Holster Rig** | 5 (2→6 slots) | Chest/hip rig with tool clips |
| Jet pack | **Hop Pack** | 3 (2→4 bursts) | Compact cold-gas thrusters; white plumes |
| Gravity toggle | **Ballast Soles** | 1 | Weighted magnetic sole plates; toggles Earth-feel gravity (`B`) |
| Helmet light | **Crown Lamp** | 4 (Clip Light → Spot Ring → Wide Halo → Searchlight) | Lamp ring on helmet crown |
| Night vision | **Lowlight Visor** | 1 | Green-amber visor overlay (`N` cycles lamp/visor/off) |

## 7. Vehicles (5) — Motor Pool (garage) required

| Tier | Name | Seats | Concept |
| --- | --- | --- | --- |
| 1 | **Trundle** | 0 (walk-behind) | Push-handle cart with a spinning brush drum |
| 2 | **Skiff** | 1 | Low ride-on cleaner, open frame, big balloon tires |
| 3 (transport) | **Carryall** | 8 | Flatbed people/puck mover; no cleaning |
| 4 | **Bulldust** | 1 | Heavy articulated cleaner with a wide skirt ("bulldust" = very fine dust) |
| 5 | **Behemoth** | 1 (+cab) | Tracked mega-cleaner, slow and enormous, giant payload bay |

Vehicle upgrade lines (7): **Gear Ratio** (speed) · **Cargo Expander** (payload) · **Afterburner** (boost) · **Throttle Lock** (hands-free cruise) · **Wide Mouth** (cleaning width, trades speed) · **Fast Tip** (unload speed) · **Running Lamps** (vehicle lights).
Review-gated personal track: **Refit I / II / III** (wider skirt, bigger payload).
Vehicle capacity stat label: **Payload** (not "hopper").
Garage parts: **Motor Pool** (garage), **Dust Vault** (buffer store), **Dump Plate** (unload pad).
Air-time callouts: **Hang Time**, **Moonshot!**, **Lunar Loop**, **Corkscrew**, **Faceplant** (wipeout).

## 8. Robots (3 tiers)

| Tier | Name | Base | Concept |
| --- | --- | --- | --- |
| Local Mk I | **Sandpiper** | **Roost** (dock; cleans 2 rings of plots around it) | Small skittering bird-like bot with a brush beak |
| Local Mk II | **Plover** | Roost (3 rings) | Bigger, faster, two brush heads |
| Global | **Albatross** | none; delivers to **Nests** (catcher buildings) as 20-kg **Bales** | Long-range hopping drone that seeks the nearest Grimy plot near its Work Front, else anywhere |

States (UI, 9): **Foraging** (cleaning) · **Flying** (travelling) · **Inbound** (returning to the Roost) · **Molting** (emptying the crop) · **Patch Picked Clean** (patch done) · **Roost Brimming** (store full) · **Crop Full** (bin full) · **Grounded** (switched off) · **Resting** (idle).
Robot actions: **Re-site** (move a Roost) · **Ground** (switch off) · **Work Front** (where the flock works) · **Flock Formations**: *Spread*, *Sweep Line*, *Ring*.

## 9. Logistics, production, power, building

| Thing | Name | Concept |
| --- | --- | --- |
| 1-kg compacted dust unit | **Dust Puck** | Hockey-puck brick with a Brightside stamp |
| Banded bundle of pucks (≤20 kg, one rail unit) | **Puck Stack** | Pucks strapped with Brightside tape |
| Packager | **Puck Former** | Buffer + press that turns poured dust into Puck Stacks |
| Belt | **Glide Rail** | Low maglev rail; pucks slide on it with a soft hum |
| Drag-to-lay rail tool | **Rail Run** | |
| Splitter / merger | **Rail Fork** / **Rail Join** | |
| Production 1 (dust → 3-ish× value) | **Bead Kiln** → **Glass Beads** | Real regolith sintering into glass; orange glow |
| Production 2 (dust + beads → 7-ish× value) | **Tile Sinterer** → **Sinter Tiles** | Long oven that bakes glossy tiles |
| Solar S / M / L | **Sun Sprig** / **Sun Fan** / **Heliostat** (tracks the sun) | |
| Battery | **Night Cell** | |
| Light mast (Services) | **Lamp Pylon** | |
| Build pieces | **Deck Plates** (foundations), **Gantries** (catwalks), **Handrails** (handrails, corner posts, swing gate, end post, grab bar), **Panels** (solid, porthole, archway and louvre panels in 2 m and 4 m widths, plus the **Shine display panel**) | Surface finishes (6): **Brushed, Regolith Cast, Anodised, Enamel, Patina, Chrome** |
| Build modes | **Place**, **Reposition** (move), **Reclaim** (refunds the price paid) | Placing on dust **settles** the footprint (Settle) |

## 10. Achievements (initial 33 — game-designer may extend)

First Light (first stroke) · New Equipment Smell (first tool upgrade) · Assay Approved (first sale) · Grime Time (open a plot) · Stamped (first Polished plot) · Lint Trap (10 kg) · Century Mark (100 kg) · Forklift Certified (1 t) · Heavy Industry (10 t) · Plot Twist (10 plots) · Neighborhood Watch (100) · District Manager (1,000) · Hemisphere Hero (10,000) · First Railshot · Salvo (10 Railshots) · Rail Riders (first Glide Rail delivery) · Hard Hat (first build) · Tire Tracks (first vehicle clean) · Loop de Loop (a puck rides a full loop) · Tip Jar (1k LM) · Five Figures (10k) · Bonus Season (100k) · Lumen Magnate (1M) · Big Spender (10k spent) · Capital Projects (100k spent) · Megaproject (1M spent) · Counter Culture (100 manual pours) · Known by Name (1,000) · Glimmer (Shine 1%) · Gleam (Shine 10%) · Equinox (Shine 50%) · Contract Fulfilled (100%) · Shift Work (play with 2+ players).

## 11. UI vocabulary

Main menu: **Clock In** (play) · **Contracts** · **Locker** (cosmetics/profile/avatar editor) · **Settings** · **Credits**.
HUD labels: **Cell** (dust gauge), **LM**, **Shine**, **Holster**, **Lamp**, **Visor**, **Hop**, **Flock** (On-Shift chip), **Effort**.
Tutorial voice: DOT. Notifications: "Requisition approved", "Plot stamped", "Railshot away", "Roost idle: Re-site?".

## Additions (game-designer, 2026-11-12)

Added with the GDD and the progression and economy docs. Each name was checked against the banned lists in `moon-sweepers-mechanics.md` §8 and `roblox-references.md` §9, including close variants (rule 3). IDs follow the `category.snake_case` pattern.

### A1. Progression systems

| Thing | Name | Notes |
| --- | --- | --- |
| Contract milestones at Shine 1/5/10/25/50/75% | **Performance Review** (Review 1–6) | Unlocks content, gives a free issue and Commendations. DOT: "Performance Review scheduled." |
| Two hands-on tasks a Review needs | **Review Brief** | |
| Robot upgrade tree (Ops Console tab) | **Flight Plan** | 5 lines: **Keen Beak** (clean rate) · **Deep Crop** (bins/stores) · **Tailwind** (Albatross speed) · **Wide Wing** (Roost rings) · **Homing** (I **Straggler Priority**, II **Punch List Sweep**); one-time item **Auto-Relocate** |
| Robot rate multiplier from active players | **On-Shift Bonus** | HUD chip, e.g. "Flock ×2.04 · Effort 100%" |
| A player's measured cleaning work | **Effort** | |
| Robots with nobody cleaning | **Unattended** (×0.5) | |
| Where the Albatross flock works | **Work Front**; modes **Flock Formations** (*Spread*, *Sweep Line*, *Ring*) | Plots finished there are **Escorted** |
| Raw sale rate for unprocessed Albatross Bales | **Bulk Rate** | |
| Count caps granted by Reviews | **Roost Permits** · **Flock Permits** (Albatross) · **Plant Permits** (Kilns + Tile Sinterers) | |
| Production machine levels | **Grade I / II / III** | |
| Vehicle late track | **Refit I / II / III** | |
| Buildable selling point | **Field Gate** | Includes a mini-Railshot |
| Direct Nest/Dust Vault output into an adjacent Gate or machine | **Bale Chute** | |
| Recorded Carryall shuttle route | **Carryall Convoy** | |
| Sell-from-anywhere suit add-on | **Remote Assay** | |
| Repeat-copy discount for tools/vehicles | **Repeat Requisition** | |
| Free low-tier tools for all members | **Standard Issue** | |
| Building on dust | **Settle** | |
| Late-contract helpers | **Spot Check** (nearest-unpolished ping) · **Punch List** (remaining-plot list) · **Final Walkthrough** (Review 6 mode) · **Closing Bonus** (Stamp ×2) · **Clean-up Order** (priority robot pass on a flagged plot) · **Brightside Service Call** (pre-Albatross clean-up) | |
| Next-purchase HUD tracker | **Next Requisition** | |
| Permit-free cosmetic money sink | **Brightside Monument** | |

### A2. Tool traits

**Detailing** (Desk Duster) · **Flick** (Crescent Squeegee) · **Sure Footing** (Bristle Broom) · **Lane Lock** (Lane Broom) · **Charge** (Static Rake) · **Twin Pass** (Ion Curtain).

### A3. World and navigation

| Thing | Name |
| --- | --- |
| Terrain classes | **Highland** · **Mare** · **Crater Floor** · **Steep** (undriveable) |
| Stray Cargo sizes | **Near Parcel** · **Parcel** · **Crate** · **Pallet** |
| Run (not while sweeping) | **Lope** |
| Paid return to nearest outpost | **Outpost Recall** |
| In-game help (H) | **DOT Handbook** |
| Outpost social room | **Break Room**, with **Rock Garden** (rake patterns into a regolith tray; screenshot-able), **Postcard Rack** (send a Shine postcard to the shift), **Earthview Window**, **Hold Music** (Brightside's on-hold tracks on the DOT terminal) |
| MVP play-area boundary | **Pilot Fence** around the **Boreal Pilot Area**; MVP milestone **Pilot Review** |
| MVP stand-in for Roost rails | **Roost Uplink** |
| Contract sizes | **Standard Contract** (163,842 plots) · **Moonlet Contract** (post-launch, 40,962 plots) |
| Post-completion modes | **Overtime** (post-game goals) · **Beacon Run** (time trials between Flare Beacons) |
| Post-Skiff onboarding goal | **Field Trip** |

### A4. Co-op, session and moderation

| Thing | Name |
| --- | --- |
| Permission roles | **Holder** (contract owner) · **Supervisor** · **Staff** · **Temp** (Open Shift drop-in) |
| Temp loan of tools and vehicles | **Loaner Kit** (replaces v1 "Petty Cash") |
| Mass-revert one player's builds | **Incident Report** (→ Revert) |
| Idle state | **On Break** |
| Public shift list / player list (Tab) | **Shift Board** / **Shift Roster** |
| Session bookends and goals | **Shift Briefing** · **Shift Docket** (3 shared goals) · **Shift Report** |
| Joiner catch-up summary | **Orientation Packet** |
| Chat text-to-speech | **Read Aloud** |
| Onboarding quest chains | **Induction Checklist** · **Probation Checklist** |
| Offline robot catch-up (post-launch) | **Night Shift** |

### A5. Meta layer

| Thing | Name |
| --- | --- |
| Earnable QoL perks (replacing the Roblox paid conveniences) | **Benefits Package**: **Signing Bonus** · **Pre-Approved Motor Pool** · **Fleet Voucher** · **Courier Pass** · **Quick Clip** · **Lope Training** · **Comfort Seat** |
| Role ladder (one active; more slots with Tenure) | **Certifications**: **Brushwork** · **Railhand** · **Driver** · **Assembly** · **Aviary** · **Finisher** · **Dispatch** |
| Collectible-set liveries | **Lost & Found** (all Stray Cargo) · **Bedrock** (all Core Samples) |

### A6. Liveries and player colors (docs-keeper pass, 2026-11-12, for art-direction §4.4 and §4.5)

Checked against the DO NOT USE lists in moon-sweepers-mechanics.md §8 and roblox-references.md §9; no collisions or close variants. IDs follow category.snake_case.

| Rank livery ID | Name |
| --- | --- |
| livery.trainee | **Learner Band** |
| livery.custodian | **Teal Chevron** |
| livery.senior | **Service Stripe** |
| livery.lead | **Graphite Gold** |
| livery.head | **Inverse Issue** |

| Player color ID | Name | Player color ID | Name |
| --- | --- | --- | --- |
| P01 | **Ember** | P09 | **Iris** |
| P02 | **Marigold** | P10 | **Orchid** |
| P03 | **Citrine** | P11 | **Bloom** |
| P04 | **Pear** | P12 | **Rosewater** |
| P05 | **Jade** | P13 | **Sandstone** |
| P06 | **Lagoon** | P14 | **Frost** |
| P07 | **Azure** | P15 | **Garnet** |
| P08 | **Cobalt** | P16 | **Pine** |

### A7. World features (lead, 2026-11-12)

| Thing | Name | Description |
| --- | --- | --- |
| Permanent-grazing-sun bands on the equator (≈135°E, ≈45°W) | **Twilight Strips** | Where the sun path's pole meets the surface: endless sunrise light, extreme shadows, a photo-mode favourite. Solar output there is tiny (economy §11) |

### A8. Rename log v2 (game-designer, 2026-11-12; from the independent game-design review M15, M16, m6, m7, M17)

Display names and IDs change together (`old_id` → `new_id`). Each new name was checked against `moon-sweepers-mechanics.md` §8 and `roblox-references.md` §9 with rules 1–5.

| Old | New | Slot | Why |
| --- | --- | --- | --- |
| Whisk Brush (`tool.whisk_brush`) | **Crescent Squeegee** (`tool.crescent_squeegee`) | T2 tool | ≈ "Hand brush"; new name also avoids "Pocket" (Pocket Money / Pocket Full of Moon) |
| Auto-Puck | **Overflow Former** | Storage capstone | Near-homophone of Auto-Packer |
| Express Lane | **Smooth Handoff** | Haulage capstone | Same head word as Express Dock / Express Delivery |
| Long Arm | **Telescoping Pole** | Reach node | Same construction as Long Reach |
| Deep Clean | **Scour** | Depth node | ≈ Deep Heads |
| Spring Step | **Cadence** | Speed root | ≈ Servo Stride |
| Moon Hop | **Loft** | Jump node | ≈ Lunar Leap |
| Bulk Buyer | **Rebate** | Discount node | "Bulk" reused (Bulk Rate) |
| Plot Bonus | **Stamp Premium** | Stamp payout node | ≈ Region Bounty |
| Anchor Boots | **Ballast Soles** | Gravity toggle | ≈ Gravity Boots, CTM "Boots" |
| Work Beam / Flood Crown | **Spot Ring** / **Wide Halo** | Crown Lamp levels | ≈ work lamp / floodlamp |
| Cruise Hold | **Throttle Lock** | Vehicle upgrade | ≈ Cruise Control |
| Deep Hopper | **Cargo Expander** | Vehicle upgrade | ≈ Big Hopper; "Hopper" is a banned CTM vehicle |
| Work Lights (vehicle line) | **Running Lamps** | Vehicle upgrade | ≈ Floodlights / work lamp |
| Hopper Bin | **Dust Vault** | Garage buffer | Exact banned word "Hopper" |
| Work Light Mast | **Lamp Pylon** | Services piece | ≈ work lamp |
| Sinter Press (`machine.sinter_press`) | **Tile Sinterer** (`machine.tile_sinterer`) | Production 2 | "[material] Press" = Stone press / Block Press |
| Plot Scan (key G) | **Plot Card** (key C) | Plot info | ≈ region scan, same key |
| Shift (build mode) | **Reposition** | Build mode | "Shift" overloaded |
| Rails & Railings (tab) | **Handrails** | Structures sub-tab | "Rail" overloaded; "railing" is a banned wall piece |
| Panels: wall / window / door × full / half / third | **Panels: solid / porthole / archway / louvre × 2 m / 4 m + Shine display panel** | Structures set | One-to-one clone of the reference's wall set |
| Finishes: Brushed, Tread, Mesh, Glow, Chevron | **Brushed, Regolith Cast, Anodised, Enamel, Patina, Chrome** | Surface finishes | One-to-one clone of Concrete / Diamond plate / Grating / Lit / Hazard stripes |
| Puck Toss · Notice Board · Brightside FM | **Rock Garden · Postcard Rack · Hold Music** | Break Room | ≈ air hockey · whiteboard · radio |
| Survey Fence · Boreal Survey Area · Survey Review | **Pilot Fence · Boreal Pilot Area · Pilot Review** | MVP | "Survey" overloaded |
| Certification Haulage | **Railhand** | Certification | ≈ CTM class "Hauler"; "Haulage" overloaded |
| Certification Motor Pool | **Driver** | Certification | "Motor Pool" overloaded |
| Certification Inspection | **Finisher** | Certification | "Inspection" overloaded with Inspector's Stamp |
| Petty Cash | **Loaner Kit** | Temp allowance | System replaced (review M10) |
| Robot states: Sweeping · Travelling · Returning · Docking · Emptying · Scanning · Plot Done · Roost Full · Bin Full · Paused · Idle | **Foraging · Flying · Inbound · Molting · Patch Picked Clean · Roost Brimming · Crop Full · Grounded · Resting** | Robot states | Docking and Bin Full exact matches; 11-for-11 clone of the reference list |
| Brush Up | **New Equipment Smell** | Achievement | ≈ Get A Better Brush |
| Pocket Lint | **Lint Trap** | Achievement | ≈ Pocket Full of Moon |
| Bucket List | **Century Mark** | Achievement | "Bucket" is a banned CTM container |
| Tonnage | **Forklift Certified** | Achievement | ≈ A Literal Ton of Dust |
| Ten Plots | **Plot Twist** | Achievement | Placeholder |
| Rail Regular | **Salvo** | Achievement | ≈ Regular Customer |
| Wheels Down | **Tire Tracks** | Achievement | ≈ Finally, Wheels |
| Pocket Change | **Tip Jar** | Achievement | ≈ Pocket Money (CTM lobby upgrade) |
| Payroll | **Five Figures** | Achievement | ≈ Payday / Lunar Payday |
| Regular at the Desk | **Known by Name** | Achievement | ≈ Regular Customer |
| Shine 1% | **Glimmer** | Achievement | Placeholder |
| Shine 10% | **Gleam** | Achievement | Placeholder |
| Halfway Bright | **Equinox** | Achievement | ≈ Half Way There |
| Desk Duster concept "comically tiny complimentary desk brush" | "ceremonial desk brush from the winning tender pitch" | Lore | Review M17: drop the cheap-employer / tiny-tool beat |

### A9. Animation-related names (animation-engineer, 2026-11-12, for [animation-spec.md](animation-spec.md))

Numbered A9 because A8 is the rename log. Each name was checked against `moon-sweepers-mechanics.md` §8 and `roblox-references.md` §9 with rules 1–5. No exact matches or same-slot close variants were found (the reference games have no emote slot). "Polish" and "Shine" are avoided because of rule 5 (Polished, Shine Index). Clip and bone IDs are internal and follow animation-spec §1.6. Where an ID names a game thing, it reuses the words in this file (`lope`, `hop_pack`, `ballast`, `bristle_broom`, `on_break`, `faceplant`).

| Thing | ID | Name | Tier | Gesture |
| --- | --- | --- | --- | --- |
| Emote menu (proposed sub-ring of the ping wheel; game-designer decides the binding) | `ui.gestures` | **Gestures** | MVP | — |
| Emote | `emote.hail` | **Hail** | MVP | Big two-arm overhead wave with a slow low-g toe bounce |
| Emote | `emote.top_marks` | **Top Marks** | MVP | Thumbs-up and nod |
| Emote | `emote.brush_off` | **Brush-Off** | MVP | Pats regolith dust off shoulders and thighs (small grain puffs) |
| Emote | `emote.slide_deck` | **Slide Deck** | v1.0 | Presents an imaginary slide with a flourish (Brightside lore) |
| Emote | `emote.clock_watch` | **Clock Watch** | v1.0 | Taps the wrist |
| Emote | `emote.not_my_department` | **Not My Department** | v1.0 | Shrug |
| Emote | `emote.earthrise` | **Earthrise** | v1.0 | Shades the visor and gazes at the Earth |
| Emote | `emote.visor_buff` | **Visor Buff** | v1.0 | Buffs the visor with a glove |
| On-foot wipeout from a fall over 19.7 m (impact > 8.0 m/s) | — | **Faceplant** (existing name, same meaning as the vehicle callout) | MVP | — |

Resolved 2026-11-12: the title **Moon Cleanup** is an owner decision; see the Title exception under the naming rules.

### A10. UI names (ui-ux-motion-designer, 2026-11-12, for [ui-screens-and-flows.md](ui-screens-and-flows.md))

Each name was checked against `moon-sweepers-mechanics.md` §8 and `roblox-references.md` §9 with rules 1–5. No exact matches or same-slot close variants were found. **Equipment Card** replaces the GDD's prose "robot and machine panels", because "robot panel" is a banned reference term. "Card" keeps the one meaning it already has in **Plot Card** (an info panel). "Service" and "Board" were avoided (rule 5: Services tab, Brightside Service Call, Promotions Board, Shift Board). The UI spec displays the title as **Moon Cleanup** (owner rename); the §1 title row and the title-risk note at the end of A9 are the game-designer's and Cee's to update.

| Thing | ID | Name | Tier | Notes |
| --- | --- | --- | --- | --- |
| Pause menu (Esc / Menu; the world keeps running) | `ui.time_card` | **Time Card** | MVP | Fits Clock In / Clock Out. Shows this session's time, Lumens earned, plots stamped, Effort |
| Leave the shift (counterpart of Clock In) | `ui.clock_out` | **Clock Out** | MVP | Already GDD §8 prose; now a UI label. Leads to the Shift Report (v1.0) |
| Info and actions panel for a Roost, Nest, machine, Gate or power piece, with the "Why isn't this working?" status line | `ui.equipment_card` | **Equipment Card** | MVP (Roost) | Replaces "robot panel" (banned) |
| Assembly Gun build menu (5 tabs) | `ui.parts_catalog` | **Parts Catalog** | v1.0 | Not "build menu", "lobby shop" or "supply wall" |
| Assay Counter pour readout (weighed kg, rate, Lumens paid, Railshot progress) | `ui.assay_slip` | **Assay Slip** | MVP | Prints "APPROVED" with a stamp glyph on completion |
| Profile page in the Locker (name, rank, Tenure, Commendations, Certifications, Benefits Package) | `ui.personnel_file` | **Personnel File** | MVP (stub) | Not "YOUR ASTRONAUT" |
| Reconnect overlay and the avatar tag of a disconnected player | `ui.signal_lost` | **Signal Lost** | MVP | Same words as the netcode seat-hold avatar flag |
| HUD toast notification with DOT's amber light | `ui.dot_notice` | **DOT Notice** | MVP | "Notice Board" (retired in A8) is not reused as a place name |

### A11. Feel & controls names (game-designer brief, 2026-11-12, for [game-feel-and-controls.md](game-feel-and-controls.md))

Requested as "A9"; numbered A11 because A9 (animation) and A10 (UI) were added in parallel. Each name was checked against `moon-sweepers-mechanics.md` §8 and `roblox-references.md` §9 with rules 1–5. No exact matches or same-slot close variants. Notes: **Chase** avoids the banned reference UI phrase "Vehicle camera follows behind" (so the Settings label should not be "Follow"); **Auto-Level** was chosen over "Air Assist", which shares a head word with the banned logistics node "Throw Assist"; **Auto-Sweep** shares "Sweep" only with a Roblox pass in another slot ("Sell As You Sweep") and is already GDD §13 prose. "Quick" was avoided for the fast-fall action ("Quick Feet", "Quick Release" are banned; Quick Pour and Quick Clip already use it, rule 5).

| Thing | ID | Name | Tier | Notes |
| --- | --- | --- | --- | --- |
| Hold in the air to fall faster (gravity ×2.5) | `action.touchdown` | **Touchdown** | MVP | Ctrl / LT in the air |
| Lane Lock assist: parallel snap, guide line and lateral magnet | `setting.lane_guide` | **Lane Guide** | MVP | Off / Guide / Guide + Magnet |
| Sweep stays on while moving (GDD §13 auto-sweep) | `setting.auto_sweep` | **Auto-Sweep** | MVP | Sweep hold option |
| Accessibility: start in Earth-feel, toggle available without buying Ballast Soles | `setting.earth_feel_comfort` | **Earth-Feel Comfort** | MVP | The "Ballast Soles default on" row of ui-screens-and-flows §3.21 |
| Vehicle self-levelling in the air | `setting.auto_level` | **Auto-Level** | v1.0 | Default on |
| Longer coyote, buffer and hold windows | `setting.relaxed_timing` | **Relaxed Timing** | MVP | Accessibility |
| Vehicle camera modes | `setting.vehicle_cam_chase` / `setting.vehicle_cam_free` | **Chase** / **Free Look** | MVP | Replaces "Follow / Free-look" |
| RMB / LT aim mode for tools without an active trait | `action.precision_aim` | **Precision Aim** | MVP | Twin Pass aim is its Ion Curtain variant |
