# Clean The Moon! — Game Design Document

Direction: `docs/design/REFERENCE_TARGET.md` overrides retired naming/style/custom-gate rules.

Status: **Draft v2 for build (2026-11-12, after the independent game-design review).** Owner: game-designer. Cee (owner) may override anything.
Companion docs: [progression-and-economy.md](progression-and-economy.md) (every number) · [scope-tiers.md](scope-tiers.md) (what ships when) · [naming-bible.md](naming-bible.md) (every name) · [../research/mechanics-parity-matrix.md](../research/mechanics-parity-matrix.md) (mechanic-by-mechanic parity).
Constraints: [../architecture/tech-stack.md](../architecture/tech-stack.md): $0 hosting, browser client, Render Free 0.1 CPU server, no server physics, desktop KBM and gamepad first.

**Reading key.** ★ marks an authored proposal, not automatic baseline scope or proven improvement. REFERENCE_TARGET classifies default versus optional behavior. Follow the reference's recognizable mechanics and presentation with independently authored implementation/assets; names and tuning are flexible. Research shorthand: **[M§x]** = `moon-sweepers-mechanics.md` section x, **[R C#]** = `moon-sweepers-reception.md` complaint row, Legacy RB citations refer to retired secondary comparisons, not baseline requirements.

---

## 1. Title

**Clean The Moon!** is the owner-selected game title. Use this exact spelling and punctuation everywhere the game name is displayed.
Technical slug/package scope stays `moon-cleanup`. The [naming catalog](naming-bible.md) is flexible;
normal descriptive item names are allowed. Product priority is a close Moon Sweepers-like experience per
[REFERENCE_TARGET](REFERENCE_TARGET.md), using our own implementation, assets and branding.

## 2. Premise

Brightside Facilities Co. has just won the public tender to clean the Moon. The whole Moon. They won it mostly on the strength of a very confident slide deck. As the first **Custodian** on site, you are presented with the **Desk Duster** — the ceremonial brush Brightside used to dust the model Moon during the winning pitch ("It worked in the presentation") — and the cheerful support of **DOT**, the Dispatch Operations Terminal. Clean regolith dust off **163,842 hexagonal plots**, sell it by the kilogram for **Lumens (LM)**, reinvest in better tools, vehicles, rails, kilns and a flock of bird-like cleaning robots, and raise the **Shine Index** from 0% to 100% before anyone checks the deck against reality. Up to 16 Custodians can work one **Contract** together, in real time, in a browser.

The fantasy is the genre's proven one: **a ridiculously small tool against an absurdly large job**, with visible, permanent, shared progress [M§2][R§3]. The default is the reference-like equipment/income/discovery progression. Brightside lore and Performance Reviews below are optional authored extensions; they must not block ordinary core purchases.

## 3. Tone

- **Witty corporate, never mean.** Brightside is a cheerful, wildly overconfident facilities company that believes its own slogans ("We keep the bright side bright"). DOT is dry, polite and literal. It congratulates you on 0.0006% the same way it congratulates you on 50%.
- **Cosy, no-fail.** No oxygen, stamina, damage or death [M§3h][R§5]. Night makes things darker, not deadly. Falling over (Faceplant) is a joke.
- **Honest craft.** Human-directed art, text and audio; accurate credits and disclosure ★ (the reference's undisclosed-AI controversy [R C13]). DOT is written text with a chime motif, not a synthetic voice.
- **No paperwork screens.** We never show an employment agreement, contract signing or similar screen (review M17).
- **Sample DOT lines:** "Requisition approved. Please enjoy your new broom responsibly." · "Plot stamped. Only 163,841 to go. You're doing great." · "Performance Review scheduled. The slide deck promised 1% by now, so: well done, the slide deck." · "Reminder: the Moon has no weather. Any dust you see is your fault now."

## 4. Core loop

```
Sweep (hold LMB/RT) → tool's Dust Cell fills → pour at Assay Counter (or band it into Puck Stacks onto a Glide Rail)
   → Lumens land in the shared shift wallet → buy tools, Cells, Promotions, suit gear, vehicles, buildings, robots
   → bigger, faster, automated cleaning → plots reach Polished → Inspector's Stamp → Shine Index rises
   → money, equipment prerequisites and discovered locations expand the operation → repeat at a larger scale
```

Over the contract the loop climbs five layers, as in the reference [M§2.6][M§3j]:
1. **Hands:** six hand tools with growing width and Cells.
2. **Haulage:** Dust Pucks and Puck Stacks, Puck Former, Glide Rails to Receiving Gates.
3. **Wheels:** the Motor Pool and five vehicles.
4. **Flock:** local Roost robots (Sandpiper, Plover), then the global Albatross.
5. **Plant:** Bead Kiln and Tile Sinterer add value, powered by solar and Night Cells.

**Reference-first automation:** robots work at their calibrated base rate in an active room, including away from
players. No manual-cleaning Effort requirement, player-count rate bonus or 25% robot-origin payout penalty by default.
Automation should change what the player does; activity-gated custom progression is not required to make it "ours".
The custom Review/Flight Plan/Refit/Docket/Benefits design later in this file is optional backlog, governed by
REFERENCE_TARGET's baseline table; keep genuine reference equipment/logistics/production in scope.

## 5. Progression layers (overview; all numbers in [progression-and-economy.md](progression-and-economy.md))

| Layer | Parity structure | Ours | Where bought | Shared or personal |
| --- | --- | --- | --- | --- |
| Hand tools | 6 tools + building tool | Desk Duster, Crescent Squeegee, Bristle Broom, Lane Broom, Static Rake, Ion Curtain + Assembly Gun | Requisitions Desk | Personal (each player buys their own; Standard Issue for T1–T3) |
| Containers | Per-tool container, 3 levels | Dust Cell I/II/III per tool (the Storage department's 6 nodes) | Ops Console (Promotions Board) | Shared, bought once for the shift |
| Upgrade tree | 23 nodes, 5 branches, 3-level roots, 2-level secondaries, 1-level capstones | **Promotions Board**: hub Employee Badge + Storage, Technique, Fitness, Haulage, Accounts. Capstones not gated (parity), except Golden Handshake ★ | Ops Console | Shared |
| Suit gear | 5 lines, 14 levels | Holster Rig (5), Hop Pack (3), Ballast Soles (1), Crown Lamp (4), Lowlight Visor (1) | Requisitions Desk | Shared |
| Vehicles | 5 vehicles incl. 8-seat transport; 7 upgrade lines | Trundle, Skiff, Carryall (8 seats), Bulldust, Behemoth; Gear Ratio, Cargo Expander, Afterburner, Throttle Lock, Wide Mouth, Fast Tip, Running Lamps. ★ **Refit I–III** (Reviews 3–5) | Motor Pool | Personal (bought from the shared wallet, owned by the buyer) |
| Robots | 2 local tiers + 1 global | Sandpiper → Plover (Roost, 2/3 rings), Albatross (global, Bales to Nests). ★ Free one-click **Re-site**; ★ **Work Front** | Build menu | Shared |
| ★ Robot upgrades | none in reference (buy more, never better) | **Flight Plan**: Keen Beak, Deep Crop, Tailwind, Wide Wing, Homing (15 levels) + one-time Auto-Relocate | Ops Console | Shared. ★ Fewer, better robots: bounded counts for performance [R C4] and a late-game upgrade path [R C1] |
| Logistics | belts, splitter, merger, packager | Glide Rail (+ ★ Rail Run drag tool), Rail Fork, Rail Join, Puck Former, Receiving Gate; ★ buildable **Field Gate**; ★ **Puck Stacks** so rails aren't a hidden wall | Build menu | Shared |
| Production | 2 machines (×3, ×7 value); 3 solar sizes + batteries | Bead Kiln (Glass Beads ×3.2), Tile Sinterer (Sinter Tiles ×7.5); Sun Sprig, Sun Fan, Heliostat; Night Cell. ★ Machine **Grades I–III** | Build menu | Shared |
| Building | ~98 pieces | 98 pieces in 5 tabs; Place / Reposition / Reclaim (refund = price paid); ★ **Settle** rule for building on dust | Assembly Gun | Shared (author-tagged) |
| ★ Contract milestones | none in reference | **Performance Reviews** at Shine 1/5/10/25/50/75%, each with a Brief; unlock the Behemoth, the Tile Sinterer, Work Front, Carryall Convoy, Refits, Core Samples, Flock Formations, Grades, Flight Plan levels and permits; pay a free issue and Commendations (no cash) | Automatic | Shared. ★ Spreads unlocks across 100% of the contract [R C1, C3, C14] |
| Exploration | 195 flags, 26 lunar sites | 150 **Stray Cargo** + 24 **Survey Points**; ★ 40 **Core Samples** on Steep plots (Review 3+) | Found in world | Payout to the shift wallet; Tenure to the finder |
| Meta (Roblox-style) | Shards/Gems, classes, lobby upgrades | **Tenure**, **Commendations**, **Certifications** (deterministic ladder), **Benefits Package** (earnable versions of the Roblox paid conveniences), Locker cosmetics | Main menu | Personal, persists across contracts |

**Unlock order (solo, efficient play; [economy §18](progression-and-economy.md#18-pacing-targets--and-the-math-showing-theyre-hit)).** First Inspector's Stamp and Crescent Squeegee 5.9 min → first Dust Cell 8.5 min → Assembly Gun 42 min → Puck Former + first Glide Rail 49 min → Lane Broom 1:04 → Motor Pool + Trundle 1.5 h → Static Rake 1.6 h → first Roost 2.0 h → Skiff ~3.0 h → Bead Kiln 3.5 h → Bulldust ~3.8 h → capstones and Ion Curtain as payback allows (≈4–6 h) → Plovers and Auto-Relocate 4–5 h → first Albatross 5.9 h → **Review 1 (Shine 1%) 6.2 h** → Behemoth, Tile Sinterer, Work Front 6.2–7 h → **Review 2 (5%) 10.3 h** → all personal upgrades done 10.4 h → Review 3 (10%) 13.4 h → Review 4 (25%) 18.6 h → Review 5 (50%) 24.0 h → Review 6 (75%) 27.9 h → **Contract Fulfilled 31.1 h**. The reference finishes all upgrades at about 0.5–5% of the Moon [R C1]. Ours spreads Flight Plan levels, Grades, Refits, permits and Review content to 75% ★.

## 6. World

- **The Moon:** sphere of radius **2,000 m** (area 50.27 km²), terrain from baked NASA LOLA heights with vertical exaggeration ([tech-stack](../architecture/tech-stack.md) ADR-0008). Low gravity 1.62 m/s² (Ballast Soles toggle an "Earth-feel" mode).
- **Plots:** 163,842 cells of an icosahedral Goldberg grid GP(128,0): 12 pentagons, the rest hexagons; mean 306.8 m², about 19 m across. Plot IDs show as `Plot 41-207`.
- **Plot states:** **Grimy** → **Opened** (≥0.1% of its dust removed) → **Polished** (≤1% left). The Inspector's Stamp fires at Polished, and Polished is permanent. Empty plots are Polished from the start. Server-side integer accounting plus a recount on load ★ (the reference shipped plots stuck at 99.9% [R C8]).
- **Shine Index** shows four decimals (one plot = 0.0006%) plus a live **albedo / "dust removed"** readout that moves from your very first stroke ★ (review M1).
- **Terrain classes** set the dust depth: **Highland** (55% of plots), **Mare** (35%), **Crater Floor** (10%, deepest dust). **Steep** plots (crater walls, rilles; slope >25°) can't be driven: hand tools, Hop Pack and robots only, and hand tools sweep-walk at ×0.6 there unless their trait says otherwise. This gives hand tools a late-game role ★ ([R C2]: tiers made useless by vehicles).
- **Outposts (4, fixed):** Outpost Boreal (north pole, start), Outpost Austral (south pole), Outpost Dawnside (equator 90°E), Outpost Duskside (equator 90°W). Each compound covers its plot and ring 1 (empty), and has an Assay Counter (4 pour slots), 4 Receiving Gates (3 rail inputs + 1 Bale Chute face each), a Railshot, a Requisitions Desk, an Ops Console, a Relay Pad and a **Break Room** (Rock Garden, Postcard Rack, Earthview Window, Hold Music on the DOT terminal).
- ★ **Landing Apron:** 6 plots of ring 2 at every outpost were mostly blasted clean by the landers; only thin drifts remain (20% of the plot at dust level 2). Your first plot is one of these, so the **first Inspector's Stamp comes at ≈6 min** (review M1).
- **Day/night:** 60 real minutes, 30 lit and 30 dark at every location; the sun moves on a great circle **through both poles, in the plane of longitude 45°/225°**, so all four outposts (poles included) get 30/30 day and night. A new contract starts at Boreal sunrise. Only the two equatorial **Twilight Strips** (≈135°E and ≈45°W) keep a permanent grazing sun, which is a photo spot: solar output there is ≈3% of peak for fixed panels and ≈10% for a Heliostat ([economy §11](progression-and-economy.md#11-production-and-power)). The contract clock is server-authoritative. There is no sleeping through night.
- **Travel:** neighbouring outposts are about 3.1 km apart. The **Relay Pad** teleports to any outpost the shift has visited (50 LM, not from vehicles). **Outpost Recall** (hold 5 s) returns you to the nearest visited outpost for 100 LM. The compass always shows the direction to the nearest outpost.
- **12 Flare Beacons**, shared, colored 150 m light pillars. ★ All 12 show on the compass at once (the reference showed one at a time [R C8]).

## 7. Co-op design (1–16)

### 7.1 Shared vs personal

| Shared by the whole shift (one per contract) | Personal (per player) |
| --- | --- |
| Shift wallet (LM), all income | Hand tools owned (Holster loadout) |
| Dust Cell levels, Promotions Board, suit gear, Flight Plan | Vehicles, their upgrades and Refits (bought from the shared wallet; only the owner drives and upgrades) |
| Buildings, robots, rails, machines, power | Tenure, Commendations, Certifications, Locker cosmetics (profile-level, persist across contracts) |
| Plot states, Shine Index, Performance Reviews and Briefs, Shift Docket, Flare Beacons, outposts visited | Plot credit (for Tenure XP and Stamp Premium), Effort |

★ **Standard Issue:** the Desk Duster, Crescent Squeegee and Bristle Broom are free for **every member, present or future, once anyone in the shift owns one**. ★ **Repeat Requisition:** further copies of a T4+ tool, the Assembly Gun or a vehicle cost **40% of list**. Reason: in the reference every extra player multiplies personal costs, so big crews are punished [M§6].

### 7.2 How player count changes pacing

From the economy targets (efficient play): **solo 31.1 h · 2 players 19.8 h · 4 players 15.1 h · 8 players 11.7 h · 16 players 9.0 h**; 4 players who each attend half the time ≈18.5 h. The mechanisms are explained in [progression-and-economy §19](progression-and-economy.md#19-how-player-count-affects-pacing):
1. More hands mean more personal cleaning and more full-rate income. A crowding factor of 1/(1+c·(N−1)) reflects overlap (c = 0.05 in the first hour around one outpost, then 0.02).
2. ★ **On-Shift Bonus:** robots work ×(1 + 0.6·√(A_eff − 1)), shown on the HUD: ×2.04 at 4 active players, ×3.32 at 16. Reason: co-op should pay off for everyone [RB implication 3] without adding robot entities. **A_eff counts only real work** (review B2): each distinct account contributes its **Effort** (dust it actually removed in the last 300 s versus its loadout's expected rate), it must have input in the last 30 s and moved in the last 60 s, extra tabs of one account count 0, accounts need Tenure ≥3, and all accounts on one IP subnet together count at most 1.0. Idle or duplicate sessions add nothing.
3. Shared purchases are bought once. Personal copies get Repeat Requisition. The Shift Docket is shift-level, so it doesn't multiply with headcount.
4. Robot and production permits come from Performance Reviews, so big shifts are paced by milestones, not just money. This keeps entity counts bounded ★ [R C4]. Big shifts that are permit-capped can spend on Refits and the cosmetic **Brightside Monument**.

### 7.3 Roles (emergent, never enforced)

The research shows crews split work naturally [M§6]. We support that with Certifications (§12) and UI, never with locks:

| Role | Typical job | Supporting systems |
| --- | --- | --- |
| Brushwork | Steep plots, crater walls, stragglers, Review Briefs, Core Samples | Static Rake (Charge), Detailing trait, Spot Check |
| Railhand | Puck Stacks, rails, Field Gates, Carryall runs and Convoys | Puck Magnet, Strong Arm, Smooth Handoff, Rail Run |
| Driver | Driving Bulldust and Behemoth across the open maria; leading the Work Front | Vehicle upgrades, Refits, Throttle Lock, Flock Formations |
| Assembly | Building bases, rails, power | Assembly Gun, build snapping |
| Aviary | Placing and re-siting Roosts, Nest networks | Flight Plan, Equipment Cards, Survey Globe robot layer |
| Plant | Kilns, Tile Sinterers, power balance | Machine status tooltips, Grades |
| Finisher | The last 1%: Punch List, Clean-up Orders | Survey Globe highlights, Homing |

### 7.4 Room types and join-in-progress

- **Solo Shift:** 1 player, not joinable. It can be switched to Private at any time.
- **Private Shift:** invite code or link, up to 16. This is the default ★ (the reference added a public-lobby warning after griefing [R C6]).
- **Open Shift:** listed on the **Shift Board** with Shine %, headcount, language tag and "Temps welcome". Up to 16. ★ It **stops admitting Temps** while no Holder or Supervisor has been online for 10 min (review M10).
- **Join-in-progress:** players can join at any time. A joiner spawns at the most recent outpost the shift visited and receives Standard Issue tools and an **Orientation Packet** (a DOT summary: Shine, next Review and its Brief, the current Docket, where people are). Reconnects resume within a grace window (netcode spec). The contract persists server-side; the Holder leaving does **not** end the shift for others ★ (it ends everyone's session in the reference [M§6]).

### 7.5 Roles and permissions (griefing protections) ★

| Permission | Holder (contract owner) | Supervisor (appointed) | Staff (Private invite) | Temp (Open drop-in) |
| --- | --- | --- | --- | --- |
| Spend shift wallet | Yes | Yes | Yes | **No.** Temps get a ★ **Loaner Kit** instead: the best tool tier any member owns and (once a Trundle exists) the shift's best vehicle tier below the Behemoth, free, non-upgradable, returned on leave; max 4 loaner vehicles out |
| Buy shared items (Promotions, Flight Plan, robots, machines) | Yes | Yes | Yes | No |
| Place builds | Yes | Yes | Yes | **Logistics and Structures only**; not within 10 m of a Services piece they didn't place (tagged with the author) |
| Reposition or Reclaim others' builds | Yes | Yes | Own and Temps' | Own only |
| Place or move Flare Beacons | Yes | Yes | Yes | 1 personal ping only |
| Kick, ban, unban | Yes | Kick and 24 h ban | Vote-kick Temps when no Holder or Supervisor is online | Vote-kick another Temp with ≥3 votes, voters Tenure ≥5, when no Holder or Supervisor is online |
| Change room type, appoint roles | Yes | No | No | No |

Further protections:
- **No-build zones:** nothing may be placed within 15 m of outpost services (Assay Counter, Gates, Railshot, Relay Pad, Requisitions Desk, Ops Console), so nobody can wall them in.
- **Incident Report → Revert** undoes every build by one player in one action.
- Bans persist in the database.
- Chat is rate-limited, with per-player mute and report. **No free-text chat in Open Shifts at MVP**: Temps use quick-chat pings only (decision 2026-11-12, matches security.md §8).
- Vehicles "ghost" through players in Open shifts. Knockback is a Private-shift toggle; the reference's vehicles launch crewmates [M§3c].
- **One AFK policy for every room type** (review M8; the netcode doc must match): no input for 10 min → **On Break** (Effort 0); in Open Shifts a Temp On Break for 30 min is removed; the room closes when nobody has had Effort > 0 for 30 min. While open with nobody cleaning, robots run Unattended (×0.5).
- Dust can't be put back, so the world can't be un-cleaned. Dust "graffiti" disappears when the plot is finished. Holders and Supervisors can issue a **Clean-up Order**: the nearest Albatross cleans the flagged plot next. Before any Albatross exists, a **Brightside Service Call** clears it in 60 s, unpaid (no LM, no Stamp), up to 3 per contract per real day ★ (the reference had offensive dust drawings [R §3]).
- The server validates every action ([R C6]).

## 8. Session design (20–25 minutes must feel productive)

Rolimons measured average Roblox sessions of about 20–24 min [RB§7], and the reference's best part is "a few hours of cathartic cleaning" [R§5]. Every session gets a beginning, a middle and an end:

1. **Clock In → Shift Briefing** (skippable, ≤10 s): what changed since your last shift, the Shine delta, the next Review distance and its Brief, and the current **Shift Docket**. ★ The Docket is **one per shift** (shared, never per player), with 3 goals generated from contract state (not random rewards), e.g. "Stamp 12 plots near Flare Beacon Amber", "Feed 2 t to the Kilns", "Re-site 3 idle Roosts". A new Docket arrives every 30 min of shift activity (never on Clock In, so rejoining doesn't reroll it), at most 8 per contract per real day, starting after Probation. Each goal pays half an income-minute from a **fixed stage table** (so payouts never inflate the next Docket), all three add one more income-minute and 1 Commendation to each contributor (max 3 per player per day) (review B3; [economy §16.1](progression-and-economy.md#161--shift-docket-review-b3)).
2. **Something to buy.** Target: a solo purchase gap of **≤45 min at the median and ≤90 min at worst** (progression items only). The **Next Requisition** tracker always shows progress toward the next chosen item and pings at 25/50/75% funded.
3. **Something stamped.** The first Stamp comes at ≈6 min (Landing Apron). After that, about one Stamp per 10 min by hand in the first hour, one per ≈3 min once you drive the Trundle (≈1.5 h), and dozens per session from the Skiff on — each with the Inspector's Stamp VFX and sound.
4. **Clock Out → Shift Report:** LM earned, plots stamped, Shine delta, best Hang Time, Docket results, Effort, progress bars to the next Review (and its Brief) and Tenure level.

**Unattended progress (one policy, review M8).** Robots work whenever the contract room is open, at full rate while anyone is cleaning and at ×0.5 when nobody is. The room closes 30 min after the last Effort, in every room type. In v1.0 nothing accrues while the contract is closed: the free server sleeps, and pacing targets are **contract-active hours** (hours with someone cleaning); Unattended minutes are a small bonus, not counted. A capped "Night Shift" catch-up is a post-launch option with stated pacing impact ([scope-tiers.md](scope-tiers.md)).

## 9. Controls

All bindings are remappable. Last-used device wins, and idle gamepad axes are ignored while KBM is active ★ (the reference's stuck-W bug [R C11]).

| Action | Keyboard & mouse | Gamepad |
| --- | --- | --- |
| Move / look | WASD / mouse | Left stick / right stick |
| Sweep (hold) | LMB | RT |
| Tool trait (Detailing, Twin Pass aim, etc.) | RMB | LT |
| Lane Lock (lock sweep angle) | R (toggle) | Right-stick click |
| Jump; Hop Pack (press again in air) | Space | A |
| Lope (run while not sweeping) | Shift | Left-stick click |
| Interact; hold to pour at the Assay Counter or Puck Former | E | X |
| Form a Dust Puck from the Cell (tap) / band the Cell into Puck Stacks (hold) | F | Y |
| Pick up / drop; hold and release to throw puck or stack | Q | B |
| Tool slots | 1–6 / mouse wheel | LB / RB |
| Draw Assembly Gun | X | Hold LB + RB |
| Plot Card | C | D-pad Up (tap) |
| Camera first/third person | V | D-pad Up (hold) |
| Survey Globe | M | View |
| Ping wheel: Spot Check, place Flare Beacon, tag Work Front, "over here" | Z (hold) | D-pad Down (hold) |
| Crown Lamp / Lowlight Visor / off | N | D-pad Right |
| Ballast Soles | B | D-pad Left |
| Shift Roster | Tab | Hold View |
| Chat / DOT Handbook / pause | Enter / H / Esc | Quick-chat via ping wheel / pause menu / Menu |
| **Vehicle:** throttle, brake/reverse, steer | W, S, A/D | RT, LT, left stick |
| Afterburner / Throttle Lock / Wide Mouth cycle / Running Lamps | Shift / C / R / L | A / Right-stick click / D-pad Up / D-pad Right |
| Load/unload pucks and stacks / exit | T / E | Y / hold X |
| **Build (Assembly Gun):** place (hold to Settle on dust) / cancel / rotate 30° | LMB / RMB / R | RT / LT / LB, RB |
| Rail Run (drag a rail path) | Hold LMB and drag with a rail piece selected | Hold RT and move |
| Mode Place → Reposition → Reclaim / snap toggle / category | Q / Ctrl / wheel | Y / left-stick click / D-pad |

The vehicle camera follows by default, with a free-look toggle in Settings ★ [R C11].

## 10. HUD and UI overview

- **Top-left:** LM wallet with a tick-up ticker; the On-Shift chip, e.g. "Flock ×2.04 · Effort 100%" (turns amber "Unattended ×0.5" when nobody is cleaning).
- **Top-center:** compass with the 4 outposts (distinct colors), the nearest-outpost arrow, all 12 Flare Beacons, Work Fronts, pings and your vehicle.
- **Top-right:** Shine Index to four decimals plus the live albedo / "dust removed" readout, and "Next Review at 5% (3.2% to go) · Brief 1/2".
- **Bottom-right:** Holster slots, each with its own **Cell** gauge; the active tool is enlarged.
- **Bottom-left:** suit icons for Lamp/Visor, Hop bursts and Ballast Soles, plus the day/night ring (minutes to dusk/dawn).
- **Left edge:** Shift Docket (3 goals) and the Next Requisition tracker with 25/50/75% ticks. The Plot Card (C) shows ID, state, % remaining, credited-to and Escorted.
- **Notifications** carry DOT's amber light, at most 3 stacked: "Requisition approved", "Plot stamped", "Railshot away", "Roost idle: patch Polished. Re-site?" (one-click).
- **Survey Globe** (M; works anywhere ★ — the reference map works only at stations [R C8]): rotatable Moon; plot states with a pattern-plus-color legend; a remaining-dust heat layer; robot layer with states and one-click Re-site; outposts, Flare Beacons, Work Fronts, Stray Cargo and Core Samples found; **Punch List** (Review 2) listing remaining plots by distance; right-click to set a Flare Beacon or Relay.
- **Menus:** Requisitions Desk (tools, suit gear, Remote Assay); Ops Console (Promotions Board, Flight Plan, Reviews, Briefs & Permits, Brightside Monument); Motor Pool (vehicles, upgrades, Refits, recall); build menu (Services, Logistics, Production, Power, Structures); Equipment Cards. Every machine, Roost, Nest and Gate has a **"Why isn't this working?"** status line ("No rail attached", "Night Cell empty", "Nest 80% full", "Gate input at 85%") ★ [R C10].
- Implementation: React DOM overlay with design tokens and Motion springs (ADR-0012). UI store updates ≤15 Hz except tick-ups.

## 11. Audio direction (summary; full spec in `audio-direction.md`, owned by audio-engineer)

- **Helmet-muffled world.** There is no air on the Moon, so world sound comes through suit contact. Tool scrape, footfalls and vehicle rumble pass through a low-pass "helmet" filter. Your own breathing is near-silent and calm.
- **Signature cues:** the Inspector's Stamp "ka-chunk" plus a bright chime (pitch climbs on streaks within 60 s); the Assay Counter ka-ching with a weighing tick-up; the Railshot thump-and-whoosh across the horizon; Glide Rail hum; Albatross wingbeat chirps; DOT's two-note amber chime.
- **Music:** calm ambient synth-and-mallet beds, a day set and a night set crossfading at the terminator, with a sparse layer added at each Performance Review. In Break Rooms the DOT terminal plays Brightside **Hold Music** (original licensed tracks only; "Your call is important to us").
- **Sources:** original, CC0 or CC-BY only, logged in the asset ledger.

## 12. Meta layer (persistent profile) — Roblox-style, no gacha, nothing paid

| System | Rules |
| --- | --- |
| **Contracts** | Each player can hold up to 3 Contracts and join any number of others'. Contracts persist server-side (continuous checkpoints ≤30 s). Main menu → Contracts lists Shine %, last played and members. |
| **Tenure** (levels 1–50) | Earned from: plots credited to you (1 XP each), dust you cleaned with your own tools or vehicles (1 XP per 250 kg; robot dust never counts), Performance Reviews you're eligible for (100 × Review number), Survey Points (100), Core Samples (50), Docket goals (25), achievements (50–500), Stray Cargo (10–80). Ranks: Trainee 1–4, Custodian 5–14, Senior Custodian 15–29, Lead Custodian 30–44, Head Custodian 45–50. A suit livery every 5 levels; Certification slot 2 at Tenure 20, slot 3 at Tenure 40. A full solo contract gives about **Tenure 38** (≈32,000 XP; [economy §16](progression-and-economy.md#16-meta-economy-profile)). |
| **Commendations** | Earned from Performance Reviews (2/3/4/5/6/8, Contract Fulfilled 20; 48 per contract), achievements (1–5), complete Shift Dockets (1, max 3 per day), Survey Points (2), Core Samples (1), finding all Stray Cargo (10) and all Core Samples (5). ★ No random rolls: everything is a fixed price (the Roblox class rolls are gacha [RB§2.1]). |
| **Review and Fulfilled rewards** ★ | Go to every member or Temp with ≥10 credited plots or ≥30 active minutes since the previous Review, **online or not** (delivered at next login). Joining at 99.9% earns nothing until you meet the bar (review M9). |
| **Certifications** | A deterministic ladder (cf. the Roblox Gem-priced classes [RB§2.2]). One is active at start; more slots come with Tenure. Small role perks, all ≤5–10%: Brushwork (free: +5% sweep-walk speed), Railhand (30: +1 carried puck or stack, +10% throw), Driver (60: +5% vehicle cruise), Assembly (100: instant Reposition/Reclaim, −10% rail cost), Aviary (160: your new Roosts start with +1 ring until first Re-site), Finisher (250: Spot Check range ×2, +10% Stamp on your plots), Dispatch (400: while you're present, the shift's Docket offers 4 goals and any 3 complete it; rewards unchanged). |
| **Benefits Package** | ★ The Roblox paid conveniences, made earnable [RB§5.4]: Signing Bonus (20: new contracts start with 500 LM; replaces paid head starts), Pre-Approved Motor Pool (40: first Motor Pool free; replaces instant vehicles), Fleet Voucher (50: one free Roost at contract start; replaces the paid +1 robot dock), Courier Pass (60: Remote Assay unlocks at Review 1 instead of Review 2; replaces instant sell and sell-as-you-sweep), Quick Clip (15: instant tool swap), Lope Training (25: +5% Lope speed; replaces paid fast legs), Comfort Seat (25: +5% Afterburner duration; replaces paid fast vehicles). They apply only in contracts you hold, and the Holder's Benefits apply to everyone in that contract. Effect on pacing is ≤10% (balance-sim "benefits" policy). |
| **Locker** | The suit/avatar editor: liveries, visor tints, Flare Beacon colors, Deck Plate finishes and emotes, bought with Commendations or unlocked by Tenure and achievements. Nothing paid. |
| **Achievements** | The 33 in the naming bible. ★ No pure-AFK grinds: "Known by Name" (1,000 pours) is the top count tier; there is no 10,000-deliveries tier [R C15]. |

## 13. Accessibility

- Full remapping, hold/toggle options for sweep, Lope and Hop, and an auto-sweep toggle that keeps sweeping while a direction is held.
- Colorblind-safe plot states: pattern + color + icon (Grimy hatched umber, Opened dotted cyan, Polished solid ivory with a stamp glyph). A colorblind palette switch for the UI.
- Subtitles and captions for DOT and key sounds, with text size 80–200% and a high-contrast HUD option.
- Night assist: a minimum-visibility floor, so Lowlight Visor and Crown Lamp help but are never required to see the ground.
- Comfort: reduced motion (no camera shake or FOV kicks), FOV slider, vehicle-camera options, motion-sickness-friendly first person, Railshot flash dimming (photosensitivity), and Ballast Soles default-on for players who dislike low-gravity floatiness.
- Screen-reader labels on menus, full keyboard and gamepad menu navigation, and Read Aloud for chat (TTS) as an option.

## 14. Onboarding

- **Induction Checklist** (DOT, about 10–15 min, one step at a time, cf. the 8 Roblox quests [RB§2.2]; order matches the balance sim, review m9):
  1. First stroke (on a Landing Apron plot).
  2. Fill your Cell.
  3. Pour at the Assay Counter.
  4. Open the Plot Card (C).
  5. Polish the Apron plot (Inspector's Stamp, ≈6 min).
  6. Buy the Crescent Squeegee.
  7. Buy a Dust Cell (≈9 min).
  8. Find a Near Parcel (6 lie within 300 m of Outpost Boreal).

  Each step pays Tenure XP only (no LM), so the opening pacing is exactly the sim's (review M2).
- **Probation Checklist** (about 0.7–2 h): buy the Assembly Gun; build a Puck Former and Glide Rail (try Rail Run) to a Receiving Gate; build a Motor Pool and a Trundle; place a Roost; set a Flare Beacon. It ends with "Probation passed", 3 Commendations and the first Shift Docket.
- **Field Trip** (after the Skiff, ≈3 h): DOT suggests driving to Outpost Dawnside (unlocks its Relay Pad); three Crates are seeded along the route.
- **Lore delivery:** DOT site memos at Survey Points, Brightside "slide deck" snippets in Review screens, and Postcard Rack cards; never cutscene paperwork.
- Contextual DOT tips trigger on first encounters (first night, first full Cell, first Steep plot, first idle Roost, first Unattended return). The **DOT Handbook** (H) is an always-available illustrated manual.
- ★ The Probation Checklist shows the **long-term arc** (robots, Reviews, Fulfillment) in the first hour, so the first 2 hours aren't the best 2 hours [R C14].

## 15. End condition and post-completion

- **Contract Fulfilled** at Shine 100%: every plot is Polished or empty, by server recount.
- **Ending sequence** (about 60 s, skippable after first view): orbital pull-back as the Moon's albedo rises; every Railshot fires a salute; a DOT performance letter with the shift's stats ("The slide deck was right. Nobody is more surprised than Brightside."); credits.
- Rewards: Tenure bonus, 20 Commendations, and the "Contract Fulfilled" achievement for every eligible member (≥10 credited plots or ≥30 active minutes since Review 6), online or not.
- ★ The contract becomes a **Showcase Moon**: free roam, all building, photo mode, **Beacon Run** time trials between Flare Beacons (vehicle tricks pay cosmetic points), Stray Cargo, Survey Point and Core Sample clean-up, and Overtime achievements. It can be shared as a read-only "visit" link. Reason: the reference's after-ending state is unknown and post-Moon content is only promised [M§5].
- **Renewal:** start a new Contract carrying your Tenure, Certifications and Benefits. New moons and materials are post-launch ([scope-tiers.md](scope-tiers.md)).

## 16. Fixing the "last 1%" ★

The reference's late hunt for stray sectors is a known pain [R C8]. Our toolkit:
1. **Inspector's Stamp at ≤1%**, with server recount and integer thresholds, so there are no stuck plots.
2. **Survey Globe anywhere**, with a remaining-dust heat layer from the start.
3. **Spot Check** (ping wheel): DOT draws a ground arrow to the nearest non-Polished plot within 300 m, plus a world-space marker.
4. **Punch List** (Review 2): the Survey Globe lists every remaining plot in a region, sorted by distance; click to set a Flare Beacon.
5. **Work Front** (Review 1): drive to a cluster and the flock comes with you.
6. **Homing I** (Review 5): Albatross prioritise Opened and isolated plots.
7. **Homing II and Final Walkthrough** (Review 6): robots seek stragglers with no travel penalty. DOT auto-places Flare Beacons on the 12 largest remaining clusters. The **Closing Bonus** doubles the Inspector's Stamp for the rest of the contract.

## 17. Improvement register (summary of ★ items)

| # | Improvement | Fixes |
| --- | --- | --- |
| 1 | Performance Reviews gate new content at Shine 1/5/10/25/50/75%, each with a hands-on Brief and a qualitative unlock | All upgrades bought by 0.5–5% of the Moon [R C1, C3] |
| 2 | Flight Plan robot upgrades + bounded permits (≤24 Albatross, ≤24 Roosts) | "Buy more robots" as the only late lever; lag with hundreds of robots [R C1, C4] |
| 3 | Effort-driven On-Shift Bonus (Unattended ×0.5), Work Front, Refit, Bulk Rate | Automation replacing play [R C1, C9] |
| 4 | Production Grades I–III and Plant Permits across Reviews | Thin late game [R C3, C16] |
| 5 | Last-1% toolkit (§16) | [R C8] |
| 6 | Shared economy, roles, Loaner Kit, no-build zones, Revert, private by default, persistent contracts, one AFK policy | [R C6, C7] |
| 7 | Repeat Requisition and Standard Issue | Multiplied per-player costs [M§6] |
| 8 | Tool traits, Steep terrain, depth that matters, net-positive Wide Mouth, capstones that also help vehicles | Useless tiers [R C2] |
| 9 | Field Gate, Puck Stacks, Rail Run and Remote Assay | Requests for placeable selling points; belt walls; Roblox paid "instant sell" [R C16][RB§5.4] |
| 10 | Status lines on every building; snapping, Reposition, Reclaim and Settle | Building UX [R C10] |
| 11 | Benefits Package and Certifications earnable, no gacha | Roblox paid conveniences and random rolls [RB§5] |
| 12 | Survey Globe anywhere, 12 visible Flare Beacons | Navigation [R C8] |
| 13 | No AFK-grind achievements; Showcase Moon after Fulfillment | [R C15], unknown post-ending [M§5] |
| 14 | Honest, human-directed craft; DOT as text | [R C13] |
| 15 | Landing Apron and a four-decimal Shine readout: first Stamp in ≈6 min | Slow early hook (review M1) |
