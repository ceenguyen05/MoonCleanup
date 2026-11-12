// The config package runs its own fixture suite (eslint/*.test.ts) with the node preset it exports.
import { mergeConfig } from "vitest/config";
import { nodePreset } from "./vitest/index.ts";

export default mergeConfig(nodePreset, {
  test: {
    name: "config",
    // The suites spin up real ESLint instances against the root config; the first lint pays a cold start.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
