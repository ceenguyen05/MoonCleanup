// Matrix test for block-git.mjs. Run: node --test ".claude/hooks/*.test.mjs"
// Every case pipes real PreToolUse JSON into the script as a child process (the way the harness does) and checks
// the exit code: 2 = blocked (reason on stderr), 0 = allowed. No git command is ever executed by this test.
// Runs on whatever `node` starts it (system 22.x or project 26.x); the child uses the same executable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "block-git.mjs");

function pipe(stdin) {
  return spawnSync(process.execPath, [script], { input: stdin, encoding: "utf8", timeout: 15_000 });
}

function run(tool, command) {
  return pipe(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { command } }));
}

const B = "Bash";
const P = "PowerShell";

/** [tool, command, expected, label?]  expected: 'deny' | 'allow' */
const cases = [
  // --- every mutating subcommand in the brief (23) ---
  ...[
    "add .",
    'commit -m "x"',
    "push origin main",
    "pull",
    "fetch --all",
    "checkout -b topic",
    "switch main",
    "restore file.txt",
    "branch -D topic",
    "branch",
    "worktree add ../w",
    "reset --hard HEAD~1",
    "rebase -i HEAD~3",
    "merge topic",
    "cherry-pick abc123",
    "revert HEAD",
    "stash",
    "stash pop",
    "tag v1.0.0",
    "init",
    "remote add origin https://example.invalid/x.git",
    "clean -fd",
    "rm -r --cached dist",
    "mv a b",
    "am fix.patch",
  ].map((rest) => [B, `git ${rest}`, "deny"]),

  // --- live examples from the brief ---
  [B, "git status", "allow", "live example: git status"],
  [B, "cd x && git commit -m y", "deny", "live example: cd x && git commit -m y"],

  // --- chains, substitutions, wrappers ---
  [B, "git status && git commit -m x", "deny", "chain &&"],
  [B, "git status || git add .", "deny", "chain ||"],
  [B, "git status; git push", "deny", "chain ;"],
  [B, "echo x | git commit -F -", "deny", "pipe"],
  [B, "git status\ngit commit -m x", "deny", "newline"],
  [B, "echo $(git commit -m x)", "deny", "$( ) substitution"],
  [B, 'echo "$(git add .)"', "deny", "$( ) inside double quotes"],
  [B, "echo `git push`", "deny", "backtick substitution"],
  [B, "(cd x; git commit -m y)", "deny", "subshell"],
  [B, "{ git commit -m x; }", "deny", "brace group"],
  [B, "if true; then git commit -m x; fi", "deny", "if/then"],
  [B, "cd x && echo ok && (git status; git push)", "deny", "nested chain"],
  [B, "git -C sub commit -m x", "deny", "git -C"],
  [B, "git -c user.name=x commit -m y", "deny", "git -c"],
  [B, 'git -c core.fsmonitor="git commit" status', "deny", "git -c with exec-capable config"],
  [B, "GIT_AUTHOR_NAME=x git commit -m y", "deny", "env assignment prefix"],
  [B, "env GIT_DIR=x git push", "deny", "env wrapper"],
  [B, "git.exe commit -m x", "deny", "git.exe"],
  [B, "/usr/bin/git push", "deny", "absolute path"],
  [B, '"C:\\Program Files\\Git\\cmd\\git.exe" commit -m x', "deny", "quoted Windows path"],
  [B, 'bash -c "git commit -m x"', "deny", "bash -c"],
  [B, "sh -c 'cd x && git push'", "deny", "sh -c with chain"],
  [B, 'powershell -NoProfile -Command "git commit -m x"', "deny", "powershell -Command from Bash"],
  [B, "cmd /c git add .", "deny", "cmd /c"],
  [B, 'eval "git add ."', "deny", "eval"],
  [B, "xargs git rm < files.txt", "deny", "xargs"],
  [B, 'find . -name "*.tmp" -exec git rm {} \\;', "deny", "find -exec"],
  [B, "git --no-pager commit -m x", "deny", "global flag before subcommand"],
  [B, "git --git-dir=.git commit -m x", "deny", "--git-dir=..."],
  [B, "git --git-dir .git --work-tree . add .", "deny", "separate-arg global options"],
  [B, "sudo git push", "deny", "sudo"],
  [B, "time git commit -m x", "deny", "time"],
  [B, "nohup git push &", "deny", "nohup + background"],
  [B, "timeout 5 git push", "deny", "timeout wrapper"],
  [B, "pnpm exec git commit -m x", "deny", "package runner"],
  [B, "GIT COMMIT -m x", "deny", "upper case"],
  [B, "command git commit -m x", "deny", "command builtin"],
  [B, "\\git commit -m x", "deny", "backslash-prefixed alias bypass"],
  [B, 'git "commit" -m x', "deny", "quoted subcommand"],
  [B, "git 'push' origin", "deny", "single-quoted subcommand"],
  [B, "cat <<EOF\nhello\nEOF\ngit commit -m x", "deny", "git after a heredoc"],
  [
    B,
    "git commit -m \"$(cat <<'EOF'\nmessage with an apostrophe: it's fine\nEOF\n)\"",
    "deny",
    "commit with heredoc message",
  ],
  [B, "echo ok #\ngit push", "deny", "git after a comment line"],
  [B, "node -e \"require('child_process').execSync('git commit -m x')\"", "deny", "inline node spawning git"],
  [B, "git-commit -m x", "deny", "dashed git-commit"],
  [B, 'echo "git commit -m x" | sh', "deny", "script piped into a shell"],
  [B, "alias g=git; g commit -m x", "deny", "aliasing git"],
  [B, "git $SUB", "deny", "computed subcommand (cannot verify)"],
  [B, "git ci -m x", "deny", "unknown subcommand / alias (cannot verify)"],
  [B, "git clone https://example.invalid/x.git", "deny", "clone is not read-only"],
  [B, "git config user.name x", "deny", "git config write"],
  [B, "git diff --output=out.patch", "deny", "read-only subcommand with a writing flag"],
  [B, "g=git; $g commit -m x", "deny", "computed command name next to a mutating word"],

  // --- PowerShell ---
  [P, 'git commit -m "x"', "deny", "PS plain"],
  [P, "& git commit -m x", "deny", "PS call operator"],
  [P, "& 'C:\\Program Files\\Git\\cmd\\git.exe' commit -m x", "deny", "PS quoted exe path"],
  [P, "$r = git commit -m x", "deny", "PS assignment"],
  [P, "if ($?) { git push }", "deny", "PS script block"],
  [P, "foreach ($f in $files) { git add $f }", "deny", "PS foreach block"],
  [P, "git status; git add .", "deny", "PS ; chain"],
  [P, "git status && git commit -m x", "deny", "PS7 && chain"],
  [P, 'Start-Process git -ArgumentList "commit -m x"', "deny", "PS Start-Process"],
  [P, 'Invoke-Expression "git add ."', "deny", "PS Invoke-Expression"],
  [P, '"git commit" | iex', "deny", "PS string piped to iex"],
  [P, "$(git push)", "deny", "PS subexpression"],
  [P, "cmd /c git commit -m x", "deny", "PS cmd /c"],
  [P, 'Write-Host "C:\\x\\"; git commit -m x', "deny", "PS trailing backslash does not escape the quote"],
  [
    P,
    "pwsh -EncodedCommand " + Buffer.from("git commit -m x", "utf16le").toString("base64"),
    "deny",
    "PS -EncodedCommand",
  ],
  [P, "$g = 'git'; & $g commit -m x", "deny", "PS computed command name"],
  [P, "git.exe add .", "deny", "PS git.exe"],
  [P, "Set-Alias g git; g commit -m x", "deny", "PS Set-Alias git"],

  // --- read-only git: allowed ---
  [B, "git diff --stat", "allow"],
  [B, "git log --oneline -5", "allow"],
  [B, "git show HEAD:README.md", "allow"],
  [B, "git rev-parse --show-toplevel", "allow"],
  [B, "git ls-files | wc -l", "allow"],
  [B, "git status --short && git diff", "allow"],
  [B, "git --no-pager log -3", "allow"],
  [B, 'git log --format="%H %s" -n 3', "allow"],
  [B, "git diff HEAD~1 -- docs/STATUS.md", "allow"],
  [B, "git status 2>&1 | head -5", "allow"],
  [B, "git blame -L 1,5 README.md", "allow"],
  [B, "git config --get user.name", "allow"],
  [B, "git --version", "allow"],
  [B, 'git log --grep="git commit" --oneline', "allow"],
  [B, "git -C packages/shared status", "allow", "git -C read-only (the permissions deny rule still refuses it)"],
  [P, "git status; git diff", "allow"],
  [P, "git log --oneline | Select-Object -First 5", "allow"],

  // --- read-only text that merely contains the words: allowed ---
  [B, 'grep -rn "git commit" docs', "allow", "grep a quoted phrase"],
  [B, 'echo "never git push"', "allow", "echo a quoted phrase"],
  [B, "echo git commit", "allow", "echo unquoted words"],
  [B, "rg 'git (add|commit)' docs", "allow", "rg a quoted pattern"],
  [B, 'cat docs/handoff/WORKFLOW.md | grep "git commit"', "allow", "pipe into grep"],
  [B, "printf '%s\\n' \"git push origin\"", "allow", "printf"],
  [B, "echo 'git reset --hard' > notes.txt", "allow", "redirect quoted text"],
  [B, "cat <<'EOF' > note.md\nnever run git commit here\nEOF", "allow", "heredoc body mentioning git commit"],
  [B, 'echo "$(date) git push is forbidden"', "allow", "substitution plus quoted words"],
  [B, "echo ok # git commit later", "allow", "comment mentioning git commit"],
  [B, "node -e \"console.log('git commit is banned')\"", "allow", "inline node that only prints the words"],
  [B, "cd apps/client && pnpm test", "allow"],
  [B, 'node --test ".claude/hooks/*.test.mjs"', "allow"],
  [B, "ls -la .git .github", "allow", "paths that start with .git"],
  [B, "cat .gitignore", "allow"],
  [B, "sed -n '1,5p' docs/git-commit-notes.md", "allow"],
  [B, "mkdir -p .github/workflows", "allow"],
  [B, "legit commit", "allow", "a different program named legit"],
  [B, "command -v git", "allow", "lookup only"],
  [B, "ls | xargs -I{} echo {}", "allow"],
  [B, "pnpm exec vitest run", "allow"],
  [B, 'echo "unterminated', "allow", "unterminated quote without git is never blocked"],
  [B, "echo ))) ((( }}} $( `", "allow", "garbage without git is never blocked"],
  [P, 'Select-String -Pattern "git commit" -Path docs\\*.md', "allow"],
  [P, "Write-Output 'git push'", "allow"],
  [P, 'Get-Content x.md | Select-String "git add"', "allow"],
  [P, 'Write-Host "never git commit"', "allow"],
  [P, "Get-ChildItem .git -Force", "allow"],
  [P, "$msg = 'git commit'", "allow", "PS assignment of a string"],
  [P, "@'\nnever git commit\n'@ | Set-Content note.txt", "allow", "PS here-string"],

  // --- fix cycle 2, finding 1: lexer constructs that must not hide a later git call ---
  [B, 'read -r a b <<< "1 2"\ngit commit -m x', "deny", "here-string <<< then git"],
  [B, 'while read -r l; do echo "$l"; done <<< "$list"\ngit add .', "deny", "while-read here-string then git"],
  [B, 'x=$(tr a b <<< "$y")\ngit commit -m x', "deny", "here-string in substitution then git"],
  [B, "cat <<< hello\ngit add .", "deny", "cat here-string then git"],
  [B, 'tr a b <<< "$v"\ncd sub && git checkout -- .', "deny", "here-string then chained git"],
  [B, "n=$((1<<4))\ngit commit -m x", "deny", "arithmetic shift $(( )) then git"],
  [B, "echo $(( 1 << 2 ))\ngit commit -m x", "deny", "spaced arithmetic shift then git"],
  [B, "if (( x << 2 )); then echo; fi\ngit reset --hard", "deny", "(( )) shift then git"],
  [P, "Write-Host a <# note #>; git commit -m x", "deny", "PS block comment then git"],
  [P, "Write-Host a <# git status\n#>\ngit add .", "deny", "PS multi-line block comment then git"],
  [B, "echo $'it\\'s'; git push", "deny", "ANSI-C quoting with \\' then git"],
  [B, "cat <<EOF\nbody\nEOF\ngit push", "deny", "control: real heredoc then git"],
  [B, "n=$((1<<4)); echo $n", "allow", "arithmetic shift alone"],
  [B, "cat <<< hello", "allow", "here-string alone"],
  [B, "echo $'it\\'s' git commit", "allow", "ANSI-C quoted text mentioning git"],

  // --- fix cycle 2, finding 2: PowerShell commands without a git invocation ---
  [
    P,
    "@'\n# Commit plan\ngit add docs\ngit commit -m \"x\"\n'@ | Set-Content docs/handoff/commit-plans/M0-W0.md",
    "allow",
    "PS here-string commit plan to Set-Content",
  ],
  [P, `'git commit -m "x"' | Set-Content plan.md`, "allow", "PS string to Set-Content"],
  [P, "'git add docs' | Out-File -Append plan.md", "allow", "PS string to Out-File"],
  [P, '@"\ngit add docs\n"@ | Add-Content plan.md', "allow", "PS expandable here-string to Add-Content"],
  [P, '$s = git status --short; $s -match "add"', "allow", "PS -match on a status variable"],
  [P, "$log = git log -5 --oneline; $log -match 'merge'", "allow", "PS -match on a log variable"],
  [P, '$t = Get-Content .git/HEAD; $t -match "commit"', "allow", "PS -match on file content"],
  [P, '"git commit" | iex', "deny", "PS string to iex still denied"],
  [P, "'git add .' | Invoke-Expression", "deny", "PS string to Invoke-Expression still denied"],
  [P, "$g = 'git'; & $g commit", "deny", "PS computed command still denied"],
  [P, '"git commit -m x" | pwsh', "deny", "PS string piped to pwsh"],
];

assert.ok(cases.length >= 40, "matrix needs at least 40 cases");

for (const [tool, command, expected, label] of cases) {
  const name = `${expected.toUpperCase()} ${tool}: ${label ?? command.replace(/\n/g, "\\n")}`;
  test(name, () => {
    const r = run(tool, command);
    if (expected === "deny") {
      assert.equal(r.status, 2, `expected exit 2, got ${r.status}; stderr=${r.stderr}`);
      assert.match(r.stderr, /BLOCKED by \.claude\/hooks\/block-git\.mjs: .+/);
    } else {
      assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr=${r.stderr}`);
      assert.equal(r.stderr, "");
    }
  });
}

// --- failure behaviour: explicit decisions ---------------------------------------------------------------------

test("empty stdin is allowed", () => {
  const r = pipe("");
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
});

test("whitespace-only stdin is allowed", () => {
  assert.equal(pipe(" \n\t ").status, 0);
});

test("invalid JSON without any git text is allowed", () => {
  assert.equal(pipe("{ not json").status, 0);
});

test("invalid JSON that looks like a mutating git call is blocked", () => {
  const r = pipe('{"tool_input": {"command": "git commit -m x"');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not valid JSON/);
});

test("payload that is not an object is allowed", () => {
  assert.equal(pipe('"git commit"').status, 0);
  assert.equal(pipe("null").status, 0);
  assert.equal(pipe("42").status, 0);
});

test("payload without tool_input / command is allowed", () => {
  assert.equal(pipe(JSON.stringify({ tool_name: "Bash" })).status, 0);
  assert.equal(pipe(JSON.stringify({ tool_name: "Bash", tool_input: {} })).status, 0);
});

test("non-string command is allowed (nothing can run)", () => {
  assert.equal(pipe(JSON.stringify({ tool_name: "Bash", tool_input: { command: ["git", "commit"] } })).status, 0);
  assert.equal(pipe(JSON.stringify({ tool_name: "Bash", tool_input: { command: 42 } })).status, 0);
});

test("other tools are never judged, even if their input mentions git commit", () => {
  const r = pipe(
    JSON.stringify({ tool_name: "Write", tool_input: { command: "git commit -m x", content: "git commit" } }),
  );
  assert.equal(r.status, 0);
});

test("payload without tool_name but with a mutating command is still blocked", () => {
  assert.equal(pipe(JSON.stringify({ tool_input: { command: "git push" } })).status, 2);
});

test("unparseable git (computed subcommand) is blocked, with an actionable message", () => {
  const r = run(B, "git $SUB");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /computed at runtime/);
});

test("a very long benign command is allowed", () => {
  assert.equal(run(B, "echo " + "a".repeat(50_000)).status, 0);
});

test("an over-long command that looks like mutating git falls back to the coarse check and is blocked", () => {
  const r = run(B, "git commit -m x " + "a".repeat(250_000));
  assert.equal(r.status, 2);
});

test("an over-long command without git is allowed", () => {
  assert.equal(run(B, "echo " + "a".repeat(250_000)).status, 0);
});

test("absurdly deep nesting without git is allowed", () => {
  assert.equal(run(B, "echo " + "$(".repeat(20) + "date" + ")".repeat(20)).status, 0);
});

test("absurdly deep nesting around a mutating git call is blocked", () => {
  const r = run(B, "$(".repeat(20) + "git commit -m x" + ")".repeat(20));
  assert.equal(r.status, 2);
});

test("CRLF line endings are handled", () => {
  assert.equal(run(P, "git status\r\ngit commit -m x").status, 2);
  assert.equal(run(P, "git status\r\ngit diff").status, 0);
});

// --- fix cycle 2, finding 3: entry-point guard through a junction / symlink --------------------------------------

test("hook still blocks when the script is reached through a directory junction or symlink", (t) => {
  const base = mkdtempSync(join(tmpdir(), "block-git-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const real = join(base, "real");
  mkdirSync(real);
  copyFileSync(script, join(real, "block-git.mjs"));
  const link = join(base, "link");
  try {
    symlinkSync(real, link, "junction"); // 'junction' needs no privileges on Windows; ignored elsewhere
  } catch (e) {
    t.skip(`cannot create a link here: ${e.code}`);
    return;
  }
  const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: "cd x && git commit -m y" } });
  const r = spawnSync(process.execPath, [join(link, "block-git.mjs")], { input, encoding: "utf8", timeout: 15_000 });
  assert.equal(r.status, 2, `expected exit 2 through the link, got ${r.status}; stderr=${r.stderr}`);
  assert.match(r.stderr, /BLOCKED by/);
});

// --- fix cycle 3: review findings T04-4 .. T04-8 -------------------------------------------------------------------

test("T04-4: crafted quadratic inputs finish well inside the hook timeout and still block a trailing mutation", () => {
  const filler = "pnpm " + "git status ".repeat(17_000);
  let t0 = Date.now();
  assert.equal(run(B, filler).status, 0, "read-only repetition is allowed");
  assert.ok(Date.now() - t0 < 5_000, `took ${Date.now() - t0} ms`);
  t0 = Date.now();
  assert.equal(run(B, filler + "git push").status, 2, "trailing push is still blocked");
  assert.ok(Date.now() - t0 < 5_000, `took ${Date.now() - t0} ms`);
  t0 = Date.now();
  assert.equal(run(B, "find . " + "-exec echo {} ; ".repeat(12_000)).status, 0);
  assert.ok(Date.now() - t0 < 5_000, `took ${Date.now() - t0} ms`);
});

test("T04-6: path-qualified git-* scripts and relative `git` folders are not git invocations", () => {
  assert.equal(run(B, "./tools/git-hooks-check.sh").status, 0);
  assert.equal(run(B, "pnpm exec prettier --check tools/git docs").status, 0);
  assert.equal(run(P, "pnpm exec prettier --check tools\\git docs").status, 0);
  // still caught
  assert.equal(run(B, "git-commit -m x").status, 2);
  assert.equal(run(B, "/usr/lib/git-core/git-commit -m x").status, 2);
  assert.equal(run(B, "git-frobnicate").status, 2);
  assert.equal(run(B, "pnpm exec /usr/bin/git commit -m x").status, 2);
  assert.equal(run(B, "pnpm exec git commit -m x").status, 2);
});

test("T04-7: PowerShell here-string after an assignment (`$plan=@'`) is literal text", () => {
  assert.equal(run(P, "$plan=@'\nit's a plan\ngit add docs\n'@\nSet-Content plan.md $plan").status, 0);
  assert.equal(run(P, '$plan=@"\nit\'s a plan\ngit add docs\n"@\nSet-Content plan.md $plan').status, 0);
  assert.equal(run(P, "$plan=@'\nplan\n'@\ngit add docs").status, 2);
});

test("T04-8: each documented failure-table row has a test", () => {
  // nesting deeper than MAX_DEPTH blocks on ANY git mention (read-only too), allows git-free text
  assert.equal(run(B, "$(".repeat(8) + "git status" + ")".repeat(8)).status, 2);
  assert.equal(run(B, "$(".repeat(8) + "date" + ")".repeat(8)).status, 0);
  // eval of a computed string next to git is refused
  assert.equal(run(B, 'eval "$cmd"; git status').status, 2);
  assert.equal(run(B, 'eval "$cmd"').status, 0);
  // --config-env
  assert.equal(run(B, "git --config-env=core.pager=X log").status, 2);
  // parser-exception row: the work budget throws, the coarse regex decides
  assert.equal(run(B, "pnpm " + "git status ".repeat(17_000) + "git commit -m x").status, 2);
});

// --- registration ------------------------------------------------------------------------------------------------

test(".claude/settings.json registers the hook for Bash and PowerShell with a location-independent command", () => {
  const settings = JSON.parse(readFileSync(join(here, "..", "settings.json"), "utf8"));
  const entries = settings.hooks?.PreToolUse;
  assert.ok(Array.isArray(entries) && entries.length > 0, "hooks.PreToolUse missing");
  const entry = entries.find((e) => /Bash/.test(e.matcher) && /PowerShell/.test(e.matcher));
  assert.ok(entry, "no entry whose matcher covers both Bash and PowerShell");
  assert.equal(entry.hooks[0].type, "command");
  assert.equal(entry.hooks[0].command, 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-git.mjs"');
  assert.ok(!/[A-Za-z]:[\\/]/.test(entry.hooks[0].command), "no hard-coded absolute path");
});
