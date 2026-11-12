# Review of M0-W0-T02 by code-reviewer
Verdict: CHANGES REQUESTED
Date: 2026-11-12

Two blocking findings, both in the same place (`packages/config/eslint/boundaries.ts`) and both of the same kind: an
alternative way of writing an import passes every boundary rule. Everything else in the brief is met and reproduced.
Review cycle 1 of 2.

## Checked

- **Gates (reproduced, Node v26.13.1, pnpm 11.28.9):** `pnpm lint`, `pnpm typecheck`, `pnpm test` exit 0 (turbo cache
  hits); uncached: `pnpm exec eslint packages/config` exit 0, `pnpm exec tsc -p packages/config/tsconfig.json` exit 0,
  `pnpm --filter @moon-cleanup/config test` 2 files / 131 tests passed, `pnpm exec vitest run --project config` from
  the root 131 passed, `pnpm exec eslint .` clean in 7.3 s, `pnpm exec eslint .claude` exit 0, `pnpm exec prettier
  --check` on T02's files passes.
- **Scope:** read-only `git status --short`: T02's changes are all inside the brief's owned files. `.prettierignore`,
  `tsconfig.base.json`, root `package.json`, `.nvmrc`, `.editorconfig`, `.gitignore`, `.gitattributes` unchanged.
- **Boundary rules, own probes:** 164 virtual files linted through the real root config with the package's
  `lintFixture` helper from a throwaway script outside the repo (deleted). Results in "Evidence".
- **Ban-list:** all 10 names, the `three/examples/jsm/postprocessing/*` path, R3F and `postprocessing` have a fixture
  that fires; the guard test fails when a `BANNED_THREE_NAMES` entry has no fixture.
- **Config quality:** flat config is small, layered general to specific, and comments cite the doc or ADR; not
  type-aware by design (stated in `eslint/index.ts:5-6`), which keeps whole-repo lint at about 7 s; no
  `vitest.workspace` file (root uses `test.projects`); no `references` in any tsconfig; `packages/config/tsconfig.json`
  additions (`allowImportingTsExtensions`, `erasableSyntaxOnly`) are justified by a comment; `turbo.json`
  `test.outputs: []` is harmless (only stops a per-package warning; logs are still cached); exports map and scripts
  work; lockfile importer `packages/config` shows `@types/node` 26.6.6 as the only new package and `eslint` 9.39.5,
  `prettier` 3.10.1, `typescript` 6.0.3, `vitest` 5.1.0 identical to the root pins.
- **Report honesty:** numbers and command results match what I measured, except the two points in findings 10 and 13.
- **Secrets:** none found in the changed files.

## Findings (blocking first)

1. [blocking] `packages/config/eslint/index.ts:33-39` and `packages/config/eslint/boundaries.ts:63-221` — **dynamic
   `import()` passes every boundary and import-source rule.** All rules are expressed through core
   `no-restricted-imports`, which only inspects static `import` / `export ... from` / `import x = require()`. These all
   lint clean: `import("three")` and `import("node:fs")` in `packages/sim/src`, `import("@moon-cleanup/sim")` in
   `packages/world/src`, `import("@moon-cleanup/db")` in `apps/client/src`, `import("three")` in `apps/server/src`,
   `import("@moon-cleanup/shared/src/ids/index.js")` anywhere, `import("postprocessing")`,
   `import("three/addons/loaders/RGBELoader.js")`, and `const { WebGLRenderer } = await import("three")` in the client.
   Lazy `import()` is the normal code-splitting form in a Vite client, and a lazily loaded WebGL fallback is exactly the
   habit the ban-list exists to stop. The brief's wording ("`no-restricted-imports` enforces module-boundaries §1") is
   met literally; I rate the gap blocking under the boundary quality bar because rules 1, 2, 3, 4 and 6 are not
   enforced for a mainstream import form. **Required fix:** report `ImportExpression` with a restricted source in every
   layer (for example `no-restricted-syntax` selectors generated from the same restriction data, or a small local rule
   in `packages/config`; no new dependency), and add at least one dynamic-import fixture per rule family (rules 1, 2/
   direction, 3, 4a, 4b, 6, and one ban-list import source).

2. [blocking] `packages/config/eslint/boundaries.ts:71` — **a relative import from one package into a sibling package
   passes rule 2, the dependency direction and rule 6.** The regex `^(\.\./)+packages/[^/]+/(src|dist)(/|$)` needs a
   literal `packages/` segment, which only appears when the importing file is outside `packages/`. From inside a
   package the path is `../../<name>/src/...`, and these lint clean: `../../world/src/grid.ts` in
   `packages/shared/src/a.ts` (rule 2), `../../sim/src/index.ts` in `packages/world/src/a.ts` (wrong direction),
   `../../db/src/y` in `packages/sim/src/a.ts` (direction + rule 6). TypeScript does not stop them either (bundler
   resolution, no project references). This is the most likely deep-import form inside `packages/`, because it works
   even when the target barrel does not export the symbol. **Required fix:** add a relative pattern for sibling
   packages, derived from the `PACKAGES` list, to the `packages/**` layers, plus fixtures for rule 2, direction and
   rule 6. Keep the `/src` (or `/dist`) segment in the pattern: `packages/shared/src` has folders named `protocol`,
   `sim`, `world` and `config`, so `../sim/input.ts` inside shared must stay legal (add that as an allowed fixture).

3. [non-blocking] `packages/config/eslint/ban-list.ts:67` and `:72` — the member selectors match a bare property name
   on any object in every linted file. Misfires I reproduced: `hooks.onBeforeCompile?.()` in `apps/server`,
   `report.renderAsync()` in `tools/screenshots`, `o.PostProcessing` / `o.ShaderMaterial` in `packages/sim`,
   `new deps.Clock()` in `packages/sim`, `new net.Clock()` (own namespace import) in `apps/server`. Bare identifiers
   are safe: `const Clock = 1`, `class ServerClock {}`, `interface Clock {}`, `clockIn`, a local `class Clock` with
   `new Clock()`, `import { Clock } from "@moon-cleanup/protocol"`, a `renderAsync` function or method definition,
   object keys, strings and comments all stay clean. Not blocking: the misfire needs an exact banned name as a member
   and a named import avoids it. Suggestion: apply the member and `new X.Clock()` selectors only where three.js can be
   imported (`apps/client/**`, `tools/**`), since the server and the environment-agnostic packages cannot import it.

4. [non-blocking] `packages/config/eslint/ban-list.ts:54-85` — forms that slip through the ban-list: `THREE.Clock`
   without `new` (`const C = THREE.Clock`, `extends THREE.Clock`), type positions (`let r: THREE.WebGLRenderer`,
   `type C = THREE.Clock`; these are `TSQualifiedName`, not `MemberExpression`), `const { WebGLRenderer, Clock } =
   THREE`, `THREE["WebGLRenderer"]`, a default import from `three/src/renderers/WebGLRenderer.js`,
   `const { renderAsync } = r`. Suggest a `TSQualifiedName[right.name=...]` selector and a
   `MemberExpression[property.name="Clock"]` selector limited to objects named like the three namespace.

5. [non-blocking] `packages/config/eslint/boundaries.ts:133-167` — `colyseus` is banned only as an exact name;
   `colyseus/lib/x` lints clean in `packages/sim/src`. Add `colyseus/**`. Also `require("three")` in a `.cjs` file
   under `apps/server` is not caught (in `.ts` files `@typescript-eslint/no-require-imports` reports it); low risk in
   an ESM-only repo.

6. [non-blocking, lead decision] `packages/config/eslint/index.ts:42` — `game-data` is not in `ENVIRONMENT_AGNOSTIC`,
   so `three` and `node:fs` lint clean in `packages/game-data/src`. Module-boundaries rule 3 does not name it, but
   `sim` and `apps/client` import it, and `tsconfig.base.json:30` lists it with the environment-agnostic packages.
   Recommend adding it (or recording why not).

7. [non-blocking, lead decision before M0-W1] Test files inside `packages/shared|sim|world|protocol/src` may import
   `vitest` (clean), but not `node:fs`, `process`, `Buffer` and the other Node items: a `packages/protocol/src/a.test.ts`
   that reads a golden vector with `node:fs` is rejected. Either relax the Node part of rule 3 for `*.test.ts` /
   `*.spec.ts` in those four packages, or state that golden vectors are TS or JSON modules.

8. [non-blocking, for the T03 brief] Report section "Hand-off" — on a package that has no source yet the commands do
   not behave as a green gate: `pnpm exec tsc -p packages/world/tsconfig.json` exits 2 (TS18003, no inputs),
   `pnpm exec eslint packages/world` exits 2 ("all of the files matching the glob pattern are ignored"),
   `pnpm exec vitest run --root packages/world` exits 1 (no test files; only `pnpm --filter ... test` passes because
   the script has `--passWithNoTests`). The suggested T03 scripts (`eslint .`, `tsc -p tsconfig.json`, `vitest run`)
   would therefore turn `pnpm lint` and `pnpm typecheck` red for every still-empty package. T03 needs
   `eslint . --no-error-on-unmatched-pattern`, a way to keep `tsc` green on an empty `src`, and either the preset or
   `--passWithNoTests`. For T01 (`packages/shared` has files) the commands work as described.

9. [non-blocking] `packages/config/README.md:43` — `pnpm --filter @moon-cleanup/config lint typecheck test` is not a
   valid command: pnpm runs `eslint . typecheck test` and exits 2. Use three commands or `pnpm turbo run lint
   typecheck test --filter=@moon-cleanup/config`.

10. [non-blocking, lead decision] Universal globals: lint allows `console`, `performance`, `setTimeout`,
    `TextEncoder`, `structuredClone`, `URL`, `crypto`, `Math`, `globalThis` in the environment-agnostic packages
    (sensible), but the unchanged base tsconfig (`lib: ["ES2024"]`, `types: []`) rejects `console`, `performance`,
    `setTimeout`, `TextEncoder`, `structuredClone` and `URL` at typecheck. The "allowed" sim fixture
    (`packages/config/eslint/boundaries.test.ts:244`) uses `performance.now()`, which would not typecheck in
    `packages/sim`. Not a T02 defect, but protocol codecs and the sim will need a decision (ambient declarations or a
    lib change). Related: `typeof window !== "undefined"` is reported in these packages (sensible), while
    `globalThis.window`, `self`, `indexedDB`, `Image`, `alert` are not linted; typecheck is the backstop for those.

11. [non-blocking] `packages/config/eslint/index.ts:82` — every `.js/.mjs/.cjs` file gets Node globals, so a plain JS
    file under `apps/client` that uses `window` fails `no-undef`; `.jsx` files get rules but no JSX parser options.
    Harmless while the client is TypeScript only.

12. [non-blocking] `packages/config/eslint/ban-list.test.ts:202-206` — a case passes when any `no-restricted-*` rule
    fires, and the coverage guard (`:192-200`) checks the `entry` labels, not what fired. Giving each banned name its
    own message and asserting on it would make every fixture fail for the right reason.

13. [non-blocking] Comments and naming: `boundaries.ts:4-5` refers to `restrict()`, the function is `merge()`;
    `boundaries.ts:223` and `boundaries.test.ts:221` say "Rule 4 of the coding standards" (the standards are not
    numbered and it collides with module-boundaries rule 4); `boundaries.ts:99` repeats the app and tool names instead
    of deriving them from `APPS` / `TOOLS` and omits `tests/e2e`; `boundaries.ts:1`, `README.md:18` and the report say
    "rules 1-6", but rule 5 (event bus / service registry) is not enforced by lint: say so.

14. [non-blocking] Not covered, and beyond the brief: relative imports between the two apps
    (`../../../server/src/...` from the client), package-name subpaths other than `src` (`@moon-cleanup/shared/dist/...`),
    `Math.random` / `Date.now` in `packages/sim` (a later determinism rule would fit here).

## Evidence

- `node -v` v26.13.1 and `pnpm -v` 11.28.9 on every command line.
- `pnpm lint` 17/17, `pnpm typecheck` 17/17, `pnpm test` 16/16: exit 0 (FULL TURBO).
- `pnpm exec eslint packages/config` exit 0 (6.4 s); `pnpm exec tsc -p packages/config/tsconfig.json` exit 0 (4.1 s);
  `pnpm --filter @moon-cleanup/config test`: "Test Files 2 passed (2), Tests 131 passed (131)", 5.4 s;
  `pnpm exec eslint .` no output, 7.3 s; `pnpm exec prettier --check packages/config eslint.config.js
  prettier.config.js vitest.config.ts package.json pnpm-workspace.yaml turbo.json`: "All matched files use Prettier
  code style!".
- Probe run (164 cases through the real root config):
  - **Caught:** `node:fs`, `fs`, `node:fs/promises`, `worker_threads`, `three`, `three/webgpu`, `three/tsl`,
    `@colyseus/schema`, `colyseus`, `react`, `react/jsx-runtime`, `motion/react` in `packages/sim/src`; wrong
    direction for world, protocol, db, game-data; tools and `@moon-cleanup/e2e` from a package; `@moon-cleanup/db`
    and `@moon-cleanup/db/anything` in the client (also as `import type`); `three`, `three/tsl`, `three/addons/...`,
    `@types/three` in the server; `@moon-cleanup/shared/src/ids/index.js` in tools, sim and e2e; `window`,
    `document`, `process`, `Buffer` in `packages/protocol/src`; `../../apps/client/src/x`,
    `../../../apps/client/src/x`, `../../../packages/db/src/y`, `../../../tools/perf/src/x`; `import type`, inline
    `type` specifiers, `export { x } from`, `export * from`, side-effect imports, `import x = require()`.
  - **Not caught:** every dynamic `import()` case (8 of 8, finding 1); sibling relative imports (3 of 3, finding 2);
    `colyseus/lib/x`; `require("three")` in `.cjs`; `../../../tests/e2e/x`; the ban-list forms in finding 4.
  - **Legitimate code, clean:** vitest imports in test files of all four environment-agnostic packages; `zod` and
    `zod/v4` in shared; relative sub-barrel re-exports in shared; client with `three`, `three/webgpu`, `three/tsl`,
    `three/addons/loaders|csm|tsl/display|libs/...`, `three/examples/jsm/loaders/GLTFLoader.js`, React and Motion
    `.tsx`, DOM globals, default-exported lazy component; server with Node built-ins, `@colyseus/core`,
    `@colyseus/schema`, the uWS transport, `pino`, `process`, `Buffer` and all six workspace packages; tools and e2e
    with Playwright and Node built-ins; `drizzle.config.ts`, `vite.config.ts`, `playwright.config.ts` default exports;
    locals and object keys named `location`, `process`, `window`.
  - **Misfires:** the five in finding 3; `node:fs` in a protocol test file (finding 7).
- Hand-off run on `packages/world` (empty `src`): tsc exit 2 (TS18003), eslint exit 2, prettier exit 0,
  `vitest run --root` exit 1, `pnpm --filter @moon-cleanup/world test` exit 0.
- Base-config typecheck probe (scratch tsconfig extending `tsconfig.base.json`): TS2584 / TS2304 for `console`,
  `performance`, `setTimeout`, `TextEncoder`, `structuredClone`, `URL`.
- Supply chain (other reviewer's scope): nothing to add to the report's own list.
