# M0 final integrated code review (code-reviewer)

Task M0-final-code-review / status: done / 2026-11-13 / code-reviewer, Opus 5.5. Read-only review of the working tree as
of ~11:45 (git status/diff read-only; no git mutation, no source edits). Scope: the four reports `M0-neon-swap.md`,
`M0-small-hooks-server.md`, `M0-look-polish-r2b.md`, `M0-small-hooks-client.md`, plus repo-wide boundary / banned-API /
secret / CSP / deploy-config scans.

## Verdicts

| Scope | Verdict |
| --- | --- |
| M0-neon-swap (db TLS, env, migrate retry) | **APPROVED** |
| M0-small-hooks-server (late inputs, TRANSPORT env, N10, N11, bot reconnect cap, at_capacity:rooms) | **APPROVED** |
| M0-small-hooks-client (FXAA on Low, bench stars, reportGpuFrameMs) | **APPROVED** (code only, see "not checked") |
| M0-look-polish-r2b (pcf3, grazing fade, look-ground, boulder base) | **APPROVED for code/boundaries**; look/VT acceptance belongs to visual-qa |
| Boundaries, banned APIs, secrets, CSP, vercel.json / render.yaml vs HOSTING_GUIDE | **no blocking findings** |

Blocking findings: **none**.

## Evidence

- **DB TLS is genuinely verifying.** Checked against installed `postgres@4.1.1` (pinned in `packages/db/package.json`):
  `src/index.js:519-523` takes `o.ssl` over the URL `sslmode`; `socket.js:19-23` would map a bare `require` to
  `rejectUnauthorized:false`, so the explicit object from `packages/db/src/connection.ts:63-70` is required and correct.
  SNI is sent on upgrade (`socket.js:150`). `channel_binding=require` in Neon's console string is a recognised option in
  4.1.1 (`index.js:602-607`), not forwarded as a startup parameter. Custom CA path keeps `rejectUnauthorized:true`.
- **Env fail-closed.** `apps/server/src/ops/env.ts:197-208` (TLS mandatory off local, pooler refused), `:216-223` (N11,
  value never echoed); `packages/db/src/config.ts:89` (N10: unset `ENV_NAME` is not local). render.yaml sets
  `ENV_NAME=production`, so the hosted build is unaffected.
- **Retry classification**: `packages/db/src/errors.ts:5-19` includes `CONNECT_TIMEOUT`/`PROBE_TIMEOUT`/class 08/57P0x;
  migrate-cli prints only the code (`migrate-cli.ts:17-23`). No host/password in logs.
- **/readyz cannot keep Neon awake by itself**: only on-demand callers (no client code or pinger calls it;
  HOSTING_GUIDE:255 says Render health check is `/healthz`). Important for the 100 CU-h/month budget.
- **Focused tests re-run by me** (Node 26.13.1 via fnm PATH prefix): `packages/db` vitest 4 files / 30 passed + 2 skipped;
  `apps/server` `src/ops` + `net/admission-ws-rooms.test.ts` 4 files / 54 passed.
- **GPU timestamp semantics**: three r187 `WebGPUTimestampQueryPool._resolveQueries` returns the duration of the LAST frame
  in the resolved set (`framesDuration[frames.at(-1)]`), so `debug/module.ts:236` reports a per-frame value, not an
  8-frame sum. Correct.
- **effectiveAa** (`visuals/look-knobs.ts:159-162`): explicit knob wins, Low+smaa derives fxaa; `effectiveGtao` follows it;
  shared preset table untouched (no contract change).
- **Boundaries**: no `three|colyseus|@colyseus/*|node:*|fs|ws|react|window|document|navigator|process.env` in non-test
  `packages/{shared,sim,world,protocol,game-data}/src`; client never imports `@moon-cleanup/db`; server has no `three`
  import; no `@moon-cleanup/*/src` deep imports outside the eslint boundaries test fixture.
- **Banned three APIs**: no `WebGLRenderer|EffectComposer|ShaderMaterial|RawShaderMaterial|renderAsync|PostProcessing` in
  `apps/client/src` non-test code.
- **`any`**: only `visuals/post/look-stages.ts:129,182,190`, each with an eslint-disable and a why-comment. Acceptable.
- **Secrets**: regex scan of 1 058 tracked + untracked non-ignored files (connection strings with passwords, private keys,
  AWS/GitHub/Slack/Stripe tokens, Neon `npg_`, JWTs): one hit, `apps/server/src/ops/env.test.ts:172`, a fake
  `owner:hunter2-pw@ep-cool-123456...` fixture. `.env` / `.env.*` ignored (`.gitignore:27-28`); `.env.example` holds
  placeholders that N11 now refuses in production. render.yaml uses `sync:false` / `generateValue`.
- **CSP vs inline styles**: `vercel.json` `style-src 'self'` (no `unsafe-inline`). Client uses only CSSOM
  (`el.style.cssText`, React style props), which CSP does not govern; no `innerHTML`, `<style>`, `setAttribute("style")`,
  `insertRule` or `adoptedStyleSheets`. Built `apps/client/dist/index.html` (10:49) has only external script/link; bundle has
  no `eval(` / `new Function(`. Fonts are self-hosted woff2. Consistent.
- **render.yaml / vercel.json vs HOSTING_GUIDE**: region `ohio` (render.yaml:12, guide 74/243/396), `MAX_CLIENTS=12` /
  `MAX_ROOMS=3` (also environments.md:118, `.env.example:99`), `/healthz` health path, `TRANSPORT` dashboard-only, Neon
  direct URL + empty CA all match. vercel `ignoreCommand` now handles a missing/unknown previous SHA (builds) and includes
  `assets`.

## Non-blocking findings (suggestions)

1. `apps/client/vite.config.ts:15` `sourcemap: true` publishes a 10 MB `index-*.js.map` on Vercel. Intended for Sentry,
   but `'hidden'` plus upload-and-delete would avoid shipping full source publicly. Owner: devops.
2. `debug/module.ts:236`: GPU frame time reaches dynres only where the debug module is registered (dev / `?perf=1`);
   production dynres steers on frame interval. Author already flagged it; lead decides whether a slim reporter belongs in
   the composition root.
3. `ops/late-input-log.ts:24-35`: throttled drops are only flushed on the next drop after 10 s, so a final burst can stay
   unlogged (room-stats `lateInputs` still counts it, as the comment says). Optional flush on room dispose.
4. `ops/env.ts:47`: the `<[^>]*>` alternative could in theory match a hand-made secret containing `<...>`; Render
   `generateValue` output cannot. Fine as is.
5. N10 doc line (unset `ENV_NAME` now fails migrate) missing from `packages/db/README.md`; author-labelled.
6. Neon free-compute budget: 100 CU-h/project/month; anything that polls `/readyz` more often than every 5 min (an
   UptimeRobot monitor on `/readyz`) would keep the compute awake ~730 h/month and exhaust it. Suggest one sentence in
   HOSTING_GUIDE checklist G: monitor `/healthz` only.

## Not checked (labelled)

- `pnpm verify` on this state (lead's integration gate); full client vitest / tsc / eslint (relied on authors' reports).
- Any live Neon or Render connection; uWS optional-dependency fetch on Render; real browser CSP enforcement on a deployed
  Vercel build (static analysis only).
- Visual quality, VT numbers, frame-cost claims of r2b and FXAA (no captures or GPU runs by me; visual-qa / perf scope).
- `tools/bots` reconnect cap beyond reading the report (no live server kill test).
- Shadow kernel shader math in `lighting/shadow-filter.ts`, `look-ground.ts` mask stamping and `props.ts` rock geometry
  beyond the authors' unit tests (not line-reviewed).
- Files outside the four reports' scopes, `.claude/**`, CI workflow, `packages/config` eslint rule changes.

Files: this report only.
