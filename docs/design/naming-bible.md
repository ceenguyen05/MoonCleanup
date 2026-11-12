# Naming bible — Clean The Moon!

Direction: `docs/design/REFERENCE_TARGET.md` overrides retired naming/style/custom-gate rules.

Status: **Editable catalog, 2026-11-12.** Owner: game-designer; Cee and the lead may refine display names.
Follow [REFERENCE_TARGET](REFERENCE_TARGET.md). This catalog keeps terminology consistent; it is **not a hard naming lock**.

## Naming policy

- Game title: **Clean The Moon!** — exact capitalization and exclamation mark, selected by Cee.
  Use this name in UI, metadata, documentation and future assets. Only Cee changes the game title; item/feature display labels remain flexible.
  Keep technical slug `moon-cleanup`, package scope and save IDs stable; these are implementation identifiers, not display titles.
- Prefer clear familiar labels: toothbrush, brush, broom, sweeper, rover, vacuum, canister, container, capsule, conveyor,
  intake, garage, silo, robot, crew, sector, backpack, bucket, cash, lamp and night vision are allowed.
- No token-overlap, same-slot, synonym, near-homophone, set-size or "different concept" rejection rule. Do not rename a
  useful common term solely because the reference uses it. Do not force awkward corporate/bird terminology on players.
- Employer, dispatcher, currency and item names below are editable defaults. The lead may add/refine a display label and
  update its catalog/data string in the same task; routine naming needs no owner permission, extra reviewer or standalone ADR.
- One display-label source in game-data/UI strings. Existing IDs are stable keys, not a requirement to display their spelling.
  Renaming an ID/save key follows the normal contract/migration process; a display rename alone does not.
- Keep authored assets/text/logos and distinct fictional branding; use reference names freely in research/review discussion.
  Do not ship the reference's distinctive studio/organization/character branding or present this as its official game.
- Historical rename log §A8 explains old edits; its bans/reasons are retired and cannot block a task. No name in this
  catalog is "required to differ" from the reference; "not X" notes below are label preferences, not bans.
- Entries marked **(optional ★)** name parked custom progression ([GDD §18](GDD.md), [economy §24](progression-and-economy.md));
  keep their IDs reserved, but they are not baseline UI.

## 1. Identity

| Thing | Name | Description / visual concept |
| --- | --- | --- |
| Game title | **Clean The Moon!** | Owner-selected exact title; keep technical slug `moon-cleanup`. Logo/key art use the same title. |
| Employer | **Brightside Facilities Co.** ("Brightside") | Cheerful private facilities contractor that won the Moon tender on a very confident slide deck. Motto: *"We keep the bright side bright."* PR-voiced, wildly overconfident and a little cheap. Logo: a crescent squeegee |
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
| Meta currency (profile, persists across contracts) **(optional ★)** | **Commendations** | Earned from contract milestones and achievements; spent on cosmetics and small quality-of-life perks |
| Profile prestige **(optional ★)** | **Tenure** (levels) | Grows with plots credited and dust you cleaned yourself; unlocks suit liveries |
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
| Collectibles (exploration rewards) | **Stray Cargo** (150 pieces of lost Brightside freight: Near Parcels, Parcels, Crates, Pallets) · **Survey Points** (24 notable real craters/rilles to scan, e.g. a central peak) · **Core Samples** (optional ★: 40 on Steep plots) | Our counterpart of the reference's flags and mission sites |
| Dust | **regolith dust** (prose) | Dark gray-brown, fine, clingy |

## 4. Hand tools (6 + building tool) — bought per player at the Requisitions Desk

| Tier | ID | Name | Visual concept |
| --- | --- | --- | --- |
| T1 (free) | `tool.desk_duster` | **Desk Duster** | Small ceremonial desk brush, polished wood and brass, from Brightside's winning tender presentation ("used to dust the model Moon"). The "absurdly small start"; display alias Toothbrush / Starter Brush allowed |
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
**(optional ★)** Late personal track: **Refit I / II / III** (wider skirt, bigger payload).
Vehicle capacity stat label: **Payload** (not "hopper").
Garage parts: **Motor Pool** (garage), **Dust Vault** (buffer store), **Dump Plate** (unload pad).
Air-time callouts: **Hang Time**, **Moonshot!**, **Lunar Loop**, **Corkscrew**, **Faceplant** (wipeout).

## 8. Robots (3 tiers)

| Tier | Name | Base | Concept |
| --- | --- | --- | --- |
| Local Mk I | **Sandpiper** | **Roost** (dock; cleans 2 rings of plots around it) | Small skittering bird-like bot with a brush beak |
| Local Mk II | **Plover** | Roost (3 rings) | Bigger, faster, two brush heads |
| Global | **Albatross** | none; delivers to **Nests** (catcher buildings) as 20-kg **Bales** | Long-range hopping drone that seeks the nearest Grimy plot anywhere |

States (UI, 9): **Foraging** (cleaning) · **Flying** (travelling) · **Inbound** (returning to the Roost) · **Molting** (emptying the crop) · **Patch Picked Clean** (patch done) · **Roost Brimming** (store full) · **Crop Full** (bin full) · **Grounded** (switched off) · **Resting** (idle).
Robot actions: **Re-site** (move a Roost) · **Ground** (switch off). **(optional ★)** **Work Front** (where the flock works) · **Flock Formations**: *Spread*, *Sweep Line*, *Ring*.

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
HUD labels: **Cell** (dust gauge), **LM**, **Shine**, **Holster**, **Lamp**, **Visor**, **Hop**. (The former **Flock** On-Shift chip and **Effort** labels are optional ★.)
Tutorial voice: DOT. Notifications: "Requisition approved", "Plot stamped", "Railshot away", "Roost idle: Re-site?".

## Additions (game-designer, 2026-11-12)

Catalog additions from the earlier GDD/economy pass. Labels remain editable; IDs follow `category.snake_case`. Old generic-name bans no longer apply. In A1, rows marked **(optional ★)** are parked custom progression.

### A1. Progression systems

| Thing | Name | Notes |
| --- | --- | --- |
| Progress celebrations at Shine 1/5/10/25/50/75% (baseline) | **Shine milestone** | DOT toast + music layer; unlocks nothing |
| **(optional ★)** Contract milestones that gate content | **Performance Review** (Review 1–6) | Would unlock content, give a free issue and Commendations. DOT: "Performance Review scheduled." |
| **(optional ★)** Two hands-on tasks a Review needs | **Review Brief** | |
| **(optional ★)** Robot upgrade tree (Ops Console tab) | **Flight Plan** | 5 lines: **Keen Beak** (clean rate) · **Deep Crop** (bins/stores) · **Tailwind** (Albatross speed) · **Wide Wing** (Roost rings) · **Homing** (I **Straggler Priority**, II **Punch List Sweep**); one-time item **Auto-Relocate** |
| **(optional ★, retired from baseline)** Robot rate multiplier from active players | **On-Shift Bonus** | HUD chip, e.g. "Flock ×2.04 · Effort 100%" |
| **(optional ★, retired)** A player's measured cleaning work | **Effort** | |
| **(optional ★, retired)** Robots with nobody cleaning | **Unattended** (×0.5) | |
| **(optional ★)** Where the Albatross flock works | **Work Front**; modes **Flock Formations** (*Spread*, *Sweep Line*, *Ring*) | Plots finished there are **Escorted** |
| **(optional ★, retired)** Raw sale rate for unprocessed Albatross Bales | **Bulk Rate** | |
| Fixed technical count limits (baseline) | **Fleet cap** (Roosts, Albatross) · **Plant cap** (Kilns + Tile Sinterers) | Shown as "12 / 24" |
| **(optional ★)** Count caps granted by Reviews | **Roost Permits** · **Flock Permits** (Albatross) · **Plant Permits** (Kilns + Tile Sinterers) | |
| **(optional ★)** Production machine levels | **Grade I / II / III** | |
| **(optional ★)** Vehicle late track | **Refit I / II / III** | |
| Buildable selling point | **Field Gate** | Includes a mini-Railshot |
| Direct Nest/Dust Vault output into an adjacent Gate or machine | **Bale Chute** | |
| **(optional ★)** Recorded Carryall shuttle route | **Carryall Convoy** | |
| **(optional ★)** Sell-from-anywhere suit add-on | **Remote Assay** | |
| Repeat-copy discount for tools/vehicles | **Repeat Requisition** | |
| Free low-tier tools for all members | **Standard Issue** | |
| Building on dust | **Settle** | |
| Late-contract helpers | **Spot Check** (nearest-unpolished ping) · **Punch List** (remaining-plot list) · **Clean-up Order** (priority robot pass on a flagged plot) · **Brightside Service Call** (pre-Albatross clean-up); **(optional ★)** **Final Walkthrough** (Review 6 mode) · **Closing Bonus** (Stamp ×2) | |
| Next-purchase HUD tracker | **Next Requisition** | |
| **(optional ★)** Permit-free cosmetic money sink | **Brightside Monument** | |

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
| MVP play-area boundary | **Pilot Fence** around the **Boreal Pilot Area**; **(optional ★)** MVP milestone **Pilot Review** (no longer gates the first Roost) |
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
| Session bookends and goals | **Shift Briefing** · **Shift Report**; **(optional ★)** **Shift Docket** (3 shared goals) |
| Joiner catch-up summary | **Orientation Packet** |
| Chat text-to-speech | **Read Aloud** |
| Onboarding quest chains | **Induction Checklist** · **Probation Checklist** |
| Offline robot catch-up (post-launch) | **Night Shift** |

### A5. Meta layer (optional ★)

| Thing | Name |
| --- | --- |
| Earnable QoL perks (replacing the Roblox paid conveniences) | **Benefits Package**: **Signing Bonus** · **Pre-Approved Motor Pool** · **Fleet Voucher** · **Courier Pass** · **Quick Clip** · **Lope Training** · **Comfort Seat** |
| Role ladder (one active; more slots with Tenure) | **Certifications**: **Brushwork** · **Railhand** · **Driver** · **Assembly** · **Aviary** · **Finisher** · **Dispatch** |
| Collectible-set liveries | **Lost & Found** (all Stray Cargo) · **Bedrock** (all Core Samples) |

### A6. Liveries and player colors (docs-keeper pass, 2026-11-12, for art-direction §4.4 and §4.5)

Editable defaults; IDs follow category.snake_case. Research vocabulary is not a generic-name ban list.

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

Retired planning rename history removed. Current naming policy above controls labels; keep existing IDs stable.

### A9. Animation-related names (animation-engineer, 2026-11-12, for [animation-spec.md](animation-spec.md))

Animation/emote defaults; names are editable. Preserve clip/bone IDs and use aliases for display changes. The old rules 1–5 are retired.

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

Resolved 2026-11-12: **Clean The Moon!** is the owner-selected exact game title; see Naming policy above.

### A10. UI names (ui-ux-motion-designer, 2026-11-12, for [ui-screens-and-flows.md](ui-screens-and-flows.md))

Editable UI vocabulary; generic labels such as robot panel are permitted. Current game title is Clean The Moon!; old title-risk/name-exclusion notes do not apply.

| Thing | ID | Name | Tier | Notes |
| --- | --- | --- | --- | --- |
| Pause menu (Esc / Menu; the world keeps running) | `ui.time_card` | **Time Card** | MVP | Fits Clock In / Clock Out. Shows this session's time, Lumens earned, plots stamped |
| Leave the shift (counterpart of Clock In) | `ui.clock_out` | **Clock Out** | MVP | Already GDD §8 prose; now a UI label. Leads to the Shift Report (v1.0) |
| Info and actions panel for a Roost, Nest, machine, Gate or power piece, with the "Why isn't this working?" status line | `ui.equipment_card` | **Equipment Card** | MVP (Roost) | Robot/equipment panel; editable label |
| Assembly Gun build menu (5 tabs) | `ui.parts_catalog` | **Parts Catalog** | v1.0 | Plain alias **Build Menu** is allowed |
| Assay Counter pour readout (weighed kg, rate, Lumens paid, Railshot progress) | `ui.assay_slip` | **Assay Slip** | MVP | Prints "APPROVED" with a stamp glyph on completion |
| Profile page in the Locker (name, achievements; rank, Tenure, Commendations, Certifications, Benefits Package only with the optional ★ meta) | `ui.personnel_file` | **Personnel File** | MVP (stub) | Plain alias **Profile** is allowed |
| Reconnect overlay and the avatar tag of a disconnected player | `ui.signal_lost` | **Signal Lost** | MVP | Same words as the netcode seat-hold avatar flag |
| HUD toast notification with DOT's amber light | `ui.dot_notice` | **DOT Notice** | MVP | Plain alias **Notification** is allowed |

### A11. Feel & controls names (game-designer brief, 2026-11-12, for [game-feel-and-controls.md](game-feel-and-controls.md))

Control-label defaults. Familiar labels such as Follow Camera, Auto-Level, Auto-Sweep and Quick Fall are allowed. Keep remapping/action IDs stable.

| Thing | ID | Name | Tier | Notes |
| --- | --- | --- | --- | --- |
| Hold in the air to fall faster (gravity ×2.5) | `action.touchdown` | **Touchdown** | MVP | Ctrl / LT in the air |
| Lane Lock assist: parallel snap, guide line and lateral magnet | `setting.lane_guide` | **Lane Guide** | MVP | Off / Guide / Guide + Magnet |
| Sweep stays on while moving (GDD §13 auto-sweep) | `setting.auto_sweep` | **Auto-Sweep** | MVP | Sweep hold option |
| Accessibility: start in Earth-feel, toggle available without buying Ballast Soles | `setting.earth_feel_comfort` | **Earth-Feel Comfort** | MVP | The "Ballast Soles default on" row of ui-screens-and-flows §3.21 |
| Vehicle self-levelling in the air | `setting.auto_level` | **Auto-Level** | v1.0 | Default on |
| Longer coyote, buffer and hold windows | `setting.relaxed_timing` | **Relaxed Timing** | MVP | Accessibility |
| Vehicle camera modes | `setting.vehicle_cam_chase` / `setting.vehicle_cam_free` | **Chase** / **Free Look** | MVP | Alias **Follow Camera** is allowed |
| RMB / LT aim mode for tools without an active trait | `action.precision_aim` | **Precision Aim** | MVP | Twin Pass aim is its Ion Curtain variant |

## Current familiar-label aliases

Use natural labels when they communicate the reference role better; these mappings do not rename code/save IDs.

| Existing catalog label / ID vocabulary | Allowed preferred display vocabulary | Meaning |
| --- | --- | --- |
| Desk Duster / `tool.desk_duster` | Toothbrush / Starter Brush | Tiny handled starter brush; authored model/animation |
| Dust Cell | Canister / Tool Container | Limited carrying capacity, with levels |
| Dust Puck / Puck Stack | Dust Capsule / Capsule Bundle | Pack/carry/throw/transport dust |
| Glide Rail / Rail Fork / Rail Join | Conveyor / Splitter / Merger | Visible material logistics |
| Assay Counter / Receiving Gate | Sell Tray / Deposit Intake | Manual or automated sale |
| Motor Pool / Dust Vault | Garage / Silo | Vehicle access and storage |
| Plot / Survey Globe | Sector / Moon Map | Surface progress and navigation |
| Sandpiper / Plover / Albatross | Local Robot Mk I / Mk II / Global Cleaning Robot | Functional robot tiers; bird names/shapes optional |
| Promotions Board / Crown Lamp / Lowlight Visor | Upgrade Tree / Helmet Lamp / Night Vision | Familiar functional labels |

Pick one clear visible label per UI flow. Other legacy labels can remain in docs until their implementation task touches them.
Do not spend the M0 budget mass-renaming prose, packages, contracts or data keys.
