# M1 devops: client chunk split

Status: done (config only).

Changes
- `apps/client/package.json`: `"sideEffects": ["*.css", "**/*.css", "./src/main.ts", "./src/app/boot.ts"]`.
- `apps/client/vite.config.ts`: `build.rolldownOptions.output.codeSplitting.groups` (Vite 8; `advancedChunks` is deprecated): `vendor-three`, `vendor-react` (react, react-dom, scheduler, motion*), `vendor-online` (@colyseus, @sentry).

Measured (`vite build`, scratchpad outDirs `chunk-before/`, `chunk-after/`)
- Entry `index-*.js`: 2,101,125 B before, 736,465 B after.
- New: vendor-three 1,063,271 B, vendor-react 360,993 B (both modulepreloaded, needed for solo boot), vendor-online 169,929 B.
- vendor-online is not imported statically by the entry and not modulepreloaded, so solo boot does not fetch it. online-room chunk grew 13 kB to 54 kB (it now holds net code).
- Total solo-boot JS is unchanged by design; the gain is cache separation and the online SDK/Sentry leaving boot. The netcode agent's lazy tables in net/room-session.ts are separate.
- Remaining warning: a chunk over the size limit (three). The `INEFFECTIVE_DYNAMIC_IMPORT` for packages/sim is untouched.

Verification
- `vitest run src/app`: 79/79 pass on the second run. The first run had 1 failure that did not repeat and was not investigated (likely load-related timeout).
- No servers started. No net/ files touched. size:check budget not re-run against the new chunks; check thresholds if it keys on the entry name.
