// Node lane (also the default `test` script). Browser-only files (*.browser.test.ts) are excluded by nodePreset.
// `.bin` is an asset type so tests can import the terrain fixture cube with `?inline` in both lanes (no Node APIs).
import { mergeConfig } from "vitest/config";
import { nodePreset } from "@moon-cleanup/config/vitest";

export default mergeConfig(nodePreset, { assetsInclude: ["**/*.bin"], test: { name: "world", testTimeout: 60_000 } });
