// Repo-root Vitest config, used when running `pnpm exec vitest` from the root: every workspace folder below is one
// project (Vitest's `projects` replaces the deprecated vitest.workspace file). `pnpm test` does NOT use this file:
// it runs `vitest run` inside each package through Turborepo, and a package opts into the shared presets with its
// own vitest.config.ts (see packages/config/vitest/node.ts).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*", "tools/*"],
    passWithNoTests: true,
  },
});
