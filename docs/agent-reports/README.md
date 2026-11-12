# Reports

Use a report for complex/long-running work, external evidence or recovery; simple work can be a short STATUS checkpoint.
When a report is useful: `<taskID>-<role>.md`. Integrator uses only `<M#-W#>-integration.md`.
Checkpoint at coherent deliverables/blockers/end; no document required for every tiny task. Lead alone edits milestone rows/STATUS.

```text
Task / status (in-progress, in-review, blocked) / date / agent ID / actual model+effort if known
Done: working deliverable
Next: exact next action
Files: changed paths
Evidence: command, environment, file-state identity, result and artifact/clip/capture/perf numbers
Blockers / contract or dependency requests: issue + owner, or none
Commit suggestion: one Conventional Commit line
```

Target ≤250 words plus paths; link raw logs rather than paste output. No PASS for unrun/stub checks.
Review: `<taskID>-review-<role>.md` or `<M#-W#>-review-<role>-batch<N>.md`; date/file state, per-task
APPROVED/CHANGES REQUESTED verdict, scope/lenses, findings (blocking first, file:line/evidence/fix) and artifact paths.
Reviewers do not edit implementation or approve their own work. Preferences are non-blocking; behavior, authority,
boundaries, acceptance and measured quality failures block. Re-review fixes/regressions only.
Integration: one row per applicable gate with PASS/FAIL/N/A/BLOCKED/NOT RUN, evidence and remaining issues.
Preserve existing active reports/findings; no reformatting/re-review merely because this template changed.


Existing reports are historical evidence. Their old commit/stage-gate/mandatory-review instructions are retired by WORKFLOW.
Keep recorded code defects and reproduction evidence intact; do not repeat the old administrative tasks.
