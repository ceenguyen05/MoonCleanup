# @moon-cleanup/netsim

**Path:** `tools/netsim` - **Owner role:** `qa-test-engineer`

## Purpose

Network conditions for testing netcode: an in-process conditioner (latency, jitter, loss, reordering, bandwidth caps) that
wraps a transport in unit/integration tests, and Toxiproxy configurations (Toxiproxy server v2.13.0 binary or Docker, driven with
`toxiproxy-node-client` 4.1.0) for TCP-level faults between bots and a real server. Presets mirror target players: good, typical
cable, bad wifi, cold-start stall.

## What Fable will build here

`src/conditioner/` (conditioner + presets, deterministic seeded randomness) and `toxiproxy/` (JSON proxy/toxic definitions and
helper docs). Tests prove the conditioner is deterministic for a seed.

## Key contracts consumed

`@moon-cleanup/shared` (protocol catalog, units). It stays transport-agnostic: no dependency on Colyseus.

## Notes

Toxiproxy is a separate binary (not an npm package): note its install in the PR that first uses it. `toxiproxy-node-client` is
community-maintained (slow cadence): verify it still works before relying on it.

## Commands

```
pnpm --filter @moon-cleanup/netsim test
```

`lint` / `typecheck` are echo placeholders until sources land.
