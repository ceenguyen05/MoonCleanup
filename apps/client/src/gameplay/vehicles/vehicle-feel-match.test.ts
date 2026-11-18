// M1-W7 vehicle-feel swap, client side: the drive view rebuilds the Trundle pose from the FRAME avatar (handle point +
// 10-bit body yaw) with the SAME game-data `VEHICLE_FEEL.handleBackM` the authoritative sim uses, so the predicted
// chassis matches the sim's vehicle tick for tick; and the authoritative motion is bit-identical across two sims.
import { describe, expect, test } from "vitest";
import {
  INPUT_BUTTON_MASK as M,
  STANDARD_GRID_PARAMS,
  type ContractId,
  type RequestId,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { loadGameData, VEHICLE_FEEL } from "@moon-cleanup/game-data";
import { yawFromCode, yawToCode } from "@moon-cleanup/protocol";
import {
  atan2Det,
  createRoomDustLedger,
  Fnv1a32,
  hashVehicle,
  headingBasis,
  MoonRoomSim,
  VEHICLE_HANDLING,
  type AvatarState,
  type SimWorld,
} from "@moon-cleanup/sim";
import { createPlotGrid } from "@moon-cleanup/world";
import { FLAT_GROUND } from "../index";
import { VehicleDriveView } from "./vehicle-drive";

const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: FLAT_GROUND };
const TRUNDLE = VEHICLE_FEEL["vehicle.trundle"]!;

function newSim(): MoonRoomSim {
  const sim = new MoonRoomSim({
    data,
    world,
    ledger: createRoomDustLedger(grid, data, { tickHz: 20 }),
    contractId: "00000000-0000-4000-8000-0000000000ac" as ContractId,
    shiftType: "private",
    tickHz: 20,
    snapshotHz: 10,
    walletLm: 100_000,
  });
  sim.addActor(0, { playerId: "p" as never, displayName: "P", role: "holder" });
  sim.onEvent(() => undefined);
  return sim;
}

const seqs = new Map<MoonRoomSim, number>();
function tick(sim: MoonRoomSim, over: Partial<SimInputCommand> = {}): void {
  const seq = (seqs.get(sim) ?? 0) + 1;
  seqs.set(sim, seq);
  sim.applyInput(0, { seq: seq & 0xffff, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 255, ...over });
  sim.step(sim.config.dt);
}

/** Buys the Trundle, calls it out and takes the handle. */
function seated(): MoonRoomSim {
  const sim = newSim();
  const r = sim.applyIntent(0, { kind: "purchase", requestId: "r1" as RequestId, itemId: "vehicle.trundle" });
  expect(r?.ok).toBe(true);
  for (const b of [M.seatSwitch, M.interact]) {
    tick(sim, { buttons: b });
    tick(sim);
  }
  expect(sim.vehicles.driving[0]).toBe(0);
  return sim;
}

/** Drive script: throttle, then a right turn, then a boosted left arc. */
function driveInput(k: number): Partial<SimInputCommand> {
  return { moveY: 127, moveX: k < 20 ? 0 : k < 50 ? 127 : -90, buttons: k >= 50 && k < 70 ? M.lope | M.boost : 0 };
}

/** The Solo frame encoder's body yaw (heading frame north / east, 10-bit). */
const basis = new Float64Array(9);
function bodyYawCode(a: AvatarState): number {
  headingBasis(a, basis);
  const north = a.fx * basis[3]! + a.fy * basis[4]! + a.fz * basis[5]!;
  const east = a.fx * basis[6]! + a.fy * basis[7]! + a.fz * basis[8]!;
  return yawToCode(atan2Det(east, north));
}

describe("client Trundle prediction uses the sim's VEHICLE_FEEL", () => {
  test("the client and the sim read one table", () => {
    expect(VEHICLE_HANDLING).toBe(VEHICLE_FEEL);
    expect(TRUNDLE.handleBackM).toBeGreaterThan(0);
  });

  test("rebuilt chassis matches the authoritative vehicle every tick (exact yaw: < 1 mm; 10-bit yaw: < 1 cm)", () => {
    const sim = seated();
    const v = sim.vehicles.store.vehicles[0]!;
    const exact = new VehicleDriveView();
    const coded = new VehicleDriveView();
    exact.setActive(true, "vehicle.trundle");
    coded.setActive(true, "vehicle.trundle");
    const feet = new Float64Array(3);
    const clock = { dt: sim.config.dt };
    let maxExact = 0;
    let maxCoded = 0;
    let moved = 0;
    for (let k = 0; k < 90; k++) {
      tick(sim, driveInput(k));
      const a = sim.avatar(0);
      feet[0] = a.px;
      feet[1] = a.py;
      feet[2] = a.pz;
      headingBasis(a, basis);
      const yaw = atan2Det(
        a.fx * basis[6]! + a.fy * basis[7]! + a.fz * basis[8]!,
        a.fx * basis[3]! + a.fy * basis[4]! + a.fz * basis[5]!,
      );
      exact.update(feet, yaw, 0, 0, false, clock);
      coded.update(feet, yawFromCode(bodyYawCode(a)), 0, 0, false, clock);
      // Compare in the tangent plane: the handle is projected to the ground radius, the chassis rides above it.
      const r = Math.hypot(v.px, v.py, v.pz);
      const ux = v.px / r;
      const uy = v.py / r;
      const uz = v.pz / r;
      for (const [view, isExact] of [
        [exact, true],
        [coded, false],
      ] as const) {
        const p = view.vehiclePose;
        const dx = p.px - v.px;
        const dy = p.py - v.py;
        const dz = p.pz - v.pz;
        const radial = dx * ux + dy * uy + dz * uz;
        const tangential = Math.hypot(dx - radial * ux, dy - radial * uy, dz - radial * uz);
        if (isExact) maxExact = Math.max(maxExact, tangential);
        else maxCoded = Math.max(maxCoded, tangential);
      }
      moved = Math.max(moved, v.speed);
    }
    expect(moved).toBeGreaterThan(2); // it really drove
    expect(maxExact).toBeLessThan(1e-3);
    expect(maxCoded).toBeLessThan(1e-2);
    // A wrong handle offset (the old hard-coded fallback idea) would miss by the difference: the table is load-bearing.
    const wrong = new VehicleDriveView({ "vehicle.trundle": { ...TRUNDLE, handleBackM: TRUNDLE.handleBackM + 0.3 } });
    wrong.setActive(true, "vehicle.trundle");
    const a = sim.avatar(0);
    feet[0] = a.px;
    feet[1] = a.py;
    feet[2] = a.pz;
    wrong.update(feet, yawFromCode(bodyYawCode(a)), 0, 0, false, clock);
    const miss = Math.hypot(wrong.vehiclePose.px - v.px, wrong.vehiclePose.py - v.py, wrong.vehiclePose.pz - v.pz);
    expect(miss).toBeGreaterThan(0.25);
  });

  test("unknown kind ids fall back to the Trundle feel, not a literal", () => {
    const view = new VehicleDriveView();
    view.setActive(true, "vehicle.unknown");
    const R = newSim().config.moonRadiusM;
    view.update(new Float64Array([0, R, 0]), 0, 0, 0, false, { dt: 1 / 60 });
    const p = view.vehiclePose;
    expect(Math.hypot(p.px, p.py - R, p.pz)).toBeCloseTo(TRUNDLE.handleBackM, 9);
  });

  test("same inputs on two sims: identical vehicle hash every tick (deterministic authority the prediction follows)", () => {
    const a = seated();
    const b = seated();
    const ha = new Fnv1a32();
    const hb = new Fnv1a32();
    for (let k = 0; k < 90; k++) {
      tick(a, driveInput(k));
      tick(b, driveInput(k));
      ha.reset();
      hb.reset();
      hashVehicle(a.vehicles.store.vehicles[0]!, ha);
      hashVehicle(b.vehicles.store.vehicles[0]!, hb);
      expect(ha.value).toBe(hb.value);
    }
  });
});
