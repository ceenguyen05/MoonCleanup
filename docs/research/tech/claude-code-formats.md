# Claude Code file formats for a multi-agent build (verified 2026-11-11)

Date: 2026-11-11 · Author: research subagent P2k (claude-code-guide), saved verbatim by the planning orchestrator · Scope: subagent, command, skill, settings/permissions, hooks, CLAUDE.md formats as documented at code.claude.com on 2026-11-11.

> This is a research record. The project's actual decisions about how these formats are used live in `docs/handoff/AGENT_ORCHESTRATION.md` and `CLAUDE.md`. Re-verify against the official docs before relying on anything marked "unverified".

## Executive summary

- **Subagents** live in `.claude/agents/<name>.md`. Only `name` and `description` are required. The `model` field accepts `fable` (verified) and the full ID `claude-fable-5-2`. Unknown frontmatter keys are ignored silently, so typos fail quietly.
- **Custom slash commands** still work in `.claude/commands/`, but the docs say they have been merged into Skills. Skills win when names collide. New work could use `.claude/skills/<name>/SKILL.md`.
- **`isolation: worktree` uses git.** It creates a `git worktree` under `.claude/worktrees/` on a new branch. Do not use it, and do not use `/batch`, which uses worktrees and opens PRs.
- **Agent teams are experimental and off by default.** Enabling them changes how named subagents launch (they become teammates). Leave them disabled for this build.
- **On Fable 5.2 and Opus 5.5, the Task tools (`TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`) are not on by default.** A shared task list needs `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (or `--allowedTools TaskCreate` plus the other Task tools).
- **Git blocking needs two layers.** Permission deny rules match command text, so they miss forms like `git -C . push`. On Windows, `PowerShell(...)` rules are also needed. A PreToolUse hook on `Bash|PowerShell` adds a second layer. Permission rules are documented as not a security boundary.
- **Subagents run in the background by default** when nothing is configured. Results come back as completion notifications in a later turn. Plan orchestration around that.

---

## 1. Subagents (`.claude/agents/<name>.md`)

Source: https://code.claude.com/docs/en/sub-agents.md

The body of the file is the system prompt. Frontmatter is between `---` markers.

```markdown
---
name: frontend-builder
description: Builds React components from a spec. Use proactively for UI tasks.
tools: Read, Write, Edit, Glob, Grep, PowerShell
disallowedTools: WebFetch
model: sonnet
color: blue
permissionMode: acceptEdits
maxTurns: 40
memory: project
effort: high
---

You build React components from the spec you are given.
```

| Field | Required | Allowed values and notes |
| :- | :- | :- |
| `name` | Yes | Max 256 chars. No `:` (reserved for plugin names). No leading `-`. |
| `description` | Yes | When Claude should delegate to this agent. |
| `tools` | No | Comma-separated string or YAML list. Omitted means inherit all tools available to subagents. |
| `disallowedTools` | No | Same format as `tools`. Removed from the inherited or listed set. |
| `model` | No | `sonnet`, `opus`, `haiku`, `fable`, a full model ID (e.g. `claude-fable-5-2`), or `inherit`. |
| `color` | No | `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan`. |
| `permissionMode` | No | `default` (alias `manual`), `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`. Omitted means inherit. |
| `maxTurns` | No | Max agentic turns. The docs state no default. |
| `autoCompactWindow` | No | Integer 100000 to 1000000 (v2.1.296+). Write `200000`, not `200k`. |
| `skills` | No | Skills whose full content is preloaded (first 32 names). |
| `mcpServers` | No | Server name strings or inline definitions. |
| `hooks` | No | Lifecycle hooks (`PreToolUse`, `PostToolUse`, `Stop`). Active only while the subagent runs. |
| `memory` | No | `user`, `project`, or `local`. |
| `background` | No | `true` keeps the subagent in the background even when Claude asks to wait. |
| `omitClaudeMd` | No | `true` skips user, project, and local CLAUDE.md files (v2.1.271+). |
| `effort` | No | `low`, `medium`, `high`, `xhigh`, `max`. Availability depends on the model. |
| `isolation` | No | `worktree` only. **Do not use in this project (creates git worktrees).** |
| `initialPrompt` | No | Auto-submitted first turn when the agent runs as the main session agent. |
| `experimental` | No | Map. Its `cacheTtl` key takes `5m` or `1h`. |

**Tool lists.** Both `tools: Read, Glob, Grep` and a YAML list work. Omitting `tools` inherits every tool available to subagents, minus `AskUserQuestion`, `EndConversation`, `EnterPlanMode`, `ExitPlanMode` (unless `permissionMode: plan`), `ScheduleWakeup`, `WaitForMcpServers`, `Workflow`, and `Agent` at the depth limit. Background subagents also lose built-in tools outside a fixed allowlist, even if listed. MCP tools are kept.

**Built-in tool names** (exact strings, from https://code.claude.com/docs/en/tools-reference.md):
- File and shell: `Read`, `Write`, `Edit`, `NotebookEdit`, `Glob`, `Grep`, `Bash`, `PowerShell`, `Monitor`
- Web: `WebFetch`, `WebSearch`
- Delegation: `Agent` (spawns subagents), `SendMessage`, `Skill`, `Workflow`
- Plan and worktree: `EnterPlanMode`, `ExitPlanMode`, `EnterWorktree`, `ExitWorktree`
- Task list: `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`, `TaskStop`. `TodoWrite` is the older checklist tool.
- Other: `AskUserQuestion`, `LSP`, `ToolSearch`, `CronCreate`, `CronDelete`, `CronList`, `ScheduleWakeup`, `ReportFindings`, `SendFeedback`, `EndConversation`, MCP tools as `mcp__<server>__<tool>`.

Platform note: `Glob` and `Grep` are present by default on Windows but absent by default on macOS, Linux, and WSL, where the agent uses `find`/`grep` through Bash. On Windows, the PowerShell tool is enabled automatically when Git Bash is not installed; Bash stays available when Git Bash is installed.

**Model resolution** (first match wins): (1) per-invocation `model` parameter on the Agent tool call (aliases only); (2) frontmatter `model` (`inherit` = main conversation's model); (3) `CLAUDE_CODE_SUBAGENT_MODEL`; (4) the main conversation's model. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` forces that variable's model onto every subagent.

**Aliases** (https://code.claude.com/docs/en/model-config.md): `fable` is valid (resolves to Fable 5.2; `ANTHROPIC_DEFAULT_FABLE_MODEL` overrides). `sonnet`, `opus`, `haiku` resolve by provider (Anthropic API: Sonnet 5.5, Opus 5.5, Haiku 5.5). Example full IDs: `claude-fable-5-2`, `claude-opus-5-5`, `claude-haiku-5-5`.

**Spawning, nesting, parallelism:**
- Claude delegates automatically based on `description`; you can also name the agent in the prompt, @-mention it, or run the whole session as it with `claude --agent <name>`.
- The Agent tool takes `subagent_type` (plus `model`, `name`, `isolation`, `run_in_background` among documented parameters).
- Subagents can spawn subagents, up to 3 layers below the main conversation by default (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH="1"` disables nesting).
- Concurrency: 20 running subagents by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` changes it). No limit on total subagents per session.
- Background is the default for subagents spawned from the main conversation; results arrive as notifications. `CLAUDE_CODE_FORK_SUBAGENT=0` or `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` makes Claude wait. Test the actual behavior.

**`isolation: worktree`** runs the subagent in a temporary `git worktree` on a new branch. **Forbidden in this project** (owner handles all git).

**Agent teams** (https://code.claude.com/docs/en/agent-teams.md): experimental, disabled by default (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` enables). With teams enabled, named subagents launch as teammates (independent sessions that message each other and share a task list). One team per session, no nesting. **Leave disabled for this build.**

**`/agents`** now prints a reminder to edit `.claude/agents/` files (the interactive wizard is gone since v2.1.198).

**Precedence when names collide:** managed settings → `--agents` → `.claude/agents/` → `~/.claude/agents/` → plugin `agents/`.

**Built-in subagents:** `Explore`, `Plan`, `general-purpose`, `claude`, `statusline-setup`, `claude-code-guide`.

---

## 2. Custom slash commands (`.claude/commands/<name>.md`)

Source: https://code.claude.com/docs/en/skills.md ("Custom commands in `.claude/commands/` have been merged into skills and still work") and https://code.claude.com/docs/en/commands.md.

- **Status:** supported (legacy). `.claude/commands/deploy.md` and `.claude/skills/deploy/SKILL.md` both create `/deploy`; the skill wins on collision. Command files support the same frontmatter as skills except `name` and `paths`.
- **Frontmatter:** `description`, `argument-hint`, `allowed-tools`, `model`, `effort`, `disable-model-invocation`, `user-invocable`, `context`, `agent`, `hooks`, `shell`, `arguments`.
- **Placeholders:** `$ARGUMENTS` (all args), `$ARGUMENTS[N]` (0-based), `$N` shorthand, `$name` (from an `arguments` list). If no placeholder receives arguments, Claude Code appends `ARGUMENTS: <value>`. Escape a literal dollar sign with `\$`.
- **`` !`command` `` pre-execution:** runs before the content reaches Claude; output replaces the placeholder. Each command is checked against permission rules first; any result other than allow aborts the invocation. Pre-approve via `allowed-tools`. A non-zero exit aborts unless you append `|| true`.
- **`@file` references and subfolder namespacing:** not verified.
- **Parallel subagents from a command:** no documented pattern; a command's prose can instruct the model to launch several Agent calls in one message. `context: fork` runs the command/skill in a subagent.

---

## 3. Skills (`.claude/skills/<name>/SKILL.md`)

Source: https://code.claude.com/docs/en/skills.md

| Field | Default and allowed values |
| :- | :- |
| `name` | Directory name. Lowercase letters, numbers, hyphens. |
| `description` | First non-empty line. Combined with `when_to_use`, truncated at 1,536 chars. |
| `when_to_use` | Extra trigger phrases. |
| `argument-hint` | Autocomplete hint. |
| `arguments` | Named args for `$name`. |
| `disable-model-invocation` | `false`. `true` stops Claude from loading it automatically. |
| `user-invocable` | `true`. `false` hides it from the `/` menu. |
| `allowed-tools` / `disallowed-tools` | Tools usable without prompting / removed while active. |
| `model`, `effort` | As for subagents. |
| `context` | `fork` runs the skill in a subagent (`agent` picks the type; default `general-purpose`). |
| `hooks`, `paths`, `shell` | Hooks on invocation; glob patterns limiting activation; `bash`/`powershell` for `!` injection. |

Skill or command? Skills for anything new; commands remain supported. A skill and a command with the same name conflict; the skill wins.

---

## 4. Settings, permissions, and hooks

Sources: https://code.claude.com/docs/en/settings.md, https://code.claude.com/docs/en/permissions.md, https://code.claude.com/docs/en/hooks.md, https://code.claude.com/docs/en/hooks-guide.md

| File | Scope | Commit? |
| :- | :- | :- |
| `~/.claude/settings.json` | User, all projects | No |
| `.claude/settings.json` | Team, this repo | Yes |
| `.claude/settings.local.json` | You, this repo | No (gitignore it) |
| Managed settings | Organization | Admin-controlled |

- Precedence (highest first): managed, command line, project local, shared project, user. Lists merge; **deny rules from any scope block allow rules from any scope.**
- Settings files are strict JSON (no comments, no trailing commas).
- Project `permissions.allow` applies only after folder trust is accepted; `deny`/`ask` apply immediately.

**Permission rule syntax:** `Bash(git commit *)` (current form; also matches the bare command); legacy `Bash(git commit:*)` is equivalent. `PowerShell(git commit *)` for the PowerShell tool (case-insensitive, aliases canonicalized). Evaluation: deny → ask → allow; an allow rule cannot carve an exception out of a deny rule. Bash deny rules apply to subagents too. Rules match the command text as written: `Bash(git push *)` does **not** match `git -C . push` or `/usr/bin/git push` — "not a security boundary".

**Blocking mutating git:** deny `add`, `commit`, `push`, `checkout`, `switch`, `restore`, `branch`, `worktree`, `reset`, `rebase`, `merge`, `stash`, `tag`, `init`, `remote`, `cherry-pick`, `revert`, `clean`, `rm`, `mv`, `pull`, `fetch`, `am` for both `Bash(...)` and `PowerShell(...)`, plus the `EnterWorktree`/`ExitWorktree` tools. Note that denying `branch`, `tag`, `stash`, `remote` also blocks their read-only forms.

**Hooks:** `PreToolUse` entries with `matcher` (e.g. `"Bash|PowerShell"`) and `hooks: [{ "type": "command", "command": "...", "timeout": 10 }]`; per-handler `if` (permission-rule syntax); `shell: "powershell"` runs a hook in PowerShell. Exit code 2 blocks the call and feeds stderr back to Claude; JSON output with `hookSpecificOutput.permissionDecision: "deny"` also blocks. Hooks fire inside subagents. Hooks do not bypass deny rules. A hook has the same text-matching blind spots unless its script parses the command; it can be disabled with `"disableAllHooks": true`. Recommendation: deny rules + a hook (the hook is a small script, to be written by the DevOps agent in M0 and tested).

---

## 5. CLAUDE.md, rules, and memory

Source: https://code.claude.com/docs/en/memory.md

- Hierarchy: managed policy → user (`~/.claude/CLAUDE.md`) → project (`./CLAUDE.md` or `./.claude/CLAUDE.md`, or `AGENTS.md`) → local (`./CLAUDE.local.md`, gitignored). All discovered files are concatenated.
- **Nested `CLAUDE.md` files in subdirectories load on demand** (when Claude reads/writes a file there), not at launch.
- **Imports:** `@path/to/file` (relative to the importing file; up to four hops; not expanded inside code spans/blocks). Imports organize but do not reduce context cost.
- **Size:** target under 200 lines per file; larger files reduce adherence. **Every non-fork subagent loads the CLAUDE.md hierarchy**, so keep the root CLAUDE.md short and link out.
- **`.claude/rules/*.md`:** rules without `paths` load at launch; rules with `paths` (YAML list or comma string of globs) load only when Claude works with matching files.

---

## 6. Newer features relevant to a multi-agent build

Sources: https://code.claude.com/docs/en/workflows.md, https://code.claude.com/docs/en/tools-reference.md, https://code.claude.com/docs/en/permission-modes.md, https://code.claude.com/docs/en/model-config.md

- **Dynamic workflows (`Workflow` tool, `/workflows`):** a JS orchestration script (`agent()`, `parallel()`, `pipeline()`), up to 16 concurrent agents by default; saved in `.claude/workflows/`. Optional for this project; the lead uses the Agent tool directly.
- **Background agents:** `background: true` frontmatter; Ctrl+B; `claude agents` to monitor.
- **Monitor tool:** streams background command output lines back to Claude.
- **Effort levels:** `low`, `medium`, `high`, `xhigh`, `max`; Fable 5.2 / Opus 5.5 / Sonnet 5.5 / Haiku 5.5 default to `medium`. Per-subagent `effort` frontmatter; `CLAUDE_CODE_EFFORT_LEVEL` overrides frontmatter.
- **Plan mode:** `claude --permission-mode plan` or `/plan`; subagents of a plan-mode parent stay in plan mode.
- **Permission modes:** `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`. Deny rules apply in every mode. If the parent is in `acceptEdits`/`auto`/`bypassPermissions`, a subagent's `permissionMode` is ignored.

---

## Gotchas

1. Task tools are off on Fable 5.2 / Opus 5.5 unless `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`.
2. Agent teams change named-subagent behavior; keep `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` unset.
3. Subagents run in the background by default; the lead must wait for completion notifications before integrating.
4. Permission rules are text matches (`git -C . push` bypasses `Bash(git push *)`); add a hook.
5. On Windows, deny both `Bash(...)` and `PowerShell(...)` forms.
6. Allow cannot override deny; avoid a blanket `Bash(git *)` deny unless read-only git should also be blocked.
7. Project allow rules wait for folder trust; deny rules apply immediately.
8. Settings are strict JSON.
9. Unknown frontmatter keys are silently ignored — check spelling (`permissionMode`, `disallowedTools`).
10. `autoCompactWindow` must be a plain integer.
11. `/agents` no longer opens a wizard; edit files directly.
12. Every subagent loads CLAUDE.md — keep it under ~200 lines.
13. Nested CLAUDE.md files load on demand and are not reloaded after compaction until needed.
14. A subagent's `permissionMode` is ignored under a permissive parent mode.
15. Background subagents get a reduced built-in tool set.
16. Workflows cannot use `import()`, `Date.now()`, `Math.random()` or the filesystem directly.
17. Never use `/batch`, `EnterWorktree`, or `isolation: worktree` (git operations).
18. `Monitor` requires recent versions on some providers.
19. `~/.claude/teams/` is runtime state; never hand-edit.
20. `${CLAUDE_PROJECT_DIR}` stays at the project root in hooks.

## Unverified or not found in the docs

- Full Agent tool parameter schema.
- Subfolder namespacing for `.claude/commands/` and `@file` references inside command files.
- Whether listing `TaskCreate` in `tools:` enables it on Fable 5.2 without `CLAUDE_CODE_ENABLE_TODO_TOOLS`.
- Whether an `Agent(isolation:*)` deny rule blocks the frontmatter `isolation` field.
- The full hooks reference (page truncated during research).
- Whether "background by default" and the v2.1.302 fork-mode default conflict in practice.

## Sources

1. Claude Code docs map — https://code.claude.com/docs/en/claude_code_docs_map.md — accessed 2026-11-11 — official
2. Subagents — https://code.claude.com/docs/en/sub-agents.md — accessed 2026-11-11 — official
3. Skills — https://code.claude.com/docs/en/skills.md — accessed 2026-11-11 — official
4. Commands — https://code.claude.com/docs/en/commands.md — accessed 2026-11-11 — official
5. Settings — https://code.claude.com/docs/en/settings.md — accessed 2026-11-11 — official
6. Configure permissions — https://code.claude.com/docs/en/permissions.md — accessed 2026-11-11 — official
7. Hooks reference (partial) — https://code.claude.com/docs/en/hooks.md — accessed 2026-11-11 — official
8. Hooks guide — https://code.claude.com/docs/en/hooks-guide.md — accessed 2026-11-11 — official
9. Memory (CLAUDE.md, rules) — https://code.claude.com/docs/en/memory.md — accessed 2026-11-11 — official
10. Agent teams — https://code.claude.com/docs/en/agent-teams.md — accessed 2026-11-11 — official
11. Tools reference — https://code.claude.com/docs/en/tools-reference.md — accessed 2026-11-11 — official
12. Model configuration — https://code.claude.com/docs/en/model-config.md — accessed 2026-11-11 — official
13. Worktrees — https://code.claude.com/docs/en/worktrees.md — accessed 2026-11-11 — official
14. Dynamic workflows — https://code.claude.com/docs/en/workflows.md — accessed 2026-11-11 — official
15. Permission modes — https://code.claude.com/docs/en/permission-modes.md — accessed 2026-11-11 — official
