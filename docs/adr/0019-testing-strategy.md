# ADR-0019: Testing strategy

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, qa-test-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Testing row)

## Context

Many agents write code in parallel, so tests must be fast, owned next to the code and runnable headless. Three things are hard to test: (1) rendering, because headless Chrome disables the GPU, the automatic SwiftShader fallback is deprecated and WebGPU in headless CI has no documented Playwright path and shows black canvases; (2) netcode under loss/latency; (3) the 16-player load on a 0.1-CPU server. Screenshots vary with hardware.

## Options considered

1. **Vitest 5.1 (unit + browser mode), Playwright 1.65 (two lanes), in-process network conditioner + Toxiproxy, `@colyseus/loadtest` + custom headless bots.** Pro: one runner family, covers all layers. Con: Vitest 5 is new.
2. **Jest + Cypress.** Pro: familiar. Con: slower with Vite 8; weaker GPU/canvas story.
3. **Real-GPU CI only (paid runners).** Pro: faithful. Con: not free; GitHub GPU runner eligibility unclear.
4. **Manual testing only.** Con: unscalable with parallel agents.
5. **Pixel-diff on CI software rendering.** Con: flaky; software output differs from real GPUs.

## Decision

Option 1:
- **Unit:** Vitest next to the code under test (same owner); sim, world and protocol run in plain Node with golden test vectors; bit-codec round-trip and fuzz tests; contract (zod) tests.
- **Browser mode:** Vitest browser (`@vitest/browser-playwright`, versions pinned identically) for HUD/DOM; keep every `@vitest/*` on one exact version.
- **E2E / visual:** Playwright with **two lanes**: **CI** with software WebGL2 for smoke/flow tests (no pixel baselines), and **local real-GPU** runs for screenshot baselines. Capture mode disables TRAA/dynamic resolution, waits for frames, masks volatile UI. A GPU runner or headed + Xvfb WebGPU spike is an M0 task.
- **Netcode:** an in-process network conditioner (delay, jitter, loss, reorder) in `tools/netsim`, plus **Toxiproxy** for TCP faults against a real server.
- **Load:** `@colyseus/loadtest` and custom headless **16-player bots** (`tools/bots`), run against a real Render Free instance for the M0 spike; the server is also tested capped at 0.1 CPU / 512 MB.
- **Perf:** `tools/perf` benchmarks; GPU/frame budgets from the feasibility budgets.
- ESLint and boundary rules run in CI; migrations are tested against local Postgres.

## Consequences

**Positive**
- Fast feedback for the deterministic core; honest separation between smoke and visual checks.

**Negative / risks**
- WebGPU visual regression cannot run in free CI; baselines depend on a developer machine (and per-GPU variance).
- Vitest 5 browser mode is new; keep a fallback to V4 (still patched).
- Bot load on Render Free spends bandwidth and instance hours (ADR-0002).

## Revisit trigger

- A free GPU-capable CI path becomes available: move visual baselines to CI.
- Flaky-test rate exceeds ~2% for two sprints.

## Evidence

- [browser-feasibility.md](../research/browser-feasibility.md) (Executive summary 15; testing section)
- [tooling-and-libraries.md](../research/tech/tooling-and-libraries.md) (Vitest, Playwright, Toxiproxy; WebGPU headless risk)
- [netcode-case-raw-websocket.md](../research/tech/netcode-case-raw-websocket.md) (testing tools)
