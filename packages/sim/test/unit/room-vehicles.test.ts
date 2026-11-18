// M1-W7-T01 room wiring: purchases through the wallet, calling / entering / leaving the Trundle from the input command,
// driving with the avatar on the handle, vehicle strokes in the room's stroke pool, hopper -> Dump Plate -> Receiving
// Gate payout, snapshot / ShiftState records, checkpoint round trip, determinism.
import { describe, expect, test } from "vitest";
import { INPUT_BUTTON_MASK as M, type RequestId, type RoomSimEvent, type SimInputCommand } from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { createSimConfig, VehicleReadout, type MoonRoomSim } from "../../src/index";
import { flatWorld, makeSim, PLAYER } from "../support/world";

const cfg = createSimConfig(loadGameData());
const GATE = { kind: "receiving_gate" as const, x: 0.0, y: 1, z: 0.0 };

function input(seq: number, over: Partial<SimInputCommand> = {}): SimInputCommand {
  return { seq: seq & 0xffff, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 255, ...over };
}

class Driver {
  seq = 1;
  readonly events: RoomSimEvent[] = [];
  constructor(readonly sim: MoonRoomSim) {
    sim.onEvent((e) => this.events.push(e));
  }
  run(ticks: number, f: (k: number) => Partial<SimInputCommand> = () => ({})): void {
    for (let k = 0; k < ticks; k++) {
      this.sim.applyInput(0, input(this.seq++, f(k)));
      this.sim.step(cfg.dt);
    }
  }
  tap(button: number): void {
    this.run(1, () => ({ buttons: button }));
    this.run(1);
  }
  buy(itemId: string): { ok: boolean; code?: string } {
    const r = this.sim.applyIntent(0, { kind: "purchase", requestId: `r${this.seq++}` as RequestId, itemId });
    return r === null ? { ok: false } : r.ok ? { ok: true } : { ok: false, code: r.code };
  }
  named(name: string): RoomSimEvent[] {
    return this.events.filter((e) => e.name === name);
  }
}

function room(extra = {}): Driver {
  const sim = makeSim(flatWorld(), { walletLm: 100_000, sellPoints: [GATE], ...extra });
  sim.addActor(0, PLAYER);
  return new Driver(sim);
}

/** Buys a vehicle, calls it, sits down. */
function seated(extra = {}): Driver {
  const d = room(extra);
  expect(d.buy("vehicle.trundle").ok).toBe(true);
  d.tap(M.seatSwitch);
  expect(d.sim.vehicles.store.activeCount()).toBe(1);
  d.tap(M.interact);
  expect(d.sim.vehicles.driving[0]).toBe(0);
  return d;
}

describe("purchases", () => {
  test("Trundle at list, Repeat Requisition at 40 %, upgrades need the vehicle and stop at the top level", () => {
    const d = room();
    const w0 = d.sim.wallet;
    expect(d.sim.quotePriceLm(0, "vehicle.trundle")).toBe(2100);
    expect(d.buy("vehicle.trundle").ok).toBe(true);
    expect(d.sim.wallet).toBe(w0 - 2100);
    expect(d.sim.quotePriceLm(0, "vehicle.trundle")).toBe(Math.round(2100 * cfg.repeatRequisitionFrac));
    expect(d.buy("vehicle_upgrade.gear_ratio").ok).toBe(true);
    expect(d.sim.wallet).toBe(w0 - 2100 - 420);
    expect(d.buy("vehicle_upgrade.gear_ratio").ok).toBe(true);
    expect(d.buy("vehicle_upgrade.gear_ratio").ok).toBe(true);
    expect(d.buy("vehicle_upgrade.gear_ratio")).toEqual({ ok: false, code: "max_level" });
    expect(d.buy("vehicle.skiff")).toEqual({ ok: false, code: "unknown_item" }); // M2
    const events = d.named("purchase.completed");
    expect(events).toHaveLength(4);
  });

  test("all 7 upgrade lines are sold (owner 2026-11-17) at their game-data prices, up to their top level", () => {
    const d = room();
    expect(d.buy("vehicle.trundle").ok).toBe(true);
    const lines = loadGameData()["vehicle-upgrades"].lines;
    expect(lines).toHaveLength(7);
    for (const line of lines) {
      for (let lv = 0; lv < line.levels.length; lv++) {
        expect(d.sim.quotePriceLm(0, line.id)).toBe(Math.round(2100 * line.levels[lv]!.costMultOfVehiclePrice));
        expect(d.buy(line.id).ok).toBe(true);
      }
      expect(d.buy(line.id)).toEqual({ ok: false, code: "max_level" });
    }
    expect(d.sim.wallet).toBeGreaterThanOrEqual(0);
  });

  test("vehicleUpgradeLineIds: [] sells no lines", () => {
    const d = room({ vehicleUpgradeLineIds: [] });
    d.buy("vehicle.trundle");
    expect(d.buy("vehicle_upgrade.afterburner")).toEqual({ ok: false, code: "unknown_item" });
  });

  test("an upgrade before the vehicle, a poor wallet and a temp without the permission are refused; nothing is charged", () => {
    const d = room();
    const w0 = d.sim.wallet;
    expect(d.buy("vehicle_upgrade.cargo_expander")).toEqual({ ok: false, code: "prereq_missing" });
    expect(d.sim.wallet).toBe(w0);
    const poor = makeSim(flatWorld(), { walletLm: 100 });
    poor.addActor(0, PLAYER);
    const r = poor.applyIntent(0, { kind: "purchase", requestId: "p1" as RequestId, itemId: "vehicle.trundle" });
    expect(r).toMatchObject({ ok: false, code: "insufficient_funds" });
    expect(poor.wallet).toBe(100);
    const temp = makeSim(flatWorld(), { walletLm: 100_000 });
    temp.addActor(0, { ...PLAYER, role: "temp" });
    expect(
      temp.applyIntent(0, { kind: "purchase", requestId: "t1" as RequestId, itemId: "vehicle.trundle" }),
    ).toMatchObject({
      ok: false,
      code: "role_blocked",
    });
  });

  test("without a pre-built Motor Pool the vehicle needs one first (1,000 Lumens), and the wallet never goes negative", () => {
    const d = room({ motorPoolsBuilt: 0 });
    expect(d.buy("vehicle.trundle")).toEqual({ ok: false, code: "prereq_missing" });
    expect(d.buy("piece.motor_pool").ok).toBe(true);
    expect(d.named("unlock.granted").map((e) => (e.payload as { unlockId: string }).unlockId)).toEqual([
      "vehicle.trundle",
    ]);
    expect(d.buy("vehicle.trundle").ok).toBe(true);
    expect(d.sim.wallet).toBe(100_000 - 1000 - 2100);
    expect(d.sim.wallet).toBeGreaterThanOrEqual(0);
  });
});

describe("calling, driving, leaving", () => {
  test("seatSwitch calls the Trundle out, interact sits down (vehicle.entered), the avatar rides the handle", () => {
    const d = seated();
    expect(d.named("vehicle.entered")).toHaveLength(1);
    const v = d.sim.vehicles.store.vehicles[0]!;
    d.run(40, () => ({ moveY: 127 }));
    expect(v.speed).toBeCloseTo(3, 2);
    const a = d.sim.avatar(0);
    const back = Math.hypot(a.px - v.px, a.py - v.py, a.pz - v.pz);
    expect(back).toBeGreaterThan(0.8);
    expect(back).toBeLessThan(1.0);
    const snap = d.sim.snapshot();
    expect(snap.vehicles).toHaveLength(1);
    expect(snap.vehicles[0]!.driverSlot).toBe(0);
    expect(snap.actors[0]!.avatar.vehicleId).toBe(snap.vehicles[0]!.entityId);
    expect(snap.entityIds).toContain(snap.vehicles[0]!.entityId);
    expect(snap.shift.vehicles).toHaveLength(1);
    expect(snap.shift.vehicles[0]).toMatchObject({ type: "vehicle.trundle", occupied: true });
    expect(snap.shift.players[0]!.vehicleIds).toEqual(["vehicle.trundle"]);
    const ro = new VehicleReadout();
    expect(d.sim.vehicleReadout(0, ro)).toBe(true);
    expect(ro.speed01).toBeGreaterThan(0.9);
    d.tap(M.interact);
    expect(d.named("vehicle.exited")).toHaveLength(1);
    expect(d.sim.vehicleReadout(0, ro)).toBe(false);
    d.run(60);
    expect(v.speed).toBe(0);
    // Walking again: the avatar moves.
    const x0 = d.sim.avatar(0).px;
    const y0 = d.sim.avatar(0).py;
    const z0 = d.sim.avatar(0).pz;
    d.run(20, () => ({ moveY: 127 }));
    const a2 = d.sim.avatar(0);
    expect(Math.hypot(a2.px - x0, a2.py - y0, a2.pz - z0)).toBeGreaterThan(1);
  });

  test("enter is refused out of reach; a second call returns the empty Trundle home; no free vehicle, no spawn", () => {
    const d = room();
    d.tap(M.seatSwitch); // nothing bought: nothing happens
    expect(d.sim.vehicles.store.activeCount()).toBe(0);
    d.buy("vehicle.trundle");
    d.tap(M.seatSwitch);
    expect(d.sim.vehicles.store.activeCount()).toBe(1);
    d.tap(M.seatSwitch); // vehicle out and the avatar next to it: sends it home
    expect(d.sim.vehicles.store.activeCount()).toBe(0);
    d.tap(M.seatSwitch);
    const v = d.sim.vehicles.store.vehicles[0]!;
    expect(v.active).toBe(true);
    // Far from the vehicle the interact press does not seat.
    d.run(60, () => ({ moveY: 127 }));
    d.run(1, () => ({ buttons: M.interact }));
    expect(d.sim.vehicles.driving[0]).toBe(-1);
  });

  test("a leaving owner takes the Trundle home and its dust stays accounted for", () => {
    const d = seated();
    const v = d.sim.vehicles.store.vehicles[0]!;
    v.hopperGrams = 12_345;
    d.sim.removeActor(0);
    expect(v.active).toBe(false);
    expect(d.sim.vehicles.hopperCarry[0]).toBe(12_345);
    expect(d.named("vehicle.exited")).toHaveLength(1);
  });
});

describe("vehicle cleaning and the Dump Plate", () => {
  test("driving cleans: strokes enter the room's pool with the vehicle actor slot, dust fills the hopper", () => {
    const d = seated({ sellPoints: [{ kind: "assay_counter", x: 0, y: 1, z: 0 }] }); // no Gate near
    const v = d.sim.vehicles.store.vehicles[0]!;
    let vehicleStrokes = 0;
    let width = 0;
    for (let k = 0; k < 160; k++) {
      d.run(1, () => ({ moveY: 127 }));
      for (let i = 0; i < d.sim.strokeCount; i++) {
        const s = d.sim.strokeAt(i);
        if (s.actorSlot >= 16) {
          vehicleStrokes++;
          width = s.widthCm;
        }
      }
    }
    expect(vehicleStrokes).toBeGreaterThan(10);
    expect(width).toBe(160);
    expect(v.hopperGrams).toBeGreaterThan(0);
    expect(v.hopperGrams).toBeLessThanOrEqual(v.stats.payloadGrams);
  });

  test("a loaded Trundle that stops at a plate against a Gate unloads and is paid; mass sold equals mass carried", () => {
    const d = seated();
    const v = d.sim.vehicles.store.vehicles[0]!;
    v.hopperGrams = 10_000; // 10 kg
    const w0 = d.sim.wallet;
    d.run(5, () => ({ moveY: 127 }));
    expect(v.hopperGrams).toBeGreaterThanOrEqual(10_000); // nowhere near the Gate (slot 0 spawns 15 m off): keeps it
    v.px = 0;
    v.py = cfg.moonRadiusM; // the Gate at the pole
    v.pz = 0;
    d.run(30); // coasts to a stop within reach of the plate, then tips for 2 s (40 ticks) and unloads once
    expect(v.hopperGrams).toBeGreaterThan(0);
    d.run(40);
    expect(v.hopperGrams).toBe(0);
    expect(d.sim.wallet).toBeGreaterThan(w0);
    const sold = d.named("cargo.sold");
    expect(sold).toHaveLength(1);
    const p = sold[0]!.payload as { source: string; kg: number; actorSlot: number };
    expect(p.source).toBe("receiving_gate");
    expect(p.kg).toBeGreaterThanOrEqual(10); // the 10 kg plus what it swept up on the way
    expect(p.actorSlot).toBe(0);
    d.run(20);
    expect(d.named("cargo.sold")).toHaveLength(1); // nothing left to tip
  });

  /** Ticks from the stop at the plate to the sale, with `fastTip` levels of Fast Tip. */
  function tipTicks(fastTip: number): number {
    const d = seated();
    for (let k = 0; k < fastTip; k++) expect(d.buy("vehicle_upgrade.fast_tip").ok).toBe(true);
    const v = d.sim.vehicles.store.vehicles[0]!;
    v.px = 0;
    v.py = cfg.moonRadiusM;
    v.pz = 0;
    v.speed = 0;
    v.hopperGrams = 5000;
    const ro = new VehicleReadout();
    let ticks = 0;
    let sawTip = false;
    while (v.hopperGrams > 0 && ticks < 200) {
      d.run(1);
      ticks++;
      d.sim.vehicleReadout(0, ro);
      if (ro.tip01 > 0) sawTip = true;
    }
    expect(sawTip || ticks === 1).toBe(true);
    expect(d.named("cargo.sold")).toHaveLength(1);
    return ticks;
  }

  test("Fast Tip shortens the hopper tip: 2 s, -40 %, -70 % (feel tipS x vehicleUnloadTimeMult)", () => {
    expect(tipTicks(0)).toBe(Math.round(2 * cfg.tickHz));
    expect(tipTicks(1)).toBe(Math.round(2 * cfg.tickHz * 0.6));
    expect(tipTicks(2)).toBe(Math.round(2 * cfg.tickHz * 0.3));
  });

  test("driving off the plate mid-tip cancels it and keeps the dust aboard", () => {
    const d = seated();
    const v = d.sim.vehicles.store.vehicles[0]!;
    v.px = 0;
    v.py = cfg.moonRadiusM;
    v.pz = 0;
    v.speed = 0;
    v.hopperGrams = 5000;
    d.run(10);
    expect(v.tipTicksLeft).toBeGreaterThan(0);
    d.run(1, () => ({ moveY: 127 }));
    expect(v.tipTicksLeft).toBe(0);
    expect(v.hopperGrams).toBeGreaterThanOrEqual(5000);
    expect(d.named("cargo.sold")).toHaveLength(0);
  });

  test("Running Lamps: lights key needs the upgrade; buying it switches them on; Throttle Lock and Afterburner apply", () => {
    const d = seated();
    const v = d.sim.vehicles.store.vehicles[0]!;
    d.tap(M.lampCycle);
    expect(v.lights).toBe(false); // no Running Lamps: nothing to switch
    d.buy("vehicle_upgrade.running_lamps");
    expect(v.lights).toBe(true);
    expect(v.stats.lampRangeM).toBe(30);
    d.tap(M.lampCycle);
    expect(v.lights).toBe(false);
    d.buy("vehicle_upgrade.afterburner");
    expect(v.stats.boostMult).toBe(1.45);
    d.buy("vehicle_upgrade.throttle_lock");
    d.run(40, () => ({ moveY: 127 }));
    d.run(1, () => ({ buttons: M.laneLock })); // throttle input would cancel the lock again
    d.run(20);
    expect(v.gear).toBe(3); // locked: holds speed hands-free
    expect(v.speed).toBeGreaterThan(2.9);
    const ro = new VehicleReadout();
    d.sim.vehicleReadout(0, ro);
    expect([ro.hasLamps, ro.lockAvailable, ro.locked]).toEqual([true, true, true]);
  });

  test("returning to the Motor Pool away from a Gate keeps a loaded vehicle out (dust is never destroyed)", () => {
    const d = room({ sellPoints: [{ kind: "assay_counter", x: 0, y: 1, z: 0 }] });
    d.buy("vehicle.trundle");
    d.tap(M.seatSwitch);
    const v = d.sim.vehicles.store.vehicles[0]!;
    v.hopperGrams = 5000;
    d.tap(M.seatSwitch);
    expect(v.active).toBe(true);
    expect(v.hopperGrams).toBe(5000);
    expect(d.sim.vehicles.counters.returnsRefused).toBe(1);
  });
});

describe("checkpoint and determinism", () => {
  test("purchases and carried hopper dust survive a checkpoint round trip; vehicles out return to the pool", () => {
    const d = seated();
    d.buy("vehicle_upgrade.gear_ratio");
    d.buy("vehicle_upgrade.cargo_expander");
    d.buy("vehicle_upgrade.cargo_expander");
    d.sim.vehicles.store.vehicles[0]!.hopperGrams = 70_000; // beyond one byte: three key bytes
    const cp = d.sim.captureCheckpoint();
    const fresh = makeSim(flatWorld(), { walletLm: 0, sellPoints: [GATE] });
    fresh.addActor(0, PLAYER);
    const res = fresh.restoreCheckpoint(cp);
    expect(res.ok).toBe(true);
    expect(res.ignoredGearKeys).toBe(0);
    expect(fresh.vehicles.pool.copies[0]).toBe(1);
    expect(fresh.vehicles.pool.levelOf(0, 0)).toBe(1);
    expect(fresh.vehicles.pool.levelOf(0, 1)).toBe(2);
    expect(fresh.vehicles.store.activeCount()).toBe(0);
    expect(fresh.vehicles.hopperCarry[0]).toBe(70_000);
    // The next call brings the carried dust along.
    const fd = new Driver(fresh);
    fd.tap(M.seatSwitch);
    const v = fresh.vehicles.store.vehicles[0]!;
    expect(v.active).toBe(true);
    expect(v.hopperGrams).toBe(70_000);
    expect(v.stats.speedMult).toBeCloseTo(1.08, 9);
    expect(v.stats.payloadGrams).toBe(Math.round(200_000 * 1.8));
  });

  test("a shift that never touches vehicles checkpoints without vehicle keys", () => {
    const d = room();
    const cp = d.sim.captureCheckpoint();
    const text = String.fromCharCode(...cp.meta);
    expect(text).not.toContain("veh.");
  });

  function replay(): number {
    const d = seated();
    d.buy("vehicle_upgrade.gear_ratio");
    d.run(400, (k) => ({
      moveY: k % 150 < 120 ? 127 : -60,
      moveX: Math.round(Math.sin(k / 17) * 100),
      buttons: k % 100 > 70 ? M.boost : 0,
      yaw: 0,
    }));
    return d.sim.stateHash();
  }

  test("the same inputs give the same room state hash (golden)", () => {
    const a = replay();
    expect(replay()).toBe(a);
    expect(a).toBe(ROOM_VEHICLE_GOLDEN);
  });
});
const ROOM_VEHICLE_GOLDEN = 1063261705; // re-recorded with the 3-probe ground read (first record: 2665867607)
