---
description: Pre-promotion checks before Cee fast-forwards the release branch to a tested main commit; produces a go/no-go checklist.
argument-hint: "[version, e.g. v0.1.0]"
allowed-tools: Read, Write, Glob, Grep, Agent, SendMessage, Bash(pnpm turbo run *), PowerShell(pnpm turbo run *)
---

# /release-checklist

Go/no-go for promoting `main` to `release` as `$ARGUMENTS` (default: the next SemVer `0.x.y` from `docs/handoff/WORKFLOW.md` section 6). You are the lead. You only evaluate and write the checklist; Cee does every git operation (branch fast-forward, tag, push) and every dashboard change.

## Inputs

- `docs/STATUS.md`, `docs/handoff/WORKFLOW.md` (branches, releases), `docs/architecture/performance-budgets.md`, `docs/design/visual-target.md`, `docs/design/progression-and-economy.md`, `docs/ASSET_LICENSES.md`, `.github/` workflows, `render.yaml`, `vercel.json`, `**/.env.example`

## Procedure

Evaluate each item with evidence (command output or file path); mark PASS, FAIL or N/A with reason.

1. **State:** STATUS.md shows all waves for the release `done` (Cee confirmed commits); no `changes-requested` or `in-review` tasks; no blocking OPEN_QUESTIONS.
2. **Gates, fresh run:** `/verify` (`pnpm turbo run lint typecheck test build`), `/bot-test` (16 bots, netsim 120 +/- 30 ms, 1% loss, 10 min), `/visual-check` for the release milestone, `/perf-check` (Tier A and B), `/balance-check`. CI on `main` is green (ask Cee for the link).
3. **Versions:** `PROTOCOL_VERSION` and `SAVE_FORMAT_VERSION` unchanged or bumped with a migration note; client and server deployed together; game version and proposed tag match WORKFLOW.md.
4. **Secrets and config:** grep the tree for keys, tokens, connection strings and `.env` values (report file:line, never print values); `.env.example` has placeholders only; every required env var is documented; Vercel Production Branch is `release` with git auto-deploy of `release` disabled (`vercel.json`); Render prod service tracks `release`; DB migrations are present, forward-only and applied in the Render build command.
5. **Licensing and names:** every shipped asset has a row in `docs/ASSET_LICENSES.md` with attribution text; naming-bible banned-name grep is clean; credits and notices are present in the build.
6. **Free-tier safety:** bandwidth per player and projected monthly egress vs the 5 GB Render limit, server memory under 512 MB, cold-start flow (about one minute) shown to players, DB sleep handled, checkpoint every 30 s or less plus on SIGTERM.
7. **Release-client gate:** the `release-client` workflow (`.github/workflows/release-client.yml`) is green for the `release` commit, or Cee promotes the client manually through the Vercel Deploy Hook after confirming production `/healthz` reports the commit's `PROTOCOL_VERSION`; secret `VERCEL_PROD_DEPLOY_HOOK_URL` and variable `PROD_SERVER_HTTP_URL` are set (SETUP_CHECKLIST section 7). Never test against production.
8. **Staging smoke:** Cee-confirmed manual pass on the `main` staging deployment (join, clean, sell, reconnect); record who and when.
9. **Free-tier usage:** `/status` (admin) month-to-date **egress** against the 5 GB limit and **instance-hours** against the 750 shared hours (prod budget <= 600 h, staging <= 100 h); record both numbers in the checklist and ask Cee to accept the risk in OPEN_QUESTIONS if either is close to its limit.
10. **Rollback:** previous release commit and DB migration reversibility noted.

## Output

- `docs/handoff/release-checklist-<version>.md`: checklist table with evidence and a final GO or NO-GO, plus the exact steps for Cee (fast-forward `release` to the tested `main` commit, create tag `<version>` after confirming `/commit-plan` output). Log Cee-level decisions in `docs/OPEN_QUESTIONS.md`.

## Pass criteria

- GO only when every item is PASS (or N/A with a stated reason). Any FAIL is NO-GO with an owner and the next command.
