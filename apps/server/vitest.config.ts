// Server suites boot a real Colyseus game server in beforeAll; under a loaded machine (turbo runs many packages at
// once) the default 10 s hook timeout is too tight. Generous hook/test timeouts, not weaker assertions.
import { mergeConfig } from "vitest/config";
import { nodePreset } from "@moon-cleanup/config/vitest";

export default mergeConfig(nodePreset, {
  test: { name: "server", hookTimeout: 40_000, testTimeout: 30_000 },
});
