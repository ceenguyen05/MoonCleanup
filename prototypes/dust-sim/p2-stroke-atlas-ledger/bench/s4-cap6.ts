// T06: S4 at the real room cap (6 bots instead of the harness's 16), same bot scenario and seed, standard 600 s.
// The harness CLI fixes 16 bots, so this calls the shared scenario runner directly. Not a contest score. Run (Node 26):
//   cd tools/bots && node --import tsx ../../prototypes/dust-sim/p2-stroke-atlas-ledger/bench/s4-cap6.ts [bots] [seconds]
// P2_STROKE_CADENCE=tick sends every submitted stroke (20 Hz) instead of the 10 Hz cadence of WDS 4.4.
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
  approach: "p2-stroke-atlas-ledger",
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
const x = adapter.exportMetrics?.() ?? {};
const perClient = (k: string): number => +((x[k] ?? 0) / bots / simSeconds).toFixed(1);
console.log(
  JSON.stringify({
    bots,
    simSeconds,
    cadenceHz: x["cadenceFrame"] === 1 ? SIM_TICK_HZ / (x["frameTicks"] ?? 1) : SIM_TICK_HZ,
    bytesPerSecPerClientMax: r.bytesPerSecPerClient.max,
    bytesPerSecPerClientP50: r.bytesPerSecPerClient.p50,
    strokesBps: perClient("bytesStrokes"),
    ackBps: perClient("bytesAck"),
    plotsBps: perClient("bytesPlots"),
    ledgerLogCheckBps: +(
      ((x["bytesLedger"] ?? 0) + (x["bytesLog"] ?? 0) + (x["bytesCheck"] ?? 0)) /
      bots /
      simSeconds
    ).toFixed(1),
    hashMatchPct: r.hash.matchPct,
    hashChecks: r.hash.checks,
    tickMsP99: r.tickMs.p99,
    serverCpuMs: r.serverCpuMs === null ? null : +r.serverCpuMs.toFixed(1),
    serverTickMsP99: x["serverTickMsP99"],
    rejected: r.rejected,
    drift: x["clientDriftChunks"],
    resyncs: x["resyncs"],
    strokesSubmitted: x["strokesSubmitted"],
    strokesApplied: x["strokesApplied"],
  }),
);
await adapter.stop();
