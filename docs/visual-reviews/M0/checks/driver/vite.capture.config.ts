// Capture-only Vite config (M0-visual-checks): the client's config with the file watcher and HMR OFF, so an edit by another
// worker cannot reload a page in the middle of a stepped capture. Run from apps/client:
//   node node_modules/vite/bin/vite.js --config ../../docs/visual-reviews/M0/checks/driver/vite.capture.config.ts --port 5193
// The served code is the file state at the first request of each module after the server starts.
import { terrainAssets } from "../../../../../apps/client/vite/terrain-assets.ts";

const REPO = new URL("../../../../../", import.meta.url);

export default {
  envPrefix: "VITE_",
  plugins: [terrainAssets(decodeURIComponent(REPO.pathname).replace(/^\/([A-Za-z]:)/, "$1"))],
  server: { strictPort: true, hmr: false, watch: null },
};
