import { describe, expect, it } from "vitest";
import type { EventMap, PlotId } from "@moon-cleanup/shared";
import { GrainPool } from "../grains";
import { MOMENT_POUR, MOMENT_RAILSHOT, MOMENT_STAMP, MomentFx, STAMP_OUTLINE_S, RAILSHOT_BURST } from "./moments";
import { GRAIN_BUSY_S, MomentsRig, POUR_SECONDS, STAMP_RADIUS_M, type MomentsPort } from "./moments-rig";

type Listener = (p: never) => void;

function fakeBus() {
  const listeners = new Map<string, Listener[]>();
  return {
    on(name: string, l: Listener) {
      const list = listeners.get(name) ?? [];
      list.push(l);
      listeners.set(name, list);
      return () => {
        const i = list.indexOf(l);
        if (i >= 0) list.splice(i, 1);
      };
    },
    emit<K extends keyof EventMap>(name: K, payload: Partial<EventMap[K]>) {
      for (const l of listeners.get(name) ?? []) l(payload as never);
    },
    count: (name: string) => listeners.get(name)?.length ?? 0,
  };
}

function setup(own = 0) {
  const pool = new GrainPool(2048, 3);
  const fx = new MomentFx(pool);
  const bus = fakeBus();
  const port: MomentsPort = {
    ownSlot: () => own,
    avatar: (o) => {
      o.x = 10;
      o.y = 0.5;
      o.z = -4;
      o.dirX = 0;
      o.dirZ = 1;
      return true;
    },
    plotCentre: (_plot, o) => {
      o.x = 3;
      o.y = 0;
      o.z = 7;
      return true;
    },
  };
  const rig = new MomentsRig(fx, port, bus as never);
  return { pool, fx, bus, rig };
}

describe("MomentsRig", () => {
  it("is idle (inactive, nothing emitted) until an event fires", () => {
    const { rig, pool } = setup();
    for (let i = 0; i < 120; i++) expect(rig.update(1 / 60)).toBe(false);
    expect(pool.emitted).toBe(0);
    expect(rig.fx.liveCount()).toBe(0);
  });

  it("an own plot.polished starts a Stamp at the plot centre and its grain burst fires at emblem impact", () => {
    const { rig, bus, pool, fx } = setup();
    bus.emit("plot.polished", { plotId: 5 as PlotId, creditedSlot: 0, charged: false });
    expect(fx.liveCount()).toBe(1);
    expect(fx.kind[0]).toBe(MOMENT_STAMP);
    expect([fx.x[0], fx.z[0], fx.size[0]]).toEqual([3, 7, Math.fround(STAMP_RADIUS_M)]);
    expect(rig.active).toBe(true);
    expect(pool.emitted).toBe(0);
    for (let t = 0; t < STAMP_OUTLINE_S + 0.1; t += 1 / 60) rig.update(1 / 60);
    expect(pool.emitted).toBe(64);
  });

  it("ignores another player's Stamp and the robots' (null credit)", () => {
    const { rig, bus, fx } = setup(0);
    bus.emit("plot.polished", { plotId: 5 as PlotId, creditedSlot: 3 });
    bus.emit("plot.polished", { plotId: 5 as PlotId, creditedSlot: null });
    expect(fx.liveCount()).toBe(0);
    expect(rig.active).toBe(false);
  });

  it("a pour emits ticks for POUR_SECONDS, an own assay sale flashes, other sales do not", () => {
    const { rig, bus, fx, pool } = setup();
    bus.emit("cargo.pour_started", { actorSlot: 0, pourSlot: 1 });
    for (let t = 0; t < POUR_SECONDS + 0.5; t += 1 / 60) rig.update(1 / 60);
    const ticks = pool.emitted / 6;
    expect(ticks).toBeGreaterThan(8);
    expect(ticks).toBeLessThan(16);
    bus.emit("cargo.sold", { source: "receiving_gate", actorSlot: 0 });
    bus.emit("cargo.sold", { source: "assay_counter", actorSlot: 2 });
    expect(fx.liveCount()).toBe(0);
    bus.emit("cargo.sold", { source: "assay_counter", actorSlot: 0 });
    expect(fx.kind[0]).toBe(MOMENT_POUR);
    expect(fx.z[0]).toBeCloseTo(-4 + 1.4, 5); // in front of the feet along the heading
  });

  it("a Railshot bursts immediately and keeps the layers active until the grains landed", () => {
    const { rig, bus, pool, fx } = setup();
    bus.emit("railshot.fired", {});
    expect(fx.kind[0]).toBe(MOMENT_RAILSHOT);
    expect(pool.emitted).toBe(RAILSHOT_BURST.count);
    let active = true;
    let t = 0;
    for (; active && t < 30; t += 1 / 60) active = rig.update(1 / 60);
    expect(t).toBeGreaterThan(GRAIN_BUSY_S - 0.1);
    expect(t).toBeLessThan(GRAIN_BUSY_S + 0.2);
  });

  it("dispose unsubscribes from every event", () => {
    const { rig, bus } = setup();
    expect(bus.count("plot.polished") + bus.count("railshot.fired")).toBe(2);
    rig.dispose();
    expect(
      bus.count("plot.polished") +
        bus.count("cargo.pour_started") +
        bus.count("cargo.sold") +
        bus.count("railshot.fired"),
    ).toBe(0);
  });

  it("allocates nothing per event or frame in steady state (reused sample, fixed tables)", () => {
    const { rig, bus } = setup();
    // Warm up, then run many events through; the slot table and sample objects are fixed, so heap growth stays small.
    for (let i = 0; i < 50; i++) {
      bus.emit("plot.polished", { plotId: 1 as PlotId, creditedSlot: 0 });
      rig.update(0.05);
    }
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2000; i++) {
      bus.emit("railshot.fired", {});
      rig.update(0.05);
    }
    // Railshots fill the grain pool (typed arrays, preallocated); anything per-event on the JS heap would be MBs.
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(4_000_000);
  });
});
