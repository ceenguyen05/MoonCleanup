// Vitest browser-mode preset: real browser tests (determinism lane for sim/world, DOM/WebGL2 modules of apps/client).
// The provider package @vitest/browser-playwright 5.1.0 is a root devDependency since M1-W0-T04 (ADR-0019, ADR-0028).
// The provider is still passed in by the caller so this file imports no dependency.
//
// Opt in from a package's own vitest.browser.config.ts:
//   import { playwright } from "@vitest/browser-playwright";
//   import { browserPreset } from "@moon-cleanup/config/vitest";
//   export default browserPreset({ provider: playwright() });
import { defineConfig } from "vitest/config";
import type { BrowserProviderOption } from "vitest/node";

export interface BrowserPresetOptions {
  /** Provider factory result, for example `playwright()` from `@vitest/browser-playwright`. */
  provider: BrowserProviderOption;
  /** Run without a visible window. Default true; CI uses the software-WebGL2 lane (docs/architecture/environments.md). */
  headless?: boolean;
  /** Engines to run. Default chromium; the CI determinism job passes all three (netcode.md section 17, WDS section 1). */
  browsers?: readonly ("chromium" | "firefox" | "webkit")[];
}

export function browserPreset({ provider, headless = true, browsers = ["chromium"] }: BrowserPresetOptions) {
  return defineConfig({
    test: {
      include: ["**/*.browser.{test,spec}.?(c|m)[jt]s?(x)"],
      exclude: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.turbo/**"],
      passWithNoTests: true,
      browser: {
        enabled: true,
        provider,
        headless,
        instances: browsers.map((browser) => ({ browser })),
      },
    },
  });
}
