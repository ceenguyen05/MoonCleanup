# M1-W0-T04 devops-engineer: installs + CI determinism and size lanes

Date 2026-11-13. Status: done (verify green). No git used.

## Dependencies (install audit)
Only one new dependency was needed.

| Dep | Where | Version | Licence | Rationale |
| --- | --- | --- | --- | --- |
| `@vitest/browser-playwright` | root devDependencies | 5.1.0 (exact, matches vitest 5.1.0 peer) | MIT | Provider for Vitest browser mode (ADR-0019 "Vitest 5.1 unit + browser mode"; netcode §17 sim determinism in a browser). Pulls `@vitest/browser` 5.1.0, `@vitest/mocker`, `@vitest/ui`, `ws`, `sirv`, `pngjs`, `magic-string`, `@blazediff/core` (14 packages added, all MIT-style). Reuses existing `playwright` 1.65.0. |

Checked and NOT needed (already present or no dependency required):
- Dust-chunk compression: no library. Node `zlib` on server, `CompressionStream` in the browser (data-model §3.7b, WDS §6). tech-stack names none.
- `tsx` 4.23.15 and `drizzle-kit` 0.31.11 already installed.

Lifecycle scripts: install ran clean; the 14 new packages have no install scripts needing approval; `allowBuilds` unchanged. Lockfile verified with `pnpm install --frozen-lockfile` on Node 26.13.1 (the first add was run under Node 22; lockfile identical).

## Changes
- `packages/config/vitest/browser.ts`: placeholder note replaced; new `browsers` option (default chromium). `node.ts`: excludes `*.browser.test.ts`.
- `packages/world`: `vitest.config.ts`, `vitest.browser.config.ts` (engines via `MC_GOLDEN_BROWSERS`), `test/golden/` STUB case, scripts `test:golden`, `test:golden:node`. `packages/sim`: `test:golden` script (no cases yet).
- `.github/workflows/ci.yml`: `golden` job replaced by `determinism` (sim+world golden on Node, world golden in chromium/firefox/webkit), wired into `ci-gate`. Size check (`size:check`, 20 MB gzip) is still enforced in the `build` job. `smoke-webgl2` already runs `pnpm test:e2e` (software WebGL2) on every PR and push; only its comment was refreshed.
- Prototypes: `prototypes/dust-sim/{harness,p1-scalar-procedural,p2-stroke-atlas-ledger,p3-client-paint-minmerge}` each with private `package.json` (no deps, no scripts) and README stub. `pnpm-workspace.yaml` does not list `prototypes/*`. No isolated install was run (no real deps).

## Honest limits
- The golden test is a STUB: an FNV-1a hash of an integer-only sequence, constant `2086404176`. It proves both lanes execute; it is not a real world/sim determinism test. Real grid/ledger/avatar-step cases must replace it when the code exists.
- Verified locally: Node lane and Chromium browser lane pass. Firefox/WebKit were NOT run locally (CI installs them); the CI job itself has not run.
- Playwright smoke does not set `MC_REQUIRE_CANVAS=1`; enabling it is a later decision once software-GL boot is proven.

## Evidence
`pnpm verify` (Node 26.13.1): 52/52 turbo tasks successful (lint, typecheck, test, build; 3m01s, 0 cached). Only warnings are existing framer-motion "use client" directive notices in the client build. Prettier clean on touched files.

Dependencies requested: none further. Next: lead may let contracts agents typecheck again.
