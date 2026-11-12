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
];

// Rule 3: sim, world, protocol, shared are environment-agnostic.
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

  it("rule 4 (coding standards): default export inside a package src folder", async () => {
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

describe("module-boundaries: allowed imports stay clean", () => {
  it.each(allowed)("$layer [$file]", async ({ file, code }) => {
    const findings = await lintFixture(code, file);
    expect(findings, JSON.stringify(findings)).toEqual([]);
  });
});
