# @moon-cleanup/protocol

**Path:** `packages/protocol` - **Owner role:** `netcode-engineer` - **Layer:** codecs + client session (environment-agnostic)

## Purpose

Bit-packed binary codecs for the dust field, strokes and compact snapshots; the client session state machine
(connect, auth, wake-up from Render cold start, reconnect); the snapshot interpolation buffer; and shared test vectors
so client, server and bots agree byte for byte. Entity state travels through Colyseus Schema; the hot path uses our own
`DataView` codec over `broadcastBytes` / `sendBytes` (ADR-0014, 0015, 0023).

## What Fable will build here

`src/codec/` (bit writer/reader, per-message encoders), `src/session/` (state machine, reconnect/backoff),
`src/interpolation/` (snapshot buffer), `src/vectors/` (golden binary fixtures + round-trip tests). Barrel `src/index.ts`.

## Key contracts consumed (from `@moon-cleanup/shared`)

Protocol catalog (`protocol/messages`, `protocol/channels`, `PROTOCOL_VERSION`), IDs & units, stroke format
(`world/stroke`), input command format (`sim/input`), entity component shapes.

## Rules

- No DOM, no Node APIs, no three.js, no Colyseus: must run on a browser main thread, in a Web Worker and in Node.
- Consumed by `apps/client`, `apps/server` and `tools/bots`. Never imports from `apps/*` or `tools/*`.

## Commands

```
pnpm --filter @moon-cleanup/protocol test
```

`lint` / `typecheck` are echo placeholders until sources land.
