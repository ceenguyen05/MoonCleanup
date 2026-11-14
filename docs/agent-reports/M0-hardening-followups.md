# M0 hardening follow-ups (integrator, 2026-11-13)

Source: `M0-netcode-fix-batch.md` (N8 wiring, N1 env/runbook, N9). Status: COMPLETE. No installs, no git.

## Changes

| Item | Change |
| --- | --- |
| N8 | `apps/client/src/app/boot.ts`: `moduleSearch = launchSearch(win.location.search, import.meta.env.PROD)` passed to `RenderModule` and `VisualsModule`. Test: new `app/boot-wiring.test.ts` (prod ignores `terrainBase`/`terrain`: real `parseBenchOptions` falls back to `/assets/terrain/`; dev honours them; boot.ts source feeds both modules the filtered search). |
| N1 | `apps/server/.env.example`: `CLIENT_IP_HEADER=` already blank; comment rewritten (blank = socket address, only with `ENV_NAME=local`, why local runs need it; production keeps `true-client-ip` in `render.yaml:66`). `tools/bots/README.md`: new "Local per-IP limits" paragraph (unknown bucket 10 joins/min, 8 sockets, 2 room creates/min; blank refused unless local). |
| N9 | `apps/client/vite.config.ts` `server.fs.deny`: Vite defaults repeated (setting it replaces them) plus `**/assets/terrain/{raw,cache,fixtures}/**` and `**/tools/.bin/**`. |

## Evidence (same state)

- client: `tsc` exit 0, `eslint src/app vite.config.ts` exit 0, `vitest run` 22 files / 240 tests passed.
- server: `tsc` exit 0, `eslint src` exit 0, `vitest run` 12 files / 113 tests passed.
- `vite build` OK (7.5 s); `dist/assets/terrain/` has manifest + 3 hashed `.bin` (raw not shipped).
- e2e smoke, `MC_PORT_OFFSET=5 MC_REQUIRE_CANVAS=1`: 2 passed, 1 skipped (`/healthz` test needs a server URL; none was started).
- N9 dev check (Vite on 127.0.0.1:5178, stopped afterwards): `/@fs/<repo>/assets/terrain/manifest.json` 200, `/@fs/.../horizon-map.0600f54d4815.bin` 200 (6,977,254 B), `/assets/terrain/manifest.json` 200 (plugin); 403 for `assets/terrain/raw/ldem_16.lbl` and `.img`, `cache/bake-stats.json`, `fixtures/height-cube-fixture-64.json`, `tools/.bin/ktx/bin/ktx-jni.dll`, `apps/server/.env.example`.
- Bench harness, one capture (`tools/perf capture --scene bench --backend webgl2 --headless true --runs 1`, `terrainBase=/@fs/<repo>/assets/terrain/`): logged `[perf] bench terrainSource=real`; artifact `C:\Users\caseyn\AppData\Local\Temp\claude\430d3d07c3d5e4f4\5a7524bb-e0d6-4adc-a1f7-8310425628b1\scratchpad\cap\m0\bench-tierB-medium-webgl2-2026-11-13T12-03-24-819Z.json` (smoke only, not a perf measurement).
- Servers: my Vite on 5178 killed; netstat shows only 2571 (PID 21312) and 5193 (PID 2432), not mine.

## Notes

- `?terrain=` for look-dev S01 is also stripped in production (intended); look-dev scenes that need external terrain must run in dev or use the default same-origin path.
- `fs.deny` is dev-server only; the production build never serves `/@fs/`.
- `pnpm verify` not run (lead runs once per integration state).
