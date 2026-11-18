// Solo read-out path (worker sampler -> structured-clone message -> main-thread cache): the Landing Apron plots reach the
// objective marker source with the sim's own directions, and an unchanged sample posts nothing.
import { describe, expect, test } from "vitest";
import { INPUT_BUTTON_MASK, STANDARD_GRID_PARAMS, type ContractId, type RequestId } from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { createRoomDustLedger, MoonRoomSim, type SimWorld } from "@moon-cleanup/sim";
import { createPlotGrid } from "@moon-cleanup/world";
import { HostReadouts, ReadoutSampler } from "./readouts";
import { READOUT_INTERVAL_MS } from "./messages";

const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: { heightAtXYZ: () => 0 } };

function newSim(): MoonRoomSim {
  const sim = new MoonRoomSim({
    data,
    world,
    ledger: createRoomDustLedger(grid, data, { tickHz: 20 }),
    contractId: "00000000-0000-4000-8000-0000000000ae" as ContractId,
    shiftType: "private",
    tickHz: 20,
    snapshotHz: 10,
    walletLm: 100_000,
  });
  sim.addActor(0, { playerId: "p" as never, displayName: "P", role: "holder" });
  sim.onEvent(() => undefined);
  return sim;
}

describe("read-out Apron forwarding (Solo)", () => {
  test("the host cache answers apronPlotCount / apronPlot like the sim, through a structured clone", () => {
    const sim = newSim();
    const sampler = new ReadoutSampler();
    const host = new HostReadouts();
    sampler.request(host.nextRequest([]), false, []);
    expect(host.apronPlotCount).toBe(0);
    const m = sampler.sample(sim, 0, 0);
    expect(m).not.toBeNull();
    expect(host.accept(structuredClone(m!))).toBe(true);
    expect(sim.apronPlotCount).toBeGreaterThan(0);
    expect(host.apronPlotCount).toBe(sim.apronPlotCount);
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < sim.apronPlotCount; k++) {
      expect(host.apronPlot(k, a)).toBe(true);
      expect(sim.apronPlot(k, b)).toBe(true);
      expect(a).toEqual(b);
    }
    expect(host.apronPlot(sim.apronPlotCount, a)).toBe(false);
    expect(host.apronPlot(-1, a)).toBe(false);
    // Nothing changed: the sampler posts nothing at the next interval (Apron dirs are part of the compare).
    expect(sampler.sample(sim, 0, READOUT_INTERVAL_MS + 1)).toBeNull();
  });
});

describe("vehicle audio read-out forwarding", () => {
  test("real seated Trundle speed, load and grounded intake cross structured-clone/cache; stop/exit are changes", () => {
    const sim = newSim();
    expect(
      sim.applyIntent(0, { kind: "purchase", requestId: "audio-vehicle" as RequestId, itemId: "vehicle.trundle" })?.ok,
    ).toBe(true);
    let seq = 0;
    const step = (buttons: number): void => {
      sim.applyInput(0, { seq: ++seq, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons, toolParam: 0 });
      sim.step(sim.config.dt);
    };
    step(INPUT_BUTTON_MASK.seatSwitch);
    step(0);
    step(INPUT_BUTTON_MASK.interact);
    expect(sim.vehicles.driving[0]).toBe(0);
    const vehicle = sim.vehicles.store.vehicles[0]!;
    vehicle.speed = vehicle.stats.cruiseMps * vehicle.stats.speedMult * 0.5;
    vehicle.hopperGrams = vehicle.stats.payloadGrams * 0.75;
    vehicle.intakeDown = true;
    const sampler = new ReadoutSampler();
    const host = new HostReadouts();
    sampler.request(host.nextRequest([]), false, []);
    const moving = sampler.sample(sim, 0, 0)!;
    host.accept(structuredClone(moving));
    expect(host.vehicleMotion).toMatchObject({
      kindId: "vehicle.trundle",
      speed01: 0.5,
      load01: 0.75,
      workIntensity01: 0.5,
    });
    expect(sampler.sample(sim, 0, 100)).toBeNull();
    vehicle.boosting = true;
    expect(sampler.sample(sim, 0, 200)?.vehicleMotion?.workIntensity01).toBe(0);
    vehicle.boosting = false;
    vehicle.speed *= -1;
    expect(sampler.sample(sim, 0, 300)).toBeNull(); // reverse has the same motor speed, attachment stays stopped
    vehicle.speed *= -1;
    vehicle.hopperGrams = vehicle.stats.payloadGrams;
    expect(sampler.sample(sim, 0, 400)?.vehicleMotion).toMatchObject({ load01: 1, workIntensity01: 0 });
    vehicle.hopperGrams = vehicle.stats.payloadGrams * 0.75;
    vehicle.intakeDown = false;
    expect(sampler.sample(sim, 0, 500)?.vehicleMotion?.workIntensity01).toBe(0);
    vehicle.speed = 0;
    expect(sampler.sample(sim, 0, 600)?.vehicleMotion?.speed01).toBe(0);
    sim.vehicles.driving[0] = -1;
    const exited = sampler.sample(sim, 0, 700)!;
    expect(exited.vehicleMotion).toBeNull();
    host.accept(structuredClone(exited));
    expect(host.vehicleMotion).toBeNull();
    host.reset();
    expect(host.vehicleMotion).toBeUndefined();
  });
});

describe("parked vehicle read-out (a called Trundle is visible before it is boarded)", () => {
  test("own parked vehicle pose is posted, then cleared when boarded", () => {
    const sim = newSim();
    sim.applyIntent(0, { kind: "purchase", requestId: "parked" as RequestId, itemId: "vehicle.trundle" });
    let seq = 0;
    const step = (buttons: number): void => {
      sim.applyInput(0, { seq: ++seq, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons, toolParam: 0 });
      sim.step(sim.config.dt);
    };
    const sampler = new ReadoutSampler();
    const host = new HostReadouts();
    sampler.request(host.nextRequest([]), false, []);
    host.accept(structuredClone(sampler.sample(sim, 0, 0)!));
    expect(host.parkedVehicle).toBeNull();
    step(INPUT_BUTTON_MASK.seatSwitch);
    step(0);
    const v = sim.vehicles.store.vehicles[0]!;
    expect(v.active).toBe(true);
    const msg = sampler.sample(sim, 0, 200)!;
    host.accept(structuredClone(msg));
    expect(host.parkedVehicle).toMatchObject({ x: v.px, y: v.py, z: v.pz, fx: v.fx, fy: v.fy, fz: v.fz });
    step(INPUT_BUTTON_MASK.interact);
    const boarded = sampler.sample(sim, 0, 400)!;
    host.accept(structuredClone(boarded));
    expect(host.parkedVehicle).toBeNull();
  });
});
