import type { RobotPlotIntent, StrokeRecord } from "@moon-cleanup/shared";
import { describe, expect, test } from "vitest";
import { P1Client } from "../src/client";
import {
  L0_DEFAULT,
  PLOTS_MAX_RECORDS,
  ROBOT_MESSAGE_BYTES,
  STATE_GRIMY,
  STATE_OPENED,
  STATE_POLISHED,
} from "../src/l0";
import { DetailRing } from "../src/ring";
import {
  P1Server,
  REJECT_OUT_OF_REACH,
  REJECT_RATE_EXCEEDED,
  REJECT_SEGMENT_TOO_LONG,
  REJECT_TOOL_NOT_EQUIPPED,
  STROKE_OK,
  type MessageSink,
} from "../src/server";
import { Dissolve, plotSeed } from "../src/visual";
import { GOLDEN, GOLDEN_PLOT_COUNT, goldenStrokes, mulberry32, runGolden } from "./golden";

const OPTIONS = { plotCount: GOLDEN_PLOT_COUNT, radiusM: 2000, simTickHz: 20 };
const none: MessageSink = () => undefined;
const stroke = (over: Partial<StrokeRecord> = {}): StrokeRecord => ({
  anchor: 500 as StrokeRecord["anchor"],
  startUMm: 0,
  startVMm: 0,
  endUMm: 1000,
  endVMm: 0,
  widthCm: 60,
  depth16: 80,
  toolCode: 1,
  tick: 1 as StrokeRecord["tick"],
  actorSlot: 0,
  inputSeq: 1,
  ...over,
});
const stateOf = (s: P1Server, plot: number): number => ((s.l0[plot] ?? 0) >>> 8) & 3;
const fracOf = (s: P1Server, plot: number): number => (s.l0[plot] ?? 0) & 0xff;

describe("P1 core", () => {
  test("golden scenario (Node recording)", () => {
    const g = runGolden();
    expect(g).toEqual(GOLDEN);
    expect(g.earlyClientHash).toBe(g.serverHash);
    expect(g.lateClientHash).toBe(g.serverHash);
  });

  test("L0 bytes do not depend on stroke order", () => {
    const strokes = goldenStrokes(3000, 77);
    const a = new P1Server(OPTIONS);
    for (const s of strokes) a.submitStroke(s, none);
    const rng = mulberry32(5);
    for (let round = 0; round < 5; round++) {
      const shuffled = [...strokes];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j] as StrokeRecord, shuffled[i] as StrokeRecord];
      }
      const b = new P1Server(OPTIONS);
      for (const s of shuffled) expect(b.submitStroke(s, none)).toBe(STROKE_OK);
      expect(b.hash[0]).toBe(a.hash[0]);
      expect(b.removed).toEqual(a.removed);
    }
  });

  test("thresholds: Opened at 0.1 % removed, Polished at 1 % left, monotonic", () => {
    const s = new P1Server(OPTIONS);
    const cap = s.capacityOf(500);
    const perStroke = Math.floor((1000 * 60 * 80) / 16);
    let tick = 0;
    let last = L0_DEFAULT & 0xff;
    let state: number = STATE_GRIMY;
    let opened = -1;
    let polished = -1;
    while (polished < 0) {
      tick++;
      expect(s.submitStroke(stroke({ tick: tick as StrokeRecord["tick"] }), none)).toBe(STROKE_OK);
      const st = stateOf(s, 500);
      expect(fracOf(s, 500)).toBeLessThanOrEqual(last);
      expect(st).toBeGreaterThanOrEqual(state);
      last = fracOf(s, 500);
      state = st;
      if (st === STATE_OPENED && opened < 0) opened = tick;
      if (st === STATE_POLISHED) polished = tick;
    }
    expect(opened).toBe(Math.ceil(Math.ceil(cap / 1000) / perStroke));
    expect(polished).toBe(Math.ceil((cap - Math.floor(cap / 100)) / perStroke));
    expect(fracOf(s, 500)).toBe(0);
    // One Highland plot at Depth 5 needs its own area swept once (design meaning of Depth); mean plot 306.8 m^2.
    const sweptShare = (polished * 1.0 * 0.6) / 306.8;
    expect(sweptShare).toBeGreaterThan(0.98);
    expect(sweptShare).toBeLessThan(1.0);
    // The residual is never paid: at most 99 % of the plot mass is collected (95.1 kg mean Highland plot).
    expect(s.gramsOf(0)).toBeLessThanOrEqual(95_108 * 0.99);
    expect(s.gramsOf(0)).toBeGreaterThan(95_108 * 0.98);
  });

  test("every tool reaches Polished: a stroke removes at least one unit", () => {
    const s = new P1Server(OPTIONS);
    s.submitStroke(stroke({ startUMm: 999, widthCm: 1, depth16: 1 }), none);
    expect(s.removed[500]).toBe(1);
  });

  test("known weakness: re-scrubbing one line scores exactly like sweeping fresh lanes", () => {
    const rescrub = new P1Server(OPTIONS);
    const fresh = new P1Server(OPTIONS);
    for (let k = 1; k <= 200; k++) {
      rescrub.submitStroke(stroke({ tick: k as StrokeRecord["tick"] }), none);
      fresh.submitStroke(stroke({ tick: k as StrokeRecord["tick"], startVMm: k * 50, endVMm: k * 50 }), none);
    }
    expect(rescrub.removed[500]).toBeGreaterThan(0);
    expect(rescrub.removed[500]).toBe(fresh.removed[500]);
    expect(rescrub.gramsOf(0)).toBe(fresh.gramsOf(0));
  });

  test("reject reasons", () => {
    const s = new P1Server(OPTIONS);
    const outside = stroke({ anchor: GOLDEN_PLOT_COUNT as StrokeRecord["anchor"] });
    expect(s.submitStroke(outside, none)).toBe(REJECT_OUT_OF_REACH);
    expect(s.submitStroke(stroke({ endUMm: 12_801 }), none)).toBe(REJECT_OUT_OF_REACH);
    expect(s.submitStroke(stroke({ widthCm: 0 }), none)).toBe(REJECT_TOOL_NOT_EQUIPPED);
    expect(s.submitStroke(stroke({ actorSlot: 64 }), none)).toBe(REJECT_TOOL_NOT_EQUIPPED);
    expect(s.submitStroke(stroke({ startUMm: -3001 }), none)).toBe(REJECT_SEGMENT_TOO_LONG);
    expect(s.submitStroke(stroke({ endUMm: Number.NaN }), none)).toBe(REJECT_OUT_OF_REACH);
    expect(s.removed[500]).toBe(0);
    expect(s.submitStroke(stroke(), none)).toBe(STROKE_OK);
    expect(s.submitStroke(stroke(), none)).toBe(REJECT_RATE_EXCEEDED);
    expect(s.submitStroke(stroke({ toolCode: 2 }), none)).toBe(STROKE_OK);
  });

  test("clients mirror the server through deltas and both snapshot formats", () => {
    const s = new P1Server(OPTIONS);
    const c = new P1Client(GOLDEN_PLOT_COUNT);
    let messages = 0;
    let malformed = 0;
    let longest = 0;
    const sink: MessageSink = (b, n) => {
      messages++;
      if (n > longest) longest = n;
      if (!c.receive(b, n)) malformed++;
    };
    // Sparse: a handful of scattered touched plots (isolated plots cost less as 4 B records than as runs).
    for (let k = 1; k <= 40; k++) {
      for (let n = 1; n <= 30; n++) {
        const at = { anchor: (k * 997) as StrokeRecord["anchor"], tick: n as StrokeRecord["tick"] };
        s.submitStroke(stroke({ ...at, widthCm: 300 }), sink);
      }
    }
    s.flushPlots(sink);
    expect(c.hash[0]).toBe(s.hash[0]);
    let snap = s.encodeSnapshot();
    expect(snap[0]).toBe(4);
    const sparseJoin = new P1Client(GOLDEN_PLOT_COUNT);
    expect(sparseJoin.receive(snap, snap.length)).toBe(true);
    expect(sparseJoin.hash[0]).toBe(s.hash[0]);
    // Run-length: 20,000 consecutive plots polished by Charge discs (more than one delta message per flush).
    const disc = { widthCm: 1023, depth16: 255, startUMm: 1000 };
    for (let p = 30_000; p < 50_000; p++) {
      for (let k = 2; stateOf(s, p) !== STATE_POLISHED; k++) {
        s.submitStroke(stroke({ ...disc, anchor: p as StrokeRecord["anchor"], tick: k as StrokeRecord["tick"] }), sink);
      }
    }
    s.flushPlots(sink);
    expect(malformed).toBe(0);
    expect(longest).toBeLessThanOrEqual(4096);
    expect(messages).toBeGreaterThan(20_000 / PLOTS_MAX_RECORDS);
    expect(c.hash[0]).toBe(s.hash[0]);
    expect(c.nonDefaultCount).toBe(s.nonDefaultCount);
    snap = s.encodeSnapshot();
    expect(snap[0]).toBe(5);
    expect(snap.length).toBeLessThan(1000);
    const rleJoin = new P1Client(GOLDEN_PLOT_COUNT);
    expect(rleJoin.receive(snap, snap.length)).toBe(true);
    expect(rleJoin.l0).toEqual(c.l0);
    expect(rleJoin.hash[0]).toBe(s.hash[0]);
    expect(rleJoin.receive(snap.subarray(0, snap.length - 1), snap.length - 1)).toBe(false);
  });

  test("checkpoint round trip, dirty flag and corruption", () => {
    const s = new P1Server(OPTIONS);
    for (const st of goldenStrokes(4000, 9)) s.submitStroke(st, none);
    for (let k = 0; k < 37; k++) s.step(none);
    expect(s.checkpointDirty).toBe(true);
    const bytes = s.encodeCheckpoint();
    expect(s.checkpointDirty).toBe(false);
    const r = new P1Server(OPTIONS);
    expect(r.restore(bytes)).toBe(true);
    expect(r.tick).toBe(37);
    expect(r.hash[0]).toBe(s.hash[0]);
    expect(r.removed).toEqual(s.removed);
    expect(r.l0.map((v) => v & 0x3ff)).toEqual(s.l0.map((v) => v & 0x3ff));
    expect(r.actorMicrograms).toEqual(s.actorMicrograms);
    expect(r.nonDefaultCount).toBe(s.nonDefaultCount);
    // Both continue identically (no robots in flight).
    for (const st of goldenStrokes(1000, 10)) {
      s.submitStroke(st, none);
      r.submitStroke(st, none);
    }
    expect(r.hash[0]).toBe(s.hash[0]);
    expect(r.removed).toEqual(s.removed);
    // A flipped snapshot byte fails the stored hash; a truncated file fails the length checks.
    const flipped = bytes.slice();
    const snapshotStart = 13 + 64 * 8 + 4;
    flipped[snapshotStart + 9] = (flipped[snapshotStart + 9] ?? 0) ^ 1;
    expect(new P1Server(OPTIONS).restore(flipped)).toBe(false);
    expect(new P1Server(OPTIONS).restore(bytes.subarray(0, 100))).toBe(false);
    expect(new P1Server(OPTIONS).restore(bytes.subarray(0, bytes.length - 8))).toBe(false);
  });

  test("robot plot: 21 B intent, one chunk per second, plot share of the frame", () => {
    const s = new P1Server(OPTIONS);
    const intent: RobotPlotIntent = {
      robotId: 7,
      plotId: 900 as RobotPlotIntent["plotId"],
      startTick: 0 as RobotPlotIntent["startTick"],
      widthCm: 200,
      depth16: 80,
      speedCmPerS: 100,
      laneMask: [0x1fff, 0],
    };
    let bytes = 0;
    const sink: MessageSink = (_b, n) => {
      bytes = n;
    };
    expect(s.submitRobotIntent(intent, sink)).toBe(ROBOT_MESSAGE_BYTES);
    expect(bytes).toBe(ROBOT_MESSAGE_BYTES);
    for (let k = 0; k < 19; k++) s.step(none);
    expect(s.removed[900]).toBe(0);
    s.step(none);
    expect(s.robotChunks).toBe(1);
    expect(s.removed[900]).toBeGreaterThan(0);
    // 13 lanes x 25.6 m at 1 m/s = 333 chunks; 13 x 2 m lanes cover the frame once, so the plot ends Polished.
    for (let k = 0; k < 20 * 340; k++) s.step(none);
    expect(s.robotChunks).toBe(333);
    expect(stateOf(s, 900)).toBe(STATE_POLISHED);
    expect(s.gramsOf(63)).toBeGreaterThan(90_000);
  });
});

describe("P1 visuals (CPU reference)", () => {
  const frame = {
    normal: { x: 1, y: 0, z: 0 },
    east: { x: 0, y: 0, z: -1 },
    north: { x: 0, y: 1, z: 0 },
  } as Parameters<DetailRing["drawStroke"]>[0];

  test("ring: a stroke is crisp to one texel and is lost when it scrolls out", () => {
    const ring = new DetailRing(1024, 35, 2000);
    ring.centerOn(1, 0, 0);
    const written = ring.drawStroke(frame, stroke({ endUMm: 2000, widthCm: 60 }), 1);
    expect(written).toBeGreaterThan((2000 / 35) * (600 / 35));
    const at = (uM: number, vM: number): number => {
      const l = Math.hypot(1, vM / 2000, uM / 2000);
      return ring.sweptAt(1 / l, vM / 2000 / l, -uM / 2000 / l);
    };
    expect(at(1, 0)).toBe(1);
    expect(at(1, 0.25)).toBe(1);
    expect(at(1, 0.36)).toBe(0);
    expect(at(1, -0.36)).toBe(0);
    expect(at(-0.4, 0)).toBe(0);
    // The same stroke again saturates (order-free).
    ring.drawStroke(frame, stroke({ endUMm: 2000, widthCm: 60 }), 0.5);
    expect(at(1, 0)).toBe(1);
    // Walk 30 m east (the ring is 35.8 m wide): the stroke leaves the window; walking back does not bring it back.
    const east = (m: number): [number, number, number] => {
      const l = Math.hypot(1, m / 2000);
      return [1 / l, 0, -m / 2000 / l];
    };
    for (let m = 0; m <= 30; m += 0.5) ring.centerOn(...east(m));
    for (let m = 30; m >= 0; m -= 0.5) ring.centerOn(...east(m));
    expect(at(1, 0)).toBe(0);
    expect(ring.texels.some((v) => v !== 0)).toBe(false);
  });

  test("ring: content survives a re-anchor beyond 100 m", () => {
    const ring = new DetailRing(1024, 35, 2000);
    const north = (m: number): [number, number, number] => {
      const l = Math.hypot(1, m / 2000);
      return [1 / l, m / 2000 / l, 0];
    };
    ring.centerOn(...north(0));
    for (let m = 1; m <= 99; m++) ring.centerOn(...north(m));
    ring.drawStroke(frame, stroke({ startUMm: 0, startVMm: 99_000, endUMm: 1000, endVMm: 99_000 }), 1);
    const probe = (): number => {
      const l = Math.hypot(1, 99 / 2000, 0.5 / 2000);
      return ring.sweptAt(1 / l, 99 / 2000 / l, -0.5 / 2000 / l);
    };
    expect(probe()).toBe(1);
    ring.centerOn(...north(101));
    ring.centerOn(...north(102));
    expect(probe()).toBe(1);
  });

  test("dissolve: dusty area share follows the L0 fraction and only shrinks", () => {
    const d = new Dissolve();
    const seed = plotSeed(4242);
    const n = 20_000;
    const rng = mulberry32(11);
    const pts = new Float64Array(n * 3);
    for (let k = 0; k < n * 3; k++) pts[k] = 1500 + rng() * 40;
    let previous = new Uint8Array(n).fill(1);
    let shrinkViolations = 0;
    for (const frac of [255, 191, 128, 64, 13, 0]) {
      const now = new Uint8Array(n);
      let dusty = 0;
      for (let k = 0; k < n; k++) {
        const c = d.coverage(pts[k * 3] ?? 0, pts[k * 3 + 1] ?? 0, pts[k * 3 + 2] ?? 0, frac, seed, 1e-6);
        const bit = c > 0.5 ? 1 : 0;
        now[k] = bit;
        dusty += bit;
        if (bit > (previous[k] ?? 0)) shrinkViolations++;
      }
      previous = now;
      // Within 8 points of R on one 40 m cube of samples (it holds only about 20 noise cells per axis).
      expect(Math.abs(dusty / n - frac / 255)).toBeLessThan(0.08);
    }
    expect(shrinkViolations).toBe(0);
  });
});
