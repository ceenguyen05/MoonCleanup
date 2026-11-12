# prototypes/

**Owner:** the lead/orchestrator assigns each subfolder to exactly one agent for the duration of a prototype contest.
**Purpose:** bounded experiments only when a measured production-approach failure justifies one. No automatic competing-agent contest.

For the riskiest problems — dust simulation, terrain LOD, netcode sync and cleaning visuals — the lead may launch two or
three agents to build alternative prototypes side by side. A reviewer (usually `performance-reviewer` plus
`visual-qa-reviewer`) benchmarks them with the same scene, camera path and hardware tiers. The lead keeps the winner,
records the decision as an ADR in `docs/adr/`, and the winning approach is then rebuilt properly in its real package.

## Layout

```
prototypes/
  <topic>/                 e.g. dust-sim, terrain-lod, netcode-sync, cleaning-visuals
    <approach>/            e.g. stroke-replay, mask-atlas, coarse-scalar
      README.md            hypothesis, how to run, what was measured, results
      ...                  prototype source (throwaway quality is fine; no secrets, no reference assets)
    BENCHMARK.md           written by the benchmarking reviewer: method, numbers, screenshots, verdict
```

## Rules

1. Prototype code never gets imported by `apps/` or `packages/`. Production code is rebuilt from the winning idea.
   **Prototypes are not workspace packages** (`pnpm-workspace.yaml` does not list `prototypes/*`). A prototype may have its own throwaway `package.json` and lockfile, installed **only inside its own folder** with `pnpm install --ignore-workspace`, and only by `devops-engineer` sequentially when the lead requests the justified experiment. Prototype agents never run installs. Prototypes consume production code read-only by **relative import of the source barrels** (for example `../../../packages/world/src/index.ts`) and run with their own `tsx` / `vitest` / `vite`.
2. Each approach folder has exactly one owning agent; competitors do not read or edit each other's folders until the
   benchmark is published.
3. Use the same benchmark harness, scene, seed and camera path for every approach (defined by the lead in the brief).
4. Build output and `node_modules` under `prototypes/` are git-ignored.
5. After the decision: the lead records the ADR, copies the essential numbers into it, then deletes the losing approach
   folders (or the whole topic folder). If Cee wants the history, he commits it on a `proto/<topic>` branch first.
6. All hard rules still apply here: no git commands, no secrets, original names only, no reference-game assets.
