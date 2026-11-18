// M1-W7-T01 Trundle client prediction: the render-thread predictor runs the sim's own `stepVehicle` on the inputs at
// send time and reconciles from FRAME Selfs that arrive late (replay of unacknowledged inputs). Checked against a real
// MoonRoomSim: avatar-only Selfs (today's Solo encoder) and Selfs with the vehicle block (wire-quantised).
import { describe, expect, test } from "vitest";
import {
  FRAME_SELF_DRIVER_MOVE_STATE,
  INPUT_BUTTON_MASK as M,
  QUANT,
  STANDARD_GRID_PARAMS,
  type ContractId,
  type RequestId,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { createSelfState, packQuat, steerToCode8, yawToCode, type SelfState } from "@moon-cleanup/protocol";
import {
  atan2Det,
  createRoomDustLedger,
  createSimConfig,
  headingBasis,
  MoonRoomSim,
  resolveVehicleTuning,
  type AvatarState,
  type SimWorld,
} from "@moon-cleanup/sim";
import { createPlotGrid } from "@moon-cleanup/world";
import { FLAT_GROUND } from "../index";
import { PredictedVehiclePose, TrundlePredictor } from "./trundle-predictor";
import { vehicleIntentFromInput } from "./vehicle-intent";

const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: FLAT_GROUND };
const cfg = createSimConfig(data, { tickHz: 20 });
const tuning = resolveVehicleTuning(data, cfg);

function newSim(): MoonRoomSim {
  const sim = new MoonRoomSim({
    data,
    world,
    ledger: createRoomDustLedger(grid, data, { tickHz: 20 }),
    contractId: "00000000-0000-4000-8000-0000000000ad" as ContractId,
    shiftType: "private",
    tickHz: 20,
    snapshotHz: 10,
    walletLm: 100_000,
  });
  sim.addActor(0, { playerId: "p" as never, displayName: "P", role: "holder" });
  sim.onEvent(() => undefined);
  return sim;
}

class Rig {
  seq = 0;
  readonly sim = newSim();
  cmd(over: Partial<SimInputCommand>): SimInputCommand {
    this.seq = (this.seq + 1) & 0xffff;
    return { seq: this.seq, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 255, ...over };
  }
  tick(over: Partial<SimInputCommand> = {}): SimInputCommand {
    const c = this.cmd(over);
    this.sim.applyInput(0, c);
    this.sim.step(this.sim.config.dt);
    return c;
  }
  buy(itemId: string): void {
    const r = this.sim.applyIntent(0, { kind: "purchase", requestId: `r${itemId}${this.seq++}` as RequestId, itemId });
    expect(r?.ok).toBe(true);
  }
  seat(): void {
    this.buy("vehicle.trundle");
    for (const b of [M.seatSwitch, M.interact]) {
      this.tick({ buttons: b });
      this.tick();
    }
    expect(this.sim.vehicles.driving[0]).toBe(0);
  }
}

const q = (m: number): number => Math.round(m * 2048) / 2048; // positionOwn 1/2048 m
const qv = (m: number): number => Math.round(m * 256) / 256;
const basis = new Float64Array(9);
function bodyYawCode(a: AvatarState): number {
  headingBasis(a, basis);
  const north = a.fx * basis[3]! + a.fy * basis[4]! + a.fz * basis[5]!;
  const east = a.fx * basis[6]! + a.fy * basis[7]! + a.fz * basis[8]!;
  return yawToCode(atan2Det(east, north));
}

/** The Self the Solo encoder would send now: avatar only, or with the vehicle block (wire-quantised). */
function selfOf(sim: MoonRoomSim, withBlock: boolean): SelfState {
  const s = createSelfState();
  const a = sim.avatar(0);
  s.px = q(a.px);
  s.py = q(a.py);
  s.pz = q(a.pz);
  s.yawCode = bodyYawCode(a);
  s.moveState = 0;
  if (!withBlock) return s;
  const rec = sim.snapshot().vehicles[0]!;
  const v = sim.vehicles.store.vehicles[0]!;
  s.moveState = FRAME_SELF_DRIVER_MOVE_STATE;
  s.vpx = q(v.px);
  s.vpy = q(v.py);
  s.vpz = q(v.pz);
  const o = rec.transform.orientation;
  const pk = packQuat(o.x, o.y, o.z, o.w, QUANT.vehicleOrientationOwn.componentBits, {
    index: 0,
    a: 0,
    b: 0,
    c: 0,
  });
  s.orientIndex = pk.index;
  s.orientA = pk.a;
  s.orientB = pk.b;
  s.orientC = pk.c;
  s.lvx = qv(rec.linearVelocity.x);
  s.lvy = qv(rec.linearVelocity.y);
  s.lvz = qv(rec.linearVelocity.z);
  s.steer = steerToCode8(v.steer);
  s.gear = v.gear;
  s.boost = v.boosting;
  s.lights = v.lights;
  return s;
}

function driveInput(k: number): Partial<SimInputCommand> {
  return {
    moveY: k < 90 ? 127 : -60,
    moveX: k < 20 ? 0 : k < 50 ? 127 : -90,
    buttons: k >= 50 && k < 70 ? M.boost : 0,
  };
}

/**
 * Drives `ticks` ticks. Each input is predicted at send; the sim steps it; the Self of tick n reaches the predictor
 * `lag` ticks later. Returns the largest distance between the prediction for input n and the sim's vehicle after n.
 */
function drive(rig: Rig, p: TrundlePredictor, ticks: number, lag: number, withBlock: boolean): number {
  const pending: { self: SelfState; ack: number }[] = [];
  let maxErr = 0;
  for (let k = 0; k < ticks; k++) {
    const c = rig.cmd(driveInput(k));
    p.predict(c);
    rig.sim.applyInput(0, c);
    rig.sim.step(rig.sim.config.dt);
    const v = rig.sim.vehicles.store.vehicles[0]!;
    const s = p.state;
    maxErr = Math.max(maxErr, Math.hypot(s.px - v.px, s.py - v.py, s.pz - v.pz));
    pending.push({ self: selfOf(rig.sim, withBlock), ack: c.seq });
    while (pending.length > lag) {
      const f = pending.shift()!;
      p.reconcile(f.self, f.ack);
    }
  }
  return maxErr;
}

function started(withBlock: boolean): { rig: Rig; p: TrundlePredictor } {
  const rig = new Rig();
  rig.seat();
  const p = new TrundlePredictor(cfg, tuning, FLAT_GROUND, () => 0);
  p.begin("vehicle.trundle");
  expect(p.ready).toBe(false);
  p.reconcile(selfOf(rig.sim, withBlock), rig.seq);
  expect(p.ready).toBe(true);
  return { rig, p };
}

describe("TrundlePredictor", () => {
  test("avatar-only Selfs, 2 ticks late: the prediction tracks the sim within 2 cm (handle + 10-bit yaw rebuild)", () => {
    const { rig, p } = started(false);
    const err = drive(rig, p, 160, 2, false);
    expect(err).toBeLessThan(0.02);
    expect(p.stats.reconciles).toBeGreaterThan(150);
    expect(p.stats.replayed).toBeGreaterThan(0);
  });

  test("Selfs with the vehicle block, 3 ticks late: the prediction tracks the sim within 5 mm", () => {
    const { rig, p } = started(true);
    const err = drive(rig, p, 160, 3, true);
    expect(err).toBeLessThan(0.005);
    expect(p.stats.exactReconciles).toBeGreaterThan(150);
  });

  test("upgrades follow ShiftState: with Gear Ratio III the predicted top speed matches the sim", () => {
    const { rig, p } = started(true);
    for (let k = 0; k < 3; k++) rig.buy("vehicle_upgrade.gear_ratio");
    p.setUpgrades({ "vehicle_upgrade.gear_ratio": 3 });
    let maxErr = 0;
    for (let k = 0; k < 60; k++) {
      const c = rig.cmd({ moveY: 127 });
      p.predict(c);
      rig.sim.applyInput(0, c);
      rig.sim.step(cfg.dt);
      const v = rig.sim.vehicles.store.vehicles[0]!;
      maxErr = Math.max(maxErr, Math.abs(p.state.speed - v.speed));
      p.reconcile(selfOf(rig.sim, true), c.seq);
    }
    expect(p.state.speed).toBeCloseTo(3 * 1.24, 2);
    expect(maxErr).toBeLessThan(0.01);
  });

  test("sample: newest tick + velocity extrapolation within one tick + decaying offset; handle behind the chassis", () => {
    let now = 0;
    const rig = new Rig();
    rig.seat();
    const p = new TrundlePredictor(cfg, tuning, FLAT_GROUND, () => now);
    const pose = new PredictedVehiclePose();
    expect(p.sample({ nowMs: 0 }, pose)).toBe(false);
    p.begin("vehicle.trundle");
    p.reconcile(selfOf(rig.sim, false), rig.seq);
    for (let k = 0; k < 40; k++) p.predict(rig.cmd({ moveY: 127 }));
    expect(p.sample({ nowMs: now }, pose)).toBe(true);
    const x0 = pose.px;
    const y0 = pose.py;
    const z0 = pose.pz;
    now += 25; // half a tick
    p.sample({ nowMs: now }, pose);
    expect(Math.hypot(pose.px - x0, pose.py - y0, pose.pz - z0)).toBeCloseTo(p.state.speed * 0.025, 3);
    const h = new Float64Array(3);
    p.handleOf(pose, h);
    expect(Math.hypot(h[0]! - pose.px, h[1]! - pose.py, h[2]! - pose.pz)).toBeCloseTo(0.9, 6);
    p.end();
    expect(p.ready).toBe(false);
  });

  test("the client intent mapping is the sim's (Wide Mouth cycle on holsterNext included)", () => {
    const intent = new (class {
      throttle = 0;
      steer = 0;
      boost = false;
      handbrake = false;
      lockPressed = false;
      lightsPressed = false;
      cycleIntakePressed = false;
    })();
    vehicleIntentFromInput({ moveX: -127, moveY: 127, buttons: M.holsterNext | M.boost }, 0, intent);
    expect(intent).toMatchObject({ throttle: 1, steer: -1, boost: true, cycleIntakePressed: true });
    vehicleIntentFromInput({ moveX: 0, moveY: 0, buttons: M.holsterNext }, M.holsterNext, intent);
    expect(intent.cycleIntakePressed).toBe(false);
  });
});

describe("SeatedTrundle glue", () => {
  test("own vehicle events begin / end prediction; ShiftState upgrades reach the driven vehicle only", async () => {
    const { SeatedTrundle } = await import("./seated-trundle");
    const rig = new Rig();
    rig.seat();
    const g = new SeatedTrundle(0);
    g.attach(new TrundlePredictor(cfg, tuning, FLAT_GROUND, () => 0));
    expect(
      g.onEvent({ name: "vehicle.entered", payload: { actorSlot: 1, vehicleId: 9, kindId: "vehicle.trundle" } }),
    ).toBe(false);
    expect(
      g.onEvent({ name: "vehicle.entered", payload: { actorSlot: 0, vehicleId: 7, kindId: "vehicle.trundle" } }),
    ).toBe(true);
    g.reconcile(selfOf(rig.sim, true), rig.seq);
    expect(g.ready).toBe(true);
    g.onShiftState({ vehicles: [{ entityId: 8, upgrades: { "vehicle_upgrade.gear_ratio": 3 } }] });
    for (let k = 0; k < 60; k++) g.predict(rig.cmd({ moveY: 127 }));
    expect(g.sample({ nowMs: 0 })).toBe(true);
    expect(g.pose.speed).toBeCloseTo(3, 3); // the other vehicle's Gear Ratio was ignored
    g.onShiftState({ vehicles: [{ entityId: 7, upgrades: { "vehicle_upgrade.gear_ratio": 3 } }] });
    for (let k = 0; k < 60; k++) g.predict(rig.cmd({ moveY: 127 }));
    g.sample({ nowMs: 0 });
    expect(g.pose.speed).toBeCloseTo(3 * 1.24, 3);
    expect(Math.hypot(g.feet[0]! - g.pose.px, g.feet[1]! - g.pose.py, g.feet[2]! - g.pose.pz)).toBeCloseTo(0.9, 6);
    g.onEvent({ name: "vehicle.exited", payload: { actorSlot: 0, vehicleId: 7, kindId: "vehicle.trundle" } });
    expect(g.ready).toBe(false);
    expect(g.sample({ nowMs: 0 })).toBe(false);
  });
});
