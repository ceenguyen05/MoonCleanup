// Golden scenario of the P1 core, shared by the Node lane (p1.test.ts) and the browser lane (golden.browser.test.ts).
// It imports only the import-free core files, so the same code runs in any engine with no bundler configuration.
import type { PlotFrame, RobotPlotIntent, StrokeRecord } from "@moon-cleanup/shared";
import { P1Client } from "../src/client";
import { DetailRing } from "../src/ring";
import { P1Server, STROKE_OK, type MessageSink } from "../src/server";

export const GOLDEN_PLOT_COUNT = 163_842;
export const GOLDEN_SEED = 0x50314731;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fnv(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ (bytes[i] ?? 0), 0x01000193);
  return h >>> 0;
}

/** Seeded strokes over `plots` consecutive plots from `firstPlot`; every stroke has its own tick. */
export function goldenStrokes(count: number, seed: number, firstPlot = 1000, plots = 64): StrokeRecord[] {
  const rng = mulberry32(seed);
  const out: StrokeRecord[] = [];
  const widths = [15, 60, 120, 300, 1023];
  const depths = [16, 32, 48, 80, 255];
  for (let k = 0; k < count; k++) {
    const eu = Math.round((rng() - 0.5) * 20_000);
    const ev = Math.round((rng() - 0.5) * 20_000);
    const disc = rng() < 0.05;
    out.push({
      anchor: (firstPlot + Math.floor(rng() * plots)) as StrokeRecord["anchor"],
      startUMm: disc ? eu : eu + Math.round((rng() - 0.5) * 4000),
      startVMm: disc ? ev : ev + Math.round((rng() - 0.5) * 4000),
      endUMm: eu,
      endVMm: ev,
      widthCm: widths[Math.floor(rng() * widths.length)] ?? 60,
      depth16: depths[Math.floor(rng() * depths.length)] ?? 16,
      toolCode: 1 + Math.floor(rng() * 6),
      tick: (k + 1) as StrokeRecord["tick"],
      actorSlot: Math.floor(rng() * 6),
      inputSeq: (k + 1) & 0xffff,
    });
  }
  return out;
}

export interface GoldenResult {
  readonly serverHash: number;
  readonly earlyClientHash: number;
  readonly lateClientHash: number;
  readonly restoredHash: number;
  readonly nonDefault: number;
  readonly accepted: number;
  readonly removedFnv: number;
  readonly checkpointFnv: number;
  readonly snapshotFnv: number;
  readonly grams: number;
  readonly earlyBytes: number;
  readonly ringFnv: number;
}

/**
 * 6,000 strokes, 40 robot plots, an early and a late client, a checkpoint at two thirds restored into a twin.
 * The hash of the twin differs from the server hash on purpose: robot jobs in flight are not part of a P1 checkpoint.
 */
export function runGolden(): GoldenResult {
  const options = { plotCount: GOLDEN_PLOT_COUNT, radiusM: 2000, simTickHz: 20 };
  const server = new P1Server(options);
  let twin: P1Server | null = null;
  const early = new P1Client(GOLDEN_PLOT_COUNT);
  let late: P1Client | null = null;
  const sink: MessageSink = (b, n) => {
    early.receive(b, n);
    late?.receive(b, n);
  };
  const none: MessageSink = () => undefined;
  const strokes = goldenStrokes(6000, GOLDEN_SEED);
  const rng = mulberry32(GOLDEN_SEED ^ 0x0b07);
  let accepted = 0;
  let checkpointFnv = 0;
  for (let k = 0; k < strokes.length; k++) {
    const s = strokes[k] as StrokeRecord;
    if (server.submitStroke(s, sink) === STROKE_OK) accepted++;
    twin?.submitStroke(s, none);
    if (k % 150 === 0) {
      const intent: RobotPlotIntent = {
        robotId: (k / 150) % 8,
        plotId: (2000 + Math.floor(rng() * 16)) as RobotPlotIntent["plotId"],
        startTick: server.tick as RobotPlotIntent["startTick"],
        widthCm: 140,
        depth16: 32,
        speedCmPerS: 90,
        laneMask: [0x0007_ffff, 0],
      };
      server.submitRobotIntent(intent, sink);
      twin?.submitRobotIntent(intent, none);
    }
    if (k % 3 === 0) {
      server.step(sink);
      server.flushPlots(sink);
      twin?.step(none);
    }
    if (k === 3000) {
      late = new P1Client(GOLDEN_PLOT_COUNT);
      const snap = server.encodeSnapshot();
      late.receive(snap, snap.length);
    }
    if (k === 4000) {
      const bytes = server.encodeCheckpoint();
      checkpointFnv = fnv(bytes);
      twin = new P1Server(options);
      if (!twin.restore(bytes)) throw new Error("golden checkpoint did not restore");
    }
  }
  server.flushPlots(sink);
  const snapshot = server.encodeSnapshot();

  // Ring: three strokes in a synthetic frame at lat 0 lon 0, then a scroll that drops part of the first one.
  const frame = {
    normal: { x: 1, y: 0, z: 0 },
    east: { x: 0, y: 0, z: -1 },
    north: { x: 0, y: 1, z: 0 },
  } as PlotFrame;
  const ring = new DetailRing(256, 35, 2000);
  ring.centerOn(1, 0, 0);
  for (const s of goldenStrokes(3, GOLDEN_SEED ^ 0x21, 0, 1)) {
    ring.drawStroke(frame, { ...s, endUMm: s.endUMm / 4, endVMm: s.endVMm / 4, startUMm: 0, startVMm: 0 }, 0.6);
  }
  const l = Math.hypot(1, 0.0005, 0.001);
  ring.centerOn(1 / l, 0.0005 / l, 0.001 / l);

  return {
    serverHash: server.hash[0] ?? 0,
    earlyClientHash: early.hash[0] ?? 0,
    lateClientHash: late?.hash[0] ?? 0,
    restoredHash: twin?.hash[0] ?? 0,
    nonDefault: server.nonDefaultCount,
    accepted,
    removedFnv: fnv(new Uint8Array(server.removed.buffer)),
    checkpointFnv,
    snapshotFnv: fnv(snapshot.subarray(9)),
    grams: server.gramsOf(0) + server.gramsOf(63),
    earlyBytes: early.bytesReceived,
    ringFnv: fnv(ring.texels),
  };
}

/** Recorded on Node 26.13.1 (V8); the browser lane must reproduce every number. */
export const GOLDEN: GoldenResult = {
  serverHash: 2850645489,
  earlyClientHash: 2850645489,
  lateClientHash: 2850645489,
  restoredHash: 1251689156,
  nonDefault: 80,
  accepted: 6000,
  removedFnv: 3800034557,
  checkpointFnv: 425265144,
  snapshotFnv: 3188565808,
  grams: 1111320,
  earlyBytes: 20481,
  ringFnv: 2944845389,
};
