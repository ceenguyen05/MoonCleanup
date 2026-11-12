// Package-boundary rules: docs/architecture/module-boundaries.md section 1 (rules 1-6), expressed as ESLint core
// `no-restricted-imports` / `no-restricted-globals` / `no-restricted-syntax`.
//
// ESLint replaces (does not merge) a rule's options when a later config object sets the same rule, so every layer
// below is built by `restrict()` from the COMMON set plus its own additions, and layers are listed from general to
// specific in index.ts. Whether to add an import-boundary plugin (eslint-plugin-boundaries) is undecided
// (packages/config/README.md); core rules are enough for these six rules.
import { builtinModules } from "node:module";
import { bannedImportPatterns, bannedImportPaths, bannedSyntax } from "./ban-list.ts";

const MB = "docs/architecture/module-boundaries.md section 1";

export interface ImportPath {
  name: string;
  message: string;
}
export interface ImportPattern {
  group?: string[];
  regex?: string;
  message: string;
}
export interface Restrictions {
  paths: ImportPath[];
  patterns: ImportPattern[];
  globals: { name: string; message: string }[];
  syntax: { selector: string; message: string }[];
}

/** Workspace package folder names under packages/, apps/ and tools|tests/ (npm scope @moon-cleanup/<name>). */
const PACKAGES = ["shared", "protocol", "world", "sim", "game-data", "db"] as const;
const APPS = ["client", "server"] as const;
const TOOLS = [
  "asset-pipeline",
  "balance-sim",
  "bots",
  "netsim",
  "perf",
  "screenshots",
  "terrain-bake",
  "e2e",
] as const;

type PackageName = (typeof PACKAGES)[number];

/** Allowed workspace dependencies per package: the arrows of the mermaid graph in module-boundaries section 1. */
export const ALLOWED_PACKAGE_DEPS: Record<PackageName, readonly PackageName[]> = {
  shared: [],
  protocol: ["shared"],
  world: ["shared"],
  sim: ["shared", "world", "game-data"],
  "game-data": ["shared"],
  db: ["shared"],
};

/** `@moon-cleanup/<name>` and everything below it. */
function scoped(names: readonly string[]): string[] {
  return names.flatMap((n) => [`@moon-cleanup/${n}`, `@moon-cleanup/${n}/**`]);
}

const none = (): Restrictions => ({ paths: [], patterns: [], globals: [], syntax: [] });

/** COMMON: applies to every linted file. Rule 6 (no deep imports) + the three.js import-source ban-list. */
export const common: Restrictions = {
  paths: [...bannedImportPaths],
  patterns: [
    {
      group: ["@moon-cleanup/*/src", "@moon-cleanup/*/src/**"],
      message: `Deep imports are banned: import from the package root (its index.ts barrel). ${MB}, rule 6.`,
    },
    {
      regex: String.raw`^(\.\./)+packages/[^/]+/(src|dist)(/|$)`,
      message: `Deep imports into another package's src are banned: import "@moon-cleanup/<name>". ${MB}, rule 6.`,
    },
    ...bannedImportPatterns,
  ],
  globals: [],
  syntax: [...bannedSyntax],
};

/** Merge restriction sets (concatenate every list). */
export function merge(...sets: Restrictions[]): Restrictions {
  return {
    paths: sets.flatMap((s) => s.paths),
    patterns: sets.flatMap((s) => s.patterns),
    globals: sets.flatMap((s) => s.globals),
    syntax: sets.flatMap((s) => s.syntax),
  };
}

/** Rule 1: packages/* never import apps/* or tools/*. */
export const packagesNeverImportAppsOrTools: Restrictions = {
  ...none(),
  patterns: [
    {
      group: scoped([...APPS, ...TOOLS]),
      message: `packages/* never import apps/* or tools/*. ${MB}, rule 1.`,
    },
    {
      regex: String.raw`^(\.\./)+(apps|tools)/(client|server|asset-pipeline|balance-sim|bots|netsim|perf|screenshots|terrain-bake)(/|$)`,
      message: `packages/* never import apps/* or tools/*. ${MB}, rule 1.`,
    },
  ],
};

/** Rule 2 + dependency direction: a package may only import the workspace packages the graph allows. */
export function packageDirection(self: PackageName): Restrictions {
  const allowed = new Set<string>(ALLOWED_PACKAGE_DEPS[self]);
  const forbidden = PACKAGES.filter((p) => p !== self && !allowed.has(p));
  return {
    ...none(),
    patterns: [
      {
        group: scoped(forbidden),
        message:
          self === "shared"
            ? `packages/shared imports nothing from the workspace (pure types, constants, zod). ${MB}, rule 2.`
            : `@moon-cleanup/${self} may only import ${[...allowed].map((a) => `@moon-cleanup/${a}`).join(", ") || "nothing"} (dependency direction). ${MB}.`,
      },
    ].filter((p) => p.group.length > 0),
  };
}

/** Node built-ins, with and without the node: prefix (rule 3: no Node APIs). */
const NODE_BUILTINS = [...new Set(builtinModules.filter((m) => !m.startsWith("_") && !m.startsWith("node:")))];

/** Rule 3: sim, world, protocol, shared are environment-agnostic (browser, Web Worker and Node). */
export const environmentAgnostic: Restrictions = {
  paths: [
    ...NODE_BUILTINS.map((name) => ({
      name,
      message: `Node built-in "${name}" is banned here: this package must run in a browser, a Worker and Node. ${MB}, rule 3.`,
    })),
    ...[
      "three",
      "colyseus",
      "colyseus.js",
      "uWebSockets.js",
      "uwebsockets-express",
      "react",
      "react-dom",
      "motion",
      "framer-motion",
      "lucide-react",
      "jsdom",
      "happy-dom",
    ].map((name) => ({
      name,
      message: `"${name}" is banned here (no DOM libs, three.js or Colyseus in environment-agnostic packages). ${MB}, rule 3.`,
    })),
  ],
  patterns: [
    {
      group: ["node:*"],
      message: `Node built-ins (node:*) are banned here. ${MB}, rule 3.`,
    },
    {
      group: [
        "three/**",
        "@types/three",
        "@colyseus/**",
        "colyseus.js/**",
        "react/**",
        "react-dom/**",
        "motion/**",
        "@sentry/**",
      ],
      message: `three.js, Colyseus, DOM and Sentry libraries are banned here. ${MB}, rule 3.`,
    },
  ],
  globals: [
    ...[
      "window",
      "document",
      "navigator",
      "localStorage",
      "sessionStorage",
      "location",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "HTMLElement",
      "HTMLCanvasElement",
    ].map((name) => ({ name, message: `DOM global "${name}" is banned here (rule 3).` })),
    ...["process", "Buffer", "__dirname", "__filename", "require", "global", "setImmediate"].map((name) => ({
      name,
      message: `Node global "${name}" is banned here (rule 3).`,
    })),
  ],
  syntax: [],
};

/** Rule 4a: apps/client never imports packages/db (nor the server app). */
export const clientRules: Restrictions = {
  ...none(),
  patterns: [
    {
      group: scoped(["db"]),
      message: `apps/client never imports @moon-cleanup/db (server-only persistence). ${MB}, rule 4.`,
    },
    {
      group: scoped(["server"]),
      message: `apps/client never imports apps/server. Share through packages/shared or packages/protocol. ${MB}.`,
    },
  ],
};

/** Rule 4b: apps/server never imports three.js (nor the client app). */
export const serverRules: Restrictions = {
  paths: [{ name: "three", message: `apps/server never imports three.js. ${MB}, rule 4.` }],
  patterns: [
    {
      group: ["three/**", "@types/three"],
      message: `apps/server never imports three.js. ${MB}, rule 4.`,
    },
    {
      group: scoped(["client"]),
      message: `apps/server never imports apps/client. Share through packages/shared or packages/protocol. ${MB}.`,
    },
  ],
  globals: [],
  syntax: [],
};

/** Rule 4 of the coding standards: no default exports in packages (apps and tool configs may need them). */
export const noDefaultExportInPackages: Restrictions = {
  ...none(),
  syntax: [
    {
      selector: "ExportDefaultDeclaration",
      message: "No default exports in packages (CLAUDE.md coding standards): use a named export.",
    },
  ],
};

export const PACKAGE_NAMES = PACKAGES;
