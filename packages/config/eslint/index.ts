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
  environmentAgnostic,
  merge,
  noDefaultExportInPackages,
  packageDirection,
  packagesNeverImportAppsOrTools,
  serverRules,
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
    "no-restricted-syntax": ["error", ...r.syntax],
  };
}

/** Packages that must run in a browser, a Web Worker and Node (module-boundaries rule 3). */
const ENVIRONMENT_AGNOSTIC = ["shared", "sim", "world", "protocol"] as const;

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

  // Rule 4: client never imports db; server never imports three.js.
  {
    name: "moon-cleanup/boundaries/client",
    files: ["apps/client/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: rulesFor(merge(common, clientRules)),
  },
  {
    name: "moon-cleanup/boundaries/server",
    files: ["apps/server/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    rules: rulesFor(merge(common, serverRules)),
  },

  // Last: switch off every stylistic rule that Prettier owns.
  eslintConfigPrettier,
);
