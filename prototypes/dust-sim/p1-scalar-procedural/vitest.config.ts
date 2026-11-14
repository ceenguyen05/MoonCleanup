// Node lane. The browser-only file is excluded here and run by vitest.browser.config.ts.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], exclude: ["test/**/*.browser.test.ts", "**/node_modules/**"] },
});
