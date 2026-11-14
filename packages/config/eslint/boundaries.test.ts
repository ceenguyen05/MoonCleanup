// One fixture per module-boundaries rule proving the rule fires, plus one allowed-import fixture per layer that must
// stay completely clean (docs/architecture/module-boundaries.md section 1, rules 1-6).
import { describe, expect, it } from "vitest";
import { lintFixture, restrictedFindings } from "./lint-fixture.ts";

interface Violation {
  /** What the fixture proves. */
  title: string;
  file: string;
  code: string;
  rule: "no-restricted-imports" | "no-restricted-globals" | "no-restricted-syntax";
  /** Substring of the lint message that identifies the rule of the doc. */
  message: string;
}

const imp = (from: string) => `import { x } from "${from}";\nexport const y = x;\n`;

const violations: Violation[] = [
  // Rule 1: packages/* never import apps/* or tools/*
  {
    title: "rule 1: package imports an app by name",
    file: "packages/sim/src/a.ts",
    code: imp("@moon-cleanup/client"),
    rule: "no-restricted-imports",
    message: "rule 1",
  },
  {
    title: "rule 1: package imports the server app by name",
    file: "packages/game-data/src/a.ts",
    code: imp("@moon-cleanup/server"),
    rule: "no-restricted-imports",
    message: "rule 1",
  },
  {
    title: "rule 1: package imports a tool by name",
    file: "packages/world/src/a.ts",
    code: imp("@moon-cleanup/bots"),
    rule: "no-restricted-imports",
    message: "rule 1",
  },
  {
    title: "rule 1: package imports an app by relative path",
    file: "packages/protocol/src/net/a.ts",
    code: imp("../../../../apps/client/src/app/boot.ts"),
    rule: "no-restricted-imports",
    message: "rule 1",
  },
  {
    title: "rule 1: package imports a tool by relative path",
    file: "packages/db/src/a.ts",
    code: imp("../../../tools/bots/src/cli.ts"),
    rule: "no-restricted-imports",
    message: "rule 1",
  },

  // Rule 2: packages/shared imports nothing from the workspace
  {
    title: "rule 2: shared imports sim",
    file: "packages/shared/src/a.ts",
    code: imp("@moon-cleanup/sim"),
    rule: "no-restricted-imports",
    message: "rule 2",
  },
  {
    title: "rule 2: shared imports world",
    file: "packages/shared/src/a.ts",
    code: imp("@moon-cleanup/world"),
    rule: "no-restricted-imports",
    message: "rule 2",
  },
  {
    title: "rule 2: shared imports game-data",
    file: "packages/shared/src/a.ts",
    code: imp("@moon-cleanup/game-data"),
    rule: "no-restricted-imports",
    message: "rule 2",
  },

  // Dependency direction (mermaid graph in section 1)
  {
    title: "direction: world imports sim",
    file: "packages/world/src/a.ts",
    code: imp("@moon-cleanup/sim"),
    rule: "no-restricted-imports",
    message: "dependency direction",
  },
  {
    title: "direction: protocol imports world",
    file: "packages/protocol/src/a.ts",
    code: imp("@moon-cleanup/world"),
    rule: "no-restricted-imports",
    message: "dependency direction",
  },
  {
    title: "direction: sim imports protocol",
    file: "packages/sim/src/a.ts",
    code: imp("@moon-cleanup/protocol"),
    rule: "no-restricted-imports",
    message: "dependency direction",
  },
  {
    title: "direction: sim imports db",
    file: "packages/sim/src/a.ts",
    code: imp("@moon-cleanup/db"),
    rule: "no-restricted-imports",
    message: "dependency direction",
  },
  {
    title: "direction: game-data imports sim",
    file: "packages/game-data/src/a.ts",
    code: imp("@moon-cleanup/sim"),
    rule: "no-restricted-imports",
    message: "dependency direction",
  },

  // Rule 4: client never imports db; server never imports three.js
  {
    title: "rule 4: client imports db",
    file: "apps/client/src/net/a.ts",
    code: imp("@moon-cleanup/db"),
    rule: "no-restricted-imports",
    message: "rule 4",
  },
  {
    title: "rule 4: server imports three",
    file: "apps/server/src/rooms/a.ts",
    code: imp("three"),
    rule: "no-restricted-imports",
    message: "rule 4",
  },
  {
    title: "rule 4: server imports three/webgpu",
    file: "apps/server/src/rooms/a.ts",
    code: imp("three/webgpu"),
    rule: "no-restricted-imports",
    message: "rule 4",
  },
  {
    title: "apps: client imports the server app",
    file: "apps/client/src/net/a.ts",
    code: imp("@moon-cleanup/server"),
    rule: "no-restricted-imports",
    message: "apps/server",
  },
  {
    title: "apps: server imports the client app",
    file: "apps/server/src/rooms/a.ts",
    code: imp("@moon-cleanup/client"),
    rule: "no-restricted-imports",
    message: "apps/client",
  },

  // Rule 6: no deep imports
  {
    title: "rule 6: deep import into another package src (client)",
    file: "apps/client/src/a.ts",
    code: imp("@moon-cleanup/shared/src/ids"),
    rule: "no-restricted-imports",
    message: "rule 6",
  },
  {
    title: "rule 6: deep import into another package src (server)",
    file: "apps/server/src/a.ts",
    code: imp("@moon-cleanup/sim/src/index"),
    rule: "no-restricted-imports",
    message: "rule 6",
  },
  {
    title: "rule 6: deep import, bare src folder",
    file: "tools/bots/src/a.ts",
    code: imp("@moon-cleanup/protocol/src"),
    rule: "no-restricted-imports",
    message: "rule 6",
  },
  {
    title: "rule 6: relative deep import into packages/*/src",
    file: "apps/client/src/a.ts",
    code: imp("../../../packages/world/src/grid.ts"),
    rule: "no-restricted-imports",
    message: "rule 6",
  },

  // Sibling packages by relative path from inside packages/ (T02 fix cycle 2)
  {
    title: "rule 2: shared imports a sibling package by relative path",
    file: "packages/shared/src/a.ts",
    code: imp("../../world/src/grid.ts"),
    rule: "no-restricted-imports",
    message: "rule 2",
  },
  {
    title: "direction: world imports sim by relative path",
    file: "packages/world/src/a.ts",
    code: imp("../../sim/src/index.ts"),
    rule: "no-restricted-imports",
    message: "dependency direction",
  },
  {
    title: "rule 6: sim deep-imports db by relative path (direction)",
    file: "packages/sim/src/a.ts",
    code: imp("../../db/src/y"),
    rule: "no-restricted-imports",
    message: "dependency direction",
  },
  {
    title: "rule 6: sim deep-imports an allowed sibling by relative path",
    file: "packages/sim/src/a.ts",
    code: imp("../../world/src/grid.ts"),
    rule: "no-restricted-imports",
    message: "rule 6",
  },
  {
    title: "rule 6: relative dist import of a sibling",
    file: "packages/protocol/src/net/a.ts",
    code: imp("../../../shared/dist/index.js"),
    rule: "no-restricted-imports",
    message: "rule 6",
  },
  // fix cycle 3: colyseus subpaths and tests/e2e by relative path (T02 review findings 5 and 13)
  {
    title: "rule 3: colyseus subpath in sim",
    file: "packages/sim/src/a.ts",
    code: imp("colyseus/lib/x"),
    rule: "no-restricted-imports",
    message: "rule 3",
  },
  {
    title: "rule 1: package imports tests/e2e by relative path",
    file: "packages/sim/src/a.ts",
    code: imp("../../../tests/e2e/x"),
    rule: "no-restricted-imports",
    message: "rule 1",
  },
  {
    title: "rule 3: browser global in a TEST file of an environment-agnostic package",
    file: "packages/sim/src/a.test.ts",
    code: "export const w = window.innerWidth;\n",
    rule: "no-restricted-globals",
    message: "rule 3",
  },
  {
    title: "rule 3: three.js import in a TEST file of an environment-agnostic package",
    file: "packages/protocol/src/a.test.ts",
    code: imp("three"),
    rule: "no-restricted-imports",
    message: "rule 3",
  },
];

// Dynamic import() must be restricted exactly like static imports (finding 1 of the T02 review). One fixture per rule
// family; the message substring is the same one the static fixture checks.
const dyn = (from: string) => `export const m = import("${from}");\n`;
violations.push(
  {
    title: "dynamic import, rule 1: package imports an app",
    file: "packages/sim/src/a.ts",
    code: dyn("@moon-cleanup/client"),
    rule: "no-restricted-syntax",
    message: "rule 1",
  },
  {
    title: "dynamic import, rule 1: relative path to a tool",
    file: "packages/db/src/a.ts",
    code: dyn("../../../tools/bots/src/cli.ts"),
    rule: "no-restricted-syntax",
    message: "rule 1",
  },
  {
    title: "dynamic import, rule 2: shared imports sim",
    file: "packages/shared/src/a.ts",
    code: dyn("@moon-cleanup/sim"),
    rule: "no-restricted-syntax",
    message: "rule 2",
  },
  {
    title: "dynamic import, direction: world imports sim",
    file: "packages/world/src/a.ts",
    code: dyn("@moon-cleanup/sim"),
    rule: "no-restricted-syntax",
    message: "dependency direction",
  },
  {
    title: "dynamic import, direction: relative sibling",
    file: "packages/world/src/a.ts",
    code: dyn("../../sim/src/index.ts"),
    rule: "no-restricted-syntax",
    message: "dependency direction",
  },
  {
    title: "dynamic import, rule 3: three.js in sim",
    file: "packages/sim/src/a.ts",
    code: dyn("three"),
    rule: "no-restricted-syntax",
    message: "rule 3",
  },
  {
    title: "dynamic import, rule 3: node:fs in sim",
    file: "packages/sim/src/a.ts",
    code: dyn("node:fs"),
    rule: "no-restricted-syntax",
    message: "rule 3",
  },
  {
    title: "dynamic import, rule 3: fs/promises in protocol",
    file: "packages/protocol/src/a.ts",
    code: dyn("fs/promises"),
    rule: "no-restricted-syntax",
    message: "rule 3",
  },
  {
    title: "dynamic import, rule 3: colyseus subpath in sim",
    file: "packages/sim/src/a.ts",
    code: dyn("colyseus/lib/x"),
    rule: "no-restricted-syntax",
    message: "rule 3",
  },
  {
    title: "dynamic import, rule 4a: client imports db",
    file: "apps/client/src/a.ts",
    code: dyn("@moon-cleanup/db"),
    rule: "no-restricted-syntax",
    message: "rule 4",
  },
  {
    title: "dynamic import, rule 4b: server imports three",
    file: "apps/server/src/a.ts",
    code: dyn("three"),
    rule: "no-restricted-syntax",
    message: "rule 4",
  },
  {
    title: "dynamic import, rule 4b: server imports three subpath",
    file: "apps/server/src/a.ts",
    code: dyn("three/webgpu"),
    rule: "no-restricted-syntax",
    message: "rule 4",
  },
  {
    title: "dynamic import, rule 6: package deep import",
    file: "apps/client/src/a.ts",
    code: dyn("@moon-cleanup/shared/src/ids/index.js"),
    rule: "no-restricted-syntax",
    message: "rule 6",
  },
  {
    title: "dynamic import, rule 6: relative deep import",
    file: "apps/client/src/a.ts",
    code: dyn("../../../packages/world/src/grid.ts"),
    rule: "no-restricted-syntax",
    message: "rule 6",
  },
  {
    title: "dynamic import, ban-list: postprocessing",
    file: "apps/client/src/a.ts",
    code: dyn("postprocessing"),
    rule: "no-restricted-syntax",
    message: "postprocessing",
  },
  {
    title: "dynamic import, ban-list: RGBELoader addon",
    file: "apps/client/src/a.ts",
    code: dyn("three/addons/loaders/RGBELoader.js"),
    rule: "no-restricted-syntax",
    message: "HDRLoader",
  },
  // Colyseus subpaths (finding 5) and game-data now environment-agnostic (finding 6)
  {
    title: "rule 3: colyseus subpath (static)",
    file: "packages/sim/src/a.ts",
    code: imp("colyseus/lib/x"),
    rule: "no-restricted-imports",
    message: "rule 3",
  },
  {
    title: "rule 3: game-data imports three",
    file: "packages/game-data/src/a.ts",
    code: imp("three"),
    rule: "no-restricted-imports",
    message: "rule 3",
  },
  {
    title: "rule 3: game-data imports node:fs",
    file: "packages/game-data/src/a.ts",
    code: imp("node:fs"),
    rule: "no-restricted-imports",
    message: "rule 3",
  },
);

// Rule 3: sim, world, protocol, shared, game-data are environment-agnostic.
for (const pkg of ["shared", "sim", "world", "protocol"]) {
  const file = `packages/${pkg}/src/a.ts`;
  const r3 = (title: string, code: string, rule: Violation["rule"]): Violation => ({
    title: `rule 3 (${pkg}): ${title}`,
    file,
    code,
    rule,
    message: "rule 3",
  });
  violations.push(
    r3("Node built-in with node: prefix", imp("node:fs"), "no-restricted-imports"),
    r3("Node built-in without prefix", imp("path"), "no-restricted-imports"),
    r3("Node built-in subpath", imp("fs/promises"), "no-restricted-imports"),
    r3("three.js", imp("three"), "no-restricted-imports"),
    r3("three.js subpath", imp("three/webgpu"), "no-restricted-imports"),
    r3("Colyseus core", imp("@colyseus/core"), "no-restricted-imports"),
    r3("Colyseus SDK", imp("@colyseus/sdk"), "no-restricted-imports"),
    r3("DOM library (react)", imp("react"), "no-restricted-imports"),
    r3("DOM library (react-dom/client)", imp("react-dom/client"), "no-restricted-imports"),
    r3("DOM global window", "export const w = window;\n", "no-restricted-globals"),
    r3("DOM global document", "export const d = document.body;\n", "no-restricted-globals"),
    r3("Node global process", "export const e = process.env;\n", "no-restricted-globals"),
    r3("Node global Buffer", "export const b = Buffer.alloc(1);\n", "no-restricted-globals"),
  );
}

describe("module-boundaries: each rule fires", () => {
  it.each(violations)("$title [$file]", async ({ file, code, rule, message }) => {
    const hits = restrictedFindings(await lintFixture(code, file)).filter((f) => f.ruleId === rule);
    expect(hits.length, `expected ${rule} to fire for ${file}`).toBeGreaterThan(0);
    expect(
      hits.some((h) => h.message.includes(message)),
      `message should mention "${message}": ${JSON.stringify(hits)}`,
    ).toBe(true);
  });

  it("coding standards: default export inside a package src folder", async () => {
    const hits = restrictedFindings(await lintFixture("export default 1;\n", "packages/shared/src/a.ts"));
    expect(hits.some((h) => h.ruleId === "no-restricted-syntax" && h.message.includes("default exports"))).toBe(true);
  });
});

interface Allowed {
  layer: string;
  file: string;
  code: string;
}

const allowed: Allowed[] = [
  {
    layer: "shared",
    file: "packages/shared/src/a.ts",
    code: `import { z } from "zod";\nimport { id } from "./ids.ts";\nexport const a = [z, id];\n`,
  },
  {
    layer: "shared: ../sim/input.ts is a folder inside shared/src, not the sim package",
    file: "packages/shared/src/protocol/a.ts",
    code: `import { a } from "../sim/input.ts";\nimport { b } from "../../world/index.ts";\nexport const c = [a, b];\n`,
  },
  {
    layer: "client: legitimate dynamic imports (code splitting)",
    file: "apps/client/src/a.ts",
    code: `export const a = [import("three/webgpu"), import("@moon-cleanup/sim"), import("./lazy.ts")];\nexport const b = (n: string) => import(n);\n`,
  },
  {
    layer: "server: dynamic imports of Node and workspace packages",
    file: "apps/server/src/a.ts",
    code: `export const a = [import("node:fs"), import("@moon-cleanup/db")];\n`,
  },
  { layer: "protocol", file: "packages/protocol/src/a.ts", code: imp("@moon-cleanup/shared") },
  { layer: "world", file: "packages/world/src/a.ts", code: imp("@moon-cleanup/shared") },
  {
    layer: "sim",
    file: "packages/sim/src/a.ts",
    code: `import { a } from "@moon-cleanup/shared";\nimport { b } from "@moon-cleanup/world";\nimport { c } from "@moon-cleanup/game-data";\nexport const d = [a, b, c, performance.now(), globalThis];\n`,
  },
  { layer: "game-data", file: "packages/game-data/src/a.ts", code: imp("@moon-cleanup/shared") },
  {
    layer: "db",
    file: "packages/db/src/a.ts",
    code: `import { a } from "@moon-cleanup/shared";\nimport { drizzle } from "drizzle-orm/postgres-js";\nimport { join } from "node:path";\nexport const d = [a, drizzle, join];\n`,
  },
  {
    layer: "client",
    file: "apps/client/src/a.ts",
    code: `import { WebGPURenderer, RenderPipeline } from "three/webgpu";\nimport { Timer } from "three";\nimport { HDRLoader } from "three/addons/loaders/HDRLoader.js";\nimport { a } from "@moon-cleanup/protocol";\nimport { b } from "@moon-cleanup/sim";\nimport { c } from "@moon-cleanup/world";\nimport { d } from "@moon-cleanup/game-data";\nimport { e } from "@moon-cleanup/shared";\nexport const all = [WebGPURenderer, RenderPipeline, Timer, HDRLoader, a, b, c, d, e, window.devicePixelRatio];\n`,
  },
  {
    layer: "server",
    file: "apps/server/src/a.ts",
    code: `import { readFileSync } from "node:fs";\nimport { Room } from "@colyseus/core";\nimport { a } from "@moon-cleanup/db";\nimport { b } from "@moon-cleanup/sim";\nexport const all = [readFileSync, Room, a, b, process.env];\n`,
  },
  {
    layer: "tools",
    file: "tools/bots/src/a.ts",
    code: `import { readFileSync } from "node:fs";\nimport { a } from "@moon-cleanup/protocol";\nimport { b } from "@moon-cleanup/sim";\nexport const all = [readFileSync, a, b];\n`,
  },
  {
    layer: "tests",
    file: "tests/e2e/a.spec.ts",
    code: `import { a } from "@moon-cleanup/shared";\nimport { readFileSync } from "node:fs";\nexport const all = [a, readFileSync];\n`,
  },
  {
    layer: "config package",
    file: "packages/config/eslint/a.ts",
    code: `import { builtinModules } from "node:module";\nimport { ESLint } from "eslint";\nexport const all = [builtinModules, ESLint];\n`,
  },
  {
    layer: "package build file outside src (vitest.config.ts)",
    file: "packages/shared/vitest.config.ts",
    code: `import { mergeConfig } from "vitest/config";\nimport { nodePreset } from "@moon-cleanup/config/vitest";\nexport default mergeConfig(nodePreset, {});\n`,
  },
  {
    layer: "app default export (vite.config.ts)",
    file: "apps/client/vite.config.ts",
    code: `export default { root: "." };\n`,
  },
  {
    layer: "plain JavaScript hook (.claude/hooks/*.mjs)",
    file: ".claude/hooks/example.mjs",
    code: `import { readFileSync } from "node:fs";\nprocess.stdout.write(readFileSync(0, "utf8"));\n`,
  },
];

// Test files of the environment-agnostic packages may use Node (T02 review finding 7).
allowed.push(
  ...(["shared", "sim", "world", "protocol", "game-data"] as const).map((name) => ({
    layer: `${name} test file may read golden vectors with node:fs and process`,
    file: `packages/${name}/src/a.test.ts`,
    code: `import { readFileSync } from "node:fs";
import { it } from "vitest";
it("x", () => readFileSync(process.env["F"] ?? "", "utf8"));
`,
  })),
  {
    layer: "spec file variant",
    file: "packages/protocol/src/net/a.spec.ts",
    code: `import { join } from "node:path";
export const p = join("a", "b");
`,
  },
);

describe("module-boundaries: allowed imports stay clean", () => {
  it.each(allowed)("$layer [$file]", async ({ file, code }) => {
    const findings = await lintFixture(code, file);
    expect(findings, JSON.stringify(findings)).toEqual([]);
  });
});
