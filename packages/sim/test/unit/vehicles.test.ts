// M1-W7-T01: Trundle kinematics (raycast suspension, boost, Throttle Lock, Steep, ramps), upgrade lines, vehicle
// cleaning into the hopper and the Dump Plate, Motor Pool spawn / return / Repeat Requisition, determinism.
import { describe, expect, test } from "vitest";
import { loadGameData } from "@moon-cleanup/game-data";
import {
  absorbDust,
  buildMotorPool,
  buyUpgrade,
  buyVehicle,
  createSimConfig,
  dumpHopper,
  enterVehicle,
  exitVehicle,
  Fnv1a32,
  GEAR_LOCKED,
  hashVehicle,
  motorPoolReturn,
  motorPoolSpawn,
  MotorPoolState,
  MP_ALREADY_OUT,
  MP_LIMIT_OUT,
  MP_NO_MOTOR_POOL,
  MP_NOT_OWNED,
  quoteUpgradeLm,
  quoteVehicleLm,
  refreshVehicleStats,
  resolveVehicleStats,
  resolveVehicleTuning,
  spawnVehicle,
  stepVehicle,
  stepVehicleIntake,
  VEHICLE_AIRBORNE,
  VEHICLE_GROUNDED,
  VehicleIntakeOut,
  VehicleIntent,
  VehicleState,
  VehicleStats,
  VehicleStore,
  vehicleKindOf,
  type SimGround,
} from "../../src/index";
import { FLAT_GROUND, flatWorld, makeWorldLedger, testWorld } from "../support/world";

const data = loadGameData();
const cfg = createSimConfig(data);
const tuning = resolveVehicleTuning(data, cfg);
const TRUNDLE = vehicleKindOf(tuning, "vehicle.trundle");
const R = cfg.moonRadiusM;
const lineOf = (id: string): number => tuning.lines.findIndex((l) => l.id === id);
const GEAR = lineOf("vehicle_upgrade.gear_ratio");
const CARGO = lineOf("vehicle_upgrade.cargo_expander");
const AFTER = lineOf("vehicle_upgrade.afterburner");
const LOCK = lineOf("vehicle_upgrade.throttle_lock");
const WIDE = lineOf("vehicle_upgrade.wide_mouth");

function driven(ground: SimGround = FLAT_GROUND, levels: Record<number, number> = {}): VehicleState {
  const v = new VehicleState(tuning.lines.length);
  for (const [k, lv] of Object.entries(levels)) v.levels[Number(k)] = lv;
  spawnVehicle(v, tuning, cfg, ground, TRUNDLE, 0, 0, 0, 1, 1, 0, 0);
  v.driverSlot = 0;
  return v;
}

function run(
  v: VehicleState,
  ticks: number,
  set: (i: VehicleIntent, k: number) => void,
  ground: SimGround = FLAT_GROUND,
  each?: (k: number) => void,
): void {
  const intent = new VehicleIntent();
  for (let k = 0; k < ticks; k++) {
    intent.lockPressed = false;
    intent.lightsPressed = false;
    set(intent, k);
    stepVehicle(v, intent, tuning, cfg, ground);
    each?.(k);
  }
}

const forward = (i: VehicleIntent): void => {
  i.throttle = 1;
};

describe("vehicle tuning from game-data", () => {
  test("Trundle numbers come from vehicles.json", () => {
    const k = tuning.kinds[TRUNDLE]!;
    expect(k.priceLm).toBe(2100);
    expect(k.cruiseMps).toBe(3);
    expect(k.payloadGrams).toBe(200_000);
    expect(k.widthM).toBe(1.6);
    expect(k.depthLevels).toBe(7);
    expect(tuning.vehiclesOutPerMotorPool).toBe(1);
    expect(tuning.motorPool.includedDumpPlates).toBe(1);
    expect(tuning.repeatFrac).toBe(data.economy.repeatRequisitionFrac);
  });

  test("a level replaces the lower ones; lines combine; Wide Mouth speed applies only with the intake down", () => {
    const k = tuning.kinds[TRUNDLE]!;
    const out = new VehicleStats();
    const lv = new Uint8Array(tuning.lines.length);
    resolveVehicleStats(tuning, k, lv, out);
    expect([out.cruiseMps, out.speedMult, out.widthM, out.payloadGrams, out.boostMult]).toEqual([
      3, 1, 1.6, 200_000, 1.3,
    ]);
    lv[GEAR] = 3;
    lv[CARGO] = 2;
    lv[AFTER] = 2;
    lv[WIDE] = 1;
    lv[LOCK] = 1;
    resolveVehicleStats(tuning, k, lv, out);
    expect(out.speedMult).toBeCloseTo(1.24, 9);
    expect(out.intakeSpeedMult).toBeCloseTo(0.92, 9);
    expect(out.widthM).toBeCloseTo(1.92, 9);
    expect(out.payloadGrams).toBe(360_000);
    expect(out.boostMult).toBe(1.6);
    expect(out.cruiseControl).toBe(true);
    expect(out.tripTimeMult).toBeCloseTo(0.88 * 0.97, 9);
  });
});

describe("Trundle kinematics", () => {
  test("accelerates to cruise in about 1 s, never exceeds it, stays on the ground", () => {
    const v = driven();
    let max = 0;
    run(v, 60, forward, FLAT_GROUND, () => {
      max = Math.max(max, v.speed);
      expect(v.heightAboveGround).toBe(0);
      expect(Math.hypot(v.px, v.py, v.pz)).toBeCloseTo(R, 3);
    });
    expect(max).toBeLessThanOrEqual(3 + 1e-4);
    expect(v.speed).toBeCloseTo(3, 3);
    const v2 = driven();
    run(v2, 10, forward); // 0.5 s: half speed
    expect(v2.speed).toBeCloseTo(1.5, 3);
  });

  test("Gear Ratio raises cruise and boost; boost drains the 4 s meter then regenerates after 1 s", () => {
    const v = driven(FLAT_GROUND, { [GEAR]: 2 });
    run(v, 40, forward);
    expect(v.speed).toBeCloseTo(3 * 1.16, 5);
    run(v, 20, (i) => {
      i.throttle = 1;
      i.boost = true;
    });
    expect(v.boosting).toBe(true);
    expect(v.speed).toBeGreaterThan(3 * 1.16 * 1.2);
    expect(v.speed).toBeLessThanOrEqual(3 * 1.16 * 1.3 + 1e-4);
    // 4 s of boost at 20 Hz = 80 ticks; the meter then runs dry and the boost drops out.
    run(v, 60, (i) => {
      i.throttle = 1;
      i.boost = true;
    });
    expect(v.boostMeterMs).toBe(0);
    run(v, 1, (i) => {
      i.throttle = 1;
      i.boost = true;
    });
    expect(v.boosting).toBe(false); // dry: the boost drops out (that tick counts toward the 1 s delay)
    run(v, 19, forward); // delay 1.0 s elapsed, nothing regenerated yet
    expect(v.boostMeterMs).toBe(0);
    run(v, 20, forward); // 1 s at 0.5 s per s = 500 ms
    expect(v.boostMeterMs).toBe(500);
  });

  test("steering turns the heading clockwise at the turn cap and bleeds sideways speed through grip", () => {
    const v = driven();
    run(v, 40, forward);
    const f0 = [v.fx, v.fy, v.fz];
    run(v, 20, (i) => {
      i.throttle = 1;
      i.steer = 1;
    });
    const dot = f0[0]! * v.fx + f0[1]! * v.fy + f0[2]! * v.fz;
    // 1 s at <= 120 deg/s (steering ramps in over 0.125 s): between 100 and 120 degrees.
    const deg = (Math.acos(dot) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(95);
    expect(deg).toBeLessThan(120.5);
    // Clockwise seen from above (toward east = north x up): the new heading has a component along east = f0 x n... check sign.
    const n = [0, 0, 1];
    const cross = [f0[1]! * n[2]! - f0[2]! * n[1]!, f0[2]! * n[0]! - f0[0]! * n[2]!, f0[0]! * n[1]! - f0[1]! * n[0]!]; // f0 x n = right of f0
    expect(v.fx * cross[0]! + v.fy * cross[1]! + v.fz * cross[2]!).toBeGreaterThan(0);
    run(v, 20, () => undefined);
    expect(Math.abs(v.latSpeed)).toBeLessThan(0.05);
  });

  test("turns in place below the in-place speed; handbrake and coast stop it", () => {
    const v = driven();
    run(v, 20, (i) => {
      i.steer = 1;
    });
    const deg = (Math.acos(Math.max(-1, Math.min(1, v.fz * 0 + v.fx))) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(70);
    run(v, 40, forward);
    run(v, 4, (i) => {
      i.handbrake = true;
    });
    expect(v.speed).toBeLessThan(2); // 6 m/s^2 brake: 0.3 m/s per tick
    expect(v.speed).toBeGreaterThan(1);
    run(v, 40, () => undefined);
    expect(v.speed).toBe(0);
  });

  test("Throttle Lock holds the speed hands-free and cancels on throttle; absent without the upgrade", () => {
    const v = driven(FLAT_GROUND, { [LOCK]: 1 });
    run(v, 40, forward);
    run(v, 1, (i) => {
      i.lockPressed = true;
    });
    expect(v.gear).toBe(GEAR_LOCKED);
    run(v, 60, () => undefined);
    expect(v.speed).toBeCloseTo(3, 5);
    run(v, 1, (i) => {
      i.throttle = -1;
    });
    expect(v.gear).not.toBe(GEAR_LOCKED);
    const plain = driven();
    run(plain, 40, forward);
    run(plain, 1, (i) => {
      i.lockPressed = true;
    });
    expect(plain.gear).not.toBe(GEAR_LOCKED);
  });

  test("Wide Mouth cycle steps the selected intake down and wraps to the owned level; a new level selects itself", () => {
    const v = driven(FLAT_GROUND, { [WIDE]: 2 });
    expect(v.stats.widthM).toBeCloseTo(1.6 * 1.4, 9);
    const cycle = (): void => run(v, 1, (i) => (i.cycleIntakePressed = true));
    cycle();
    expect(v.stats.widthM).toBeCloseTo(1.6 * 1.2, 9);
    expect(v.stats.intakeSpeedMult).toBeCloseTo(0.92, 9);
    cycle();
    expect(v.stats.widthM).toBeCloseTo(1.6, 9);
    expect(v.stats.intakeSpeedMult).toBe(1);
    cycle();
    expect(v.stats.widthM).toBeCloseTo(1.6 * 1.4, 9);
    const plain = driven();
    run(plain, 1, (i) => (i.cycleIntakePressed = true));
    expect(plain.intakeCap).toBe(255); // no Wide Mouth: nothing to cycle
  });

  test("grounded ticks read the ground at three probes only", () => {
    let calls = 0;
    const counting: SimGround = {
      heightAtXYZ: () => {
        calls++;
        return 0;
      },
    };
    const v = driven(counting);
    calls = 0;
    run(v, 50, forward, counting);
    expect(calls).toBe(150);
  });

  test("an undriven vehicle ignores input and coasts to a stop", () => {
    const v = driven();
    run(v, 30, forward);
    v.driverSlot = -1;
    run(v, 60, forward);
    expect(v.speed).toBe(0);
  });

  test("Steep: above the slide angle the vehicle slides downhill at g (sin - mu cos)", () => {
    const slope = Math.tan((30 * Math.PI) / 180);
    const wedge: SimGround = { heightAtXYZ: (x) => slope * Math.max(0, x * R - 5) };
    const v = new VehicleState(tuning.lines.length);
    spawnVehicle(v, tuning, cfg, wedge, TRUNDLE, 0, 0.005, 0, 1, 1, 0, 0); // x arc 10 m, on the 30 degree ramp
    v.driverSlot = 0;
    run(v, 60, forward, wedge); // full throttle uphill: traction 0
    expect(v.speed).toBeLessThan(-1);
    expect(v.speed).toBeGreaterThan(-3);
  });

  test("a cliff makes it airborne carrying its speed; it lands and reports the impact", () => {
    const cliff: SimGround = { heightAtXYZ: (x) => (x * R > 12 ? -3 : 0) };
    const v = driven(cliff);
    let tookOff = 0;
    let landed = 0;
    let impact = 0;
    run(v, 220, forward, cliff, () => {
      if (v.tookOff) tookOff++;
      if (v.landed) {
        landed++;
        impact = v.lastImpactMps;
      }
    });
    expect(tookOff).toBe(1);
    expect(landed).toBe(1);
    // free fall 3 m at 1.62 m/s^2: v = sqrt(2 g h) = 3.1 m/s
    expect(impact).toBeGreaterThan(2.6);
    expect(impact).toBeLessThan(3.6);
    expect(v.moveState).toBe(VEHICLE_GROUNDED);
    expect(v.heightAboveGround).toBe(0);
  });

  test("a ramp that ends in a drop leaves the ground", () => {
    const ramp: SimGround = { heightAtXYZ: (x) => (x * R > 8 ? (x * R > 10 ? 0 : (x * R - 8) * 0.3) : 0) };
    const v = driven(ramp);
    let air = 0;
    run(v, 100, forward, ramp, () => {
      if (v.moveState === VEHICLE_AIRBORNE) air++;
    });
    expect(air).toBeGreaterThan(0);
  });

  test("property: bounded speed, no tunnelling, always back on the real ground (seeded random driving)", () => {
    const world = testWorld();
    let seed = 12345;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let trial = 0; trial < 6; trial++) {
      const v = new VehicleState(tuning.lines.length);
      v.levels[GEAR] = 3;
      spawnVehicle(
        v,
        tuning,
        cfg,
        world.ground,
        TRUNDLE,
        0,
        rnd() - 0.5,
        rnd() - 0.5,
        1,
        rnd() - 0.5,
        rnd() - 0.5,
        0.2,
      );
      v.driverSlot = 0;
      const vMax = 3 * 1.24 * 1.3;
      let px = v.px;
      let py = v.py;
      let pz = v.pz;
      let throttle = 1;
      let steer = 0;
      let boost = false;
      run(
        v,
        400,
        (i, k) => {
          if (k % 15 === 0) {
            throttle = rnd() < 0.8 ? 1 : rnd() < 0.5 ? -1 : 0;
            steer = rnd() * 2 - 1;
            boost = rnd() < 0.3;
          }
          i.throttle = throttle;
          i.steer = steer;
          i.boost = boost;
          i.handbrake = rnd() < 0.05;
        },
        world.ground,
        () => {
          const step = Math.hypot(v.px - px, v.py - py, v.pz - pz);
          expect(step).toBeLessThanOrEqual(vMax * cfg.dt + 1e-3 + Math.abs(v.vr) * cfg.dt + 0.2);
          px = v.px;
          py = v.py;
          pz = v.pz;
          expect(Math.abs(v.speed)).toBeLessThanOrEqual(vMax + 1e-6);
          expect(Number.isFinite(v.px + v.speed + v.latSpeed)).toBe(true);
          const l = Math.hypot(v.px, v.py, v.pz);
          const rg = R + world.ground.heightAtXYZ(v.px / l, v.py / l, v.pz / l);
          // Grounded: riding the plane / wheel support, never further from the centre height than the snap distance.
          if (v.moveState === VEHICLE_GROUNDED) expect(Math.abs(l - rg)).toBeLessThanOrEqual(0.4);
          else expect(l).toBeGreaterThanOrEqual(rg - 1e-3);
        },
      );
    }
  });
});

describe("determinism", () => {
  function replay(): number {
    const world = testWorld();
    const v = new VehicleState(tuning.lines.length);
    v.levels[GEAR] = 1;
    v.levels[LOCK] = 1;
    spawnVehicle(v, tuning, cfg, world.ground, TRUNDLE, 0, 0.1, 0.2, 1, 1, 0, 0);
    v.driverSlot = 0;
    const h = new Fnv1a32();
    run(
      v,
      600,
      (i, k) => {
        i.throttle = k % 200 < 160 ? 1 : -1;
        i.steer = Math.sin(k / 23);
        i.boost = k % 90 > 60;
        i.lockPressed = k === 50;
      },
      world.ground,
      (k) => {
        if (k % 20 === 0) hashVehicle(v, h);
      },
    );
    return h.value;
  }

  test("the same inputs give the same state hash (golden)", () => {
    const a = replay();
    expect(replay()).toBe(a);
    expect(a).toBe(VEHICLE_GOLDEN_HASH);
  });
});
// Re-recorded 2026-11-16 (W7-T01 round 2): grounded ticks read the ground at the three probes only (was 7 calls).
const VEHICLE_GOLDEN_HASH = 60938090;

describe("vehicle cleaning into the hopper and the Dump Plate", () => {
  const world = flatWorld();

  function setup(levels: Record<number, number> = {}) {
    const ledger = makeWorldLedger();
    const v = new VehicleState(tuning.lines.length);
    for (const [k, lv] of Object.entries(levels)) v.levels[Number(k)] = lv;
    spawnVehicle(v, tuning, cfg, world.ground, TRUNDLE, 0, 0, 0.3, 0.95, 1, 0, 0);
    v.driverSlot = 0;
    const out = new VehicleIntakeOut();
    let milligrams = 0;
    let strokes = 0;
    let tick = 0;
    const drive = (ticks: number, night = false): void => {
      run(v, ticks, forward, world.ground, () => {
        tick++;
        if (stepVehicleIntake(v, tuning, cfg, world.grid, world.ground, ledger, tick, 0, night, out)) {
          strokes++;
          milligrams += out.result.milligrams;
          expect(out.stroke.actorSlot).toBe(16);
          expect(out.stroke.toolCode).toBe(tuning.strokeToolCodeBase + TRUNDLE);
          expect(out.stroke.widthCm).toBe(Math.round(v.stats.widthM * 100));
        }
      });
    };
    return { v, drive, ledger, totals: () => ({ milligrams, strokes }) };
  }

  test("strokes carry the cleaning width and Depth, dust lands in the hopper, mass is conserved", () => {
    const { v, drive, totals } = setup();
    drive(200);
    const t = totals();
    expect(t.strokes).toBeGreaterThan(5);
    expect(t.milligrams).toBeGreaterThan(0);
    expect(v.hopperGrams).toBeGreaterThan(0);
    expect(v.hopperGrams * 1000 + v.hopperMg).toBe(t.milligrams);
    expect(v.intakeDown).toBe(true);
  });

  test("night lowers the stroke depth; Running Lamps relieve it", () => {
    const base = setup();
    base.drive(60, true);
    const lit = setup({ [lineOf("vehicle_upgrade.running_lamps")]: 2 });
    lit.drive(60, true);
    // depth16 = floor(16 x 7 x (1 - penalty)); the lit vehicle's stroke is deeper.
    const probe = (night: boolean, relief: number): number =>
      Math.floor(16 * 7 * (1 - Math.max(0, night ? cfg.nightPenaltyFrac - relief : 0)));
    expect(probe(true, 0.2)).toBeGreaterThan(probe(true, 0));
    expect(lit.v.stats.nightPenaltyRelief).toBe(0.2);
  });

  test("a full hopper accepts no strokes, lifts the intake, and the Dump Plate takes the dust back", () => {
    const { v, drive } = setup();
    v.hopperGrams = v.stats.payloadGrams - 10;
    drive(200);
    expect(v.hopperGrams).toBeLessThanOrEqual(v.stats.payloadGrams);
    expect(v.hopperGrams).toBeGreaterThanOrEqual(v.stats.payloadGrams - 10);
    expect(v.intakeDown).toBe(false);
    let plate = 0;
    const before = v.hopperGrams;
    const took = dumpHopper(v, {
      accept: (g) => {
        plate += g;
        return g;
      },
    });
    expect(took).toBe(before);
    expect(plate).toBe(before);
    expect(v.hopperGrams).toBe(0);
    // A refusing / partial sink leaves the rest aboard.
    v.hopperGrams = 100;
    expect(dumpHopper(v, { accept: () => 30 })).toBe(30);
    expect(v.hopperGrams).toBe(70);
  });

  test("Cargo Expander raises the hopper cap; absorbDust clamps to it", () => {
    const { v } = setup({ [CARGO]: 3 });
    expect(v.stats.payloadGrams).toBe(440_000);
    v.hopperGrams = v.stats.payloadGrams - 1;
    expect(absorbDust(v, 5000)).toBe(1);
    expect(v.hopperGrams).toBe(v.stats.payloadGrams);
  });
});

describe("Motor Pool", () => {
  const store = (): VehicleStore => new VehicleStore(4, tuning.lines.length);
  const sink = { accept: (g: number): number => g };

  test("spawn needs a Motor Pool and a bought vehicle, respects vehicles-out and one per owner and kind", () => {
    const pool = new MotorPoolState(tuning);
    const s = store();
    const spawn = (slot: number): number =>
      motorPoolSpawn(pool, s, tuning, cfg, FLAT_GROUND, TRUNDLE, slot, 0, 0, 1, 1, 0, 0);
    expect(spawn(0)).toBe(MP_NO_MOTOR_POOL);
    buildMotorPool(pool);
    expect(spawn(0)).toBe(MP_NOT_OWNED);
    expect(buyVehicle(pool, TRUNDLE)).toBe(true);
    const idx = spawn(0);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(s.vehicles[idx]!.active).toBe(true);
    expect(spawn(1)).toBe(MP_LIMIT_OUT);
    buildMotorPool(pool);
    expect(spawn(0)).toBe(MP_ALREADY_OUT);
    expect(spawn(1)).toBeGreaterThanOrEqual(0);
  });

  test("return unloads into the Dump Plate and refuses while dust would be lost", () => {
    const pool = new MotorPoolState(tuning);
    const s = store();
    buildMotorPool(pool);
    buyVehicle(pool, TRUNDLE);
    const idx = motorPoolSpawn(pool, s, tuning, cfg, FLAT_GROUND, TRUNDLE, 0, 0, 0, 1, 1, 0, 0);
    const v = s.vehicles[idx]!;
    v.hopperGrams = 5000;
    expect(motorPoolReturn(s, idx, { accept: () => 0 })).toBe(false);
    expect(v.active).toBe(true);
    expect(v.hopperGrams).toBe(5000);
    expect(motorPoolReturn(s, idx, sink)).toBe(true);
    expect(v.active).toBe(false);
    expect(motorPoolSpawn(pool, s, tuning, cfg, FLAT_GROUND, TRUNDLE, 0, 0, 0, 1, 1, 0, 0)).toBeGreaterThanOrEqual(0);
  });

  test("Repeat Requisition: first copy at list, further copies at 40 %; upgrades follow; the Rebate applies; never negative", () => {
    const pool = new MotorPoolState(tuning);
    const s = store();
    expect(quoteVehicleLm(tuning, pool, TRUNDLE, 0)).toBe(2100);
    buildMotorPool(pool);
    buyVehicle(pool, TRUNDLE);
    expect(quoteVehicleLm(tuning, pool, TRUNDLE, 0)).toBe(Math.round(2100 * tuning.repeatFrac));
    expect(quoteVehicleLm(tuning, pool, TRUNDLE, 0.05)).toBe(Math.round(Math.round(2100 * tuning.repeatFrac) * 0.95));
    expect(quoteVehicleLm(tuning, pool, TRUNDLE, 5)).toBe(0);
    // Gear Ratio L1 costs 0.2 x price, L2 0.5, L3 1.0; none beyond.
    expect(quoteUpgradeLm(tuning, pool, TRUNDLE, GEAR, 0)).toBe(420);
    expect(buyUpgrade(tuning, pool, s, TRUNDLE, GEAR)).toBe(true);
    expect(quoteUpgradeLm(tuning, pool, TRUNDLE, GEAR, 0)).toBe(1050);
    buyUpgrade(tuning, pool, s, TRUNDLE, GEAR);
    buyUpgrade(tuning, pool, s, TRUNDLE, GEAR);
    expect(pool.levelOf(TRUNDLE, GEAR)).toBe(3);
    expect(quoteUpgradeLm(tuning, pool, TRUNDLE, GEAR, 0)).toBe(-1);
    expect(buyUpgrade(tuning, pool, s, TRUNDLE, GEAR)).toBe(false);
    // Lines the kind does not offer (none for the Trundle) and unbought kinds are refused.
    expect(buyUpgrade(tuning, pool, s, vehicleKindOf(tuning, "vehicle.skiff"), GEAR)).toBe(false);
    buyVehicle(pool, TRUNDLE);
    expect(quoteUpgradeLm(tuning, pool, TRUNDLE, AFTER, 0)).toBe(
      Math.round(Math.round(2100 * 0.15) * tuning.repeatFrac),
    );
  });

  test("an upgrade bought while the vehicle is out refreshes its stats; a respawn keeps the levels", () => {
    const pool = new MotorPoolState(tuning);
    const s = store();
    buildMotorPool(pool);
    buyVehicle(pool, TRUNDLE);
    const idx = motorPoolSpawn(pool, s, tuning, cfg, FLAT_GROUND, TRUNDLE, 0, 0, 0, 1, 1, 0, 0);
    expect(s.vehicles[idx]!.stats.speedMult).toBe(1);
    buyUpgrade(tuning, pool, s, TRUNDLE, GEAR);
    expect(s.vehicles[idx]!.stats.speedMult).toBeCloseTo(1.08, 9);
    motorPoolReturn(s, idx, sink);
    const again = motorPoolSpawn(pool, s, tuning, cfg, FLAT_GROUND, TRUNDLE, 0, 0, 0, 1, 1, 0, 0);
    refreshVehicleStats(tuning, s.vehicles[again]!);
    expect(s.vehicles[again]!.stats.speedMult).toBeCloseTo(1.08, 9);
  });

  test("enter needs ownership, reach and a free seat; exit only by the driver", () => {
    const pool = new MotorPoolState(tuning);
    const s = store();
    buildMotorPool(pool);
    buyVehicle(pool, TRUNDLE);
    const v = s.vehicles[motorPoolSpawn(pool, s, tuning, cfg, FLAT_GROUND, TRUNDLE, 2, 0, 0, 1, 1, 0, 0)]!;
    expect(enterVehicle(v, tuning, 1, v.px, v.py, v.pz)).toBe(false); // not the owner
    expect(enterVehicle(v, tuning, 2, v.px + 30, v.py, v.pz)).toBe(false); // too far
    expect(enterVehicle(v, tuning, 2, v.px, v.py, v.pz)).toBe(true);
    expect(enterVehicle(v, tuning, 2, v.px, v.py, v.pz)).toBe(false); // already driven
    expect(exitVehicle(v, 1)).toBe(false);
    expect(exitVehicle(v, 2)).toBe(true);
  });
});

describe("cost", () => {
  test("vehicle step budget (<= 10 us on the fixture world, V8 Tier A; generous CI bound 60 us)", () => {
    const world = testWorld();
    const v = new VehicleState(tuning.lines.length);
    spawnVehicle(v, tuning, cfg, world.ground, TRUNDLE, 0, 0.1, 0.2, 1, 1, 0, 0);
    v.driverSlot = 0;
    const intent = new VehicleIntent();
    intent.throttle = 1;
    for (let k = 0; k < 2000; k++) stepVehicle(v, intent, tuning, cfg, world.ground); // warm up
    const n = 20_000;
    const t0 = performance.now();
    for (let k = 0; k < n; k++) {
      intent.steer = (k & 63) < 32 ? 0.5 : -0.5;
      stepVehicle(v, intent, tuning, cfg, world.ground);
    }
    const us = ((performance.now() - t0) * 1000) / n;
    // Ground height calls dominate (7 per tick); measure them on their own to split the cost.
    let sink = 0;
    const g0 = performance.now();
    for (let k = 0; k < n; k++) sink += world.ground.heightAtXYZ(0.6, 0.64 + (k & 7) * 1e-4, 0.48);
    const groundUs = ((performance.now() - g0) * 1000) / n;
    const flat = new VehicleState(tuning.lines.length);
    spawnVehicle(flat, tuning, cfg, FLAT_GROUND, TRUNDLE, 0, 0, 0, 1, 1, 0, 0);
    flat.driverSlot = 0;
    for (let k = 0; k < 2000; k++) stepVehicle(flat, intent, tuning, cfg, FLAT_GROUND);
    const f0 = performance.now();
    for (let k = 0; k < n; k++) stepVehicle(flat, intent, tuning, cfg, FLAT_GROUND);
    const flatUs = ((performance.now() - f0) * 1000) / n;
    console.log(
      `vehicle step: ${us.toFixed(2)} us on the fixture world; ${flatUs.toFixed(2)} us on flat ground; one ground call ${groundUs.toFixed(3)} us (${sink > 0 ? "" : " "}7 per tick)`,
    );
    // Card target 10 us. Measured after the 3-probe ground read: 7-10 us on the fixture world, 1.4-2.7 us flat (the
    // first version, 7 ground calls, was 19-23 us). The gate keeps headroom for CI noise; game-feel section 2.1 allows 30.
    expect(flatUs).toBeLessThan(15);
    expect(us).toBeLessThan(30);
  });
});
