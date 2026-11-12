# Planning fix: game design

Agent: game-design FIX agent · Date: 2026-11-12
Input: [planning-review-game-designer.md](planning-review-game-designer.md) (5 BLOCKER, 19 MAJOR, 10 MINOR).
Files edited (only these): [GDD.md](../design/GDD.md), [progression-and-economy.md](../design/progression-and-economy.md), [scope-tiers.md](../design/scope-tiers.md), [naming-bible.md](../design/naming-bible.md), [mechanics-parity-matrix.md](../research/mechanics-parity-matrix.md). All five now use the new names; the only old names left in them are in the naming bible's rename log (§A8).

## 1. RENAME MAP (apply repo-wide; old → new)

Display names and IDs change together. Each new name was checked against `moon-sweepers-mechanics.md` §8 and `roblox-references.md` §9 using the naming bible's new close-variant rules (same slot, shared content word, near-homophone, same construction).

| Old | New | ID change |
| --- | --- | --- |
| Whisk Brush | **Crescent Squeegee** | `tool.whisk_brush` → `tool.crescent_squeegee` |
| Auto-Puck | **Overflow Former** | `node.auto_puck` → `node.overflow_former` |
| Express Lane | **Smooth Handoff** | `node.express_lane` → `node.smooth_handoff` |
| Long Arm | **Telescoping Pole** | `node.long_arm` → `node.telescoping_pole` |
| Deep Clean | **Scour** | `node.deep_clean` → `node.scour` |
| Spring Step | **Cadence** | `node.spring_step` → `node.cadence` |
| Moon Hop | **Loft** | `node.moon_hop` → `node.loft` |
| Bulk Buyer | **Rebate** | `node.bulk_buyer` → `node.rebate` |
| Plot Bonus | **Stamp Premium** | `node.plot_bonus` → `node.stamp_premium`; `plotBonusMult` → `stampPremiumMult` |
| Anchor Boots | **Ballast Soles** | `suit.anchor_boots` → `suit.ballast_soles` |
| Crown Lamp levels Work Beam / Flood Crown | **Spot Ring** / **Wide Halo** | level names only |
| Cruise Hold | **Throttle Lock** | `vupg.cruise_hold` → `vupg.throttle_lock` |
| Deep Hopper | **Cargo Expander** | `vupg.deep_hopper` → `vupg.cargo_expander` |
| Work Lights (vehicle line) | **Running Lamps** | `vupg.work_lights` → `vupg.running_lamps` |
| vehicle stat "Hopper" | **Payload** | `hopperKg` → `payloadKg` |
| Hopper Bin | **Dust Vault** | `build.hopper_bin` → `build.dust_vault` |
| Work Light Mast | **Lamp Pylon** | `build.work_light_mast` → `build.lamp_pylon` |
| Sinter Press | **Tile Sinterer** (product stays Sinter Tiles) | `machine.sinter_press` → `machine.tile_sinterer` |
| Plot Scan (key G) | **Plot Card** (key **C**) | — |
| Build mode Shift | **Reposition** | — |
| Structures sub-tab Rails & Railings | **Handrails** (pieces: handrail 2 m/4 m, corner post, swing gate, end post, grab bar) | — |
| Panels wall / window / door × full / half / third | **Panels solid / porthole / archway / louvre × 2 m / 4 m + Shine display panel** (still 9) | — |
| Finishes Brushed, Tread, Mesh, Glow, Chevron (5) | **Brushed, Regolith Cast, Anodised, Enamel; Patina and Chrome at Review 3** (6) | — |
| Break Room Puck Toss · Notice Board · Brightside FM | **Rock Garden · Postcard Rack · Hold Music** (Earthview Window unchanged) | — |
| Survey Fence · Boreal Survey Area · Survey Review | **Pilot Fence · Boreal Pilot Area · Pilot Review** | heading anchor `#1-mvp-v020--boreal-survey-area` → `#1-mvp-v020--boreal-pilot-area` |
| Certification Haulage · Motor Pool · Inspection | **Railhand · Driver · Finisher** | `cert.*` |
| Petty Cash | **Loaner Kit** (system replaced, not just renamed) | `economy.pettyCash` removed; `moderation.loanerKit` |
| Robot states (11): Sweeping · Travelling · Returning · Docking · Emptying · Scanning · Plot Done · Roost Full · Bin Full · Paused · Idle | **(9): Foraging · Flying · Inbound · Molting · Patch Picked Clean · Roost Brimming · Crop Full · Grounded · Resting** (Scanning merged into Flying; Docking into Inbound) | state enum |
| Achievements: Brush Up · Pocket Lint · Bucket List · Tonnage · Ten Plots · Rail Regular · Wheels Down · Pocket Change · Payroll · Regular at the Desk · Shine 1% · Shine 10% · Halfway Bright | **New Equipment Smell · Lint Trap · Century Mark · Forklift Certified · Plot Twist · Salvo · Tire Tracks · Tip Jar · Five Figures · Known by Name · Glimmer · Gleam · Equinox** | achievement ids |
| Desk Duster lore "comically tiny complimentary desk brush" | "small ceremonial desk brush from Brightside's winning tender pitch" (still small) | — |

**Title:** the owner has since renamed the game **Moon Custodians → Moon Cleanup**; the lead applies that repo-wide (my five files still say "Moon Custodians", including GDD §1's title table and naming-bible §1; slug `moon-custodians` → presumably `moon-cleanup`). See X14 for a naming-rule conflict.

Not renamed by me: the title, Haulage *department*, Motor Pool *building*, Inspector's Stamp, Survey Globe, Survey Points, Bulk Rate.

New names introduced (all checked): Landing Apron, Near Parcel, Puck Stack, Rail Run, Re-site, Ground, Settle, Effort, Unattended, Work Front, Flock Formations (Spread / Sweep Line / Ring), Escorted, Carryall Convoy, Refit I–III, Review Brief, Core Samples, Bedrock (livery), Loaner Kit, Brightside Service Call, Brightside Monument, Roost Uplink (MVP), Field Trip.

## 2. Finding → fix → file

E = progression-and-economy.md, G = GDD.md, S = scope-tiers.md, N = naming-bible.md, P = mechanics-parity-matrix.md.

| # | Finding | Fix | Files |
| --- | --- | --- | --- |
| **B1** | Solo late game is idle play again | (1) **Effort-weighted On-Shift Bonus**: robots ×1.0 only while someone is actually cleaning; **Unattended ×0.5** otherwise; room sleeps 30 min after the last Effort. The sim baseline (active solo) stays ×1.0, so no v1 robot number moved. (2) **Work Front** (R1) + **Flock Formations** (R4): the flock works where you are or where you tag (pacing-neutral). (3) **Refit I–III** (R3–R5) late personal track: player area 35 → 62 m²/s. (4) **Review Briefs** need hands-on tasks (Steep plots by hand, Core Samples, Beacon Run). (5) New target rows: player-attributable share ≥20% (min 52%), and own-tool share as an honest watch metric (4.4% at 31 h). Removed the false "Bulk Rate is the player's lever" claim | E §2, §8.2, §9.1, §9.3, §13, §17, §18.1; G §4; P §6, §10 |
| **B2** | On-Shift Bonus farmable with alts/tabs | Distinct accounts only; Effort = own dust removed in 300 s vs 40% of own loadout rate; input in 30 s and ≥10 m move in 60 s; extra tabs count 0; Tenure ≥3; **≤1.0 total per IP subnet** (/24, /56); capped at 16; exploit-hunt cases (alts < ×1.1, subnet adds 0, Polished-ground driving = 0) | E §9.3, §21 `on-shift-bonus.json`, §22.7; G §7.2 |
| **B3** | Docket rewards multiply per player and compound | **One Docket per shift**; every 1,800 s of shift-active time (no Clock-In reroll), max 8/day, starts after Probation; 0.5 income-minute per goal + 1 for all three, from a **fixed Shine-keyed stage table** (no feedback); Commendation to contributors, max 3/day; modelled in the efficient policy (+3.3%) | E §16.1, §21, §22.4, §22.7; G §8 |
| **B4** | Dust under buildings undefined | **Settle**: footprint dust is cleared at the builder's own best hand-tool rate (hold to place) and paid at Bulk Rate, credited to the builder; Reclaim never restores dust; refunds = price paid. No soft-lock, never better than sweeping | E §2, §12, §22.7; G §5, §9; P §8 |
| **B5** | Sim spec can't reproduce §18 | §22 rewritten: clock/sun, Apron/outpost/Moon phases, distance-based walking, all modifiers (incl. capstone vehicle effects, Refit, night relief), robot uptime (manual vs Auto-Relocate), permits as caps, throughput per sell point, provenance routing, bundled costs (Nest, power, rails), Docket, collectibles, Briefs, exact greedy score + tie-breaks, non-rate items, `mvp` policy. Acceptance = implement spec → serialise §17/§18 to `golden/v2-targets.csv` → publish diff → designer reconciles in the same PR. Pacing table re-verified (Appendix B, §18.3 integration reproduces v1 exactly as a check) | E §17, §18, §22, App. A–B |
| M1 | First Stamp at 20–35 min; Shine 0 | **Landing Apron** (6 thin-dust plots per outpost): first Stamp **5.9 min**; Shine to 4 decimals + live albedo readout; honest "Something stamped" claim; Induction re-timed (10–15 min) | E §1, §18; G §6, §8, §14; S §1; P §1 |
| M2 | Onboarding payouts left out of early targets | Induction pays XP only; Near Parcels 30 LM (32 of them), big Parcels far away; efficient ≤1 h policy includes Near Parcels; outpost-mix density used in all early math | E §15, §18.2, §22.4; G §14 |
| M3 | Review 1 unlocks useless; parity order changed | Ion Curtain and capstones **ungated** (parity); only Golden Handshake stays R2-gated (★, documented). Master Stroke, Second Wind, Smooth Handoff also help vehicles. R1 now = Behemoth, Tile Sinterer, Keen Beak II, Tailwind I, Work Front | E §4, §6, §13; P §2, §3 |
| M4 | Static Rake has no job; Charge does nothing | Rake **1,100 LM** (a real step before vehicles; efficient buys it at 1.6 h); **Charge** = no Steep slowdown + ×1.5 Stamp on Rake-finished plots; Steep slowdown defined (×0.6) | E §1, §4; P §2 |
| M5 | Puck throughput is a hidden wall | **Puck Stacks** (≤20 kg rail unit) from Roosts, Puck Former and Dust Vault → 144 t/h per rail; Gates take 3 rails + Bale Chute; **Rail Run** drag tool; sim checks per-sell-point capacity (never binds solo) | E §5, §9.1, §10, §22.4; G §5, §9; P §7 |
| M6 | Roost relocation chore | Free one-click **Re-site** (Roost panel / Survey Globe / DOT prompt) with rail auto-extension; **Auto-Relocate** is a 15,000 LM Start item; uptime 0.64 manual vs 0.70 auto, modelled | E §9.1, §9.4, §22.3; P §6 |
| M7 | Cliff moved, not removed | Each Review has a qualitative unlock (Work Front, Carryall Convoy, Refit + Core Samples, Flock Formations, Refit III, Homing II…); Reviews pay free issues + Commendations, **no cash**; Refit as mid-price sinks; targets P50 gap ≤45 min, max ≤90 min; Next Requisition partial-progress pings | E §8.2, §13, §18.4, §20; G §8 |
| M8 | Unattended policy contradictory | One policy for every room type: On Break 10 min; Temp removal 30 min; **room closes 30 min after the last Effort**; Unattended ×0.5; targets = contract-active hours; timers in `moderation.json` | E §9.3, §21; G §7.5, §8 |
| M9 | Review/Fulfilled rewards snipable | Paid to every member or Temp with ≥10 credited plots or ≥30 active min since the previous Review, online or not | E §13; G §12, §15; P §11 |
| M10 | Open Shift holes, Petty Cash stacking | Open Shift stops admitting Temps without a Holder/Supervisor online 10 min; Temp vote-kick (3 votes, Tenure ≥5); 15 m no-build zones; Temps build Logistics/Structures only; **Brightside Service Call** before Albatross; **Loaner Kit** replaces Petty Cash | E §12, App. A; G §7.4, §7.5; N A4 |
| M11 | Trick farming | Driver only; 250 LM/driver and 500 LM/shift per 10 min (<5% of stage income from the Skiff on); exploit case | E §2, §22.7 |
| M12 | Refund basis and provenance | Refund = price that instance paid (free = 0; Grades/Refits with their parent; escalating prices indexed on count owned); `full`/`bale` provenance, Bales accepted only by Gates, Kilns, Sinterers | E §2, §10 |
| M13 | Loose pucks uncapped | Overflow Former makes one Puck Stack; hold F to stack; caps 20/player, 200/contract; merge on touch; 10-min auto-collect at 50% | E §5; S §1; P §7 |
| M14 | MVP not the smallest slice; skips robots | **Added Roost + Sandpiper** (≤3, Pilot Review activates, Roost Uplink, Re-site, Effort/Unattended/anti-farm); **cut** Survey Globe, Flare Beacons, Skiff, all vehicle upgrade lines, Holster L2–3, Lamp L2, 7 achievements; `mvp` sim policy with walking distance; MVP targets: Stamp 5.9 min, Trundle 1.1 h, Pilot Review → Roost 1.8 h | S §1, §5; E §22.5; P §4–§6 |
| M15 | Upgrade/gear/vehicle/building names too close | All 11 rows renamed (§1 map) | N §4–§9, A5, A8; all files |
| M16 | Robot states and achievements copy the reference | 9 bird-vocabulary states; 13 achievements renamed incl. placeholders; naming-bible rule 3 adds the CI fuzzy-match check | N §8, §10, rules, A8 |
| M17 | Title and premise close to banned (owner decision) | Title kept, risk recorded in G §1 for Cee; Brightside prominent in key art/capsule; premise now "Brightside won the tender on a confident slide deck"; Desk Duster is a ceremonial pitch prop (not a cheap freebie); never show an employment-agreement screen | G §1–§3, §14; N §1, §4 |
| M18 | Data format can't express the design | `op: "flag"` + `features.json`; `traits.json`; `moderation.json`; `metric` enum (`time`/`gapMax`/`gapMedian`/`share`) with `attendanceFrac`, `policy`; Refit block; Docket table and goal types; Appendix A "constants in prose" (Steep ×0.6, vehicle slope rule, Running Lamps relief, Spot Check 300 m, Work Front, timers, Clean-up rules, Loaner Kit) | E §21, App. A |
| M19 | Co-op assumes full attendance; wallet overflow | `co-op-uneven` policy + target (4p at 50%: 17–21 h, est. 18.5 h); permit-free sink **Brightside Monument** (cosmetic, headcount-scaled) plus every member's Refits | E §18.1, §19, §22.5; G §7.2 |
| m1 | Arithmetic slips | 6.30× (Behemoth 756k, Trundle 11,340); 10:00 row = 7 Albatross; 765 LM/h; ≈58 s fill; plus two more found: Dump Plate double-counted in the Trundle step (2,800), §18.3 mixed raw/0.85 rates | E §8.1, §17, §18.3, App. B errata |
| m2 | Standard Issue vs Repeat Requisition | "Free for every member, present or future, once anyone owns one" (T1–T3); per-tier cost formula | E §2, §19.4; G §7.1 |
| m3 | Crowding optimistic | 4 pour slots per Assay Counter; c = 0.05 until a Puck Former, then 0.02; 8p/16p first-hour rows adjusted | E §10, §18.1, §19.1 |
| m4 | Twilight Strips 24/7 solar | Solar ∝ sin(sun elevation) (fixed: 2/π ≈ 64% avg; Heliostat saturates at 20° ≈ 90%); Strips ≈3% / ≈10% of peak | E §11; G §6 |
| m5 | Tenure estimate | "Dust delivered" = player-cleaned kg only; rates 1 XP/plot, 1 XP/250 kg; re-derived ≈32,000 XP → **Tenure ≈38** | E §16; G §12 |
| m6 | Overloaded words | Shift (build mode) → Reposition; Rails & Railings → Handrails; Survey (MVP) → Pilot; Certifications Railhand/Driver/Finisher; Bulk Buyer → Rebate; naming-bible rule 5 | N rules, A8 |
| m7 | Semantic one-to-one clones | 6 different finishes; new panel set; Rock Garden / Postcard Rack / Hold Music; Plot Card on C; Cadence, Loft, Stamp Premium, Crescent Squeegee; naming-bible rule 4 | N §9, A3, A8; G §6 |
| m8 | Parity-matrix gaps | Rows added: capsule slots/loading, one vehicle per garage + relocation, home-direction indicator, locker/avatar editor, lore delivery, tray sell vs hold-to-pour, robot switch-off, global robots skipping unreachable hexes (+ first completion, late vehicle progression, Work Front, provenance, absent-member rewards, idle late game); 3-level-roots tier corrected to MVP | P all sections |
| m9 | Onboarding order and travel | Induction reordered to match the sim (Apron Stamp → Squeegee → Cell → Near Parcel); "reach Dawnside" moved out of Probation into a post-Skiff **Field Trip** with 3 Crates on the route | G §14; E §15 |
| m10 | Comfort rule and cadence | Crown Lamp, Lowlight Visor and Running Lamps are income items in the greedy score; late target P50 ≤45 min with partial-progress feedback | E §18.4, §22.5 |

### Pacing after the fixes (solo, efficient; E §18.1)

First Stamp 5.9 min · Squeegee 5.9 min · Cell 8.5 min · Assembly Gun 42 min · Trundle 1.49 h · Roost 2.0 h · Kiln 3.5 h · Albatross 5.9 h · Review 1 6.2 h · all personal 10.4 h · Fulfilled **31.1 h**. Co-op: 2p 19.8 · 4p 15.1 · 8p 11.7 · 16p 9.0 h. All targets met; Roost, Kiln and Albatross sit at upper edges (levers in E §23).

**How the numbers were verified.** Early rows (≤2 h) and MVP rows were re-derived from the spec's formulas by hand, cross-checked with a throwaway calculation in my scratchpad (not in the repo). Rows from 3 h keep the v1 prototype's robot columns; player-area changes (Master Stroke on vehicles, Refits) and timing shifts (Docket +3.3%, removed Review cash) were applied explicitly. The §18.3 trapezoid integration reproduces v1's own milestones exactly from v1's rows, which supports using it for v2. These remain **design targets until `tools/balance-sim` confirms them** (new acceptance rule, E §22). Biggest uncertainty: purchase-gap P50/max (estimated, not computed).

## 3. Cross-file items (owned by other agents; not edited by me)

| # | File / owner | Needed change |
| --- | --- | --- |
| X1 | `docs/architecture/netcode.md` (AFK row ≈line 297), `environments.md` (≈line 84) | One AFK policy for **all** room types: `afk`/On Break after 10 min without input; Temp removal after 30 min On Break (Open Shifts); room close 4107 when **nobody has had Effort > 0 for 30 min** (not "30 min without input") |
| X2 | `netcode.md`, `security.md`, `data-model.md` | On-Shift anti-farm needs server data: one counted session per account, account Tenure, and an **IP-subnet grouping key** (/24, /56; store only a salted hash) per session; Effort from server-side dust-removal counts. Privacy review of the subnet hash |
| X3 | `world-and-dust-simulation.md` | Bake: outpost compound (centre + ring 1) empty; **Landing Apron** (6 ring-2 plots, 20% coverage at level 2). **Settle** rule (footprint cleared at the builder's tool rate, Bulk-Rate pay, Reclaim never restores dust). Polished is latched. Plot Scan (G) → **Plot Card (C)** (≈line 555). Loose-puck caps 20/200, merge, 10-min auto-collect. Shine shown to 4 decimals |
| X4 | `security.md` | Server validation for: Temp permissions (no wallet spend, Loaner Kit, Logistics/Structures only, 10 m from others' Services), 15 m no-build zones, trick caps (driver only, per-driver/per-shift), provenance (Bales can't enter Cells/Formers/Vaults), refund = paid price, Docket issue clock, reward eligibility. Rename Sinter Press |
| X5 | `rendering-pipeline.md` | Finishes are now 6 (Brushed, Regolith Cast, Anodised, Enamel, Patina, Chrome): BatchedMesh-per-finish count 5 → 6 (≈line 327), "Glow/Brushed" (≈213), "Mesh finish" opacity texture (≈277), Tread normal stamp (≈452) if it refers to the finish. Plot Scan label → Plot Card. Puck Stacks need a mesh variant |
| X6 | `data-model.md` | Per-entity `paidPriceLm`; provenance on Dust Vault/Nest/rail contents; per-member credited plots and active seconds since the last Review; shift-level Docket state (issue clock, daily count); Brief progress; Refit levels per vehicle |
| X7 | `docs/design/art-direction.md` | All renames (Whisk Brush, Anchor Boots, Hopper Bin, Sinter Press, Plot Scan, finishes, panels, Handrails, Lamp Pylon, Dust Vault); robot-state colour table → 9 new states; Desk Duster becomes a small **ceremonial** brass-and-wood pitch prop (still tiny); Break Room props (Rock Garden, Postcard Rack); Puck Stack and Shine display panel assets; Brightside mark prominent in key art/capsule (M17) |
| X8 | `docs/design/audio-direction.md` | Renames; robot-state cues → 9 states; Plot Card key C; Brightside FM → **Hold Music** at the DOT terminal; Sandpiper cues move into MVP |
| X9 | `docs/design/visual-target.md` | VT-M1-20 tool list (Crescent Squeegee); Plot Scan → Plot Card; Sinter Press → Tile Sinterer; S16 finish samples (6); MVP scene list gains a Roost/Sandpiper shot; Survey Globe/Flare Beacon shots move to M2 |
| X10 | `docs/milestones/M1-mvp.md`, `M2-v1-parity.md`, `M3-polish-launch.md`, `docs/ROADMAP.md`, `docs/STATUS.md` | M1: anchor `#1-mvp-v020--boreal-pilot-area`; MVP **adds** Roost + Sandpiper (robot sim/sync exit criteria, On-Shift anti-farm) and **drops** Survey Globe, Flare Beacons, Skiff, vehicle upgrade lines, Holster L2–3, Lamp L2, 7 achievements. M2: new systems (Refit, Work Front, Flock Formations, Carryall Convoy, Review Briefs, Core Samples, Loaner Kit, Settle, Puck Stacks, Rail Run, Monument, shift-level Docket, Auto-Relocate item). M3: Rock Garden, Postcard Rack, Hold Music |
| X11 | `packages/shared` schemas (contracts-architect, when built) | Effects `op: "flag"` + `features.json`; new `traits.json`, `moderation.json`; `pacing-targets.json` fields `attendanceFrac`, `policy`, `metric` enum; Refit block; expanded `on-shift-bonus.json`, `shift-docket.json`, `logistics.json` (E §21) |
| X12 | `.claude` skills/agents (`update-docs`, `balance-check`, docs-keeper, devops) | Add the retired names (§1) to the banned-name consistency greps; implement the CI **fuzzy close-variant check** (naming-bible rule 3); `balance-check` compares against `tools/balance-sim/golden/v2-targets.csv` and the new acceptance rule |
| X13 | `docs/architecture/performance-budgets.md` | MVP now runs server-side robots (≤3 Roosts per contract); v1.0 adds ≤200 loose pucks per contract and Puck Stacks as rail units |
| X14 | Cee (owner) + lead | **New title "Moon Cleanup" fails the naming bible's close-variant test** (rule 3) against the banned titles **"Moon Cleaners"** (one word-form away) and **"Clean the Moon"** / "Clean THE Moon" (same two content words), all in `roblox-references.md` §9; it is closer than "Moon Custodians" was. It's the owner's call, but the lead should state this plainly to Cee and record the decision as a designer note in naming-bible §1 so the CI fuzzy check has an allow-listed exception. When applying the rename, also rewrite GDD §1 (title table and the M17 risk paragraph, which currently argue for "Moon Custodians") and the premise line "Moon Custodians" in naming-bible §1. The M17 mitigations (Brightside prominent in key art/capsule, no cheap-employer beat, no agreement screen) matter even more with this title. Also flag the subnet anti-farm cost to households (E §23) and the meta layer's employment-satire vocabulary (Probation, Golden Handshake, Benefits), which the reviewer noted but did not require changing |
