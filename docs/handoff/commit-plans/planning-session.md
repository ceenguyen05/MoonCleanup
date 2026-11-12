# Commit plan — planning session (2026-11-11/12)

For: Cee. Nothing here has been staged or committed — every git command below is yours to run.
Do this as part of **Gate G0** ([SETUP_CHECKLIST.md](../../SETUP_CHECKLIST.md) §0–§2). The local folder stays
`BroswerMoonSweeper`; the GitHub repo is `ceenguyen05/mooncleanup`.

## 0. Before committing

```powershell
cd C:\Users\caseyn\Downloads\BroswerMoonSweeper
git status                      # everything below should be untracked; no node_modules, no .env files
```

No Git LFS is needed (ADR-0017). Commit on `main` (the repo has no commits yet), push, then create `release` from it.

## 1. Commits, in order

| # | Message | Paths (`git add` exactly these) |
| --- | --- | --- |
| 1 | `chore(repo): add root tooling config and editor settings` | `.editorconfig .gitattributes .gitignore .nvmrc .prettierignore package.json pnpm-workspace.yaml turbo.json tsconfig.base.json` |
| 2 | `chore(scaffold): add workspace package manifests and folder READMEs` | `apps packages tools tests assets prototypes` |
| 3 | `ci: add GitHub workflows, setup action, issue/PR templates and Dependabot` | `.github` |
| 4 | `build(deploy): add Vercel and Render Blueprint configs` | `vercel.json render.yaml` |
| 5 | `docs(research): add genre, platform, licensing and tech research reports` | `docs/research` |
| 6 | `docs(architecture): add tech stack, architecture specs and ADRs 0001-0028` | `docs/architecture docs/adr` |
| 7 | `docs(design): add GDD, naming bible, economy, scope tiers, art, audio, animation, game feel and UI specs` | `docs/design` |
| 8 | `docs: add roadmap, staged milestones, status, open questions, setup checklist, asset ledger and review log` | `docs/ROADMAP.md docs/milestones docs/STATUS.md docs/OPEN_QUESTIONS.md docs/SETUP_CHECKLIST.md docs/ASSET_LICENSES.md docs/REVIEW_LOG.md docs/README.md docs/visual-reviews docs/agent-reports` |
| 9 | `docs(agents): add CLAUDE.md, README, Claude Code agents/commands/settings and Fable handoff docs` | `CLAUDE.md README.md .claude docs/handoff` |

Copy-paste version (PowerShell):

```powershell
git add .editorconfig .gitattributes .gitignore .nvmrc .prettierignore package.json pnpm-workspace.yaml turbo.json tsconfig.base.json
git commit -m "chore(repo): add root tooling config and editor settings"
git add apps packages tools tests assets prototypes
git commit -m "chore(scaffold): add workspace package manifests and folder READMEs"
git add .github
git commit -m "ci: add GitHub workflows, setup action, issue/PR templates and Dependabot"
git add vercel.json render.yaml
git commit -m "build(deploy): add Vercel and Render Blueprint configs"
git add docs/research
git commit -m "docs(research): add genre, platform, licensing and tech research reports"
git add docs/architecture docs/adr
git commit -m "docs(architecture): add tech stack, architecture specs and ADRs 0001-0028"
git add docs/design
git commit -m "docs(design): add GDD, naming bible, economy, scope tiers, art, audio, animation, game feel and UI specs"
git add docs/ROADMAP.md docs/milestones docs/STATUS.md docs/OPEN_QUESTIONS.md docs/SETUP_CHECKLIST.md docs/ASSET_LICENSES.md docs/REVIEW_LOG.md docs/README.md docs/visual-reviews docs/agent-reports
git commit -m "docs: add roadmap, staged milestones, status, open questions, setup checklist, asset ledger and review log"
git add CLAUDE.md README.md .claude docs/handoff
git commit -m "docs(agents): add CLAUDE.md, README, Claude Code agents/commands/settings and Fable handoff docs"
git status                      # should be clean
```

## 2. Push and branches

```powershell
git remote set-url origin https://github.com/ceenguyen05/mooncleanup.git   # remote already exists
git branch -M main
git push -u origin main
git branch release
git push -u origin release
```

Then continue with SETUP_CHECKLIST §2 onward and paste the kickoff prompt from [FABLE_KICKOFF.md](../FABLE_KICKOFF.md).

## Notes

- `.claude/settings.json` blocks agents (not you) from running git commands that change the repo. Your own terminal is unaffected.
- `docs/agent-reports/` holds the planning reviews and fix reports — keep them; they explain why the docs look the way they do.
