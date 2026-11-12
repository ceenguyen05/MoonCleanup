# @moon-cleanup/bots

**Path:** `tools/bots` - **Owner role:** `qa-test-engineer`

## Purpose

Headless bot clients that join a real server (local by default, or the one Render Free service during
an isolated, Cee-authorized test window; environments.md §3) with the Colyseus SDK and the
shared protocol codec, run 16-player scenarios and write reports (`tools/bots/reports/` is git-ignored). Used by `/bot-test`
and the M0-W2 netcode spike (one 16-bot room must stay under 50% of the 0.1-CPU budget at 20 Hz).

## What Fable will build here

`src/clients/` (bot client: auth, join, input generator driving `packages/sim` input commands), `src/scenarios/` (idle, roaming,
cleaning, join/leave churn, reconnect storm), `src/reports/` (latency, bandwidth, tick-time summaries) and a `src/cli.ts`
entry. `@colyseus/loadtest` 0.18.4 is available for spawning N clients.

## Key contracts consumed

From `shared`: protocol catalog, input command format, IDs, REST DTOs. From `protocol` (codecs, session state machine) and
`sim` (input/validation helpers, replaying snapshots).

## Commands

```
pnpm bots                                   # turbo run bots --filter=@moon-cleanup/bots
pnpm --filter @moon-cleanup/bots test
```

The `bots`, `lint` and `typecheck` scripts are echo placeholders until sources land.
