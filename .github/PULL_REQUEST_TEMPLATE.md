## Summary

<!-- What changed and why. One paragraph. -->

**Task IDs:** <!-- e.g. M1-W2-T03, M1-W2-T04 -->
**Wave:** <!-- e.g. M1-W2 -->
**Commit plan:** <!-- docs/handoff/commit-plans/<milestone>-<wave>.md -->

## Type of change

- [ ] Feature
- [ ] Fix
- [ ] Performance
- [ ] Refactor
- [ ] Contracts / protocol change (version bumped in `packages/shared`)
- [ ] Database migration
- [ ] Assets (ledger updated in `docs/ASSET_LICENSES.md`)
- [ ] Docs / agents / CI only

## Ownership check

- [ ] Every changed path belongs to the owning role of its task (see the ownership map in `docs/handoff/AGENT_ORCHESTRATION.md`)
- [ ] Shared contracts changed only through the contracts process (contracts-architect, between waves)
- [ ] New dependencies have an ADR in `docs/adr/`

## Screenshots / video (required for any visual or UI change)

<!-- Native-resolution captures from /visual-check. State hardware tier, browser, backend (WebGPU/WebGL2), preset, resolution and DPR.
     Before/after pairs where relevant. Reference-game images: LINKS ONLY. -->

| Before | After |
| --- | --- |
|  |  |

Visual-target checklist items covered: <!-- e.g. VT-M1-03, VT-M1-07 -->

## Performance impact

<!-- Frame-time (GPU/CPU ms) on Tier A and Tier B, draw calls, memory, download size, server tick ms, bandwidth per player.
     Paste /perf-check and /bot-test summaries. -->

## Netcode / security impact

<!-- New or changed messages, validation, rate limits, server-authority implications. -->

## Reviewer sign-off

Required reviewers are listed on each task card. Link each review report in `docs/agent-reports/`.

- [ ] code-reviewer
- [ ] visual-qa-reviewer (visual/UI changes)
- [ ] performance-reviewer (rendering, simulation, networking, asset size)
- [ ] netcode-security-reviewer (protocol, server, API, auth, persistence)
- [ ] balance-reviewer (economy, progression, game-data)
- [ ] integrator gate passed (/verify, /bot-test, /visual-check)

## Checklist

- [ ] `/verify` green locally (lint, typecheck, test, build)
- [ ] No secrets, keys or connection strings anywhere in the diff
- [ ] Player-facing names come from `docs/design/naming-bible.md`; no reference-game names, art, audio or text
- [ ] No blurry UI: text and icons are crisp at DPR 1, 1.5, 2 and 3
- [ ] Docs updated (`docs/STATUS.md`, task rows in `docs/milestones/`, ADRs if a decision changed)
