// Client build: static output to apps/client/dist (deployed by Vercel, ADR-0029).
// Only VITE_* variables reach the bundle (Vite default prefix; secrets never use it). Source maps are off by default (MC_SOURCEMAP, below).
// No COOP/COEP headers on the dev server (production COOP comes from vercel.json). Dev port is set with
// `vite --port <5173+N>` in the package script.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { terrainAssets } from "./vite/terrain-assets.ts";

export default defineConfig({
  envPrefix: "VITE_",
  // Serves and ships the baked terrain from assets/terrain (manifest + hashed payloads only), M0-W3-T06.
  plugins: [terrainAssets(fileURLToPath(new URL("../../", import.meta.url)))],
  build: {
    outDir: "dist",
    // Default: no source maps in dist (Vercel publishes all of dist, so any .map would be publicly fetchable).
    // MC_SOURCEMAP=hidden emits .map files without the sourceMappingURL comment, for Sentry upload / CI evidence
    // builds that are not deployed; MC_SOURCEMAP=true emits linked maps (local debugging).
    sourcemap: process.env["MC_SOURCEMAP"] === "hidden" ? "hidden" : process.env["MC_SOURCEMAP"] === "true",
    target: "es2024",
  },
  server: {
    strictPort: true,
    fs: {
      // Setting `deny` replaces Vite's default list, so the defaults are repeated first. The rest are the repo paths
      // that must never be readable through `/@fs/<abs path>` (security review N9): the raw LOLA tile and bake caches
      // under assets/terrain, and the downloaded tool binaries. The baked `assets/terrain/*.bin` payloads and
      // manifest stay reachable (bench `terrainBase=/@fs/...`) and are also served by the terrain-assets plugin.
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/assets/terrain/raw/**",
        "**/assets/terrain/cache/**",
        "**/assets/terrain/fixtures/**",
        "**/tools/.bin/**",
      ],
    },
  },
});
