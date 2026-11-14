// Package-boundary rules: docs/architecture/module-boundaries.md section 1 (rules 1-4 and 6; rule 5, no event bus /
// service registry, is not lint-enforced), expressed as ESLint core
// `no-restricted-imports` / `no-restricted-globals` / `no-restricted-syntax`.
//
// ESLint replaces (does not merge) a rule's options when a later config object sets the same rule, so every layer
// below is built by `merge()` from the COMMON set plus its own additions, and layers are listed from general to
// specific in index.ts. Whether to add an import-boundary plugin (eslint-plugin-boundaries) is undecided
// (packages/config/README.md); core rules are enough for these six rules.
import { builtinModules } from "node:module";
import { bannedImportPatterns, bannedImportPaths, bannedSyntax, bannedThreeMemberSyntax } from "./ban-list.ts";

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

/** Member / type-position / destructuring ban-list forms, for files that can import three.js (client, tools, e2e). */
export const threeCapable: Restrictions = { ...none(), syntax: [...bannedThreeMemberSyntax] };

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
      regex: String.raw`^(\.\./)+(apps/(${APPS.join("|")})|tools/(${TOOLS.filter((t) => t !== "e2e").join("|")})|tests/e2e)(/|$)`,
      message: `packages/* never import apps/* or tools/*. ${MB}, rule 1.`,
    },
  ],
};

/** Rule 2 + dependency direction: a package may only import the workspace packages the graph allows. */
export function packageDirection(self: PackageName): Restrictions {
  const allowed = new Set<string>(ALLOWED_PACKAGE_DEPS[self]);
  const forbidden = PACKAGES.filter((p) => p !== self && !allowed.has(p));
  const permitted = PACKAGES.filter((p) => p !== self && allowed.has(p));
  const directionMessage =
    self === "shared"
      ? `packages/shared imports nothing from the workspace (pure types, constants, zod). ${MB}, rule 2.`
      : `@moon-cleanup/${self} may only import ${[...allowed].map((a) => `@moon-cleanup/${a}`).join(", ") || "nothing"} (dependency direction). ${MB}.`;
  // Sibling packages by relative path from inside packages/: ../../<name>/src/... (finding 1.2 of the T02 review).
  // The /src or /dist segment is required, so a folder of the same name inside this package (../sim/input.ts in
  // packages/shared/src) stays legal.
  const siblingRegex = (names: readonly string[]) => String.raw`^(\.\./)+(${names.join("|")})/(src|dist)(/|$)`;
  const patterns: ImportPattern[] = [];
  if (forbidden.length > 0) {
    patterns.push(
      { group: scoped(forbidden), message: directionMessage },
      { regex: siblingRegex(forbidden), message: directionMessage },
    );
  }
  if (permitted.length > 0) {
    patterns.push({
      regex: siblingRegex(permitted),
      message: `Deep imports into another package's src are banned: import "@moon-cleanup/<name>". ${MB}, rule 6.`,
    });
  }
  return { ...none(), patterns };
}

// --- dynamic import() -----------------------------------------------------------------------------------------------
// Core `no-restricted-imports` ignores `import("x")`, so the same restriction data is also turned into
// `no-restricted-syntax` selectors on ImportExpression (finding 1 of the T02 review). Only string-literal sources can
// be matched; computed specifiers are out of reach for any static rule.

/** Gitignore-style group glob (`*` = no slash, `**` = anything) as a JS regex source. */
function globToRegexSource(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === "*") {
      if (glob.charAt(i + 1) === "*") {
        out += ".*";
        i++;
      } else {
        out += String.raw`[^/]*`;
      }
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return `^${out}$`;
}

/** esquery regex literals cannot contain "/", so it is written as \x2f (same trick as ban-list.ts). */
const esqueryRegex = (source: string): string => `/${source.replaceAll("/", String.raw`\x2f`)}/`;

/** One `ImportExpression` selector per path / pattern of `r`, carrying the same message. */
export function dynamicImportSyntax(r: Restrictions): { selector: string; message: string }[] {
  const sel = (source: string) => `ImportExpression > Literal.source[value=${esqueryRegex(source)}]`;
  const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\*]/g, "\\$&");
  return [
    ...r.paths.map((p) => ({ selector: sel(`^${escape(p.name)}$`), message: p.message })),
    ...r.patterns.flatMap((p) => [
      ...(p.group ?? []).map((g) => ({ selector: sel(globToRegexSource(g)), message: p.message })),
      ...(p.regex === undefined ? [] : [{ selector: sel(p.regex), message: p.message }]),
    ]),
  ];
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
        "colyseus/**",
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

/**
 * Test files inside the environment-agnostic packages may use Node (golden vectors read with node:fs, process.env in
 * a test): rule 3 minus the Node built-ins, node:* and Node globals. DOM / three / Colyseus bans stay
 * (T02 review finding 7; the shipped code in src stays Node-free).
 */
const NODE_GLOBAL_NAMES = new Set([
  "process",
  "Buffer",
  "__dirname",
  "__filename",
  "require",
  "global",
  "setImmediate",
]);
export const environmentAgnosticTests: Restrictions = {
  paths: environmentAgnostic.paths.filter((p) => !NODE_BUILTINS.includes(p.name)),
  patterns: environmentAgnostic.patterns.filter((p) => !(p.group ?? []).includes("node:*")),
  globals: environmentAgnostic.globals.filter((g) => !NODE_GLOBAL_NAMES.has(g.name)),
  syntax: [],
};

/** Coding standards (CLAUDE.md): no default exports in packages (apps and tool configs may need them). */
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
