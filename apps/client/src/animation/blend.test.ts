import { describe, expect, it } from "vitest";
import {
  AIR_APEX,
  AIR_FALL,
  AIR_RISE,
  LOCO_IDLE,
  LOCO_LOPE,
  LOCO_SHUFFLE,
  LOCO_WALK,
  STRAFE_BWD,
  STRAFE_FWD,
  STRAFE_IDLE,
  STRAFE_LEFT,
  STRAFE_RIGHT,
  airBlend,
  bandWithHysteresis,
  gaitCycleS,
  locomotion1D,
  locomotion2D,
} from "./locomotion-blend";
import { BASE, BASE_COUNT, StateMachine, UPPER, crossfadeTo } from "./state-machine";
import { LAND_HARD, LAND_NONE, LAND_SOFT, LAND_STUMBLE } from "./low-g";
import { LOCO } from "./tuning";
import { AVATAR_ACTION_STATES } from "@moon-cleanup/shared";

const sum = (a: Float32Array): number => a.reduce((s, v) => s + v, 0);
const nonZero = (a: Float32Array): number => a.filter((v) => v > 0).length;

describe("locomotion 1D blend", () => {
  const w = new Float32Array(4);
  it("idle at rest, rate 1", () => {
    expect(locomotion1D(0, LOCO.nodeSpeeds, w)).toBe(1);
    expect(w[LOCO_IDLE]).toBe(1);
  });
  it("nodes are exact at authored speeds", () => {
    locomotion1D(2.2, LOCO.nodeSpeeds, w);
    expect(w[LOCO_SHUFFLE]).toBeCloseTo(1);
    locomotion1D(3.4, LOCO.nodeSpeeds, w);
    expect(w[LOCO_WALK]).toBeCloseTo(1);
    locomotion1D(5, LOCO.nodeSpeeds, w);
    expect(w[LOCO_LOPE]).toBe(1);
  });
  it("at most two adjacent nodes, sum 1, across 0..7 m/s", () => {
    for (let s = 0; s <= 7; s += 0.05) {
      const r = locomotion1D(s, LOCO.nodeSpeeds, w);
      expect(sum(w)).toBeCloseTo(1, 6);
      expect(nonZero(w)).toBeLessThanOrEqual(2);
      expect(r).toBeGreaterThanOrEqual(LOCO.rateMin);
      expect(r).toBeLessThanOrEqual(LOCO.rateMax);
    }
  });
  it("rate is s / v_blended between moving nodes and capped above lope", () => {
    const r = locomotion1D(2.8, LOCO.nodeSpeeds, w);
    const vb = 2.2 * w[LOCO_SHUFFLE]! + 3.4 * w[LOCO_WALK]!;
    expect(r).toBeCloseTo(2.8 / vb, 6);
    expect(locomotion1D(6.5, LOCO.nodeSpeeds, w)).toBe(1.25);
  });
  it("gait cycle blends clip durations", () => {
    locomotion1D(2.8, LOCO.nodeSpeeds, w);
    expect(gaitCycleS(w)).toBeCloseTo(0.84 * w[1]! + 1.0 * w[2]!, 6);
  });
});

describe("locomotion 2D strafe blend", () => {
  const w = new Float32Array(5);
  it("pure directions at node speed", () => {
    locomotion2D(2.2, 0, w);
    expect(w[STRAFE_FWD]).toBeCloseTo(1);
    locomotion2D(0, 2.2, w);
    expect(w[STRAFE_RIGHT]).toBeCloseTo(1);
    locomotion2D(-2.2, 0, w);
    expect(w[STRAFE_BWD]).toBeCloseTo(1);
    locomotion2D(0, -2.2, w);
    expect(w[STRAFE_LEFT]).toBeCloseTo(1);
  });
  it("diagonal splits linearly in angle; slow speed gives the rest to idle", () => {
    locomotion2D(1.1 * Math.SQRT2 * 0.5, 1.1 * Math.SQRT2 * 0.5, w);
    expect(w[STRAFE_FWD]).toBeCloseTo(0.25, 5);
    expect(w[STRAFE_RIGHT]).toBeCloseTo(0.25, 5);
    expect(w[STRAFE_IDLE]).toBeCloseTo(0.5, 5);
  });
  it("sum 1 all around, rate capped", () => {
    for (let a = -Math.PI; a <= Math.PI; a += 0.1) {
      const r = locomotion2D(Math.cos(a) * 3, Math.sin(a) * 3, w);
      expect(sum(w)).toBeCloseTo(1, 6);
      expect(r).toBeCloseTo(Math.min(3 / 2.2, 1.25));
    }
  });
});

describe("air blend", () => {
  const w = new Float32Array(3);
  it("rise / apex / fall nodes and linear in between", () => {
    airBlend(2, w);
    expect(w[AIR_RISE]).toBe(1);
    airBlend(0, w);
    expect(w[AIR_APEX]).toBe(1);
    airBlend(-2, w);
    expect(w[AIR_FALL]).toBe(1);
    airBlend(0.7, w);
    expect(w[AIR_RISE]).toBeCloseTo(0.5);
    expect(sum(w)).toBeCloseTo(1);
    airBlend(-0.7, w);
    expect(w[AIR_FALL]).toBeCloseTo(0.5);
  });
});

describe("hysteresis and crossfade", () => {
  it("speed bands change only past edge +- h", () => {
    const edges = [0.5, 2.8, 4.2];
    let b = 0;
    b = bandWithHysteresis(0.6, b, edges, 0.2);
    expect(b).toBe(0);
    b = bandWithHysteresis(0.75, b, edges, 0.2);
    expect(b).toBe(1);
    b = bandWithHysteresis(0.4, b, edges, 0.2);
    expect(b).toBe(1);
    b = bandWithHysteresis(0.29, b, edges, 0.2);
    expect(b).toBe(0);
  });
  it("crossfade keeps the sum at 1 every step and reaches one-hot", () => {
    const w = new Float32Array(BASE_COUNT);
    w[0] = 1;
    for (let i = 0; i < 30; i++) {
      crossfadeTo(w, i < 10 ? 3 : 5, 0.15, 1 / 60);
      expect(sum(w)).toBeCloseTo(1, 5);
    }
    expect(w[5]).toBe(1);
  });
});

describe("state machine transitions", () => {
  const act = (n: (typeof AVATAR_ACTION_STATES)[number]): number => AVATAR_ACTION_STATES.indexOf(n);
  const base = {
    grounded: true,
    vUp: 0,
    timeToGround: Infinity,
    landedClass: LAND_NONE,
    jumped: false,
    actionState: 0,
    speed: 0,
    toolClass: 0,
  };
  const dt = 1 / 60;
  it("jump enters air immediately; walk-off only after 50 ms", () => {
    const sm = new StateMachine();
    sm.update({ ...base, grounded: false, jumped: true, vUp: 2.28 }, dt);
    expect(sm.base).toBe(BASE.air);
    const sm2 = new StateMachine();
    sm2.update({ ...base, grounded: false }, dt);
    sm2.update({ ...base, grounded: false }, dt);
    expect(sm2.base).toBe(BASE.locomotion);
    sm2.update({ ...base, grounded: false }, dt);
    sm2.update({ ...base, grounded: false }, dt);
    expect(sm2.base).toBe(BASE.air);
  });
  it("land_prep when falling with < 0.25 s to ground, then landing class picks the clip", () => {
    for (const [cls, st] of [
      [LAND_SOFT, BASE.landSoft],
      [LAND_HARD, BASE.landHard],
      [LAND_STUMBLE, BASE.stumble],
    ] as const) {
      const sm = new StateMachine();
      sm.update({ ...base, grounded: false, jumped: true, vUp: 2 }, dt);
      sm.update({ ...base, grounded: false, vUp: -2, timeToGround: 0.2 }, dt);
      expect(sm.base).toBe(BASE.landPrep);
      sm.update({ ...base, landedClass: cls }, dt);
      expect(sm.base).toBe(st);
    }
  });
  it("soft landing below the clip threshold returns to locomotion", () => {
    const sm = new StateMachine();
    sm.update({ ...base, grounded: false, jumped: true, vUp: 1 }, dt);
    sm.update({ ...base }, dt);
    expect(sm.base).toBe(BASE.locomotion);
  });
  it("land_hard holds move input for 0.30 s, stumble for 0.80 s", () => {
    const sm = new StateMachine();
    sm.update({ ...base, landedClass: LAND_HARD }, dt);
    for (let i = 0; i < 12; i++) sm.update({ ...base, speed: 2 }, dt);
    expect(sm.base).toBe(BASE.landHard);
    for (let i = 0; i < 8; i++) sm.update({ ...base, speed: 2 }, dt);
    expect(sm.base).toBe(BASE.locomotion);
  });
  it("vehicle has top priority; the sim always wins", () => {
    const sm = new StateMachine();
    sm.update({ ...base, grounded: false, jumped: true, vUp: 2, actionState: act("seated") }, dt);
    expect(sm.base).toBe(BASE.vehicle);
    sm.update({ ...base, actionState: 0 }, dt);
    expect(sm.base).toBe(BASE.locomotion);
  });
  it("min 150 ms between low-priority base changes (remote jitter)", () => {
    const sm = new StateMachine();
    sm.update({ ...base, actionState: act("emote_1") }, dt);
    expect(sm.base).toBe(BASE.emote);
    sm.update({ ...base }, dt);
    expect(sm.base).toBe(BASE.emote);
    for (let i = 0; i < 10; i++) sm.update({ ...base }, dt);
    expect(sm.base).toBe(BASE.locomotion);
  });
  it("upper layer: tool hold, carry overrides tool, weights ramp", () => {
    const sm = new StateMachine();
    sm.update({ ...base, toolClass: 3 }, dt);
    expect(sm.upper).toBe(UPPER.tool);
    for (let i = 0; i < 15; i++) sm.update({ ...base, toolClass: 3 }, dt);
    expect(sm.upperWeight).toBe(1);
    sm.update({ ...base, toolClass: 3, actionState: act("carry_stack") }, dt);
    expect(sm.upper).toBe(UPPER.carry);
    for (let i = 0; i < 20; i++) sm.update({ ...base }, dt);
    expect(sm.upper).toBe(UPPER.empty);
    expect(sm.upperWeight).toBe(0);
  });
  it("base weights always sum to 1 through a jump/land/emote sequence", () => {
    const sm = new StateMachine();
    const seq = [
      { ...base, grounded: false, jumped: true, vUp: 2 },
      ...Array.from({ length: 60 }, () => ({ ...base, grounded: false, vUp: -1 })),
      { ...base, landedClass: LAND_SOFT },
      ...Array.from({ length: 40 }, () => ({ ...base, actionState: act("emote_3") })),
      ...Array.from({ length: 40 }, () => ({ ...base, speed: 3 })),
    ];
    for (const s of seq) {
      sm.update(s, dt);
      expect(sum(sm.baseWeights)).toBeCloseTo(1, 5);
    }
  });
});
