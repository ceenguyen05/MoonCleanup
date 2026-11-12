# Planning fix: handoff, milestones, kickoff and agent files

Status: complete
Date: 2026-11-12
Input: `planning-review-fable-dry-run.md` (all findings) and the scheduling findings F3, F4, F16 of `planning-review-technical-art-director.md`.
Scope: Markdown only. Game title unchanged (Moon Custodians). No git, installs or secrets; `.claude/settings.json` untouched.

Abbreviations: **M0** = `docs/milestones/M0-foundation.md`, **M1** = `docs/milestones/M1-mvp.md`, **KICK** = `docs/handoff/FABLE_KICKOFF.md`, **ORCH** = `docs/handoff/AGENT_ORCHESTRATION.md`, **SETUP** = `docs/SETUP_CHECKLIST.md`.

## Fable dry-run findings

| Finding | Fix | File(s) |
| --- | --- | --- |
| **B1** G0 not verifiable by the lead | New KICK §2 "How the lead verifies G0": folder name, `git rev-parse --abbrev-ref HEAD`, `git log -1 --oneline`, `git status`; remote and `release` confirmed by asking Cee (denied commands). Kickoff prompt step 2 points at it. M0 §4 G0 row carries the same text | KICK, M0 §4, STATUS |
| **B2** no planning commit plan | G0 row, SETUP §2.2, KICK and STATUS reference `docs/handoff/commit-plans/planning-session.md` (lead writes it). SETUP §2.2 now has the exact first-push commands for an unborn repo (`git branch -M main`, `remote add`, `push -u`, `branch release`, `push -u release`) | SETUP §2.2, KICK, M0 §4, STATUS, commit-plans/README |
| **B3** T03 cannot pass without `app/` entry files | T03 owns (lead-delegated) minimal no-op stubs `apps/client/src/app/boot.ts` and `apps/server/src/app/index.ts`; `main.ts` is a one-line import; server entry path stated; T05 only extends the stubs; M0-W1-T06 integrator replaces them. Folder READMEs updated | M0 T03/T05 cards + §5, apps/client/README, apps/server/README |
| **M1** install contradictions | One exception defined once (ORCH §3 rule 5): "M0-W0-T02 (devops-engineer) performs the FIRST install; after that, installs happen only between waves by devops-engineer." Mirrored in CLAUDE.md (NEVER list), devops-engineer.md (Installs, Working rules, `Installer: yes` in brief), integrator.md, lead-orchestrator.md, launch-wave.md, plan-wave.md, verify.md, SETUP §2.6 (agent creates the lockfile, Cee reviews and runs `pnpm approve-builds`), SETUP §10, README, KICK prompt, waves/README, milestones/README (DoD item 3, W0 = installs-then-contracts). ORCH brief template gets `Installer: yes/no` and `Stage` | CLAUDE.md, ORCH §3/§4/§5/§6, `.claude/agents/devops-engineer.md`, `integrator.md`, `lead-orchestrator.md`, `.claude/commands/launch-wave.md`, `plan-wave.md`, `verify.md`, SETUP, README.md, KICK, waves/README, milestones/README |
| **M2** no permission mode | New KICK §1 and SETUP §2.7 "Permission mode": `--permission-mode acceptEdits` (or auto), prompts for `pnpm install`/web fetches surface in the main session, one prompt for T04's settings edit, optional allow rules for `pnpm *`, `node *`, `npx playwright *` in `.claude/settings.local.json`, never git. Also in ORCH §1 and lead-orchestrator.md | KICK, SETUP, ORCH, lead-orchestrator.md |
| **M3** no wave file written | KICK prompt step 3 and §7: run `/plan-wave M0-W0` first, it WRITES `docs/handoff/waves/M0-W0.md` before any launch; later-session prompt re-checks. `/plan-wave` skips the "previous wave done" check for M0-W0. ORCH §1 states the rule; plan-wave/launch-wave/lead-orchestrator/milestones README/waves README updated | KICK, ORCH, `.claude/commands/plan-wave.md`, `launch-wave.md`, lead-orchestrator.md, waves/README, milestones/README |
| **M4** contracts-architect forbids own package | Line replaced: "You are the only role that edits `packages/shared`; do so only inside the owned files of a W0/contracts-wave brief. Other packages' code is never edited by you." | `.claude/agents/contracts-architect.md` |
| **M5** two owners of `shared/package.json` | T01 narrowed to `packages/shared/src/**`, `tsconfig.json`, optional `vitest.config.ts`, README; **not** `package.json` (T03 wires scripts). Criterion now `pnpm exec tsc -p packages/shared/tsconfig.json` and `pnpm exec vitest run --root packages/shared` exit 0. shared README says who replaces the scripts | M0 T01 card, packages/shared/README |
| **M6** tsconfig-base contradiction | Decision: root `tsconfig.base.json` is the single base; `packages/config` exports ESLint/Vitest/Prettier only; no project references in M0. T02 owns root `vitest.config.*`, `.gitignore`, `.gitattributes` too; `@types/node` added to config devDependencies. devops-engineer.md and config README aligned | M0 T02 card, `packages/config/README.md`, devops-engineer.md |
| **M7** T04 live git check | Replaced by matrix test (≥ 40 cases, both live examples piped as JSON) plus ≥ 5 read-only quoted/grep allow cases; explicit rule that no agent runs a real `git commit`. Cee step at new Gate G0b: new session, `git status` allowed, `git commit --dry-run -m x` blocked. Hook command string, `node --test ".claude/hooks/*.test.mjs"` specified. CLAUDE.md NEVER line and devops-engineer.md updated | M0 T04 card + §4, SETUP §2.7, CLAUDE.md, devops-engineer.md |
| **M8** vendored-docs sources | Read-first gains tech-stack §4 and `rendering-case-threejs.md` Sources [5], [9], [16], [17]; files fetched from the `r187` tag raw URLs and wiki Migration Guide r180–r187; HTML to Markdown/raw source; backdrop-water replaced by `webgpu_postprocessing_traa` and `webgpu_postprocessing_smaa` | M0 T04 card |
| **M9** Aiven single-DB fallback | Workable via schemas: Q19 default is one DB with Postgres schemas `prod`/`staging` selected by `DB_SCHEMA` (Drizzle `pgSchema`/`search_path`); SETUP §3 tells Cee not to stop; M0-W0-T03 adds `DB_SCHEMA` to render.yaml/.env.example; M0-W1-T02 env schema and M0-W1-T03 migration/`/readyz` criteria use it | OPEN_QUESTIONS Q19, SETUP §3, M0 T03/W1-T02/W1-T03 |
| **M10** M0-W0 commit timing | New Gate G0b after M0-S2: Cee commits M0-W0 per `commit-plans/M0-W0.md` (lockfile included) before M0-S3; G1 row now "Commit M0-W1"; T05 DoD names the gate; ORCH §14 item 4 states commit-before-next-wave | M0 §3/§4/T05, ORCH §14, KICK |
| **M11** M1-S1 parallel installs + contracts | M1-S1 = T04 (installs) first, T01/T03 launch when it reports; T01/T03 depend on T04; lead writes dependency ADRs first (new decision D6); same install-first ordering for M2-S1 (T03) and M3-S1 (T02); DAG updated | M1 §3/§4/§6/§7/W0 cards, M2, M3, milestones/README |
| **M12** prototypes outside workspace | Decision: prototypes are **not** workspace packages; each has a throwaway `package.json` + lockfile installed only inside its folder (`pnpm install --ignore-workspace`) by devops-engineer in the W0 install task; prototypes import production code by relative path to `packages/*/src/index.ts`. Documented in prototypes/README, M1 W1 common note, M1-W0-T04, M0-W4-T01, milestones/README, devops-engineer.md, ORCH | prototypes/README, M1, M0, milestones/README, devops-engineer.md, ORCH |
| **m1** kickoff §6 vs §7 | KICK rewritten; brief section points to M0 §7 | KICK |
| **m2** two brief templates | ORCH §6 is canonical (Stage, Installer added); KICK references it | ORCH, KICK |
| **m3** T02 criterion trivial | Added `pnpm exec eslint packages/config` + fixture suite exit 0; root `vitest.config.*` owned; no deprecated `vitest.workspace` | M0 T02, config README |
| **m4** config typecheck | `@types/node` 26.6.6 in config devDependencies (ADR-0001) | M0 T02, config README |
| **m5** ownership gaps | Not my file: listed under Cross-file items; M0 §8 note 2 lists every row to add | M0 §8 |
| **m6** hook details | Command string, test glob, quoted-string/grep allow cases specified | M0 T04 |
| **m7** stale notes | M0 §8 items 1, 4, 5 marked resolved; T04 DoD stale note removed; T03 text fixed; M1 D3 resolved; ROADMAP open issues 1, 4, 6 resolved; T03 Earth 2.4° | M0, M1, ROADMAP |
| **m8** MAX_ROOMS | Env schema card says default 2; M0 note resolved; environments.md fix is a cross-file item | M0, cross-file |
| **m9** NODE_OPTIONS | Wording changed to "keeps" | M0 T03 |
| **m10** smoke-webgl2 empty | `--pass-with-no-tests` required in W0 | M0 T03 |
| **m11** integrator contradictions | Own-row rule kept, "set no task rows" removed; single report `<M#-W#>-integration.md`; agent-reports README says so | `.claude/agents/integrator.md`, agent-reports/README |
| **m12** filename case | Standardized on `M0-W0.md` in waves/README and commit-plans/README | waves/README, commit-plans/README |
| **m13** report template | `Status: in-progress \| in-review \| blocked` + "Done so far / Next" section | agent-reports/README |
| **m14** T01 content guesses | Read-first adds netcode §4.1/§10/§15, data-model §6; opaque service types; `units/` folder created by T01; handshake aligned with netcode §13 (version in join options, `onAuth`) | M0 T01 |
| **m15** ci.yml comment | T03 criterion requires updating it (file owned by T03 at runtime) | M0 T03 |
| **m16** SETUP wording | Timing note now "0-5", UptimeRobot section 8 after Render; §2.2 concrete commands | SETUP |
| **m17** release without checklist | SETUP §6 and G1 row: `release` stays at the planning commit, production build fails harmlessly until `v0.1.0` | SETUP, M0 §4 |
| **m18** two Tier B defaults | Q21 now matches M0: iGPU of the Tier A laptop (Windows graphics settings), Tier B provisional; Cee answers at G1 | OPEN_QUESTIONS Q21, M0 |
| **m19** orchestration inconsistencies | ORCH §14 example fixed (`M1-S3 = M1-W1 T01–T02`); canonical reading order in ORCH §13 (kickoff references it); lead-orchestrator.md and ORCH roster say the paste in a plain session is canonical, `--agent` optional | ORCH, KICK, lead-orchestrator.md |
| **m20** `docs/README.md` missing | Not my file; cross-file item | — |
| **m21** M1 skim | W1-T01 cube passed as `ArrayBuffer` and fixture path `assets/terrain/fixtures/` (M0-W2-T05 adds it); W0-T03 balance-reviewer limited to schema coverage; W0-T04 files listed explicitly | M1, M0, assets/terrain/README |

## Technical-art-director scheduling findings

| Finding | Fix | File(s) |
| --- | --- | --- |
| **F3** spike used stand-in terrain, ran before look-dev, no Tier B device | M0-W2-T02 is now bench **v0** (stand-in plus a worst-case terrain-shader stub with the full WDS §7.7 / RP §7 fetch/ALU load). New **M0-W3-T07** (rendering-engineer): bench v1 with the real regolith material and the real baked `height-cube-256.bin`. Stage order: S7 = netcode run + look-dev v0 + regolith v0; S8 = T07 ∥ UI, then the **render capture (T02)**, then close. E7 and the ADR-0003 decision use the post-look-dev, real-terrain run; stand-in run kept as a comparison column. Pre-declared Tier B fallback ladder (2 detail layers, screen-derivative normals, 0.5 scale floor). Tier B device = Q21, answered at G1 (fallback: Tier A laptop's iGPU via Windows graphics settings, verdict provisional) | M0 §2/§3/§4/§5/§6/§7, ROADMAP, KICK §6, OPEN_QUESTIONS Q21 |
| **F16** first playable looks too late | V-M1b (M1-S9) now defined as "first playable that already looks good": W2 light/sky/regolith plus new **M1-W3-T07** (technical-artist): blockout custodian + Desk Duster v0 + chunky-pebble grains v0; `/visual-check` includes a custodian crop; perf check on Tier A High and Tier B Medium; interim comparator CMP-02/05 recorded (final comparator still W9) | M1 §1/§4/§6/W3 cards, ROADMAP |
| **F4** 3D art production tasks missing | New decision **D5** (production path, ADR before M1-S9, placeholder quality bar) and OPEN_QUESTIONS **Q23** (default: scripted procedural modelling in `tools/asset-pipeline`; external base meshes or Blender only with Cee's approval). New **M1-W4-T07** (technical-artist): production custodian suit + Desk Duster, Whisk Brush, Bristle Broom, Lane Broom, 1080p turntables, rig spec for animation-engineer; W5-T04 (animation-engineer) now depends on it. M1-W5-T03 retargeted to Outpost Boreal hero hardware v1 (Assay Counter, Receiving Gate, Dump Plate, floods) + custodian polish; W6-T05 = kit part 2 (Motor Pool, Desk, Console, Beacons); W7-T02 Trundle/Skiff via the D5 pipeline. Stage rule kept: S9 = T04 ∥ T07; S11 = T02 ∥ T04 ∥ T07 (≤ 3 implementers). Task counts: M0 27, M1 60; stage counts unchanged (8, 21) | M1, ROADMAP, STATUS, OPEN_QUESTIONS, tools/asset-pipeline/README |

## New decisions/gates introduced (for the lead)

- **G0b** (after M0-S2): Cee commits M0-W0 and checks the git hook in a new session.
- **D5** (3D art production path ADR before M1-S9) and **D6** (dependency ADRs before each milestone's W0 install task); OPEN_QUESTIONS **Q23**.
- Task IDs added after the integrator keep their number (`M0-W3-T07`, `M1-W3-T07`, `M1-W4-T07`); the stage plan and Depends column are authoritative, not ID order (milestones/README §3).

## Cross-file items (files I do not own)

1. `docs/architecture/module-boundaries.md` §3: add rows (owner devops-engineer) for `pnpm-lock.yaml`, `eslint.config.*`, Prettier files, `.prettierignore`, `.editorconfig`, `.gitignore`, `.gitattributes`, root `tsconfig.json`/`vitest.config.*`, app build files, and the two T03 bootstrap stubs `apps/client/src/app/boot.ts` and `apps/server/src/app/index.ts` (devops until M0-W1-T06, then integrator). Remove "tsconfig bases" from the `packages/config` row (line ~74). §2: note the `units/` folder is created by M0-W0-T01. Add `assets/models/**/blockout/**` and the M1 3D-art task paths if rows are path-level.
2. `docs/architecture/environments.md` §7.2 (line ~145) and §9 (line ~189): `MAX_ROOMS` default 2 (not 4); add `DB_SCHEMA` (`prod`/`staging`) to the env list and the staging-vs-prod table.
3. `render.yaml` and `**/.env.example`: add `DB_SCHEMA` (T03 does it at runtime; the doc side is item 2). `.github/workflows/ci.yml` lines 4–5 comment ("owner generates the first lockfile") is updated by T03.
4. `docs/handoff/commit-plans/planning-session.md`: the lead writes it (referenced as a link in SETUP §2.2, KICK, STATUS, M0 G0 row, commit-plans/README).
5. `docs/README.md` does not exist but module-boundaries §3, `docs-keeper.md` and `update-docs.md` reference it: create it via docs-keeper or drop the references (m20; `docs/README.md` is outside my ownership list).
6. `docs/research/tech/rendering-case-threejs.md`: its source URLs [5], [9], [16], [17] point at `master`; T04 is told to use the `r187` tag (optionally fix the research doc).
7. `docs/design/visual-target.md` §4.2/§6: add the interim comparator rows (CMP-02/05 at V-M1b on Tier A High and Tier B Medium), the blockout-asset "placeholder quality bar" for VT-M1-18/21, and an asset-quality turntable VT for M1-W4-T07; `docs/architecture/performance-budgets.md` §10: a Tier B fallback ladder (2 detail layers, screen-derivative normals, 0.5 scale floor) next to the 7.0 ms terrain line.
8. `docs/adr/`: the lead writes the D5 (3D art path) and D6 (dependency) ADRs; the M0 render-spike ADR must cite the M0-W3-T07 run.
9. `.claude/settings.json`: no change by me. T04 adds only the `hooks` block (one approval prompt expected).
