# Planning route: visual docs (visual-target.md, art-direction.md)

Date: 2026-11-12 · Scope: Markdown only; owned files `docs/design/visual-target.md`, `docs/design/art-direction.md`. No code, git, installs, secrets or reference-image downloads.

## Item 1: fix-engineering cross-file item 2 (WDS §7.7 and related)

| Sub-item | Status | Where |
| --- | --- | --- |
| WDS §7.7 thinning checks | Done earlier (art fix); verified, numbers match (passes 0-4, step >= 8, no speckle, coverage within 10 points, no island > 0.5 m2) | visual-target VT-M1-34; art-direction §3.3 "Partial removal" |
| Ring-edge handoff, edge <= 2 cm, Desk Duster continuity | Done earlier; verified | visual-target §2.2 stroke-edge row, VT-M1-05b; art-direction §3.3 edge and handoff rows |
| VM-05 stripe wording (R8 stroke-direction texture) | Done now: VM-05 row names the R8 direction texture (VT-M1-06 and art-direction §3.4/§15 row 2 already said so) | visual-target §3 VM-05 |
| VT-M1-15 tread/lifetime thresholds | Done earlier; verified (8 luma darker, lug 6 luma p-p at 2.5 cm, 30 s +/- 3 s, preset lifetime +/- 10 %) | visual-target VT-M1-15; art-direction §3.5 |
| Grain readability metric | Done earlier; verified | visual-target VT-M1-16b; art-direction grain table |
| Cleanup (extra) | Removed an orphan empty table header left in art-direction §3.3 "Partial removal" | art-direction §3.3 |

## Item 2: fix-handoff cross-file item 7 (first half)

| Sub-item | Status | Where |
| --- | --- | --- |
| Interim comparator rows, CMP-02/05 at V-M1b and CMP-07 + custodian crop at V-M1c, Tier A High, Tier B Medium, Tier C Low each time | Done: new rows VT-M1-02a and VT-M1-02b, §2.6 "Where it runs" sentence made explicit, §6.2 CMP row and §6.5 matrix rows added (V-M1b, V-M1c) | visual-target §2.6, §4.2, §6.2, §6.5 |
| Placeholder quality bar for VT-M1-18/21 | Done: bar paragraph after the M1 table (five criteria, tagging, exemptions); VT-M1-18 and VT-M1-21 reference it | visual-target §4.2 |
| Asset-quality turntable check VT-M1-35 for M1 3D-art tasks | Done: VT-M1-35 extended to run per delivering task (M1-W3-T07 placeholder bar, M1-W4-T07, M1-W5-T03, M1-W6-T05, M1-W7-T02) with harness-measured §13.3 criteria; a failed turntable blocks the task review | visual-target VT-M1-35 |
| Second half (performance-budgets.md §10 Tier B ladder) | Skip: not my file | n/a |

## Item 3: stale-term grep

| Term | Result |
| --- | --- |
| "G1/G2/G3" backend names | Skip: none present in either file (both already use webgpu/webgpu-compat/webgl2 and Tier A/B/C) |
| ">= 1.9", "0.22", "2.4x" contrast numbers | Skip: none present in either file as contrast numbers (hits: visor 0.22 m, D-09 real Earth 1.9 deg, vehicle 2.4 m: all legitimate). Contrast numbers already read ratio >= 1.45, >= 50 codes, albedos 0.085 / 0.34 |
| Earth "2.4 deg" | Left unchanged (correct) |

## Observations for other owners (not edited)

- `docs/architecture/world-and-dust-simulation.md` §7.2 (still "no direction channel"), §7.3 table ("tiers G1/G2", "tier G3") and §7.7 ("ratio >= 1.9", "1.9x") are stale against art-direction §3.4/§15 and §2.3: owner is the terrain-dust-engineer/architecture side.
- VT-M1-02a/02b are new IDs: milestone files (M1-W3-T05, M1-W6-T06) should cite them in their V-M1b/V-M1c acceptance lines.
