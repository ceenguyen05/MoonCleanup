# docs/agent-reports/

**Owner:** every agent writes its own files here; the `docs-keeper` keeps the index tidy between waves.
**Purpose:** the paper trail of the build. Every task ends with a report, and every review produces a review file.
The lead reads these instead of re-deriving what happened, and a fresh session can resume from them.

## File naming

| Kind | File name | Example |
| --- | --- | --- |
| Task report | `<taskID>-<role>.md` | `M1-W2-T03-terrain-dust-engineer.md` |
| Review | `<taskID>-review-<reviewer-role>.md` | `M1-W2-T03-review-visual-qa-reviewer.md` |
| Integration | `<milestone>-<wave>-integration.md` | `M1-W2-integration.md` |
| Prototype benchmark | `../../prototypes/<topic>/BENCHMARK.md` | — |
| Planning-session review / fix | `planning-review-<lens>.md`, `planning-fix-<area>.md` | `planning-review-fable-dry-run.md` |

The integration report is **one file per wave** (`<M#-W#>-integration.md`); the integrator writes no separate `<taskID>-integrator.md`.

## Task report template

```markdown
# <taskID> — <goal> (<role>)
Status: in-progress | in-review | blocked
Date: YYYY-MM-DD

(Create this file when you start the task with `Status: in-progress` and update the section below after every meaningful sub-step, so a usage cut-off loses nothing.)

## Done so far / Next
- Done so far: ...
- Next: ...

## What changed
- ...

## Files touched
- path/one.ts (new)
- path/two.ts (modified)

## Contracts used / proposed contract changes
- Used: packages/shared/src/...
- Proposed (NOT applied — contracts change only via contracts-architect between waves): ...

## Tests run
- `pnpm --filter <pkg> test` → 42 passed
- /verify → green

## Screenshots / captures
- docs/visual-reviews/M1/W2/terrain-noon-tierA.png (native resolution) — or "n/a"

## Performance notes
- GPU ms / CPU ms / draw calls / memory / server tick ms — or "n/a"

## Open issues & risks
- ...

## Dependencies requested (need ADR + devops install between waves; installs are never done by the requester)
- none

## Suggested Conventional Commit message(s)
- feat(terrain): ...
```

## Review template

```markdown
# Review of <taskID> by <reviewer-role>
Verdict: APPROVED | CHANGES REQUESTED
Date: YYYY-MM-DD

## Checked
- ...

## Findings (blocking first)
1. [blocking] file:line — problem — required fix
2. [non-blocking] ...

## Evidence
- commands run, screenshots compared, numbers measured
```
