// Node benchmark of the P1 hot calls: ns per call and heap bytes per call (v8 total_allocated_bytes delta after
// warm-up, the method of packages/world/bench). Run from tools/bots with Node 26:
//   node --import tsx ../../prototypes/dust-sim/p1-scalar-procedural/bench/p1-bench.ts
import { getHeapStatistics } from "node:v8";
import type { PlotFrame, RobotPlotIntent, StrokeRecord } from "@moon-cleanup/shared";
import { P1Client } from "../src/client";
import { DetailRing } from "../src/ring";
import { P1Server, type MessageSink } from "../src/server";
import { GOLDEN_PLOT_COUNT, goldenStrokes } from "../test/golden";

const allocated = (): number => getHeapStatistics().total_allocated_bytes;
const rows: { name: string; ns: number; bytes: number }[] = [];
const sinkWord = new Int32Array(1);

// Best of 5 measured rounds: background allocation (JIT, tsx, timers) only ever adds, so the minimum is the estimate.
function bench(name: string, calls: number, fn: (k: number) => number): void {
  for (let w = 0; w < 3; w++) for (let k = 0; k < calls; k++) sinkWord[0] = (sinkWord[0] ?? 0) ^ fn(k);
  let ns = Infinity;
  let bytes = Infinity;
  for (let round = 0; round < 5; round++) {
    const a0 = allocated();
    const t0 = performance.now();
    for (let k = 0; k < calls; k++) sinkWord[0] = (sinkWord[0] ?? 0) ^ fn(k);
    const t1 = performance.now();
    ns = Math.min(ns, ((t1 - t0) * 1e6) / calls);
    bytes = Math.min(bytes, (allocated() - a0) / calls);
  }
  rows.push({ name, ns, bytes });
}

const options = { plotCount: GOLDEN_PLOT_COUNT, radiusM: 2000, simTickHz: 20 };
// 4,096 strokes over 4,096 plots: the plots never polish during the run, so every call does the full removal path.
const strokes = goldenStrokes(4096, 1, 20_000, 4096).map((s, k) => ({ ...s, widthCm: 60, depth16: 16, tick: k }));
const clients = Array.from({ length: 6 }, () => new P1Client(GOLDEN_PLOT_COUNT));
const broadcast: MessageSink = (b, n) => {
  for (let i = 0; i < clients.length; i++) clients[i]?.receive(b, n);
};
const none: MessageSink = () => undefined;

{
  const server = new P1Server(options);
  bench("server.submitStroke (accepted, removal)", 400_000, (k) =>
    server.submitStroke(strokes[k & 4095] as StrokeRecord, none),
  );
}
{
  const server = new P1Server(options);
  bench("tick: 6 strokes + step + flushPlots to 6 clients", 100_000, (k) => {
    for (let b = 0; b < 6; b++) server.submitStroke(strokes[(k * 6 + b) & 4095] as StrokeRecord, broadcast);
    server.step(broadcast);
    server.flushPlots(broadcast);
    return 0;
  });
}
{
  const server = new P1Server(options);
  for (let id = 0; id < 400; id++) {
    const intent: RobotPlotIntent = {
      robotId: id,
      plotId: (60_000 + id) as RobotPlotIntent["plotId"],
      startTick: (id % 20) as RobotPlotIntent["startTick"],
      widthCm: 140,
      depth16: 32,
      speedCmPerS: 1,
      laneMask: [0xffff_ffff, 0xffff_ffff],
    };
    server.submitRobotIntent(intent, none);
  }
  bench("server.step with 400 robot jobs (20 chunks per tick)", 100_000, () => {
    server.step(broadcast);
    server.flushPlots(broadcast);
    return 0;
  });
}
{
  const server = new P1Server(options);
  for (const s of goldenStrokes(6000, 2)) server.submitStroke(s, none);
  let n = 0;
  bench("encodeSnapshot (cold, 163,842 plots)", 300, () => {
    server.version++;
    n = server.encodeSnapshot().length;
    return n;
  });
  bench("encodeCheckpoint (allocates its result)", 300, () => server.encodeCheckpoint().length);
  const bytes = server.encodeCheckpoint();
  bench("restore", 300, () => (server.restore(bytes) ? 1 : 0));
}
{
  const frame = {
    normal: { x: 1, y: 0, z: 0 },
    east: { x: 0, y: 0, z: -1 },
    north: { x: 0, y: 1, z: 0 },
  } as PlotFrame;
  const ring = new DetailRing(1024, 35, 2000);
  ring.centerOn(1, 0, 0);
  const duster = { ...(strokes[0] as StrokeRecord), startUMm: 0, startVMm: 0, endUMm: 75, endVMm: 0, widthCm: 60 };
  const bulldust = { ...duster, endUMm: 1000, widthCm: 300 };
  bench("ring.drawStroke Desk Duster (7.5 cm x 60 cm)", 200_000, () => ring.drawStroke(frame, duster, 0.2));
  bench("ring.drawStroke Bulldust (1 m x 3 m)", 20_000, () => ring.drawStroke(frame, bulldust, 0.6));
  // The walked distance lives in a typed array: a captured `let` double would be re-boxed on every assignment.
  const walked = new Float64Array(1);
  bench("ring.centerOn walking 2.5 cm per frame", 400_000, () => {
    const m = (walked[0] ?? 0) + 0.025;
    walked[0] = m;
    const l = Math.sqrt(1 + (m / 2000) * (m / 2000));
    ring.centerOn(1 / l, 0, -m / 2000 / l);
    return 0;
  });
}

console.log("| call | ns/call | B/call |\n| --- | ---: | ---: |");
for (const r of rows) console.log(`| ${r.name} | ${r.ns.toFixed(0)} | ${r.bytes.toFixed(2)} |`);
