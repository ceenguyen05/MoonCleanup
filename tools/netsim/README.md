# @moon-cleanup/netsim

**Path:** `tools/netsim` - **Owner role:** `qa-test-engineer`

Network conditioner for netcode tests (netcode.md section 17). v0 is a seeded local TCP proxy: point a client at the
proxy port instead of the server and every connection gets latency, jitter and loss in both directions.

## Run

```
pnpm --filter @moon-cleanup/netsim netsim -- --listen 2581 --target 2571 --profile typical --seed 1
```

`tools/bots` starts this itself for `--netsim <profile>` (listen = server port + 10).

## Profiles (`src/conditioner/profiles.ts`)

Latency and jitter are round-trip values (half applied per direction).

| Profile | RTT | Jitter | Loss | Extra |
| --- | --- | --- | --- | --- |
| clean | 0 | 0 | 0 | none |
| good | 40 ms | +/- 6 | 0 | none |
| typical (the /bot-test standard) | 120 ms | +/- 30 | 1 % | none |
| bad (harsh) | 250 ms | +/- 50 | 5 % | none |
| outage | as typical | | | 5 s blackhole starting 30 s after proxy start (traffic held, not dropped) |
| coldstart | as typical | | | first client chunk of each connection held 8 s (server cold start) |

Loss is modelled as TCP: a "lost" chunk is held for one retransmission timeout (max(200 ms, 2 RTT)) and delays all
bytes behind it (head-of-line blocking); ordering is always preserved. Randomness is seeded (mulberry32), per connection
and direction, so the injected delays are reproducible; wall-clock timing still depends on the host.

## Not yet

Toxiproxy configs (`toxiproxy/`) are not written: the in-process proxy covers the spike. Reordering and bandwidth caps
are not modelled. UDP/WebTransport is out of scope (the game uses WebSocket).

## Tests

```
pnpm --filter @moon-cleanup/netsim test
```
