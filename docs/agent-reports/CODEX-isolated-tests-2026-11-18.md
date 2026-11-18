# Isolated client tests (2026-11-18)

The seven `src/app` files identified in the 2026-11-17 checkpoint and W6-T03 wiring report all passed individually. The DOM input lock suite also passed. These are isolated results, not a full client-suite or integration-state verification. Node v26.13.1, Vitest v5.1.0; working directory `apps/client`.

PowerShell setup: `$env:Path = "$env:APPDATA\fnm\aliases\default;$env:Path"`. Each file was run separately with `pnpm exec vitest run <file> --testTimeout=30000 --hookTimeout=30000`:

| File | Result | Vitest duration |
| --- | --- | --- |
| `src/app/solo-host.test.ts` | PASS 10/10, exit 0 | 14.25 s |
| `src/app/readout-writer.test.ts` | PASS 7/7, exit 0 | 11.80 s |
| `src/app/hud-writer.test.ts` | PASS 4/4, exit 0 | 10.84 s |
| `src/app/round5-wiring.test.ts` | PASS 6/6, exit 0 | 20.37 s |
| `src/app/menu-writer.test.ts` | PASS 5/5, exit 0 | 5.28 s |
| `src/app/online-readouts.test.ts` | PASS 6/6, exit 0 | 7.34 s |
| `src/app/online-loop.integration.test.ts` | PASS 1/1, exit 0 | 114.10 s |
| `src/gameplay/input/dom-input-lock.test.ts` | PASS 8/8, exit 0 | 2.11 s |

The DOM input suite includes the detach cursor-release case. The integration test starts a real local ShiftRoom server in-process. I failed to inspect that test before running it, contrary to the task's no-server instruction; its `afterAll` shuts the server down, the test passed, and its recorded process tree was no longer running afterward. No GPU or browser checks and no full `pnpm verify` were run. No source edits were made.
