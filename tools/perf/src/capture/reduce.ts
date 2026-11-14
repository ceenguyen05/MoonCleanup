// Reduces one capture run (every frame interval plus the HUD snapshots taken during it) to `RunMetrics`.
// Pure and unit-tested; the browser side lives in runner.ts.

import type { PerfSnapshot, RunMetrics } from "../schema";
import { median, percentile } from "../stats";

export function reduceRun(frameIntervalsMs: readonly number[], snapshots: readonly PerfSnapshot[]): RunMetrics {
  if (snapshots.length === 0) throw new Error("reduceRun: no HUD snapshots were collected");
  const last = snapshots[snapshots.length - 1] as PerfSnapshot;
  const mean =
    frameIntervalsMs.length === 0 ? 0 : frameIntervalsMs.reduce((s, v) => s + v, 0) / frameIntervalsMs.length;
  const medOf = (pick: (s: PerfSnapshot) => number): number => median(snapshots.map(pick));
  const measured = snapshots.every((s) => s.gpu.measured);
  const stepIds = new Set<string>();
  for (const s of snapshots) for (const id of Object.keys(s.cpuMs)) stepIds.add(id);
  const cpuStepMsP95: Record<string, number> = {};
  for (const id of stepIds) cpuStepMsP95[id] = medOf((s) => s.cpuMs[id]?.p95 ?? 0);
  const heaps = snapshots.map((s) => s.memory.jsHeapBytes).filter((v): v is number => v !== null);
  return {
    frameMsP50: percentile(frameIntervalsMs, 0.5),
    frameMsP95: percentile(frameIntervalsMs, 0.95),
    frameMsP99: percentile(frameIntervalsMs, 0.99),
    fps: mean > 0 ? 1000 / mean : 0,
    frames: frameIntervalsMs.length,
    cpuTotalMsP50: medOf((s) => s.cpuTotalMs.p50),
    cpuTotalMsP95: medOf((s) => s.cpuTotalMs.p95),
    cpuStepMsP95,
    gpuRenderMsP50: measured ? medOf((s) => s.gpu.renderMs.p50) : null,
    gpuRenderMsP95: measured ? medOf((s) => s.gpu.renderMs.p95) : null,
    drawCalls: medOf((s) => s.render.drawCalls),
    triangles: medOf((s) => s.render.triangles),
    gpuMemoryBytes: Math.max(...snapshots.map((s) => s.render.gpuMemoryBytes)),
    jsHeapBytes: heaps.length === 0 ? null : Math.max(...heaps),
    pipelinesAfterWarmup: last.render.pipelinesAfterWarmup,
    lossCount: last.render.lossCount,
  };
}

/** Default scripted camera path: a slow orbit (radius 14 m, height 5 m) around the origin, one lap per minute. */
export const ORBIT_PATH_ID = "orbit-v0";
export function orbitPath(laps = 1, seconds = 60): { loop: boolean; keys: unknown[] } {
  const keys: unknown[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 * laps;
    keys.push({
      t: (i / steps) * seconds,
      position: [Math.cos(a) * 14, 5, Math.sin(a) * 14],
      target: [0, 1, 0],
    });
  }
  return { loop: true, keys };
}
