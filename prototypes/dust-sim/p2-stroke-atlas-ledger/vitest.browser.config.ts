// Browser lane (Chromium by default; P2_GOLDEN_BROWSERS=chromium,firefox,webkit selects engines where installed).
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const all = ["chromium", "firefox", "webkit"] as const;
const wanted = (process.env["P2_GOLDEN_BROWSERS"] ?? "chromium").split(",").map((s) => s.trim());

export default defineConfig({
  test: {
    include: ["test/**/*.browser.test.ts"],
    testTimeout: 120_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: all.filter((b) => wanted.includes(b)).map((browser) => ({ browser })),
    },
  },
});
