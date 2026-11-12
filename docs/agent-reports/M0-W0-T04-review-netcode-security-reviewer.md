# Review of M0-W0-T04 by netcode-security-reviewer
Verdict: CHANGES REQUESTED
Date: 2026-11-12

(Checkpoint version: findings below are verified; timing, failure-behaviour and vendor-provenance evidence is being added.)

## Checked
- `.claude/hooks/block-git.mjs` read in full; 299 reviewer probes piped as PreToolUse JSON into the script on Node 22.20.0 (`tool_name` `Bash` and `PowerShell`). No git command that changes state was run; no `pnpm`/`npm`/`npx`.
- `.claude/settings.json` against `git diff -- .claude/settings.json` (read-only).
- The script for network, file writes, child processes, dynamic code, dependencies.

## Findings (blocking first)
1. [blocking] `.claude/hooks/block-git.mjs:254` (and the same test at `:105` in `findCloseParen`) — a Bash here-string `<<<` is read as a heredoc header (the check `src[i + 2] !== '<'` is true at the second `<`), so every following line is swallowed as a "heredoc body" and never judged. Same root cause for an arithmetic shift `$(( 1 << 2 ))`. Violates the acceptance criterion "also inside chains (... newlines ...)". Exploit sketch (all exit 0, should be 2): `tr a b <<< "$v"\ncd sub && git checkout -- .` · `grep foo <<< "$x"\ngit add .` · `jq . <<< '{"a":1}'\ngit -C . push` · `echo $((1 << 2))\ngit commit -m x`. Required fix: treat `<<<` as a here-string (consume the three characters, then parse the next word normally), do not start a heredoc inside `$(( ))` / `(( ))`, and add deny cases for these forms to the matrix. (Same finding as code-reviewer blocking 1; I agree with blocking.)

## Evidence
- Probe run, Node v22.20.0: `cases=299 mismatches=43`. Details are added in the final version of this file.
