# planning-final-consistency (docs-keeper, 2026-11-12)

Status: done. Markdown only; no git.

| # | Item | Result |
| --- | --- | --- |
| 1 | MVP scope | Done. scope-tiers cuts Skiff, Survey Globe, Flare Beacons. M1: Skiff removed from W7-T01/T02/T05, W6-T02 text, D4, E2 (VM-08 to M2); W7-T03 trimmed to compass/onboarding/invite; W7-T04 retired (card, row, DAG, S17 removed); Flare Beacon pillars dropped from W6-T05. M2: Skiff into W3-T01/T02, orbit + Globe render into W1-T05, Beacon pillars into W1-T03, Globe overlay + Equipment Cards into W5-T03, Flare Beacons + Spot Check into W9-T03 (no new tasks; wave/stage caps intact). visual-target VM-08/09, VT-M1-01/23/35, S09/S11 and ui-screens U4 updated. |
| 2 | Animation CPU 2.0 ms Tier B | Done: performance-budgets §2 (slack 1.8 to 2.3 to keep 14.0 total). Tier C left at 2.5 (flag if wanted 2.0). animation-spec item 4 closed. |
| 3 | Faceplant 8.0 m/s | Done in animation-spec (land.hard 3.2-8.0, stumble > 8.0, AN-M1-05, `movement.faceplantMps`); naming-bible A9 row 19.7 m; game-feel Q6 marked resolved. |
| 4 | art-direction | Done: §6.3 state lights use the 9 bible states; §8.6 HUD follows GDD §10 / ui-screens. |
| 5 | robot panel to Equipment Card | Done in GDD, scope-tiers, M2 cards. Kept only where the banned term is quoted (naming-bible A10, ui-screens U15). |
| 6 | naming-bible | Additions already unique A1-A11 (no renumber needed, no stale refs found). Title exception added after rule 5; §1 row already says Moon Cleanup / `moon-cleanup`; stale open-note replaced. |
| 7 | OPEN_QUESTIONS Q1 | Done with history; folder rename noted as Cee's step (Q8). |
| 8 | STATUS | Log line appended; G0 row already says rename folder to `moon-cleanup`. |
| 9 | Leftover grep | No "Moon Custodians" variants outside research/agent-reports/quotes. Fixed "Moon Cleanup -> Moon Cleanup" rename artifacts (ui-screens, game-feel, U3). MAX_ROOMS: render.yaml, env docs = 3; M0-foundation line 623 fixed to 3. G1/G2/G3 only as gate IDs or "retired" notes. "1.9" contrast only as a refutation. |
| 10 | Indexes | docs/README.md lists the 3 design docs; CLAUDE.md "Where things are decided" gained one line (88 lines). |

## Open issues
- HUD-14 ping wheel (ui-screens) lists Spot Check as MVP; scope-tiers puts Spot Check in the star last-1% toolkit. Owner: game-designer/ui-ux-motion-designer.
- M1-W7-T05 audio and M1-W8-T02 still reference "T02 rig spec"; fine for Trundle only.
- Other design docs (art-direction §4-§7) still carry stale old-name mentions noted in ui-screens U3.
