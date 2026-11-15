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
    // Vendor chunk groups (M1 chunk split): engine libs leave the app entry chunk so it caches separately and the
    // online-only SDK/Sentry load only with the lazy online chunk. Rolldown advancedChunks, Vite 8.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor-three", test: /node_modules[\/]three[\/]/, priority: 30 },
            {
              name: "vendor-react",
              test: /node_modules[\/](react|react-dom|scheduler|motion|motion-dom|motion-utils)[\/]/,
              priority: 20,
            },
            { name: "vendor-online", test: /node_modules[\/](@colyseus|@sentry|@sentry-internal)[\/]/, priority: 10 },
          ],
        },
      },
    },
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
