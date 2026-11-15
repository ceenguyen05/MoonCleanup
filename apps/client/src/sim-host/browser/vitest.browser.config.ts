// Worker determinism lane of sim-host (E14): real module Web Workers in Chromium via Playwright. Run from apps/client:
//   vitest run --config src/sim-host/browser/vitest.browser.config.ts
// MC_GOLDEN_BROWSERS=chromium,firefox,webkit selects engines (default chromium). Files end in `.worker-lane.ts` so the
// client's default Node `vitest run` never picks them up. Same settings as @moon-cleanup/config/vitest browserPreset,
// inlined because that package's `.ts`-suffixed imports do not typecheck under the client tsconfig.
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

const all = ["chromium", "firefox", "webkit"] as const;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const wanted = (env["MC_GOLDEN_BROWSERS"] ?? "chromium").split(",").map((s) => s.trim());

export default defineConfig({
  assetsInclude: ["**/*.bin"],
  test: {
    include: ["src/sim-host/browser/**/*.worker-lane.ts"],
    testTimeout: 300_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: all.filter((b) => wanted.includes(b)).map((browser) => ({ browser })),
    },
  },
});
