# STATUS — resume here

Updated: 2026-11-12. Lead alone patches current state; detailed evidence stays in task/review reports.
**Clean The Moon!**; close Moon Sweepers-like design: [REFERENCE_TARGET](design/REFERENCE_TARGET.md).
Model/usage rules: [MODEL_POLICY](handoff/MODEL_POLICY.md). Deadline: November 17, 2026 (America/Chicago).

## Now

- M0 foundation, wave [M0-W0](handoff/waves/M0-W0.md), stages S1/S2. Continue authorized M0; do not restart or reinstall.
- Setup is complete. Build/test continuously through M0–M3; Cee chooses when satisfied and ready to commit/publish.
- **Do not infer live-agent state from historical launch times.** Wave §11 IDs come from an earlier conversation and are
  probably unreachable from a new session; verify, else replace the worker from its report and the files on disk.
- Node commands on this laptop need the per-command fnm Node 26 prefix in wave §3; do not change the machine profile.

## Active work and findings

| Task | Recorded state | Resume evidence / Next |
| --- | --- | --- |
| M0-W0-T01 contracts | in-progress | [partial report](agent-reports/M0-W0-T01-contracts-architect.md) is behind disk. Verified 2026-11-12: `ids`, `units`, `protocol`, `render` exist; `tsc -p packages/shared` clean; `vitest --root packages/shared` 6 files/56 tests pass. Next: `events`, `client`, `api`, `save`, placeholders (`sim`, `world`, `ui`, `audio`, `config`), root barrel + header tests, then report. |
| M0-W0-T02 tooling | changes-requested | [author](agent-reports/M0-W0-T02-devops-engineer.md), [code review](agent-reports/M0-W0-T02-review-code-reviewer.md). Source unchanged since review: blocking findings 1 (dynamic `import()`) and 2 (sibling relative imports) open. No T02 security report exists on disk; run one bounded security review (lockfile, build scripts, uWS override) unless the original worker is reachable. |
| M0-W0-T04 hook/docs | changes-requested | [author](agent-reports/M0-W0-T04-devops-engineer.md), [code](agent-reports/M0-W0-T04-review-code-reviewer.md), [security](agent-reports/M0-W0-T04-review-netcode-security-reviewer.md). Source unchanged since review except a header comment and the block message text: blocking findings 1–3 (lexer `<<<`/`(( <<))`/`<# #>`, PowerShell false positives, junction guard) open. Matrix 162/162 pass on Node 26 (2026-11-12). `block-git.mjs` is not Prettier-formatted yet (format after the fix so review line refs stay valid). |
| M0-W0-T03 scripts/build/CI/env | todo | Brief wave §8.1. Real scripts/configs/stubs/smoke/env work remains. Main-only deploy cleanup, Markdown formatter exclusion and the ci.yml lockfile comment already applied; inspect/reuse. Dependabot removed by owner (do not recreate). `index.html` title must be exactly `Clean The Moon!`. |
| M0-W0-T06 asset proof | todo | After T03. Blender 4.5.10 LTS installed (Q23 resolved, path in OPEN_QUESTIONS). Wave §8.2. |
| M0-W0-T05 integration | todo | After required technical inputs; wave §8.3. Verify meaningful checks, record evidence and continue M0-W1; no commit stop. |

Task-state authority remains [M0 §5](milestones/M0-foundation.md#5-status-table); no new approval/completion is inferred here.
Full build/boot/deploy is not proven: package scripts still include placeholders. Local config/format/graph checks passed in
the cleanup pass; they are not M0 integration acceptance. No new task completion is inferred.

## Owner inputs / carry-over

- Hardware (Q21 resolved): only an Intel UHD 620 laptop exists; its captures are a provisional below-Tier-B worst case,
  Tier A/B verdicts BLOCKED, targets unchanged. Blender 4.5.10 LTS installed (Q23 resolved).
- Review blocked build scripts/release-age exceptions/uWS override in T02's report when needed; ask only for a real trust/permission decision.
- Main-only / one Render / DB schema prod (ADR-0029); setup/architecture prose reconciled 2026-11-12 (no staging service anywhere).
- Product override (ADR-0030): common names/style allowed; old forced differences and custom Review/Effort/Bulk-Rate gates are retired.
  Design docs + M1/M2 cards reconciled to reference mode 2026-11-12 (GDD §18 / economy §24 / scope-tiers §2.1 / UI §11 hold optional ★).
  Still to do before the first gameplay/economy wave: contracts + game-designer create `packages/game-data` schemas/tables from
  economy §21 (`caps.json`, no `on-shift-bonus.json`); balance rows marked "regenerate" need `tools/balance-sim`. Open: Q27 co-op pacing.
- Models pinned Fable 5.2/Opus 5.5/Sonnet 5.5; Sonnet lead chooses task effort. Default one implementer, max two workers, one premium worker combined.
- [OPEN_QUESTIONS](OPEN_QUESTIONS.md) holds only outstanding owner decisions/defaults; [deadline plan](handoff/DEADLINE_PLAN.md) holds delivery checkpoints.

Update this file after a coherent checkpoint: actual report/agent ID, evidence, blocker and exact Next. Do not append full transcripts.


Pre-kickoff cleanup 2026-11-12: stale staging/release/process refs fixed, Dependabot removed, Blender installed, hardware recorded,
design reconciled; no M0 task state changed. Owner workflow, November 12: no intermediate commits, formal wave plans, stage permission stops or per-task reviewer swarm.
Keep compact recovery state, meaningful tests and known findings. Keep the custom git hook as an extra safeguard.
