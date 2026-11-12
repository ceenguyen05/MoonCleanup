# Review of M0-W0-T04 by code-reviewer
Verdict: CHANGES REQUESTED
Date: 2026-11-12

Three blocking findings, all in `.claude/hooks/block-git.mjs`. The vendored snapshot, the settings edit, the
ownership check and the test run are clean.

## Checked
- **Matrix test, both runtimes (reproduced):** `node --test ".claude/hooks/*.test.mjs"` → 162 pass, 0 fail on
  Node v22.20.0 (26.6 s) and on Node v26.13.1 with the wave §3 prefix (25.8 s). Every case spawns the real script and
  pipes PreToolUse JSON on stdin (`block-git.test.mjs:16-22`). Both live examples are present (`:37-38`).
- **Deny coverage (reproduced, 736 piped cases, 0 misses):** all 23 subcommands × bare, with args, `&&`, `||`, `;`,
  `|`, newline, `$(...)`, backticks, `git -C`, `git -c`, `VAR=x` / `env` / `$env:X = ...` prefixes, `git.exe`, quoted
  Windows exe path, for `Bash` and `PowerShell`.
- **Read-only git the lead relies on (reproduced, 60 piped cases, 0 blocked):** all eight forms from the review
  request, including the three-command `;` chain, for both tool names.
- **False-positive probes from the review request:** all allowed for both tool names, except the PowerShell form of
  the commit-plan write (finding 2).
- **`.claude/settings.json`:** `git diff` shows only the `hooks` block added after `permissions` (14 added lines, 0
  removed besides the brace); parses as JSON; command is exactly `node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-git.mjs"`,
  matcher `Bash|PowerShell`, timeout 10; no absolute path.
- **Vendored snapshot:** 37 files, 816,713 bytes including the README (809,170 without; limit 5 MB). Every item of the
  criterion is present; the TSL manual-page substitution is recorded (README note 2). README has the r187 raw base
  URL, retrieval date 2026-11-12 and the MIT notice (`LICENSE-three.txt`); no `master` / `dev` URL. All 36 index rows
  match local size and sha256 prefix. Nine files re-downloaded with `curl -fsSL` and compared with `cmp`: all
  byte-identical (LICENSE, `llms.txt`, `docs/llms-full.txt`, `RenderPipeline.html.md`, `TSL.html.md`,
  `CSMShadowNode.js`, `webgpu_shadowmap_csm.html`, wiki Migration Guide lines 9-105, wiki TSL page). Migration headings
  run `186 → 187` down to `179 → 180`.
- **Ownership:** `git status --short` shows T04 changes only in `.claude/hooks/`, `.claude/settings.json`,
  `docs/vendor/three-r187/`, its report, and the Status cell of its own row (milestone diff: three status cells, one
  per task T01/T02/T04). `docs/vendor/` holds only `three-r187`.
- **Script hygiene:** one import (`node:url`), no dependencies, no network, no file access; runs on Node 22 and 26.
  No secrets. No reference-game names.

## Findings (blocking first)

1. **[blocking] `.claude/hooks/block-git.mjs:254` and `:105`, `:249-253`, `:313-316` — the lexer mis-reads three
   ordinary shell constructs and then hides a later, literal mutating git call (exit 0).** Violates criterion 1
   (deny inside newline and `;` chains).
   - Bash here-string `<<<`: the second and third `<` are parsed as a heredoc header, the here-string word becomes the
     delimiter, and every following line is swallowed as heredoc body. Allowed today:
     `read -r a b <<< "1 2"\ngit commit -m x`; `while read -r l; do echo "$l"; done <<< "$list"\ngit add .`;
     `x=$(tr a b <<< "$y")\ngit commit -m x`; `cat <<< hello\ngit add .`.
   - Arithmetic shift: `n=$((1<<4))\ngit commit -m x` and `if (( x << 2 )); then echo; fi\ngit reset --hard` are allowed
     for the same reason.
   - PowerShell block comment: `Write-Host a <# note #>; git commit -m x` is allowed (`#>` starts a line comment).
   - ANSI-C quoting: `echo $'it\'s'; git push` is allowed (`\'` is treated as the closing quote).
   - **Required fix:** never treat `<<` as a heredoc when it is part of `<<<` or sits inside `$(( ))` / `(( ))`; skip
     `<# ... #>` in the `ps` dialect; honour backslash escapes inside `$'...'`. Add a deny case for each form above.

2. **[blocking] `.claude/hooks/block-git.mjs:556-559` and `:553` — PowerShell commands that invoke no git are
   blocked.** Violates criterion 2 and the brief's rule "a hook bug must never block commands that contain no git
   invocation".
   - `:556-559` scans any lone quoted string as a script, whatever it is piped to. Blocked today:
     `@'\n# Commit plan\ngit add docs\ngit commit -m "x"\n'@ | Set-Content docs/handoff/commit-plans/M0-W0.md`;
     `'git commit -m "x"' | Set-Content plan.md`; `'git add docs' | Out-File -Append plan.md`;
     `@"\ngit add docs\n"@ | Add-Content plan.md`. The existing test (`block-git.test.mjs:164`) passes only because its
     line starts with "never".
   - `:553` treats a PowerShell expression as a computed command name. Blocked today:
     `$s = git status --short; $s -match "add"`; `$log = git log -5 --oneline; $log -match 'merge'`;
     `$t = Get-Content .git/HEAD; $t -match "commit"`.
   - **Required fix:** scan a lone string only when the next pipeline stage is an eval or shell word (`iex`,
     `Invoke-Expression`, `sh`, `bash`, `pwsh`, `cmd`); in the `ps` dialect do not apply the `:553` heuristic when the
     word after the variable is an operator (`-match`, `-replace`, `-eq`, ...). Add allow cases for the forms above and
     keep `"git commit" | iex` and `& $g commit` denied.

3. **[blocking] `.claude/hooks/block-git.mjs:640` — the main-module guard fails when the script is reached through a
   junction or symlink, so the hook exits 0 for everything, silently.** `import.meta.url` is the resolved real path;
   `process.argv[1]` is not. Measured on a copy in the temp directory: direct path → exit 2 for
   `cd x && git commit -m y`; same file through a directory junction → exit 0, empty stderr. The brief requires the
   command to "still work from any location". The tests cannot see this because they pass a real path.
   - **Required fix:** compare real paths (`realpathSync(process.argv[1])`) or drop the guard by moving the logic into a
     module that a small entry file imports. Add a test that runs the script through a junction in a temp directory.

4. [non-blocking] `.claude/hooks/block-git.mjs:429-438` with `:414`, and `:533-540` — quadratic work inside the
   200,000-character limit can exceed the 10 s hook timeout. Measured: `pnpm ` + `git status ` × 18,000 (199 KB) →
   25.6 s; the same ending in `git push` → 26.4 s (would be killed before its exit 2); 132 KB → 8.9 s; `find` with
   24,000 `-exec` → 7.5 s; no `tool_name` + `cmd /c` × 6 + 190 KB → 5.2 s (`:567` doubles per level). Only crafted
   input reaches this, so I rate it non-blocking; the lead may upgrade it. Suggest: stop slicing per git word, add a
   work budget that falls back to the coarse check.
5. [non-blocking] `:517-520` — `eval` of a computed string is refused whenever the command mentions git, including
   read-only or path-only mentions: `eval "$(fnm env)"; node -v; git status` and `eval "$(fnm env)"; ls .git` are
   blocked. Documented decision (report row 12), but it is a false positive for a common fnm idiom.
6. [non-blocking] `:507-512` and `:542` — a program whose basename starts with `git-` or equals `git` is judged as
   git: `./tools/git-hooks-check.sh` and `pnpm exec prettier --check tools/git docs` are blocked. Suggest limiting the
   dashed form to bare names without a path.
7. [non-blocking] `:264` and `:279` — a here-string is recognised only when `@` starts its own word. `$plan=@'` (no
   spaces) with an apostrophe in the body is lexed as code and blocked:
   `$plan=@'\nit's a plan\ngit add docs\n'@\nSet-Content plan.md $plan`.
8. [non-blocking] Report honesty. (a) The failure table says nesting over 6 levels uses the coarse regex and that
   git-free text is always allowed; the code (`:566`) blocks on any mention of git: `$(` × 8 around `git status`, and
   around `cat .git/HEAD`, are blocked. (b) "Each row has a test" is overstated: there is no test for a parser
   exception, the internal-crash path (`:641-644`), `eval` of a computed string, or `--config-env` (all four behave as
   described when probed, except the crash path, which I could not trigger).
9. [non-blocking] Readability: `analyze()` (`:462-562`) is one 100-line function with about fifteen branches; splitting
   wrappers, shells and heuristics into named helpers would make the next fix safer.
10. [non-blocking] The Gate G0b command in the report (`git --no-pager add --dry-run docs/vendor`) differs from the
    task card (`git commit --dry-run -m x`). The report's reasoning is sound (the permission rule would mask the card's
    form); the lead should align the card.

## Evidence
- `node -v` → `v22.20.0`; `node --test ".claude/hooks/*.test.mjs"` → `tests 162, pass 162, fail 0`, 26.6 s.
- With the §3 Git Bash prefix: `node -v` → `v26.13.1`; same command → `tests 162, pass 162, fail 0`, 25.8 s.
- All probes were PreToolUse JSON piped into the real script from throwaway Node scripts in the session temp
  directory (deleted afterwards). No git command that changes state was run; no `pnpm`, `npm` or `npx`.
  - Deny matrix: 736 cases, 0 not denied. Read-only set: 60 cases, 0 blocked.
  - Finding 1: eight forms returned exit 0 with empty stderr; the control `cat <<EOF\nbody\nEOF\ngit push` returned 2.
  - Finding 2: stderr was `` `git add` changes repository state `` / `` `git commit` changes repository state `` for the
    string forms and `command name is computed at runtime next to a mutating git subcommand word` for the `-match` forms.
  - Finding 3: path spellings (upper case, back slashes, relative, path with a space) all returned 2; junction returned 0.
  - Finding 4: timings as listed; baseline `git status` 148 ms; 1 MB over-limit inputs 136-159 ms (coarse regex does
    not backtrack).
- `git diff -- .claude/settings.json` (read-only): only the `hooks` block added.
- `curl -fsSL` + `cmp` of nine upstream files against the vendored copies: nine identical. README index: 36 rows, 0
  size or hash mismatches. Size listing: 37 files, 816,713 bytes.
