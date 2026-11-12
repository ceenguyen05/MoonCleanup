# ADR-0002: Free-tier hosting topology ($0 forever)

- **Status:** Accepted (2026-11-12)
- **Deciders:** owner (budget), lead/orchestrator
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) sections 1 and 4 (Hosting row)

## Context

The owner fixed a **$0 forever** hosting budget on 2026-11-11. The game needs a static client, an always-reachable authoritative WebSocket server and a database. Facts that constrain the choice (all from [platform-limits.md](../research/tech/platform-limits.md)):

- Vercel Hobby is static-client only here (WebSocket functions cap at 300 s) and is non-commercial.
- Render Free web service: 0.1 CPU / 512 MB, spins down after 15 min without inbound traffic (WebSocket messages count), ~1 min cold start, may restart at any time, 750 instance-hours per workspace per month.
- Render Hobby workspace: 5 GB outbound per month; with no payment method, free services are suspended for the rest of the month.
- **Aiven free MySQL was retired on 6 Nov 2026.** The only free Aiven database is PostgreSQL (1 CPU, 1 GB RAM, 1 GB storage, powers off when idle).

## Options considered

1. **Vercel Hobby (client) + Render Free x2 (prod, staging) + Aiven PostgreSQL Free.** Pro: $0; matches every constraint. Con: cold starts, restarts, bandwidth suspension risk, 1 GB DB.
2. **Same, but Aiven MySQL Developer ($5/mo).** Pro: keeps MySQL, 8 GB, always on. Con: breaks the $0 rule.
3. **Render paid instance ($7/mo) for always-on.** Pro: no cold start, 0.5 CPU. Con: breaks $0.
4. **Vercel Functions for realtime.** Pro: one host. Con: 300 s connection cap, no shared memory between instances.
5. **Fly.io or other host with UDP.** Pro: WebTransport possible. Con: card required, not free.

## Decision

Option 1:

- **Vercel Hobby**: static client only, immutable-asset headers and SPA rewrite in `vercel.json`.
- **Render Free web service x2**: production tracks the `release` branch, staging tracks `main`. `render.yaml` always sets `plan: free` explicitly (omitting it creates a paid service).
- **Aiven for PostgreSQL Free**: one service, two logical databases (prod, staging). The engine choice supersedes the MySQL assumption in older research.
- **GitHub Free** (public repo) for CI.
- The owner **accepted the bandwidth-suspension risk**: no hard-cap logic is built; bandwidth is measured and minimized instead (ADR-0015, ADR-0020). See OPEN_QUESTIONS Q4.

## Consequences

**Positive**
- Total cost $0; every service is replaceable (ADR-0014 transport swap, ADR-0016 plain SQL migrations).

**Negative / risks**
- 750 free hours cover one 24/7 service; two services that are both awake exhaust them and Render then suspends **all** free services. Staging must stay asleep except during tests.
- Cold start and random restarts drop every room: the server checkpoints every <=30 s and on SIGTERM, and the client has a "waking server" flow (ADR-0015, ADR-0016).
- 5 GB/month is roughly 5-6 full 16-player hours; exceeding it suspends the game for the rest of the month.
- Aiven free DB powers off when idle and may change cloud/region; 1 GB storage limits saves (ADR-0016).
- Vercel Hobby forbids commercial use: no ads, payments or paid contributors.

## Revisit trigger

- Any free tier is retired or tightened (as MySQL was).
- The suspension actually happens in a month with real players: owner reconsiders a paid Render plan ($7) or a different host.
- The game is monetized in any way (Vercel Pro required).

## Evidence

- [platform-limits.md](../research/tech/platform-limits.md) (Executive summary, A, B2, B7, C1, E1-E3)
- [data-auth-observability.md](../research/tech/data-auth-observability.md) (section 0)
- [netcode-case-webrtc-webtransport.md](../research/tech/netcode-case-webrtc-webtransport.md) (no UDP on Render)

## Amendment 2026-11-12

Added after the principal-engineer planning review (M9, M10, M12, M15, M17). Details in [environments.md](../architecture/environments.md) and [system-overview.md](../architecture/system-overview.md).

- **Instance-hours:** the client wakes the server only on the first user interaction on the title screen, never on page load and never for bots/crawlers; instance-seconds are logged month-to-date. M0 verifies whether Render health checks count as traffic (drop `healthCheckPath` if they do). Automated tests never target production; staging bot runs are ≤ 5 min.
- **Capacity:** admission by measured tick budget with `MAX_ROOMS` = 3 as a hard ceiling (ADR-0025); the free tier hosts only a few live Contracts at once.
- **Release order:** production Render deploys on `checksPass`; the production Vercel client is deployed by a GitHub workflow only after production `/healthz` reports the commit's protocol version (Vercel's automatic `release` deployments are disabled).
- **Static hosting:** `vercel.json` rewrites only extension-less paths to `index.html`, serves Vite output under `/_app/` and content-hashed pipeline output under `/assets/`, and carries the CSP, COOP and `/hub/*` headers. `render.yaml` is the source of truth for server env values; environments.md mirrors it.
