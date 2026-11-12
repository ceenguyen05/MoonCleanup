// Vitest preset for pure-TypeScript packages and tools (sim, world, protocol, shared, game-data, db, server, bots...).
// Opt in from a package's own vitest.config.ts:
//
//   import { mergeConfig } from "vitest/config";
//   import { nodePreset } from "@moon-cleanup/config/vitest";
//   export default mergeConfig(nodePreset, { test: { name: "sim" } });
//
// A package without a vitest.config.ts runs with Vitest defaults (node environment), which is what the bare
// `vitest run --passWithNoTests` scripts use until a package needs more.
import { defineConfig } from "vitest/config";

export const nodePreset = defineConfig({
  test: {
    environment: "node",
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.turbo/**"],
    // A package that has no tests yet must not fail the gate (CI is designed to pass on an empty repo).
    passWithNoTests: true,
    // Tests must not leak mocks into each other; deterministic sim tests rely on a clean slate.
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
});
