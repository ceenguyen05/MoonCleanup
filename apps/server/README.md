# @moon-cleanup/server

**Path:** `apps/server` - **Deploys to:** one Render Free web service (`moon-cleanup-server` from `main`,
ADR-0029) - **Dev port:** 2567 + agent offset N

## Purpose and ownership

Colyseus 0.18 game server on the uWebSockets.js transport plus the REST API. Rooms are thin adapters over the pure
`RoomSim` from `packages/sim`; entity state goes through Schema (no StateView, encode once), dust/strokes/compact snapshots
through `broadcastBytes` with the codec from `packages/protocol`. Render Free budget: 0.1 CPU / 512 MB, 20 Hz sim, 10 Hz
snapshots, checkpoint to the database every <= 30 s and on SIGTERM.

| Folder | Owner role | Content |
| --- | --- | --- |
| `src/app` | integrator | Composition root, boot, graceful shutdown wiring |
| `src/net` | netcode-engineer | Colyseus rooms, matchmaking, lobby listing, seat reservation, auth hook, bytes channel |
| `src/sim` | gameplay-systems-engineer | Fixed-step loop driver, input validation against sim rules, robot scheduling budget |
| `src/world` | terrain-dust-engineer | Authoritative dust state, plot completion, interest regions, checkpoint serialization |
| `src/api` | backend-data-engineer | REST: guest auth, profile, contracts list/create/join codes, `/healthz`, `/readyz` |
| `src/persistence` | backend-data-engineer | Save/load/checkpoint services, write coalescing |
| `src/ops` | devops-engineer | Env parsing (zod), pino logger, room-stats metrics line, bandwidth counters |

## What Fable will build here

All of `src/`, with `src/app/index.ts` producing the bundle `dist/index.js` that `render.yaml` starts with
`node apps/server/dist/index.js`. `/healthz` must return 2xx quickly (Render `healthCheckPath`). The placeholder `dev`,
`build`, `lint`, `typecheck` scripts only echo; `devops-engineer` replaces them in M0-W0-T03 (`tsx watch`, an `esbuild` bundle with entry `src/app/index.ts`) and also adds the minimal no-op entry stub `src/app/index.ts` so the bundle builds. The integrator replaces/extends it in M0-W1-T06; after that `src/app/**` is integrator-only.

## Key contracts consumed

From `@moon-cleanup/shared`: protocol catalog, `RoomSim` interface, REST DTOs, save format, event catalog. From
`protocol` (codecs), `sim` (`RoomSim`), `world` (dust ledger, interest regions) and `db` (repositories). Never imports
three.js and never `apps/client`.

## Environment

See `apps/server/.env.example` (all keys of the canonical list). Production values live only in the Render
dashboard; `render.yaml` declares the keys (`sync: false` for secrets).

## Notes and open items (verify before relying)

- `uWebSockets.js` is not on npm; it is installed from the GitHub tag `v20.71.0` (`github:uNetworking/uWebSockets.js#v20.71.0`;
  the tag exists, ABI 147 binaries cover Node 26). pnpm may ask for `pnpm approve-builds`.
- The REST framework (Colyseus built-in router vs. a small router on uWS) is **not decided** in the docs: write an ADR
  before adding one; do not invent a dependency.
- `@moon-cleanup/game-data` is deliberately not a direct dependency (the module graph shows `game-data -> sim` only);
  `sim` should expose what the server needs.
- Dependencies pinned at verified npm `latest` on 2026-11-12: colyseus 0.18.12, @colyseus/core 0.18.28, @colyseus/schema
  5.0.48 (the tooling research doc says 5.0.47), @colyseus/uwebsockets-transport 0.18.5, jose 6.2.17, pino 10.4.0,
  rate-limiter-flexible 11.4.1, zod 4.6.7, @sentry/node 11.12.0.

## Commands

```
pnpm --filter @moon-cleanup/server dev     # placeholder -> tsx watch
pnpm --filter @moon-cleanup/server build   # placeholder -> esbuild bundle (run by render.yaml via turbo)
pnpm --filter @moon-cleanup/server start   # node dist/index.js
pnpm --filter @moon-cleanup/server test
```
