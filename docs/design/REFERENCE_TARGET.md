# Reference target — Clean The Moon!

Owner direction, 2026-11-12: build a **close browser recreation of the Moon Sweepers experience**, with original
implementation/assets/branding. Fidelity to its cleaning, equipment growth, automation, world/map progression,
animation feel and appealing presentation is a product requirement, not just loose genre inspiration.
Game title: **Clean The Moon!**, selected by Cee; use this exact display name. Technical package/save identifiers stay stable.
Accepted design change: [ADR-0030](../adr/0030-reference-first-design.md). Deadline and model/usage policy still apply.

## Authority and source discipline

This file supersedes the old blanket naming bans, forced visual divergence and mandatory custom progression in older
design docs, task cards and reviews. Design order: latest owner instruction → this target → naming catalog →
scoped GDD/art/animation/feel/economy specs → historical research. Scope/perf/security/build requirements still matter.
Moon Sweepers **Steam release through 1.0.5** is the baseline as of this review. Future announced updates are not requirements.
Roblox titles and unofficial remakes are secondary context, not the target. Never silently implement a fan site's guesses.

Primary pages checked 2026-11-12:

- [Official Steam store](https://store.steampowered.com/app/5335510/Moon_Sweepers/): tiny starter brush, collecting/selling
  dust, reinvestment into equipment, vehicles and depots, visible cleaning, and solo/up-to-16 co-op.
- [Developer announcements and 1.0.4/1.0.5 notes](https://steamcommunity.com/app/5335510/): shared cleaned ground;
  off-screen robot work and field deliveries; map/waypoints/discovered-station travel; flexible building/moving/full refunds;
  improved delivery balancing, input handling and save recovery.

Detailed sizes/counts/rates in [mechanics research](../research/moon-sweepers-mechanics.md) retain their existing
community/derived confidence labels. Our 2 km radius, 163,842 cells, four-station plan and detailed tier counts are
the working reconstruction, not new independently verified official facts. Do not invent exact animation timing,
map coordinates, physics or prices where footage/data is insufficient. Measure from accessible evidence or label a tuning estimate.
This pass reviewed public descriptions/patch notes and prior visual analysis; direct media retrieval failed, so it
does not claim a fresh screenshot/trailer inspection. Before visual sign-off, inspect the linked official media in a browser.

## What must feel close

| Layer | Required direction | Acceptance / evidence |
| --- | --- | --- |
| First minutes | Absurdly small usable toothbrush/brush, visible surface removal, limited capacity, a short depot return, clear first purchase | New player can clean → fill → sell → buy without a custom mission gate; timed playtest |
| Tool growth | Narrow hand tools grow into wider/faster tools and larger containers; upgrades change the actual job | Same route before/after purchase shows contact footprint, capacity and time saved |
| Motion / camera | First-person work feel, readable held tool/contact, low-g travel and distinct driving; smooth local response | Short clips of repeated cleaning, locomotion, jump/landing and vehicle handling; no cosmetic animation driving sim |
| Cleaning payoff | Bright smooth clean paths, readable dust-layer edges and overlapping brush-width passes; visible permanent co-op progress | Ground-close and distant before/after, reconnect consistency, reference comparison |
| Expanding operation | Hand work → hauling/packing → vehicles → dock/global robots → connected logistics/processing | A real connected route with material, capacity and payment behavior; no decorative fake automation |
| World / map | Traversable curved Moon, distant terrain/landmarks, a useful globe/sector overview, stations, explored destinations and ever-larger cleaned territory | Ground/hilltop/map travel sequence; recognizable workfronts and expanding clean patches |
| Progression | Income + equipment prerequisites + discovery motivate expansion; better tools and routes open bigger jobs | Purchases/unlocks are data-driven; no percentage-cleaned or bespoke task gate added solely by our redesign |
| Co-op / persistence | Shared world progress and readable activity while each player can work; recover the operation reliably | Existing 16-player/network/save gates; no dust returning or unpaid completed cells |

## Presentation: use the reference as a style guide

Aim for the same approachable, bright, chunky, readable lunar-cleaning mood documented in
[visual analysis](../research/visual-analysis.md), using authored assets and composition.
Stylized astronaut proportions, compact work vehicles, light hardware with orange/safety accents, pale/cool lunar ground,
readable shadow fill, an Earth/space backdrop and clear equipment silhouettes are **allowed**. No rule requires teal,
bronze visors, human proportions, a palm puck brush, bird robots or strictly scientific black-sky rendering merely to differ.
Choose a coherent original asset family; do not oscillate between realism and toy-like art for each task.
Physical lunar cues are helpful when they strengthen the reference-like result, not a reason to reject it.
Tool anticipation/contact/follow-through, dust response, held-item motion and vehicle/robot action must sell the mechanism.
Prefer matching perceived action scale and response over adding expensive microdetail the reference experience does not need.

Do not extract/decompile/ship the reference's code, models, textures, audio, logos, dialogue, screenshots or UI artwork.
Do not present this as an official/endorsed release. Common words, tool categories, mechanical ideas and broad art styles
are not banned by this project's naming rules. UI information/function can match while layouts/art/text are authored.

## Remove redesign gates from the default baseline

The old docs contain a substantial custom game, not only a recreation. These defaults now apply to **reference mode**
(a design baseline, not an already implemented config flag):

| Previous custom requirement | Default now | What remains |
| --- | --- | --- |
| Performance Reviews/Briefs gate core tools, vehicles, robots and machines | Core purchases use money and legitimate equipment prerequisites; no cleaned-% gate | Optional progress celebrations; ordinary upgrade-tree dependencies |
| MVP Pilot Review required to activate first robot | Tutorial/demo milestone can suggest a purchase but cannot add a new mandatory quest gate | MVP staging can limit unimplemented content; say so honestly |
| Effort/On-Shift/Unattended ×0.5 robot multiplier, subnet bonuses | Active room robots work at their calibrated base rate independent of manual cleaning/player-count bonus | Trust validation, server budgets, reconnect and empty-room checkpoint/suspend policy |
| Bulk Rate 25% raw robot payout | Track actual material and apply its ordinary sale rule; no origin penalty solely to force active play | Processing adds value; rewards are server-authoritative and not duplicated |
| Reviews gate permits/Refits/Flight Plan/Work Front/Grades | Optional custom progression, not part of the close-reference default | Technical entity caps and scheduling budgets with visible limits; no silent slowdown |
| Mandatory Dockets, Benefits, Certifications, lore chores and renamed resource concepts | Backlog options after core fidelity; not extra launch gates | Existing accessibility, save reliability and anti-grief fixes |
| Different names, different silhouettes and different sets at any cost | Natural descriptive names and comparable equipment roles; original authored assets | Stable IDs/save compatibility and clear UI labels |

No need to reproduce known bugs or impractical native-engine limits. Browser-specific changes need a named budget/hosting
reason and evidence in the parity matrix, not an invented novelty rule. Existing custom economy tables/31-hour derivation
are **candidate tuning**, not proven reference parity; regenerate affected balance fixtures before gameplay acceptance.
Keep true M1/M2 reference systems in scope; parking custom ★ additions does not remove core tools/world/automation.

## Required fidelity checks

| ID | Check | Evidence / when |
| --- | --- | --- |
| RF-01 | Same recognizable task, equipment scale, clean-path contrast and lunar-worksite mood | Matched-intent official-media comparison: ground-close, tool-in-hand, station exterior, vehicle, factory, globe; M0 applicable scenes only |
| RF-02 | First playable loop and upgrade deliver a visible step up | Timed fresh-save browser playtest; first playable/M1 |
| RF-03 | Controls, tool action/contact, dust, locomotion and machine motion read coherently | Short clip or deterministic frame sequence; screenshots alone cannot approve animation |
| RF-04 | Map/world progress and traversal sell expanding a whole-moon operation | Walk/drive/return/map sequence plus shared cleaned-state evidence; M1 subset, M2 full |
| RF-05 | Real automation/material/payment behavior, independent of arbitrary activity gates | Unit/scenario tests plus integrated route; as those systems land |
| RF-06 | Reference changes and custom adaptations are explicit | Each changed parity row names verified/inferred/estimated status, deviation and acceptance evidence |

Use existing S/CMP scene IDs, native-resolution captures and motion harness; do not build a second review framework.
Numeric performance, crisp UI, contact, seams, stability, disposal and backend parity gates remain mandatory.
Old forced-style requirements (black-sky luma, neutral-only shadow hue, exact Earth angular size, fixed non-chibi proportions,
teal-only palette and starter-tool shape) are diagnostic/tunable, not blockers. In particular VT-M0-01/06/14/16 and
VT-M1-09/11/12/18 need reference-style interpretation; VT-M0-08 retains obvious clean-vs-dirty contrast but its old
absolute luma patches are calibration notes. Equivalent style-dependent clauses in other rows follow this same rule.
Keep one sun/shadow consistency, working shadows, no artifacts, sharp trails, motion readability, real hardware evidence
and declared performance budgets. Record RF IDs and old VT mapping in the same review so no criterion vanishes silently.

## Resume without restarting M0

Continue the current wave, known fixes, contracts, build and deploy work. No source/package slug/ID mass rename.
The next visual brief uses RF-01/RF-03 and the amended art direction, not the retired do-not-copy table.
Before the first gameplay/economy wave, contracts/game designer update the affected cards, schemas/tables and parity rows
for the default baseline above, then freeze them for consumers. Do not implement old ★ gates first and remove them later.
Lead keeps task states honest, preserves owner commit gates, and reports deadline risk without secretly replacing full scope.
