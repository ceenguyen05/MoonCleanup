# Roblox Moon-Cleaning Games: Progression, Retention & Social Systems

**Date:** 2026-11-11 · **Author:** research subagent P1c · **Scope:** Roblox moon- and planet-cleaning experiences. The two main subjects are *Sweep The Moon 🌕* (DomBlox Games) and *[MARS] Clean the Moon!* (Lunarlit Works), with about 18 smaller clones as secondary subjects. Covers identification and stats, progression and persistence, social features, retention, monetization (read only for what it says about pacing), update cadence, pacing, and comparison with the Steam game *Moon Sweepers*. This is a planning reference only. No reference-game assets were downloaded.

**How to read this document**
- `[S#]` points to the numbered **Sources** list at the end. Every source was accessed on **2026-11-11**.
- Confidence labels:
  - **(H)**: official or first-party data (Roblox's public platform APIs and game pages, the Steam store), or several sources that agree.
  - **(M)**: one reasonable source, or an inference drawn from official data.
  - **(L)**: community sources only, search-engine summaries only, or speculation.
- Source types:
  - **Official**: Roblox platform records (game, place, badge, pass, product, event and group APIs) and the Steam store page.
  - **Third-party tracker**: Rolimons.
  - **Community**: fan wikis, code sites, press and guide sites, YouTube.
- All live numbers (players, visits, favorites) are snapshots from 2026-11-11 and change by the minute. Snapshots taken minutes apart differ slightly.
- In Roblox API records, "created" is when the universe was created, which can be earlier than its public launch. "Updated" is the last publish.
- Short names used below: **STM** = Sweep The Moon 🌕; **CTM** = [MARS] Clean the Moon! (Lunarlit Works).

---

## Executive summary

1. **Two games dominate the genre on Roblox.** **STM** (DomBlox Games) had 33,161 players online, 7.69M visits and an all-time peak of 33,373 concurrent users, recorded on 2026-11-11. **CTM** (Lunarlit Works) had 7,533 online, 9.87M visits and an all-time peak of 24,508 around 2026-11-08 [S1][S13][S27][S28]. Visits and players: **(H)**. Peaks come from Rolimons: **(M)**.
2. **At least 17 other moon/planet-cleaning clones exist, all small**, each under about 130 concurrent players at fetch time. Two of them have rebirth and pets [S21][S22][S23][S24][S25]. **(H)**
3. **The Roblox games started before the Steam game launched.** The earliest Roblox moon-cleaning universes were created on 2026-10-11 and 2026-10-12, about 11 days before *Moon Sweepers* launched on Steam (2026-10-23). STM was created on the Steam launch day, and its description says it is "Inspired by Moon Sweepers on Steam" [S1][S3][S13][S21][S43]. **(H)**
4. **Both leading games split play between a lobby and separate moon instances.** STM's universe has 3 places. CTM's has a lobby plus "Moon", "[HARD] Moon", "Mars" and "[HARD] Mars" [S3][S15]. The place lists are **(H)**; how players move between them is **(M)**.
5. **Both use two layers of progression.** Inside a moon or run there is a cash economy: tools, capacity, vehicles, robots and factory. Above that sits a lobby meta-currency that persists:
   - STM: **Shards**, spent in a lobby shop and on random **class rolls**.
   - CTM: **Gems**, spent on permanent upgrades and a ladder of **Classes**.

   Neither game uses the word "rebirth". Finishing a moon or run works as the prestige step [S6][S7][S17][S38][S40]. **(M–H)**
6. **STM progression.** Vehicles come from **shared bays** that step through a fixed sequence: Walk-behind Sweeper, Ride-on Sweeper, Cab Sweeper, Rover, UFO. Robots come from **docks**, and there are factory machines (Crusher, Block Press). The goal is "100% clean" per moon. Since the 2026-11-11 update, completed moons pay Shards [S4][S5][S6][S7]. **(H)**
7. **CTM progression.** Four zones are separated by barriers, and you leave through a **Hatch** at the end. Dust is sold at a sell pad and converter (18 levels). There are 8 quests shown one at a time, random server events (a cargo crash, UFO raids with a chest shared by the whole server), Mars with a boss, and hard modes [S15][S17][S18][S38][S39]. **(M)**
8. **Finishing a moon is rare in STM.** The "Clean Sweep" badge (a moon cleaned to 100%) has been awarded only 0.72% as often as the "Payday" badge (first sale) [S4]. Counts **(H)**; interpretation **(M)**.
9. **Average session length** reported by Rolimons is about 24 minutes for STM and about 20 minutes for CTM [S27][S28]. **(M)**, third-party figure.
10. **Co-op.** STM moons hold "up to 4 friends" inside 20-player servers, and bays and robots are shared. In CTM the converter "pays every crew member" on each sale, and servers hold 20. No trading system was found in either game. Private servers are disabled in both [S1][S3][S13][S38]. **(H/M)**
11. **Retention hooks.**
    - CTM: codes tied to like, visit and group-member milestones; a limited Halloween class bought with Candy; quests; a Free Gift.
    - Both: badges; Roblox **Events** announcing an update every 2–5 days; title tags such as [MARS] and [🎃].
    - **No daily rewards or offline earnings were found** in either game [S7][S18][S38][S39][S40][S41]. **(M)**
12. **Monetization shows where the grind hurts.** Paid conveniences target carrying capacity and trips to sell (Infinite Canister/Capacity, Sell As You Sweep, Instant Sell), walking and driving speed, slow starts to each moon or run (Head Start, instant vehicles, PERMANENT start-of-run items), automation slots, and vehicle battery. STM has 8 passes and 14 developer products; CTM has 43 passes [S5][S6][S17]. **(H)**
13. **Update cadence and spikes.** Both games shipped content every 2–5 days in their first three weeks. CTM's all-time peak followed its MARS update, and STM set its peak on the day of its Ranger Drone and UFO update [S7][S18][S27][S28]. **(M)**, a correlation only.
14. **Compared with Moon Sweepers.**
    - The Roblox games add a meta-currency and classes, multiple moons or runs, hard modes and a second planet, codes, seasonal events, random raids and bosses, quests, and paid conveniences.
    - *Moon Sweepers* documents 16-player co-op on a save hosted by one player, a shared upgrade matrix, placeable depots and shipments, and Steam achievements and cloud saves [S43][S45]. **(M)**
15. **Implication for our game (opinion).** Adopt the run-plus-meta structure, zone milestones that fit a ~20–25 minute session, crew-shared payouts, and earnable versions of the paid conveniences. Avoid gacha (random rolls), pay-to-skip, and every name in §9.

---

## 1. Games identified and statistics (RQ1)

### 1.1 The two major games

| Field | Sweep The Moon 🌕 | [MARS] Clean the Moon! |
|---|---|---|
| Creator | DomBlox Games, Roblox group 711013993, 380,711 members [S1][S9] (H) | Lunarlit Works, group 792825799, 579,716 members [S13][S20] (H) |
| Game page | https://www.roblox.com/games/109576450376407 [S11] | https://www.roblox.com/games/76678170614451 [S12] |
| Universe / root place ID | 10772543706 / 109576450376407 [S1] (H) | 10770466814 / 76678170614451 [S12][S13] (H) |
| Other places in the universe | a second "Sweep The Moon 🌕" place (104013333584382) and "Cutscene" (90968775808130) [S3] (H) | "Moon" (77902310012360), "[HARD] Moon" (136645816399459), "Mars" (88549191352404), "[HARD] Mars" (87576774043002) [S15] (H) |
| Created (API) | 2026-10-23 11:46 UTC [S1] (H) | 2026-10-12 01:44 UTC [S13] (H) |
| Last updated (API) | 2026-11-11 11:18 UTC [S1] (H) | 2026-11-08 04:01 UTC [S13] (H) |
| Genre (API) | Simulation › Incremental Simulator [S1] (H) | Simulation › Incremental Simulator [S13] (H) |
| Visits | 7,685,243 (API); 7,741,900 (Rolimons, later snapshot) [S1][S27] | 9,867,245 (API); 9,863,948 (Rolimons) [S13][S28] |
| Favorites | 61,933 (API); 62,249 (Rolimons) [S1][S27] | 197,988 (API); 197,908 (Rolimons) [S13][S28] |
| Likes / dislikes | 88,561 / 2,215, 97.6% positive [S2] (H) | 30,464 / 1,905, 94.1% positive [S14] (H) |
| Players online at fetch | 33,161 [S1] (H) | 7,533 [S13] (H) |
| Peak concurrent users (third-party) | **33,373 all-time, set 2026-11-11.** The all-time, 30-day, 7-day and 24-hour peaks are all the same value, so the game was at its high on the day of writing [S27] (M) | **24,508 all-time, about 2026-11-08** (shown as "3 days ago"); 24-hour peak 8,268 [S28] (M) |
| Average playtime (third-party) | 24.13 min [S27] (M) | 19.85 min [S28] (M) |
| Max server size | 20 (API). Live public servers showed 14–17 of 20 [S1][S8] (H) | 20 (API). Live servers showed 13–14 of 20 [S13][S19] (H) |
| Private servers | Disabled (API flag `createVipServersAllowed = false`) [S1] (H) | Disabled [S13] (H) |
| Stated inspiration | Root-place description says "Inspired by Moon Sweepers on Steam" [S3] (H) | None stated in its description [S15] (H) |
| Title tagging | Plain title | The title prefix changes with each update. Search listings of the Rolimons page still show "[🎃] Clean the Moon!" (Halloween); it is now "[MARS] …" [S13][S28] (M) |

RoMonitor Stats and Rotrends were **not consulted** because of the tool budget. All peak figures come only from Rolimons.

### 1.2 Other moon- and planet-cleaning experiences

Figures are API snapshots from 2026-11-11. "Notable systems" paraphrases each game's own description. Sources: [S21][S22][S23][S26].

| Title (as of 2026-11-11) | Creator (type) | Universe / root place | Created | Last updated | Visits | Favorites | Online | Max server | Notable systems |
|---|---|---|---|---|---|---|---|---|---|
| [🌕EVENTS] Clean the Moon! | StaticStudios6 (group) | 10770340148 / 78086118798161 | 2026-10-11 | 2026-11-10 | 568,513 | 8,257 | 102 | 20 | Hatch **pets** for boosts; **rebirth** to unlock permanent skill upgrades; treasure hunting; suits, helmets and backpacks; vehicles up to a large crawler. API genre is Adventure › Story |
| [🛸UFO UPDATE] Clean THE Moon | thealiencomes (user) | 10770518294 / 73695758197534 | 2026-10-12 | 2026-11-06 | 597,308 | 2,753 | 59 | 16 | Toothbrush start; dust is pressed into bricks to sell; hidden items |
| Clean the Moon! 🌙 | FunnyVisuals (group) | 10770847724 / 82672816337399 | 2026-10-14 | 2026-11-11 | 569,412 | 8,146 | 4 | 20 | Alien theme; rocket repair; robot customization; vehicles; a code in the description |
| [🌍] Clean A Planet | Tiny Planet Games (group) | 10760141077 / 129664980871931 | **2026-08-25** | 2026-11-06 | 658,161 | 3,225 | 63 | 20 | Trash cleanup on a tiny planet. Predates the moon trend |
| [☀️] Clean the Sun | Wash Crew (group) | 10773074560 / 132009162677102 | 2026-10-26 | 2026-11-10 | 134,103 | 2,611 | 58 | 50 | No description |
| 🌑Moon Sweepers | kauftbeiearned (user) | 10770495464 / 92540628028223 | 2026-10-12 | 2026-11-09 | 126,577 | 1,737 | 15 | 16 | Clean the Moon, then fly a rocket to other planets; rovers, drones, cleaning bots, passes |
| Moon Cleaners | Falling Tiles Squad (group) | 10773129855 / 106831250923249 | 2026-10-26 | 2026-11-10 | 123,305 | 628 | 129 | 16 | Toothbrush up to huge machines; teams of up to 16 |
| Moon Sweeper🌙 [Update 6] | TinyMeatStick (user) | 10773247443 / 76218721018566 | 2026-10-27 | 2026-11-11 | 78,036 | 365 | 1 | 20 | Robot army, hoverboards, a walker mech, **rebirths** |
| [NEW] MOON SWEEPERS! 🌙 | Cheese Moon Studios (group) | 10771264732 / 117500290848628 | 2026-10-16 | 2026-10-26 | 50,848 | 251 | 0 | 50 | Depots, vehicle research, codes, co-op |
| Clean The Moon | AURA-STUDIOS! (group) | 10772978501 / 90304021343388 | 2026-10-25 | 2026-11-03 | 30,467 | 1,718 | 0 | 6 | Your own moon; crystals; new moons; hover scooters; badges |
| Clean the Moon | fun bros gaming (group) | 10770575075 / 122794085902711 | 2026-10-12 | 2026-10-19 | 25,345 | 197 | 1 | 30 | Alien goop; sell at a station; friends |
| [NEW] Sweep The Moon! | OOF My Bad (group) | 10774131801 / 135161183199802 | 2026-11-01 | 2026-11-10 | 25,008 | 148 | 2 | 30 | **Pets** bought with diamonds at an NPC shop; a rover; cleaner bots |
| Moon Sweepers & Build | SurvivalMbGames (group) | 10773099280 / 126535950266014 | 2026-10-26 | 2026-11-08 | 22,021 | 431 | 0 | 30 | Toothbrush up to drivable sweepers; base building |
| [🎃] Sweep the Moon [OFFICIAL] | StrayWolf Studio (group) | 10773123373 / 137019832354062 | 2026-10-26 | 2026-11-11 | 18,228 | 875 | 20 | 50 | Square-by-square sweeping; robot factories; buggies and rovers. Labelled "[OFFICIAL]" despite being a clone |
| Clean The Moon! | GAME ZILLA (group) | 10770435946 / 95249373136746 | 2026-10-11 | 2026-10-31 | 14,915 | 105 | 0 | **100** | **The whole server cleans one moon together**; train speed and strength; complete Moons |
| [🌕] Moon Cleaners | Mr Ducky Studio (group) | 10774020790 / 96702555636724 | 2026-10-31 | 2026-11-09 | 4,737 | 199 | 47 | 24 | Robots, conveyor belts, sweepers and rovers, a code |
| [🎃] Sweep a Planet! | Idleshine (group) | 10773215959 / 100017533681350 | 2026-10-27 | 2026-11-03 | 3,035 | 34 | 0 | 16 | Toothbrush up to push broom; gems; a perk lab |

**Name collisions.** Roblox search returns many near-identical titles [S24][S25], and community guides warn readers not to mix up STM, CTM and the Steam game [S29][S32]. **(H)**

---

## 2. Progression, prestige and persistence (RQ2)

### 2.1 Sweep The Moon 🌕 (DomBlox Games)

**Core loop (H) [S3].**
1. Start with a toothbrush.
2. Sweep dust into a back canister.
3. Empty the canister at the base for cash.
4. Upgrade the brush, canister and speed.
5. Drive sweepers and "giant rovers".
6. Build robots, belts and machines.
7. Get the Moon to 100% clean, "one tile at a time".

Pass text confirms that you empty the canister "at intake" [S5]. A badge measures dust in kilograms ("1,000 kg … across all moons") [S4].

**Two-layer structure (M–H)**

| Layer | Official evidence | What appears to live there |
|---|---|---|
| **Moon** (each saved moon) | Cash packs "last while the moon is saved"; a product called "Infinite Canister (This Moon)"; Head Start works "once per moon"; +1 Robot Dock works "each moon" [S5][S6] (H) | The moon's cash wallet, bay vehicles, robot docks, factory machines and tile progress (M). Whether cash-bought upgrades also stay with the moon is not stated (unknown) |
| **Lobby** (the account) | Shards go "to your lobby wallet for the lobby shop and class rolls"; Class Slot 2 and 3 open extra "lobby class slots", and "only one class is active at a time" [S6] (H) | Shards, classes and class slots; passes, which are permanent; badges |

**Vehicles (H/M).**
- **Bays are shared** by everyone in the moon. Each bay steps through a fixed "next vehicle" [S6][S31].
- The Robux instant-buy prices give the likely tier order: Walk-behind Sweeper (25) → Ride-on Sweeper (39) → Cab Sweeper (59) → Rover (99) → **UFO** (169, product created 2026-11-11) [S6] (M for the order).
- The UFO product's text says that if the bay was already paid, the UFO goes to another Rover bay, which suggests the UFO follows the Rover [S6] (H).
- An official event calls the UFO "the new highest-tier vehicle". It flies and collects dust (event runs 2026-11-14 to 11-18) [S7] (H).
- The Head Start pass puts a fully paid Walk-behind Sweeper in the first empty bay, once per moon [S5] (H).
- **Cash prices for vehicles were not found** (unknown).

**Automation and factory (H/M).**
- Robot docks: the dock's robots "clean for the whole crew" [S5] (H).
- New robots were announced through official events: "HIVE MITES" (2026-11-06 to 11-11) and "RANGER DRONE" (2026-11-11 to 11-13) [S7] (H).
- The description lists belts and machines [S3]. The "Factory Floor" badge is for building a **Crusher or Block Press** [S4] (H).
- Community reports say robots return to their dock to sell and drones to their pad. Sources disagree on whether a dock needs a conveyor [S37] (L).
- Robot rates and costs are unknown, and so is whether robots work while you are offline [S30].

**Upgrades.**
- There are three upgrade lines: brush, canister and speed [S3] (H).
- "Payout upgrades" also exist, because 2x Cash "stacks with payout upgrades" [S5] (H).
- Tier names and prices are unverified; community wikis list them as "TBA" [S32][S34].
- The Fast Legs pass speeds walking only "when the broom is not sweeping". This implies you move more slowly while sweeping (M) [S5].

**Completion and tiles.**
- The goal is 100% clean [S3]. The "Clean Sweep" badge is described as "Cleaned a moon to 100%" [S4] (H).
- Community claims, all **(L)**:
  - a tile counts as clean at 95%;
  - each completed sector pays +3 to +4 Shards [S35][S36];
  - a Hatch opens at 100% and vehicles cannot enter it [S37]. This may be a mix-up with CTM; see Contradictions.

**Rebirth and prestige.**
- **No "rebirth" appears in any official record**: description, passes, products or events [S3][S5][S6][S7] (H).
- The working equivalent is: clean a moon → earn Shards (official since 2026-11-11: "completed Moons now pay Shards") [S7] → spend them on class rolls or in the lobby shop [S6] (M).
- **What resets after a moon reaches 100% is not documented.** It is unknown whether the moon wipes, a new moon starts, or cash is lost. A community wiki explicitly lists this as unverified [S33].
- Players can have more than one moon: one badge counts dust "across all moons", and a pass applies in "your moon or a friend's" [S4][S30][S31] (H/M).
- How many moons a typical player finishes is unknown, but see the badge funnel in §7.

**Classes.**
- Random class rolls exist, with up to 3 slots and one class active at a time [S6] (H).
- Community claims, all **(L)** because I saw them only in search summaries:
  - there are 10 classes;
  - a roll costs 50 Shards at a lobby Classes shop or terminal;
  - "Moon Marshall" and "Chief Engineer" are named as strong classes, with Chief Engineer reportedly giving a 1-in-50 chance of 10x payout on "golden tiles" [S35][S36].

**Quests and leaderboards.** None found (unknown).

**Badges (H) [S4].** STM has five badges, all created 2026-11-05: Payday, Spotless, Dust Devil, Factory Floor and Clean Sweep. Counts and meanings are in the funnel table in §7.

**Shared versus personal (H/M).**
- Shared by everyone in a moon: tile progress, bays and vehicles, and dock robots [S5][S6][S29][S31].
- 2x Cash boosts "your share from automation", so automation income is split across the crew [S30] (M; this is LootWiki's paraphrase of the pass).
- Saved per player: saved moon(s) and their cash wallet, the lobby Shard wallet, classes and class slots, passes, and badges (M).

### 2.2 [MARS] Clean the Moon! (Lunarlit Works)

**Core loop.**
- Official description: sweep up moon dust, space junk and meteor debris; sell it for cash; upgrade broom, backpack and moon boots; unlock cleaning robots; build a lunar base that cleans by itself; unlock new craters and zones; co-op; progress is saved [S15] (H).
- Community detail: carry dust in a container to the green SELL pad at the Lunar Converter. The sale is processed by the converter's conveyor and **pays every crew member** [S38] (M).

**Tools (M) [S38]**

| Tool | Speed (dust tiles per second) | Price | Notes |
|---|---|---|---|
| Toothbrush | 1 | owned at start | |
| Hand Brush | 3 | owned at start | |
| Lunar Shovel | 4 | $2.00 | Clears 3 tiles and 3 layers per stroke, so dust has depth layers |
| Push Broom | 8 | $3.75 | Requires the Lunar Shovel |
| Roller Sweeper | 16 | not listed | Requires the Push Broom |

Other tools:
- **Jet Boots**: a timed 10-minute offer and also a pass.
- **Galaxy Vacuum**: Robux pass.
- **Ray Gun**: handed out during UFO raids.

[S17][S38]. One community wiki says hand tools range from 1 to 40 per second [S39] (L).

**Containers (M) [S38].**
- Pan: 50 dust, owned at start.
- Bucket: 125 dust, $3.50.
- Sack: 300 dust, $10.00, requires the Bucket.
- The Extra Capacity upgrade raises the Bucket from 125 to 144 for $1.00.

**Converter and the TAB upgrade menu (M) [S38].**
- The Lunar Converter has **18 levels**. Level 2 costs $0.25 and speeds up processing.
- An extra conveyor ("EAST CONVEYOR") costs $60.00.
- The TAB menu has four tabs: GENERAL, TOOL, BAG and VEHICLES. First-tier prices:
  - Boots $0.50
  - Convert Time $0.50
  - Luck $1.00
  - Extra Capacity $1.00
  - Sell Value $2.00 (+25% sales)
  - Conveyor Speed $9.00
- **"FINISH NOW"** at the converter costs 5 Gems.

**Vehicles.**
- Junk Hauler: $10.00, a 500-dust bin, speed rises from 16 to 24, and it is "only for the current run" [S38] (M).
- Passes reveal further vehicles: Cleaning Rover, Hopper, Turbo Sweeper, Self-Driving Car (it "drives itself … cleaning and selling for you") and Moonboni [S17] (H).
- Vehicles run on a battery, as shown by the "2x Vehicle Battery" pass [S17] (H).
- Vacuums can overheat, as shown by "Supernova Vacuum … never overheats" [S17] (H).

**Robots and helpers.**
- The Crew Robot Bay unlocks at **7,500 dust cleaned** [S38] (M).
- The Halloween update added robots and drones [S18] (H).
- The Jack the Sweeper class gives a free Ghost Cleaning Drone every run [S40] (M).

**Zones (M) [S38][S39].**
- The Moon has Zones 1–4. Each zone's barrier drops once that zone is cleared.
- Zone 4 is the smallest and the last.
- When the Moon is clear, you leave through the **Hatch**.

**Runs and meta-progression (M).**
- The universe has separate Moon, [HARD] Moon, Mars and [HARD] Mars places [S15] (H).
- Mars passes give items "every run", and the Junk Hauler is "only for the current run" [S17][S38]. So purchases inside a run reset each run, while lobby purchases persist (M).
- **Gems** are the meta and premium currency. Sources: +1 per quest, codes worth 15–50 each, a Free Gift box worth +50, and clearing the game. They are spent in the lobby [S38][S39][S40][S41] (M). A 2x Gems pass exists [S17] (H).
- **Permanent lobby upgrades**, priced in Gems: Bigger Tank 3, Better Deals 4, Quick Feet 5, Pocket Money 8. Their effects are not documented [S40] (M).
- **Class ladder**:

  | Class | Cost |
  |---|---|
  | Rookie | free, the starting class |
  | Hauler | 30 Gems |
  | Sprinter | 70 Gems |
  | Trader | 125 Gems |
  | Scrubber | 275 Gems |
  | Foreman | 550 Gems |
  | Jack the Sweeper (limited, Halloween 2026) | 1,000 Candy |

  [S40][S42] (M)
- The official text never uses "rebirth" (H). How many runs a typical player completes is not documented. The badges "Moon Janitor", "Moon Expert" and "Moon Legend" have no descriptions; they may mark repeat clears (L).

**Hard modes and Mars.**
- The [HARD] Moon and [HARD] Mars places exist [S15] (H).
- The badges "Hard Moon Cleaned" (awarded 3,981 times) and "Hard Speed Sweeper" (684) exist [S16] (H).
- The MARS update (event dated 2026-11-07 to 11-14) adds an alien boss to defeat, a dome to repair and a signal to restore [S18] (H).
- **18 Mars-only passes**, each "PERMANENT … on Mars, every run", were created on 2026-11-07 [S17] (H).
- Hard-mode rules are unknown.

**Quests and random events (M) [S38][S39].**
- **8 quests**, shown one at a time. The first three: clean 100 dust (+1 Gem), buy the Bucket (+1 Gem), buy the Push Broom.
- **Express Delivery**: a cargo craft crashes and scatters supply crates.
- **UFO raids**:
  1. Players use the Ray Gun to defeat the aliens.
  2. The KEY alien drops the Golden Key.
  3. The Golden Key opens the Alien Treasure Chest. Its cash is **shared with every player in the server**.
  4. A 10-second self-destruct starts once the chest is opened.
- **Rainbow dust** patches pay more than plain dust.

**Badges (H) [S16].** CTM has 14 badges. Counts and creation dates are in §7. Only "Moon Cleaner" has a description ("Sweep one dust").

**Persistence and sharing.**
- The official description says progress is saved [S15] (H).
- Community: progress is saved on your Moon, and the lobby holds no run progress [S39]; crews clean the same Moon [S38] (M).
- No leaderboards were found (unknown).

### 2.3 Smaller titles: systems the two leaders don't visibly have

Sources: [S21][S22][S23]. Each item is from the game's own description **(H)**, but none of them was played.

- **Pets and rebirth.** StaticStudios6's game has pet hatching and rebirth that unlocks permanent skill upgrades [S23]. OOF My Bad's game sells pets for diamonds at an NPC shop [S22]. TinyMeatStick's game has rebirths [S22]. These are standard Roblox simulator systems that the two leaders left out.
- **Planet hopping.** kauftbeiearned's 🌑Moon Sweepers flies a rocket to other planets after the Moon [S22].
- **One moon for the whole server.** GAME ZILLA's game runs one moon for a 100-player server and adds "train speed/strength" stats [S21].
- **Processing dust into products.** thealiencomes' game presses dust into bricks before selling [S21].

---

## 3. Social features (RQ3)

| Feature | Sweep The Moon 🌕 | [MARS] Clean the Moon! |
|---|---|---|
| Crew/party size | "Clean with up to 4 friends" (description); server cap 20 [S1][S3] (H). Most likely the 20-player servers are lobbies and each moon holds a crew (M) | 20-player servers [S13] (H); crew size per Moon not documented |
| Shared progress | The moon (tiles, bays, vehicles, dock robots) is shared by everyone in it [S5][S6][S31] (H/M) | Crews clean the same Moon [S38] (M) |
| Payout sharing | Automation pays each player a "share" [S30] (M) | The converter pays every crew member on each sale [S38] (M) |
| Joining a friend's moon | Pass effects apply "in your moon or a friend's" [S31]; the robot dock works in a friend's moon too [S30] (M) | Not documented |
| Server-wide co-op events | None found | UFO raid chest is shared with all players in the server [S38] (M); the MARS boss is a shared objective, though its format is unknown [S18] |
| Support roles | Classes exist; their perks are unverified [S6][S35] | Foreman is described as the class that "keeps the crew shining" [S40] (M); actual crew buffs unverified (L) |
| Group-join rewards | None found | The description asks players to join the group for rewards [S15] (H); the 25KMEMBERS code celebrates a group-member milestone [S41] (M) |
| Trading | None found | None found |
| Chat features | Not documented | Not documented |
| Private servers | Disabled [S1] (H) | Disabled [S13] (H) |
| How common co-op is | Unknown | The "Crew Player" badge has been awarded only 0.73% as often as "First Sale" [S16]. Counts **(H)**; reading it as "most players play solo" is **(L)**, because the badge has no description |

---

## 4. Retention hooks (RQ4)

| Hook | Sweep The Moon 🌕 | [MARS] Clean the Moon! |
|---|---|---|
| Daily login rewards | **Not found** | **Not found** |
| Playtime/session rewards | Not found | A "Free Gift" box gives +50 Gems; how often is unknown [S39]. Jet Boots are a timed 10-minute offer [S38] (M) |
| Offline earnings | Not found. Whether robots work offline is unknown [S30] | Not found |
| Codes | No working codes confirmed as of 2026-11-06 and 11-08 [S32][S34] (M) | MARSUPDATE (40 Gems), 5MVISITS (20), 15KLIKES (15), HALLOWEEN (25 Gems + 35 Candy), RELEASE (50; listed as "check", "inactive" or "expired" by different sites), 25KMEMBERS (40), 500KVISITS (40; listed active on 11-04 and expired by 11-11). Redeemed through a ticket icon in the lobby [S39][S40][S41] (M) |
| Limited-time events | Roblox Events: "NEW ROBOT: HIVE MITES", "NEW: RANGER DRONE", "NEW: FLYABLE UFO" [S7] (H) | Roblox Events: "🎃HALLOWEEN UPDATE 🎃" (category newSeason, 2026-10-29 to 11-06), "MARS" (11-07 to 11-14), and a one-hour "???" teaser on 11-14 hinting at deep water [S18] (H) |
| Seasonal items | None found | Candy picked up while cleaning; the limited class Jack the Sweeper (1,000 Candy) [S38][S40] (M) |
| Like/favorite goals | The description asks players to like and favorite [S3] (H) | The description asks players to like, favorite and join the group [S15] (H). Codes are named after like, visit and member milestones [S41] (M) |
| Update notifications | Roblox Events, which players can follow; community notes frequent icon changes [S7][S32] | Roblox Events plus a title prefix tag ([🎃] → [MARS]) [S18][S28] |
| Quests | None found | 8 quests shown one at a time [S38] (M) |
| Achievements | 5 badges [S4] (H) | 14 badges, including hard-mode and speed badges [S16] (H) |
| Collection/meta goals | Random class rolls, class slots [S6] (H) | Gem-priced class ladder and permanent upgrades [S40] (M) |

---

## 5. Monetization, read for what it says about pacing (RQ5)

This section records monetization only to understand how each economy is shaped. Our game will likely not be monetized.

### 5.1 Sweep The Moon: game passes (8) [S5] (H). All created 2026-10-29.

| Pass | Robux | Effect (paraphrased) |
|---|---|---|
| Infinite Canister | 99 | The back canister never fills; you still empty it at intake to get paid |
| Sell As You Sweep | 249 | Dust pays as soon as it enters the canister, and driven vehicles pay as they sweep. Includes Infinite Canister |
| 2x Cash | 249 | Doubles cash earned on the moon, except cash packs; stacks with payout upgrades |
| Head Start | 199 | Once per moon, a free Walk-behind Sweeper in the first empty bay; the bay is shared |
| Fast Vehicles | 149 | +30% speed in any vehicle you drive |
| Fast Legs | 99 | +50% walking speed while not sweeping; sweeping speed unchanged |
| +1 Robot Dock | 149 | One free small robot dock each moon; its robots clean for the whole crew |
| Everything | 649 | Bundle of all seven (1,193 if bought separately) |

### 5.2 Sweep The Moon: developer products (14) [S6] (H)

| Product | Robux | Effect (paraphrased) |
|---|---|---|
| Infinite Canister (This Moon) | 29 | Infinite canister for the rest of the current moon |
| Small / Medium / Large Cash | 49 / 149 / 399 | +$1,000 / +$4,000 / +$12,000 to the wallet; lasts while the moon is saved; not doubled by 2x Cash |
| 250 / 1,600 / 6,000 Shards | 75 / 399 / 1,199 | Shards added to the lobby wallet for the lobby shop and class rolls |
| Class Slot 2 / Class Slot 3 | 99 / 199 | Extra lobby class slots; one class active at a time |
| Instant Walk-behind Sweeper / Ride-on Sweeper / Cab Sweeper / Rover | 25 / 39 / 59 / 99 | Pays off the bay's next vehicle in full. Shared with everyone in the moon |
| Instant UFO | 169 | Same as above for the UFO. Created 2026-11-11 |

### 5.3 Clean the Moon!: game passes (43; 37 for sale at 99–999 Robux) [S17] (H)

- **Capacity and selling:**
  - Infinite Capacity [PERMANENT] 799
  - Instant Sell 199 ("sell your full tank anywhere")
  - Dust Carrier [PERMANENT] 699 and Silo Pack [PERMANENT] 399 (no descriptions)
  - A retired chain of storage multipliers, 2x → 4x → 6x → 8x → 10x, now off sale
- **Tools:**
  - Galaxy Vacuum 399
  - Supernova Vacuum 799 (3x the Galaxy Vacuum's lane and power; never overheats)
  - Turbo Vac 279
  - Jet Boots 149
- **Vehicles:**
  - Cleaning Rover 299, Hopper 299, Turbo Sweeper 549, Junk Hauler 349
  - Moonboni 799
  - Self-Driving Car 399 (cleans and sells for you)
  - 2x Vehicle Battery 99
- **Multipliers and status:**
  - 2x Cash 129, 2x Gems 99
  - VIP 199, Space Marshal 499 (no descriptions)
  - 2x Speed (off sale)
- **Mars "PERMANENT … every run" (18 passes, created 2026-11-07):**
  - Vehicles: Thunderplow 799, Star Glider 999, Storm Sweeper 549, Rust Rocket 699, Orbit Roller 299, Scrap Grabber 349
  - Tools: Storm Vac 279, Crater Broom 199, Grit Brush 99, Red Spade 149, Dune Roller 249
  - Carry items: Rocket Silo 399, Hover Bin Drone 349, Dust Cart 299, Belt Jar 99, Sling Tube 149, Twin Air Tanks 249, Gumball Globe 199
- **Timing:** CTM's first passes were created at 05:10 UTC on 2026-10-12, about 3.5 hours after the universe itself. The game was monetized from day one [S13][S17] (H).

### 5.4 Pain points the paid conveniences reveal (analysis, M)

| Pain point | STM paid fix | CTM paid fix |
|---|---|---|
| Carrying capacity and walking back to sell | Infinite Canister (pass and per-moon product); Sell As You Sweep | Infinite Capacity; Instant Sell; storage multipliers; carry-item passes |
| Travel time | Fast Legs; Fast Vehicles | Jet Boots; 2x Speed (retired) |
| Slow start to each moon or run | Head Start; instant vehicles; cash packs | PERMANENT start-of-run vehicles and tools; Mars "every run" passes; FINISH NOW (Gems) |
| Automation capacity | +1 Robot Dock | Self-Driving Car |
| Income rate | 2x Cash | 2x Cash |
| Meta-progression speed and randomness | Shard packs; class slots | 2x Gems |
| Equipment uptime | none | 2x Vehicle Battery; a vacuum that "never overheats" |

**Reading (M):** in both games the main grind levers are capacity, the walk back to sell, and starting each moon or run over again. CTM adds battery and overheat friction. Both games sell ways to skip these.

---

## 6. Update cadence and what drives player spikes (RQ6)

| Date (2026) | Game | What happened | Source |
|---|---|---|---|
| 10-11 | Clones | StaticStudios6 and GAME ZILLA moon-cleaning universes created | [S21] (H) |
| 10-12 | CTM | Universe created at 01:44 UTC; first passes at 05:10 UTC. Four more moon clones created the same day | [S13][S17][S21][S22] (H) |
| 10-14 | Moon Sweepers | Pre-launch press article published, confirming a public Steam presence before launch | [S45] (M) |
| 10-15 | CTM | Vehicle and capacity passes added | [S17] (H) |
| 10-18 | CTM | First 5 badges created | [S16] (H) |
| 10-23 | Moon Sweepers / STM | Steam launch; STM universe created the same day | [S43][S1] (H) |
| 10-24 | Moon Sweepers | Patch 1.0.3 | [S45] (M) |
| 10-28 | Moon Sweepers | Press: 6th in Steam bestsellers; more than 62,000 concurrent players "yesterday", per SteamDB | [S44] (M) |
| 10-29 | STM | All 8 passes and 13 products created | [S5][S6] (H) |
| 10-29 → 11-06 | CTM | Halloween season event: decorations, spooky events, robots, drones; Candy currency | [S18][S38] (H/M) |
| 11-02 | CTM | 9 more badges created, including hard-mode and speed badges | [S16] (H) |
| ≈11-04 | STM | Third-party "Up-and-Coming" sort window reported by a community wiki | [S32] (L) |
| 11-05 | STM | 5 badges created | [S4] (H) |
| 11-05 | CTM | Supernova Vacuum, Instant Sell, Moonboni, Self-Driving Car and battery passes added | [S17] (H) |
| 11-06 → 11-11 | STM | "NEW ROBOT: HIVE MITES" event | [S7] (H) |
| 11-07 | CTM | MARS update (boss, dome, signal) and 18 Mars passes | [S17][S18] (H) |
| ≈11-08 | CTM | All-time peak of 24,508 concurrent users | [S28] (M) |
| 11-09 | Moon Sweepers | Press update: passed 600,000 players in its first week | [S45] (M) |
| 11-11 | STM | "NEW: RANGER DRONE" event (completed Moons pay Shards; many bug fixes); Instant UFO product; all-time peak of 33,373 | [S6][S7][S27] (H/M) |
| 11-14 | STM / CTM | STM "NEW: FLYABLE UFO" event (to 11-18); CTM "???" one-hour teaser event | [S7][S18] (H) |
| December | Moon Sweepers | Version 1.1 planned: new machines, materials, tools, automation, late-game | [S45] (M) |

**What drives spikes (analysis):**

- **Content updates and new places to clean.** CTM's all-time peak came a few hours after the MARS update went live, and STM set its peak on its Ranger Drone update day. This is correlation only (M) [S7][S18][S27][S28].
- **Roblox platform tools.**
  - Both games use Roblox Events for every update [S7][S18] (H).
  - CTM retitles the game with an update tag [S28] (M).
  - Both descriptions end with search keyword lists naming other trending Roblox titles ("Peel The Potato, Search For The Needle, Punch To Escape") [S3][S15] (H for the lists; their effect is unknown).
- **The studio's existing audience and trend cadence (H for the data, M for the reading).**
  - DomBlox Games has 380,711 group members.
  - It publishes trend-following games every few weeks: Flatten The Mountain (08-18, 4.99M visits), Needle In A Haystack (08-25, 6.52M), Punch to Escape (10-16, 7.51M), Sweep The Moon (10-23) [S9][S10].
- **YouTube coverage (M for existence; view counts could not be retrieved).** At least four STM guide and overview videos appeared within about two weeks of launch, plus an exploit-script video advertising auto-sweep, auto-sell and auto-upgrade [S46][S47][S48][S49][S50].
- **Upstream Steam virality (M).** The Roblox wave lines up with *Moon Sweepers*' pre-launch period and launch, and its 62,000+ concurrent players [S44][S45].
- **Paid ads.** Could not be verified.

---

## 7. Pacing (RQ7)

| Milestone | Evidence | Confidence |
|---|---|---|
| First upgrade | CTM: the converter's Level 2 costs $0.25 and guides advise buying it on the first sale. First-tier TAB upgrades cost $0.50–$2.00 [S38] | M |
| First tool and container upgrade | CTM: Lunar Shovel $2.00, Bucket $3.50, Push Broom $3.75 [S38] | M |
| First vehicle | CTM: Junk Hauler $10, the same price as the Sack [S38] (M). STM: the Walk-behind Sweeper is the first bay tier and the cheapest instant buy at 25 Robux; its cash price is unknown [S5][S6] (M) | M |
| First helper | CTM: Crew Robot Bay unlocks at 7,500 dust cleaned [S38] (M). STM: unknown | M / unknown |
| First "prestige" | STM: completing a moon (see funnel). CTM: clearing a run through the Hatch. **No time figures were found** | — |
| Session length | Rolimons average playtime: STM 24.13 min, CTM 19.85 min. Methodology unknown [S27][S28] | M |
| Time to finish a moon | **No source found.** YouTube guide descriptions could not be read because page metadata came back truncated [S47] | unknown |

**STM badge funnel [S4].** All badges were created 2026-11-05, so the counts cover roughly 6 days. They are **(H)**.

| Badge (official meaning) | Awarded | In the past day | Share of Payday |
|---|---|---|---|
| Payday (first money from selling dust) | 3,061,726 | 476,899 | 100% |
| Spotless (first tile cleaned) | 2,392,295 | 373,976 | 78.1% |
| Dust Devil (1,000 kg swept across all moons) | 430,007 | 81,211 | 14.0% |
| Factory Floor (built a Crusher or Block Press) | 113,796 | 23,382 | 3.7% |
| Clean Sweep (a moon cleaned to 100%) | 22,115 | 6,122 | **0.72%** (1.3% of the past day's Payday awards) |

**CTM badge funnel [S16].** Badges were created on different dates, so only compare badges from the same date. Counts are **(H)**.

| Badge (created) | Awarded | In the past day | Share of First Sale |
|---|---|---|---|
| First Sale (10-18) | 4,031,185 | 117,698 | 100% |
| First Upgrade (10-18) | 3,716,508 | 107,636 | 92.2% |
| Dust Buster (10-18, no description) | 1,698,762 | 50,515 | 42.1% |
| Clean Sweep (10-18, no description) | 756,853 | 26,985 | 18.8% |
| Crew Player (10-18, no description) | 29,345 | 1,016 | 0.73% |
| Moon Cleaner ("Sweep one dust"), Sweeper, Diamond Eyes (11-02) | 1,762,037; 1,402,957; 658,089 | 138,054; 108,179; 51,769 | — |
| Moon Janitor, Hard Moon Cleaned, Moon Expert (11-02) | 8,091; 3,981; 1,287 | 847; 209; 107 | — |
| Hard Speed Sweeper, Speed Cleaner, Moon Legend (11-02) | 684; 418; 55 | 4; 5; 2 | — |

**Reading (M):**
- In STM, a full moon is a long goal spread over several sessions. Fewer than 1 in 100 players who make a first sale have cleaned a moon to 100%.
- If CTM's "Clean Sweep" means a cleared run (L), then CTM's 4-zone runs are much shorter: about 19% of sellers have cleared one.
- New-player inflow: STM's daily Payday awards (about 477,000) are roughly 4x CTM's daily First Sale awards (about 118,000) [S4][S16]. **(M)**

---

## 8. Comparison with Moon Sweepers on Steam (RQ8)

Moon Sweepers facts below come from its Steam store page [S43] and press coverage [S44][S45]. A sibling research file covers the Steam game in depth. Absence on the store page does not prove the feature is absent from the game.

| Mechanic | Moon Sweepers (Steam) | Sweep The Moon | Clean the Moon! | Who had it first / notes |
|---|---|---|---|---|
| Start with a toothbrush | Yes; store pitch "One toothbrush to start" [S43] (H) | Yes [S3] (H) | Yes [S38] (M) | Steam marketing. The Roblox copies appeared before Steam's launch (M) |
| Sell loop | Deliver to depots and launch shipments for payment [S43] (H) | Empty the canister at the base intake [S3][S5] (H) | Sell pad and converter [S38] (M) | — |
| Capacity upgrades | Yes [S43] (H) | Canister upgrades [S3] (H) | Pan / Bucket / Sack; Extra Capacity [S38] (M) | — |
| Placeable depots | Yes [S43] (H) | Not found | An extra conveyor sell route [S38][S39] (M) | Steam |
| Vehicles | Yes, unlocked through play [S43] (H) | Bay tiers up to the UFO [S6][S7] (H) | Many; battery-limited [S17][S38] | — |
| Robots and automation | Tagged "Automation"; no details on the store page [S43]. A search summary mentions a "Robot Vacuum Mk I" (L) [S53] | Docks, Hive Mites, Ranger Drone [S5][S7] (H) | Robots, drones, Crew Robot Bay, Self-Driving Car [S15][S17][S38] | Unclear |
| Processing machines | "New machines" promised for v1.1 in December [S45] (M) | Crusher, Block Press, belts [S3][S4] (H) | 18-level converter, conveyors [S38] (M) | Roblox shipped first (M) |
| Multiple moons or runs | Not mentioned; a single Moon on a save hosted by one player [S43][S45] (M) | Multiple saved moons [S4][S6] (H) | Runs; Moon and Mars, each in normal and hard [S15] (H) | Roblox |
| Second planet / hard mode | Not mentioned | Not found | Mars and [HARD] places [S15][S18] (H) | Roblox (CTM) |
| Meta-currency | Not mentioned | Shards [S6][S7] (H) | Gems and Candy [S38][S40] (M) | Roblox |
| Classes | Not mentioned | Random rolls and slots [S6] (H) | Gem ladder [S40] (M) | Roblox |
| Rebirth (by that name) / pets | Not mentioned | No | No | Small Roblox clones [S22][S23] (H). Standard on Roblox, not from Steam |
| Codes | No | None confirmed [S32] | Yes [S41] (M) | Roblox convention |
| Daily rewards / leaderboards | Not mentioned | Not found | Not found | — |
| Achievements | Steam Achievements [S43] (H) | 5 badges [S4] (H) | 14 badges [S16] (H) | — |
| Seasonal / limited content | Not mentioned | Not found | Halloween Candy class [S18][S40] | Roblox |
| Random events / bosses | Not mentioned | Not found | Cargo crash, UFO raids, Mars boss [S18][S38] | Roblox |
| Quests | Not mentioned | Not found | 8 sequential quests [S38] (M) | — |
| Co-op model | Up to 16 players; the host owns the save and can kick or ban; **shared upgrade matrix** [S43][S45] (H/M) | Up to 4 friends per moon; 20-player servers [S1][S3] | 20-player servers; crews [S13][S38] | — |
| Persistence | Steam Cloud; host save; cleaned ground stays clean [S43][S45] (H/M) | Saved moons plus a lobby wallet [S6] (H) | Saved progress plus lobby meta [S15][S39] | — |
| Business model | Premium, $8.99 [S43] (H) | Free-to-play: 8 passes, 14 products [S5][S6] (H) | Free-to-play: 43 passes [S17] (H) | — |

**Which came first.**
- Roblox's "Clean the X" incremental genre predates the moon trend:
  - DomBlox's own "Clean The Video Game Store" (created 2026-07-09) and "Clean The Puzzle Gallery" (2026-07-27) [S10] (H);
  - "[🌍] Clean A Planet" (2026-08-25) [S22] (H).
- Moon Sweepers had public pre-launch coverage by 2026-10-14 [S45] (M). A community page dates a trailer to 2026-10-08 [S51] (L). Community sites report that there was no playable demo [S52] (L).
- The first Roblox moon-cleaning universes were created on 2026-10-11 and 10-12 [S13][S21][S22] (H).
- STM followed on 2026-10-23, the Steam launch day [S1][S43] (H).
- Systems that appear first or only on Roblox: meta-currencies, classes, hard modes and the second planet (Mars). Pets and rebirth are standard Roblox simulator systems, and they show up only in the small clones.

---

## 9. REFERENCE PROPER NOUNS — DO NOT USE IN OUR GAME (RQ9)

> These are recorded **only** so the naming team can avoid them. Do not use any of these names, or close variants, in our game. Generic English words used as item names are listed separately at the end. The naming team should avoid those as **exact item names** too, so we don't read as a clone.

**Games and titles:** Sweep The Moon; Clean the Moon!; Clean THE Moon; Clean The Moon; Moon Cleaners; Moon Sweepers (the Steam game and several Roblox clones); Moon Sweeper; MOON SWEEPERS!; Sweep the Moon [OFFICIAL]; Sweep The Moon!; Sweep a Planet!; Moon Sweepers & Build; Clean the Sun; Clean A Planet; Steal the Moon; Build the Moon!; Blow a Planet; Destroy The Planet; Destroy The Sun; The Moon Wakes Up; Space Smash; Totally Safe Moon Project; Brick by Brick; "To The Moon" (Steam bundle); Punch to Escape!; Needle In A Haystack; Flatten The Mountain; Peel The Potato; Search For The Needle.

**Studios and creators:** DragDrop Games; DomBlox Games; Lunarlit Works; StaticStudios6; thealiencomes; GAME ZILLA; FunnyVisuals; kauftbeiearned; Falling Tiles Squad; Mr Ducky Studio; Wash Crew; Tiny Planet Games; TinyMeatStick; Cheese Moon Studios; StrayWolf Studio; OOF My Bad; Idleshine; SurvivalMbGames; AURA-STUDIOS!; fun bros gaming.

**Sweep The Moon:**
- Vehicles: Walk-behind Sweeper; Ride-on Sweeper; Cab Sweeper; Rover; UFO / Flyable UFO.
- Robots and machines: Hive Mites; Ranger Drone; Robot Dock; Crusher; Block Press.
- Currencies and progression: Shards; lobby wallet; lobby shop; class rolls; Class Slot; Moon Marshall; Chief Engineer; golden tiles; sectors.
- Passes and products: Infinite Canister; Infinite Canister (This Moon); Sell As You Sweep; Head Start; Fast Vehicles; Fast Legs; +1 Robot Dock; Everything (bundle); Small / Medium / Large Cash.
- Badges: Payday; Spotless; Dust Devil; Factory Floor; Clean Sweep.
- Places: Cutscene.

**Clean the Moon! (Lunarlit Works):**
- Base and selling: Lunar Converter; SELL pad; EAST CONVEYOR; TAB Upgrades (GENERAL / TOOL / BAG / VEHICLES); FINISH NOW; Crew Robot Bay.
- Tools: Lunar Shovel; Hand Brush; Roller Sweeper; Jet Boots; Galaxy Vacuum; Supernova Vacuum; Turbo Vac; Ray Gun.
- Upgrades: Convert Time; Sell Value; Conveyor Speed; Luck; Extra Capacity; Boots.
- Containers: Pan; Bucket; Sack.
- Vehicles: Junk Hauler; Cleaning Rover; Hopper; Turbo Sweeper; Dust Carrier; Silo Pack; Moonboni; Self-Driving Car.
- Map and events: Hatch; Zone 1–4; rainbow dust; Express Delivery; UFO raid; Golden Key; KEY alien; Alien Treasure Chest.
- Currencies: Gems; Candy.
- Classes: Rookie; Hauler; Sprinter; Trader; Scrubber; Foreman; Jack the Sweeper; Ghost Cleaning Drone.
- Lobby upgrades: Bigger Tank; Quick Feet; Better Deals; Pocket Money.
- Status passes: VIP; Space Marshal.
- Mars passes: Thunderplow; Star Glider; Storm Sweeper; Storm Vac; Rust Rocket; Orbit Roller; Rocket Silo; Crater Broom; Grit Brush; Hover Bin Drone; Scrap Grabber; Dust Cart; Red Spade; Belt Jar; Dune Roller; Sling Tube; Twin Air Tanks; Gumball Globe.
- Other passes: Instant Sell; Infinite Capacity; 2x Vehicle Battery; 2x Gems; 2x Speed; 2x/4x/6x/8x/10x Storage.
- Badges: Moon Cleaner; First Sale; First Upgrade; Sweeper; Diamond Eyes; Dust Buster; Clean Sweep; Crew Player; Moon Janitor; Moon Expert; Speed Cleaner; Hard Moon Cleaned; Moon Legend; Hard Speed Sweeper.
- Places and events: Moon; [HARD] Moon; Mars; [HARD] Mars; HALLOWEEN UPDATE; MARS.
- Codes: MARSUPDATE; 5MVISITS; 15KLIKES; HALLOWEEN; RELEASE; 25KMEMBERS; 500KVISITS.

**Smaller Roblox titles:** Crawler; CleanBots; Rocket Glider; Space Duck; Mega Walker; Mega Moon Sweeper; Nova (shopkeeper, "Nova's shop"); Moon Rover; diamonds (currency); perk lab; hover scooters; crystals; alien goop; dune buggy; codes MOON100, LAUNCH, CORPS, RELEASE.

**Moon Sweepers (Steam), as seen in this research only:** Moonstone (a currency name according to a community wiki; L); Robot Vacuum Mk I (search summary only; L); depots; shipments.

**Generic words that the reference games use as item names.** Avoid these as exact item names; ordinary use in prose is fine: toothbrush (the genre's signature first tool), canister, push broom, hand brush, roller, rover, sweeper, vacuum, bucket, sack, pan, tank, backpack, moon boots, robot dock, bay, intake, conveyor, converter, zone, hatch, crew, class, shards, gems, cash.

---

## Contradictions & uncertainty

1. **STM crew size.**
   - The conflict: the description says "up to 4 friends", while the API and live servers show 20 players per server [S1][S3][S8].
   - Most likely reading (M): 20 is the lobby server cap, and a moon holds up to 4 friends.
   - Not verified in-game. It is also unclear whether the limit is 4 or 5 players including you.
   - Which I trust: the description for crew size, the API for server size.
2. **STM "last updated".**
   - The universe record says 2026-11-11 [S1]; the group's game list says 2026-11-01 [S10].
   - I trust the universe record (H). It is the direct record and matches the 11-11 event and product.
3. **Visits, favorites and likes.**
   - API and Rolimons figures differ slightly, and so do API calls made minutes apart (88,561 vs 88,383 upvotes) [S2][S25][S27].
   - Cause: snapshot timing. The gaps are under 1%.
4. **Where STM Shards come from.**
   - Community: "+3–4 per completed sector" (L) [S35][S36]. Official: "completed Moons now pay Shards" as of 11-11 [S7].
   - Both could be true at different times. I trust the official text.
5. **STM robot docks and conveyors.** Community sources disagree on whether a dock needs a conveyor [S37]. Unresolved (L).
6. **STM Hatch.**
   - The claim that a Hatch opens at 100% appears only in a search summary of community wikis [S37] (L).
   - Two guides confirm a Hatch in CTM [S38][S39], so this may be a mix-up between the two games.
7. **CTM: your own Moon or a shared one?**
   - "Your own Moon" [S39] versus "crews clean the same Moon" [S38].
   - These fit together if each crew gets its own Moon instance. Unverified.
8. **CTM code status.**
   - RELEASE is listed as "check" with 50 Gems [S41], "inactive" [S40] and "expired" [S39]. I treat it as expired (two of three sources).
   - 500KVISITS went from active (11-04) to expired (11-11). That is a change over time, not a conflict.
9. **Badges without descriptions.** CTM's "Clean Sweep", "Crew Player", "Moon Janitor", "Moon Expert" and "Moon Legend" have no descriptions [S16]. Any reading of the funnel based on them is **(L)**.
10. **Moon Sweepers figures.**
    - Review counts: 4,265 (search snapshot), 4,374 (store fetch), 1,700+ (press on 10-28). These differ because of timing.
    - Positive share: 78% (store) versus 77% (press).
    - I trust the store page [S43][S44].
11. **Moon Sweepers trailer and demo.** The trailer date (2026-10-08) and "no demo" both come only from community pages (L) [S51][S52].
12. **Average playtime.** Rolimons does not publish how it calculates this (M).
13. **Sources I could not open.**
    - Sportskeeda: HTTP 405 [S35][S42].
    - Bloxrant: HTTP 403 [S36].
    - Pro Game Guides: HTTP 403.
    - G2A: timed out.
    - clean-the-moon.wiki, sweepthemoonwiki.wiki, sweep-the-moon-wiki.wiki and sweep-the-moon.wiki: TLS certificate errors.
    - YouTube video metadata: truncated, so no view counts or upload dates.
    - RoMonitor Stats and Rotrends: not consulted (budget).
    - Claims seen only in search summaries are marked (L).
14. **Unknown.**
    - Not found for either leading game: daily rewards, offline earnings, leaderboards, trading, chat features. Not finding them does not prove they don't exist.
    - Time to finish a moon.
    - What resets when an STM moon is finished.
    - Hard-mode rules.
    - Class perks.
    - Vehicle and robot cash prices in STM.

---

## Implications for our game

These are opinions for the planning team, based on the evidence above.

1. **Use two layers of progression.**
   - The two leading Roblox games settled on the same shape: a moon or "contract" with its own economy, plus a persistent career layer (STM: Shards and classes; CTM: Gems, classes and permanent upgrades).
   - For a co-op browser game, keep the moon's state with the session or crew, and keep each player's career in MySQL.
   - Decide early what a "finished moon" gives and what it resets. STM leaves this unclear, and that hurts its readability.
2. **Size the moon so most players reach a milestone.**
   - STM's moon is finished by fewer than 1% of players who make a first sale. CTM's 4 barrier-gated zones give intermediate goals.
   - Aim for a zone or sector milestone in each ~20–25 minute session, matching the observed average session lengths, with a full moon spread over several sessions.
3. **Make co-op pay off for everyone.**
   - Pay every crew member on each sale (as CTM does) or split payouts by contribution.
   - Share vehicles and automation across the moon (as STM's bays do).
   - Resolve shared-purchase races on the authoritative server. STM documents a case where another player advances a bay while your purchase is still landing.
4. **Turn the paid conveniences into earnable upgrades.**
   - Capacity tiers, with a late "sell from anywhere" upgrade.
   - Walking and vehicle speed.
   - An extra automation slot.
   - A "head start" perk for new moons.
   - Vehicle battery and tool heat can be friction levers we tune, rather than things players pay to remove.
5. **Make meta-progression deterministic.** Prefer a fixed unlock ladder (like CTM's 30 → 550 Gem classes) over STM's random class rolls. Include support roles that buff the crew, which suit 16-player co-op.
6. **Use retention hooks that don't need monetization.**
   - A sequential onboarding quest chain (CTM shows 8 quests one at a time).
   - Achievements.
   - Seasonal cosmetic events.
   - Random co-op server events that reward everyone (supply drop, raid or boss).
   - An in-game news banner for updates.
   - Codes and like-milestone codes are Roblox-specific conventions; they are optional for us.
7. **Plan the content roadmap from what drew players.** Both leaders shipped a new top-tier vehicle, a new automation unit, a second place to clean, or a hard mode every 2–5 days early on, and CTM's MARS update matched its peak. Plan post-launch content with that mix.
8. **Validate everything on the server.** Auto-sweep and auto-sell exploit scripts circulate for STM [S50]. Our authoritative Node server should check sweep rates, positions and sales.
9. **Give our game its own identity.**
   - Avoid every name in §9.
   - The toothbrush start is *Moon Sweepers*' store pitch and is copied by nearly every clone. Consider an original humble starting tool so we don't look derivative.
10. **The lobby-plus-instance model is standard.** STM uses 3 places and CTM uses 5. It maps naturally onto our menu/lobby and rooms of up to 16 players.

---

## Sources

All sources were accessed on 2026-11-11. Types: official (Roblox platform API or page, Steam store), third-party tracker, community (wiki, guide, code site, press, video).

1. Roblox Games API: Sweep The Moon universe record — https://games.roblox.com/v1/games?universeIds=10772543706 — accessed 2026-11-11 — official
2. Roblox Games API: Sweep The Moon votes — https://games.roblox.com/v1/games/10772543706/votes — accessed 2026-11-11 — official
3. Roblox Develop API: Sweep The Moon places and root-place description — https://develop.roblox.com/v1/universes/10772543706/places?sortOrder=Asc&limit=100 — accessed 2026-11-11 — official
4. Roblox Badges API: Sweep The Moon badges — https://badges.roblox.com/v1/universes/10772543706/badges?limit=100&sortOrder=Asc — accessed 2026-11-11 — official
5. Roblox Game Passes API: Sweep The Moon — https://apis.roblox.com/game-passes/v1/universes/10772543706/game-passes?passView=Full&pageSize=100 — accessed 2026-11-11 — official
6. Roblox Developer Products API: Sweep The Moon — https://apis.roblox.com/developer-products/v2/universes/10772543706/developerproducts?limit=100 — accessed 2026-11-11 — official
7. Roblox Virtual Events API: Sweep The Moon events — https://apis.roblox.com/virtual-events/v1/universes/10772543706/virtual-events — accessed 2026-11-11 — official
8. Roblox public server list: Sweep The Moon — https://games.roblox.com/v1/games/109576450376407/servers/Public?limit=10 — accessed 2026-11-11 — official
9. Roblox Groups API: DomBlox Games — https://groups.roblox.com/v1/groups/711013993 — accessed 2026-11-11 — official
10. Roblox Games API: DomBlox Games public games — https://games.roblox.com/v2/groups/711013993/games?accessFilter=Public&limit=50&sortOrder=Desc — accessed 2026-11-11 — official
11. Roblox game page: Sweep The Moon 🌕 — https://www.roblox.com/games/109576450376407 — accessed 2026-11-11 — official (dynamic stats did not render for the fetcher)
12. Roblox Universe lookup: place 76678170614451 → universe 10770466814 — https://apis.roblox.com/universes/v1/places/76678170614451/universe — accessed 2026-11-11 — official
13. Roblox Games API: [MARS] Clean the Moon! universe record — https://games.roblox.com/v1/games?universeIds=10770466814 — accessed 2026-11-11 — official
14. Roblox Games API: Clean the Moon! votes — https://games.roblox.com/v1/games/10770466814/votes — accessed 2026-11-11 — official
15. Roblox Develop API: Clean the Moon! places and root-place description — https://develop.roblox.com/v1/universes/10770466814/places?sortOrder=Asc&limit=100 — accessed 2026-11-11 — official
16. Roblox Badges API: Clean the Moon! badges — https://badges.roblox.com/v1/universes/10770466814/badges?limit=100&sortOrder=Asc — accessed 2026-11-11 — official
17. Roblox Game Passes API: Clean the Moon! — https://apis.roblox.com/game-passes/v1/universes/10770466814/game-passes?passView=Full&pageSize=100 — accessed 2026-11-11 — official
18. Roblox Virtual Events API: Clean the Moon! events — https://apis.roblox.com/virtual-events/v1/universes/10770466814/virtual-events — accessed 2026-11-11 — official
19. Roblox public server list: Clean the Moon! — https://games.roblox.com/v1/games/76678170614451/servers/Public?limit=10 — accessed 2026-11-11 — official
20. Roblox Groups API: Lunarlit Works — https://groups.roblox.com/v1/groups/792825799 — accessed 2026-11-11 — official
21. Roblox Games API: Clean THE Moon, [🌕EVENTS] Clean the Moon!, Clean The Moon! (GAME ZILLA) — https://games.roblox.com/v1/games?universeIds=10770518294,10770340148,10770435946 — accessed 2026-11-11 — official
22. Roblox Games API: 14 smaller moon/planet-cleaning experiences — https://games.roblox.com/v1/games?universeIds=10774020790,10773129855,10770495464,10770847724,10773074560,10760141077,10773247443,10771264732,10773123373,10774131801,10773215959,10773099280,10772978501,10770575075 — accessed 2026-11-11 — official
23. Roblox Develop API: [🌕EVENTS] Clean the Moon! place description — https://develop.roblox.com/v1/universes/10770340148/places?sortOrder=Asc&limit=100 — accessed 2026-11-11 — official
24. Roblox Omni Search: "clean the moon" — https://apis.roblox.com/search-api/omni-search?searchQuery=clean%20the%20moon&sessionId=1&pageType=all — accessed 2026-11-11 — official
25. Roblox Omni Search: "sweep the moon" — https://apis.roblox.com/search-api/omni-search?searchQuery=sweep%20the%20moon&sessionId=1&pageType=all — accessed 2026-11-11 — official
26. Roblox Universe lookups for places 73695758197534, 78086118798161 and 95249373136746 — https://apis.roblox.com/universes/v1/places/73695758197534/universe ; https://apis.roblox.com/universes/v1/places/78086118798161/universe ; https://apis.roblox.com/universes/v1/places/95249373136746/universe — accessed 2026-11-11 — official
27. Rolimons: Sweep The Moon 🌕 game page — https://www.rolimons.com/game/109576450376407 — accessed 2026-11-11 — third-party tracker
28. Rolimons: [MARS] Clean the Moon! game page (search listings still show the older title "[🎃] Clean the Moon!") — https://www.rolimons.com/game/76678170614451 — accessed 2026-11-11 — third-party tracker
29. LootWiki: Sweep The Moon Guide: Cleaning, Robots and Vehicles — https://lootwiki.com/sweep-the-moon/ — accessed 2026-11-11 — community fan guide (states it is unaffiliated; reviewed 2026-11-11)
30. LootWiki: Sweep The Moon automation — https://lootwiki.com/sweep-the-moon/automation/ — accessed 2026-11-11 — community
31. LootWiki: Sweep The Moon vehicles — https://lootwiki.com/sweep-the-moon/vehicles/ — accessed 2026-11-11 — community
32. Sweep The Moon Wiki (sweepthemoon.wiki), home page — https://sweepthemoon.wiki/ — accessed 2026-11-11 — community fan wiki (states it is unaffiliated; verified 2026-11-06)
33. Sweep The Moon Wiki: "100% Clean" page — https://sweepthemoon.wiki/wiki/progress/ — accessed 2026-11-11 — community
34. Sweep The Moon Wiki: Cash / Shards page — https://sweepthemoon.wiki/wiki/currency/ — accessed 2026-11-11 — community
35. Sportskeeda: Sweep the Moon Classes guide — https://www.sportskeeda.com/roblox-news/sweep-moon-classes-guide — accessed 2026-11-11 — community/press. Not opened (HTTP 405); claims taken from a search summary only
36. Bloxrant: Sweep The Moon Roblox Guide: Cash and Shards — https://bloxrant.com/sweep-the-moon-guide-fast-cash-shards-and-builds — accessed 2026-11-11 — community. Not opened (HTTP 403); search summary only
37. Sweep The Moon community wikis (sweep-the-moon.wiki; sweepthemoon.site) — https://www.sweep-the-moon.wiki/ ; https://www.sweepthemoon.site/ — accessed 2026-11-11 — community. Search summary only (TLS error, or not opened); the exact page behind each claim was not identified
38. AllThings.How: Clean the Moon Starter Guide: How to Play in Roblox — https://allthings.how/clean-the-moon-starter-guide-how-to-play-in-roblox/ — accessed 2026-11-11 — community guide (updated 2026-11-05)
39. Bloxron: Clean the Moon! Roblox Wiki: Zones, Sell Pad & Upgrades — https://bloxron.com/clean-the-moon — accessed 2026-11-11 — community wiki (updated 2026-11-07; states it is unaffiliated)
40. Insider Gaming: Clean The Moon Codes (November 2026) — https://insider-gaming.com/roblox-clean-the-moon-codes/ — accessed 2026-11-11 — community/press guide (2026-11-04)
41. Roblox Den: Clean the Moon! Codes (November 2026) — https://robloxden.com/game-codes/clean-the-moon — accessed 2026-11-11 — community codes tracker (checked 2026-11-11)
42. Sportskeeda: Clean the Moon Classes guide — https://www.sportskeeda.com/roblox-news/clean-moon-classes-guide — accessed 2026-11-11 — community/press. Not opened (HTTP 405); search summary only, which matches [S40]
43. Steam: Moon Sweepers store page — https://store.steampowered.com/app/5335510/Moon_Sweepers/ — accessed 2026-11-11 — official store
44. iXBT.games: "Two developers created the Moon-cleaning game Moon Sweepers…" — https://ixbt.games/en/news/2026/10/28/dva-razrabotcika-sdelali-igru-pro-uborku-luny-moon-sweepers-ona-obosla-aaa-xity-v-steam.html — accessed 2026-11-11 — press (2026-10-28)
45. Games_Finity: "Moon Sweepers launches October 23 with 16-player co-op and a toothbrush to start" — https://www.gamesfinity.com/news/moon-sweepers-release-date/ — accessed 2026-11-11 — press (AI-written according to the site; published 2026-10-14, updated 2026-11-09)
46. YouTube: "Roblox Experience Sweep The Moon 🌕 By DomBlox Games Basic Overview [0 Robux]" — https://www.youtube.com/watch?v=njKUUS1E0wA — accessed 2026-11-11 — video (search listing only; views unknown)
47. YouTube: "Sweep The Moon Guide! (Builds, Tips & Tricks, Money Fast, Shards Fast, Automation & MORE) ROBLOX" — https://www.youtube.com/watch?v=1QJxejqZTis — accessed 2026-11-11 — video (opened; metadata truncated)
48. YouTube: "Sweep The Moon GUIDE! (How To Get Money FAST, Best Strategies, Beginner Tips & Tricks) ROBLOX" — https://www.youtube.com/watch?v=3GgeAzouAJE — accessed 2026-11-11 — video (search listing only)
49. YouTube: "Sweep The Moon Roblox — Beginner Guide: All Brushes, Upgrades & Money Fast" — https://www.youtube.com/watch?v=XxLDzg9XOOg — accessed 2026-11-11 — video (search listing only)
50. YouTube: "Sweep The Moon Script - Auto Sweep, Auto Sell, Auto Upgrade (No Key)" — https://www.youtube.com/watch?v=79dwWrVFjFA — accessed 2026-11-11 — exploit video (search listing only; not opened; not endorsed)
51. Moon Sweepers Trailer page (community) — https://www.moon-sweepers.wiki/trailer — accessed 2026-11-11 — community (search summary only; claims a trailer dated 2026-10-08; unverified)
52. Moon Sweepers Demo page (community) — https://www.moonsweepers.site/wiki/demo — accessed 2026-11-11 — community (search summary only; reports no playable demo around 10-22 to 10-25)
53. Moon Sweepers community beginner guides — https://www.whisperofthehouse.com/moon-sweepers ; https://games.gg/moon-sweepers/guides/moon-sweepers-beginners-guide/ — accessed 2026-11-11 — community (search summary only; mentions a "Robot Vacuum Mk I"; the exact page was not identified; unverified)
