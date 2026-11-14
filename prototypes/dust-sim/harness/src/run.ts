// Scenario runners S1 to S8: drive an adapter through the shared scene and produce schema results.
import type { UnitDirection } from "@moon-cleanup/shared";
import path from "node:path";
import { CONTEST_SEED, runS4, runS5, runS6 } from "../../../../tools/bots/src/scenarios/dust-contest/index";
import { percentiles } from "../../../../tools/bots/src/stats";
import { strokeBetween, type V3 } from "./geometry";
import { barMetric, buildResult, infoMetric, resultsDir, writeResult, writeSummary, type ResultInput } from "./metrics";
import {
  ALL_PATHS,
  HARNESS_SEED,
  PLOT_PITCH_M,
  SIM_TICK_HZ,
  makeBookmarks,
  sceneSetupStrokes,
  sitePoint,
  type CameraPath,
} from "./scene";
import type {
  AdapterStartContext,
  ContestGrid,
  DustPrototypeAdapter,
  HardwareTier,
  MetricResult,
  QualityPreset,
  RenderBackend,
  ScenarioId,
  ScenarioResult,
} from "./types";

if (HARNESS_SEED !== CONTEST_SEED) throw new Error("harness and bot seeds diverged");

export interface RunOptions {
  readonly adapter: DustPrototypeAdapter;
  readonly grid: ContestGrid;
  /** prototypes/dust-sim/results */
  readonly resultsRoot: string;
  readonly scenarios: readonly ScenarioId[];
  readonly tier: HardwareTier;
  readonly quality: QualityPreset;
  readonly backend: RenderBackend;
  /** Cuts every scenario to this many simulated seconds (dry runs and smoke tests). 0 or undefined = standard length. */
  readonly maxSimSeconds?: number;
  /** Camera frames per second sampled from the path drivers. */
  readonly fps?: number;
  readonly realtime?: boolean;
  /** Plot of the bot cluster; defaults to the plot at the site. */
  readonly clusterPlot?: number;
}

const STANDARD_SECONDS = { S1: 180, S2: 120, S3: 60, S4: 600, S5: 1800, S6: 80, S7: 10, S8: 18 } as const;

function limit(id: ScenarioId, o: RunOptions): number {
  const std = STANDARD_SECONDS[id];
  return o.maxSimSeconds && o.maxSimSeconds > 0 ? Math.min(std, o.maxSimSeconds) : std;
}

/** Plays the camera path through adapter.view and submits the cleaning strokes the path implies. */
function playPath(
  o: RunOptions,
  path: CameraPath,
  maxSeconds: number,
): { frames: ReturnType<NonNullable<DustPrototypeAdapter["view"]>>[]; strokes: number } {
  const fps = o.fps ?? 60;
  const strokeEvery = Math.max(1, Math.round(fps / SIM_TICK_HZ));
  const frames: ReturnType<NonNullable<DustPrototypeAdapter["view"]>>[] = [];
  let prevHead: V3 | null = null;
  let strokes = 0;
  const maxFrames = Math.round(maxSeconds * fps);
  for (const s of path.samples(fps)) {
    if (s.frame >= maxFrames) break;
    if (s.cleaning && s.frame % strokeEvery === 0) {
      const head = s.cleaning.headDir as V3;
      if (prevHead) {
        o.adapter.submitStroke(
          0,
          strokeBetween(o.grid, prevHead, head, Math.floor(s.frame / strokeEvery), { ...s.cleaning, actorSlot: 0 }),
        );
        strokes++;
      }
      prevHead = head;
      void o.adapter.advance(1);
    }
    const f = o.adapter.view?.(s.pose, s.cleaning);
    if (f) frames.push(f);
  }
  return { frames, strokes };
}

async function setupScene(o: RunOptions): Promise<void> {
  await o.adapter.joinClient(0);
  for (const s of sceneSetupStrokes(o.grid)) o.adapter.submitStroke(0, s);
  await o.adapter.advance(1);
}

const gpuNote = "GPU timestamps not provided by this adapter or run (CPU/headless)";

async function runOne(id: ScenarioId, o: RunOptions): Promise<ScenarioResult> {
  const a = o.adapter;
  const dry = a.isStub || process.env.DUST_HARNESS_DRY === "1";
  const seconds = limit(id, o);
  const clusterPlot = o.clusterPlot ?? o.grid.plotAt(siteDir());
  const common = { grid: o.grid, seed: HARNESS_SEED, simSeconds: seconds, clusterPlot, realtime: o.realtime ?? false };
  const metrics: MetricResult[] = [];
  const notes: string[] = [];
  let extra: Record<string, number> = {};

  switch (id) {
    case "S1": {
      await setupScene(o);
      const { frames, strokes } = playPath(o, ALL_PATHS.S1(), seconds);
      const gpu = frames.flatMap((f) => (f.dustGpuMs === undefined ? [] : [f.dustGpuMs]));
      const p = percentiles(gpu);
      const key = o.tier === "A" ? "s1.dustGpuMs.p95.tierA" : "s1.dustGpuMs.p95.tierB";
      metrics.push(barMetric(key, gpu.length ? p.p95 : null, "ms", gpu.length ? undefined : gpuNote));
      metrics.push(barMetric("s1.edgeWidthPx.2m", a.measureEdgeWidthPx?.(2) ?? null, "px"));
      metrics.push(infoMetric("s1.edgeWidthPx.10m", a.measureEdgeWidthPx?.(10) ?? null, "px"));
      metrics.push(infoMetric("s1.edgeWidthPx.50m", a.measureEdgeWidthPx?.(50) ?? null, "px"));
      metrics.push(infoMetric("s1.cpuMs.p95", percentiles(frames.map((f) => f.cpuMs)).p95, "ms"));
      metrics.push(infoMetric("s1.frames", frames.length, "frames"));
      metrics.push(infoMetric("s1.strokes", strokes, "strokes"));
      break;
    }
    case "S2": {
      await setupScene(o);
      const { frames, strokes } = playPath(o, ALL_PATHS.S2(), seconds);
      const target = 1000 / 60;
      const worst = frames.reduce((m, f) => Math.max(m, f.cpuMs), 0);
      metrics.push(
        barMetric("s2.maxFrameOverTarget", worst / target, "x target frame", "tile-work CPU ms over 16.7 ms"),
      );
      metrics.push(infoMetric("s2.replayMs.p95", percentiles(frames.map((f) => f.replayMs ?? 0)).p95, "ms"));
      metrics.push(infoMetric("s2.tileRebuildMs.max", Math.max(0, ...frames.map((f) => f.tileRebuildMs ?? 0)), "ms"));
      metrics.push(
        infoMetric("s2.tileUploadsPerSec", frames.reduce((s, f) => s + (f.tileUploads ?? 0), 0) / seconds, "tiles/s"),
      );
      metrics.push(infoMetric("s2.strokes", strokes, "strokes"));
      metrics.push(
        infoMetric("s2.plotsCrossed", 30, "plots", `${(30 * PLOT_PITCH_M).toFixed(0)} m out and back at 20 m/s`),
      );
      break;
    }
    case "S3": {
      await setupScene(o);
      const { frames } = playPath(o, ALL_PATHS.S3(), seconds);
      metrics.push(infoMetric("s3.tileUploadsPerFrame", mean(frames.map((f) => f.tileUploads ?? 0)), "tiles"));
      metrics.push(
        barMetric(
          "s3.orbitIdentificationPct",
          null,
          "%",
          "needs 10 testers on B08-orbit-globe blind pairs; ground truth is the reference strip of sceneSetupStrokes",
        ),
      );
      break;
    }
    case "S4": {
      const r = await runS4(a, { ...common, bots: 16 });
      metrics.push(
        barMetric(
          "s4.eventLoopLagP99Ms",
          r.eventLoopLagP99Ms,
          "ms",
          r.eventLoopLagP99Ms === null ? "adapter has no probe" : undefined,
        ),
      );
      metrics.push(barMetric("s4.bytesPerSecPerClient.max", r.bytesPerSecPerClient.max, "B/s"));
      metrics.push(barMetric("s4.hashMatchPct", r.hash.matchPct, "%"));
      metrics.push(infoMetric("s4.tickMs.p50", r.tickMs.p50, "ms"));
      metrics.push(infoMetric("s4.tickMs.p99", r.tickMs.p99, "ms"));
      metrics.push(infoMetric("s4.bytesPerSecPerClient.p50", r.bytesPerSecPerClient.p50, "B/s"));
      metrics.push(infoMetric("s4.serverCpuMs", r.serverCpuMs, "ms"));
      metrics.push(
        infoMetric(
          "s4.rejectedStrokes",
          Object.values(r.rejected).reduce((s, n) => s + n, 0),
          "strokes",
        ),
      );
      metrics.push(infoMetric("s4.strokes", r.strokesSubmitted, "strokes"));
      if (r.serverCpuMs === null) notes.push("server CPU needs the 0.1-CPU cgroup run; adapter reports none");
      break;
    }
    case "S5": {
      const r = await runS5(a, { ...common, robots: 400, bots: 4 });
      const cpuPct = r.serverCpuMs === null ? null : (100 * r.serverCpuMs) / (r.simSeconds * 1000 * 0.1);
      metrics.push(
        barMetric(
          "s5.serverCpuPctOfBudget",
          cpuPct,
          "% of 0.1 CPU",
          cpuPct === null ? "adapter has no probe" : undefined,
        ),
      );
      metrics.push(barMetric("s5.rssMb", r.rssMb, "MB", r.rssMb === null ? "adapter has no probe" : undefined));
      metrics.push(infoMetric("s5.intents", r.intents, "intents"));
      metrics.push(infoMetric("s5.intentBytesPerSec", r.intentBytesPerSec, "B/s"));
      metrics.push(infoMetric("s5.tickMs.p99", r.tickMs.p99, "ms"));
      notes.push("synthetic: 400 robots as RobotPlotIntent, 4 stroking bots; real fleet sim is a later integration");
      break;
    }
    case "S6": {
      const r = await runS6(a, {
        ...common,
        bots: 4,
        beforeSeconds: Math.max(5, seconds * 0.6),
        afterSeconds: Math.max(2, seconds * 0.2),
        persistEverySec: 2,
      });
      if (!r.supported) {
        metrics.push(barMetric("s6.lostSeconds", null, "s", "adapter lacks persist/crash/restore"));
        metrics.push(barMetric("s6.restoredHashConsistent", null, "bool", "adapter lacks persist/crash/restore"));
      } else {
        metrics.push(barMetric("s6.lostSeconds", r.lostSeconds, "s"));
        metrics.push(barMetric("s6.restoredHashConsistent", r.restoredHashConsistent ? 1 : 0, "bool"));
        metrics.push(infoMetric("s6.restoreMs", r.restoreMs, "ms"));
        metrics.push(infoMetric("s6.postRestoreHashMatchPct", r.postRestoreHashMatchPct, "%"));
      }
      break;
    }
    case "S7": {
      // Age the world with a short S4 first (standard protocol: 30 minutes), then join late.
      await runS4(a, { ...common, simSeconds: Math.min(60, seconds * 6), bots: 16 });
      const j = await a.lateJoin?.(99);
      metrics.push(
        barMetric("s7.blockingBytes", j?.blockingBytes ?? null, "B", j ? undefined : "adapter lacks lateJoin"),
      );
      metrics.push(barMetric("s7.playableMs", j?.playableMs ?? null, "ms", j ? undefined : "adapter lacks lateJoin"));
      metrics.push(infoMetric("s7.streamedBytes", j?.streamedBytes ?? null, "B"));
      metrics.push(infoMetric("s7.tileRebuildMs", j?.tileRebuildMs ?? null, "ms"));
      const { frames } = playPath(o, ALL_PATHS.S7(), seconds);
      metrics.push(infoMetric("s7.frames", frames.length, "frames"));
      notes.push("standard protocol ages the world with 30 minutes of S4 before the join");
      break;
    }
    case "S8": {
      const marks = makeBookmarks();
      metrics.push(infoMetric("s8.bookmarks", marks.length, "shots", "parity pairs needed per backend"));
      const out = path.join(resultsDir(o.resultsRoot, a.approach), "artifacts", `s8-${o.backend}`);
      if (a.capture && !dry) {
        for (const m of marks) await a.capture(m.id, m.pose, path.join(out, `${m.id}.png`));
        metrics.push(infoMetric("s8.captured", marks.length, "PNG"));
      } else {
        metrics.push(infoMetric("s8.captured", null, "PNG", "GPU capture not run (headless dry run)"));
      }
      break;
    }
  }
  if (a.exportMetrics) extra = { ...a.exportMetrics() };
  const input: ResultInput = {
    approach: a.approach,
    scenario: id,
    seed: HARNESS_SEED,
    dryRun: dry,
    tier: o.tier,
    quality: o.quality,
    backend: o.backend,
    simSeconds: seconds,
    metrics,
    extra,
    notes: dry ? [...notes, "dry run: numbers are plumbing checks, not scores"] : notes,
    gpu: dry ? "none (CPU dry run)" : "see run notes",
  };
  return buildResult(input);
}

const siteDir = (): UnitDirection => {
  const p = sitePoint(0, 0);
  return { x: p[0], y: p[1], z: p[2] } as UnitDirection;
};

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** Runs the scenarios in order against one adapter and writes JSON + SUMMARY.md. Returns the results. */
export async function runScenarios(o: RunOptions): Promise<ScenarioResult[]> {
  const dir = resultsDir(o.resultsRoot, o.adapter.approach);
  const out: ScenarioResult[] = [];
  for (const id of o.scenarios) {
    const ctx: AdapterStartContext = {
      approach: o.adapter.approach,
      seed: HARNESS_SEED,
      grid: o.grid,
      simTickHz: SIM_TICK_HZ,
      tier: o.tier,
      quality: o.quality,
      backend: o.backend,
      outDir: path.join(dir, "artifacts"),
    };
    await o.adapter.start(ctx);
    const r = await runOne(id, o);
    writeResult(dir, r);
    out.push(r);
    await o.adapter.stop();
  }
  writeSummary(dir, out);
  return out;
}
