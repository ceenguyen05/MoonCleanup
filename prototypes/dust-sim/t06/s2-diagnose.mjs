// T06: is the S2 "1 in 4" worst-frame failure of P2 a property of the workload or of the machine?
// Runs harness S2 N times with P2_FRAME_TRACE and samples the total CPU load every second while each run is alive.
// For every run: the worst frame (index, ms, deterministic rebuild work, overlapping GC pause) and the time per unit
// of rebuild work. A real stall repeats at the same frame index with the largest work; a flake moves and has ordinary
// work.
//   node prototypes/dust-sim/t06/s2-diagnose.mjs [runs=5] [tag=s2-diagnosis]      (repo root, Node 26)
import { spawnSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const dust = path.join(root, "prototypes/dust-sim");
const runs = Number(process.argv[2] ?? 5);
const tag = process.argv[3] ?? "s2-diagnosis";
const out = path.join(dust, "results/t06", tag);
mkdirSync(out, { recursive: true });
void spawnSync;

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.idle + c.times.user + c.times.sys + c.times.irq + c.times.nice;
  }
  return { idle, total };
}

function runOnce(i) {
  return new Promise((resolve) => {
    const traceFile = path.join(out, `trace-${i}.json`);
    const loads = [];
    let prev = cpuTimes();
    const timer = setInterval(() => {
      const now = cpuTimes();
      const dt = now.total - prev.total;
      if (dt > 0) loads.push(100 * (1 - (now.idle - prev.idle) / dt));
      prev = now;
    }, 1000);
    const a = "p2-stroke-atlas-ledger";
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(dust, "harness/src/cli.ts"),
        "run",
        "--adapter",
        path.join(dust, a, "harness-adapter.ts"),
        "--grid",
        path.join(dust, a, "grid.ts"),
        "--results",
        path.join(out, `run-${i}`),
        "--tier",
        "floor",
        "--scenarios",
        "S2",
      ],
      { cwd: path.join(root, "tools/bots"), env: { ...process.env, P2_FRAME_TRACE: traceFile }, stdio: "ignore" },
    );
    child.on("exit", () => {
      clearInterval(timer);
      const t = JSON.parse(readFileSync(traceFile, "utf8"));
      const W = 5;
      const n = t.trace.length / W;
      const frames = [];
      for (let k = 0; k < n; k++) {
        frames.push({
          i: k,
          t0: t.trace[k * W],
          cpuMs: t.trace[k * W + 1],
          rebuildMs: t.trace[k * W + 2],
          rebuilds: t.trace[k * W + 3],
          work: t.trace[k * W + 4],
        });
      }
      const gcOver = (f) => {
        let ms = 0;
        for (let g = 0; g < t.gcs.length; g += 2) {
          const s = t.gcs[g];
          const e = s + t.gcs[g + 1];
          if (e >= f.t0 && s <= f.t0 + f.cpuMs) ms += t.gcs[g + 1];
        }
        return ms;
      };
      const reb = frames.filter((f) => f.rebuilds > 0 && f.work > 0);
      const perWork = reb.map((f) => (f.rebuildMs * 1e6) / f.work).sort((x, y) => x - y);
      const med = perWork[Math.floor(perWork.length / 2)] ?? 0;
      const top = [...frames].sort((x, y) => y.cpuMs - x.cpuMs).slice(0, 5);
      const maxWork = frames.reduce((m, f) => Math.max(m, f.work), 0);
      const maxWorkFrame = frames.find((f) => f.work === maxWork);
      let workHash = 0;
      for (const f of frames) workHash = (Math.imul(workHash, 31) + f.work + f.rebuilds * 7919) | 0;
      const sortedLoad = [...loads].sort((x, y) => x - y);
      const row = {
        run: i,
        frames: n,
        loadMeanPct: +(loads.reduce((s, v) => s + v, 0) / Math.max(1, loads.length)).toFixed(1),
        loadMaxPct: +(sortedLoad[sortedLoad.length - 1] ?? 0).toFixed(1),
        worstFrameIndex: top[0].i,
        worstFrameMs: +top[0].cpuMs.toFixed(2),
        worstOverTarget: +(top[0].cpuMs / (1000 / 60)).toFixed(2),
        worstFrameWork: top[0].work,
        worstFrameRebuilds: top[0].rebuilds,
        worstFrameGcMs: +gcOver(top[0]).toFixed(2),
        maxWork,
        maxWorkFrameIndex: maxWorkFrame?.i ?? -1,
        maxWorkFrameMs: +(maxWorkFrame?.cpuMs ?? 0).toFixed(2),
        medianNsPerWorkUnit: +med.toFixed(1),
        worstFrameNsPerWorkUnit: top[0].work > 0 ? +((top[0].rebuildMs * 1e6) / top[0].work).toFixed(1) : null,
        expectedWorstMsAtMedianRate: +((maxWork * med) / 1e6).toFixed(2),
        gcCount: t.gcs.length / 2,
        gcMaxMs: +Math.max(0, ...t.gcs.filter((_, k) => k % 2 === 1)).toFixed(2),
        top5: top.map((f) => `#${f.i}: ${f.cpuMs.toFixed(2)} ms, work ${f.work}, gc ${gcOver(f).toFixed(2)} ms`),
        workSeriesHash: workHash,
      };
      resolve(row);
    });
  });
}

const rows = [];
for (let i = 1; i <= runs; i++) {
  const r = await runOnce(i);
  rows.push(r);
  console.log(JSON.stringify(r));
}
const sameWork = rows.every((r) => r.workSeriesHash === rows[0].workSeriesHash);
const summary = {
  runs,
  workSeriesIdenticalAcrossRuns: sameWork,
  worstFrameIndices: rows.map((r) => r.worstFrameIndex),
  worstOverTarget: rows.map((r) => r.worstOverTarget),
  maxWorkFrameIndex: rows[0].maxWorkFrameIndex,
  rows,
};
writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ sameWork, worstIdx: summary.worstFrameIndices, worstX: summary.worstOverTarget }));
