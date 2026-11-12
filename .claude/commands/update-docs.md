---
description: docs-keeper pass over indexes, ADR index, cross-links, ledgers and consistency greps (role names, ports, rates, banned names).
argument-hint: "[M#-W#, optional]"
allowed-tools: Read, Write, Glob, Grep, Agent, SendMessage
---

# /update-docs

Documentation hygiene pass for `$ARGUMENTS` (default: the current wave). You are the lead. Never run git.

## Inputs

- Current docs tree, `docs/handoff/AGENT_ORCHESTRATION.md` (role roster), `docs/architecture/module-boundaries.md` section 3, `docs/design/naming-bible.md` (banned names), `docs/ASSET_LICENSES.md`, `docs/architecture/tech-stack.md` (pinned versions)

## Procedure

1. **Launch `docs-keeper`** (`subagent_type: docs-keeper`, no isolation) with a brief built from the template. Owned files: `docs/research/**`, `README.md`, `docs/README.md`, `docs/ASSET_LICENSES.md`, `docs/SETUP_CHECKLIST.md`, `docs/REVIEW_LOG.md`, indexes inside `docs/agent-reports/README.md` and `docs/adr/README.md`. Give it the wave id, the list of new files (from reports) and the REVIEW_LOG entry to append (wave, reviewers, verdicts, links).
2. Required checks in the brief:
   - Indexes list exactly the files that exist (docs, ADRs, agent reports, milestones, handoff folders).
   - Every relative Markdown link resolves; every doc path referenced in `.claude/agents/*.md` and `.claude/commands/*.md` exists or is marked planned.
   - Role names match the roster exactly everywhere; port rule (client `5173+N`, server `2567+N`); rates (20 Hz sim, 10 Hz snapshots); pinned versions match tech-stack.md; the "NEVER run git" line is present in agent definitions and briefs.
   - Banned-name grep over the repo (reference proper nouns and generic reference item names from the naming bible), excluding research files that quote them as banned.
   - Asset ledger: every file under `assets/**` has a row in `docs/ASSET_LICENSES.md`, every row has a file.
3. docs-keeper fixes only its owned files and **lists everything else** (file:line, issue, suggested owner) in its report.
4. Wait for the notification, read `docs/agent-reports/<M#-W#>-docs-keeper.md`, and act on its issue list: route design-doc issues to game-designer/technical-artist briefs, architecture/ADR/.claude issues are yours.

## Output

- Updated indexes and ledgers; `docs/agent-reports/<M#-W#>-docs-keeper.md` with changes made and an issue list; new row in `docs/REVIEW_LOG.md`.

## Pass criteria

- Zero broken links, zero index drift, zero banned-name hits, zero unledgered assets, or each exception is listed with an owner.
