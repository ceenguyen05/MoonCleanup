// Opt-in config for the headless two-client online e2e (not part of `pnpm test` of any package).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["harness/**/*.e2e.ts"],
    environment: "node",
    testTimeout: 400_000,
    hookTimeout: 60_000,
    disableConsoleIntercept: true,
  },
});
