// Steady-state allocation guard (M1-W3-T09). A warmed room with 6 sweeping (or loping) actors and no event listener
// must allocate ~nothing per tick inside packages/sim: hot helpers take no float64 arguments (a call V8 does not inline
// boxes each one into a fresh HeapNumber) and scratch lives in typed arrays / own-map classes.
//
// Measure: the V8 sampling heap profiler (32 B interval, GC'd objects included), counting only bytes whose allocating
// frame is a packages/sim source file. Process-wide counters (total_allocated_bytes) are too noisy under the vitest
// worker (100-600 B/tick of runner background), the profiler's attribution is not. Before the fix: ~1.1 KiB/tick
// (stepAvatar ~200 B per actor-tick, quantiseSegment ~230 B, payload building ~590 B); after: ~0-10 B/tick.
// Node lane only (node:inspector); skipped where the inspector is unavailable.
//
// M1-W3-T01b adds the same guard for the real dust ledger (WorldDustLedger of packages/world, the ledger every host
// runs): frames of packages/sim AND packages/world are counted, with the ledger pool reserved up front as hosts do.
import { describe, expect, test } from "vitest";
import { INPUT_BUTTON_MASK as M, type SimInputCommand } from "@moon-cleanup/shared";
import { makeSim, makeWorldLedger, PLAYER, testWorld } from "../support/world";

interface ProfileNode {
  readonly callFrame: { readonly functionName: string; readonly url: string };
  readonly selfSize: number;
  readonly children: readonly ProfileNode[];
}
interface InspectorSession {
  connect(): void;
  disconnect(): void;
  post(method: string, params?: object): Promise<unknown>;
}
interface InspectorModule {
  Session: new () => InspectorSession;
}

async function openSession(): Promise<InspectorSession | null> {
  const spec = "node:inspector/promises";
  try {
    const mod = (await import(/* @vite-ignore */ spec)) as InspectorModule;
    const s = new mod.Session();
    s.connect();
    return s;
  } catch {
    return null;
  }
}

const SIM_SRC = /packages[\\/]sim[\\/]src[\\/]/;
const SIM_AND_WORLD_SRC = /packages[\\/](sim|world)[\\/]src[\\/]/;

/** Sampled bytes per tick allocated by packages/sim frames, plus the top sites (for the failure message). */
async function simBytesPerTick(
  session: InspectorSession,
  mode: "sweep" | "lope",
  realLedger = false,
): Promise<{ perTick: number; sites: string; poolGrowths: number; ledgers: number }> {
  const ledger = realLedger ? makeWorldLedger() : null;
  // Hosts reserve the ledger pool before play; a pool growth on the tick path would show up in `poolGrowths`.
  ledger?.reserve(2048);
  const growthsBefore = ledger?.poolGrowths ?? 0;
  const src = realLedger ? SIM_AND_WORLD_SRC : SIM_SRC;
  const sim = makeSim(testWorld(), ledger ? { ledger } : {});
  for (let s = 0; s < 6; s++) sim.addActor(s, PLAYER);
  const cmd: { -readonly [K in keyof SimInputCommand]: SimInputCommand[K] } = {
    seq: 0,
    moveX: 0,
    moveY: 100,
    yaw: 0,
    pitch: -20,
    buttons: 0,
    toolParam: 200,
  };
  let t = 1;
  const step = (): void => {
    for (let s = 0; s < 6; s++) {
      cmd.seq = t & 0xffff;
      cmd.yaw = (t * 40 + s * 9000) & 0xffff;
      cmd.moveX = mode === "lope" ? 0 : ((t >> 5) & 1) * 60 - 30;
      cmd.moveY = mode === "lope" ? 127 : 100;
      cmd.buttons = mode === "lope" ? M.lope : M.toolPrimary;
      sim.applyInput(s, cmd);
    }
    sim.step(sim.config.dt);
    for (let s = 0; s < 6; s++) if (sim.toolState(s).fullLatched) sim.drainCell(s);
    // What a host does every tick (the sim empties the Opened / Polished queues itself).
    if (ledger) ledger.clearDirtyPlots();
    t++;
  };
  for (let k = 0; k < 4000; k++) step(); // warm (Maglev -> TurboFan)
  const n = 4000;
  await session.post("HeapProfiler.startSampling", {
    samplingInterval: 32,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  for (let k = 0; k < n; k++) step();
  const { profile } = (await session.post("HeapProfiler.stopSampling")) as { profile: { head: ProfileNode } };
  const bySite = new Map<string, number>();
  let total = 0;
  const visit = (node: ProfileNode): void => {
    if (node.selfSize > 0 && src.test(node.callFrame.url)) {
      total += node.selfSize;
      const file = node.callFrame.url.split(/[\\/]/).slice(-2).join("/");
      const key = `${node.callFrame.functionName || "(anon)"} ${file}`;
      bySite.set(key, (bySite.get(key) ?? 0) + node.selfSize);
    }
    for (const c of node.children) visit(c);
  };
  visit(profile.head);
  const sites = [...bySite.entries()]
    .sort((p, q) => q[1] - p[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}: ${(v / n).toFixed(1)} B/tick`)
    .join("; ");
  return {
    perTick: total / n,
    sites,
    poolGrowths: (ledger?.poolGrowths ?? 0) - growthsBefore,
    ledgers: ledger?.ledgerCount ?? 0,
  };
}

describe("steady-state allocation (6 actors, warmed, no listener)", async () => {
  const session = await openSession();

  test.skipIf(session === null)("sweeping and loping allocate ~0 B/tick in packages/sim", async () => {
    try {
      for (const mode of ["sweep", "lope"] as const) {
        const r = await simBytesPerTick(session!, mode);
        console.log(`MEASURED sim allocation (${mode}, 6 actors): ${r.perTick.toFixed(1)} B/tick [${r.sites}]`);
        // Before the fix ~1,100 B/tick; the bound leaves room for sampling noise and engine updates.
        expect(r.perTick, r.sites).toBeLessThan(64);
      }
      // The real dust ledger under the same load (sim + world frames).
      const r = await simBytesPerTick(session!, "sweep", true);
      console.log(
        `MEASURED sim + world allocation (sweep, 6 actors, real ledger, ${r.ledgers} ledgers): ` +
          `${r.perTick.toFixed(1)} B/tick, pool growths ${r.poolGrowths} [${r.sites}]`,
      );
      expect(r.ledgers).toBeGreaterThan(0);
      expect(r.poolGrowths).toBe(0);
      expect(r.perTick, r.sites).toBeLessThan(64);
    } finally {
      session!.disconnect();
    }
  });
});
