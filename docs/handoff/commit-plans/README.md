# docs/handoff/commit-plans

**Written by:** the lead/orchestrator (`/commit-plan`) - **Executed by:** Cee (owner; all git operations are manual)

Each finished wave produces one file here: `<M#>-<W#>.md` in upper case, for example `M0-W1.md` (same spelling as the milestone cards and `/commit-plan`). The one non-wave file is [`planning-session.md`](planning-session.md): the commit plan for the planning files themselves, written by the lead before Gate G0 and followed by Cee in SETUP_CHECKLIST §2.2. See
[`../WORKFLOW.md`](../WORKFLOW.md) section 4 for the loop.

## What a commit plan contains

1. Header: wave id, wave branch name (`wave/<milestone>-<wave>-<slug>`), base `main`, optional proposed tag.
2. **Ordered commit groups** (contracts, packages, apps, tools, assets, docs). Each group lists:
   - the exact file paths to stage,
   - the Conventional Commits message (`<type>(<scope>): <imperative summary>`, <= 72 chars) with body and `Refs:` task IDs,
   - `BREAKING CHANGE:` when a protocol/save version bumps.
3. Verification checklist to run before pushing (`pnpm verify`, bots, visual and perf checks as required by the wave).
4. Notes for the PR to `main` (CI must be green, Vercel preview link in the description).

## Rules

- Agents never run git; they only write this plan. Cee reviews `git status` / `git diff`, stages each group exactly as listed and commits.
- After merging, Cee tells the lead (for example "M1-W2 committed, PR #12 merged") so task rows can move to `done`.

Empty until the first wave completes (apart from `planning-session.md`).
