# @moon-cleanup/sim

**Path:** `packages/sim` - **Owner role:** `gameplay-systems-engineer` - **Layer:** room simulation (environment-agnostic)

## Purpose

The authoritative-capable, deterministic-ish **kinematic** room simulation in plain TypeScript with typed component
stores and a typed event bus (ADR-0010, 0022): movement and low-gravity kinematics, jet pack, raycast-suspension
vehicles, tools, cargo, economy rules, robot behavior, unlock logic, and the `RoomSim` implementation. No physics engine,
no ECS library. It runs on the server (fixed step 20 Hz by default), on the client for prediction and later in a Web
Worker for offline solo.

## What Fable will build here

`src/movement/`, `src/vehicles/`, `src/tools/`, `src/economy/`, `src/robots/`, `src/unlocks/`, `src/room/`
(`RoomSim`: `step(dt)`, `applyInput`, `snapshot()`, `onEvent`). Barrel `src/index.ts`.

## Key contracts consumed

From `@moon-cleanup/shared`: `RoomSim` interface, input command format, entity component shapes, event catalog, IDs &
units, balance config schemas, save format. From `@moon-cleanup/world`: `PlotGrid`, height sampling, stroke
rasterization. From `@moon-cleanup/game-data`: balance and content tables.

## Rules

- No DOM, no Node APIs, no three.js, no Colyseus (so it can run in a Web Worker and the transport can be swapped).
- Consumed by `apps/client`, `apps/server`, `tools/bots`, `tools/perf`, `tools/balance-sim`.
- The client and server do not import `@moon-cleanup/game-data` directly in this scaffold (the dependency graph in
  module-boundaries shows `game-data -> sim` only). If UI or server code needs table data, propose a contract change
  (for example `sim` re-exports a read-only view) instead of adding the edge.

## Commands

```
pnpm --filter @moon-cleanup/sim test
```

`lint` / `typecheck` are echo placeholders until sources land.
