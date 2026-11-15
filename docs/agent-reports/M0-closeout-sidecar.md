# M0 close-out: capture sidecar camera (VT-M0-12)

Status: done / 2026-11-14 / qa-test-engineer (tools/screenshots only)

## Changes
- `tools/screenshots/src/harness.ts`: `McLookLike.info()` type gains optional `camera` (position, quaternion, forward, vfovDeg, aspect, nearM, farM).
- `tools/screenshots/src/sidecar.ts`: `camera` is now `{ view, pose: {positionM, quaternion, forward, aspect, nearM, farM} | null, vfovDeg: number | null, note? }`. Older builds without `camera` give `pose: null`, `vfovDeg: null` and a note; no throw.
- `tools/screenshots/src/vt12.test.ts`: old-build case asserts null + note; new case asserts pose/vFOV copied.

## Results (actual)
- Node v26.13.1 via fnm prefix. `typecheck` clean; `test`: 4 files, 33 tests passed.
- Real capture: `screenshots -- S01 --lane gpu --preview --build --port-offset 9 --tod noon --step 30 --tier B --preset medium --scale floor` (served production on 5182). Sidecar `tools/screenshots/output/sidecar-check/S01-noon-tierB-medium-webgpu-1920x1080@1-nohud-floor.json` contains position [-3, 2.0319, -23], quaternion, forward [0.103, 0.0058, 0.995], aspect 1.7778, near 0.05, far 30000, vfovDeg 60.
- Port 5182 not listening afterwards (only TIME_WAIT). The harness closed its own browser; the other chrome.exe processes belong to Cee's session and were not touched.

## Notes
- Output dir `tools/screenshots/output/sidecar-check` is git-ignored scratch; delete freely.
- Not touched: STATUS, task rows, other folders.
