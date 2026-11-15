// Determinism lane (netcode.md section 17): the same RoomSim golden replay as Node, run in real browsers.
// MC_GOLDEN_BROWSERS=chromium,firefox,webkit selects engines (CI); default is chromium only for local use.
import { mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { browserPreset } from "@moon-cleanup/config/vitest";

const all = ["chromium", "firefox", "webkit"] as const;
const wanted = (process.env["MC_GOLDEN_BROWSERS"] ?? "chromium").split(",").map((s) => s.trim());
const browsers = all.filter((b) => wanted.includes(b));

export default mergeConfig(browserPreset({ provider: playwright(), browsers }), {
  assetsInclude: ["**/*.bin"],
  optimizeDeps: { include: ["zod"] },
  test: { testTimeout: 180_000 },
});
