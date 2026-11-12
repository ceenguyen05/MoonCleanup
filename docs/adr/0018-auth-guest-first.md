# ADR-0018: Authentication - guest-first, opaque refresh token + short JWT

- **Status:** Accepted (2026-11-12); staging-origin note superseded by [ADR-0029](0029-single-deploy-branch-main.md) (no staging service; origins in security.md)
- **Deciders:** lead/orchestrator, backend-data-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Auth row), section 5 (cookies)

## Context

Players should join with no signup friction (low-friction co-op). The client lives on `*.vercel.app` and the server on `*.onrender.com`, which are different sites, so cookies would be third-party and are blocked by modern browsers. Browser WebSocket APIs cannot set an `Authorization` header, and tokens in URLs leak into logs. Progress must persist per guest and later link to a real account (Discord/Google/GitHub).

## Options considered

1. **Build guest auth: opaque refresh token (hashed in DB) + 15-min `jose` JWT; Bearer for REST; token in Colyseus join options to `onAuth`.** Pro: no vendor, no cookies, ~small; matches Colyseus. Con: we own token security.
2. **Better Auth (anonymous plugin + `onLinkAccount`).** Pro: ready linking. Con: dependency and its own session model; more weight on 0.1 CPU.
3. **Auth.js / Lucia.** Pro: familiar. Con: Lucia unmaintained; Auth.js now maintained by the Better Auth team; cookie-centric.
4. **Cross-site cookies.** Pro: simple. Con: blocked by Safari/Firefox/Chrome partitioning.
5. **Anonymous without persistence.** Pro: simplest. Con: loses progress.

## Decision

Option 1:
- First visit: client calls "create guest"; server creates a player row and returns a **refresh token** (>= 256 bits, stored only as a hash with player ID, expiry, last-used, rotation lineage) and a **JWT access token** (15 min; `sub`, `exp`, `iat`, `iss`, `aud`; signed with `jose`; key in a Render env var, never committed).
- Refresh tokens rotate on use; reuse of a spent token revokes the whole family.
- REST uses the **Bearer header**. For realtime, the access token goes in **Colyseus join options**, verified in `onAuth`; origin allowlist is checked; tokens never appear in WebSocket URL query strings.
- The guest's refresh token is held in `localStorage`; the UI offers a **recovery-code** export.
- Identities (Discord/Google/GitHub OAuth) are separate rows linked to the guest player **post-launch**.
- Rate limiting via `rate-limiter-flexible` (in-memory); CORS uses an exact origin list, never a suffix match.

## Consequences

**Positive**
- Zero-friction entry, no cookies, upgrade path to accounts preserved in the schema.

**Negative / risks**
- For a guest, the token is the account; clearing storage loses it (mitigated by recovery code).
- Research recommended an auth-message-first-frame for plain WebSockets; with Colyseus the join options travel in the matchmaking request body rather than the WebSocket URL, which is an equivalent safeguard but should be re-verified in the M0 spike.
- `localStorage` tokens are readable by any XSS: strict CSP and no third-party scripts in the client.
- Preview URLs change per commit; the origin allowlist must accept a fixed staging origin.

## Revisit trigger

- Account linking is scheduled: re-evaluate Better Auth versus extending the in-house design.
- A security review finds token handling inadequate.

## Evidence

- [data-auth-observability.md](../research/tech/data-auth-observability.md) (sections 5.1-5.4, 7)
- [netcode-case-colyseus.md](../research/tech/netcode-case-colyseus.md) (`onAuth`, join options)
- [platform-limits.md](../research/tech/platform-limits.md) (E3 item 13, CORS and previews)

## Amendment 2026-11-12

Added after the principal-engineer planning review (M13, M14). Details in [security.md](../architecture/security.md) §3 and §5.

- **Rotation grace window:** reuse of the **immediate predecessor** token within 60 s (database clock) is treated as a retry, not theft: an unused successor is superseded and a fresh one issued; if the successor was already used, the server answers 409 `TOKEN_SUPERSEDED` without revoking. Only older or later reuse revokes the family. This prevents a lost response from destroying a guest account.
- **Recovery codes:** ≥ 80 bits (16 Crockford base32 characters); failed recovers are throttled per IP **and globally** (100 failures per hour → 15-min lock) and audited.
- **Client IP for rate limits:** only the single Render-documented client-IP header (`CLIENT_IP_HEADER`); arbitrary `X-Forwarded-For` chains are never trusted, and if XFF must be used only its right-most entry counts.
- **Room auth:** rooms are joined through `POST /v1/contracts/:id/join`, which returns a seat reservation and a 30-s join ticket verified in `onAuth`; public matchmake methods are disabled.
