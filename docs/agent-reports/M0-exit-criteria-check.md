# M0 exit criteria E1-E13 check (2026-11-14, read-only audit)

Provisional note: only the Intel UHD 620 laptop exists (below Tier B); Vercel/Render/Neon are not created. Every Tier A/B and hosted item is BLOCKED/provisional.

| # | Verdict | Proof (file) | Notes |
| --- | --- | --- | --- |
| E1 | PASS (local); remote CI BLOCKED | docs/agent-reports/M0-release-checklist-v0.1.0.md (verify 52/52 exit 0) | M0-visual-check-final.md reports prettier format:check failure on 3 files afterward; re-run verify once. No GitHub CI yet. |
| E2 | PARTIAL | docs/agent-reports/M0-closeout-smoke.md, M0-W1-T05-qa-test-engineer.md | Local only; Vercel main run BLOCKED (no project). |
| E3 | PARTIAL | docs/agent-reports/M0-W1-T02-T03-backend.md, M0-neon-swap.md | Local /healthz + isolated Postgres; hosted Render/Neon and migrations over real TLS BLOCKED. |
| E4 | PASS | docs/agent-reports/M0-W0-T01-contracts-architect.md, M0-final-code-review.md | Lint boundary rules in verify. |
| E5 | PASS | docs/vendor/three-r187/README.md (tag r187, tree SHA, raw URLs) | Snapshot dirs present. |
| E6 | PASS | .claude/hooks/block-git.mjs, .claude/hooks/block-git.test.mjs (25 cases) | Matrix test inside verify; not re-run by this audit. |
| E7 | PARTIAL / Tier A,B BLOCKED | docs/agent-reports/M0-perf-verdict.md, tools/perf/results/M0/ (matrix-*, sweep-*, rerun, idle) | Verdict "NOT PASSED, CONDITIONAL": 1 run per cell, 8-12 s captures, UHD 620 only. No render-spike ADR found (ADR-0003 only lists the requirement, lines 53/65); Babylon trigger not evaluated in an ADR. |
| E8 | PARTIAL | docs/agent-reports/M0-W2-T04-longrun-qa-test-engineer.md, tools/bots/results/M0/M0-W2-T06-integrated-clean-20-10.md | 600 s 6-bot 20/10 clean + typical PASS. 30/20 BLOCKED (env rejects; 30/15 run instead). uWS HTTP: plain uWS handlers chosen (M0-W1-T04-netcode-engineer.md). Only a 60 s result is in tools/bots/results/M0/. No netcode-spike ADR (ADR-0025 lines 35/40 still open); ADR-0031 is local-first only. |
| E9 | PASS | docs/agent-reports/M0-W2-T05-terrain-dust-engineer.md | Slope PASS (3.28% >30deg, max 50), 114 s bake; E_high stepped down to 2; LDEM_64 NO-GO estimate only (not downloaded). Cube files not opened by this audit. |
| E10 | PARTIAL | docs/agent-reports/M0-visual-check-final.md; docs/visual-reviews/M0/final/ | See below. |
| E11 | PARTIAL | docs/agent-reports/M0-release-checklist-v0.1.0.md | External evidence recorded as BLOCKED; STATUS not checked here. |
| E12 | PASS | docs/agent-reports/M0-W0-T06-technical-artist.md | Rock + hab via Blender 4.5.10, hashed glTF, checker passes proof, fails oversize fixture; 7 KTX2 warnings. |
| E13 | PARTIAL | docs/agent-reports/M0-W2-T07-rendering-engineer.md; tools/perf/results/M0/ | r187 matrix: 13 PASS both backends, row 5 custom node, row 13 storage textures FAIL on webgl2, row 11 N/A webgl2. Tier A/B recorded BLOCKED. |

## E10 (VT-M0-01..16) unresolved, from M0-visual-check-final.md
- 10 HUD: FAIL at DPR 1 and 2; fix in M0-closeout-vt10.md measured but reviewer re-check pending (V1 blocker).
- 11 Frame-time overlay: BLOCKED (no Tier A/B hardware).
- 12 Harness output: PARTIAL (A-High column not run; sidecars lack camera pose/knobs).
- 01 sky black and 14 Earth size: FAIL as written, waived as diagnostics per REFERENCE_TARGET.
- 04b: Low far shadow length FAIL (backend-independent); 03 Low map size/debug view, 07 final-code, 13 10 s stars, 09 S02 final code: NOT RUN.
- Known look defects: toothed far shadows, no ground at path end, sky seam; RF-03 motion NOT RUN.
- V2 open count (<=3 with tickets) not confirmed in reports.

Summary: 4 PASS (E4,E5,E6,E9)+E12 and E1 locally, the rest PARTIAL; no spike ADRs for E7/E8 and VT-M0-10 re-check are the main gaps.
