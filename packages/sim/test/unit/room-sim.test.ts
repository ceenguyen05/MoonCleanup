import { describe, expect, test } from "vitest";
import {
  INPUT_BUTTON_MASK as M,
  STROKE_MAX_SEGMENT_MM,
  type RequestId,
  type RoomSimEvent,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import {
  atanDet,
  cosTurn,
  createSimConfig,
  dayPhaseAt,
  isDaylightAt,
  MOVE_AIRBORNE,
  MOVE_GROUNDED,
  sinTurn,
  strokeDepth16,
  toolCodeOf,
  type MoonRoomSim,
} from "../../src/index";
import { flatWorld, makeSim, PLAYER, testWorld } from "../support/world";

const cfg = createSimConfig(loadGameData());

function input(seq: number, over: Partial<SimInputCommand> = {}): SimInputCommand {
  return { seq: seq & 0xffff, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 255, ...over };
}

function run(sim: MoonRoomSim, ticks: number, f: (t: number) => Partial<SimInputCommand>, start = 1): void {
  for (let t = start; t < start + ticks; t++) {
    sim.applyInput(0, input(t, f(t)));
    sim.step(cfg.dt);
  }
}

function speed(sim: MoonRoomSim): number {
  const a = sim.avatar(0);
  return Math.hypot(a.vx, a.vy, a.vz);
}

function radius(sim: MoonRoomSim): number {
  const a = sim.avatar(0);
  return Math.hypot(a.px, a.py, a.pz);
}

describe("deterministic math", () => {
  test("sine table matches Math.sin within 1e-6 and atanDet within 2e-5", () => {
    for (let u = 0; u < 65536; u += 97) {
      const r = (u / 65536) * 2 * Math.PI;
      expect(Math.abs(sinTurn(u) - Math.sin(r))).toBeLessThan(1e-6);
      expect(Math.abs(cosTurn(u) - Math.cos(r))).toBeLessThan(1e-6);
    }
    for (let x = -20; x <= 20; x += 0.37) expect(Math.abs(atanDet(x) - Math.atan(x))).toBeLessThan(2e-5);
  });
});

describe("config from game-data", () => {
  test("20 Hz fixed step, stroke every 2 ticks, tool tuning per game-feel 3.1", () => {
    expect(cfg.tickHz).toBe(20);
    expect(cfg.frameIntervalTicks).toBe(2);
    expect(cfg.jumpV0Mps).toBeCloseTo(2.277, 2);
    const duster = cfg.tools[toolCodeOf(cfg, "tool.desk_duster")]!;
    expect(duster.widthCm).toBe(15);
    expect(duster.periodMs).toBe(450);
    expect(duster.pushM).toBeCloseTo(0.45, 2);
    expect(duster.aimMinM).toBeCloseTo(0.9, 2);
    expect(duster.cellBaseGrams).toBe(4000);
    expect(strokeDepth16(cfg, duster, false, 0)).toBe(80);
    expect(strokeDepth16(cfg, duster, true, 0)).toBe(56); // night penalty 0.3
    const rake = cfg.tools[toolCodeOf(cfg, "tool.static_rake")]!;
    expect(strokeDepth16(cfg, rake, true, 0)).toBe(255); // Charge
  });
});

describe("low-g movement (flat ground)", () => {
  test("walk reaches 3.4 m/s in about 4 ticks and stops on release", () => {
    const sim = makeSim(flatWorld());
    sim.addActor(0, PLAYER);
    run(sim, 4, () => ({ moveY: 127 }));
    expect(speed(sim)).toBeCloseTo(cfg.walkMps, 4);
    run(sim, 20, () => ({ moveY: 127 }), 5);
    expect(speed(sim)).toBeCloseTo(cfg.walkMps, 4);
    run(sim, 6, () => ({}), 25);
    expect(speed(sim)).toBe(0);
  });

  test("Lope is faster, sweeping is slower", () => {
    const lope = makeSim(flatWorld());
    lope.addActor(0, PLAYER);
    run(lope, 20, () => ({ moveY: 127, buttons: M.lope }));
    expect(speed(lope)).toBeCloseTo(cfg.lopeMps, 4);
    const sweep = makeSim(flatWorld());
    sweep.addActor(0, PLAYER);
    run(sweep, 20, () => ({ moveY: 127, buttons: M.toolPrimary }));
    expect(speed(sweep)).toBeCloseTo(cfg.sweepWalkMps, 4);
  });

  test("full jump peaks near 1.6 m and lasts about 2.8 s; a tap (jump cut) is much lower", () => {
    const sim = makeSim(flatWorld());
    sim.addActor(0, PLAYER);
    const r0 = radius(sim);
    let peak = 0;
    let airTicks = 0;
    for (let t = 1; t < 120; t++) {
      sim.applyInput(0, input(t, { buttons: M.jump }));
      sim.step(cfg.dt);
      peak = Math.max(peak, radius(sim) - r0);
      if (sim.avatar(0).moveState === MOVE_AIRBORNE) airTicks++;
    }
    expect(peak).toBeGreaterThan(1.5);
    expect(peak).toBeLessThan(1.65);
    expect(airTicks / cfg.tickHz).toBeGreaterThan(2.6);
    expect(airTicks / cfg.tickHz).toBeLessThan(3);
    expect(sim.avatar(0).moveState).toBe(MOVE_GROUNDED);

    const tap = makeSim(flatWorld());
    tap.addActor(0, PLAYER);
    const t0 = radius(tap);
    let tapPeak = 0;
    for (let t = 1; t < 80; t++) {
      tap.applyInput(0, input(t, { buttons: t <= 2 ? M.jump : 0 }));
      tap.step(cfg.dt);
      tapPeak = Math.max(tapPeak, radius(tap) - t0);
    }
    expect(tapPeak).toBeLessThan(0.6);
  });

  test("holding jump never re-jumps (levels, edges derived by the sim)", () => {
    const sim = makeSim(flatWorld());
    sim.addActor(0, PLAYER);
    let jumps = 0;
    let wasGrounded = true;
    for (let t = 1; t < 200; t++) {
      sim.applyInput(0, input(t, { buttons: M.jump }));
      sim.step(cfg.dt);
      const g = sim.avatar(0).moveState === MOVE_GROUNDED;
      if (wasGrounded && !g) jumps++;
      wasGrounded = g;
    }
    expect(jumps).toBe(1);
  });
});

describe("movement invariants on real terrain (property)", () => {
  test("never below ground - 0.05 m, speed bounded, per-tick motion bounded (no tunnelling)", () => {
    const world = testWorld();
    const sim = makeSim(world);
    sim.addActor(0, PLAYER);
    let seed = 12345;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    let cur = input(0);
    let prev = { x: sim.avatar(0).px, y: sim.avatar(0).py, z: sim.avatar(0).pz };
    for (let t = 1; t < 4000; t++) {
      if (t % 17 === 0) {
        cur = input(t, {
          moveX: Math.floor(rnd() * 255) - 127,
          moveY: Math.floor(rnd() * 255) - 127,
          yaw: Math.floor(rnd() * 65536),
          buttons:
            (rnd() < 0.4 ? M.jump : 0) |
            (rnd() < 0.4 ? M.lope : 0) |
            (rnd() < 0.3 ? M.toolPrimary : 0) |
            (rnd() < 0.1 ? M.descend : 0),
        });
      }
      sim.applyInput(0, { ...cur, seq: t & 0xffff });
      sim.step(cfg.dt);
      const a = sim.avatar(0);
      const l = Math.hypot(a.px, a.py, a.pz);
      const ground = cfg.moonRadiusM + world.ground.heightAtXYZ(a.px / l, a.py / l, a.pz / l);
      expect(l).toBeGreaterThan(ground - 0.05);
      expect(Math.hypot(a.vx, a.vy, a.vz)).toBeLessThan(15);
      expect(Math.hypot(a.px - prev.x, a.py - prev.y, a.pz - prev.z)).toBeLessThan(15 * cfg.dt + 0.5);
      prev = { x: a.px, y: a.py, z: a.pz };
    }
  });
});

describe("tool strokes and Dust Cell", () => {
  function sweepSim(world = testWorld()): { sim: MoonRoomSim; events: RoomSimEvent[] } {
    const sim = makeSim(world);
    const events: RoomSimEvent[] = [];
    sim.onEvent((e) => events.push(e));
    sim.addActor(0, PLAYER);
    return { sim, events };
  }

  test("Desk Duster: at most one stroke per frame interval, on stroke ticks, segment <= 4 m, contract fields", () => {
    const { sim } = sweepSim();
    let total = 0;
    for (let t = 1; t < 400; t++) {
      sim.applyInput(0, input(t, { moveY: 80, yaw: t * 30, buttons: M.toolPrimary }));
      const tick = sim.tick;
      sim.step(cfg.dt);
      expect(sim.strokeCount).toBeLessThanOrEqual(1);
      for (let k = 0; k < sim.strokeCount; k++) {
        const s = sim.strokeAt(k);
        total++;
        expect(tick % cfg.frameIntervalTicks).toBe(0);
        expect(s.tick).toBe(tick);
        expect(s.widthCm).toBe(15);
        expect(s.depth16).toBe(80);
        expect(s.toolCode).toBe(toolCodeOf(cfg, "tool.desk_duster"));
        expect(s.inputSeq).toBe(t);
        expect(Number.isInteger(s.startUMm) && Number.isInteger(s.endVMm)).toBe(true);
        expect(Math.hypot(s.endUMm - s.startUMm, s.endVMm - s.startVMm)).toBeLessThanOrEqual(STROKE_MAX_SEGMENT_MM);
      }
    }
    // Contact is 70 % of the cycle: well over half of the stroke ticks carry a stroke.
    expect(total).toBeGreaterThan(100);
  });

  test("no strokes while airborne with the Desk Duster; the Crescent Squeegee Flick keeps cleaning low hops", () => {
    const count = (): number => {
      const { sim } = sweepSim(flatWorld());
      // The first stroke tick after take-off may flush the last ground-contact segment; after that, nothing.
      let n = 0;
      let air = 0;
      for (let t = 1; t < 60; t++) {
        sim.applyInput(0, input(t, { moveY: 60, buttons: M.toolPrimary | (t === 5 ? M.jump : 0) }));
        sim.step(cfg.dt);
        if (sim.avatar(0).moveState !== MOVE_GROUNDED) {
          air++;
          if (air > cfg.frameIntervalTicks) n += sim.strokeCount;
        } else air = 0;
      }
      return n;
    };
    expect(count()).toBe(0);

    const sim = makeSim(flatWorld(), { walletLm: 100 });
    sim.addActor(0, PLAYER);
    const res = sim.applyIntent(0, {
      kind: "purchase",
      requestId: "00000000-0000-4000-8000-0000000000b1" as RequestId,
      itemId: "tool.crescent_squeegee",
    });
    expect(res).toEqual({ requestId: "00000000-0000-4000-8000-0000000000b1", ok: true, walletAfter: 25 });
    sim.applyIntent(0, { kind: "select_tool", slot: 1 });
    expect(sim.toolState(0).toolCode).toBe(toolCodeOf(cfg, "tool.crescent_squeegee"));
    let airborneStrokes = 0;
    let lowAirTicks = 0;
    for (let t = 1; t < 80; t++) {
      // Jump cut after 2 ticks keeps the hop under the 1.2 m Flick limit.
      sim.applyInput(0, input(t, { moveY: 60, buttons: M.toolPrimary | (t >= 20 && t < 22 ? M.jump : 0) }));
      sim.step(cfg.dt);
      const a = sim.avatar(0);
      if (a.moveState !== MOVE_GROUNDED) {
        airborneStrokes += sim.strokeCount;
        if (a.heightAboveGround < 1.2) lowAirTicks++;
      }
    }
    expect(lowAirTicks).toBeGreaterThan(5);
    expect(airborneStrokes).toBeGreaterThan(0);
  });

  test("Dust Cell fills, emits near_full / full once, and a full Cell stops pickup", () => {
    const { sim, events } = sweepSim(flatWorld());
    let lastCell = 0;
    let fullAt = -1;
    for (let t = 1; t < 30000 && fullAt < 0; t++) {
      // Walk a long lane so fresh plots keep giving dust.
      sim.applyInput(0, input(t, { moveY: 127, buttons: M.toolPrimary }));
      sim.step(cfg.dt);
      const c = sim.toolState(0).cellGrams[0]!;
      expect(c).toBeGreaterThanOrEqual(lastCell); // monotonic, never negative
      lastCell = c;
      if (sim.toolState(0).fullLatched) fullAt = t;
    }
    expect(fullAt).toBeGreaterThan(0);
    expect(lastCell).toBe(4000);
    const names = events.map((e) => e.name);
    expect(names.filter((n) => n === "cell.near_full")).toHaveLength(1);
    expect(names.filter((n) => n === "cell.full")).toHaveLength(1);
    const collected = events.filter((e) => e.name === "dust.collected");
    const sum = collected.reduce((acc, e) => acc + (e.name === "dust.collected" ? e.payload.grams : 0), 0);
    expect(sum).toBe(4000); // conserved: Cell grams == sum of collected grams
    // Full Cell: no more strokes reach the world.
    let after = 0;
    for (let t = fullAt + 1; t < fullAt + 100; t++) {
      sim.applyInput(0, input(t, { moveY: 127, buttons: M.toolPrimary }));
      sim.step(cfg.dt);
      after += sim.strokeCount;
    }
    expect(after).toBe(0);
    expect(sim.counters.strokesCellFull).toBeGreaterThan(0);
    // Draining resumes pickup.
    expect(sim.drainCell(0)).toBe(4000);
    let resumed = 0;
    for (let t = fullAt + 100; t < fullAt + 140; t++) {
      sim.applyInput(0, input(t, { moveY: 127, buttons: M.toolPrimary }));
      sim.step(cfg.dt);
      resumed += sim.strokeCount;
    }
    expect(resumed).toBeGreaterThan(0);
  });

  test("Detailing emits 0.5 m discs at depth 255, about one per 0.45 s", () => {
    const { sim } = sweepSim(flatWorld());
    let discs = 0;
    for (let t = 1; t <= 90; t++) {
      sim.applyInput(0, input(t, { buttons: M.toolSecondary }));
      sim.step(cfg.dt);
      for (let k = 0; k < sim.strokeCount; k++) {
        const s = sim.strokeAt(k);
        expect(s.startUMm).toBe(s.endUMm);
        expect(s.widthCm).toBe(50);
        expect(s.depth16).toBe(255);
        discs++;
      }
    }
    expect(discs).toBeGreaterThanOrEqual(9);
    expect(discs).toBeLessThanOrEqual(11);
  });

  test("Detailing through a full jump: no cooldown debt, discs keep the stroke period after landing (B1)", () => {
    const { sim } = sweepSim(flatWorld());
    const periodTicks = cfg.tools[sim.toolState(0).toolCode]!.periodMs / cfg.stepMs;
    const discTicks: number[] = [];
    let landedAt = -1;
    let wasAir = false;
    let minCooldown = Infinity;
    for (let t = 1; t <= 200; t++) {
      // Hold Detailing the whole time; a full jump at tick 10 keeps the avatar airborne for about 2.8 s.
      sim.applyInput(0, input(t, { buttons: M.toolSecondary | (t >= 10 && t < 30 ? M.jump : 0) }));
      sim.step(cfg.dt);
      const air = sim.avatar(0).moveState !== MOVE_GROUNDED;
      if (wasAir && !air && landedAt < 0) landedAt = t;
      wasAir = air;
      if (air) minCooldown = Math.min(minCooldown, sim.toolState(0).detailCooldownMs);
      if (sim.strokeCount > 0) discTicks.push(t);
    }
    expect(landedAt).toBeGreaterThan(40); // the jump really was long
    expect(minCooldown).toBeGreaterThanOrEqual(0); // no debt accrues while airborne
    const after = discTicks.filter((t) => t >= landedAt);
    expect(after.length).toBeGreaterThan(5);
    // Every interval after landing is about one stroke period (stroke ticks round it to the frame interval).
    for (let k = 1; k < after.length; k++) {
      expect(after[k]! - after[k - 1]!).toBeGreaterThanOrEqual(periodTicks - cfg.frameIntervalTicks);
    }
    // At most one stroke period's worth of discs in the first 1.8 s after landing (plus the landing disc).
    const window = Math.round(1800 / cfg.stepMs);
    expect(after.filter((t) => t < landedAt + window).length).toBeLessThanOrEqual(Math.ceil(window / periodTicks) + 1);
  });
});

describe("purchases (tools only in this task)", () => {
  test("insufficient funds, Standard Issue for every member, already owned", () => {
    const sim = makeSim(flatWorld(), { walletLm: 80 });
    sim.addActor(0, PLAYER);
    sim.addActor(1, { ...PLAYER, displayName: "Other" });
    const id = "00000000-0000-4000-8000-0000000000c1" as RequestId;
    expect(sim.applyIntent(0, { kind: "purchase", requestId: id, itemId: "tool.bristle_broom" })).toMatchObject({
      ok: false,
      code: "insufficient_funds",
    });
    expect(sim.applyIntent(0, { kind: "purchase", requestId: id, itemId: "tool.crescent_squeegee" })).toMatchObject({
      ok: true,
      walletAfter: 5,
    });
    expect((sim.toolState(1).owned >> toolCodeOf(cfg, "tool.crescent_squeegee")) & 1).toBe(1);
    expect(sim.applyIntent(0, { kind: "purchase", requestId: id, itemId: "tool.crescent_squeegee" })).toMatchObject({
      ok: true,
      walletAfter: 5,
    }); // a replay of the same request: no second charge
    expect(
      sim.applyIntent(0, {
        kind: "purchase",
        requestId: "00000000-0000-4000-8000-0000000000c2" as RequestId,
        itemId: "tool.crescent_squeegee",
      }),
    ).toMatchObject({ ok: false, code: "already_owned" });
    expect(sim.applyIntent(1, { kind: "purchase", requestId: id, itemId: "node.nope" })).toMatchObject({
      ok: false,
      code: "unknown_item",
    });
    expect(sim.wallet).toBeGreaterThanOrEqual(0);
  });
});

describe("sun clock", () => {
  test("starts at dawn, day after twilight, night at half the day, daynight.changed events", () => {
    expect(dayPhaseAt(cfg, 0)).toBe("dawn");
    expect(dayPhaseAt(cfg, cfg.twilightTicks)).toBe("day");
    expect(isDaylightAt(cfg, cfg.daylightTicks - 1)).toBe(true);
    expect(dayPhaseAt(cfg, cfg.daylightTicks)).toBe("night");
    expect(cfg.dayTicks).toBe(72000);
    const sim = makeSim(flatWorld(), { startTick: cfg.twilightTicks - 2 });
    const ev: RoomSimEvent[] = [];
    sim.onEvent((e) => ev.push(e));
    sim.step(cfg.dt);
    sim.step(cfg.dt);
    sim.step(cfg.dt);
    expect(ev.map((e) => e.name)).toEqual(["daynight.changed"]);
  });
});

describe("determinism and snapshot", () => {
  test("two rooms with the same inputs have identical state hashes every tick", () => {
    const a = makeSim(testWorld());
    const b = makeSim(testWorld());
    a.addActor(0, PLAYER);
    b.addActor(0, PLAYER);
    for (let t = 1; t < 600; t++) {
      const i = input(t, {
        moveX: ((t * 7) % 255) - 127,
        moveY: 90,
        yaw: (t * 211) & 0xffff,
        buttons: (t % 50 < 30 ? M.toolPrimary : M.lope) | (t % 97 === 0 ? M.jump : 0),
      });
      a.applyInput(0, i);
      b.applyInput(0, i);
      a.step(cfg.dt);
      b.step(cfg.dt);
      expect(a.stateHash()).toBe(b.stateHash());
    }
  });

  test("snapshot reports actors, tool, Cell and ShiftState", () => {
    const sim = makeSim(flatWorld());
    sim.addActor(2, PLAYER);
    const s = sim.snapshot();
    expect(s.actors).toHaveLength(1);
    expect(s.actors[0]!.tool.toolId).toBe("tool.desk_duster");
    expect(s.actors[0]!.tool.cellCapGrams).toBe(4000);
    expect(s.shift.players[0]!.slot).toBe(2);
    expect(s.shift.simTickHz).toBe(20);
    expect(s.entityIds).toEqual([3]);
  });
});

describe("cost", () => {
  test("avatar + tool step on real terrain (report the measured mean)", () => {
    const sim = makeSim(testWorld());
    for (let s = 0; s < 6; s++) sim.addActor(s, PLAYER);
    const step = (t: number): void => {
      for (let s = 0; s < 6; s++) sim.applyInput(s, input(t, { moveY: 100, yaw: t * 40, buttons: M.toolPrimary }));
      sim.step(cfg.dt);
    };
    for (let t = 1; t < 2000; t++) step(t); // warm up
    const n = 4000;
    const t0 = performance.now();
    for (let t = 2000; t < 2000 + n; t++) step(t);
    const usPerActorTick = ((performance.now() - t0) * 1000) / (n * 6);
    console.log(
      `MEASURED sim step: ${usPerActorTick.toFixed(2)} us per actor-tick (6 sweeping actors, fixture terrain)`,
    );
    expect(usPerActorTick).toBeLessThan(100); // loose CI guard; the budget check is the logged figure
  });

  test("avatar step alone (walking, no tool) on real terrain (report the measured mean)", () => {
    const sim = makeSim(testWorld());
    for (let s = 0; s < 6; s++) sim.addActor(s, PLAYER);
    const step = (t: number): void => {
      for (let s = 0; s < 6; s++) sim.applyInput(s, input(t, { moveY: 127, yaw: t * 40, buttons: M.lope }));
      sim.step(cfg.dt);
    };
    for (let t = 1; t < 2000; t++) step(t);
    const n = 4000;
    const t0 = performance.now();
    for (let t = 2000; t < 2000 + n; t++) step(t);
    const us = ((performance.now() - t0) * 1000) / (n * 6);
    console.log(`MEASURED avatar step: ${us.toFixed(2)} us per actor-tick (6 loping actors, no tool)`);
    expect(us).toBeLessThan(100);
  });
});
