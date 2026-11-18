// Landing Apron and Induction steps owned by the sim: the Apron plots are derived from the grid and game-data, and
// `onboarding.step_completed` is sent once per slot for a first stroke / first Polish on an Apron plot only.
import { describe, expect, test } from "vitest";
import { INPUT_BUTTON_MASK as M, type PlotId, type RoomSimEvent, type SimEventMap } from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { type MoonRoomSim } from "../../src/index";
import { makeSim, PLAYER, testWorld } from "../support/world";

function collect(sim: MoonRoomSim): RoomSimEvent[] {
  const list: RoomSimEvent[] = [];
  sim.onEvent((e) => list.push(e));
  return list;
}

function sweep(sim: MoonRoomSim, ticks: number): void {
  for (let k = 0; k < ticks; k++) {
    const n = sim.tick + 1;
    sim.applyInput(0, {
      seq: n & 0xffff,
      moveX: 0,
      moveY: 60,
      yaw: (n * 300) % 65536,
      pitch: -20,
      buttons: M.toolPrimary,
      toolParam: 200,
    });
    sim.step(sim.config.dt);
    sim.drainCell(0);
  }
}

describe("Landing Apron", () => {
  const plots = loadGameData().world.landingApron.plotsPerOutpost;

  test("has plotsPerOutpost plots of ring 2 around the home pad plot, each with a unit direction", () => {
    const world = testWorld();
    const sim = makeSim(world, {});
    expect(sim.apronPlotCount).toBe(plots);
    const home = world.grid.plotAt({ x: 0, y: 1, z: 0 });
    const nb = (p: number): number[] =>
      Array.from({ length: world.grid.neighbors(p as PlotId).length }, (_, i) => world.grid.neighbors(p as PlotId)[i]!);
    const ring1 = new Set<number>([home, ...nb(home)]);
    let found = 0;
    for (let p = 0; p < world.grid.count; p++) {
      if (!sim.isApronPlot(p)) continue;
      found++;
      expect(ring1.has(p)).toBe(false);
      expect(nb(p).some((n) => ring1.has(n) && n !== home)).toBe(true);
    }
    expect(found).toBe(plots);
    const c = { x: 0, y: 0, z: 0 };
    expect(sim.apronPlot(0, c)).toBe(true);
    expect(Math.hypot(c.x, c.y, c.z)).toBeCloseTo(1, 9);
    expect(sim.apronPlot(plots, c)).toBe(false);
  });

  test("is deterministic across sims", () => {
    const a = makeSim(testWorld(), {});
    const b = makeSim(testWorld(), {});
    const ca = { x: 0, y: 0, z: 0 };
    const cb = { x: 0, y: 0, z: 0 };
    a.apronPlot(2, ca);
    b.apronPlot(2, cb);
    expect(ca).toEqual(cb);
  });

  test("first stroke step is sent once, for the slot that collected from an Apron plot", () => {
    const probe = makeSim(testWorld(), {});
    const c = { x: 0, y: 0, z: 0 };
    probe.apronPlot(0, c);
    const sim = makeSim(testWorld(), { spawnDirection: c });
    sim.addActor(0, PLAYER);
    const events = collect(sim);
    sweep(sim, 400);
    const apronHit = events.some(
      (e) => e.name === "dust.collected" && e.payload.plotIds.some((p) => sim.isApronPlot(p)),
    );
    expect(apronHit).toBe(true);
    const steps = events.filter((e) => e.name === "onboarding.step_completed");
    expect(steps.length).toBe(1);
    const p = steps[0]!.payload as SimEventMap["onboarding.step_completed"];
    expect(p).toMatchObject({ stepId: "onboarding.first_stroke", actorSlot: 0, index: 0 });
    sweep(sim, 100);
    expect(events.filter((e) => e.name === "onboarding.step_completed").length).toBe(1);
  });

  test("strokes away from the Apron send no step", () => {
    const sim = makeSim(testWorld(), { spawnDirection: { x: 1, y: 0, z: 0 } });
    sim.addActor(0, PLAYER);
    const events = collect(sim);
    sweep(sim, 300);
    expect(events.some((e) => e.name === "dust.collected")).toBe(true);
    expect(events.some((e) => e.name === "onboarding.step_completed")).toBe(false);
  });
});
