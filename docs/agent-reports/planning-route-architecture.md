# Planning route: architecture and ADR items

Markdown edits only; no code, git or installs. Sources: [planning-fix-art.md](planning-fix-art.md), [planning-fix-engineering.md](planning-fix-engineering.md), [planning-fix-handoff.md](planning-fix-handoff.md).

## 1. art cross-file: world-and-dust-simulation.md (WDS)

| Item | Status | Notes |
| --- | --- | --- |
| 1 §7.7 edge read | done | Now "noon ratio ≥ 1.45 and clean − grime ≥ 50 codes", AgX note |
| 2 §7.7 clean ground | done | Roughness = mix(0.62, 0.82, G); sparkle cell/fade per RP §14, clamp ≤ 4× diffuse and ≤ 0.6 × bloom 4.0 |
| 3 §7.7 presence mask | done | τ = 0.04 + 0.08·h_eff; w floor ≥ 1 output px; ramp 182/161/151/137/119 |
| 4 §7.7 thinning checks | done | Points to VT-M1-34 |
| 5 §7.2 stroke direction | done | R8 direction texture beside the atlas (Medium/High/Ultra, +4/8/16 MiB); lead decision recorded as superseding "no direction channel" |
| 6 §7.5 ring | done | R8 direction texture (1/1/4/4 MiB); ring-edge test reworded (Lane Broom ≤ 1 px and ≤ 20 %; Desk Duster ≤ 15 % mean luma); column renamed "Side (radius ≈ half)" |
| 7 §3.2 horizon map | done | New step 8b: 6 × 512², 8 azimuths, 2 × RGBA8, about 12 MiB, occluders < 20 m ignored |
| 8 §9 memory | done | Low 55 / Medium 67 / High 105 / Ultra 129 MiB |
| 9 "seed values" wording | done | §7.2, §7.5, §7.6 now say RP §14 is canonical; `quality.ts` generated from or checked against it |
| 10 §7.3 header | done | `webgpu` / `webgpu-compat` / `webgl2` (Tier C) |

## 2. art cross-file: performance-budgets.md (PB)

| Item | Status | Notes |
| --- | --- | --- |
| 1 §1 render scale | done | Tier B Low 0.50-0.75 / Medium 0.60-0.85; Ultra 0.85-1.00, DPR cap 2.0; "(canonical: RP §14)" |
| 2 §3 shadows label | done | B (Medium) 3 × 1024², C (Low) 2 × 1024²; own-lamp and night Earth CSM noted |
| 3 §4 shadow maps | done | ≤ 53 / 16 / 9 MiB |
| 4 §4 atlas | done | RGBA8 + direction R8 (A 32+8, B 16+4, C 8+0 MiB) in a new row; dust total row updated to 129/105/67/55 MiB |
| 5 §4 ring | done | RGBA8 + direction R8 (A 16+4, B/C 4+1 MiB) |
| 6 §4 horizon map | done | 12 MiB row, all tiers |
| 7 §10 ladder | done | Item 5 now points to RP §14.2 (the old 4-step list was replaced). Owner gate wording changed from "(G1)" to "Q21, answered at M0 Gate G1" to avoid the retired tier naming |

Also replaced the tier-C "G3" naming in PB §1 and the "quality.ts is the only numeric source" wording (RP §14 canonical).

## 3. engineering cross-file item 1: rendering-pipeline.md

| Item | Status | Notes |
| --- | --- | --- |
| Strike 0.22 / 2.4× / ratio ≥ 1.8-1.9 | skip (already done) | Verified by grep: §1 and §19 already carry art-direction §2.3 targets (ratio ≥ 1.45, ≥ 50 codes, 0.085/0.34). The remaining "2.4" hits are Earth apparent size (2.4°), unrelated |
| §14 canonical preset table | skip (already done) | §14 and its preamble already state generated/checked `quality.ts` |
| Tier naming G1/G2/G3 | skip (already done) | §2.1 naming already uses `webgpu` / `webgpu-compat` / `webgl2` and Tier A/B/C; no G1-G3 backend labels remain in any file I own |

## 4. handoff cross-file items

| Item | Status | Notes |
| --- | --- | --- |
| 1 module-boundaries rows | done | Root-owned files row extended (lockfile, root tsconfig, eslint, vitest, Prettier, ignore/editor/git files); new app build-files row; bootstrap stubs `boot.ts` and server `index.ts` noted on the two `app/**` rows (devops until M0-W1-T06, then integrator); `assets/models/**/blockout/**` on the models row; `units/` folder note in §2; "tsconfig bases" removed from the `packages/config` row (consistent with M0-W0-T02 card: compiler options in root `tsconfig.base.json`). M1 3D-art task paths: skip (rows are directory-level; the blockout row covers W3-T07) |
| 2 environments.md | done (partly pre-existing) | `MAX_ROOMS` 3 hard ceiling, `TICK_BUDGET_MS` and `CLIENT_IP_HEADER` were already present in both tables; `DB_SCHEMA` (prod/staging) added to the §7.2 table and the canonical env list |
| 5 docs/README.md | done | Created; links every doc folder and file; ADR index linked |
| 8 ADRs | done | ADR-0027 (3D art path, cites art-direction §13, Q15, Q23) and ADR-0028 (dependency policy) written; ADR-0003 follow-up note added (Tier B ladder in RP §14.2; render-spike ADR must cite M0-W3-T07); `docs/adr/README.md` index updated |

## Conflicts for the lead

- `docs/milestones/M0-foundation.md` lines ~185 and ~248 still say `MAX_ROOMS` stays 2 / default 2; environments, PB §6 and `render.yaml` say 3. Not my file; needs the milestone owner.
- ADR-0028 states "exact pins, no `^`/`~`" as policy; I did not verify the current `package.json` files or `.npmrc`; M0-W0-T02/T03 should enforce it.
- Line endings: `module-boundaries.md` and `adr/README.md` are CRLF (preserved); the other edited architecture files are LF.
