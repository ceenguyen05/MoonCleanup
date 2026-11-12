// PLACEHOLDER Vitest browser-mode preset (real browser tests for apps/client modules that need WebGL2/WebGPU or the DOM).
// Browser mode needs a provider package (`@vitest/browser-playwright`) that is NOT installed in M0-W0: adding it needs
// an ADR and a between-waves install (ADR-0028). Until then this preset takes the provider as an argument so that no
// dependency is imported here, and nothing in the repo uses it yet.
//
// Future opt-in from apps/client/vitest.config.ts:
//   import { mergeConfig } from "vitest/config";
//   import { playwright } from "@vitest/browser-playwright";
//   import { browserPreset } from "@moon-cleanup/config/vitest";
//   export default mergeConfig(baseConfig, browserPreset({ provider: playwright() }));
import { defineConfig } from "vitest/config";
import type { BrowserProviderOption } from "vitest/node";

export interface BrowserPresetOptions {
  /** Provider factory result, for example `playwright()` from `@vitest/browser-playwright`. */
  provider: BrowserProviderOption;
  /** Run without a visible window. Default true; CI uses the software-WebGL2 lane (docs/architecture/environments.md). */
  headless?: boolean;
}

export function browserPreset({ provider, headless = true }: BrowserPresetOptions) {
  return defineConfig({
    test: {
      include: ["**/*.browser.{test,spec}.?(c|m)[jt]s?(x)"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.turbo/**"],
      passWithNoTests: true,
      browser: {
        enabled: true,
        provider,
        headless,
        instances: [{ browser: "chromium" }],
      },
    },
  });
}
