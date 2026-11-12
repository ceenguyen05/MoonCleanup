# Moon Sweepers (Steam): Gameplay Systems, Progression and Pacing Reference

**Date:** 2026-11-11 · **Author:** research subagent P1a · **Scope:** The Steam game *Moon Sweepers* (DragDrop Games), game version 1.0.5 (latest patch found, dated 2026-10-28). Covers core loop, every progression layer, unlock order, world structure, co-op, pacing benchmarks, and reference proper nouns. Numbers are summarized as tier counts, ratios and curves, as the brief requires. The Roblox titles are not covered here. This is research only; it contains no code.

**How to read this document**
- `[S#]` refers to the numbered **Sources** list at the end. Every source was accessed on 2026-11-11, and each is labeled official, press or community.
- Confidence levels: **H** means an official source or several independent sources agree. **M** means one good community source, or a derivation that checks out internally. **L** means anecdotal, a single weak source, or our own inference.
- "Derived" means our own arithmetic on cited figures.
- About the main community source, the **Wikily wiki** [S15–S49]: it looks data-mined, with sub-second timings and in-game strings. On every point we could cross-check, it matched the official patch notes [S6–S10]. Those points were night-vision price and key, capsule-catcher capacity, the catcher grouping rule, the world capsule cap, shared upgrades and full building refunds. We therefore treat its raw values as **M–H**, while labeling it community.

---

## Executive summary

1. **What it is.** *Moon Sweepers* is a Steam game, App ID 5335510, developed and published by DragDrop Games, a two-person team. It released fully (not Early Access) on 23 Oct 2026 at $8.99. It is Windows-only, supports solo or 1–16-player online co-op, and is built in Unity. (H) [S1][S2][S7][S51][S53][S55]
2. **Core loop.** Players sweep dust with a hand tool into that tool's small container. They carry it, or pack it into 1-kg capsules, and deliver it to one of 4 stations, either by tray sale or by conveyor intake. Payment is per kg into one shared crew wallet. The money buys wider tools, bigger containers, upgrades, vehicles, buildings and robots. (H) [S2][S26][S27][S46]
3. **World.** The moon is a small sphere, about 2 km in radius according to the wiki, split into **163,842 hexagonal sectors**. A sector completes and pays a flat bonus at **≤1% dust remaining**. The ending plays when every sector is done. (M–H) [S36][S37][S46] Derived: 163,842 equals 10·4⁷+2, which is exactly the cell count of a geodesic hex grid subdivided 7 times (12 pentagons and the rest hexagons).
4. **Progression layers.** The game has 6 hand tools, 3 container levels per tool, and a **23-node, 5-branch upgrade matrix** with single-level capstones. It also has 5 suit-gear lines, 5 vehicles with 7 per-vehicle upgrade lines, and 3 robot tiers. Logistics covers belts, splitters, mergers and a packager. Production has 2 machines and 3 solar sizes, and the build menu holds about 98 pieces. (M–H) [S16][S19][S20][S21][S22][S24][S30][S32][S33]
5. **Unlock gates are almost purely monetary.** There are only three structural gates. First, a cheap **building tool** opens the build menu, which leads to garage and vehicles, belts, robots and machines. Second, the upgrade matrix has prerequisites. Third, you must visit a station once before you can teleport to it. (M) [S18][S20][S22][S38]
6. **Cost curves.**
   - Hand tools cost about ×2–3 per tier for about ×1.3–1.8 width and ×1.3–3 capacity.
   - Container levels double capacity for double the cost, so the cost per added kg stays flat.
   - Matrix levels cost about ×2–3.3 per level.
   - The vehicle price ladder of about 1 : 3.3 : 8.3 : 20 buys about 1 : 1.5 : 2.1 : 2.7 width and 1 : 5 : 12 : 30 hopper.

   (M, derived from [S16][S19][S20][S22][S26])
7. **The pacing cliff is the key finding.** All personal progression (tools, matrix and suit gear) costs only about **1.3× one top-tier robot**. One-off exploration rewards (195 flags and 26 lunar sites) roughly pay for all of it. Players report finishing **all upgrades in about 6–8 h solo while less than 1% of the moon is clean**. The rest of the game is scaling a fleet of top-tier robots, and that is the #1 complaint in negative reviews. (M) [S12][S13][S5][S52]
8. **Robots.** There are two local dock robots, which clean fixed 19- and 37-hex areas and deliver via belts. There is also one global robot costing about 80× the basic one. It auto-targets the nearest dusty sector anywhere, clears roughly one sector per ~70 s, and fires dust capsules to "catcher" buildings. Since patch 1.0.4 it works with no player nearby. Full clears use **hundreds** of them. (M–H) [S33][S34][S8][S52]
9. **Automation and production.** The packager, robot docks, garage silo and catchers all feed belts, which feed station intakes, where goods sell on arrival. Production turns dust into sand (3× value) and then into stone blocks (7× value). It runs on solar power, with batteries covering the 30-minute night. (M–H) [S26][S27][S29][S30]
10. **Day/night.** The cycle is 60 minutes: 30 lit and 30 dark at every location. It affects visibility (lamp and night vision) and solar output. (M) [S41]
11. **Co-op.**
    - The world lives in the host's save, and sessions run through Steam invites or public lobbies.
    - The wallet, the upgrades (shared since patch 1.0.3) and the waypoints are shared across the crew.
    - Tools and vehicles belong to each player.
    - No evidence shows costs or rewards scaling with player count.

    (H for shared upgrades; M otherwise) [S6][S44]
12. **Pacing benchmarks.**
    - The first tool upgrade comes within minutes (98% of players have it).
    - The first build and first vehicle come at about 1–2 h (81–83% of players).
    - All upgrades take 6–8 h solo.
    - 39.5% of players have cleaned 1% of the moon.
    - A full clear takes about 30–40 h since patch 1.0.4. 5.6% of players had one by 11 Nov.

    (L–M) [S4][S12][S13][S52]
13. **Achievement funnel (33 achievements).** Each 10× step in money or regions keeps about 50–75% of the players from the previous step. Manual deliveries collapse after 100: 53.8% reach 100 deliveries but only 3.3% reach 1,000, as automation replaces hand delivery. (H for the data, M for the interpretation) [S4][S43]
14. **Roadmap.** Version 1.1, the "first major content update", is planned for December 2026. It is meant to add new machines and materials, more late-game progression and better automation. The developer says work continues "after the Moon is clean". (H) [S10]
15. **Biggest unknowns.**
    - Walking speed and dust amount per sector.
    - What happens after the ending.
    - Network transport details.
    - Any 16-player benchmark.
    - HowLongToBeat figures (the site and its mirrors blocked access).

---

## 1. Basics

| Item | Finding | Conf. | Source |
|---|---|---|---|
| Steam App ID / store URL | 5335510 — https://store.steampowered.com/app/5335510/Moon_Sweepers/ | H | [S1][S2] |
| Developer / publisher | DragDrop Games for both roles. The official developer message says the team is **two people**. | H | [S1][S2][S7][S51] |
| Release date / status | Released 23 Oct 2026. It is **not Early Access**: Steam's genre list has no "Early Access" flag and the version numbers are 1.0.x. | H | [S2][S6–S10] |
| Price | $8.99 USD as of 2026-11-11. Search snippets mention a 15% launch-week discount, which we did not verify. | H / L | [S1] |
| Platforms | Windows only, going by Steam's platform flags. Patch 1.0.4 fixed startup on older Proton versions (Steam Deck/Linux), but that support is not official. One press outlet says the developers are not ready to announce consoles. | H | [S2][S8][S51] |
| Engine | **Unity**, probably Unity 6 with IL2CPP. The evidence is listed below this table. | H that it is Unity; M for the version | [S8][S53][S54][S55] |
| Max players | 16 per crew, host included. Solo play is supported. | H | [S1][S2][S44] |
| Steam features | Single-player, Online Co-op, Steam Achievements (33), Steam Cloud, Full controller support (Steam Input), Text-to-speech chat, Family Sharing. | H | [S2] |
| Languages | 19. The store discloses that generative AI helped translate in-game text. | H | [S1] |
| Official web presence | The Steam "website" field points to the Discord invite (discord.gg/5ATRkXkAAe). The store also links TikTok @moon.sweepers, Instagram @moon_sweepers, YouTube @MoonSweepers and X @Moon_Sweepers. There is no dedicated official site. The many "moonsweepers.*" domains are unaffiliated fan or SEO sites. | H | [S1][S2] |
| Reception | Steam rating is "Mostly Positive", about 78% of about 4.4k English reviews at access time. | H | [S1] |
| Commercial signals | **600,000 players in the first week** and a 70k peak (developer, 30 Oct). SteamDB recorded an **83,138 peak on 1 Nov**. The game was #4 in Steam Global Top Sellers for 27 Oct–3 Nov and #8 for 3–10 Nov. | H | [S10][S5] |

**Engine evidence.** We rate this H for "Unity" because three independent lines of evidence agree:
1. The official 1.0.4 patch note gives the backup path as `…\LocalLow\DragDropGames\MoonSweepers\Backups` [S8]. That matches Unity's documented Windows `persistentDataPath` pattern, `%userprofile%\AppData\LocalLow\<companyname>\<productname>` [S55].
2. The same patch note offers a `-force-d3d12` launch option [S8]. That is Unity's player command-line flag; we did not re-check Unity's CLI documentation this session.
3. Community mod projects describe the game as "Unity 6 / IL2CPP", modded with BepInEx 6 [S53]. A second repository, seen only in search results, cites Unity 6000.6 [S54].

**Store description (paraphrased, not copied) [S2].**
- You are part of a crew hired by an underfunded, fictional moon-cleaning agency to remove lunar dust. The budget covers only a toothbrush.
- You gather and sell dust, then reinvest in better tools and more carrying capacity.
- Up to 16 players can split up or work one area together. The text jokes that not everyone will pull their weight.
- You fill storage, bring it to a "depot", and "launch shipments" for pay.
- Terrain visibly cleans as you pass. You can track progress, place depots near work areas, and graduate to cleaning vehicles.

The store copy uses the words *depot* and *shipments*. The in-game manual uses *stations* [S46].

**Roadmap.** The official "600,000" post [S10] describes 1.1 as the first major content update, planned for December 2026. Planned items are new production machines and chains, new materials and products, new tools and equipment upgrades, better automation, more building options, expanded late-game progression, and performance work on big bases. The post adds that more is planned "after the Moon is clean". (H)

---

## 2. Core loop in detail

### 2.1 Collecting dust (tool input, aiming, width)
- **Input.** Holding the primary button (left mouse, or RT on a controller) sweeps with the held tool [S40][S46]. Tools sit in quick slots: 1–6 on the keyboard, or the mouse wheel and bumpers [S40]. (H)
- **Tool geometry.** Each tool has a **width**, a **cleaning depth**, a **reach** and a **stroke time**. Reach is how far ahead of the player it cleans, and stroke time is the duration of one sweep cycle [S17]. Brushes have a **lockable sweep angle**, and players sweep long parallel lanes with the rotation locked [S46][S50]. (M)
- **Aiming.** You aim the tool at the ground within its reach, which the Cleaning-branch upgrades extend [S17][S20]. (M)
- **Dust model.** Dust seems to be a layer with thickness. Tools list a cleaning depth, and one upgrade raises it [S17][S20]. Cleaned ground shows visibly and is synced to everyone; patch 1.0.4 reworked ground sync so robot trails and manual cleaning match across the crew [S2][S8]. The exact dust-depth model is **not documented** (L). Fan sites claim crater floors hold thicker dust, but that is unverified (L) [S57].
- **Region scan.** Pressing G runs a region scan. It shows the sector you stand in, its number, its edges and its cleanliness percentage [S36][S40]. (M)

### 2.2 Container fill behavior
- Each hand tool has its own dust container. **A full container stops pickup** [S46]. (M–H)
- When the container is full, the player has three options [S28][S46]:
  1. Walk to a station and deposit.
  2. **Pack the dust into a 1-kg capsule**, then set it down, drop it (Q), carry it or throw it.
  3. Empty a capsule back into the tool later, by aiming at it.
- Upgrades extend capsule pickup reach and throw distance [S20][S28]. (M)
- The **Auto-Packer** capstone makes a full container automatically pack a capsule at your feet, so you keep sweeping without interruption [S19][S20]. (M)
- Vehicles have their own hopper plus 1–6 capsule slots [S22]. (M)

### 2.3 Delivery (stations, "depots")
- There are 4 stations: North (the starting station), East, West and South [S27][S38][S46]. (M–H)
- **Manual deposit.** Hold the interact key at a station's deposit intake and the tray fills from your tool. Pressing the tray button sells the contents by weight [S27]. Two Logistics upgrades shorten deposit time, by up to about −58% and a further −50% [S20][S27]. (M)
- **Belt delivery.** Capsules arriving on belts at a station's belt intakes are sold as they arrive. Since patch 1.0.3 they are paid on arrival [S6][S27]. (H)
- **Launching.** Stations "launch" what they hold, which fits the store's "launch shipments" wording. Two achievements count station launches [S2][S3][S43]. The exact launch trigger is not documented (L).
- **The Collector.** This is the building with the **supply wall** (the shop for tools and suit gear), the launcher and belt intakes. Each station has an **upgrade hologram** where matrix upgrades are bought [S27][S46]. It is unclear whether every station has a full Collector shop (L).
- **"Placing depots."** The store says you can place depots near work areas [S2]. The partial build-menu listing we saw has no item called "depot". The likely equivalents are belt-fed infrastructure and capsule catchers (L) [S32].

### 2.4 Payment
All of the following are (M) from [S25][S26][S36][S47][S48].
- **Base rate.** 1 currency unit per kg of dust.
- **Material multipliers.** Sand pays 3× and stone pays 7× per kg.
- **Crew payout multiplier.** It starts at 1.0. The Economy branch raises it to a maximum of 1.28×, in +6% steps plus a +10% capstone.
- **Flat bonuses.**
  - Each completed sector pays a small fixed bonus. The Region Bounty upgrade raises it to up to 4× base, but **only for sectors credited to an individual player**. Sectors credited to the whole crew pay only the base.
  - Each of the 195 flags pays a one-off reward when untangled. The amount is disputed; see Contradictions.
  - Each of the 26 lunar sites pays a one-off reward when surveyed, about 2.5× the wiki's flag value.
  - Vehicle-trick landings pay a small amount, with a per-landing cap. Payout upgrades do not raise the cap.
- **Price discount.** The Supplier Network upgrade gives −5% or −10% on tools and container upgrades only.

### 2.5 Currency
The currency is **dollars ($)**, held in a single **shared crew wallet** that starts at 0 [S26][S44]. (M–H)

### 2.6 Loop summary
1. Sweep.
2. The container fills.
3. Either walk to a station and sell at the tray, or pack capsules.
4. Capsules go onto belts and into station intakes, where they sell automatically.
5. The station launches.
6. Money lands in the shared wallet and is reinvested.

Later in the game, vehicles replace walking, robots replace sweeping, and production machines multiply the value of each kg.

---

## 3. Progression layers

### 3a. Handheld cleaning tools
- **Count.** There are 6 cleaning tools. The free starter is a toothbrush, and the top tool is a very wide broom. A separate **building tool** has no container [S16][S18]. (M–H)
- **Where and who.** Tools are bought at the supply wall, and **each player buys their own** [S17][S44]. (M)
- **Curves.** These are (M), derived from [S16].

  | Step | Price multiplier vs previous | Width gain | Base container gain |
  |---|---|---|---|
  | T1 → T2 | free → paid | +58% | ×1.5 |
  | T2 → T3 | ×2 | +32% | ×1.33 |
  | T3 → T4 | ×2.5 | +76% | ×3 |
  | T4 → T5 | ×3 | +50% | ×2 |
  | T5 → T6 | ×2 | +50% | ×2 |
  | **T1 → T6 overall** | — | **×8.25** (from about a toothbrush width to about 1 m) | **×24** |

- **Design note.** Container capacity grows faster than width (24× against 8.25×). So later tools mainly cut trips, not just sweep time. The entire tool set costs only about **1.5% of the full upgrade matrix**, which makes it a first-hour layer (derived).
- **Other per-tool stats.** The top broom also has a cleaning depth, a reach of several meters and a stroke cycle of about 1 s [S17]. Width, depth and reach are raised globally by the Cleaning branch (see 3g). (M)
- **Prerequisites.** The wiki lists none beyond money [S16][S17]. Game Rant mentions a "prerequisite broom upgrade" before the wide broom [S50]. This is unresolved (L).

### 3b. Containers ("backpacks")
- **Structure.** There is no separate backpack. Capacity lives in **each tool's container**, with 3 upgrade levels per tool [S19]. (M)
- **Curve.** Levels I, II and III give ×2, ×4 and ×8 of the tool's base capacity. Each level costs 2× the previous level, which means **the cost per added kg is flat across levels** (derived). Level I costs about 0.8–1.6× the tool's own price, and for the two largest brooms it is about 0.8×. The full 3-level path costs about 7× the Level I price [S19]. (M)
- **Global multipliers.** The Dust Compactor has 3 levels and reaches +45% capacity on every tool. The Auto-Packer has 1 level and adds auto-capsuling. Together they cost about 2.3× all six per-tool container lines combined (derived from [S20]). (M)
- **Ownership.** Container levels are bought **once for the whole crew** [S26][S44]. (M)

### 3c. Vehicles
- **Line-up.** There are 5 vehicles: 4 cleaners and 1 crew transport.
  - The smallest cleaner is a **walk-behind** sweeper. Its garage text says to walk behind it, although it uses driving controls [S23].
  - The transport has **8 seats**, carries capsules and does no cleaning.
  - The cleaners have 1 seat, or none for the walk-behind sweeper.

  [S22][S23] (M)
- **Ratios.** These are (M), derived from [S22]. The cheapest cleaner is set to 1 for every column.

  | Vehicle tier | Price | Width | Hopper | Cruise speed | Theoretical area rate (width×speed) | Capsule slots |
  |---|---|---|---|---|---|---|
  | Walk-behind sweeper | 1 | 1 | 1 | 1 | 1 | 1 |
  | Ride-on sweeper | 3.3 | 1.47 | 5 | 2.6 | 3.8 | 2 |
  | Crew transport (8 seats, no cleaning) | 6.7 | — | — | 2.5 | — | 4 |
  | Large lunar sweeper | 8.3 | 2.07 | 12 | 2.3 | 4.8 | 4 |
  | Mega vacuum rover | 20 | 2.74 | 30 | 1.8 | 4.9 | 6 |

  **Bigger vehicles are slower.** The top two cleaners have almost the same area rate; the most expensive one mainly buys a 2.5× larger hopper. Boost is about 1.35× cruise speed at base [S22]. (M)
- **Buying and ownership.**
  - You must first build a **garage**, a build-menu piece, so the building tool is required [S22][S32][S46].
  - Vehicles are bought with crew money, but each one is **owned by the player who bought it** [S44].
  - Since patch 1.0.3, any garage can recall, store or upgrade any vehicle. A garage brings out one vehicle at a time. Demolishing a garage relocates its vehicles rather than deleting them [S6][S22]. (H)
- **Unloading.** Stopping on a garage's collector pad dumps the hopper into the garage **silo**, a multi-ton buffer that unloads very fast. The silo then outputs 1-kg capsules onto an outfeed belt. Since patch 1.0.5, the garage explains when it can't output, for example when no conveyor is attached [S9][S22]. Vehicles therefore depend on the belt layer for efficient selling. (H/M)
- **Vehicle upgrades.** These are bought at the garage, per vehicle, by the owner only, with crew money [S24][S44][S46]. (M)
  - There are **7 lines with 16 levels in total**: speed and pull (3 levels), hopper +30/60/90% (3), boost to 150%/165% of cruise (2), cruise control (1), suction width +25/50/75% (3), unload speed (2), and floodlights (2).
  - The transport takes only 4 of the 7 lines.
  - Cost curve: Level 2 costs about 2.25–3× Level 1, and Level 3 costs about 5–6× Level 1.
  - **Maxing a vehicle costs about 18× its price for the smallest, about 10.6× for mid-tier vehicles, and about 5.3× for the largest.** Upgrade cost therefore rises more slowly than vehicle price (derived).
  - **The suction upgrade is a trade-off, not a throughput gain.** Width rises +25/50/75%, but speed drops to 0.85/0.72/0.6×, so the net area rate stays around 1.05× (derived from [S23]).
- **Driving model.** (M–L) [S22][S25][S39][S40][S53]
  - Controls are arcade-style: throttle, brake/reverse, steer, boost, cruise control, a suction wheel, lights, and loading/unloading capsules (T).
  - There is an optional "camera follows behind" setting.
  - Mid-air **tricks** (flips, barrel rolls, spins, BIG and HUGE AIR) pay a small capped bonus, with a combo multiplier and a wipeout rule. Air time of 3–6 s is common enough to earn named bonuses, which implies **low gravity**.
  - A moving vehicle at ≥1.2 m/s knocks crewmates flying.
  - A mod author reports vehicles only drive straight under autopilot (mod-added), which is not relevant to vanilla.

### 3d. Helper robots
| Tier | Price vs basic | Work area | Width vs basic | Bin vs basic | Delivery |
|---|---|---|---|---|---|
| Robot vacuum Mk I | 1 | **19 hexes (2 rings) around its dock** | 1 | 1 | Returns to its dock at 98% bin. The dock packs 1-kg capsules **onto a belt**. |
| Robot vacuum Mk II | 2 | 37 hexes (3 rings) | 1.85 | 2.7 | The same, with a dock store about 3× larger |
| Global robot ("J.O.O.N.A.S.") | **80** | **The entire moon** | 4.3 | 4 | Fires 20-kg capsules at capsule-catcher buildings |

Sources for the table: [S33][S34][S35]. (M)

- **Assignment.**
  - Local robots are assigned only by **where you place the dock**.
  - The global robot automatically picks the **nearest still-dusty sector**. It cleans hex by hex from the outside in, skips unreachable hexes and has no travel overhead between sectors.
  - There is no manual sector assignment.
  - Robot panels show a robot's state, and docks can be switched off. Since patch 1.0.4 every robot appears on the moon map with its current activity, with a toggle per robot type.

  [S8][S33][S34][S46] (M–H)
- **Throughput.** The global robot clears an untouched sector in about 54–74 s (about 70 s on average), which is about **51 sectors per hour** [S34]. Derived: a full moon needs about 3,200 robot-hours, so 100 robots take about 32 h and 400 robots take about 8 h. The wiki gives the same 8-hour estimate [S34]. Local robots, by our estimate, finish their whole patch in roughly 1–1.5 h (derived, excluding unload trips) and then go idle with an "All clean" state [S33]. (M)
- **Deposit behavior.** (H for the patch-noted rules) [S9][S33][S34]
  - Local docks need a belt. With no belt, the dock fills and the robot waits.
  - Global robots target the emptiest catcher in the nearest catcher group, where a group is catchers within 100 m of each other. They move on once a group is more than 80% full. With no catcher at all, they wait with a full bin.
  - A catcher holds about 5 global-robot capsules, or outputs 1-kg capsules onto a belt.
- **Patch history.** Before patch 1.0.4, the global robot needed docking trips and **stopped when no player was nearby**. Patch 1.0.4 made it about 2× faster, removed the docking trips and let it work unattended [S7][S8]. (H)
- **Limits and upkeep.** We found **no documented count cap and no power or upkeep cost** (L). Practical limits are performance, since reviewers report lag with hundreds of robots [S13], and a world cap of 90,000 loose capsules, raised from 10,000 in patch 1.0.5 [S9].
- **Value insight (derived).** Per unit of cost, the local Mk II is the most efficient robot, with about 2.5× the Mk I's area rate for 2× the price. The global robot costs 80× the basic one for only about 4× its sweep rate. What it buys is **unlimited range and autonomy**, not efficiency. A human-driven mid-tier sweeper has about 3× the global robot's area rate at about 1/20 of its price. Robots trade money for parallelism without people, which is why solo players need large fleets.

### 3e. Conveyors, packager and automation chains
All of these are build-menu pieces that require the building tool.
- **Belts.** Belts are cheap per meter. They move capsules at about 1.1 m/s, spaced 0.75 m apart, which is about 88 capsules per minute. Machines output faster than one belt can carry (about 171 units per minute), so **the belt is the bottleneck** [S29][S30]. Splitters and mergers are almost free; mergers alternate inputs since patch 1.0.4, and any crewmate can attach them to anyone's belts [S8][S30]. (M–H)
- **Packager.** It takes dust from your held tool's container into a 100-kg hopper and outputs 1-kg capsules onto a belt [S26][S31]. This is the first automation step. **Manual tray deposits become unnecessary**: you dump at a packager near your work area and the belt carries the dust to a station. (M)
- **Sources that feed belts** [S27]:
  - the packager (player dust)
  - local robot docks
  - the garage silo (vehicle dust)
  - capsule catchers (global-robot dust)
  - production machines
- **Production chain** [S29][S30]:
  - The **pressure chamber** turns dust into sand. Sand is worth 3× dust.
  - The **stone press** combines 1 part dust with 1 part sand into stone blocks, worth 7× dust per kg. Overall, about 2 kg of dust becomes 2 kg of stone worth 7×.
  - The stated ratio is **1 chamber to 2.5 presses**.
  - The press costs about 2× the chamber and draws about 1.8× its power.
  - Production machines need power, and stop below 8% of their required supply.
- **Power.** (M) [S29][S30][S41][S50]
  - Three solar sizes cost in the ratio 1 : 2 : 4 and give 1 : 2.5 : 5.3 peak output.
  - The two larger sizes include batteries, and the largest tracks the sun.
  - Power reaches machines wirelessly within a radius around each panel.
  - Batteries charge from surplus at 92% efficiency and carry machines through the night.
  - Game Rant suggests 2 large panels per chamber and 3 per press.
- **What becomes automatic.** Selling, once belts lead into station intakes. Container emptying, once you have the Auto-Packer. Cleaning, once you have robots. Value-add, once production is running. Patch 1.0.5 notes and community guides center on **fixing clogged belts** and keeping intakes balanced, which is the main late-game skill [S9][S11][S14]. (M)

### 3f. Buildings
- **Size of the menu.** There are about **98 build-menu pieces** in tabs for Services, Logistics, Production, Power and Structures. The structure pieces include 39 foundations, 20 catwalks, railings, and walls, window walls and sliding-door walls in full, half and third heights. There are 5 cosmetic surface styles, which don't affect price [S32]. (M)
- **Services pieces.** Garage, robot docks, the global robot and the capsule catcher [S32]. Their relative cost order is: packager < garage < Mk I < chamber = Mk II < press < catcher ≪ global robot. (M)
- **Rules since patch 1.0.5** [S9]:
  - You can build on dusty ground, which is flattened as you build.
  - Pieces snap on, under or beside foundations, and can extend over edges.
  - A free **move mode** carries everything attached to the piece.
  - **Removal refunds 100%**, up from 75% before.
  - Pieces snap to a grid or to foundation edges. Hex foundations rotate in 30° steps.

  (H)
- **Pre-built station amenities.** Stations come with a coffee machine, chess, air hockey, bunks, a per-station whiteboard, lockers (for the astronaut cosmetic editor) and a crew radio. These are social and flavor features with no economy effect [S39][S49]. (M)
- **Gate.** All building requires the **building tool**, which costs about one-third of the top hand tool [S16][S18]. (M)

### 3g. Upgrade tree ("upgrade matrix")
- **Shape.** The tree has **23 upgrades in 5 branches** around a hub node that is owned from the start [S20]. Each branch follows the same pattern:
  - a **3-level root** at tier 2;
  - 1–2 **2-level secondary nodes** that need the root at Level I;
  - one **single-level capstone** that needs the root maxed plus the secondary nodes, fully or partly depending on the branch.

  The tree is crew-shared since patch 1.0.3 and bought at station holograms [S6][S46]. (M–H)

| Branch | Nodes | Share of total matrix cost | What it improves (top-level effect sizes) | Capstone |
|---|---|---|---|---|
| Containers | 8 (6 per-tool containers, compactor, auto-packer) | about 30% | Per-tool ×8 capacity; +45% on all tools | Auto-pack full containers into capsules |
| Cleaning | 4 | about 15% | +24% width, +24% depth, about +1.5 m reach | +10% width and depth, +0.5 m reach |
| Suit | 3 | about 12% | +21% move speed; +40% jump | +8% speed, +15% jump |
| Logistics | 4 | about 11% | −58% deposit time; +3 m capsule reach; +50% throw | A further −50% deposit time |
| Economy | 4 | about 32% | +18% payout; −10% tool and container prices; higher sector bounty | +10% payout |

Table sources: [S20][S26]. (M)

- **Level-cost curve.** Each level costs about **×2–3.3** the previous one. Examples: the Economy root goes ×3.3 then ×2.75; secondary nodes go about ×2–3 [S26][S28]. (M)
- **Capstone pattern.** Capstones cost about 0.6–1.2× the rest of their branch combined, but mostly add **small +8–10% bonuses**. The exceptions are qualitative: auto-packing, and halving deposit time again [S20]. (M)
- **Scale.** **The entire matrix costs about 0.9× one global robot** (derived). This is the root of the pacing cliff described in section 7.

### 3h. Suit gear
- **Five lines, 14 levels in total**, bought at the supply wall one level at a time and **shared by the crew** [S21]. (M)
  - **Tool belt** (5 levels): quick slots rise from 2 to 6.
  - **Forward jetpack** (3 levels): boosts per jump rise from 2 to 4. You activate it by jumping again in mid-air.
  - **Gravity boots** (1 level): toggle Earth gravity on and off with B. This implies the default is low lunar gravity.
  - **Helmet lamp** (4 levels): beam range rises about 2.7× in total, and later levels remove flicker.
  - **Night-vision goggles** (1 level, added in patch 1.0.4): the N key cycles lamp, goggles and off. Nights then look like day without shadows.

  Sources: [S8][S21][S40]
- **Price curve.** Each level costs about **×2.4–4** the previous one, flattening toward ×2.5 at higher levels. All suit gear together costs about 0.44× the upgrade matrix (derived from [S21]). (M)
- **Oxygen and energy.** We found **no oxygen, energy or survival meter** (M by absence). The patch 1.0.4 HUD note lists only lamp/goggles, jetpack and boots icons next to the dust gauge [S8], and no wiki page mentions survival stats. Oxygen exists only as a lore joke, an automatic "breathing plan" in the employment contract [S45].

### 3i. Teleports, waypoints, map and HUD
- **Moon map.**
  - Sectors are color-coded: **orange for untouched, blue for started, green for done** [S46].
  - Since patch 1.0.4, right-clicking on the map sets a waypoint, focuses the view or teleports. Robots appear with their activity [S8].
  - Points of interest (flags and lunar sites) are tracked once found [S46].

  (M–H)
- **Teleporting.** You can teleport only to stations the crew has **visited at least once**. Each teleport charges a small flat fee to the crew wallet and can't be used from inside a vehicle. Patch 1.0.4 added a dedicated teleport panel [S8][S38]. (M–H)
- **Waypoints.** Up to **12, shared by the crew**. Each shows as a tall light beam, 150 m high [S38]. (M)
- **HUD.** (M–H) [S6][S8][S27][S36][S40][S44][S50]
  - A compass marks stations; patch 1.0.3 gave them distinct colored icons.
  - A dust gauge is shown along with the suit icons.
  - The region scan shows the current sector.
  - A scoreboard opens with Tab.
  - A field manual opens with H.
  - A "back to base" hold action exists; we did not verify its cost or rules.
  - A directional indicator points the way home.

### 3j. Synthesized unlock order
This is our synthesis (M), built from the cost ratios, achievement rates [S4] and guides [S12][S50].

1. **Start.** Toothbrush, an empty wallet and the North station with its shop and upgrade hologram. The matrix hub is already owned.
2. **Minutes in.** Next hand tools and the first container levels. One-off **flag and lunar-site rewards** are a large early boost; Game Rant recommends spending the first 30–60 minutes exploring for them [S50].
3. **About the first hour.** Wider brooms, container levels, the first matrix roots and cheap suit gear such as the tool belt and lamp.
4. **The building tool.** This opens every later layer. The usual next steps are a packager and belt to a station, then a garage and the walk-behind sweeper or ride-on sweeper.
5. **Hours 1–3.** Larger vehicles and their upgrades, local robots with belts, the first production machines with solar, and the matrix capstones.
6. **About 4–8 h.** The first global robot and capsule catchers. **Personal upgrades are exhausted around here.**
7. **8 h and beyond.** Scale the robot fleet and catcher network, expand production for value, and fix belt throughput. Completion goes from about 1% to 100%.

---

## 4. World structure

- **Sector count: 163,842 is confirmed.** (M–H) [S36][S46][S15]
  - The wiki's transcription of the in-game Field Manual says the moon is split into hexagonal sectors, 163,842 in total. The wiki calls them "regions"; the game says "sectors".
  - Derived: **163,842 = 10·4⁷ + 2**, which is the cell count of a **Goldberg/geodesic hex sphere** built from an icosahedron subdivided 7 times. That is 12 pentagons plus 163,830 hexagons.
  - One fan site reportedly shows an in-game total of 163,830, exactly the hexagon-only count. We could not load that page because of a TLS error, so this is L [S57].
  - Other counts we saw ("163,000" and "186,000+") come from forum posts and reviews and are imprecise [S12][S13].
- **Completion thresholds.** (M–H) [S9][S36][S42]
  - A sector counts as **"started" once 0.1% of its dust has been cleaned**.
  - It is **done and paid at ≤1% of its starting dust remaining**.
  - Sectors with no dust are skipped. They pay nothing but still count toward the ending.
  - Patch 1.0.5 fixed sectors stuck at 99.9%, and sectors showing 0% that had no dust left.
- **Credit.** A sector is credited either to a player, which earns them the bounty upgrade, or to the whole crew, which pays the base only [S36]. (M)
- **Scale.** The wiki's key stats give a moon **radius of 2,000 m** and a **surface area of about 50.3 km²** [S37]. Derived from those:
  - an equatorial circumference of about **12.6 km**;
  - a mean sector area of about **300 m²**, roughly a hexagon 19 m across;
  - a horizon only about 85 m away at standing eye height, so the curvature is very visible.

  Cross-check: 300 m² at the global robot's documented clean rate gives about 70 s per sector, which matches the wiki's separate figure [S34]. (M)
- **Travel.** (derived; M for driving, L for walking)
  - The 4 stations sit at the two poles and at 0° latitude on 90°E and 90°W [S38]. Neighboring stations are therefore about 3.1 km apart along a great circle.
  - With a ride-on sweeper at cruise speed: about **7 min between neighboring stations** and about **29 min for a full equatorial lap**.
  - With the slowest large rover: about 42 min per lap.
  - Walking times **could not be computed**, because walking speed is not documented.
  - Teleporting between visited stations removes most long trips [S38].
- **Points of interest.** (M) [S37][S46][S47][S48]
  - **195 flags**, one per real country, which can be untangled and raised.
  - **26 lunar sites** at the locations of real missions: 13 landers, 5 rovers, 4 impact sites and 4 crash sites from 7 nations, spanning 1959–2025. Each can be surveyed.
  - **4 stations.**
  - Both flags and sites pay one-off rewards.
- **Terrain and hazards.** Reliable sources do not document terrain types. The low-reliability fan sites describe craters, ridges and plains, and say the jetpack helps over crater rims [S57]. The official hints are the "Physics", "Driving" and "Open World" tags, ramps in patch notes, and the low gravity implied by gravity boots and long trick air time [S1][S6][S21][S25]. **No damage or survival hazards were found.** The known risks are darkness at night, being knocked over by vehicles, and since-fixed bugs where players fell through the moon [S8][S39]. (L)
- **Lore beats.** (M) [S2][S42][S45][S46]
  - The tone is satirical corporate humor. A fictional, underfunded lunar agency "hires" you on an absurd employment agreement: the job ends only when the moon is clean, resignation needs decades of notice, and breathing is an opt-out benefit plan.
  - The story is told through 3 intro slides, the agreement, a 9-chapter Field Manual and diary notes from a fictional new hire.
  - There are no named characters.
  - The ending is a 25.4-second sequence when the moon is complete.

---

## 5. Day/night, end condition, achievements

- **Day/night.** (M) [S41][S44][S8]
  - The cycle lasts **60 real minutes**: 30 minutes of sun and 30 of darkness at every location, because the sun moves along a great circle.
  - Solar panels run at full output in daylight and fade across the terminator.
  - Bunks **do not skip** the night.
  - The crew follows the host's clock.
  - Night pushes players toward lamp and night-vision upgrades, and toward batteries for production.
- **End condition.** (M) [S42][S43][S10]
  - When every sector is done (≤1% dust, or empty), a **25.4-second ending** plays.
  - We could not find what happens afterwards: continued play, credits or new game+. This is **not verified**.
  - The "100%" achievement counts only sectors that hold dust.
  - The developer says more content is planned for after the moon is clean, starting with v1.1.
- **Achievements.** There are **33**, one of them hidden. These are global unlock rates from Steam's official API on 2026-11-11 [S3][S4], with categories from [S43]. (H for rates; M for the API-name-to-title mapping of the 7 achievements missing from the HTML page)

| Category | Achievements (name: global %) |
|---|---|
| First steps | One Small Sweep 99.9 · Get A Better Brush 98.3 · Return to Sender 98.0 · Dust Delivery 97.8 · That's Going to Take a While 96.5 |
| Dust collected by tool or vehicle | Dust Bunny (10 kg) 98.1 · Pocket Full of Moon (100 kg) 93.3 · A Literal Ton of Dust (1 t) 82.4 · Moon Dust Removal Specialist (10 t) 57.3 |
| Sectors cleaned | (1) 96.5 · Making a Dent (10) 90.2 · A Good Start (100) 75.7 · Patchwork Moon (1,000) 43.5 · Hex Appeal (10,000) 19.8 |
| Launches | Return to Sender (1) 98.0 · Frequent Flyer Dust (10) 90.0 |
| Systems firsts | Let the Belt Do It 89.1 · Moon Improvement Project (first build) 83.1 · Finally, Wheels (first vehicle cleaning) 81.3 · It'll Get There Eventually (hidden; a capsule loops back onto a belt) 36.4 |
| Money earned | 1k 81.2 · 10k 58.7 · 100k 36.3 · 1M 20.4 |
| Money spent | 10k 69.0 · 100k 45.1 · 1M 22.2 |
| Manual deliveries | 1: 97.8 · 100: 53.8 · 1,000: 3.3 · 10,000: 1.7 |
| Moon cleaned | You Missed a Spot (1%) 39.5 · Visible From Space (10%) 18.5 · Half Way There (50%) 9.2 · Time To Go Sleep... (100%) 5.6 |
| Social | OH You Have Friends? (crew of 2 or more) 55.8 |

**Pacing reads from the achievement data.** These are (M) interpretations.
- **Order-of-magnitude retention.** Money-earned tiers keep about 72%, then 62%, then 56% of the previous tier. Sector tiers drop from 75.7% at 100 sectors to 43.5% at 1,000 and 19.8% at 10,000.
- **Where players drop off.** Moon-cleaned retention is about 47% from 1% to 10%, about 50% from 10% to 50%, and about **61% from 50% to 100%**. The biggest losses happen during the slow fleet-building phase. Once a fleet snowballs, most players finish.
- **Manual delivery dies.** 53.8% reach 100 hand deliveries, but only 3.3% reach 1,000, because belts take over. Those deposit achievements are now grind trophies, and Steam guides exist just for them [S11].
- **Spending exceeds earning.** Spend tiers beat the matching earn tiers (10k spent: 69.0% against 10k earned: 58.7%). That suggests earnings are credited per player while crew spending counts for everyone (L).
- **Belt before building.** "Let the Belt Do It" (89.1%) is above the first-build achievement (83.1%). Stations may come with pre-built belts, so the belt achievement is **not** a clean signal for automation (L).
- **Rising completion.** The 100%-moon rate was listed at 0.1% on a guide page last updated 24 Oct [S56] and is 5.6% on 11 Nov [S4]. It rose sharply after the patch 1.0.4 robot buff.

---

## 6. Co-op

All of the following come from [S6][S8][S9][S44].

- **Crew size.** 1–16 players, host included. **(H)**
- **Lobby types.** Friends only, Public or Invite only. Public games appear in an in-game "Join game" list. Patch 1.0.5 added a warning that strangers can change your moon. **(M–H)**
- **Networking.**
  - Crews run **through Steam**; without Steam running, the game is solo-only.
  - Everyone plays on the **host's moon, stored in the host's save slot**.
  - **If the host leaves, the session ends for everyone.**
  - Crewmates must run the same game version.

  This points to a host-authoritative model using Steam networking with no dedicated servers (M). The transport details (P2P or relay) are **not documented** (L).
- **Save ownership.** The host owns the save. Each slot keeps 5 automatic local backups outside Steam Cloud, and patches 1.0.3 and 1.0.4 added self-repair on load. **(H)**
- **Shared across the crew.** The **wallet** (starting at 0), the **upgrade matrix, container levels and suit gear** (shared since patch 1.0.3, before which they were per-player), the 12 **waypoints**, teleport fees and the time of day. **(H/M)**
- **Per player.**
  - **Tools**, bought by each player.
  - **Vehicles**, bought with crew money but owned individually, so only the owner can upgrade them.
  - **Sector bounty credit.**

  **(M)**
- **Scaling with player count.** We found **no evidence** that costs or rewards scale with crew size. In effect a bigger crew costs more, because every player buys their own tools and vehicles. The only per-crew-size figure the wiki gives is the savings from the discount upgrade [S26]. **(M on the absence of scaling)**
- **Join-in-progress.** Friends can be invited from the **pause menu** through the Steam overlay, and public games are listed. That strongly implies drop-in to running sessions, but no source states it outright. **(L–M)**
- **Moderation.** The host can kick, ban (up to 360 kept per save) and unban. There is 120-character text chat with optional text-to-speech voice, and a scoreboard. **(M–H)**
- **Emergent division of labor.**
  - The store copy jokes about uneven effort [S2].
  - A since-removed community guide proposes roles: cleaner, builder, machine engineer, logistics and robots [S14] (L).
  - Reviews describe co-op "speedruns" to 100% with hundreds of robots, and note that co-op is most fun in the first hours [S13] (L).
  - Vehicles knock crewmates over, and the stations offer social side activities [S39].

---

## 7. Pacing benchmarks (most important)

Here, "**Pre-1.0.4**" means before 25 Oct 2026, when the global robot was slower and stopped with no player nearby. Reports from that period overstate late-game time. No HowLongToBeat page could be loaded: the direct site and its mirrors (gg.deals, IsThereAnyDeal) returned errors. Search snippets attribute about 35 h "main" to HowLongToBeat, but we did **not verify** that.

| Milestone | Evidence | Estimate | Conf. |
|---|---|---|---|
| First sweep, first sale, first sector | 96.5–99.9% of players [S4] | ~5–15 min | M |
| First tool upgrade | 98.3% of players [S4]. The cheapest upgrade costs about 10 starter-container loads, or a fraction of one flag reward (derived from [S16][S26]). | **~5–20 min**, sooner if a flag is found | L–M |
| First container upgrade | The cheapest level costs the same as the first tool upgrade [S19] | ~5–20 min | L |
| All hand tools plus main container levels | The tool set costs about 1.5% of the matrix (derived) | within ~1 h | L |
| First building | 83.1% of players [S4]. Requires the building tool [S18]. | **~0.5–2 h** | L |
| First vehicle | 81.3% of players, about the same group as the 1k-earned tier at 81.2% [S4]. The minimum path (building tool, garage, smallest vehicle) costs about 2× the whole hand-tool set (derived). One reviewer said the "first 1–2 h" are the upgrade-rich phase [S13]. | **~1–2 h** | L–M |
| First conveyor or packager | Has no clean signal; see the belt-achievement caveat. The packager is cheaper than a garage [S32]. | ~1–2 h | L |
| First local robot | Has no achievement. It is cheap but needs a belt to a station [S33]. | ~1–3 h | L |
| First production machine | Has no achievement. It costs about 5× the packager plus solar [S30]. | ~2–5 h | L |
| **All upgrades (matrix and suit gear)** | "About 6–8 h solo if efficient, exploring for flags and sites" (forum [S12]; Gaming Deputy [S52]). "Fun for ~6 h, then a waiting game" [S13]. "Had all upgrades at about 0.6% of the moon" [S13]. PlayGround.ru says the tree runs out long before 1% is clean [S5]. | **5–8 h solo** | M |
| First global robot | Costs about 0.9× the whole matrix. 58.7% of players have earned 10k and 45.1% have spent 100k [S4]. A review describes "hours 1–5" of modest progress, then the global robot [S13]. | **~4–8 h** | L |
| 1% of the moon | 39.5% of players [S4]. Pre-1.0.4 reports: 7 h gave 0.35%; 11 h with 3 then 2 players and about 20 global robots gave 1.09%; 18 h solo was still under 1%; 26 h gave 1.6% [S12][S13]. | **~8–20 h** pre-1.0.4; likely less now | L |
| 100%, solo | About 35–40 h after patch 1.0.4. One solo player was at 70% after 27.5 h [S52]. Pre-1.0.4 extrapolations ran to about 600 h or more [S12]. | **~35–40 h** | L–M |
| 100%, duo | About 31 h with about 100 global robots, with the game closed between sessions [S52] | **~30 h** | L |
| 100%, 2–4 players | About 29 h with about 700 robots by the end [S52]. One co-op group (Oct 27) was at 18% after 38 h with about 300 robots [S13]. | **~25–40 h** | L |
| 100%, 16 players | **No data found.** Late game is limited by fleet size, which money and performance cap, more than by player count. A large crew mainly speeds up the first 1–8 h and multiplies per-player tool and vehicle costs. | Unknown | — |

**Theoretical floor (derived).** A full moon needs about 3,200 robot-hours. The wiki estimates 400 global robots would finish in about 8 h of runtime [S34]. Real clears take much longer because of the fleet ramp-up, catcher logistics and performance limits [S13].

**Implication.** In the reference game, roughly the **first 15–20% of playtime holds 100% of the unlocks**. The other 80% or more is spent scaling one system. Players' main complaint is "no content after the robot" [S13].

---

## 8. REFERENCE PROPER NOUNS — DO NOT USE IN OUR GAME

Retired naming restriction removed. Common descriptive terms are allowed; use the editable naming catalog and REFERENCE_TARGET.
Do not ship copied distinctive branding or extracted assets. This research is evidence, not a name ban list.


## Contradictions & uncertainty

1. **Agency name.** The Steam store's description and legal notice say "Lunar Surface **Department** (LSD)" [S2]. The wiki's transcription of in-game text says "Lunar Surface **Division**" [S45][S46]. The game probably uses both: one in store copy and one in-game. **Avoid both.** (M)
2. **Flag reward.** The data-mined wiki says $100 per flag [S48]. Game Rant says $200 [S50]. The Field Manual mentions both "untangle" and "raise" [S46], so each action might pay separately. This is unresolved. We lean toward the wiki for the per-action value (L–M).
3. **Sector count.** We trust 163,842 [S36][S46]: it comes from the transcribed in-game Field Manual and is mathematically consistent with a geodesic hex grid. Other figures are 163,830 (a fan site we couldn't load; possibly the hexagons excluding the 12 pentagons) [S57], "163,000" from the forum [S12] and "186,000+" from a review [S13].
4. **Peak players.** 62k (IXBT, 27 Oct) [S51], 70k (developer, 30 Oct) [S10] and 83,138 (SteamDB, 1 Nov) [S5] were taken on different dates. They are not contradictory.
5. **Shared or personal upgrades.** The in-game manual text still says upgrades are personal. Official patch 1.0.3 made them crew-shared [S6][S44][S46]. **Trust the patch notes (H).**
6. **Global robot speed.** A forum post estimated about 5 min per sector before patch 1.0.4 [S12]. The wiki gives about 70 s afterwards [S34]. The official 1.0.4 note says about 2× faster with no docking trips [S8]. That covers part of the gap. Trust the wiki for current values (M).
7. **Full-clear time.** Early estimates ran to hundreds of hours, or even years [S12]. Post-1.0.4 reports are about 29–40 h [S52]. The difference depends on the patch; use the post-1.0.4 figures.
8. **Matrix prerequisites.** The wiki's tree graphic and its table disagree on whether Dust Compactor needs one container upgrade or all six, and on which Dust Compactor level Auto-Packer needs [S20]. (L)
9. **Payment for catcher dust with no belt.** One wiki page says it's paid "immediately" [S26]; another says "with the next launch" [S27]. This is minor.
10. **The walk-behind sweeper** is described both as pushed on foot and as driven with standard controls [S23].
11. **Achievement oddities.** The belt achievement is more common than the first-build achievement, and spending tiers are more common than earning tiers [S4]. This is probably about how credit is attributed, not about pacing. See section 5.
12. **Tool prerequisites.** The wiki lists none [S16]. Game Rant implies a broom prerequisite before the wide broom [S50]. (L)
13. **HowLongToBeat.** We could not verify it (blocked). Search snippets claim about 35 h "main" (L).
14. **Low-quality sources.** Several "moonsweepers.*" fan sites contain fabricated-looking details, such as 12 outpost stations and named sectors like "Delta-9". **We disregarded them** [S57]. A detailed Steam "expert guide" has been **removed by Steam**, so we treated it as L [S14].
15. **"Placing depots" in the store copy** has no matching item in the build-menu entries we could see. It probably refers to belt-fed infrastructure or catchers (L) [S2][S32].
16. **Unknowns:**
    - Walking and sprint speed.
    - Dust mass per sector, and whether density varies, for example in craters.
    - Terrain types and hazards.
    - What happens after the ending.
    - Join-in-progress, which is implied but not stated.
    - Network transport.
    - Robot count limits and upkeep.
    - Per-level costs for most matrix nodes; only totals are published.
    - The Steam review playtime distribution (the review API call did not return data).

---

## Implications for our game

These are design takeaways only. We use original names and set our own numbers.

1. **Keep the arc, fix the cliff.** The core fantasy works: "toothbrush to robot fleet", seen through 5 layers (hand tools → carrying → vehicles → logistics → robots). It drove 600k players in a week [S10]. The reference **spends all of its unlocks in the first ~15–20% of playtime**, which causes the "then it's a waiting game" reviews [S13][S5]. We should:
   - spread unlocks across the whole completion curve, for example by gating late tiers on % of the moon cleaned or on sector milestones;
   - add intermediate robot tiers and **robot upgrades**. The reference jumps 40× in price from its Mk II to the global robot, and lets you buy only more robots, never better ones [S12][S33].
2. **Price curves to emulate in spirit.** Choose our own constants for each of these:
   - Cheap, fast early tiers at about ×2–3 cost per tier.
   - Capacity upgrades with a flat cost per added unit.
   - Matrix levels at about ×2–3 per level.
   - Capstones that are mostly small +% bonuses plus 1–2 qualitative automation perks.
   - Vehicles where bigger means wider and holds more, but is slower.
   - One "autonomy" purchase whose premium buys range and unattended work rather than raw efficiency.
3. **Sector grid.** The 163,842-cell geodesic hex grid (an icosahedron subdivided 7 times) on a roughly 2 km-radius sphere suits a native PC client. For a browser client with a Node server, a smaller subdivision is more realistic: 10·4ⁿ+2 cells, which gives 10,242 at n=5 and 40,962 at n=6. Keep a per-sector "dust remaining" scalar that the server authorizes. Use a small "started" threshold and a "done" threshold with remaining dust ≤ X%, and auto-complete empty sectors. The reference needed patches for sectors stuck at 99.9% and for phantom 0% sectors [S9].
4. **Robots should run without players nearby from day 1.** That was the reference's top launch complaint, fixed only in patch 1.0.4 [S7][S8]. An authoritative server makes this natural. Simulate global robots **abstractly, at sector level**, with a per-sector clear timer and capsule "launches" to collectors, rather than physically. The reference's global robot already behaves like a timer of about 70 s per sector [S34].
5. **Dust and ground sync is the hardest netcode problem.** The reference had to rework "ground sync" in patch 1.0.4 [S8]. Plan for coarse per-sector state plus local cosmetic detail, and budget bandwidth for 16 players.
6. **Entity caps and performance.** The reference raised its loose-capsule cap from 10k to 90k, and still lags with hundreds of robots [S9][S13]. For a browser game, aggregate belt items (flow rates instead of individual capsules) where possible.
7. **Co-op economy.** Start with a **shared wallet and shared upgrades**; the reference switched to shared upgrades after complaints [S6][S7]. Keep tools and vehicles per player. Unlike the reference, consider scaling some costs or rewards with crew size. In the reference, a 16-player crew effectively shares one upgrade tree and only multiplies per-player costs.
8. **Exploration rewards are a strong early accelerator.** In the reference, one-off flag and site rewards roughly equal all personal progression (derived). Keep the idea with **original** collectibles; don't use real flags or real mission sites one-to-one. Tune it so exploration speeds progress without replacing it.
9. **Day/night adds planning, not survival.** A 60-minute cycle that is half dark, with solar power and batteries, plus lamp and night-vision upgrades, creates production planning without an oxygen meter [S8][S41]. Pick our own cycle length.
10. **The achievement ladders are good pacing instruments.** Use 10× tiers for money, sectors and dust, plus %-of-moon milestones. The reference's funnel shows the steepest drop between 1% and 10% of the moon [S4]. That is where our mid-game content needs to be.
11. **Persistence decision.** In the reference, the world ends when the host leaves [S44]. Our dedicated server and database can keep crew worlds persistent. That is a product decision with cost implications for the infrastructure team, and an opportunity to differentiate.

---

## Sources

All were accessed on 2026-11-11.

1. Moon Sweepers on Steam (store page) — https://store.steampowered.com/app/5335510/Moon_Sweepers/ — accessed 2026-11-11 — **official**
2. Steam Storefront API, appdetails for 5335510 (store description, genres, categories, platforms, legal notice) — https://store.steampowered.com/api/appdetails?appids=5335510&l=english — accessed 2026-11-11 — **official**
3. Steam Community, Moon Sweepers global achievements — https://steamcommunity.com/stats/5335510/achievements — accessed 2026-11-11 — **official (platform stats)**
4. Steam Web API, GetGlobalAchievementPercentagesForApp (5335510) — https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=5335510&format=json — accessed 2026-11-11 — **official (platform stats)**
5. Steam Web API, GetNewsForApp (5335510). Contains the developer posts S6–S10 plus syndicated items: SteamDB "Moon Sweepers peaks at 83k players" and Global Top Sellers posts; the PCGamesN headline "…is 'nowhere near finished' as it soars past the half-million mark"; and PlayGround.ru "Moon Sweepers gaining momentum on Steam" — https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=5335510&count=30&maxlength=0&format=json — accessed 2026-11-11 — **official feed; syndicated items are press/community**
6. "Moon Sweepers 1.0.3 Patch" (developer announcement, 2026-10-24; text read via S5) — https://steamcommunity.com/ogg/5335510/announcements/detail/680764929940133591 — accessed 2026-11-11 — **official**
7. "A Message From the Developers" (developer announcement, 2026-10-24; via S5) — https://steamcommunity.com/ogg/5335510/announcements/detail/680764929940133618 — accessed 2026-11-11 — **official**
8. "Moon Sweepers 1.0.4 Patch" (developer announcement, 2026-10-25; via S5) — https://steamcommunity.com/ogg/5335510/announcements/detail/680764929940133872 — accessed 2026-11-11 — **official**
9. "Moon Sweepers 1.0.5 Patch" (developer announcement, 2026-10-28; via S5) — https://steamcommunity.com/ogg/5335510/announcements/detail/680765564125184348 — accessed 2026-11-11 — **official**
10. "600,000" (developer announcement, 2026-10-30; via S5) — https://steamcommunity.com/ogg/5335510/announcements/detail/680765564125185957 — accessed 2026-11-11 — **official**
11. Steam Community, Moon Sweepers guides index — https://steamcommunity.com/app/5335510/guides/ — accessed 2026-11-11 — **community**
12. Steam Community discussion, "How long is this game in total?" (posts dated 2026-10-24) — https://steamcommunity.com/app/5335510/discussions/0/570427041543905177/ — accessed 2026-11-11 — **community**
13. Steam Community reviews, "Most Helpful" — https://steamcommunity.com/app/5335510/reviews/?browsefilter=toprated&l=english — accessed 2026-11-11 — **community**
14. Steam guide, "Moon Sweepers – The Ultimate Expert Guide from Lunar Dust to an Industrial Empire" (v1.0.5; now flagged as removed by Steam) — https://steamcommunity.com/sharedfiles/filedetails/?id=3837900599 — accessed 2026-11-11 — **community (low reliability)**
15. Wikily, Moon Sweepers wiki home — https://wikily.gg/moon-sweepers — accessed 2026-11-11 — **community wiki**
16. Wikily, Cleaning tools — https://wikily.gg/moon-sweepers/cleaning-tools — accessed 2026-11-11 — **community wiki**
17. Wikily, Extra wide broom — https://wikily.gg/moon-sweepers/cleaning-tools/extra-wide-broom — accessed 2026-11-11 — **community wiki**
18. Wikily, Building tool — https://wikily.gg/moon-sweepers/cleaning-tools/building-tool — accessed 2026-11-11 — **community wiki**
19. Wikily, Containers — https://wikily.gg/moon-sweepers/containers — accessed 2026-11-11 — **community wiki**
20. Wikily, Upgrade matrix — https://wikily.gg/moon-sweepers/upgrade-matrix — accessed 2026-11-11 — **community wiki**
21. Wikily, Suit gear — https://wikily.gg/moon-sweepers/suit-gear — accessed 2026-11-11 — **community wiki**
22. Wikily, Vehicles — https://wikily.gg/moon-sweepers/vehicles — accessed 2026-11-11 — **community wiki**
23. Wikily, Push sweeper — https://wikily.gg/moon-sweepers/vehicles/push-sweeper — accessed 2026-11-11 — **community wiki**
24. Wikily, Vehicle upgrades — https://wikily.gg/moon-sweepers/vehicle-upgrades — accessed 2026-11-11 — **community wiki**
25. Wikily, Vehicle tricks — https://wikily.gg/moon-sweepers/vehicle-tricks — accessed 2026-11-11 — **community wiki**
26. Wikily, Selling and income — https://wikily.gg/moon-sweepers/selling-and-income — accessed 2026-11-11 — **community wiki**
27. Wikily, Collector and stations — https://wikily.gg/moon-sweepers/collector-and-stations — accessed 2026-11-11 — **community wiki**
28. Wikily, Resources and capsules — https://wikily.gg/moon-sweepers/resources-and-capsules — accessed 2026-11-11 — **community wiki**
29. Wikily, Production chains — https://wikily.gg/moon-sweepers/production-chains — accessed 2026-11-11 — **community wiki**
30. Wikily, Machines — https://wikily.gg/moon-sweepers/machines — accessed 2026-11-11 — **community wiki**
31. Wikily, Packager — https://wikily.gg/moon-sweepers/machines/packager — accessed 2026-11-11 — **community wiki**
32. Wikily, Buildings (build menu, page 1 of 5) — https://wikily.gg/moon-sweepers/buildings — accessed 2026-11-11 — **community wiki**
33. Wikily, J.O.O.N.A.S. and robot vacuums — https://wikily.gg/moon-sweepers/joonas-robots — accessed 2026-11-11 — **community wiki**
34. Wikily, J.O.O.N.A.S. — https://wikily.gg/moon-sweepers/joonas-robots/j-o-o-n-a-s — accessed 2026-11-11 — **community wiki**
35. Wikily, Robot vacuum Mk I — https://wikily.gg/moon-sweepers/joonas-robots/robot-vacuum-mk-i — accessed 2026-11-11 — **community wiki**
36. Wikily, Moon regions — https://wikily.gg/moon-sweepers/regions — accessed 2026-11-11 — **community wiki**
37. Wikily, Interactive Map (key stats: radius, surface, counts) — https://wikily.gg/moon-sweepers/interactive-map — accessed 2026-11-11 — **community wiki**
38. Wikily, Waypoints and teleporting — https://wikily.gg/moon-sweepers/waypoints-and-teleporting — accessed 2026-11-11 — **community wiki**
39. Wikily, Station facilities — https://wikily.gg/moon-sweepers/station-facilities — accessed 2026-11-11 — **community wiki**
40. Wikily, Controls — https://wikily.gg/moon-sweepers/controls — accessed 2026-11-11 — **community wiki**
41. Wikily, Day and night — https://wikily.gg/moon-sweepers/day-and-night — accessed 2026-11-11 — **community wiki**
42. Wikily, The ending — https://wikily.gg/moon-sweepers/ending — accessed 2026-11-11 — **community wiki**
43. Wikily, Achievements — https://wikily.gg/moon-sweepers/achievements — accessed 2026-11-11 — **community wiki**
44. Wikily, Multiplayer — https://wikily.gg/moon-sweepers/multiplayer — accessed 2026-11-11 — **community wiki**
45. Wikily, Lore — https://wikily.gg/moon-sweepers/lore — accessed 2026-11-11 — **community wiki**
46. Wikily, Field Manual (transcription of in-game manual) — https://wikily.gg/moon-sweepers/field-manual — accessed 2026-11-11 — **community wiki**
47. Wikily, Lunar sites — https://wikily.gg/moon-sweepers/lunar-sites — accessed 2026-11-11 — **community wiki**
48. Wikily, Flags — https://wikily.gg/moon-sweepers/flags — accessed 2026-11-11 — **community wiki**
49. Wikily, Radio — https://wikily.gg/moon-sweepers/radio — accessed 2026-11-11 — **community wiki**
50. Game Rant, "Beginner Tips & Tricks for Moon Sweepers" (Usama Ali, 2026-10-31) — https://gamerant.com/moon-sweepers-beginner-tips/ — accessed 2026-11-11 — **press**
51. IXBT Games, "Two developers created the Moon-cleaning game Moon Sweepers…" (2026-10-28) — https://ixbt.games/en/news/2026/10/28/dva-razrabotcika-sdelali-igru-pro-uborku-luny-moon-sweepers-ona-obosla-aaa-xity-v-steam.html — accessed 2026-11-11 — **press**
52. Gaming Deputy (FR), "Moon Sweepers : combien de temps pour finir le jeu ?" (aggregates player reports) — https://www.gamingdeputy.com/france/moon-sweepers-duree-de-vie/ — accessed 2026-11-11 — **press/guide site (secondary)**
53. GitHub, zlwzk/MoonSweepersQoL ("Moon Sweepers (Unity 6 / IL2CPP) QoL mod", BepInEx 6) — https://github.com/zlwzk/MoonSweepersQoL — accessed 2026-11-11 — **community (mod)**
54. GitHub, scoutjaguarstill/moon-sweepers-mod-loader-compatibility (seen in search results only; not opened; cites Unity 6000.6 / IL2CPP) — https://github.com/scoutjaguarstill/moon-sweepers-mod-loader-compatibility — accessed 2026-11-11 — **community (L)**
55. Unity documentation, Application.persistentDataPath (Windows path pattern) — https://docs.unity.com/en-us/engine/current/script-reference/unityengine/application/persistentdatapath — accessed 2026-11-11 — **official (Unity)**
56. Whisper of the House, "Moon Sweepers Achievements" (page last updated 2026-10-24) — https://www.whisperofthehouse.com/moon-sweepers/achievements — accessed 2026-11-11 — **community guide site**
57. Unaffiliated fan/SEO guide sites, low reliability and **not relied on**. Seen in search results: https://moonsweepers.org/guides/moon-map-and-completion/ (fetch failed with a TLS error) and https://moonsweepersguide.com/guides/map-and-exploration/ — accessed 2026-11-11 — **community (L)**
