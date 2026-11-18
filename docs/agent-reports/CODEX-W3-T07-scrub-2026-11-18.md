# W3-T07 Solo scrub — 2026-11-18

## In progress

The feed rejected work when no shift-state snapshot seeded its tool code. Added a failing-first regression for this case and seed the unknown tool only from a valid authoritative Solo frame; an explicitly selected tool continues to reject mismatched stale frames. Live diagnosis showed the suspected unseeded code was not the cause on the reproduced run: shift state and frame both had code 0. With temporary debug probes (removed after capture), real Solo input produced valid sweeping telemetry, animator sweepWeight 1 and third-person poser kneel 0.99999986. The camera/tutorial overlay obscures the avatar in the screenshots, so a clear visual signoff and head glue check remain open. The poser reports `headValid=false` even while the input reports true: the head target still needs to be wired into the poser.

## Checks

- `fnm exec --using=26 node node_modules/vitest/vitest.mjs run apps/client/src/app/solo-avatar.test.ts -t 'starts work from valid authoritative telemetry'`: failed on old behavior (expected bar tool class, got none).
- `fnm exec --using=26 node node_modules/vitest/vitest.mjs run apps/client/src/app/solo-avatar.test.ts`: 14/14 passed after change.
- `fnm exec --using=26 node docs/agent-reports/M1-W3-T07-visual-acceptance-evidence/capture-solo.mjs --out docs/agent-reports/CODEX-scrub-evidence --port 5311 --query '?preset=medium&dynres=off'`: real UHD 620 WebGPU, pointer lock true, strokes registered, no console/page errors; warnings include warmup pipelines and font preloads. Images are obstructed. Temporary Playwright runtime probe verified telemetry, pose and kneel as above. Probe browser closed and Vite 5311 stopped.

## Not yet run

Unobstructed visual acceptance, poser head-target integration and head glue/lag, deterministic lab recapture, final typecheck and lint; full verify deferred until M1 slice ready.
