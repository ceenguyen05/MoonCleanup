# Moon Sweepers: Reception, Complaints, Patch History and Virality

**Date:** 2026-11-11 (all sources accessed 2026-11-11) · **Author:** research subagent P1b · **Scope:** How the Steam game *Moon Sweepers* (DragDrop Games, released 2026-10-23) and its Roblox look-alikes were received: genre timeline, commercial signals, why it went viral, what players complained about and praised, patch history, community, and a table that maps each complaint to a fix in our plan (authoritative dedicated Node.js server on a **free Render instance**, persistent MySQL saves on Aiven, browser client).

> **Method note.** The Steam review JSON API (`/appreviews/`) redirected to the store homepage from this environment, and SteamDB, Gamalytic and SteamCharts returned 403, 429 or 404. Review data therefore comes from: the Steam store page HTML; the Steam review **histogram** endpoint (daily up/down counts for all languages); SteamSpy; and parsed Steam Community review pages. Those pages gave **about 58 unique English reviews**, about 55 with readable text (28 negative, 27 positive), drawn from these slices: top-rated negative, top-rated positive, most-recent negative, most-recent all, trending this week (all and negative), most-recent positive, and "funny". The top-rated slices favour long critical reviews, so the prevalence figures below come from a **biased small sample (Medium/Low confidence)**. Use them as a ranking, not as exact rates. Reddit search returned nothing usable, and no official subreddit could be confirmed.

---

## Executive summary

1. **Moon Sweepers was a breakout hit.** It launched on Steam on 2026-10-23 at **$8.99**, made by a **two-person** Finnish team. It reached **600,000 players in about a week** and SteamDB recorded a **peak of 83,138 concurrent players on 2026-11-01**. It was still at **32,088 concurrent** on 2026-11-11 [1][4][5][7][12]. *High.*
2. **Reviews are "Mostly Positive" and have stayed flat at about 77%.** English: 78% of 4,380. All languages (histogram): 6,180 up and 1,879 down, 76.7% of about 8,059. Launch days were the worst (70–73%). After the patches the daily rate settled at 74–80% but **never recovered further** [1][2][3]. *High.* The flat rate suggests the remaining negativity is about design (pacing and content), not bugs.
3. **The #1 complaint by far is the progression wall.** Players own every upgrade by about **0.5–5% of the Moon cleaned**, after roughly 4–7 hours. The rest of the game is waiting for robots ("idle waiting simulator"). About 50% of sampled reviews raise it, including about 20 of 28 negatives [S-reviews]. *High.*
4. **#2 is that the game feels unfinished and should have been Early Access**, with too little late-game content (about 20% of the sample). *Medium-High.*
5. **#3 is performance collapse at scale.** Hundreds or thousands of J.O.O.N.A.S. robots and big factories drop frame rates to single digits, and in multiplayer the robot simulation itself degrades [S-reviews][24]. *High.*
6. **Launch had real stability and multiplayer issues.** These were crashes (AMD/DX12), freezes, large saves that would not load, upgrades that were not shared in co-op, no host kick or ban, ground cleaning that was out of sync between players, and robots stopping when players walked away. All are documented in the developers' own apology and in patches 1.0.3–1.0.5 [8][9][10][11]. *High.*
7. **A controversy over undisclosed generative-AI assets** (player model, texts) appears in about 13% of sampled reviews, including the single most-helpful review (1,049 helpful votes). The store discloses AI only for translation. The claims are **unverified** [1][S-reviews][27]. *Medium* that it is a reputational factor; *Low* on the facts themselves.
8. **The "last 1%" problem is real.** Sectors stalled at 99.9% or showed 0%, there is no map outside stations, and only one waypoint can be seen at a time. The developers patched some of this in 1.0.5 [11][25]. *Medium-High.*
9. **The viral hook is the absurd scale contrast: "clean the entire Moon with a toothbrush."** Almost every top video title uses it. The top 15 YouTube videos have about **18M combined views**. The biggest are Jazzghost (3.67M, BR), Floydsonson (2.68M, "I Played 100%"), Elraenn (2.49M + 1.61M, TR), sleeprilich (1.27M, sleep-stream) and Blitz (1.13M) [21]. *High.*
10. **The audience was international from day one.** Brazilian, Turkish, Japanese, Russian and Spanish-language creators all appear in the top 15. The game shipped in 19 languages, translated with AI [1][21]. *High.*
11. **"Sleep stream" and "100%" formats suit the long, slow, ambient pacing.** "I clean the moon while you sleep" videos passed 1.2M and 0.6M views. The same pacing that annoys reviewers works well as background video content [21]. *Medium* (interpretation).
12. **Roblox clones showed up fast.** Several "Clean the Moon!" experiences were **created 2026-10-11/12**, after Moon Sweepers' trailer and press release on 2026-10-08 but before its launch. "Sweep The Moon" (DomBlox Games) was created **on launch day, 2026-10-23**, and a fan wiki calls it inspired by Moon Sweepers. Sweep The Moon had **32,187 concurrent players** on 2026-11-11, roughly equal to Moon Sweepers on Steam [13][14][15]. *High* on dates; *Medium* on who copied whom.
13. **What players love:** the first 2–6 hours of "cathartic" cleaning with visible progress, chaotic co-op with friends, a relaxing tone (no stamina or oxygen), the cheap price, fast-responding developers, and the ending ("the ending was a movie") [S-reviews]. *High.*
14. **Promised updates:** Update 1.1 is planned for **December 2026**. It covers production chains, new materials, tools, automation, building, late-game progression and performance. "After the Moon" content is teased as "more work" [12][6]. *High* that it is promised; delivery is unknown.
15. **Our biggest lessons:** pace the upgrade curve across the whole Moon, add mid- and late-game goals, keep server-side robot simulation cheap and aggregate, ship shared crew progression and moderation on day one, make finding the last 1% trivial, and be transparent about how assets are made.

---

## 1. Genre timeline

| Date (UTC) | Event | Source | Confidence |
|---|---|---|---|
| 2026-10-08 | Moon Sweepers press release ("Launches on Steam This October… up to 16 players… toothbrush") | [7] | High (the date is shown as "08/10/2026"; read as 8 Oct because the release is 23 Oct) |
| 2026-10-08 | Official trailer "Moon Sweepers Trailer – Wishlist on Steam Now" uploaded (36,103 views at access) | [20] | High |
| 2026-10-11 10:22 | Roblox "[🌕EVENTS] Clean the Moon!" (StaticStudios6) created (569,520 visits) | [13] | High |
| 2026-10-11 20:45 | Roblox "Clean The Moon!" (GAME ZILLA) created (14,917 visits) | [13] | High |
| 2026-10-12 01:44 | Roblox "[MARS] Clean the Moon!" (Lunarlit Works) created; the largest "Clean the Moon!" (9,887,066 visits, 198,472 favourites, 20-player servers) | [13] | High |
| 2026-10-12 13:03 | Roblox "Clean THE Moon" (thealiencomes) created (597,882 visits, 16-player servers) | [13] | High |
| **2026-10-23** | **Moon Sweepers released on Steam (Windows only)** | [1][7] | High |
| 2026-10-23 11:46 | Roblox "Sweep The Moon 🌕" (DomBlox Games) created (7,758,952 visits; **32,187 playing** at access; 20-player servers) | [13] | High |
| 2026-10-30 | Totally Safe Moon Project (different moon game; 1–4 players) launches. Moon Sweepers cross-promotes it and bundles it | [12][1] | High |

**Who inspired whom.**
- Moon Sweepers came first in public. Its Steam page, trailer and press release (8 Oct) predate every Roblox experience (11 Oct onward). *High* on ordering.
- A fan wiki says Sweep The Moon "is inspired by Moon Sweepers on Steam" [14]. That is a community source, but it fits Sweep The Moon's launch-day creation and its toothbrush → vehicles → robots structure. *Medium.*
- The "Clean the Moon!" games' toothbrush start, sell pad and vehicles [15][16] match Moon Sweepers' marketed loop. No source states they copied it, so treat derivation as **likely but unverified**. *Low-Medium.*
- One source notes players also call Moon Sweepers "Clean the Moon," which adds to the naming confusion [16].
- Unofficial SEO "wiki" sites are widespread (moonsweepers.com/.org/.xyz, mooncleaning.net, sweepthemoon.wiki, etc.). The Steam store page links to **no official website**, only Discord, Instagram, TikTok and X [1]. Treat those sites as unofficial. *High.*

**Comparable games** (press comparison, not developer statements): PCGamesN calls it "basically Powerwash Sim or Viscera Cleanup Detail in space with a touch of Astroneer" [6]. Reviewers compare its automation unfavourably with Factorio and Satisfactory [S-reviews].

## 2. Commercial signals

| Metric | Value | Source | Confidence |
|---|---|---|---|
| Price | **$8.99 USD**. SteamSpy shows initial price = current price ($8.99) | [1][4] | High |
| Launch discount | A search snippet showed a store title "Save 15% on Moon Sweepers". Duration and discounted price **not verified** (SteamDB blocked) | search result for [1] | Low |
| Bundles | "To The Moon Bundle" (with Totally Safe Moon Project) $11.46; "Brick by Brick x Moon Sweepers" $15.28 | [1] | High |
| Reviews (English) | **Mostly Positive, 78% of 4,380** | [1] | High |
| Reviews (all languages) | 6,180 up / 1,879 down = **76.7% of 8,059** (histogram to 2026-11-11). SteamSpy: 6,058 / 1,790 (77%) | [2][4] | High |
| "Recent" vs "All" | Steam shows no separate Recent line because the game is under 30 days old. Weekly rollups: 76.5% (wk of 10-23), 76.8% (10-30), 76.7% (11-06) | [1][2] | High |
| Daily review trend | Launch day 72.6%, day 2 70.3%. After 1.0.3/1.0.4: 77.9%, 80.5%. Since then 73.8–80.5%. Volume peaked at about 597 reviews/day (11-01) and fell to about 256/day (11-10) | [2] | High |
| Peak concurrent | **83,138 on 2026-11-01** (SteamDB). Other reports: >36k in the first days [10b]; ~62k on 10-27 [8b]; developer "peak of 70,000" (10-30) [12]; 80,385 live during PCGamesN writing (11-01) [6] | [5][6][8b][10b][12] | High |
| Current players | **32,088** on 2026-11-11 18:21 UTC (Steam API). That is about 39% of peak 10 days later | [3] | High |
| Players / sales | Developer: "**600,000 players**" one week after launch [12]. PCGamesN: "over 600,000 copies sold" [6]. Developer text also says "half a million" [12]. "Players" may include Family Sharing, so copies sold is **not confirmed** | [6][12] | Medium |
| Revenue (our arithmetic, **not** a source estimate) | 600k × $8.99 ≈ **$5.4M gross upper bound**, before regional pricing, any launch discount, refunds, VAT and Steam's cut | derived | Low |
| SteamSpy owners | "0 .. 20,000". Clearly lagging and wrong for a new release; **ignore** | [4] | High that it is wrong |
| Gamalytic / VG Insights | **Not retrieved** (HTTP 429 / not attempted). No third-party sales estimate available | — | — |
| Playtime | SteamSpy: average 647 min (~10.8 h), median 563 min (~9.4 h); last 2 weeks average 521 / median 342 min | [4] | Medium (SteamSpy sampling) |
| Charts | Steam Global Top Sellers #4 (27 Oct–3 Nov) and #8 (3–10 Nov) by SteamDB. ixbt: #6 bestseller at 5 days | [8a][8c][8b] | High |
| Followers / wishlists | Not public on the store page; SteamDB blocked. **Unknown** | — | — |
| Tags | Top user tags: Automation, Indie, Incremental, Co-op, Artificial Intelligence, Job Simulator, Base-Building | [4][1] | High |
| Platforms | Windows only. Steam Deck/Proton fixes appear in 1.0.4. Console "not ready to announce" | [1][9][8b] | High |

## 3. Virality

**The hook.** The premise is "An entire Moon to clean. One toothbrush to start." [1]. It is an instantly readable absurd contrast with a visible % counter. Nearly every top video title uses "toothbrush" or "entire Moon" [21]. *High.*

**Top YouTube videos** (YouTube search sorted by view count, accessed 2026-11-11) [21]:

| Views | Creator | Title (abridged) | Age at access | Format |
|---|---|---|---|---|
| 3,667,840 | Jazzghost (BR) | THEY MADE ME CLEAN THE ENTIRE MOON… WITH A TOOTHBRUSH??? | 6 d | reaction/let's play |
| 2,676,679 | Floydsonson | I Played 100% of Moon Sweepers | 11 d | completion challenge |
| 2,486,839 + 1,611,208 | Elraenn (TR) | MOON SWEEPERS Bölüm 1 / Bölüm 2 | 9 d / 5 d | series |
| 1,272,817 | sleeprilich | I clean the moon with a toothbrush while you sleep | 2 w | sleep stream |
| 1,130,636 | Blitz | I cleaned the moon with a toothbrush | 13 d | challenge |
| 937,791 | Real Civil Engineer | This game nearly broke me… (but then I loved it!) | 4 d | long-form |
| 766,381 | BisteconeLive (BR) | WE HAVE TO CLEAN THE ENTIRE MOON ft. Gabriel Coxinha | 6 d | co-op |
| 616,802 | 兄者弟者 (JP) | みんなで月面掃除!! (group stream) | 6 d | group co-op stream |
| 616,563 | DangerouslySleepy | I Clean The Moon, You Sleep | 2 w | sleep stream |
| 564,670 | Z1 Gaming | An ENTIRE MOON Needs Cleaned… | 2 w | let's play |
| 545,548 | Sonoket Gaming | We have to LITERALLY clean the ENTIRE MOON (uploaded 2026-10-24) | 2 w | let's play [22] |
| 518,821 | СТОДНЕВКА and ЛОЖИСЬ СПАТЬ (RU) | CLEANING THE MOON… | 2 w | let's play |
| 481,091 | いぬけん (JP) | [Impossible] Cleaning Moon dust with a toothbrush (Yukkuri) | 12 d | commentary |
| 437,835 | Plech (ES) | BARRO la LUNA por $$$$ | 13 d | let's play |

- **TikTok:** the official account is @moon.sweepers [1][7]. A Sonoket clip had about 69.1K likes according to a search snippet [23]. Not independently verified, and TikTok-wide view totals are **unknown**. *Low-Medium.*
- **Twitch:** viewership and top streamers were **not researched** (budget). Unknown.
- **Press:** ResetEra thread "a new friend game that is blowing up on Steam right now" [27b]. PCGamesN and ixbt covered the milestones [6][8b].

**Why it spread (analysis):**
1. **Thumbnail-ready absurdity** (toothbrush vs. Moon) plus a **visible % progress** number that is funny when tiny ("in 3 hours ive swept 0.003 percent of the moon") [S-reviews].
2. **Clips come from co-op chaos with up to 16 players.** One review: "slammed a van into my friends and sent them into low orbit… had to become a democracy" [R27]. Players also draw in the dust, for example an 11-year-old drawing a lewd billboard on the Moon [R26]. Emergent graffiti on a shared persistent surface is clip-able.
3. **The slow, ambient pacing suits sleep streams and 100% challenges.** Both formats are in the top 5 [21].
4. **The low price ($8.99)** is cited by ixbt as a success factor [8b]. Reviewers excuse flaws because "it's a cheap game" [R16].
5. **19 languages** gave the game broad international creator coverage (BR, TR, JP, RU, ES) [1][21].
6. **Session length:** median playtime is about 9.4 h [4]. Reviewers describe 2–6 hours of active fun, then idling [S-reviews]. Short sessions are not documented. *Medium.*
7. **Memes:** "Moon is life"; "0.003%"; the J.O.O.N.A.S. robot name; "Stop being lazy, you've got whole Moon to clean" (store copy) [1][S-reviews].

## 4. Complaints, categorised

The sample is about 55 readable English reviews. Prevalence = share of readable sampled reviews mentioning the issue (rounded). Steam discussion thread counts are listed separately.

| # | Category | Est. prevalence | Evidence | Lesson for us | Conf. |
|---|---|---|---|---|---|
| C1 | **Grind and pacing: progression wall, then idling** | ~50% (about 20 of 28 negatives; about 9 positives) | "once you clear about 0.6% of the moon you will have every upgrade. After 26 Hours I cleared 1.6%" [R6]; "fun for 6 hours, then a waiting game" [R1]; "hits a pretty hard plateau… not even 1% of the task complete" [R3]; Steam thread "Endgame balance" (34 replies): "not… possible to actually clear the moon without just letting the game run for a week+" [24a]; "Soooo, is that it?" (18 replies) [24b] | Spread upgrade tiers across the whole Moon (by % cleaned and by region). Never let the upgrade tree max out before about 70–80% completion. Add prestige or new regions instead of a dead plateau. | High |
| C2 | **Upgrade design: useless tiers, skippable tools, no choices** | ~10% | "skip much of the brush upgrades… vehicle upgrades… invalidate all the brushes" [R9]; "rush the final upgrade… skipping all the others" [R-neg-trend] | Each tier must stay useful (different roles such as reach, precision vs. area, or terrain), not just "bigger". Offer real choices (branching). | Medium-High |
| C3 | **Feels unfinished / should be Early Access / thin late game** | ~20% | Most-helpful review (1,049): "This is NOT a finished game… not marked as Early Access" [R2]; "This version is 1.0 but its really 0.6" [R8]; "the map is so big that the content runs dry" [R12] | Content density must match the size of the world. Label scope honestly. Ship mid- and late-game goals at launch. | High |
| C4 | **Performance at scale (robots, factories)** | ~13% of reviews; strong in threads | "300 J O O N A S… 144fps in the beginning… now… drops down to 3 FPS" [R-pos1]; "2fps on my rtx 4070 at late game" [R25]; thread "Game performance very bad with 1,000 JOONAS" (15 replies): in a 400+ robot MP game "cleaning slows to a crawl" [24c] | Hard caps or aggregation of automation units. Simulate robots as cheap server-side area jobs, not physics agents. Budget per-tick CPU. Instance rendering on the client. | High |
| C5 | **Launch crashes / freezes** | ~2–5% of the sample; acknowledged by the developers | Developer apology lists "crashes, performance issues" [10]; AMD crashes → DX11 default (1.0.4) [9]; "Not Responding" freeze ~30 s after load (1.0.5) [11]; thread "I like the game a lot, but crashes too often" (13 replies), "crashes… during the autosave process" [24d] | Browser client: catch WebGL context loss, watchdog long tasks, no main-thread blocking saves. Server: crash isolation per session. | High (existence), Low (rate) |
| C6 | **Multiplayer: per-player upgrades, desync, kicks, join failures, griefing** | ~11% | Upgrades not shared until 1.0.3 ("virtually unplayable multiplayer due to requiring each player to purchase upgrades individually") [R7b]; ground sync reworked in 1.0.4 [9]; "getting kicked from friends co-op" [R14]; threads "Can't join friends game", "connection issue", "Cheaters?" [24e]; kick/ban added in 1.0.3, public-lobby warning in 1.0.5 [8][11] | Server-authoritative shared crew economy from day one. Authoritative dirt-grid state with delta sync. Roles, kick/ban, private-by-default lobbies. Reconnect with session resume. | High |
| C7 | **Save / progression loss** | ~2–4% in the sample, but **major at launch** | 1.0.3: "Heavily cleaned bases load again"; 1.0.4: saves took "up to half a minute", backups and auto-repair added [8][9]; PlayGround.ru notes save-loading problems [10b]; "game is not saving… with a friend" [R13] | Persist server-side in MySQL continuously (incremental chunks, not monolithic blobs). Validate before overwrite. Keep backups. Ownership for co-op worlds. | High |
| C8 | **The "last 1%" hunt / navigation** | ~2% of the sample; patched by the developers; active thread | "last 1-2% becomes really bad, chasing down sectors with the terrible waypoint system, lack of a map while outside the stations" [R8z]; thread "way points = not useful at all?": "You can only see one waypoint currently", request for "map-on-the-go… where you have and haven't been" [25]; 1.0.5 fixed hexes "stalling at 99.9%" and sectors stuck at 0% [11] | Always-available minimap or heat map of remaining dirt. "Ping nearest unfinished" button. Sector completion thresholds (e.g. 99.5% counts as done). Server-authoritative completion recount. | Medium-High |
| C9 | **Robot (J.O.O.N.A.S.) / AI issues** | ~9% | Robots stopped when players moved away (developers' "highest priorit[y]") [10]; "JOONAS is kind of useless and for such a high price" [R9]; "JOONAS Keep Somehow Teleporting", "JOONAS BUG" threads [24e]; 1.0.4 made them 2× faster with no dock trips [9] | Robots must keep working server-side regardless of player proximity, at a deterministic, cheap rate. Their value must be clearly visible (rate per hour shown). | High |
| C10 | **Building / automation UX** | ~11% | "BUILDING MECHANICS ARE SO BAD… NOTHING LINES UP" [R21]; "Belts are janky" [R-neg-trend]; 1.0.3 and 1.0.5 added snapping, move mode and full refunds [8][11] | Grid snapping, free move and refund, clear status messages ("why isn't this working"). | Medium-High |
| C11 | **Controls / camera** | ~4% | Vehicle auto-camera complaint [R4], fixed by a toggle in 1.0.5 [11]; stuck-W-key controller bug fixed in 1.0.5 [11] | Camera options at launch. Ignore idle gamepad axes when keyboard/mouse is active. | Medium |
| C12 | **UI/UX / text bugs** | ~4% | "Weird texts or completely missing texts in the manual" [R10]; waypoint and map UI (C8); garage silo status message added in 1.0.5 [11] | Clear onboarding, diagnostics on machines, localisation QA. | Medium |
| C13 | **Undisclosed generative AI ("AI slop") allegation** | ~13%, all negative, highly upvoted | [R2] (1,049 helpful), [R10] (439), [R-funny-mislead] (192); store discloses only AI translation [1]; Steam thread "AI Generated game content?" [27]. A reviewer claims developers remove such reviews (unverified) [R-neg-trend] | Original, human-directed art and text; accurate disclosure; visible craft in the player model and UI. Trust is a feature. | Medium (impact), Low (factual basis) |
| C14 | **Refund-window resentment** | ~5% | "just enough content to get you past the 2hour limit for a refund" [R-neg-trend]; [R20] | The first 2 hours must not be the best 2 hours. Show the long-term arc early. | Medium |
| C15 | **Achievement grind / AFK achievements** | ~4% | "depositing dust 10,000 times for the 'Do You Live Here?'" [R-funny1]; running overnight for an achievement [R4b] | Avoid pure-time achievements; reward skill, cooperation and discovery. | Medium |
| C16 | **Missing features (requested)** | — | Selling ports, storage silos, map-on-the-go, more vehicles and tools, bigger factories, GeForce Now / console, Vulkan [R-pos3][24e] | See §7. | Medium |

## 5. Praise (preserve this)

- **The opening hours.** Even negative reviewers concede the early game is great: "a few hours of cathartic cleaning you can do by hand" [R-neg-trend]; "The first hour or two is pretty good, there is a clear increase in ability" [R3]. *High.*
- **Co-op with friends.** "especially when playing with friends. The first few hours are easily the best part" [R5]; "Being in Space Alone is a Boring Journey, so Bring Friends" [R-recent70]. *High.*
- **Relaxing and cosy, low pressure.** "Thank you for not adding stamina or oxygen depletion" [R6b]; "very peaceful soundtrack" [R7b]; "too cute and satisfying to put down" [R-trend-cozy]. *High.*
- **Visible, persistent progress on a shared world**, including player graffiti in the dust [R26]. *Medium.*
- **Ending payoff.** "The ending was a movie!" [R16]; "10/10 cause i liked the ending" [R25]. *Medium.*
- **Price** [R16][8b]. *Medium.*
- **Responsive developers.** "responded almost immediately to the feedback" [R7b]. Three patches came in 5 days [8][9][11]. *High.*
- **Stations with mini-games** (chess, air hockey). The thread "Wanted to relax and play chess." has 11 replies [24e][11]. *Medium.*

## 6. Patch notes (official Steam announcements; only 5 posts exist through 2026-11-11)

| Date (UTC) | Post | Key changes | Signals |
|---|---|---|---|
| 2026-10-23 → 10-24 | (unannounced hotfixes) | Reviews dated 10-24 say "devs released a patch today" fixing shared upgrades [R-pos2]. No Steam post exists for 1.0.1/1.0.2 | Hotfixes were shipped without notes. *Medium* |
| **2026-10-24 09:03** | **1.0.3 Patch** [8] | Heavily cleaned saves load again; auto-repair from backups; **shared crew upgrades** (host's matrix; any purchase upgrades everyone); **host kick/ban**; crewmate splitters/mergers work; ~20% FPS gain, horizon culling; machines span foundations; deposit pays what it shows; garages unified; **all crewmates must be on 1.0.3** | Netcode/economy design flaw (per-player upgrades) fixed in about 24 h; missing moderation; save scaling |
| 2026-10-24 15:20 | A Message From the Developers [10] | Apology for "crashes, performance issues, multiplayer bugs, lack of automation and progression balancing". Two-person team. Next priority: J.O.O.N.A.S. stopping when players move away | Confirms the full complaint taxonomy |
| **2026-10-25 20:47** | **1.0.4 Patch** [9] | Night Vision Goggles ($350); map waypoints/teleport; **J.O.O.N.A.S. 2× faster, no dock trips, works with no players nearby**; saves "a fraction of a second" instead of "up to half a minute"; 5 rolling backups; crash recovery; **ground sync reworked** so all players see the same cleaned ground; falling through Moon fixed; **DX11 default** to stop AMD crashes; Proton fixes; saves not backward-compatible | Pacing buff (robots 2×) shows the late game was too slow; sync and save architecture were the weak points |
| **2026-10-28 07:41** | **1.0.5 Patch** [11] | Build anywhere on dust; move mode; **100% refund** (was 75%); snapping; public-lobby warning; TTS chat volume; vehicle camera toggle; robot capsule routing; **hexes stalling at 99.9% fixed**; 0% sectors rechecked and paid; freeze after load fixed; capsule cap 10,000 → 90,000; GC stutter and memory-leak fixes; stuck W key fix | "Last 1%" completion bugs, entity-count limits, memory leaks |
| 2026-10-30 14:00 | "600,000" [12] | **Update 1.1 planned for December 2026**: new production machines and chains, materials and products, tools and upgrades, better automation, building improvements, "expanded progression", performance for large bases. "We're especially focused on making the late game more rewarding." Post-Moon content teased ("Spoiler alert: More work.") | Roadmap admits the late-game and content gap |
| 2026-10-30 → 11-11 | none | No further official patch posts in 12 days (as of access) | Unknown whether fixes are going out silently. *Medium* |

Developer posts cite **Discord as the bug-report channel** [10][11].

## 7. Community

- **Discord** ("Moon Sweepers Official"): about **8,466 members, about 3,247 online** (invite API, 2026-11-11) [17]. Small relative to 600k players. *High.*
- **Reddit:** no confirmed official or dedicated subreddit was found. Reddit search returned no data from this environment, and unofficial wiki pages say none is listed [26]. *Low* (could not verify).
- **Steam discussions** (first 3 pages, ~45 topics by recent activity) [24e]. Highest reply counts:
  - "Endgame balance" (34)
  - "Soooo, is that it?" (18)
  - "Game performance very bad with 1,000 JOONAS" (15)
  - "I like the game a lot, but crashes too often." (13)
  - "Wanted to relax and play chess." (11)
  - "Seems to me that people are overthinking this a bit" (10)
  - "Suggestions" (9)
  - "Upgrade Toothbrush?" (7)
  - "way points = not useful at all?" (6)
  - Many **"join me" / LFG posts** (e.g. "join me i beg", "solo looking for mp") show demand for **public matchmaking**. *Medium.*
- **Most-requested features** (reviews and threads): more upgrade tiers and tools; bigger factories and production chains; selling ports or deposit points you can build; storage silos; map anywhere and better waypoints; more vehicles; optimisation for big robot counts; console and GeForce Now; public lobbies [R-pos3][24e][12]. *Medium.*

## 8. Complaint → likely root cause → our mitigation

Our architecture: authoritative Node.js server on a **free Render instance** (WebSockets), MySQL (Aiven) persistence, browser client, 1–16 players.

| Complaint | Likely root cause (inferred) | Our mitigation (design / engineering) |
|---|---|---|
| Upgrades max out at <1–5% cleaned; then idle | Linear tool upgrades tuned for the first hours against a fixed, enormous world; no later sinks | **Design:** upgrade tiers gated by % cleaned or region unlocks across the whole Moon. Exponential cost and benefit curve simulated in a spreadsheet before build. Target "time-to-complete" with 1, 4 and 16 players. Prestige or new-region layer. **Smaller total world** sized to content. |
| Intermediate tools useless | Only stat ("size") differs between tiers | Tools with distinct roles (precision corners vs. bulk; terrain types). Trade-in value for old tools. |
| Robots make play meaningless / AFK overnight | Automation outpaces and replaces active play with no cap | Automation as a *multiplier on* active play, not a replacement. Cap per-crew robot count. Offline progress capped (e.g. hours, not days). Active-player bonuses. |
| Perf collapse at 300–1,000 robots | Per-agent physics, rendering and pathing with no caps; entity limits | **Server:** robots as lightweight area-clean jobs on the dirt grid (no pathfinding per tick), fixed tick budget, hard cap per session. **Client:** instanced meshes, LOD/culling, only nearby robots animated. **Free Render instance has limited CPU/RAM. Verify the plan's limits and load-test a 16-player, max-robot session before launch.** |
| Crashes / freezes / saves blocking the main thread | Monolithic save serialisation on the game thread; GPU API issues | Server-side incremental persistence (dirty chunks → MySQL in batches, off the tick loop). Client never saves. Handle WebGL context loss and keep the frame loop free of long tasks. |
| Per-player upgrades in co-op | Client- or host-owned economy designed for solo | **Crew-owned wallet and upgrades on the authoritative server from day one** (owner-configurable). |
| Ground desync (players see different cleaned ground) | Host-local terrain state, partial replication | Authoritative chunked dirt grid. Server sends compact per-chunk deltas (bitsets / RLE). Full chunk resync on join or reconnect. Sequence numbers. |
| Kicked / can't join / connection issues | P2P/host networking, NAT, version mismatch | Dedicated server (no host NAT). Reconnect with session token and grace period. Protocol version handshake with a clear "please refresh" message. Note free-tier instances may **sleep when idle and cold-start** (verify), so show a "waking server" state. |
| Griefing in public lobbies | Public by default, no moderation at launch | Private-by-default lobbies with invite codes. Owner kick/ban persisted in MySQL. Rate-limit chat. Role permissions (who can build or demolish). Server validates every action. |
| LFG posts / no matchmaking | No public browser | Simple opt-in public lobby list with player count and progress %. |
| Save loss / large saves won't load | Single huge save file, no validation or backups | Normalised MySQL schema (world, chunks, structures, crew). Transactional writes. Periodic snapshots and backups. Save-version migrations (no "saves can't be opened in older versions" surprises for live players). |
| Hexes stuck at 99.9% / sectors at 0% | Float thresholds and client-measured completion | Integer cell counts on the server. Completion threshold (e.g. ≥99.5% → auto-finish and payout). Recount on load. |
| "Last 1%" hunting, one waypoint, no map | Navigation UI an afterthought; huge map | Always-on minimap with remaining-dirt heat map. "Nearest dirty sector" ping. Multiple labelled waypoints. Late-game "sweep-up drone" that clears small leftovers. |
| Belts and building feel janky | Free placement without snapping; no diagnostics | Grid snapping, move/rotate/free refund, status tooltips ("no output belt"). If automation is not core, keep it shallow and reliable rather than Factorio-lite. |
| Vehicle camera / stuck input | Missing options; gamepad axis noise | Camera toggles at launch; input deadzones; last-used-device switching. |
| Feels unfinished / should be EA | Content scope much smaller than world size; 2-person team | Honest scope labelling (Beta/Early Access). Publish a roadmap. Content per hour, not world size, as the scope metric. |
| AI-asset distrust | Perceived undisclosed generative assets | Original, human-directed art/audio/text. Accurate disclosure. Credits page. |
| Achievement AFK grind | Count-based achievements | Skill, co-op and discovery achievements; no "deposit 10,000×". |
| Refund-window resentment | Front-loaded fun | Spread novelty: new tool, vehicle or region beats every 1–2 h through completion. |

## Contradictions & uncertainty

- **Peak CCU:**
  - Developer "70,000" (10-30) [12] vs. SteamDB **83,138** (11-01) [5]. Not a true conflict: the SteamDB peak came later. **Trust SteamDB** for the all-time peak.
  - ixbt's "62,000" was a day's figure, not a peak [8b].
- **600,000 "players" vs "copies sold" vs "half a million":**
  - The developer post says both 600,000 and "half a million" [12]. PCGamesN says "copies sold" [6].
  - **Trust "600k players (developer)" with Medium confidence.** Copies sold is unverified.
- **Patch dates:** one summarised fetch gave Oct 26/27 for 1.0.3/1.0.4. The raw Steam API timestamps give **Oct 24 and Oct 25**, and those are used here [8][9].
- **Owners:** SteamSpy "0–20,000" contradicts every other signal. Discarded [4].
- **AI-generated assets:** this rests on review allegations only. The official disclosure covers translation only. **No verification either way** [1][27].
- **Roblox derivation:** dates are certain [13]; motive and inspiration are not, except the fan-wiki statement for Sweep The Moon [14].
- **Not verified / unknown:**
  - Launch discount (snippet "Save 15%")
  - Gamalytic and VG Insights estimates
  - Wishlists and followers
  - Twitch statistics
  - TikTok totals
  - Reddit activity
  - Fan-wiki claims (e.g. Sweep The Moon "up to 4 friends" [14] conflicts with the Roblox API maxPlayers = 20 [13]; **trust the API**)
- **Review-sample bias:** top-rated and trending slices over-represent long negative reviews. The prevalence percentages are indicative only.

## Implications for our game

1. **Pacing is the product.** Model the full progression curve (per player count) before building. The single most damaging review theme was the dead plateau after a few hours.
2. **Size the Moon to the content**, or gate it in regions. A huge world with thin content reads as "unfinished".
3. **Keep the magic:** a toothbrush-to-machines power fantasy, an absurd but readable % counter, cosy no-fail tone, shared persistent surface (including graffiti), and chaotic vehicles. Make clip moments easy (photo mode, a % milestone banner).
4. **Do multiplayer right from day one.** Shared crew economy, authoritative grid sync, private lobbies, moderation and reconnect. Moon Sweepers needed 3 patches to get there.
5. **Our dedicated-server model removes host problems but adds hosting cost and limits.** Robot and dirt simulation must be designed for a small (free-tier) server: cap entities and aggregate the simulation.
6. **Persistence is continuous and server-side**, so the "save corrupted / won't load" class of bugs should not exist for players.
7. **Make finishing satisfying.** Easy last-1% cleanup, a celebrated ending (the ending was praised), and post-completion goals.
8. **Be transparent about scope and asset provenance** to avoid the trust backlash.

## Sources

1. Moon Sweepers on Steam (store page; HTML incl. review summary, price, links, AI disclosure) — https://store.steampowered.com/app/5335510/Moon_Sweepers/ — accessed 2026-11-11 — official store
2. Steam review histogram API, app 5335510 — https://store.steampowered.com/appreviewhistogram/5335510?l=english&review_score_preference=0 — accessed 2026-11-11 — official data endpoint
3. Steam Web API GetNumberOfCurrentPlayers (32,088) — https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=5335510 — accessed 2026-11-11 — official data endpoint
4. SteamSpy appdetails 5335510 — https://steamspy.com/api.php?request=appdetails&appid=5335510 — accessed 2026-11-11 — third-party estimate
5. "Moon Sweepers peaks at 83k players" (SteamDB post, 2026-11-01, via Steam news feed) — https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=5335510&count=50&maxlength=0 (item https://steamstore-a.akamaihd.net/news/externalpost/SteamDB/1847286114046596) — accessed 2026-11-11 — third-party tracker
6. PCGamesN, Ken Allsop, "Smash hit co-op space cleanup game Moon Sweepers is 'nowhere near finished'…" (2026-11-01) — https://www.pcgamesn.com/moon-sweepers/update-1-1-future-plans — accessed 2026-11-11 — press
7. Games Press, "Moon Sweepers Launches on Steam This October…" (2026-10-08) — https://www.gamespress.com/Moon-Sweepers-Launches-on-Steam-This-October-Sending-Up-to-16-Players- — accessed 2026-11-11 — official press release
8. Moon Sweepers 1.0.3 Patch (2026-10-24) — https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1847286114039175 — accessed 2026-11-11 — official
   - 8a. SteamDB, Steam Global Top Sellers 27 Oct–3 Nov (#4) — https://steamstore-a.akamaihd.net/news/externalpost/SteamDB/1847920302252093 — accessed 2026-11-11 — third-party tracker
   - 8b. ixbt.games, "Two developers created the Moon-cleaning game Moon Sweepers…" (2026-10-28) — https://ixbt.games/en/news/2026/10/28/dva-razrabotcika-sdelali-igru-pro-uborku-luny-moon-sweepers-ona-obosla-aaa-xity-v-steam.html — accessed 2026-11-11 — press
   - 8c. SteamDB, Steam Global Top Sellers 3–10 Nov (#8) — https://steamstore-a.akamaihd.net/news/externalpost/SteamDB/1848664643359669 — accessed 2026-11-11 — third-party tracker
9. Moon Sweepers 1.0.4 Patch (2026-10-25) — https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1847286114042960 — accessed 2026-11-11 — official
10. A Message From the Developers (2026-10-24) — https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1847286114039880 — accessed 2026-11-11 — official
   - 10b. PlayGround.ru, "В Steam набирает обороты Moon Sweepers" (2026-10-26, via Steam feed) — https://steamstore-a.akamaihd.net/news/externalpost/PlayGround.ru - официальная группа/1847286114043845 — accessed 2026-11-11 — press (RU)
11. Moon Sweepers 1.0.5 Patch (2026-10-28) — https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1847920302229973 — accessed 2026-11-11 — official
12. "600,000" announcement / Update 1.1 roadmap (2026-10-30) — https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1847920302238715 — accessed 2026-11-11 — official
13. Roblox Games API (creation dates, visits, playing, maxPlayers) — https://games.roblox.com/v1/games?universeIds=10772543706,10770466814,10770340148,10770518294,10770435946 — accessed 2026-11-11 — official platform data. Experience pages:
   - https://www.roblox.com/games/109576450376407
   - https://www.rolimons.com/game/76678170614451
   - https://www.roblox.com/games/78086118798161/Clean-the-Moon
   - https://www.roblox.com/games/73695758197534/Clean-THE-Moon
14. Sweep The Moon Wiki (fan site; "inspired by Moon Sweepers") — https://sweepthemoon.wiki/ and https://lootwiki.com/sweep-the-moon/ — accessed 2026-11-11 — community/unofficial
15. allthings.how, "Clean the Moon Starter Guide" — https://allthings.how/clean-the-moon-starter-guide-how-to-play-in-roblox/ — accessed 2026-11-11 — blog
16. Robloxden, "Clean the Moon! Codes" — https://robloxden.com/game-codes/clean-the-moon — accessed 2026-11-11 — community/blog
17. Discord invite API for the official invite linked from the Steam page — https://discord.com/api/v9/invites/5ATRkXkAAe?with_counts=true — accessed 2026-11-11 — official platform data
18. (reserved: Gamalytic — https://gamalytic.com/game/5335510 — accessed 2026-11-11 — HTTP 429, no data)
19. (reserved: SteamDB charts — https://steamdb.info/app/5335510/charts/ — accessed 2026-11-11 — HTTP 403, no data)
20. YouTube, "Moon Sweepers Trailer – Wishlist on Steam Now" (MoonSweepers, 2026-10-08, 36,103 views) — https://www.youtube.com/watch?v=dEM3_CJFZWQ — accessed 2026-11-11 — official
21. YouTube search "moon sweepers" sorted by view count — https://www.youtube.com/results?search_query=%22moon+sweepers%22&sp=CAM%253D — accessed 2026-11-11 — community (YouTube). Videos:
   - https://www.youtube.com/watch?v=aDVKvPkEvGs
   - https://www.youtube.com/watch?v=kbb6KD_Bnvk
   - https://www.youtube.com/watch?v=YLqTtAVdMmQ
   - https://www.youtube.com/watch?v=NOUhq560cVI
   - https://www.youtube.com/watch?v=5owrX6KaoYg
   - https://www.youtube.com/watch?v=Wxzxqk4Poq4
   - https://www.youtube.com/watch?v=oalOQzAntNo
   - https://www.youtube.com/watch?v=J5HNqYpn79I
   - https://www.youtube.com/watch?v=b3rIj5MWNXA
   - https://www.youtube.com/watch?v=whaTjApfokQ
   - https://www.youtube.com/watch?v=vmjq9M0FVBs
   - https://www.youtube.com/watch?v=VUeoqW0J_FM
   - https://www.youtube.com/watch?v=e0hTnLwCcf4
   - https://www.youtube.com/watch?v=QIkIFhgfO4U
22. YouTube, Sonoket Gaming, "We have to LITERALLY clean the ENTIRE MOON | Moon Sweepers Part 1" (2026-10-24) — https://www.youtube.com/watch?v=4C6poRImasE — accessed 2026-11-11 — community (YouTube)
23. TikTok, @sonoket clip (search snippet: ~69.1K likes, unverified) — https://www.tiktok.com/@sonoket/video/7700334389019839774 — accessed 2026-11-11 — community (TikTok)
24. Steam Community discussions (community):
   - 24a. "Endgame balance" — https://steamcommunity.com/app/5335510/discussions/0/570427041544046452/
   - 24b. "Soooo, is that it?" — https://steamcommunity.com/app/5335510/discussions/0/568176624311440946/
   - 24c. "Game performance very bad with 1,000 JOONAS" — https://steamcommunity.com/app/5335510/discussions/0/568176317786515728/
   - 24d. "I like the game a lot, but crashes too often." — https://steamcommunity.com/app/5335510/discussions/0/568176317786263539/
   - 24e. General Discussions index (pages 1–3) — https://steamcommunity.com/app/5335510/discussions/0/
   - All accessed 2026-11-11.
25. Steam discussion "way points = not useful at all?" — https://steamcommunity.com/app/5335510/discussions/0/568176624311399416/ — accessed 2026-11-11 — community
26. Moon Sweepers reddit page (unofficial wiki stating no confirmed subreddit) — https://www.moon-sweepers.wiki/guide/Moon-Sweepers-reddit — accessed 2026-11-11 — community/unofficial (low trust)
27. Steam discussion "AI Generated game content?" — https://steamcommunity.com/app/5335510/discussions/0/570427041544163435/ — accessed 2026-11-11 — community
   - 27b. ResetEra, "Moon Sweepers is a new friend game that is blowing up on Steam right now" — https://www.resetera.com/threads/moon-sweepers-is-a-new-friend-game-that-is-blowing-up-on-steam-right-now.1672868/ — accessed 2026-11-11 — community forum

**[S-reviews] Steam user reviews (community; English).** Listing pages, all accessed 2026-11-11:
- https://steamcommunity.com/app/5335510/negativereviews/?browsefilter=toprated&filterLanguage=english
- https://steamcommunity.com/app/5335510/positivereviews/?browsefilter=toprated&filterLanguage=english
- https://steamcommunity.com/app/5335510/reviews/?browsefilter=mostrecent&filterLanguage=english
- https://steamcommunity.com/app/5335510/negativereviews/?browsefilter=trendweek&filterLanguage=english ([R-neg-trend]: the "AI slop", "rush the final upgrade", "past the 2hour limit" and AI-model reviews)
- https://steamcommunity.com/app/5335510/reviews/?browsefilter=funny&filterLanguage=english

Individual reviews (permalinks):

| Ref | Hours | Verdict | Permalink |
|---|---|---|---|
| R1 | 27.5 h | Not Recommended | https://steamcommunity.com/id/bluetaku/recommended/5335510/ |
| R2 | 8.7 h, 1,049 helpful | Not Recommended | https://steamcommunity.com/id/yveldi/recommended/5335510/ |
| R3 | 8.0 h | Not Recommended | https://steamcommunity.com/id/omnihat/recommended/5335510/ |
| R4b | 54.3 h | Not Recommended | https://steamcommunity.com/profiles/76561198159913599/recommended/5335510/ |
| R5 (neg) | 15.6 h | Not Recommended | https://steamcommunity.com/id/kressnik/recommended/5335510/ |
| R6 | 33.6 h | Not Recommended | https://steamcommunity.com/profiles/76561198246259284/recommended/5335510/ |
| R8z | 57.4 h | Not Recommended | https://steamcommunity.com/id/z0rkie/recommended/5335510/ |
| R9 | 8.7 h | Not Recommended | https://steamcommunity.com/profiles/76561198103349147/recommended/5335510/ |
| R10 | 10.2 h, 439 helpful | Not Recommended | https://steamcommunity.com/id/Urgilash/recommended/5335510/ |
| R13 | 7.7 h | Not Recommended | https://steamcommunity.com/id/Napstoura/recommended/5335510/ |
| R14 | 7.2 h | Not Recommended | https://steamcommunity.com/profiles/76561199008466686/recommended/5335510/ |
| R20 | 19.8 h | Not Recommended | https://steamcommunity.com/id/heptagon/recommended/5335510/ |
| R-funny1 | 11.3 h | Not Recommended | https://steamcommunity.com/id/StalKaras/recommended/5335510/ |
| R-funny-mislead | 6.0 h | Not Recommended | https://steamcommunity.com/profiles/76561198115721884/recommended/5335510/ |
| R-pos1 | 38.0 h | Recommended | https://steamcommunity.com/profiles/76561198397904892/recommended/5335510/ |
| R-pos2 | 30.6 h | Recommended | https://steamcommunity.com/id/cattheduck3/recommended/5335510/ |
| R-pos3 | 40.4 h | Recommended | https://steamcommunity.com/id/c4bbage/recommended/5335510/ |
| R4 | 12.1 h | Recommended | https://steamcommunity.com/id/oshenp/recommended/5335510/ |
| R5 | 34.7 h | Recommended | https://steamcommunity.com/id/MiindfreakkXIII/recommended/5335510/ |
| R6b | 21.1 h | Recommended | https://steamcommunity.com/profiles/76561199095860638/recommended/5335510/ |
| R7b | 24.2 h | Recommended | https://steamcommunity.com/id/-JimSum/recommended/5335510/ |
| R8 | 50.2 h | Recommended | https://steamcommunity.com/id/dragonsloth/recommended/5335510/ |
| R12 | 18.0 h | Recommended | https://steamcommunity.com/id/NaomiRed/recommended/5335510/ |
| R16 | 97.6 h | Recommended | https://steamcommunity.com/profiles/76561198969082977/recommended/5335510/ |
| R21 | 9.1 h | Recommended | https://steamcommunity.com/id/Edictman/recommended/5335510/ |
| R25 | 87.4 h | Recommended | https://steamcommunity.com/profiles/76561198825115380/recommended/5335510/ |
| R26 | 31.0 h | Recommended | https://steamcommunity.com/id/IcewaterCreek/recommended/5335510/ |
| R27 | 7.4 h | Recommended | https://steamcommunity.com/profiles/76561198286883421/recommended/5335510/ |
| R-recent70 | 70.1 h | Recommended | https://steamcommunity.com/profiles/76561199235478845/recommended/5335510/ |
| R-trend-cozy | 9.4 h | Recommended | https://steamcommunity.com/profiles/76561198627739903/recommended/5335510/ |

R7 (the per-player-upgrade complaint, 11.5 h, Not Recommended): https://steamcommunity.com/profiles/76561198358911128/recommended/5335510/
