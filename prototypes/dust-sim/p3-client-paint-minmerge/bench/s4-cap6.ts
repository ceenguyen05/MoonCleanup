// S4 at the real room cap (6 bots instead of the harness's 16), same bot scenario and seed, standard 600 s.
// The harness CLI fixes 16 bots, so this calls the shared scenario runner directly. Not a contest score. Run (Node 26):
//   cd tools/bots && node --import tsx ../../prototypes/dust-sim/p3-client-paint-minmerge/bench/s4-cap6.ts [bots] [seconds]
import { CONTEST_SEED, runS4 } from "../../../../tools/bots/src/scenarios/dust-contest/index";
import { SIM_TICK_HZ, sitePoint } from "../../harness/src/scene";
import type { AdapterStartContext } from "../../harness/src/types";
import { createGrid } from "../grid";
import { createAdapter } from "../harness-adapter";

const bots = Number(process.argv[2] ?? 6);
const simSeconds = Number(process.argv[3] ?? 600);
const grid = createGrid();
const adapter = createAdapter();
const ctx: AdapterStartContext = {
  approach: "p3-client-paint-minmerge",
  seed: CONTEST_SEED,
  grid,
  simTickHz: SIM_TICK_HZ,
  tier: "B",
  quality: "medium",
  backend: "webgpu",
  outDir: "",
};
await adapter.start(ctx);
const p = sitePoint(0, 0);
const clusterPlot = grid.plotAt({ x: p[0], y: p[1], z: p[2] } as never);
const r = await runS4(adapter, { grid, seed: CONTEST_SEED, simSeconds, clusterPlot, bots });
const extra = adapter.exportMetrics?.() ?? {};
console.log(
  JSON.stringify({
    bots,
    simSeconds,
    flushHz: extra["flushHz"],
    bytesPerSecPerClientMax: r.bytesPerSecPerClient.max,
    bytesPerSecPerClientP50: r.bytesPerSecPerClient.p50,
    uploadBytesPerSecPerClientMax: extra["uploadBytesPerSecPerClientMax"],
    hashMatchPct: r.hash.matchPct,
    hashChecks: r.hash.checks,
    tickMsP99: r.tickMs.p99,
    serverCpuMs: r.serverCpuMs,
    rejected: r.rejected,
    texelsStale: extra["texelsStale"],
  }),
);
await adapter.stop();
