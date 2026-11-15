import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { ANIM_EVENT, AnimEventQueue } from "./anim-events";
import { AvatarAnimInput, AvatarAnimator, RemoteVelocityEstimator } from "./avatar-animator";
import { batchedGround, type AnimGround } from "./foot-ik";
import { AnimationModule, bucketFor, shouldUpdate } from "./module";
import { BASE } from "./state-machine";
import { ToolLayer, crossed, strokeCurve } from "./tool-layer";
import { TOOL_CLASS, toolClassOf } from "./tuning";

const R = 2000;
const flat: AnimGround = batchedGround({ heightAtXYZ: () => 0 });
/** Natively batched (like packages/world GroundHeight.heightsAt), so the alloc probe measures the animator only. */
const bumpy: AnimGround = {
  heightsAt(dirs: Float64Array, out: Float64Array, n: number): void {
    for (let i = 0; i < n; i++) out[i] = 0.3 * Math.sin(dirs[i * 3]! * R * 0.7) * Math.cos(dirs[i * 3 + 2]! * R * 0.5);
  },
};

describe("tool layer (phase-locked to the sim)", () => {
  it("stroke curve mirrors the sim head path: 0 at phase 0, 1 at contact end, back to 0", () => {
    expect(strokeCurve(0, 0.7)).toBe(0);
    expect(strokeCurve(0.7, 0.7)).toBeCloseTo(1);
    expect(strokeCurve(0.35, 0.7)).toBeCloseTo(0.5);
    expect(strokeCurve(0.9999, 0.7)).toBeCloseTo(0, 3);
  });
  it("crossed() handles wrap", () => {
    expect(crossed(0.6, 0.75, 0.7)).toBe(true);
    expect(crossed(0.95, 0.05, 0)).toBe(true);
    expect(crossed(0.95, 0.05, 0.7)).toBe(false);
    expect(crossed(0.1, 0.2, 0.7)).toBe(false);
  });
  it("reversal events exactly at the sim reversals, body leads by ~100 ms, sweep weight ramps 120 ms", () => {
    const t = new ToolLayer();
    const period = 0.9;
    const dt = 1 / 60;
    let turns = 0;
    let firstTurnPhase = -1;
    let weightAfter = 0;
    for (let i = 0; i < 120; i++) {
      const phase = ((i * dt) / period) % 1;
      t.update(TOOL_CLASS.broom, true, phase, period, 0.7, true, dt);
      if (i === 7) weightAfter = t.sweepWeight;
      if (t.turn !== 0) {
        turns++;
        if (firstTurnPhase < 0) firstTurnPhase = phase;
      }
      // Body reach equals the head curve 100 ms in the future.
      expect(t.bodyReach).toBeCloseTo(strokeCurve(phase + 0.1 / period, 0.7), 9);
    }
    expect(weightAfter).toBe(1);
    expect(firstTurnPhase).toBeGreaterThanOrEqual(0.7);
    expect(firstTurnPhase).toBeLessThan(0.7 + 1 / 60 / period + 1e-9);
    // 2 s of a 0.9 s cycle: ~2.2 cycles -> 4 reversals.
    expect(turns).toBe(4);
  });
  it("tool up fades the sweep in 150 ms and drops twist; palm wobble only on palm", () => {
    const t = new ToolLayer();
    for (let i = 0; i < 20; i++) t.update(TOOL_CLASS.palm, true, i / 40, 0.9, 0.7, true, 1 / 60);
    expect(Math.hypot(t.wobbleX, t.wobbleZ)).toBeCloseTo(0.03, 6);
    for (let i = 0; i < 10; i++) t.update(TOOL_CLASS.palm, false, 0, 0.9, 0.7, false, 1 / 60);
    expect(t.sweepWeight).toBe(0);
    expect(Math.abs(t.twist)).toBe(0);
    expect(toolClassOf("tool.lane_broom")).toBe(TOOL_CLASS.bar);
  });
});

function input(): AvatarAnimInput {
  const i = new AvatarAnimInput();
  i.pos.set([0, R, 0]);
  i.facing.set([0, 0, 1]);
  return i;
}

describe("avatar animator", () => {
  it("walking at 3.4 m/s: walk node, cadence 2 steps/s, alternating footfall events", () => {
    const q = new AnimEventQueue(64);
    const a = new AvatarAnimator(0, q);
    const inp = input();
    const dt = 1 / 60;
    let feet = 0;
    let lastFoot = -1;
    let alternating = true;
    for (let i = 0; i < 180; i++) {
      inp.pos[2] = 3.4 * i * dt;
      inp.vel.set([0, 0, 3.4]);
      q.clear();
      a.update(inp, flat, R, dt);
      for (let e = 0; e < q.length; e++) {
        const ev = q.at(e);
        if (ev.type === ANIM_EVENT.footPlanted) {
          if (ev.code === lastFoot) alternating = false;
          lastFoot = ev.code;
          feet++;
        }
      }
    }
    expect(a.pose.loco1D[2]).toBeCloseTo(1);
    // 3 s at 2 steps/s ~= 6 plants (+-1 for phase start).
    expect(feet).toBeGreaterThanOrEqual(5);
    expect(feet).toBeLessThanOrEqual(7);
    expect(alternating).toBe(true);
    expect(a.baseWeightSumMin).toBeGreaterThan(0.999);
  });
  it("jump -> air with hang after 0.8 s -> land_soft + landed event + compression", () => {
    const q = new AnimEventQueue(64);
    const a = new AvatarAnimator(0, q);
    const inp = input();
    const dt = 1 / 60;
    a.update(inp, flat, R, dt);
    inp.grounded = false;
    inp.jumped = true;
    inp.vel.set([0, 2.28, 0]);
    a.update(inp, flat, R, dt);
    inp.jumped = false;
    expect(a.sm.base).toBe(BASE.air);
    let hangSeen = false;
    for (let t = 0; t < 2.8; t += dt) {
      const vUp = 2.28 - 1.62 * t;
      inp.vel.set([0, vUp, 0]);
      inp.heightAboveGround = Math.max(0, 2.28 * t - 0.81 * t * t);
      a.update(inp, flat, R, dt);
      if (a.pose.hangWeight > 0.5) hangSeen = true;
    }
    expect(hangSeen).toBe(true);
    q.clear();
    inp.grounded = true;
    inp.impactMps = 2.28;
    inp.vel.set([0, 0, 0]);
    a.update(inp, flat, R, dt);
    expect(a.sm.base).toBe(BASE.landSoft);
    expect(q.at(0).type).toBe(ANIM_EVENT.landed);
    for (let i = 0; i < 6; i++) a.update(inp, flat, R, dt);
    expect(a.pose.pelvisY).toBeLessThan(-0.08);
  });
  it("teleport (> 2 m snap) resets with 0 ms blends", () => {
    const a = new AvatarAnimator(0, new AnimEventQueue(8));
    const inp = input();
    inp.actionState = 33; // emote_1
    for (let i = 0; i < 5; i++) a.update(inp, flat, R, 1 / 60);
    inp.pos[2] = 50;
    inp.actionState = 0;
    a.update(inp, flat, R, 1 / 60);
    expect(a.sm.base).toBe(BASE.locomotion);
  });
  it("remote velocity estimate converges and floors to 0", () => {
    const e = new RemoteVelocityEstimator();
    const p = new Float64Array([0, R, 0]);
    for (let i = 0; i < 60; i++) {
      p[2] = 3 * (i / 60);
      e.t = i / 60;
      e.push(p);
    }
    expect(e.vel[2]).toBeCloseTo(3, 1);
    for (let i = 60; i < 120; i++) {
      e.t = i / 60;
      e.push(p);
    }
    expect(e.vel[2]).toBe(0);
  });
});

describe("LOD buckets", () => {
  it("bucket edges with 10 % hysteresis; local always U0", () => {
    expect(bucketFor(200, 0, false)).toBe(0);
    expect(bucketFor(105, 0, false)).toBe(0); // within 10 % of 110
    expect(bucketFor(95, 0, false)).toBe(1);
    expect(bucketFor(115, 1, false)).toBe(1);
    expect(bucketFor(125, 1, false)).toBe(0);
    expect(bucketFor(5, 0, true)).toBe(0);
    expect(bucketFor(5, 3, false)).toBe(4);
  });
  it("staggered update rates", () => {
    let n = 0;
    for (let f = 0; f < 60; f++) if (shouldUpdate(2, f, 3)) n++;
    expect(n).toBe(15);
    expect(shouldUpdate(4, 0, 0)).toBe(false);
  });
});

/** 16 avatars walking / jumping / sweeping on bumpy ground; returns the module after `frames` updates. */
function crowd(frames: number, mod: AnimationModule): void {
  const frame = { dt: 1 / 60, time: 0, alpha: 0, simTick: 0, quality: {} } as unknown as Parameters<
    AnimationModule["update"]
  >[0];
  const f = frame as { time: number };
  for (let i = 0; i < frames; i++) {
    f.time = i / 60;
    mod.update(frame);
  }
}

function crowdModule(): AnimationModule {
  const mod = new AnimationModule();
  mod.bind(
    (slot, frame, inp) => {
      const t = frame.time;
      const a = slot * 0.4;
      const sp = 1 + (slot % 5);
      // Walk on a small circle around the pole; slot parity: tool sweep vs jumps.
      const x = Math.cos(a + t * 0.2) * 20;
      const z = Math.sin(a + t * 0.2) * 20;
      const l = Math.sqrt(x * x + R * R + z * z);
      inp.pos[0] = (x / l) * R;
      inp.pos[1] = (R / l) * R;
      inp.pos[2] = (z / l) * R;
      inp.facing[0] = -Math.sin(a + t * 0.2);
      inp.facing[1] = 0;
      inp.facing[2] = Math.cos(a + t * 0.2);
      inp.vel[0] = inp.facing[0] * sp;
      inp.vel[1] = 0;
      inp.vel[2] = inp.facing[2] * sp;
      const airborne = slot % 2 === 1 && t % 3 > 2;
      inp.grounded = !airborne;
      inp.impactMps = 2.28;
      inp.heightAboveGround = airborne ? 0.5 : 0;
      inp.toolClass = slot % 2 === 0 ? 1 + (slot % 4) : 0;
      inp.toolActive = slot % 2 === 0;
      inp.toolPhase = (t / 0.9) % 1;
      inp.toolPeriodS = 0.9;
      inp.toolInContact = inp.toolPhase < 0.7;
      return true;
    },
    bumpy,
    R,
  );
  mod.setLocalSlot(0);
  return mod;
}

describe("performance (16 avatars, all at U0)", () => {
  it("AN-M1-09: < 32 KB heap growth over 600 frames x 16 avatars (GC-anchored, with a positive control)", () => {
    // Full GC before each window; garbage made inside a window stays in the young generation (well under one
    // semi-space here), so heapUsed growth counts transient allocations too. The control proves the probe works.
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const mod = crowdModule();
    // Warm-up: ~100 s of play so every path (walk, sweep, jump, land) is optimised and V8 field-constness deopts have
    // settled; AN-M1-09 is a steady-state rule (transient JIT-tier boxing during the first seconds is not counted).
    crowd(6000, mod);
    // Best of 3 GC-anchored windows: background (concurrent) JIT compiles finishing inside a window under parallel
    // test load are tier-up noise, not animation allocations; a real per-update allocation shows in every window.
    let grew = Number.POSITIVE_INFINITY;
    for (let w = 0; w < 3; w++) {
      gc();
      const before = process.memoryUsage().heapUsed;
      crowd(600, mod);
      const g = process.memoryUsage().heapUsed - before;
      if (g < grew) grew = g;
    }
    gc();
    const b2 = process.memoryUsage().heapUsed;
    let keep = 0;
    for (let i = 0; i < 600 * 16; i++) keep += new Float64Array(3).length;
    const controlGrew = process.memoryUsage().heapUsed - b2;
    console.info(`[anim] heap growth 600 frames x 16 avatars: ${grew} B (control ${controlGrew} B)`);
    expect(keep).toBe(600 * 16 * 3);
    expect(controlGrew).toBeGreaterThan(256 * 1024);
    // AN-M1-09: < 32 KB over 9,600 avatar-updates (measured ~23 KB; one boxed double per update would be ~150 KB).
    expect(grew).toBeLessThan(32 * 1024);
  });
  it("CPU: median ms per frame for 16 avatars (logic layer, Node)", () => {
    const mod = crowdModule();
    mod.profile = true;
    crowd(300, mod);
    const samples: number[] = [];
    const frame = { dt: 1 / 60, time: 5, alpha: 0, simTick: 0 } as unknown as Parameters<AnimationModule["update"]>[0];
    for (let i = 0; i < 600; i++) {
      (frame as { time: number }).time = 5 + i / 60;
      mod.update(frame);
      samples.push(mod.lastCpuMs);
    }
    samples.sort((x, y) => x - y);
    const p50 = samples[300]!;
    const p95 = samples[570]!;
    console.info(`[anim] 16 avatars logic p50=${p50.toFixed(4)} ms p95=${p95.toFixed(4)} ms`);
    expect(mod.lastUpdated).toBe(16);
    expect(p95).toBeLessThan(1.0);
  });
});
