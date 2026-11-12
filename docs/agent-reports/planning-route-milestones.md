# Planning route: milestones, config, setup and READMEs

Status: complete · Date: 2026-11-12 · Planning-only edits (Markdown/YAML/JSON-config). No git, no installs, no secrets.
Inputs: `planning-fix-art.md` (Milestones + OPEN_QUESTIONS 1–12, Other files 1), `planning-fix-engineering.md` (cross-file 3–10), `planning-fix-handoff.md` (cross-file 3), the coordinator's items 4–5.
Abbreviations: M0/M1 = the milestone files; RP = rendering-pipeline; AD = art-direction.

## Art report (planning-fix-art.md)

| # | Item | Result | Where |
| --- | --- | --- | --- |
| 1 | Tier B iGPU = owner gate (Q21) | done | M0 §4 G1 (gate passes only when Cee names the device or chooses the provisional fallback), G2 (device ready), E13, §8 note 3; OPEN_QUESTIONS Q21 ("owner gate G1"); ROADMAP §3 and issue 7 |
| 2 | M0-W2-T02 worst-case terrain stub, second capture gating ADR-0003, look-dev schedule | done / partly | T02 stub now lists 3 detail layers, plot-ID + 7 dots, ring + atlas + both direction taps, horizon-map term, sparkle, 4-tap berm, plus the terrain camera-only velocity check. The second capture (M0-W3-T02 on bench v1, post look-dev) gates ADR-0003; the first is the bench-v0 capture in M0-W2-T06. **Look-dev in W2: not moved** — T03/T04 depend on the W2 integrator and the G2 commit, so they stay the first work of W3 (S7); scheduling note added to S7 |
| 3 | M0-W2 task "r187 feature verification" | done | New row + full card **M0-W2-T07** (rendering-engineer, S6), RP §21, 15 rows on `webgpu` and `webgl2`; T06 depends on it; DAG, E13 |
| 4 | M0-W1-T05 `tools/screenshots/measure` | done | luma, 10–90 % edge, Sobel, b*, disk size, star count, temporal variance, synthetic-chart tests, frame-stepped capture, turntable capture, generated `index.md` |
| 5 | M0-W3: VT-M0-04b, 15, 16, `webgl2` real-shader capture, VT-M0-06 with AgX on | done | W3-T03 (04b/15/16), W3-T04 (calibration 126/181/213 ± 8; ratio ≥ 1.45, ≥ 50 codes; albedos 0.085/0.34), W3-T02 + W3-T07 (`webgl2` capture); E10 now VT-M0-01…16 |
| 6 | Asset-pipeline proof; Cee decides Blender (Q23) | done | New row + card **M0-W0-T06** (technical-artist, S2, after T03); E12; G0 row carries the Blender decision; SETUP section 0; Q23 default rewritten |
| 7 | "Read first" lines: RP §14 canonical presets | done | M0-W0-T01, W1-T01, W2-T02, W2-T07, W3-T03, W3-T04 |
| 8 | Close Earth size M0 note 4 / M1 D3 | skip (already resolved by the earlier pass); M0 W3-T03 acceptance already says 2.4° resolved |
| 9 | M1-W3-T07 "chunky-pebble grains" | done | grime-tinted grains 1–3 cm world (≈ 3–8 px), rounded quads, 15 % glints, never faceted mesh pebbles; also in M1 §1, status row, ROADMAP |
| 10 | M1-W3-T07 acceptance = AD §13.4 | done | custodian acceptance, D5 text and visual acceptance (also VT-M1-35 turntable) |
| 11 | Interim comparators + VT-M1-30 at M1-W3 | done | W3-T05: CMP-02/05 on A High + B Medium + C Low, VT-M1-30; W6-T06: CMP-07 + custodian crop on the same three; M1 W8-T05 `G2-Low` renamed to Tier C Low (`webgl2`) |
| 12 | Turntables VT-M1-35; VT-M1-05b/34/16b | done | W4-T07, W5-T03, W6-T05, W7-T02 (+ W3-T07, V-M1c); VT-M1-05b and 34 in W3-T02; 16b in W3-T07, W6-T03, W6-T06 |
| 13 | ADRs | skip (another agent); ADR-0027 (3D art path) and ADR-0028 (dependency policy) are referenced in D5, M0-W0-T06, W3-T07, W4-T07, W5-T03, W7-T02, Q23, asset-pipeline README |
| O1 | `/visual-check` per VT §6.6 | done | Naming pattern, generated `index.md` (replaces `REVIEW.md`), measure step, comparator Part 2 by Cee in a browser, "never download reference images", Tier A/B/C incl. floor/ceiling |
| Q23 | OPEN_QUESTIONS Q23 | already present; default updated (Cee installs Blender LTS when the M0 proof starts) |

## Engineering report (planning-fix-engineering.md)

| # | Item | Result | Where |
| --- | --- | --- | --- |
| 3 | M0 items | done | `MAX_ROOMS` 3 + `TICK_BUDGET_MS` + `CLIENT_IP_HEADER` (W0-T03, W1-T02); `protocol/messages.ts` catalog first in W0-T01; W1-T04 Colyseus `exposedMethods`/`reserveSeatFor`/manual `broadcastPatch` checks; W3-T01 health-check traffic, client-IP header + forged-XFF, GC flags; Vercel deploy hook as Cee step (SETUP section 7); Tier B device + stub + `webgl2` capture (above). Precomputed grid binaries: noted in W3-T01 for M1 (no M0 task) |
| 4 | M1 `DUST_*` names, ledger vectors V1–V5 | done | W4 codecs and client net, W3-T01 (vectors V1–V5, ADR-0026 units), W0-T01 ledger wording |
| 5 | ROADMAP `MAX_ROOMS` | done | issue 6: ceiling 3 + tick budget |
| 6 | SHA pins | done for owned files | Verified through the GitHub API (tag, annotated tag dereferenced for pnpm, then commit lookup): checkout v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, setup-node v7.1.0 `949feb2413d6458794dcd2491c4babbbce0c15c1`, pnpm/action-setup v6.1.1 `73e46992e05b19abd31f2f3c20e0e7370d762115`, actions/cache v6 `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` (a moving major tag; comment says v6). Pinned in ci.yml (9 checkouts) and setup-workspace. **`PIN_ENFORCE` left "false"**: `asset-validation.yml` and `release-client.yml` (not mine) still use `actions/checkout@v7`; enforcing now would fail CI. Comment in ci.yml says to flip it after they are pinned |
| 7 | client README | done | `_app` Vite output, `/assets/` hashed + manifest, meta-CSP `connect-src` injection (Vite config itself is not mine) |
| 8 | READMEs | done | assets/*/README.md (hashed names + manifest), asset-pipeline, terrain-bake (hashed outputs, manifest, horizon map); M0-W2-T05 criterion aligned |
| 9 | SETUP_CHECKLIST | done | Render region confirmed before first Blueprint apply; Vercel Deploy Hook (branch `release`), secret `VERCEL_PROD_DEPLOY_HOOK_URL`, variable `PROD_SERVER_HTTP_URL`; peppers now Render-generated (section 5 and 6 table) |
| 10 | bot-test / perf-check / release-checklist | done | bot-test: local default, `--staging` ≤ 5 min, never production, sim reconciler; perf-check: Tier C, no production target, local bot report; release-checklist: release-client gate item, egress and instance-hours item |

## Handoff report (planning-fix-handoff.md)

| Item | Result |
| --- | --- |
| cross-file 3: `DB_SCHEMA` in render.yaml and `.env.example` | done (prod = `prod`, staging = `staging`; `apps/server/.env.example`); M0-W0-T03 now only verifies it and adds `NET_SPIKE` |
| cross-file 3: ci.yml first-lockfile comment | done (created by M0-W0-T02, committed at G0b) |

## Coordinator items 4–5

- **Local toolchain step**: done, SETUP_CHECKLIST section 0 (fnm 1.39.0, Node 26.13.1, pnpm 11.28.9, actionlint 1.7.12, the full winget-path PowerShell profile line, optional `~/.bashrc` equivalent, `node -v` → v26.13.1 check, Docker optional).
- **Terminology grep**: no `G1/G2/G3` backend names, `≥ 1.9`, `0.22` or `2.4×` remained in my files; the only stale tier name was `G2-Low` in M1-W8-T05 and M0-W3-T06 (both now Tier C Low on `webgl2`). Gate IDs G0/G0b/G1/G2/G3 were kept. Contrast numbers added only in their new form (ratio ≥ 1.45, ≥ 50 codes, albedos 0.085/0.34).
- **actionlint 1.7.12** (full winget path) on `.github/workflows/*.yml`: exit 0, no findings.

## Judgement calls and open points for the lead

1. **Wave cap**: M0-W2 now lists 6 implementation rows (T01–T05 + new T07); the card says to run T07 as a continuation of T02's session or in the next slot. M0-W3 already had 6 (T07 from the earlier pass). Stage caps hold (S6 = T04, T05, T07). Lead may prefer to merge T07 into T02.
2. **M0-W3-T01 staging runs cut to ≤ 5 min each** (netcode §17 / environments §5 cap); 10-minute runs now local. E8 reworded.
3. M0-W0-T06 puts a technical-artist task in W0 (the only wave with a free slot); it depends on T03's scripts and on Cee's Blender answer. Needs the `ktx` CLI for KTX2, otherwise the report records the skipped step.
4. Unowned follow-ups: pin `actions/checkout` in `asset-validation.yml` and `release-client.yml`, then set `PIN_ENFORCE: "true"`; `docs/STATUS.md` task counts (M0 now 29 rows) and `docs/milestones/README.md` mention of W0 are not mine.

## Files edited

`docs/milestones/M0-foundation.md`, `docs/milestones/M1-mvp.md`, `docs/ROADMAP.md`, `docs/OPEN_QUESTIONS.md`, `docs/SETUP_CHECKLIST.md`, `.claude/commands/{visual-check,bot-test,perf-check,release-checklist}.md`, `render.yaml`, `apps/server/.env.example`, `.github/workflows/ci.yml`, `.github/actions/setup-workspace/action.yml`, `apps/client/README.md`, `tools/asset-pipeline/README.md`, `tools/terrain-bake/README.md`, `assets/{animations,audio,models,terrain,textures,ui}/README.md`. `apps/client/.env.example` needed no change.
