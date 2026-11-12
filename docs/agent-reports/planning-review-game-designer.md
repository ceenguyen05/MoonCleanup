# Planning review: game design (independent)

Reviewer: independent senior game designer (did not write the reviewed docs)
Date: 2026-11-12
Scope: `docs/design/GDD.md`, `progression-and-economy.md` (cited as **E§**), `scope-tiers.md`, `naming-bible.md`, `docs/research/mechanics-parity-matrix.md`, checked against `moon-sweepers-mechanics.md` (§3, §7, §8), `moon-sweepers-reception.md` (C1–C16), `roblox-references.md` (summary, §9).

## Verdict

**Not ready to build from yet. Approve once the 5 BLOCKERs are fixed.** The structural parity is excellent. Tier counts, node shapes, unlock order and the 5-layer arc all match the reference, and nearly every table total I re-added is correct (spot checks below). The docs are unusually implementable. Four problems remain:

1. The headline fix, "automation multiplies active play", does not hold for a solo player. From about 16 h onward, the solo player's own effort is under 10% of output. This is the reference's "idle waiting simulator" again, just later.
2. The On-Shift Bonus and the Shift Docket can be farmed.
3. The balance-sim spec cannot reproduce §18. It leaves out the constraints that actually bind mid-game: rail and Gate throughput, permits, and Roost relocation.
4. Rules are missing for how building interacts with dust.

Many names are also close variants of names on the do-not-use lists.

### Arithmetic I re-checked

| Check | Result |
| --- | --- |
| Board 583,860; suit 121,150; all personal 718,235; Cells 75,160 | ✓ exact |
| Tool area rates (E§4), vehicle area rates and step ratios ×3.0/×1.9/×1.4 (E§8) | ✓ |
| Roost #8/#16/#24 prices; Albatross #4/#8/#24 prices; Σ24 Albatross 57.9M; Flight Plan 79.1M | ✓ |
| On-Shift Bonus table (×1.60 / ×2.04 / ×2.59 / ×3.32) | ✓ |
| Cumulative area to 6:00 ≈ 432k m² (trapezoid of §17) | ✓ (I get ≈443k raw, ≈432k after the 0.85 factor) |
| Wide Mouth net ×1.10 / ×1.19 / ×1.25; Behemoth max ≈33 m²/s | ✓ |
| Vehicle max-out multiple "6.35×" | ✗ The lines sum to **6.30×**, so the Behemoth max is 756k, not 762k |
| §17 "8 Albatross" at 10:00 = 90.1 m²/s | ✗ 90.1 = **7** × 11 × 1.3 × 0.9. Eight would be 103 |
| §18.2 "≈735 LM/h with night" | ✗ 900 × (0.5 + 0.5 × 0.7) = **765** |

---

## BLOCKER

### B1. Solo late game is idle play again. The ★ "automation multiplies play" claim fails for solo
**Where:** GDD §4 ★; E§2 Bulk Rate; E§9.3; E§11; E§17; E§20.

**Problem.**
- From E§17, the player's area rate stays at 32.3 m²/s from 10 h to 31 h. As a share of total area, the player is 16% at 10 h, 8% at 16 h and **2.7% at 31 h**. As a share of income, the player is about 0.33M of 9.87M LM/h (**≈3%**).
- The On-Shift Bonus is ×1.00 for a solo player whether they are active or AFK.
- The Bulk Rate does not create play either. At 31 h, Albatross produce ≈1,480 t/h of Bales. The 14-machine Plant Permit ceiling processes only ≈68 t/h (≈6 Kilns + 8 Presses at Grade III), so about **95% of Bales sell at 25%** no matter what the player does. The Bulk Rate works as a flat tax on robots, not as a lever the player controls.
- Over the last ~15 h solo, the player has no stat to improve personally. All personal upgrades are done at 10.5 h, and every vehicle is maxed soon after.

**Fix.**
1. Give a solo player an *activity-dependent* robot multiplier, for example On-Shift Bonus = 1 + 0.5·[≥1 active] + 0.6·√(A−1), with unattended rooms at ×1.0.
2. Better, tie robots to player action spatially. Albatross flock to an active Custodian, so plots within ~150 m of one clean ×1.5. Or plots a player has **Opened** or marked with a Flare Beacon get priority and ×2 rate.
3. Add a late personal track, for example vehicle Grades at Reviews 3–5 or a hand-finish Stamp multiplier that scales with Review number.
4. Add a `pacing-targets.json` row: **player-attributable share of Shine progress ≥20% at every stage, solo**.

### B2. On-Shift Bonus can be farmed with alt tabs or guest accounts
**Where:** E§9.3; GDD §7.2; E§22 exploit hunts; guest auth (scope §1).

**Problem.**
- "Active" means swept, drove, built or poured in the last 300 s. Guest auth is free and unlimited.
- A solo player opens 15 guest tabs into their Private Shift and taps sweep every 4 minutes. Robots then run ×3.32.
- Robots are 90–97% of late output (B1), so this alone should cut solo Fulfilment from 31.5 h to roughly 12–14 h. A single second tab gives ×1.6.
- The exploit hunt tests only the 300 s window, which this method passes.

**Fix.**
- Weight each player's contribution by their own work in the window: A_eff = Σ min(1, playerCleanedArea₃₀₀ₛ / stageThreshold), where the threshold is about 50% of the stage's expected player rate.
- Cap the count at one per device/IP, and require Tenure ≥ 3 for a player to count.
- Add an exploit-hunt case: "N idle-tapping alts must add < ×1.1".

### B3. Shift Docket rewards multiply per player and feed back into their own base
**Where:** GDD §8.1; E§16 (Docket row); E§22.

**Problem.**
1. Each player gets 3 goals, and each pays **4 min of the *shift's* income**. In a 16-player shift that is 16 × 3 × 4 = 192 min of income per ~20-min session. At 4 players early it roughly doubles income.
2. "Trailing 30-min income" includes Docket payouts and Review bonuses. Payouts therefore inflate the next Docket. A Review 6 bonus of 1.5M lands inside the window and makes every Docket after it hit the 250k cap.
3. The doc never says when a new Docket is issued. If it is per Clock In, then Clock Out/In rerolls it, which also farms the 1 Commendation per Docket. That is the largest Commendation source in a contract (~90).
4. The sim does not model Dockets at all. At 3 goals × 4 min per 20 min, they are worth **up to +60% income**, so §18 is wrong for anyone who plays the Docket.

**Fix.**
- Reward = 4 min × (the sim's *stage base income* ÷ active players). Exclude bonuses, Dockets and Stamps from the base.
- Issue Dockets per 20 min of active time, at most 6 per player per real day.
- Model Dockets in the "efficient" policy, or cut the reward to 1–1.5 income-minutes.

### B4. Dust under buildings is undefined: either a soft-lock or a free cleaning tool
**Where:** E§12 ("Building is allowed on dust (flattened locally)"); GDD §6 and §15 (Fulfilled = every plot Polished).

**Problem.**
- If dust under a Deck Plate stays in the ledger, that plot can never reach Polished, so the contract can never be Fulfilled. One Temp's foundation is enough.
- If "flattened" removes the dust, then Place and Reclaim (100% refund) on a large hex plate is a free, instant area cleaner, and pays Stamps if Stamps apply.
- Either way, nothing in data or rules says which.

**Fix.**
- Rule: a build footprint's dust is moved into the builder's Cell (or a puck at their feet). It is paid normally and is limited by Cell capacity. Placement is refused on texels that would overflow the Cell.
- Polished is computed excluding covered texels. Reclaim does not restore dust.
- Add this to `world-and-dust-simulation.md` and to the exploit hunts.

### B5. The balance-sim spec cannot reproduce §18 to ±5% as written
**Where:** E§22 (acceptance), E§18, E§17.

**Problem.**
1. The acceptance target is a prototype that "is not in the repo", and the greedy policy is under-specified: no tie-breaks, no Δincome definition for items without a rate effect, and no bundling order.
2. The model **leaves out constraints that bind**:
   - Rail and Gate throughput (2 units/s; 4 Receiving Gates at Boreal; see M5).
   - Permits as purchase caps.
   - Nest, power (1,050 LM/kW), rail and Relay costs.
   - Roost patch exhaustion and relocation time.
   - Induction rewards, nearby Parcels and Dockets (B3, M2).
   - Distance-dependent walking trips (a fixed 40 s).
3. Crown Lamp is treated as "comfort, no income effect", yet the night penalty (E§3) makes it an income item.
4. The robot rate ignores terrain depth, while the player rate uses passes.
5. Internal inconsistencies:
   - The worked math uses Moon-mean density (0.424) while the spec says to use the outpost mix (≈0.335 kg/m²) for the first hour.
   - The 7-vs-8 Albatross slip.
   - The co-op values in E§18.1 are flat 4 min for 4–16 players, but Standard Issue implies ≈0.5 min at 16 players for a 75-LM shared purchase.

**Fix.**
- Commit the prototype, or its `curves.csv`, as a golden file.
- Change acceptance to "implements the spec; diffs against §18 published; designer reconciles §18 to the sim within one PR".
- Add the missing constraints to the model (throughput per sell point, permits, relocation downtime per patch, Docket and Induction income).
- Specify the greedy score exactly, including tie-breaks.

---

## MAJOR

### M1. The early hook is slow. The first Inspector's Stamp lands at about 20–35 minutes, and Shine reads 0 until then
**Where:** GDD §8.3, GDD §14 (Induction "≈20 min"), E§4, E§1.

**Problem.**
- Polishing one 306.8 m² plot means sweeping it pure for ~21 min with the Desk Duster. With trips and the tool upgrades along the way, a focused player stamps the first plot at about 22 min, and a typical player at about 30+ min. The reference's first sector comes at about 5–15 min (M§7).
- The Induction's step 6 alone is longer than the whole stated 20-minute checklist.
- Shine counts only Polished plots, so it shows **0.000%** for the entire first session. That loses the "0.003%" meme moment (R§3).
- GDD §8.3 claims "10+ plots per 20-min session at every stage". In fact it is about 1 plot at 0:30, about 3 at 1:00 and about 10 only from about 2 h.

**Fix.**
- Ring Outpost Boreal with ~12 **thin-dust apron plots** (dust level 1–2, so one Desk Duster pass) to put the first Stamp at about 3–5 minutes.
- Show a live secondary readout from the first stroke: "dust removed: 0.0000213%" (the albedo readout).
- Change the §8 claim to "a Stamp every ≤5 min from minute 5".
- Re-time the Induction.

### M2. Early pacing targets leave out the onboarding's own payouts
**Where:** E§18.2, E§15, GDD §14 (step 8, 6 Parcels within 300 m).

**Problem.**
- Six Parcels within 300 m of Boreal pay **900 LM**, which is 12 Whisk Brushes and two-thirds of the 1,365 LM needed for the Assembly Gun.
- Induction steps pay 10–40 LM each.
- About 22 Parcels lie within 600 m of Boreal (≈3,300 LM, about one hour of early income).
- A player who follows the checklist will beat the "6 min / 10 min / 44 min" targets by roughly 2×. Meanwhile the sim's "efficient" policy excludes all of this. The density issue in B5 also overstates the worked income per m² by about 24% (1.84 vs 2.28 LM/m² in the outpost mix).

**Fix.**
- Cut the near-Boreal Parcels to 25–40 LM, and keep the large values far away.
- Make "efficient + Induction + near Parcels" the policy for the ≤1 h targets.

### M3. The Review 1 unlocks are useless when they arrive, and they change the parity unlock order without sign-off
**Where:** E§13 (Review 1), E§4 (Ion Curtain gate), E§6 (capstones), matrix §2 and §3.

**Problem.**
- At 6.3 h solo the player drives a Bulldust (15.3 m²/s) and owns 16 Plovers. Review 1 then hands over the Ion Curtain (2.42 m²/s, 6× slower than the vehicle), Auto-Puck, Express Lane (pour time), Second Wind (walk speed) and Master Stroke (hand width). All of these improve *hand play*, which the player has already left behind.
- That spreads unlocks on the calendar without adding any content, and it brings back C2 ("useless tiers").
- It also moves the reference's first-hour tool layer and hours 1–3 capstones (M§3j) to after the first global robot. The owner asked for parity of unlock order, so this needs explicit approval.

**Fix.**
- Ungate the Ion Curtain and the capstones (parity: buy them at hours 1–3).
- Spend Review 1 on things that matter at 6 h instead: Behemoth, Sinter Press, Keen Beak II and permits.
- Alternatively, make each capstone also apply to vehicles (Master Stroke: +10% vehicle width; Express Lane: −50% Fast Tip trip; Second Wind: +1 Afterburner charge).

### M4. The Static Rake (T5) has no job, and its trait does nothing
**Where:** E§4, E§8.

**Problem.**
- For 2,600 LM the Static Rake cleans 1.65 m²/s with a 55 kg Cell. For 3,000 LM, the Trundle plus Motor Pool cleans 2.65 m²/s (≈3.5 near outposts) with a 200 kg hopper.
- The sim's opening skips the Static Rake, and so will players. That is C2 again.
- **Charge** ("one pass clears any terrain") changes nothing, because base Depth 13 already one-passes the deepest class (Crater Floor = 13).

**Fix.**
- Price the Rake at about 1,100 LM and place it before the Trundle.
- Give Charge a real effect, for example "+50% sweep-walk speed on Steep" or "Stamps on plots you finish with the Rake pay ×1.5".
- Alternatively, raise Crater Floor to dust level 14–15 so that Depth 13 + Charge differs from Depth 13 alone.

### M5. Mid-game puck throughput is a hidden wall
**Where:** E§10 (rail = 2 units/s = 7.2 t/h), E§9.1 (Roost → rail), GDD §6 (4 Receiving Gates per outpost).

**Problem.**
- At 5:00 solo, the Roosts produce about 48 t/h (31.5 m²/s × 0.424 kg/m²) and the Bulldust about 30 t/h.
- Boreal's 4 Gates take about 28.8 t/h if each accepts one rail, and 3 Kilns take 5.4 t/h.
- The Field Gate arrives only at Review 2 (10.4 h). Wiring to another outpost means about 775 hand-placed 4-m rail pieces.
- So roughly half of the full-rate dust cannot be sold between about 4 h and 10 h. Neither the sim nor the docs show this.

**Fix.**
- Have Roost stores output 20-kg Bales at full rate (or add a Puck Stacker that packs 20 pucks into one rail unit).
- Specify Gate inputs (for example 3 rails each).
- Add a click-drag rail tool.
- Model sell-point capacity in the sim (B5).

### M6. Relocating Roosts is the mid-game's main chore
**Where:** E§9.1 (patch ≈42–55 min), E§9.4 (Auto-Relocate at Review 2 for 1.5M), E§23.

**Problem.**
- From the first Roost at 2 h until Wide Wing I at 10.4 h, the solo player must re-site up to 16 Roosts roughly every hour, each with a new rail run. That is about 80–100 relocations.
- The 0.70 uptime assumes this happens instantly.
- The docs already flag this risk but leave the fix gated.

**Fix.**
- Add a one-action "Pack Roost → place" from the Survey Globe with rail auto-extension, at no charge.
- Move Auto-Relocate (300 m) to Review 1, or make it a cheap Start item (≈50k), and keep L2 (600 m) at Review 4.
- Model relocation downtime in the sim.

### M7. The "pacing-cliff fix" moves the cliff instead of removing it
**Where:** E§18.4, E§20, E§13 (bonuses).

**Problem.**
- From 10.5 h to 31.5 h (two-thirds of a solo contract), nearly every purchase is "Albatross #n" or a Flight Plan level. That is "buy more robots" plus "buy better robots".
- From Review 5 to the end (24.4 h → 31.5 h) there are about 4 items in 7 h.
- Review cash bonuses are trivial: Review 1's 25k is about 2 min of income, and Review 6's 1.5M about 10 min.
- A gap of "≤2 h" for Flight Plan levels means about 5 consecutive 25-minute sessions with nothing to buy, which contradicts GDD §8.2 "Something to buy" every session.

**Fix.**
- Add a qualitative unlock per Review that changes *how* you play, for example new Steep-only collectibles, Carryall convoy routes, a new terrain class or a robot behaviour you direct.
- Pay Reviews in permits and unlocks plus Commendations, not cash.
- Set a target of a solo purchase gap ≤60 min at P50.
- Add mid-price sinks between Flight Plan levels, such as Nest upgrades or rail Grades.

### M8. Unattended progress policy is unclear and the docs contradict each other
**Where:** GDD §7.5 (removal after 30 min in Open shifts only), GDD §8, E§9.1; netcode §10 (closes **any** room after 30 min without input).

**Problem.**
- Late game is 90%+ robots and robots run whenever the room is open, so a tab kept alive with one input every 29 min equals active play for solo pacing.
- The GDD and netcode disagree on which rooms time out.
- The "clocked-in hours" targets do not say whether AFK hours count.

**Fix.**
- Pick one policy and write it into both docs. My suggestion: when no player is active in a 300 s window, robots run at ×0.5 ("skeleton crew").
- Put the AFK timers in data.

### M9. Review and Fulfilled rewards can be sniped, and absent members miss them
**Where:** GDD §12 (Reviews pay 2–8 Commendations), GDD §15 (Fulfilled rewards "everyone present"), GDD §7.4 (Shift Board shows Shine %).

**Problem.**
- The Shift Board advertises Open Shifts at 74.9% or 99.9% Shine.
- A Temp joins for 28 Commendations and the Fulfilled achievement while contributing nothing.
- Conversely, friends who were offline at the threshold lose their reward, which pushes them to keep tabs open (M8).

**Fix.**
- Pay Review and Fulfilled rewards to every member with ≥X credited plots or ≥30 active minutes since the previous Review, whether or not they are online at the moment it fires.
- Temps need a participation threshold too.

### M10. Open Shift moderation holes and Petty Cash stacking
**Where:** GDD §7.5.

**Problem.**
1. If the Holder and Supervisors are offline, an Open Shift contains only Temps. They cannot vote-kick, cannot Reclaim each other's builds, and have no Clean-up Order.
2. Temps can place Panels or Deck Plates that wall in Assay Counters, Relay Pads or Gates. Vehicles ghost through players but not through buildings.
3. Before any Albatross exists (about the first 6 h), offensive dust graffiti has no remedy except hand cleaning.
4. Petty Cash is per Temp: 15 Temps × 2% per 10 min can drain about 26% of the wallet in 10 min.
5. Temps can never afford late vehicles, because Petty Cash is ≤25k and a Behemoth repeat costs 48k. Late-game Temps play a weak role.
6. It is ambiguous whether a Temp can place shared Services pieces (Roost, Nest, Field Gate), which cost wallet money.

**Fix.**
- Open Shifts stop admitting Temps when no Holder or Supervisor has been online for 10 min. Allow Temp vote-kick with 3+ votes and Tenure ≥5.
- No-build zones of 15 m around outpost services.
- Before Albatross exist, a Clean-up Order dispatches a scripted Brightside service sweep (60 s, unpaid).
- Replace Petty Cash with **Loaner Kit** tools and vehicles at the shift's current tier: free, non-upgradable, returned on leave.
- Temps may place Logistics and Structures only.

### M11. Trick payouts can be farmed in early co-op
**Where:** E§2 (1,000 LM per player per 10 min).

**Problem.**
- The cap is 6,000 LM/h per player. With 4–16 players that is 24k–96k LM/h, comparable to or above the whole shift's cleaning income in hours 1–3.
- Ramps are free because Reclaim refunds 100%.
- The docs do not say whether Carryall passengers each earn trick payouts, which would be ×8.

**Fix.**
- Cap tricks at ≤5% of the stage base income per player, or pay cosmetic points only (as Beacon Run already does).
- Pay the driver only.
- Add a trick-farm case to the exploit hunts.

### M12. Rules are missing for refund basis and dust provenance
**Where:** E§12 (Reclaim 100%), E§9.1 (escalating Roost and Albatross prices; free Roosts from Review 1 and Fleet Voucher), E§11 (Grades), E§2 (Bulk Rate).

**Problem.**
- What does a refund pay back? Reclaiming a *free* Roost could pay the current marginal price (up to 112k).
- Does Reclaiming a Grade III machine refund its Grades? The Grade costs total 260k.
- Can a Bale be poured into a Puck Former or a Cell and so become full-rate pucks? The exploit hunt names the risk but no rule prevents it.

**Fix.**
- Refund = the price actually paid by that instance, recorded per entity (free = 0). Grades refund with the machine.
- Dust carries a provenance tag (`bale` or `full`) through Cells, pucks and Hopper Bins. Alternatively, Bales are accepted only by Gates, Kilns and Presses.

### M13. Loose Dust Pucks have no entity cap, and Auto-Puck behaviour is unclear
**Where:** E§5 ("F forms a 1-kg Dust Puck"), E§6 (Auto-Puck), scope §1 ("Pucks sync for 16 players").

**Problem.**
- With a 616 kg Ion Curtain Cell, "a full Cell forms a puck at your feet" means one 1-kg puck about every second, leaving a trail of hundreds of networked entities per player.
- Any player can press F repeatedly to spam pucks, which is both griefing and a performance problem. The reference needed a 90k world cap (M§3d).

**Fix.**
- Auto-Puck forms one **puck stack** containing the whole Cell.
- Loose pucks have a cap (for example 200 per contract, 20 per player). Pucks merge when they touch, and despawn into the nearest Gate's ledger after 10 min, paid at 50%.

### M14. MVP is not the smallest slice and skips the riskiest system
**Where:** scope-tiers §1.

**Problem.**
- MVP must "prove the risky things", but it leaves out robots. Server-side robot simulation on a 0.1-CPU server is the top performance risk (C4), and robots are the genre's payoff fantasy.
- Meanwhile it includes the Survey Globe with heat layer, 12 Flare Beacons, a second vehicle (Skiff) with two upgrade lines, 10 achievements, Holster and Lamp levels, and Repeat Requisition.
- Its pacing claim ("2.3–2.8 h matches v1.0 Skiff timing") is not valid:
  - MVP has no Puck Former or rails, which roughly double income at 45 min in v1.0.
  - Walking trips across a 900 m area are far longer than the fixed 40 s.
  - Survey Review *gates* the Skiff, which v1.0 never does.

**Fix.**
- Cut the Survey Globe (keep Spot Check and compass), Flare Beacons, the Skiff and upgrade lines, Holster/Lamp L2–3, and 7 of the 10 achievements.
- Add one **pre-built Roost with Sandpipers** at Boreal (buy-to-activate, outputs straight to a Gate) to prove robot simulation, net sync and automation feel.
- Make the Survey Review unlock the Roost instead.
- Run the sim with an MVP policy and walking distance.

### M15. Naming: upgrade, gear, vehicle and building names are close variants of banned names
**Where:** naming-bible §5–§9 and A5; banned lists M§8 and RB§9.

| Ours | Banned | Why it collides | Suggested |
| --- | --- | --- | --- |
| Auto-Puck | Auto-Packer | Same slot, near-homophone | **Overflow Press** |
| Express Lane | Express Dock (Logistics capstone), Express Delivery | Same slot and same head word | **Clean Handoff** |
| Long Arm | Long Reach (reach node) | Same slot, same construction | **Telescoping Pole** |
| Deep Clean | Deep Heads (depth node) | Same slot | **Scour** |
| Cruise Hold | Cruise Control | Near-identical | **Throttle Lock** |
| Deep Hopper, Hopper Bin | Big Hopper; CTM vehicle "Hopper" | Same slot / exact banned word | **Cargo Expander**, **Dust Vault** |
| Sinter Press | Stone press, Block Press | "[material] Press", production tier 2 in both references | **Tile Sinterer** |
| Crown Lamp: Work Beam, Flood Crown | work lamp, floodlamp (Helmet Lamp levels) | Level names | **Spot Ring, Wide Halo** |
| Work Lights (vehicle line), Work Light Mast | Floodlights; work lamp | Same slot | **Running Lamps, Lamp Pylon** |
| Anchor Boots | Gravity Boots; CTM "Boots" | Same item, same key | **Ballast Soles** |
| Certification "Haulage" | CTM class "Hauler" | Same role-class idea | **Logistics** or **Courier** |

### M16. Naming: robot states and achievements copy the reference list almost one to one
**Where:** naming-bible §8 and §10; banned M§8 (robot states, all 33 achievements).

**Problem.**
- Robot states: **Docking** and **Bin Full** match banned names exactly. Scanning ≈ "Scanning the area", and Roost Full ≈ "Dock full". Our list of 11 states maps 1:1 onto the reference's 11.
- Achievements:
  - Halfway Bright ≈ Half Way There (50%)
  - Regular at the Desk and Rail Regular ≈ Regular Customer
  - Wheels Down ≈ Finally, Wheels
  - Pocket Lint ≈ Pocket Full of Moon
  - Tonnage ≈ A Literal Ton of Dust
  - Brush Up ≈ Get A Better Brush
  - Bucket List uses CTM's banned container "Bucket"
- "Shine 1%" and "Shine 10%" are placeholder names, not names.

**Fix.**
- Rename the states in bird vocabulary: Foraging, Flying, Homing-in, Perching, Molting (emptying), Surveying, Patch Picked Clean, Roost Packed, Crop Full, Resting, Idle.
- Rename the flagged achievements and replace the two placeholders.
- Add a CI fuzzy-match check (token overlap within the same slot) on top of the exact-match check.

### M17. The title and premise sit close to banned names and lore (owner decision)
**Where:** GDD §1–§3; naming-bible §1; banned "Moon Cleaners", "Moon Sweepers", "the employment agreement framing", "budget covers only a toothbrush".

**Problem.**
- "Moon Custodians" has the same structure as two banned titles: Moon + a plural cleaning job. This is a real store-search and press confusion risk.
- The premise has the same beats as the reference: a cheap employer hires you and issues a laughably small tool.
- The meta layer is employment satire end to end: Induction, Probation, Performance Review, Benefits, Golden Handshake.

**Fix.**
- Escalate to Cee with the risk stated plainly.
- If the title stays, keep "Brightside" prominent in key art and the store capsule.
- Drop the "cheap employer / complimentary tiny tool" joke. For example, the Desk Duster could be a ceremonial heirloom, or the job could be a public bid Brightside is overselling.
- Never show an employment-agreement screen.

### M18. The data-driven format cannot express what the design needs
**Where:** E§21.

**Problem.**
- The effects schema `{stat, op: add|mul|set, value}` cannot encode the qualitative effects: Auto-Puck, Express Lane rail-snap, Golden Handshake's credit rule, Auto-Relocate, Homing, Closing Bonus, Final Walkthrough.
- There is no `traits.json`. Parameters for Detailing, Flick, Sure Footing, Charge and Twin Pass live only in prose.
- Several values are referenced but never defined:
  - The Steep slowdown that Sure Footing removes.
  - Vehicle "climb".
  - Work Lights' effect on the night penalty.
  - Spot Check range (which Inspection doubles).
  - Docket goal types and `amountFormula`.
  - On Break and AFK timers, and Clean-up Order rules.
- `pacing-targets.json` (`minH`/`maxH`) cannot express the §18.4 gap and median targets, the MVP Survey Review target, or 2- and 8-player rows.

**Fix.**
- Add a `flag` op with registered `featureId`s, plus `traits.json` and `moderation.json`.
- Add a `metric` enum (`time`, `gapMax`, `gapMedian`, `share`).
- List every prose number in a "constants not yet in data" appendix.

### M19. Co-op scaling assumes full attendance, and large shifts overflow the wallet
**Where:** E§18.1, E§19, GDD §7.2.

**Problem.**
- Every row assumes all N players play every hour together. Real friend groups of 4 will not run 15.8 h of synced sessions.
- The "co-op-uneven" policy has no targets.
- At 8–16 players the Review-gated permits bind, so money piles up with nothing to buy. That recreates "the wallet stops mattering" (C1) for groups.

**Fix.**
- Add targets for 4 players at 50% attendance.
- Give large shifts a permit-free money sink, for example a cosmetic Brightside Monument with Shine-scaled tiers, or buying a Review early at an LM price that grows with headcount.

---

## MINOR

### m1. Arithmetic slips
**Where:** E§8.1, E§17, E§18.2.
**Problem:** The vehicle max-out multiple is 6.30× (Behemoth 756k), not 6.35×. The 10:00 row is 7 Albatross, not 8. The night-averaged income is 765 LM/h, not 735. The §18.2 Whisk fill time of 46 s uses Moon density; it is ≈58 s in the outpost mix.
**Fix:** Correct them.

### m2. Standard Issue and Repeat Requisition conflict
**Where:** GDD §7.1, E§2, E§19.4.
**Problem:** The §19 cost formula 1 + 0.4·(N−1) ignores that T1–T3 are free. "Free for joiners" is ambiguous for members who were already present.
**Fix:** Say "free for every member once owned by anyone", and give the formula per tier.

### m3. Outpost start crowding is optimistic
**Where:** GDD §6, E§19.1.
**Problem:** The 0.02 crowding factor is far too small for 16 Desk Dusters sharing one outpost and one Assay Counter. Pour concurrency is not specified.
**Fix:** Give each Assay Counter 4 pour slots, and use a crowding factor of about 0.05 for the first hour.

### m4. Twilight Strips
**Where:** GDD §6.
**Problem:** A permanent grazing sun could mean 24/7 solar with no Night Cells.
**Fix:** Make solar output ∝ sin(sun elevation), with a stated value at the Strips.

### m5. Tenure estimate
**Where:** GDD §12, E§16.
**Problem:** Adding up the listed sources gives a solo contract about Tenure 45, not 35–40. "Dust you delivered" is undefined: does dust from your vehicle, or robot dust on rails, count?
**Fix:** Define it as player-cleaned kg only, and re-derive the estimate.

### m6. Overloaded words
**Where:** naming-bible.
**Problem:**
- *Shift*: the player group, room type, build mode and a key.
- *Survey*: Globe, Points, Fence, Area and Review.
- *Haulage*: a department and a Certification.
- *Motor Pool*: a building and a Certification.
- *Bulk*: Bulk Rate and Bulk Buyer.
- *Rail*: Glide Rail and "Rails & Railings".
- *Inspection* and Inspector's Stamp.
**Fix:** Rename the build mode "Relocate" and the structures tab "Handrails". Rename the Certifications (see M15).

### m7. Semantic one-to-one clones
**Where:** naming-bible §9, A3; GDD §6.
**Problem:**
- Surface finishes map one to one: Tread = Diamond plate, Mesh = Grating, Glow = Lit, Chevron = Hazard stripes.
- Panels copy the reference's wall/window/door × full/half/third set.
- The Break Room copies the station amenities: Puck Toss ≈ air hockey, Notice Board ≈ whiteboard, plus a radio.
- Also close: Plot Scan ≈ region scan (same key), Moon Hop and Spring Step ≈ Lunar Leap and Servo Stride, Plot Bonus ≈ Region Bounty, Whisk Brush ≈ "hand brush".
**Fix:** Vary at least the set sizes and concepts: 4 or 6 finishes, a different mini-game (for example a regolith zen-rake garden), and a different scan verb (**Plot Card**).

### m8. Gaps in the parity matrix
**Where:** mechanics-parity-matrix.
**Problem:** These reference mechanics have no row:
- Vehicle capsule slots and loading (T).
- One vehicle out per garage, and relocation when a garage is demolished.
- The home-direction indicator.
- The locker/avatar editor.
- Lore delivery (intro slides, manual chapters, diary notes).
- The tray "sell" button versus hold-to-pour.
- Robot switch-off.
- Global robots skipping unreachable hexes.

The §3 rows show "3-level roots" as v1.0, but MVP already ships Broad Strokes and Spring Step as 3-level roots.
**Fix:** Add the rows and correct the tiers.

### m9. Onboarding order and travel
**Where:** GDD §14.
**Problem:** The Induction puts "Buy a Dust Cell" after "Polish a plot", but the sim buys the Cell at 10 min. The Probation step "reach Dawnside" is a 10–17 minute trek, most of one session.
**Fix:** Reorder the Induction to match the sim. Seed Crates along the Dawnside route, or move that step to after the Skiff.

### m10. Comfort-item rule and purchase cadence
**Where:** E§22 (policy item 3), E§18.4.
**Problem:** The "≥6× wallet" comfort rule delays the Crown Lamp, which affects income at night. "Max gap ≤2 h" allows about 5 sessions in a row without a purchase.
**Fix:** Classify the lamp and visor as income items. Tighten the late target to a P50 gap ≤45 min, with Next Requisition partial-progress feedback.

---

**Counts:** 5 BLOCKER · 19 MAJOR · 10 MINOR (34 findings).
