# ADR-0020: Observability on free tiers

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, devops-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Observability row)

## Context

We must see errors and bandwidth/CPU health at $0 on a 0.1-CPU server. Render Hobby keeps logs 7 days and caps them at 6,000 lines/min per instance. Bandwidth is the main existential risk (ADR-0002): if included egress is exhausted with no card, free services are suspended. A full OpenTelemetry SDK is too heavy on 0.1 CPU. Keep-alive pings keep a Render Free instance awake but burn most of the 750 workspace hours.

## Options considered

1. **Sentry Developer (browser + node 11.12.x, source maps via `@sentry/vite-plugin`) + pino 10 JSON logs + one "room stats" line per room per minute + `/healthz` and `/readyz` + optional UptimeRobot free.** Pro: free quotas suffice (5k errors, 5M spans); minimal CPU. Con: no real metrics store; 1 Sentry user.
2. **Full OpenTelemetry + Grafana Cloud.** Pro: rich metrics. Con: SDK overhead on 0.1 CPU; series limits (10k).
3. **Log shipping only (Better Stack/Grafana).** Pro: retention. Con: unverified Render stream compatibility.
4. **No observability.** Con: blind to cold-start/bandwidth problems.
5. **Self-hosted Prometheus.** Con: no free always-on host.

## Decision

Option 1:
- **Errors:** Sentry Developer for browser (Vercel) and Node (Render); upload source maps in the Vercel build with the Sentry token as an env var only; filter noisy errors; sample REST traces low and **never trace per tick**.
- **Logs:** pino JSON to stdout; **never log per tick**; redact `Authorization`/tokens.
- **Metrics:** one structured **room stats** line per room per minute: tick p50/p95/max, overruns, players, messages in/out, **bytes out**, save time/size/failures, DB pool waits, event-loop lag, RSS/heap vs 512 MB. A token-protected Prometheus `/metrics` endpoint is a later option.
- **Health:** `/healthz` (cheap liveness) and `/readyz` (DB reachable, room manager ready).
- **Bandwidth watch:** per-room bytes-out counters feed a periodic warning log at 50/80% of a daily budget derived from 5 GB/month (no hard-cap logic; owner accepted suspension risk).
- **Uptime:** UptimeRobot free hitting `/healthz` is **optional**; Sentry's single uptime monitor is a backup. Do not enable always-on pings by default because they consume ~720-744 of the 750 shared free hours.

## Consequences

**Positive**
- Near-zero overhead; room stats make the CPU and bandwidth hypotheses (ADR-0014, ADR-0015) verifiable.

**Negative / risks**
- Logs are retained only 7 days and can be rate-limited at 6,000 lines/min.
- Whether keep-alive pings comply with Render's terms is unverified; the included outbound bandwidth amount is also flagged unverified in the research.
- No dashboards; analysis is by reading log lines.

## Revisit trigger

- A log or error quota is exceeded repeatedly.
- A paid Render plan is adopted: add metrics scraping/OTel.
- Production incidents lack data to diagnose.

## Evidence

- [data-auth-observability.md](../research/tech/data-auth-observability.md) (section 6, Executive summary 9-11)
- [platform-limits.md](../research/tech/platform-limits.md) (B7 logs and metrics, E3)
- [tooling-and-libraries.md](../research/tech/tooling-and-libraries.md) (Sentry 11.12, pino 10.4)
