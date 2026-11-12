#!/usr/bin/env node
// PreToolUse hook: blocks state-changing git in Bash and PowerShell tool calls.
//
// Why: Cee does ALL git (CLAUDE.md "NEVER"). `.claude/settings.json` has deny rules, but they are plain text
// matches ("not a security boundary": `git -C . push`, `/usr/bin/git push`, `cd x && git commit` slip past).
// This script is the second layer: it parses the command like a shell would (chains, substitutions, quotes,
// heredocs, wrappers such as `bash -c`) and decides on the real git subcommand. A safety net for honest agents,
// not a sandbox: interpreters that spawn git from a script file (`node tool.mjs`) cannot be seen.
//
// Runtime: the harness starts hooks with its own `node` (system Node 22.20.0 today, project Node is 26.13.1),
// so this file must stay dependency-free and use only features present in both.
//
// Protocol (Claude Code hooks reference, https://code.claude.com/docs/en/hooks): PreToolUse JSON on stdin
// ({ tool_name, tool_input: { command } }); exit 2 + stderr = block and feed the reason to the model; exit 0 = allow.
//
// FAILURE BEHAVIOUR (explicit decision, covered by tests):
//   empty stdin                       -> allow  (nothing to judge)
//   invalid JSON                      -> allow, unless the raw text coarsely looks like a mutating git call -> block
//   tool other than Bash/PowerShell   -> allow
//   payload without a command string  -> allow  (nothing can run)
//   parser exception / absurd nesting -> coarse regex on the raw command: block only if it looks like mutating git
//   git subcommand not on the read-only allowlist, or not determinable (`git $x`, aliases, `git -c ...`)
//                                     -> block   (cannot verify read-only; fail closed for git only)
//   anything that contains no git invocation is never blocked, even if the parser is unsure about it.

import { pathToFileURL } from 'node:url';

/** Mutating subcommands from the M0-W0-T04 brief (same list as the permissions deny rules). */
export const DENIED_SUBCOMMANDS = new Set([
  'add', 'commit', 'push', 'pull', 'fetch', 'checkout', 'switch', 'restore', 'branch', 'worktree',
  'reset', 'rebase', 'merge', 'cherry-pick', 'revert', 'stash', 'tag', 'init', 'remote', 'clean',
  'rm', 'mv', 'am',
]);

/** Read-only subcommands. Everything else (aliases, plumbing that writes, `clone`, `gc`, ...) is refused. */
export const READ_ONLY_SUBCOMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files',
  'blame', 'annotate', 'describe', 'ls-tree', 'cat-file', 'grep', 'shortlog', 'rev-list', 'diff-tree',
  'diff-index', 'diff-files', 'show-ref', 'for-each-ref', 'ls-remote', 'check-ignore', 'check-attr',
  'count-objects', 'merge-base', 'name-rev', 'cherry', 'whatchanged', 'version', 'help', 'var',
  'show-branch', 'range-diff', 'verify-commit', 'verify-tag', 'stripspace',
]);

const MAX_DEPTH = 6;
const MAX_LENGTH = 200_000;

// Global git options that consume the next word.
const GIT_ARG_OPTIONS = new Set(['-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix']);
// Options of otherwise read-only subcommands that write files or run programs.
const GIT_DANGEROUS_FLAGS = /^(--output(=|$)|--open-files-in-pager|--ext-diff$)/;

const SH_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash', 'fish', 'csh', 'tcsh']);
const PS_SHELLS = new Set(['pwsh', 'powershell']);
const BOTH_SHELLS = new Set(['cmd', 'wsl']);
const EVAL_WORDS = new Set(['eval', 'iex', 'invoke-expression']);
const START_WORDS = new Set([
  'start-process', 'saps', 'start', 'start-job', 'sajb', 'invoke-command', 'icm', 'foreach-object', 'foreach',
  '%',
]);
const RUNNERS = new Set(['pnpm', 'npm', 'npx', 'pnpx', 'yarn', 'bunx', 'bun', 'corepack']);
const INTERPRETERS = new Set(['python', 'python3', 'py', 'node', 'nodejs', 'deno', 'perl', 'ruby', 'php', 'lua']);
const KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'elseif', 'do', 'while', 'until', '!', 'time', 'nohup', 'exec', 'noglob',
  'setsid', 'call', '&', 'try', 'catch', 'finally',
]);
// Wrapper commands whose own options and positionals are skipped before the real command.
const WRAPPERS = {
  nice: { argOpts: ['-n', '--adjustment'], positional: 0 },
  ionice: { argOpts: ['-c', '-n', '-p', '-P', '-u'], positional: 0 },
  timeout: { argOpts: ['-s', '-k', '--signal', '--kill-after'], positional: 1 },
  stdbuf: { argOpts: ['-i', '-o', '-e'], positional: 0 },
  xargs: { argOpts: ['-I', '-n', '-P', '-d', '-L', '-s', '-E', '-a', '-J', '-R', '-S'], positional: 0 },
  sudo: { argOpts: ['-u', '-g', '-h', '-p', '-C', '-r', '-t', '-U', '-D', '-R', '-T'], positional: 0 },
  doas: { argOpts: ['-u', '-C'], positional: 0 },
  watch: { argOpts: ['-n', '-d'], positional: 0 },
};

const SPAWN_HINT = /(exec|spawn|system|popen|subprocess|child_process|run\s*\()/i;
const COARSE_GIT = new RegExp(
  String.raw`\bgit(?:\.exe)?\b['"]?(?:\s+\S+){0,5}?\s+['"]?(?:${[...DENIED_SUBCOMMANDS].join('|')})\b`,
  'i',
);
const GIT_WORD = /\bgit(?:\.exe)?\b/i;

// ---------------------------------------------------------------------------------------------------------------
// Tokenizer: shell text -> simple commands (lists of words) + substitution bodies that must be scanned as well.
// `dialect` is 'sh' (backslash escapes, backtick substitution, heredocs) or 'ps' (backtick escapes, here-strings).
// ---------------------------------------------------------------------------------------------------------------

/** Index of the `)` matching the `(` at `open` (quote and heredoc aware); `src.length` when unterminated. */
function findCloseParen(src, open, ps) {
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    const ch = src[k];
    if (ch === "'") {
      const e = src.indexOf("'", k + 1);
      if (e < 0) return src.length;
      k = e;
    } else if (ch === '"') {
      k = skipDoubleQuoted(src, k, ps);
    } else if (!ps && ch === '\\') {
      k++;
    } else if (ps && ch === '`') {
      k++;
    } else if (!ps && ch === '<' && src[k + 1] === '<' && src[k + 2] !== '<') {
      const h = parseHeredocHeader(src, k);
      if (h) {
        const eol = src.indexOf('\n', h.end);
        if (eol < 0) return src.length;
        k = consumeHeredocBody(src, eol + 1, h).end - 1;
      }
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return src.length;
}

/** Index of the closing `"` of the string that opens at `start`; `src.length` when unterminated. */
function skipDoubleQuoted(src, start, ps) {
  for (let k = start + 1; k < src.length; k++) {
    const ch = src[k];
    if (!ps && ch === '\\') k++;
    else if (ps && ch === '`') k++;
    else if (ch === '$' && src[k + 1] === '(') k = findCloseParen(src, k + 1, ps);
    else if (ch === '"') return k;
  }
  return src.length;
}

/** Parses `<<[-]DELIM` at index k; returns { delim, dash, expand, end } or null. */
function parseHeredocHeader(src, k) {
  let j = k + 2;
  let dash = false;
  if (src[j] === '-') {
    dash = true;
    j++;
  }
  while (src[j] === ' ' || src[j] === '\t') j++;
  let delim = '';
  let expand = true;
  const q = src[j];
  if (q === "'" || q === '"') {
    const e = src.indexOf(q, j + 1);
    if (e < 0) return null;
    delim = src.slice(j + 1, e);
    expand = false;
    j = e + 1;
  } else {
    const m = /^[A-Za-z0-9_.\-\\]+/.exec(src.slice(j, j + 200));
    if (!m) return null;
    delim = m[0].replace(/\\/g, '');
    if (m[0].includes('\\')) expand = false;
    j += m[0].length;
  }
  return delim ? { delim, dash, expand, end: j } : null;
}

/** Reads heredoc lines from `pos` up to and including the terminator line. */
function consumeHeredocBody(src, pos, h) {
  let body = '';
  while (pos < src.length) {
    let eol = src.indexOf('\n', pos);
    if (eol < 0) eol = src.length;
    const line = src.slice(pos, eol).replace(/\r$/, '');
    pos = eol + 1;
    if ((h.dash ? line.replace(/^\t+/, '') : line) === h.delim) return { body, end: Math.min(pos, src.length) };
    body += line + '\n';
  }
  return { body, end: src.length };
}

/** Collects `$(...)` (and, in sh, backtick) bodies inside a double-quoted/heredoc body. */
function extractSubs(body, ps, subs) {
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (!ps && ch === '\\') k++;
    else if (ps && ch === '`') k++;
    else if (ch === '$' && body[k + 1] === '(') {
      const close = findCloseParen(body, k + 1, ps);
      subs.push(body.slice(k + 2, close));
      k = close;
    } else if (!ps && ch === '`') {
      const e = body.indexOf('`', k + 1);
      if (e > 0) {
        subs.push(body.slice(k + 1, e));
        k = e;
      }
    }
  }
}

function unescapeDoubleQuoted(body, ps) {
  return ps ? body.replace(/`(.)/gs, '$1').replace(/""/g, '"') : body.replace(/\\(["\\$`])/g, '$1');
}

/** Splits `src` into simple commands. Each word is { t: text, dyn: contains an expansion }. */
function tokenize(src, dialect) {
  const ps = dialect === 'ps';
  const commands = [];
  const subs = [];
  const pending = [];
  const n = src.length;
  let cmd = [];
  let text = '';
  let has = false;
  let dyn = false;
  let i = 0;

  const endWord = () => {
    if (has) cmd.push({ t: text, dyn });
    text = '';
    has = false;
    dyn = false;
  };
  const endCmd = () => {
    endWord();
    if (cmd.length) commands.push(cmd);
    cmd = [];
  };

  while (i < n) {
    const c = src[i];

    if (c === '\n') {
      endCmd();
      i++;
      for (const h of pending) {
        const { body, end } = consumeHeredocBody(src, i, h);
        if (h.expand) extractSubs(body, false, subs);
        i = end;
      }
      pending.length = 0;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i++;
      continue;
    }
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '}' || (c === '{' && !has)) {
      endCmd();
      i++;
      continue;
    }
    if (c === '#' && !has) {
      const e = src.indexOf('\n', i);
      i = e < 0 ? n : e;
      continue;
    }
    if (!ps && c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      const h = parseHeredocHeader(src, i);
      if (h) {
        pending.push(h);
        endWord();
        i = h.end;
        continue;
      }
    }
    if (c === "'") {
      if (ps && has && text === '@' && /^[ \t]*\r?\n/.test(src.slice(i + 1, i + 40))) {
        // PowerShell here-string @'...'@ : literal text until a line that is exactly '@
        const e = src.indexOf("\n'@", i + 1);
        text = e < 0 ? src.slice(i + 1) : src.slice(i + 1, e);
        i = e < 0 ? n : e + 3;
        continue;
      }
      const e = src.indexOf("'", i + 1);
      text += e < 0 ? src.slice(i + 1) : src.slice(i + 1, e);
      has = true;
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (c === '"') {
      let body;
      if (ps && has && text === '@' && /^[ \t]*\r?\n/.test(src.slice(i + 1, i + 40))) {
        const e = src.indexOf('\n"@', i + 1);
        body = e < 0 ? src.slice(i + 1) : src.slice(i + 1, e);
        i = e < 0 ? n : e + 3;
        text = '';
      } else {
        const k = skipDoubleQuoted(src, i, ps);
        body = src.slice(i + 1, k);
        i = k + 1;
      }
      extractSubs(body, ps, subs);
      text += unescapeDoubleQuoted(body, ps);
      has = true;
      if (body.includes('$')) dyn = true;
      continue;
    }
    if (c === '$') {
      const nx = src[i + 1];
      if (nx === '(') {
        const close = findCloseParen(src, i + 1, ps);
        subs.push(src.slice(i + 2, close));
        text += '$(...)';
        has = dyn = true;
        i = close + 1;
        continue;
      }
      if (nx === '{') {
        const close = src.indexOf('}', i + 2);
        const e = close < 0 ? n : close + 1;
        text += src.slice(i, e);
        has = dyn = true;
        i = e;
        continue;
      }
      if (nx === "'" && !ps) {
        i++; // $'...' ANSI-C quoting: parse the quoted part as an ordinary single-quoted string
        continue;
      }
      text += '$';
      has = dyn = true;
      i++;
      continue;
    }
    if (c === '`') {
      if (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n')) {
        endWord(); // PowerShell line continuation
        i += src[i + 1] === '\r' ? 3 : 2;
        continue;
      }
      if (!ps) {
        const e = src.indexOf('`', i + 1);
        if (e > 0) {
          subs.push(src.slice(i + 1, e));
          text += '`...`';
          has = dyn = true;
          i = e + 1;
          continue;
        }
      }
      text += src[i + 1] ?? '';
      has = true;
      i += 2;
      continue;
    }
    if (!ps && c === '\\') {
      const nx = src[i + 1];
      if (nx === '\n') {
        i += 2;
        continue;
      }
      if (nx === '\r' && src[i + 2] === '\n') {
        i += 3;
        continue;
      }
      // Escapes before shell-special characters drop the backslash; before ordinary characters the backslash is
      // kept so Windows paths (C:\Program Files\Git\cmd\git.exe) still expose their basename.
      if (nx !== undefined && /[\s'"`$;&|()<>#!*?[\]{}~\\]/.test(nx)) {
        text += nx;
        i += 2;
      } else {
        text += '\\';
        i++;
      }
      has = true;
      continue;
    }
    text += c;
    has = true;
    i++;
  }
  endCmd();
  return { commands, subs };
}

// ---------------------------------------------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------------------------------------------

/** Lower-cased command basenames for a word: [path-split, backslashes-removed]. Extension stripped. */
function cmdNames(t) {
  const norm = (s) => s.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, '');
  const a = t.split(/[\\/]/).pop() ?? '';
  const b = t.replace(/\\/g, '').split('/').pop() ?? '';
  return [norm(a), norm(b)];
}

function dialectOfShell(name) {
  if (SH_SHELLS.has(name)) return 'sh';
  if (PS_SHELLS.has(name)) return 'ps';
  return 'both';
}

function mutating(sub) {
  return `\`git ${sub}\` changes repository state. Cee runs all git; do not retry it in another form. ` +
    'Leave the change in the working tree and describe it; Cee does all git (CLAUDE.md, docs/handoff/WORKFLOW.md).';
}

/** Judges one git invocation. `words[k]` is the first word after `git`. Returns a reason or null. */
function analyzeGit(words, k) {
  for (; k < words.length; k++) {
    const t = words[k].t;
    if (!t.startsWith('-')) break;
    if (t[1] === 'c') { // -c key=value (also the attached form -ckey=value); `--...` and `-C` do not match
      return '`git -c ...` is refused: config overrides can run arbitrary programs (core.fsmonitor, core.sshCommand, alias.*).';
    }
    if (t === '--config-env' || t.startsWith('--config-env=')) {
      return '`git --config-env` is refused: config overrides can run arbitrary programs.';
    }
    if (GIT_ARG_OPTIONS.has(t)) k++;
  }
  if (k >= words.length) return null; // bare `git`, `git --version`, `git --help`
  const sub = words[k];
  const s = sub.t.toLowerCase();
  if (sub.dyn) return 'git subcommand is computed at runtime (`git $x`); cannot verify it is read-only. Write the subcommand literally.';
  if (DENIED_SUBCOMMANDS.has(s)) return mutating(s);
  const rest = words.slice(k + 1).map((w) => w.t);
  if (s === 'config') {
    const reads = rest.some((a) => /^(--get(-all|-regexp|-urlmatch|-color(bool)?)?|--list|-l|--show-origin|get|list)$/.test(a));
    const writes = rest.some((a) => /^(--add|--unset(-all)?|--replace-all|--edit|-e|--rename-section|--remove-section|--global|--system|set|unset|edit)$/.test(a));
    return reads && !writes ? null : '`git config` is only allowed with --get/--list style read flags and without --global/--system/--add/--unset.';
  }
  if (READ_ONLY_SUBCOMMANDS.has(s)) {
    const bad = rest.find((a) => GIT_DANGEROUS_FLAGS.test(a));
    return bad ? `\`git ${s} ${bad}\` writes files or runs programs; refused.` : null;
  }
  return `\`git ${s}\` is not on the read-only allowlist (status, diff, log, show, rev-parse, ls-files and similar), so it cannot be verified as safe. ` +
    'Aliases and plumbing that writes are refused; Cee runs all git.';
}

/** Scans words starting at `start` for a literal `git` word and judges everything after it. */
function findGitWord(words, start) {
  for (let j = start; j < words.length; j++) {
    const names = cmdNames(words[j].t);
    if (names.includes('git')) {
      const v = analyzeGit(words, j + 1);
      if (v) return v;
    }
  }
  return null;
}

/** Script text carried as arguments of a shell wrapper (`bash -c "..."`, `cmd /c git ...`, `pwsh -Command ...`). */
function scanShellArgs(args, dialect, depth, ctx) {
  const kept = [];
  for (let j = 0; j < args.length; j++) {
    const t = args[j].t;
    if (dialect === 'ps' && /^-(e|ec|enc|encodedcommand)$/i.test(t) && args[j + 1]) {
      // PowerShell -EncodedCommand carries base64 UTF-16LE text; decode it and judge it as a script.
      const decoded = Buffer.from(args[j + 1].t, 'base64').toString('utf16le');
      const v = scan(decoded, 'ps', depth + 1, ctx);
      if (v) return v;
      continue;
    }
    if (/^-{1,2}[A-Za-z][\w-]*$/.test(t) || /^\/[a-zA-Z]$/.test(t)) continue;
    kept.push(t);
  }
  if (kept.length === 0 && ctx.rawGit) {
    return 'a shell reads its script from stdin (`... | sh`) in a command that mentions git; cannot verify it.';
  }
  return scan(kept.join(' '), dialect, depth + 1, ctx);
}

/** Judges one simple command (list of words). Returns a reason or null. */
function analyze(words, dialect, depth, ctx) {
  let i = 0;
  for (;;) {
    const w = words[i];
    if (!w) return null;
    const t = w.t;

    if (/^\d*(>>?|<|>\||&>>?)$/.test(t)) { i += 2; continue; } // bare redirection operator + its target
    if (/^\d*(>>?|<|>\||&>>?)./.test(t)) { i++; continue; } // redirection with attached target
    if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(t)) { i++; continue; } // VAR=value prefix
    if (/^\$[\w:.]+\+?=/.test(t)) { i++; continue; } // PowerShell $x=...
    if (t.startsWith('$') && words[i + 1] && /^([-+*/%]|\?\?)?=$/.test(words[i + 1].t)) { i += 2; continue; } // $x = ...

    const [name, alt] = cmdNames(t);

    if (KEYWORDS.has(name)) { i++; continue; }
    if (name === 'command' || name === 'builtin') {
      i++;
      while (words[i] && words[i].t.startsWith('-')) {
        if (/^-[vV]/.test(words[i].t)) return null; // lookup only
        i++;
      }
      continue;
    }
    if (name === 'env') {
      i++;
      for (; words[i]; i++) {
        const o = words[i].t;
        if (o === '-S' || o === '--split-string') return scanShellArgs(words.slice(i + 1), dialect, depth, ctx);
        if (['-u', '-C', '--unset', '--chdir'].includes(o)) { i++; continue; }
        if (o.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(o)) continue;
        break;
      }
      continue;
    }
    if (Object.hasOwn(WRAPPERS, name)) {
      const spec = WRAPPERS[name];
      i++;
      while (words[i] && words[i].t.startsWith('-')) i += spec.argOpts.includes(words[i].t) ? 2 : 1;
      i += spec.positional;
      continue;
    }

    // --- the command proper ---
    if (name === 'git' || alt === 'git') return analyzeGit(words, i + 1);
    const dashed = /^git-(.+)$/.exec(name);
    if (dashed) {
      if (DENIED_SUBCOMMANDS.has(dashed[1])) return mutating(dashed[1]);
      if (!READ_ONLY_SUBCOMMANDS.has(dashed[1])) return `\`git-${dashed[1]}\` is not on the read-only allowlist.`;
      return null;
    }
    const rest = words.slice(i + 1);
    if (SH_SHELLS.has(name) || PS_SHELLS.has(name) || BOTH_SHELLS.has(name)) {
      return scanShellArgs(rest, dialectOfShell(name), depth, ctx);
    }
    if (EVAL_WORDS.has(name)) {
      if (rest.some((a) => a.dyn) && ctx.rawGit) {
        return `\`${name}\` runs text built at runtime in a command that mentions git; cannot verify it. Write the git command literally.`;
      }
      return scanShellArgs(rest, dialect, depth, ctx);
    }
    if (START_WORDS.has(name)) {
      const v = findGitWord(rest, 0);
      if (v) return v;
      return rest.some((a) => /\s/.test(a.t)) ? scanShellArgs(rest, dialect, depth, ctx) : null;
    }
    if (name === 'alias' || name === 'set-alias' || name === 'new-alias' || name === 'sal') {
      // Aliasing git would hide later calls from this parser.
      if (rest.some((a) => /(^|=|\s)git(\.exe)?(\s|$)/i.test(a.t))) return 'aliasing git is refused; call `git <subcommand>` directly.';
      return null;
    }
    if (name === 'find') {
      for (let j = 0; j < rest.length; j++) {
        if (['-exec', '-execdir', '-ok', '-okdir'].includes(rest[j].t)) {
          const v = analyze(rest.slice(j + 1), dialect, depth, ctx);
          if (v) return v;
        }
      }
      return null;
    }
    if (RUNNERS.has(name)) return findGitWord(rest, 0);
    if (INTERPRETERS.has(name)) {
      const k = rest.findIndex((a) => /^-(c|e|p|pe|r|E|-eval|-print)$/.test(a.t));
      if (k >= 0) {
        const code = rest.slice(k + 1).map((a) => a.t).join(' ');
        if (SPAWN_HINT.test(code) && COARSE_GIT.test(code)) {
          return 'inline script appears to spawn a mutating git command; refused.';
        }
      }
      return null;
    }
    if (/^[$`]/.test(t) && ctx.rawGit && rest.some((a) => DENIED_SUBCOMMANDS.has(a.t.toLowerCase()))) {
      return 'command name is computed at runtime next to a mutating git subcommand word; cannot verify. Write `git <subcommand>` literally.';
    }
    // PowerShell/sh: a quoted command string used as pipeline input to iex (`"git commit" | iex`).
    if (i === 0 && /\s/.test(t) && !w.dyn && words.length === 1 && ctx.rawGit) {
      return scan(t, dialect, depth + 1, ctx);
    }
    return null;
  }
}

function scan(src, dialect, depth, ctx) {
  // Too deep to judge: refuse only when git is mentioned at all; a git-free command is never blocked.
  if (depth > MAX_DEPTH) return ctx.rawGit ? 'command nesting is too deep to verify and it mentions git.' : null;
  if (dialect === 'both') return scan(src, 'sh', depth, ctx) ?? scan(src, 'ps', depth, ctx);
  const { commands, subs } = tokenize(src, dialect);
  for (const s of subs) {
    const v = scan(s, dialect, depth + 1, ctx);
    if (v) return v;
  }
  for (const words of commands) {
    const v = analyze(words, dialect, depth, ctx);
    if (v) return v;
  }
  return null;
}

/**
 * Judges a shell command string. Returns a human-readable reason when it must be blocked, otherwise null.
 * Throws on internal parser errors; `evaluate` converts that into the coarse fallback.
 * @param {string} command
 * @param {'sh'|'ps'|'both'} [dialect]
 */
export function checkCommand(command, dialect = 'both') {
  if (command.length > MAX_LENGTH) throw new Error('command too long to parse');
  return scan(command, dialect, 0, { rawGit: GIT_WORD.test(command) });
}

/**
 * Full hook decision for the raw stdin text.
 * @param {string} stdinText
 * @returns {{ block: boolean, reason?: string, note: string }}
 */
export function evaluate(stdinText) {
  const text = typeof stdinText === 'string' ? stdinText : '';
  if (!text.trim()) return { block: false, note: 'empty stdin' };

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return COARSE_GIT.test(text)
      ? { block: true, reason: 'hook input was not valid JSON and looks like a mutating git call; refused.', note: 'invalid JSON, coarse match' }
      : { block: false, note: 'invalid JSON, no git' };
  }
  if (payload === null || typeof payload !== 'object') return { block: false, note: 'payload is not an object' };

  const tool = typeof payload.tool_name === 'string' ? payload.tool_name : '';
  if (tool && !/^(bash|powershell)$/i.test(tool)) return { block: false, note: `tool ${tool} is not a shell tool` };

  const command = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input.command : undefined;
  if (typeof command !== 'string') return { block: false, note: 'no command string' };

  const dialect = /^bash$/i.test(tool) ? 'sh' : /^powershell$/i.test(tool) ? 'ps' : 'both';
  try {
    const reason = checkCommand(command, dialect);
    return reason ? { block: true, reason, note: 'blocked' } : { block: false, note: 'allowed' };
  } catch {
    return COARSE_GIT.test(command)
      ? { block: true, reason: 'could not parse the command and it looks like a mutating git call; refused.', note: 'parser error, coarse match' }
      : { block: false, note: 'parser error, no git' };
  }
}

async function main() {
  let input = '';
  if (!process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
  }
  const result = evaluate(input);
  if (result.block) {
    process.stderr.write(`BLOCKED by .claude/hooks/block-git.mjs: ${result.reason}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // A hook bug must not block unrelated commands: report and let the call through (exit 0).
    process.stderr.write(`block-git hook internal error (allowed the call): ${err?.message ?? err}\n`);
  });
}
