# Planning review: Fable dry run of M0-S1 / M0-S2 (plus an M1 S1–S3 skim)

Status: complete
Date: 2026-11-12
Method: I acted as a fresh Fable 5.2 lead with only the repo as context. I followed `docs/handoff/FABLE_KICKOFF.md` literally and read, in order, `CLAUDE.md` → `docs/STATUS.md` → `docs/handoff/AGENT_ORCHESTRATION.md` → `docs/milestones/M0-foundation.md` → `docs/architecture/module-boundaries.md`. I then mentally built the briefs for M0-W0-T02, T04 and T01 (stage S1) and for T03 and T05 (stage S2), and checked each one against:
- the agent files in `.claude/agents/` and the commands in `.claude/commands/`,
- every doc and section each brief cites,
- the scaffold: manifests, tsconfigs, `turbo.json`, `render.yaml`, `vercel.json`, CI, `.env.example`,
- `docs/SETUP_CHECKLIST.md` for gates G0 and G1.

I launched no agents, ran no git, installed nothing and edited no other file.

All relative markdown links in the files I checked resolve; I found no dead `](...)` links. The problems are contradictions, stale notes, ownership gaps and acceptance criteria that cannot be met.

**Totals: 3 BLOCKER · 12 MAJOR · 21 MINOR**

Severity key:
- **BLOCKER**: the lead cannot proceed.
- **MAJOR**: the lead (or an agent) would have to guess, or would likely be refused or fail.
- **MINOR**: friction or a stale or inconsistent text that has a safe default.

---

## BLOCKER

### B1. Gate G0 is not done, so the kickoff stops at step 2
- **Where:** `docs/handoff/FABLE_KICKOFF.md` lines 4–5 and step 2 (line 28). `docs/STATUS.md` line 12. `docs/milestones/M0-foundation.md` §4 row G0.
- **Finding:** The folder is still `BroswerMoonSweeper`, not `moon-custodians`. The repo has no commits, no remote and no `release` branch; everything is untracked.
  - A lead following the kickoff must stop here.
  - The lead also has no reliable way to confirm G0 itself. `.claude/settings.json` denies `git branch *` and `git remote *`, and the kickoff gives no check commands.
- **Fix:**
  1. Cee completes SETUP §0–§2.
  2. Add a "How the lead verifies G0" line to FABLE_KICKOFF §1, using only allowed read-only commands:
     - the working directory ends in `moon-custodians`,
     - `git log --oneline -1` shows the planning commit,
     - `git rev-parse --verify release` succeeds,
     - Cee confirms the push.

### B2. G0 says "commit from the lead's commit plan", but no planning commit plan exists in the repo
- **Where:**
  - `docs/SETUP_CHECKLIST.md` §2.2 line 43: "make the first commit(s) from the lead's commit plan".
  - `docs/STATUS.md` line 13: "Planning-session commit plan in the final planning report (no `docs/handoff/commit-plans/` file yet)".
  - `docs/handoff/commit-plans/README.md` is only a placeholder.
- **Finding:** The "final planning report" is not a file in the repo. Cee cannot follow §2.2 as written, so G0 cannot be completed as specified.
- **Fix:**
  1. Write `docs/handoff/commit-plans/planning.md`. It needs ordered groups, for example: scaffold/root configs, then `.github`, then `apps` + `packages` + `tools` scaffold, then `.claude`, then `docs`. Give each group exact paths and a Conventional Commit message.
  2. Point SETUP §2.2 and STATUS line 13 at that file.
  3. Add the exact first-push commands for an unborn repo: `git add …`, `git commit`, `git branch -M main`, `git remote add origin …`, `git push -u origin main`, `git branch release`, `git push -u origin release`.

### B3. M0-S2: the M0-W0-T03 acceptance criteria cannot pass, because the client and server entry points live in integrator-owned folders that do not exist until T05 (which runs after T03)
- **Where:** `docs/milestones/M0-foundation.md` M0-W0-T03 card:
  - line 172 (owned files: `apps/client/src/main.ts` "one-line bootstrap that calls `app/`"),
  - line 177 ("`pnpm verify` green …; server build → `apps/server/dist/index.js`").
  - Also the M0-W0-T05 card, line 205 ("empty-safe stubs only if typecheck needs them").
- **Finding:**
  - `main.ts` must import `apps/client/src/app/…`, which does not exist.
  - The esbuild server bundle needs an entry such as `apps/server/src/app/index.ts`, which does not exist either. `apps/server/package.json` `dev` even names `src/app/index.ts`.
  - Both `app/**` folders belong to the integrator, and T05 runs after T03.
  - T03 therefore cannot get `pnpm verify` green or produce `dist/index.js` without writing outside its owned files.
- **Fix:** Pick one option and write it into both cards.
  - (a) Run T05 first, as a tiny stub task that creates `apps/client/src/app/index.ts` and `apps/server/src/app/index.ts` with no-op exports. T03 then follows, and a final verify pass runs after it.
  - (b) Delegate exactly those two stub files to T03 ("lead-delegated, replaced by integrator in M0-W1-T06").
  - Also state the server entry path explicitly in T03 (`apps/server/src/app/index.ts`).

---

## MAJOR

### M1. `pnpm install` by M0-W0-T02 contradicts at least eight standing rules; the agent may refuse it
- **Where:**
  - `.claude/agents/devops-engineer.md` line 32: "Install dependencies only between waves … Never run installs while agents are working".
  - The same file, line 47: "No dependency installs (`pnpm add`/`install`/…) … devops-engineer installs them between waves". This is boilerplate that forbids the role its own job.
  - `CLAUDE.md` line 81: "install during a parallel wave".
  - `AGENT_ORCHESTRATION.md` §3 rule 5 (line 57) and §4 (line 65): "Must be sequential: … dependency installs".
  - `docs/handoff/waves/README.md` line 19.
  - `.claude/commands/launch-wave.md` line 19: precondition "No agent is allowed to install during the wave".
  - `docs/SETUP_CHECKLIST.md` §2.6 line 62: Cee runs `pnpm install`. T02 is told to read this section.
  - `.github/workflows/ci.yml` lines 4–5: "the owner generates the first lockfile".
  - Against all of these, T02 (M0-foundation line 163) and FABLE_KICKOFF line 88 ("ONLY M0-W0-T02 may run `pnpm install`") require the install, while T04 runs in parallel.
- **Fix:**
  1. Add one canonical exception sentence to AGENT_ORCHESTRATION §3 rule 5 and CLAUDE.md: "Exception: the W0 install task named in the milestone file runs installs; no other agent installs."
  2. Reword devops-engineer.md line 47 to "No installs unless your brief names you the installer for this wave".
  3. Rewrite SETUP §2.6 to "the agent creates the lockfile; you review it and run `pnpm approve-builds` if asked".
  4. Fix the ci.yml comment.
  5. Optionally, start T04 only after T02's install finishes. T04 needs no `node_modules`, so this only removes the "while agents are working" conflict.

### M2. No permission mode or allow rules for background subagents
- **Where:** `.claude/settings.json`, which has only `permissions.deny`. FABLE_KICKOFF §1 line 7 says only "model Fable 5.2, effort max".
- **Finding:** S1 needs `pnpm install` (network), `node --test`, WebFetch to `threejs.org`, `raw.githubusercontent.com` and `github.com`, and an edit of `.claude/settings.json` itself (T04).
  - Background subagents cannot answer permission prompts interactively. Depending on mode, those calls are denied or stall.
  - Claude Code also treats edits to `.claude/settings*.json` as sensitive.
  - Nothing tells Cee which permission mode to start the lead in.
- **Fix:**
  1. State the launch mode in FABLE_KICKOFF §1 (e.g. `claude --model fable --permission-mode acceptEdits`, or `auto`, if Cee accepts it).
  2. And/or add `permissions.allow` entries: `Bash(pnpm *)`, `PowerShell(pnpm *)`, `Bash(node *)`, `PowerShell(node *)`, `WebFetch(domain:threejs.org)`, `WebFetch(domain:raw.githubusercontent.com)`, `WebFetch(domain:github.com)`.
  3. Tell Cee to expect one approval prompt for T04's settings edit.

### M3. The kickoff never creates a wave/brief file, but `/review`, `/launch-wave`, `/commit-plan` and the reviewer agents all read one
- **Where:**
  - `.claude/commands/review.md` line 13 (input: "the task's brief in `docs/handoff/waves/<M#-W#>.md`"), line 26 (brief path passed to reviewers) and line 29 ("note the review file paths in the wave file").
  - `launch-wave.md` line 9.
  - `commit-plan.md` line 13.
  - `.claude/agents/code-reviewer.md` line 22 (must-read: the brief in `docs/handoff/waves/<M#-W#>.md`).
  - `docs/milestones/README.md` §2 item 6.
  - FABLE_KICKOFF §1 step 3 and §5 say only "build briefs … and launch".
- **Finding:** Reviewers would be pointed at a file that does not exist. The lead must guess whether to run `/plan-wave` first. That command's step 1 ("confirm the previous wave is done") has no meaning for M0-W0.
- **Fix:** Add to FABLE_KICKOFF §1 step 3: "Write the assembled briefs, owned-file table and run log to `docs/handoff/waves/M0-W0.md` (lead-owned) before launching; pass that path to `/review`." Also say that for the first wave of M0, `/plan-wave`'s "previous wave done" check is skipped.

### M4. `contracts-architect.md` forbids the role from editing its own package
- **Where:** `.claude/agents/contracts-architect.md` line 46: "Contract changes (`packages/shared`) are never edited by you. Propose them in your report and continue with a local adapter." This contradicts its Mission (line 14), Owned paths (line 18) and line 38.
- **Finding:** Copy-paste boilerplate. A literal agent could refuse M0-W0-T01.
- **Fix:** Replace line 46 with: "You are the only role that edits `packages/shared`; do so only inside the owned files of a W0/contracts-wave brief. Other packages' code is never edited by you."

### M5. `packages/shared/package.json` has two owners in the same wave, and T01's typecheck criterion is meaningless
- **Where:** `M0-foundation.md` T01:
  - line 134: owns `packages/shared/**` including `package.json`, "dependencies unchanged",
  - line 147: "`pnpm --filter @moon-custodians/shared typecheck` and `test` green".
  - T03, line 172, owns "`scripts` fields of every … `packages/*/package.json`".
  - `packages/shared/package.json` `typecheck` is `echo …`. `packages/shared/README.md` lines 37–38 say "Fable replaces them in the first source wave" without naming who.
- **Finding:** This breaks AGENT_ORCHESTRATION §3 rule 1 (one path, one owner per wave; T01 and T03 are both in M0-W0). If T01 leaves the scripts alone, its "typecheck green" is an echo, and reviewers cannot verify exit criterion E4 in S1.
- **Fix:**
  1. Narrow T01's owned files to `packages/shared/src/**` and `packages/shared/README.md`.
  2. Replace T01's criterion with "`pnpm exec tsc -p packages/shared/tsconfig.json` and `pnpm --filter @moon-custodians/shared test` exit 0". The `tsc` command works because the base config has `noEmit`.
  3. T03 then wires the real scripts.

### M6. Where the tsconfig bases live is contradictory, and T02 cannot wire them
- **Where:**
  - `M0-foundation.md` T02 line 160: "`packages/config` exports tsconfig bases (strict, `noUncheckedIndexedAccess`, ESM, project references)".
  - `packages/config/README.md` line 10: "TypeScript compiler options live in the repo-root `tsconfig.base.json`, not here".
  - `tsconfig.base.json` lines 2–3: packages extend `../../tsconfig.base.json`.
  - Every `*/tsconfig.json` extends the root base, and T02 owns none of them (`packages/shared/tsconfig.json` is T01's; the app and tool ones have no W0 owner).
  - `tsconfig.base.json` line 13 sets `noEmit: true`. That is incompatible with `composite` project references unless emit is changed.
  - There is no root solution `tsconfig.json`, and it is not in T02's owned list.
- **Fix:** Decide in the T02 card. Recommended: keep the root `tsconfig.base.json` as the single base and drop "project references" from M0. Turbo `^typecheck` ordering plus source-exported barrels already give the needed order. Then delete "tsconfig bases" from the T02 criterion and from module-boundaries §3 line 74. If references are wanted, add the root `tsconfig.json` and every per-package `tsconfig.json` to T02's owned files (lead-delegated) and specify `composite` + `emitDeclarationOnly`.

### M7. T04's "live session check" cannot be met and tells an agent to run a forbidden git command
- **Where:** `M0-foundation.md` T04 line 196: "report shows a live session check (`git status` allowed, `cd x && git commit -m y` blocked)".
- **Finding:**
  - Hooks added to `.claude/settings.json` during a session are not active in already-running sessions, including T04's own and the lead's.
  - The check also instructs an agent to attempt `git commit`. CLAUDE.md "NEVER" and AGENT_ORCHESTRATION §12 forbid that, and if the hook is wrong, the command runs.
- **Fix:** Replace it with "matrix test passes (≥ 40 cases, incl. both live examples piped as JSON into the script)". Add a Cee step after S1: "start a new session, ask Claude to run `git status` (allowed) and `git commit --dry-run -m x` (must be blocked)."

### M8. T04's vendored-docs sources are unspecified or ambiguous
- **Where:** `M0-foundation.md` T04 line 197. Its Read first (line 190) cites tech-stack §2, the rendering decision matrix, which contains no source URLs.
- **Finding:** The agent must guess:
  - **Where each item comes from.** Source URLs exist only in `docs/research/tech/rendering-case-threejs.md` references [5], [9], [16], [17]. They point at `master`, not the `r187` tag.
  - **What "TSL reference" means.** It could be the wiki page, the manual or the docs page.
  - **Which output format to use:** HTML or Markdown.
  - **Whether `webgpu_backdrop_water` is right.** It is unrelated to anti-aliasing; the "(or nearest TRAA/SMAA)" note suggests `webgpu_postprocessing_traa` / `webgpu_postprocessing_smaa` were meant.
- **Fix:**
  1. Add `rendering-case-threejs.md` "Sources" [5], [9], [16], [17] to Read first.
  2. Require files to be fetched from `https://raw.githubusercontent.com/mrdoob/three.js/r187/...` (examples, manual, `llms.txt`) and the Migration Guide wiki (r180–r187 sections only).
  3. Require HTML-to-Markdown or raw source conversion.
  4. Replace the backdrop-water item with `webgpu_postprocessing_traa` and `webgpu_postprocessing_smaa`.
  5. Swap tech-stack §2 for tech-stack §4.

### M9. G1: the Aiven two-database fallback cannot serve Render staging
- **Where:**
  - `docs/SETUP_CHECKLIST.md` §3 line 73 ("if [two DBs are] not allowed, tell the lead … do not guess").
  - `docs/OPEN_QUESTIONS.md` Q19 line 26 ("else staging uses a local/ephemeral DB").
  - M0 exit criterion E3 (staging `/readyz` reports DB state, and the first migration runs on Aiven).
- **Finding:** Render staging cannot reach a local DB, so Q19's default cannot work. Both services' build commands run `migrate` (render.yaml lines 45 and 146). If they share one database without schema separation, the two environments' migrations and data collide.
- **Fix:** Change the Q19 default to "one database, two Postgres schemas (`prod`, `staging`) selected by a `DB_SCHEMA` env var (Drizzle `pgSchema` / `search_path`)". Add `DB_SCHEMA` to environments §9, render.yaml and `.env.example` through M0-W0-T03, and to M0-W1-T03's acceptance criteria. Mention it in SETUP §3 so Cee does not have to stop and ask.

### M10. Commit timing for M0-W0 contradicts itself, so S3 might never be allowed to start
- **Where:**
  - `M0-foundation.md` §4 G1 row (line 47): "Commit M0-W0 + M0-W1 per commit plans" at G1, after S4.
  - FABLE_KICKOFF line 43 ("After each completed wave, Cee commits").
  - AGENT_ORCHESTRATION §14 item 4.
  - `.claude/commands/plan-wave.md` step 1 (next wave only after the previous one is `done`, i.e. committed).
- **Fix:** Add an explicit owner step after M0-S2: "Cee commits M0-W0 per `docs/handoff/commit-plans/M0-W0.md`, which includes the lockfile, and confirms." Change the G1 row to "Commit M0-W1".

### M11. M1-S1 runs two contracts agents and an install agent at the same time
- **Where:** `docs/milestones/M1-mvp.md` §4 line 42 (S1 = T01, T03, T04); the cards at lines 216, 250 and 267.
- **Finding:**
  - AGENT_ORCHESTRATION §4 line 65 says "Must be sequential: Wave 0 contracts; dependency installs".
  - T04 rewrites `node_modules` and the lockfile while T01 and T03 typecheck and test, which invites spurious failures.
  - T04's criterion "Only ADR-backed deps installed" has no step or owner for writing those ADRs beforehand.
- **Fix:**
  1. Reorder the stages: S1 = T04 (installs, plus the lead writing the dependency ADRs first) → then T01 ∥ T03.
  2. Or add an explicit §4 exception: "contracts agents on disjoint `shared/src` folders may run in parallel; installs never overlap them."
  3. Add "lead writes ADRs for the requested deps" as a pre-stage step in M1 §3.

### M12. The M1-W1-T02 dust harness lives outside the pnpm workspace
- **Where:** `M1-mvp.md` M1-W1-T02 (line 318: owns `prototypes/dust-sim/harness/**`); `pnpm-workspace.yaml` lines 3–8 (no `prototypes/*`).
- **Finding:** Harness and prototype code cannot resolve `@moon-custodians/world`, `tsx` or `vitest`, and has no `package.json` an owner can create. Installing into prototypes needs devops.
- **Fix:**
  - (a) Add `prototypes/*/*` to `pnpm-workspace.yaml` in M1-W0-T04 and let each prototype own a private `package.json` with `workspace:*` dependencies.
  - (b) Or state that prototypes import through relative paths into `packages/*/src/index.ts` and run with the root `tsx` and `vitest`. Note that `tsx` is not a root devDependency today.

---

## MINOR

### m1. Wrong section reference in the kickoff
- **Where:** `FABLE_KICKOFF.md` §5 line 70: "the task card in `docs/milestones/M0-foundation.md` §6".
- **Finding:** Task cards are §7; §6 is the DAG.
- **Fix:** Change §6 to §7.

### m2. Two different "copy exactly" brief templates
- **Where:** FABLE_KICKOFF §5 lines 74–99 and AGENT_ORCHESTRATION §6 lines 82–108.
- **Finding:**
  - The kickoff version drops "Visual acceptance", the quality-bar/budget constraint line and `module-boundaries §<n>`.
  - It adds "Stage" and the install exception.
- **Fix:** Make AGENT_ORCHESTRATION §6 canonical. Add "Stage" and an optional "Installer: yes/no" field there, and have the kickoff reference it instead of duplicating it.

### m3. T02's gate criterion is trivially true, so the ESLint config is never exercised in S1
- **Where:** M0-W0-T02 line 164 ("`pnpm lint`, `pnpm typecheck`, `pnpm test` exit 0 on the scaffold").
- **Finding:**
  - Every package `lint`/`typecheck` script is `echo`, so the criterion is trivially true and the ESLint config is never run in S1.
  - `packages/config/README.md` mentions a root `vitest.workspace` (deprecated in recent Vitest). Neither that file nor `vitest.config.*` is in T02's owned list.
- **Fix:**
  1. Add "`pnpm exec eslint packages/config` and the fixture suite exit 0" to the criteria.
  2. Add root `vitest.config.*` to the owned files, or drop the mention.

### m4. `packages/config` typecheck will fail
- **Where:** `packages/config/tsconfig.json` has `types: ["node"]`.
- **Finding:** Neither `packages/config/package.json` nor the root has `@types/node`. Under pnpm isolation, `tsc` fails once T02 replaces the echo script.
- **Fix:** Let T02 add `@types/node` 26.6.6 to `packages/config` devDependencies, citing ADR-0001, or set `types: []`.

### m5. Ownership gaps in module-boundaries §3
- **Where:** module-boundaries §3 line 107.
- **Finding:** The root-files row omits:
  - `pnpm-lock.yaml`,
  - `eslint.config.*`,
  - Prettier files,
  - `.prettierignore`,
  - `.editorconfig`,
  - `.gitignore`,
  - `.gitattributes`,
  - root `tsconfig.json` / `vitest.config.*`.

  The app build files (`apps/*/package.json` scripts, `apps/client/vite.config.ts`, `index.html`, `src/main.ts`, `apps/server/build.config.*`) are still unassigned, even though milestones README §7 and ROADMAP open issue 2 say the lead adds them.
- **Fix:** Add both rows (owner devops-engineer) before launching S1.

### m6. T04 hook details unspecified
- **Where:** T04 lines 194 and 196.
- **Finding:**
  - The hook command string for Windows is unspecified: shell, quoting of `$CLAUDE_PROJECT_DIR`, and `node` on PATH. The folder will also be renamed at G0.
  - `node --test .claude/hooks/` takes a directory where a test-file glob is expected.
  - There are no negative cases for read-only text containing "git commit", such as `grep -rn "git commit" docs`, which reviewers do run.
- **Fix:** Specify:
  - `"command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/block-git.mjs\""`,
  - `node --test ".claude/hooks/*.test.mjs"`,
  - ≥ 5 quoted-string and grep allow cases.

### m7. Stale notes and resolved conflicts presented as open
- **Where and finding:**
  - T04 DoD (line 200) says the lead adds `.claude/hooks/**` and `docs/vendor/**` to §3, but they are already there (module-boundaries lines 109–110).
  - `M0-foundation.md` §8:
    - item 1 says STATUS.md and FABLE_KICKOFF.md do not exist; both do.
    - item 4 says rendering-pipeline §20 item 11 says 2.6°; it says 2.4°.
    - item 5 says performance-budgets says 4; it says 2 (line 103).
  - The T03 card (line 461), `M1-mvp.md` D3 (line 35) and `docs/ROADMAP.md` lines 89, 90 and 92 repeat the same stale claims.
- **Fix:** Delete or mark them resolved.

### m8. `MAX_ROOMS` default disagreement
- **Where:** `environments.md` §7.2 line 145 (4/4/4) and §9 line 189 ("default 4"), versus performance-budgets line 103, `render.yaml` and `.env.example`, which all say 2.
- **Finding:** M0-W1-T02 builds its env schema from environments §9 and would pick 4.
- **Fix:** Set environments to 2.

### m9. `NODE_OPTIONS` is already in `render.yaml`
- **Where:** M0-W0-T03 line 180 says `render.yaml` "gains … `NODE_OPTIONS`".
- **Finding:** It is already present (lines 129–130 and 212–213).
- **Fix:** Change the wording to "keeps".

### m10. CI `smoke-webgl2` has no specs to run in W0
- **Where:** M0-W0-T03 line 179.
- **Finding:** The smoke spec is written later, by M0-W1-T05. In W0, Playwright exits non-zero ("No tests found").
- **Fix:** Add `--pass-with-no-tests`, or gate the job on `tests/e2e/specs/*.spec.ts` existing.

### m11. `integrator.md` contradicts itself
- **Where:** `.claude/agents/integrator.md` line 37 ("set no task rows yourself") vs line 48 (set own row `in-progress` / `in-review`); line 60 (`<taskID>-integrator.md`) vs line 20 (`<M#-W#>-integration.md`).
- **Finding:** M0-W0-T05 owns only the integration file.
- **Fix:** Keep the row rule from line 48 and drop line 37. Name a single report file.

### m12. Wave and commit-plan filename case differs
- **Where:** `waves/README.md` and `commit-plans/README.md` use `m0-w1.md`; the commands, cards and kickoff use `M0-W0.md`.
- **Fix:** Standardize on `M0-W0.md`.

### m13. The report template does not support incremental reports
- **Where:** `docs/agent-reports/README.md` line 20: `Status: in-review | blocked`. It has no "Done so far / Next" section, which §14 and FABLE_KICKOFF line 90 require from the start of a task.
- **Fix:** Use `Status: in-progress | in-review | blocked` and add a "Done so far / Next" section.

### m14. T01 contract-content guesses
- **Where:** M0-W0-T01, lines 135–146.
- **Finding:**
  - **`net.status` payload:** the states are in netcode §10 and M0-W1-T04, neither of which is in Read first.
  - **"M0 spike payload type IDs":** netcode §4/§15 is not cited.
  - **`bakeHash` save header:** data-model §6 is not cited.
  - **`ServiceRegistry` renderer key:** it must stay three-free, so it can only be an opaque type; this is not stated.
  - **`units` folder:** the scaffold has no `packages/shared/src/units/`, although the criterion lists a `units` sub-barrel.
  - **Handshake:** the criterion says "HELLO message", while netcode §13 puts the version in join options with `onAuth` rejecting.
- **Fix:**
  1. Add netcode §4.1, §10, §15 and data-model §6 to Read first.
  2. Say "service types are opaque interfaces; no three/Colyseus types".
  3. Add the `units/` folder or allow `ids/units.ts`.
  4. Align the HELLO criterion with netcode §13.

### m15. Stale CI comment about who creates the lockfile
- **Where:** `.github/workflows/ci.yml` lines 4–5 ("owner generates the first lockfile").
- **Finding:** Stale once T02 creates the lockfile (see M1).
- **Fix:** Update the comment.

### m16. SETUP_CHECKLIST wording for Cee
- **Where and finding:**
  - The timing note (line 7) says sections "1-5 and 8" can be done today. §8 (UptimeRobot) needs the Render production URL.
  - §2.2 gives no concrete commands (see B2).
- **Fix:** Say "1–5" and add the commands.

### m17. G1 needs `release` updated without the release checklist
- **Where:** SETUP §6 line 97 ("render.yaml and the server skeleton exist on both `main` and `release`"); WORKFLOW §6 (`release` is fast-forwarded only after `/release-checklist`).
- **Finding:** At G1 the production service would build from a `release` that has only the planning commit, so it fails.
- **Fix:** In the G1 row, either allow a one-off fast-forward of `release` after M0-W1, or state that the prod build fails harmlessly until `v0.1.0`.

### m18. Two different Tier B defaults
- **Where:** `OPEN_QUESTIONS.md` Q21 line 28 (estimate Tier A × 0.35) vs `M0-foundation.md` §8 item 3 and the G2 row (use the Tier A laptop's iGPU, provisional).
- **Fix:** Pick one; the M0 wording is better.

### m19. Orchestration text inconsistencies
- **Where and finding:**
  - AGENT_ORCHESTRATION §14 line 165 gives the example "`Stage M1-S3 = M1-W2 tasks T01–T03`", but M1-S3 is W1 T01–T02.
  - The §13 resume order differs from FABLE_KICKOFF §3 and §14.
  - `lead-orchestrator.md` line 3 says "use via `claude --agent lead-orchestrator`", while FABLE_KICKOFF says to use a plain session plus the paste.
- **Fix:** Correct the example. Make one reading order canonical. State whether Cee starts the lead with `--agent lead-orchestrator`.

### m20. `docs/README.md` is missing
- **Where:** module-boundaries §3 line 118, `docs-keeper.md` lines 18 and 32, `update-docs.md` line 17.
- **Finding:** These own or index `docs/README.md`, which does not exist.
- **Fix:** Create it via docs-keeper, or remove the references.

### m21. M1 skim, remaining items
- **Finding:**
  - **M1-W1-T01 (line 306):** says "height function reading the baked cube" inside env-agnostic `packages/world`. The I/O injection (buffer passed in) and the test fixture path in `assets/terrain/` are unstated.
  - **M1-W0-T03 (line 262):** requires `balance-reviewer`, whose procedure runs `tools/balance-sim`. That tool is not built until M1-W2-T05.
  - **M1-W0-T04 (line 270):** "shared root files" is vague.
- **Fix:**
  - State that the cube is passed in as an `ArrayBuffer`.
  - Limit the balance-reviewer check to schema coverage only (no sim run).
  - List the M1-W0-T04 files explicitly.

---

## What worked (checked, no issue)

- The S1 owned-file sets are disjoint: T02 root/config, T04 `.claude/hooks` + `docs/vendor`, T01 `packages/shared`. The one exception is the scripts overlap in M5. Port offsets 0, 1, 3, 9 are unique.
- Every agent and command named by the kickoff exists: `devops-engineer`, `contracts-architect`, `code-reviewer`, `netcode-security-reviewer`, `integrator`, and `/review`, `/status`, `/commit-plan`, `/verify`, `/integrate`.
- Every doc section the S1/S2 cards cite exists.
- The pinned versions in manifests, `.nvmrc`, CI, `render.yaml` and `vercel.json` agree (pnpm 11.28.9, Node 26.13.1).
- `.prettierignore` already excludes `docs/vendor/`.
- `render.yaml` has `plan: free` on both services.
- The `CI gate` stays green on the scaffold.
