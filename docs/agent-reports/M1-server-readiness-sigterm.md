# M1 server readiness, Windows SIGTERM, capture 404 (devops, 2026-11-17)

## 1. Server readiness: NOT a code defect
- Boot with Node 26 `--import tsx src/app/index.ts`, ENV_NAME=local, PERSISTENCE_DRIVER=memory, TRANSPORT=ws, PORT=5297, dummy 36/40-char secrets, ALLOWED_ORIGINS, CLIENT_IP_HEADER= (blank), no DATABASE_URL. Full log: config -> `transport=ws` -> `game server listening` -> `server ready` (bootMs 6296 idle). /healthz 200, /readyz 200 (`db:"down"`, `dbState:"not-configured"` is expected for memory).
- Cause of the earlier timeout: cold tsx boot is slow (6 s idle, 18.9 s on the loaded machine; a second loaded run became ready in ~4 s) and the waiter gave up early. The only boot output before ready is the config line, so it looked hung. Env names are PORT (all interfaces, 0.0.0.0/::) and ENV_NAME/PERSISTENCE_DRIVER (both required, no default). Recommendation: wait >= 60 s for /healthz, or use the built dist/index.js. No source change.

## 2. Windows SIGTERM drain
- Real external SIGTERM is impossible on Windows: Node `child.kill("SIGTERM")` is TerminateProcess. Measured: exit signal SIGTERM, 0 shutdown log lines, no drain, no checkpoint. Render (Linux) is unaffected.
- Ctrl+C route (PowerShell GenerateConsoleCtrlEvent(0,0), same console, launcher ignoring): NOT delivered from the agent shell (no real console); server needed force kill. Not a pass.
- Handler wiring on Windows, real boot of index.ts, then `process.emit("SIGTERM")` after /healthz: logs `shutdown: draining` -> `shutdown: room checkpoints` -> `shutdown: complete`, exit code 0, port released. This exercises installShutdown + startServer.shutdown but is a self-emitted signal, not OS delivery.
- Room checkpoint with a live room: not driven by the live process (no client/contract joined). Covered by existing `apps/server/src/app/server.test.ts` (asserts `shutdownCheckpoint()` `{rooms:1,saved:1,failed:0,timedOut:0}`): server.test.ts + shutdown.test.ts 10/10 pass.
- LIMIT: true OS SIGTERM delivery and a live-room drain end to end remain Linux-only checks (WSL/Render/Docker not used).

## 3. Capture 404 (character verify lab)
- Cause: the lab `index.html` had no icon link, so the browser requested `/favicon.ico` (the client's real favicon is only `/favicon.svg`, linked from the app index.html); Vite answered 404. The lab page fetches no other assets (blockout manifest/GLBs exist in public/assets/blockout and are not used by the lab). Inferred by code/asset inspection; browser not re-run (GPU owned by another agent).
- Fix (lab folder only): `<link rel="icon" href="data:,">` in verify/index.html; run-lab.mjs now records `http <status>: <url>` for any response >= 400 into the report console list, so the next capture verifies it. Confirm on the next lab run that no `http 404` entry remains.

## Processes / hygiene
All started processes ended (servers exited or timed out; port 5297 free). No GPU, DB, secrets or git used. Scratch scripts only in the session scratchpad/TEMP (`%TEMP%\sg`).
