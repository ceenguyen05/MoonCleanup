import { defineConfig } from "vitest/config";

// Seeded property and fuzz tests in src/codec take ~1 s alone but over 30 s when the whole monorepo runs in parallel
// (`pnpm verify`); the 5 s default then fails on load, not on a defect.
export default defineConfig({
  test: { testTimeout: 60_000, hookTimeout: 60_000 },
});
