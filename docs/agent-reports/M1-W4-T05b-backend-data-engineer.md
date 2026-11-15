# M1-W4-T05b backend-data-engineer: per-IP seat cap env knob

Status: done (no net/** change needed).

## Changes
- `apps/server/src/ops/env.ts`: `MAX_SEATS_PER_IP` (integer 1..64, default 6, blank = default) -> `ServerEnv.maxSeatsPerIp`; also in `describeEnvForLog`. Errors are keyed (`MAX_SEATS_PER_IP: ...`) and value-free.
- `apps/server/src/app/server.ts`: passes `maxSeatsPerIp` in the existing `admission` option (`AdmissionLimits.maxSeatsPerIp` already existed in net).
- `apps/server/src/ops/env.test.ts`: default, blank, valid (1, 12, 64), invalid (0, 65, -3, 2.5, non-numeric).
- `docs/HOSTING_GUIDE.md`: env table row added (optional, not set in render.yaml).

## Evidence (apps/server)
tsc clean; eslint src/ops src/app clean; prettier clean (incl. HOSTING_GUIDE.md); vitest src/ops src/app: 5 files, 65 tests passed.

## Next / notes
- Not edited (outside ownership): `apps/server/.env.example` and `render.yaml`; append the name `MAX_SEATS_PER_IP=6` to `.env.example` if wanted.
