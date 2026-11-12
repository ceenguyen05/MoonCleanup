# @moon-cleanup/e2e

**Path:** `tests/e2e` - **Owner role:** `qa-test-engineer`

## Purpose

Playwright 1.65.0 end-to-end flows against a running client + server: boot and wake-up from a cold server, guest sign-in, join a
contract, clean a plot, reconnect, settings. Two lanes (ADR-0019): a CI smoke lane on software WebGL2 and local real-GPU runs. Playwright
reports (`playwright-report/`, `test-results/`) are git-ignored.

## What Fable will build here

`specs/` (the `*.spec` flows), `fixtures/` (server/client launchers, test accounts, seeded rooms) and a `playwright.config`. Ports follow the
agent offset scheme in module-boundaries section 6.

## Key contracts consumed

`@moon-cleanup/shared` (IDs, REST DTOs, protocol version) - black-box testing otherwise: no imports from app internals.

## Notes

The workspace package lives under `tests/*` (added to `pnpm-workspace.yaml` next to `apps/*`, `packages/*`, `tools/*`). Browser binaries are downloaded once by the W0 install task (`devops-engineer`, M0-W0-T02: `pnpm exec playwright install chromium`) so QA agents can run specs without installing anything; they are not installed by
`pnpm install`: run `pnpm --filter @moon-cleanup/e2e install:browsers` once (on Linux CI `--with-deps` installs system libraries).

## Commands

```
pnpm test:e2e                                             # turbo run test:e2e --filter=@moon-cleanup/e2e
pnpm --filter @moon-cleanup/e2e install:browsers
```

`test:e2e` is an echo placeholder until specs exist.
