# M0-W0-T04 — Git-blocking PreToolUse hook + vendored three r187 docs (devops-engineer)
Status: in-review
Date: 2026-11-12

## Done so far / Next
- Done so far: everything in the brief. Hook script + matrix test (162 tests, green on Node 22.20.0 and 26.13.1), `hooks` block registered last, three r187 snapshot vendored (809,170 bytes) with README index, task row set to `in-review`.
- Next: reviewers (code-reviewer, netcode-security-reviewer); Cee's live check at Gate G0b (commands below).

## What changed
1. **`.claude/hooks/block-git.mjs`** (Node, zero dependencies, ESM, works on Node 22 and 26). Reads PreToolUse JSON from stdin; exit 2 plus a reason on stderr when a command contains a mutating git subcommand, otherwise exit 0 silently. It is a real shell-aware parser, not a regex: it splits chains (`&&`, `||`, `;`, `|`, `&`, newlines, subshells, brace groups, PowerShell script blocks), follows `$(...)`, backticks, quotes (Bash and PowerShell dialects chosen from `tool_name`), heredocs, PowerShell here-strings, comments, `VAR=x` / `$x = ` prefixes, wrappers (`env`, `sudo`, `time`, `nohup`, `timeout`, `xargs`, `command`, `bash -c`, `sh -c`, `cmd /c`, `powershell -Command/-EncodedCommand`, `eval`, `iex`, `Invoke-Expression`, `Start-Process`, `find -exec`, `pnpm/npm exec`), global git options (`-C`, `-c`, `--git-dir`, `--work-tree`, `--no-pager`, ...), `git.exe`, absolute paths, upper case, `\git`, quoted subcommands, and `git-commit` forms.
   - **Deny list** (the brief's 23): add, commit, push, pull, fetch, checkout, switch, restore, branch, worktree, reset, rebase, merge, cherry-pick, revert, stash, tag, init, remote, clean, rm, mv, am (so `git branch`/`tag`/`remote`/`stash` stay blocked even read-only, same as the permissions rules).
   - **Allowlist** (anything else is refused, see failure behaviour): status, diff, log, show, rev-parse, ls-files (the brief's six) plus blame, annotate, describe, ls-tree, cat-file, grep, shortlog, rev-list, diff-tree, diff-index, diff-files, show-ref, for-each-ref, ls-remote, check-ignore, check-attr, count-objects, merge-base, name-rev, cherry, whatchanged, version, help, var, show-branch, range-diff, verify-commit, verify-tag, stripspace, and `git config` only with read flags. Read-only subcommands with `--output`, `--open-files-in-pager`, `--ext-diff` are refused.
   - Text that merely mentions git is allowed: arguments of `grep`, `echo`, `rg`, `printf`, `Select-String`, `Write-Host`, heredoc bodies, comments, quoted strings, PowerShell here-strings.
2. **`.claude/hooks/block-git.test.mjs`**: 162 tests (145 allow/deny matrix cases plus 17 failure-behaviour, registration and edge tests). Every case spawns the script as a child process and pipes real PreToolUse JSON into it, checking exit code and stderr. No git is executed by the test or by me.
3. **`.claude/settings.json`**: only a `hooks` block added (see before/after below).
4. **`docs/vendor/three-r187/`**: offline r187 snapshot (see list below), README index with source URL, retrieval date, sha256 prefix, size and the MIT notice (`LICENSE-three.txt`).

### Failure behaviour (explicit decision; each row has a test)
| Input | Decision |
| --- | --- |
| empty / whitespace-only stdin | allow (exit 0) |
| invalid JSON | allow, unless the raw text coarsely matches `git ... <mutating word>`, then block |
| JSON that is not an object (`null`, `42`, `"git commit"`) | allow |
| tool other than Bash/PowerShell (e.g. Write) | allow, never judged |
| `tool_input.command` missing or not a string | allow (nothing can run) |
| `tool_name` missing but a mutating `command` present | judged, blocked |
| parser exception, command over 200,000 chars, nesting over 6 levels | coarse regex fallback: block only if it looks like mutating git; git-free text is always allowed |
| git subcommand not determinable (`git $x`, `git "$(...)"`) | block (fail closed, git only) |
| git subcommand not on the allowlist (aliases such as `git ci`, `clone`, `gc`, plumbing that writes) | block with the allowlist in the message |
| `git -c ...` / `--config-env` | block (config can run programs); matches the `git -c *` permission deny rule |
| computed command name next to a mutating word (`$g commit`) when git is mentioned | block |
| `eval`/`iex` of a computed string, or `... | sh`, when git is mentioned | block (cannot verify) |
| internal crash of the CLI wrapper | allow with a stderr note (exit 0), so a hook bug cannot block other commands |
Rule behind all of it: a command containing no git is never blocked, even if the parser is unsure about it.

### Before/after of `.claude/settings.json`
- Before: 1,715 bytes, sha256 `517ecb07...da86b`, keys `$schema, env, permissions`. After: 2,006 bytes, sha256 `85c5e26a...da8e2`, keys `$schema, env, permissions, hooks`.
- Verified by script: file parses as JSON; `JSON.stringify(permissions)` and `env` identical; the first 1,708 bytes (everything up to the closing brace of `permissions`) are byte-identical; only a `hooks` block was appended.
- Entry: `matcher: "Bash|PowerShell"`, `command: node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-git.mjs"`, `timeout: 10`. No absolute path. One entry with a regex matcher covers both tools (documented form, claude-code-formats section 4). The edit was done last, after the matrix passed.

## Files touched
- .claude/hooks/block-git.mjs (new)
- .claude/hooks/block-git.test.mjs (new)
- .claude/settings.json (modified: `hooks` block only)
- docs/vendor/three-r187/** (new, 37 files: README.md, LICENSE-three.txt, llms.txt, docs-llms.txt, docs-llms-full.txt, migration-guide-r180-r187.md, docs-pages/ x 15, tsl/ x 2, manual/ x 1, addons/ x 1, examples/ x 12)
- docs/agent-reports/M0-W0-T04-devops-engineer.md (new, this file)
- docs/milestones/M0-foundation.md (own row Status cell only: in-review)

## Contracts used / proposed contract changes
- Used: none. Proposed: none.

## Tests run
- Plain `node` (v22.20.0, the harness's runtime): `node --test ".claude/hooks/*.test.mjs"` -> `tests 162, pass 162, fail 0` (41.2 s).
- With the wave-file prefix (`node -v` printed `v26.13.1`): same command -> `tests 162, pass 162, fail 0` (45.6 s).
- Live examples piped as PreToolUse JSON with the registered command form from Git Bash (`CLAUDE_PROJECT_DIR` set to the Windows-style path): `git status` -> exit 0, no output; `cd x && git commit -m y` -> exit 2, stderr `BLOCKED by .claude/hooks/block-git.mjs: \`git commit\` changes repository state. ...`. Both also appear as named cases in the matrix.
- Before registration the same run showed 161/162 with only the registration test failing, as intended.
- No `pnpm`, `npm`, `npx` and no git command was run.

## Vendored snapshot: contents and size listing
All fetched with `curl -fsSL` from `https://raw.githubusercontent.com/mrdoob/three.js/r187/...` except the two wiki pages (untagged, retrieval date 2026-11-12, recorded in the README). Total 809,170 bytes (limit 5 MB). Largest files: `docs-llms-full.txt` 378,970; `tsl/TSL-reference.html.md` 172,241; `tsl/wiki-Three.js-Shading-Language.md` 65,643; `examples/webgpu_postprocessing_ao.html` 21,328; `addons/CSMShadowNode.js` 14,168; `migration-guide-r180-r187.md` 14,071; `docs-pages/BatchedMesh.html.md` 12,155. The full per-file byte list is in `docs/vendor/three-r187/README.md`.
- Required by the brief, all present: `llms.txt` (+ `docs-llms.txt` and the full variant `docs-llms-full.txt`), Migration Guide r180-r187 (sections `179 -> 180` through `186 -> 187`), docs pages WebGPURenderer, RenderPipeline, CSMShadowNode, BatchedMesh, InstancedMesh, StorageTexture, TSL reference (docs page plus wiki page), manual `webgpurenderer`, examples `webgpu_postprocessing_ao`, `webgpu_lights_clustered`, `webgpu_shadowmap_csm`, `webgpu_postprocessing_bloom`, `webgpu_compute_texture`, `webgpu_postprocessing_traa`, `webgpu_postprocessing_smaa`.
- Extras (cheap, named in the rendering-pipeline section 21 matrix): docs pages StorageTextureNode, GTAONode, BloomNode, TRAANode, SMAANode, ClusteredLightsNode, TileShadowNode, SunLight, PassNode; CSMShadowNode JSDoc source; examples `webgpu_shadowmap`, `webgpu_postprocessing_bloom_selective`, `webgpu_upscaling_taau`, `webgpu_upscaling_fsr1`, `webgpu_cubemap_dynamic`.
- Substitution recorded in the README: the r187 tag has no TSL page under `manual/` (the guide is the external site threejs.org/tsl), so the "TSL manual page" is covered by the in-repo `docs/pages/TSL.html.md` reference plus `manual/webgpurenderer.html` and the inline TSL docs in `docs-llms-full.txt`.
- Spot check: `outputColorTransform` and `renderOutput()` exist in the vendored `RenderPipeline` page and `docs-llms-full.txt` (relevant to rendering-pipeline section 20 open issue 5).

## Screenshots / captures
- n/a

## Performance notes
- Hook start-up plus decision is one short Node process per Bash/PowerShell call (about 0.2 s of Node boot on this machine, no I/O). `timeout` is 10 s. The test suite spawns one process per case, hence 40+ s.

## Gate G0b live check (Cee, in a NEW Claude Code session in this repo; hooks added mid-session do not apply to running sessions)
1. Run `/hooks` (or read `.claude/settings.json`) and confirm a PreToolUse entry for `Bash|PowerShell` running `block-git.mjs`.
2. Ask the agent to run exactly `git status --short` -> must run normally (read-only allowed).
3. Ask the agent to run exactly `git --no-pager add --dry-run docs/vendor` -> must be refused with `BLOCKED by .claude/hooks/block-git.mjs: ...`. This form is chosen because the text-matching permission rule `Bash(git add *)` does not match it, so only the hook can stop it, and `--dry-run` makes it harmless even if the hook failed to load.
   Offline check of the same script at any time: `node --test ".claude/hooks/*.test.mjs"`.
If step 3 is not blocked, check whether the harness expands `$CLAUDE_PROJECT_DIR` in hook commands on Windows (see risks).

## Open issues & risks
- **Not a sandbox.** Honest-agent safety net: a script file or program that itself spawns git (`node tool.mjs`, a Makefile, `python script.py`) cannot be seen; inline `node -e`/`python -c` that spawn mutating git are caught heuristically. Similar blind spot for other mutating CLIs (for example `gh pr create`): out of scope for this task, the lead may want a separate rule.
- **`$CLAUDE_PROJECT_DIR` expansion on Windows** depends on the shell the harness uses for hook commands (expected: Git Bash, as in the docs; verified here from Git Bash with a Windows-style path value). If the harness ever ran hooks through PowerShell the variable would not expand and the hook would fail open (a missing script is a non-blocking error, exit 1). The G0b step 3 detects this. Fallback would be a `shell` setting on the entry (lead decision).
- **Fail-open if the hook cannot start** (missing node or script): the harness treats non-2 exit codes as non-blocking. The permissions deny rules remain the first layer.
- **Stricter than the permission rules in one spot, looser in another:** the hook refuses `git -c ...` entirely (config can execute programs) and anything not on the allowlist; it allows read-only `git -C <path> status`, which the permission rule `Bash(git -C *)` still denies, so the net result is a deny.
- PowerShell 5.1 strips inner double quotes when a string is piped to a native exe, so a manual `'{"a":1}' | node block-git.mjs` from PowerShell sends invalid JSON (the hook then falls back to the coarse check, by design). Use Git Bash or the test file for manual piping. This is a shell quirk, not a harness behaviour.
- The wiki pages are untagged; they were retrieved 2026-11-12 and may drift from r187 later. Re-vendor on the next three upgrade.
- Windows spawn cost makes the matrix take about 40 s; acceptable for a safety control, not meant for the pre-commit loop.

## Dependencies requested (need ADR + devops install between waves; installs are never done by the requester)
- none

## Suggested Conventional Commit message(s)
- feat(hooks): add PreToolUse git-blocking hook with 145-case matrix test and register it in .claude/settings.json
- docs(vendor): add three.js r187 offline docs snapshot with source index and MIT notice
