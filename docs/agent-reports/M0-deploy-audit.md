# M0 deploy docs audit (devops-engineer), 2026-11-13

Status: DONE (docs only; no external contact, no installs, no git).

## Verified OK
- DB choice: Aiven PostgreSQL Free (ADR-0002; free MySQL retired). Schema `prod`, created by the migrate CLI.
- `render.yaml` env keys all match `apps/server/src/ops/env.ts` (ENV_NAME local|production, MAX_CLIENTS 12, CLIENT_IP_HEADER rules).
- Build/start commands match package scripts; `pnpm --filter @moon-cleanup/db run migrate` is wired in the build and fails on missing/unreachable DB. `seed` is an echo placeholder (exit 0).
- TLS: CA option `ssl {ca, rejectUnauthorized:true}` overrides `sslmode=require` (postgres.js source checked).
- `/healthz` (liveness) and `/readyz` (DB probe) exist; Render health path `/healthz`.
- Vercel: vercel.json install/build/output consistent with root-dir-blank workspace build; client reads VITE_SERVER_HTTP_URL / VITE_SERVER_WS_URL.

## Gaps found
1. NET_SPIKE=1 refused when ENV_NAME=production (env.ts:182) but ADR-0029/SETUP_CHECKLIST implied enabling it on the service. Documented recipe: temporary ENV_NAME=local + PERSISTENCE_DRIVER=memory + NET_SPIKE=1, bots need `--allow-hosted`. Code option (owner decision): allow in production for a window.
2. Old guide said TLS verification "must be implemented"; it already is. Stale "placeholder scripts" text removed.
3. ALLOWED_ORIGINS and region in render.yaml are placeholders (commented now).
4. Client silently falls back to localhost when VITE_SERVER_* unset at build. Optional hardening (devops-engineer, vite.config.ts): fail production build when unset.
5. Terrain payloads under assets/terrain must be committed (only raw/ and cache/ ignored); dist ~27 MB with maps, size:check is gzip first-load excluding maps, CI only.
6. CSP connect-src allows only *.onrender.com.

## Fixes applied
docs/HOSTING_GUIDE.md rewritten as the single runbook; docs/SETUP_CHECKLIST.md NET_SPIKE note; render.yaml comments (no value changes); apps/client/.env.example warning.

## Open items (Cee / unverified)
Card requirement at signup for each provider; Vercel Node 26.x availability; uWebSockets.js GitHub-tarball install on Render; whether health checks count as keep-awake traffic; Render/Vercel current limits ("check pricing page").

## Addendum 2026-11-13 (START HERE checklist pass)
- HOSTING_GUIDE.md: added START HERE checklist A-G (public repo, Aiven, Render Blueprint env table, Vercel env table, chicken-and-egg order, push-to-deploy diagram, troubleshooting table); reference sections fixed (Ohio, Node, size:check, known gaps).
- render.yaml: `region: ohio`. `.nvmrc` verified honoured by Render docs, so no `NODE_VERSION`.
- vercel.json: `ignoreCommand` now diffs against `VERCEL_GIT_PREVIOUS_SHA`, builds when missing/unfetchable (tested with empty, bogus, valid SHA); `assets` added to watched paths. CSP unchanged: one headless load of the real build under the exact headers showed no `Refused to` errors; one harmless `Function("")` eval probe (zod) is blocked and caught.
- Open: uWS fallback boot-log line TODO; Render Node 26.13.1 acceptance and Render empty-prompt handling for `sync: false` keys unverified until first apply.
