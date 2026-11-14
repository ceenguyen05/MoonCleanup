// Server bundle: apps/server/src/app/index.ts -> apps/server/dist/index.js (esbuild, ESM, Node 26 target).
// uWebSockets.js is a native, git-pinned OPTIONAL dependency and stays external (resolved from node_modules at
// runtime; it may be absent when its GitHub tarball could not be installed). Code splitting keeps the two transport
// adapters (src/net/uws-transport.ts, src/net/ws-transport.ts, loaded via dynamic import in src/net/transport.ts) in
// lazy chunks: the external `import "uWebSockets.js"` lives only in the uWS chunk, so a missing/incompatible addon
// rejects that import and TRANSPORT=auto falls back to ws instead of the whole bundle failing to load. One copy of
// @colyseus/core stays shared between the entry and both chunks. Source maps are emitted for Sentry.
import { rmSync } from "node:fs";
import { build } from "esbuild";

// Stale hashed chunks from earlier builds must not linger next to the new ones.
rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: { index: "src/app/index.ts" },
  outdir: "dist",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  splitting: true,
  platform: "node",
  format: "esm",
  target: "node26",
  sourcemap: true,
  external: ["uWebSockets.js"],
  // Bundled CommonJS dependencies (pino, express, etc.) may call require(); provide it in every ESM output file.
  banner: {
    js: 'import { createRequire as __mcCreateRequire } from "node:module"; const require = __mcCreateRequire(import.meta.url);',
  },
  logLevel: "info",
});
