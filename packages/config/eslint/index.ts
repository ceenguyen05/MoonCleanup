// ESLint 9 flat config for the whole repo (ADR-0001 tooling; ADR-0003 three.js ban-list).
// The repo-root eslint.config.js re-exports `eslintConfig`; package scripts run `eslint .` from their own folder and
// ESLint finds the root config by walking up.
//
// Deliberately NOT type-aware (no parserOptions.projectService): it keeps `lint` fast and independent of per-package
// tsconfig files. Type-aware rules can be added per package later without touching the boundary rules.
import js from "@eslint/js";
import type { Linter } from "eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";
import {
  ALLOWED_PACKAGE_DEPS,
  clientRules,
  common,
  dynamicImportSyntax,
  environmentAgnostic,
  environmentAgnosticTests,
  merge,
  noDefaultExportInPackages,
  packageDirection,
  packagesNeverImportAppsOrTools,
  serverRules,
  threeCapable,
  type Restrictions,
} from "./boundaries.ts";

export { BANNED_THREE_NAMES } from "./ban-list.ts";

const CODE = ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];
const TS = ["**/*.{ts,tsx,mts,cts}"];
const PLAIN_JS = ["**/*.{js,mjs,cjs}"];

/** Turn a restriction set into the three core rules that enforce it. */
function rulesFor(r: Restrictions): Linter.RulesRecord {
  return {
    "no-restricted-imports": ["error", { paths: r.paths, patterns: r.patterns }],
    "no-restricted-globals": ["error", ...r.globals],
    // import("x") is invisible to no-restricted-imports: mirror every import restriction as a syntax selector.
    "no-restricted-syntax": ["error", ...r.syntax, ...dynamicImportSyntax(r)],
  };
}

/**
 * Packages that must run in a browser, a Web Worker and Node (module-boundaries rule 3).
 * game-data is included (T02 fix cycle 2): sim and the client import it and tsconfig.base.json lists it with the
 * environment-agnostic packages; rule 3 does not name it, so this is a recorded lead-approved tightening.
 */
const ENVIRONMENT_AGNOSTIC = ["shared", "sim", "world", "protocol", "game-data"] as const;

const packageLayers = (Object.keys(ALLOWED_PACKAGE_DEPS) as (keyof typeof ALLOWED_PACKAGE_DEPS)[]).map((name) =>
  // Boundary rules apply to src/ only: build files next to it (vitest.config.ts, ...) may import tooling.
  ({
    name: `moon-cleanup/boundaries/packages/${name}`,
    files: [`packages/${name}/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`],
    rules: rulesFor(
      merge(
        common,
        packagesNeverImportAppsOrTools,
        packageDirection(name),
        noDefaultExportInPackages,
        (ENVIRONMENT_AGNOSTIC as readonly string[]).includes(name)
          ? environmentAgnostic
          : { paths: [], patterns: [], globals: [], syntax: [] },
      ),
    ),
  }),
);

/** Test files of the environment-agnostic packages may use Node (T02 review finding 7). */
const agnosticTestLayers = (ENVIRONMENT_AGNOSTIC as readonly string[]).map((name) => ({
  name: `moon-cleanup/boundaries/packages/${name}/tests`,
  files: [`packages/${name}/src/**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}`],
  rules: rulesFor(
    merge(
      common,
      packagesNeverImportAppsOrTools,
      packageDirection(name as keyof typeof ALLOWED_PACKAGE_DEPS),
      noDefaultExportInPackages,
      environmentAgnosticTests,
    ),
  ),
}));

export const eslintConfig = defineConfig(
  // Never lint generated, vendored or non-code content. docs/vendor holds vendored third-party text (three r187).
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.turbo/**",
    "docs/**",
    "prototypes/**",
    "assets/**",
    "apps/client/public/**",
    "packages/db/migrations/**",
    "tools/.bin/**", // git-ignored downloaded tool binaries and their bundled docs (KTX)
    "tools/screenshots/output/**",
    "tools/screenshots/diff/**",
  ]),
  { linterOptions: { reportUnusedDisableDirectives: "error" } },

  // Plain JavaScript (root configs, .claude/hooks/*.mjs): core recommended rules, Node globals, no type information.
  { files: PLAIN_JS, extends: [js.configs.recommended], languageOptions: { globals: globals.node } },

  // TypeScript: typescript-eslint recommended (non-type-aware).
  { files: TS, extends: [tseslint.configs.recommended] },

  // Everything: the three.js ban-list + deep-import ban (rule 6).
  { name: "moon-cleanup/ban-list", files: CODE, rules: rulesFor(common) },

  // Rule 1: every package file, then per-package direction (+ rule 2, 3) for src/.
  {
    name: "moon-cleanup/boundaries/packages",
    files: ["packages/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: rulesFor(merge(common, packagesNeverImportAppsOrTools)),
  },
  ...packageLayers,
  ...agnosticTestLayers,

  // Rule 4: client never imports db; server never imports three.js.
  {
    name: "moon-cleanup/boundaries/client",
    files: ["apps/client/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: rulesFor(merge(common, clientRules, threeCapable)),
  },
  // three.js member / type / destructuring ban-list forms: only where three can be imported (finding 3).
  {
    name: "moon-cleanup/boundaries/tools-and-e2e",
    files: ["tools/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}", "tests/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: rulesFor(merge(common, threeCapable)),
  },
  {
    name: "moon-cleanup/boundaries/server",
    files: ["apps/server/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: rulesFor(merge(common, serverRules)),
  },

  // Last: switch off every stylistic rule that Prettier owns.
  eslintConfigPrettier,
);
