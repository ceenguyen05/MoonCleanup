import v8 from "node:v8";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { INPUT_AXIS_MAX, INPUT_BUTTON_MASK, STANDARD_GRID_PARAMS, type PlotId } from "@moon-cleanup/shared";
import {
  AvatarState,
  createSimConfig,
  spawnAvatar,
  toolCodeOf,
  type SimConfig,
  type SimGround,
} from "@moon-cleanup/sim";
import { loadGameData } from "@moon-cleanup/game-data";
import { createPlotGrid } from "@moon-cleanup/world";
import {
  CameraRig,
  FLAT_GROUND,
  InputState,
  PlotFrameMapper,
  SoloPredictor,
  TangentPlaneMapper,
  createInputCommand,
  type RenderMapper,
  type SelfLike,
} from "./index";

const cfg: SimConfig = createSimConfig(loadGameData(), { tickHz: 20 });

function spawnSelf(): SelfLike & AvatarState {
  const a = new AvatarState();
  spawnAvatar(a, cfg, FLAT_GROUND, 0.2, 0.3, 0.93);
  return a;
}

function setup(): { p: SoloPredictor; clock: { nowMs: number }; s: InputState } {
  const clock = { nowMs: 1000 };
  const p = new SoloPredictor(cfg, FLAT_GROUND, () => clock.nowMs);
  p.reconcile(spawnSelf(), 0);
  return { p, clock, s: new InputState() };
}

const dist = (a: Float64Array, b: Float64Array): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("SoloPredictor", () => {
  it("E13: a move press shows in the next rendered frame, before any input is sent", () => {
    const { p, clock, s } = setup();
    const rest = new Float64Array(3);
    const out = new Float64Array(3);
    p.sample(clock, rest);
    s.keyDown("KeyW");
    clock.nowMs += 16.7; // one 60 fps frame later
    s.peek(p.live);
    p.sample(clock, out);
    expect(dist(out, rest)).toBeGreaterThan(0.001);
    expect(p.stats.predicted).toBe(0);
  });

  it("the speculative blend lands exactly on the next predicted tick (continuous motion)", () => {
    const { p, clock, s } = setup();
    s.keyDown("KeyW");
    const cmd = createInputCommand();
    for (let i = 1; i <= 5; i++) {
      cmd.seq = i;
      s.sample(cmd);
      p.predict(cmd);
      clock.nowMs += 50;
    }
    const before = new Float64Array(3);
    s.peek(p.live);
    p.sample(clock, before); // a full tick after the last step: blend = 1
    cmd.seq = 6;
    s.sample(cmd);
    p.predict(cmd);
    const after = new Float64Array(3);
    p.sample(clock, after); // right at the step: blend = 0
    expect(dist(before, after)).toBeLessThan(1e-9);
  });

  it("reconciling with the worker's own result of the same inputs corrects nothing", () => {
    const { p, s } = setup();
    // The worker: the same pure step from the same spawn on the same inputs.
    const worker = new SoloPredictor(cfg, FLAT_GROUND, () => 0);
    worker.reconcile(spawnSelf(), 0);
    s.keyDown("KeyW");
    s.keyDown("ShiftLeft");
    const cmd = createInputCommand();
    for (let i = 1; i <= 40; i++) {
      cmd.seq = i;
      if (i === 10) s.keyDown("Space");
      if (i === 14) s.keyUp("Space");
      s.sample(cmd);
      p.predict(cmd);
      worker.predict(cmd);
      if (i % 3 === 0 && i > 3) {
        // The FRAME after input i-2 arrives (2 ticks of worker latency): rebuild its state by stepping a copy.
        const w = new SoloPredictor(cfg, FLAT_GROUND, () => 0);
        w.reconcile(spawnSelf(), 0);
        for (let j = 1; j <= i - 2; j++) w.predict(replay[j]!);
        p.reconcile(w.state, i - 2);
        expect(p.stats.lastCorrectionM).toBeLessThan(1e-9);
      }
      replay[i] = { ...cmd };
    }
    expect(p.stats.reconciles).toBeGreaterThan(5);
    expect(
      dist(
        new Float64Array([p.state.px, p.state.py, p.state.pz]),
        new Float64Array([worker.state.px, worker.state.py, worker.state.pz]),
      ),
    ).toBeLessThan(1e-9);
  });

  it("a correction becomes a render offset that halves every 80 ms", () => {
    const { p, clock } = setup();
    const self = spawnSelf();
    self.px += 0.5; // the worker disagrees by 0.5 m (e.g. a collision the client did not know)
    const out = new Float64Array(3);
    p.sample(clock, out);
    p.reconcile(self, 0);
    p.speculate = false;
    p.sample(clock, out);
    expect(Math.hypot(p.offset[0]!, p.offset[1]!, p.offset[2]!)).toBeCloseTo(0.5, 6);
    clock.nowMs += 80;
    p.sample(clock, out);
    expect(Math.hypot(p.offset[0]!, p.offset[1]!, p.offset[2]!)).toBeCloseTo(0.25, 6);
  });

  it("predict + sample allocate nothing per frame", () => {
    const { p, clock, s } = setup();
    s.keyDown("KeyW");
    const cmd = createInputCommand();
    const out = new Float64Array(3);
    const frame = (i: number): void => {
      clock.nowMs += 16;
      if (i % 3 === 0) {
        cmd.seq = (cmd.seq + 1) & 0xffff;
        s.sample(cmd);
        p.predict(cmd);
      }
      s.peek(p.live);
      p.sample(clock, out);
    };
    for (let i = 0; i < 20_000; i++) frame(i);
    // GC-anchored, best of 3 windows: a raw heapUsed delta depends on when V8 happens to collect (young-generation
    // garbage from the test harness itself), a real per-frame allocation grows in every window.
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    let grew = Number.POSITIVE_INFINITY;
    for (let w = 0; w < 3; w++) {
      gc();
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < 100_000; i++) frame(i);
      grew = Math.min(grew, process.memoryUsage().heapUsed - before);
    }
    expect(grew).toBeLessThan(1.5 * 1024 * 1024);
  });
});

const replay: ReturnType<typeof createInputCommand>[] = [];

describe("SoloPredictor Steep rule (mirrors MoonRoomSim.stepActor)", () => {
  // A plane tilted along world x: slope ~ s at the spawn direction (as in the sim's tools-cargo test).
  const tilted = (s: number): SimGround => ({ heightAtXYZ: (x) => s * cfg.moonRadiusM * x });
  const sweepSpeed = (ground: SimGround, tool: string): number => {
    const p = new SoloPredictor(cfg, ground, () => 0);
    const a = new AvatarState();
    spawnAvatar(a, cfg, ground, 0.2, 0.3, 0.93);
    p.reconcile(a, 0);
    p.setTool(toolCodeOf(cfg, tool));
    const cmd = createInputCommand();
    cmd.moveY = INPUT_AXIS_MAX;
    cmd.buttons = INPUT_BUTTON_MASK.toolPrimary;
    for (let i = 1; i <= 60; i++) {
      cmd.seq = i;
      p.predict(cmd);
    }
    const s = p.state;
    const l = Math.hypot(s.px, s.py, s.pz);
    const vr = (s.vx * s.px + s.vy * s.py + s.vz * s.pz) / l;
    return Math.sqrt(Math.max(0, s.vx * s.vx + s.vy * s.vy + s.vz * s.vz - vr * vr));
  };
  const tan = (deg: number): number => Math.tan((deg * Math.PI) / 180);

  it("sweeping on Steep ground (32 deg) runs at x0.6; 20 deg and Sure Footing keep full speed", () => {
    const gentle = sweepSpeed(tilted(tan(20)), "tool.desk_duster");
    const steep = sweepSpeed(tilted(tan(32)), "tool.desk_duster");
    expect(gentle).toBeGreaterThan(0.1);
    expect(steep / gentle).toBeCloseTo(cfg.tools[toolCodeOf(cfg, "tool.desk_duster")]!.steepSweepMult, 2);
    const broomGentle = sweepSpeed(tilted(tan(20)), "tool.bristle_broom");
    const broomSteep = sweepSpeed(tilted(tan(32)), "tool.bristle_broom");
    expect(broomSteep / broomGentle).toBeCloseTo(1, 2);
  });
});

describe("input -> screen direction under each render mapper (dust scene mirror)", () => {
  const cross = (a: number[], b: number[]): number[] => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

  /** Screen-right (render F x U) vs the render image of the sim's strafe-right and of the yaw-increase direction. */
  function check(mapper: RenderMapper & { mirrored?: boolean }, feet: Float64Array, yaw: number): void {
    const rig = new CameraRig();
    rig.update(feet, { yawRad: yaw, pitchRad: 0 }, { dt: 1 / 60 });
    const out = new Float64Array(3);
    const map = (v: ArrayLike<number>): number[] => {
      mapper.direction(Float64Array.from([v[0]!, v[1]!, v[2]!]), 0, out, 0);
      return [out[0]!, out[1]!, out[2]!];
    };
    const F = map(rig.forward);
    const U = map(rig.up);
    const screenRight = cross(F, U);
    // sim strafe-right = forward x n (packages/sim stepAvatar)
    const simRight = cross(Array.from(rig.heading), Array.from(rig.up));
    const input = new InputState();
    input.mirrored = mapper.mirrored === true;
    input.keyDown("KeyD");
    const moveX = input.sample(createInputCommand()).moveX;
    expect(dot(map(simRight.map((c) => c * Math.sign(moveX))), screenRight)).toBeGreaterThan(0);
    // yaw increases along d(forward)/d(yaw) = simRight; mouse +x must turn the screen view to the right.
    const y0 = input.yawRad;
    input.lookBy({ movementX: 50, movementY: 0 });
    let dy = input.yawRad - y0;
    if (dy > Math.PI) dy -= 2 * Math.PI;
    expect(dot(map(simRight.map((c) => c * Math.sign(dy))), screenRight)).toBeGreaterThan(0);
  }

  it("standard tangent frame: D strafes right and the mouse turns right on screen", () => {
    const feet = new Float64Array([0.2, 0.3, 0.93]);
    const l = Math.hypot(feet[0]!, feet[1]!, feet[2]!);
    for (let i = 0; i < 3; i++) feet[i] = (feet[i]! / l) * 1_737_400;
    const mapper = new TangentPlaneMapper(feet);
    for (const yaw of [0, 1, 2.5, 4]) check(mapper, feet, yaw);
  });

  it("dust scene plot frame (right-handed since W3-T05): D strafes right and the mouse turns right on screen", () => {
    const grid = createPlotGrid(STANDARD_GRID_PARAMS);
    const R = grid.params.radiusM;
    const mapper = PlotFrameMapper.fromGrid(grid, 1234 as PlotId, R);
    const feet = new Float64Array([mapper.axes[0]! * R, mapper.axes[1]! * R, mapper.axes[2]! * R]);
    for (const yaw of [0, 1, 2.5, 4]) check(mapper, feet, yaw);
  });
});

describe("PlotFrameMapper (dust scene axes)", () => {
  it("render (x, z) = site plot-local (u, v) in metres, y = height above the radius", () => {
    const grid = createPlotGrid(STANDARD_GRID_PARAMS);
    const site = 1234 as PlotId;
    const R = grid.params.radiusM;
    const m = PlotFrameMapper.fromGrid(grid, site, R);
    const d = { x: 0, y: 0, z: 0 };
    grid.fromPlotLocal(site, 3000, -2000, d);
    const out = new Float64Array(3);
    m.point(new Float64Array([d.x * (R + 1.5), d.y * (R + 1.5), d.z * (R + 1.5)]), 0, out, 0);
    expect(out[0]).toBeCloseTo(3, 3);
    expect(out[1]).toBeCloseTo(1.5, 3);
    expect(out[2]).toBeCloseTo(2, 3); // z = -v (south)
    // The dust scene's frame (x = east, y = up, z = south) is right-handed: no input flip (M1-W3-T05 mirror fix).
    expect(m.mirrored).toBe(false);
    const s = new InputState();
    s.mirrored = m.mirrored;
    s.keyDown("KeyD");
    expect(s.sample(createInputCommand()).moveX).toBe(127);
  }, 30_000);

  it("a staged site move is applied by the next point() and keeps the moon-centred point continuous", () => {
    const grid = createPlotGrid(STANDARD_GRID_PARAMS);
    const R = grid.params.radiusM;
    const a = 1234 as PlotId;
    const b = grid.neighborTable[a * 6]! as PlotId;
    const m = PlotFrameMapper.fromGrid(grid, a, R);
    const fb = PlotFrameMapper.fromGrid(grid, b, R);
    const d = { x: 0, y: 0, z: 0 };
    grid.fromPlotLocal(a, 5000, 3000, d);
    const src = new Float64Array([d.x * R, d.y * R, d.z * R]);
    const o1 = new Float64Array(3);
    const o2 = new Float64Array(3);
    m.requestSite(b);
    expect(m.sitePending).toBe(true);
    expect(m.siteVersion).toBe(0);
    m.point(src, 0, o1, 0);
    fb.point(src, 0, o2, 0);
    expect(m.site).toBe(b);
    expect(m.siteVersion).toBe(1);
    for (let i = 0; i < 3; i++) expect(o1[i]).toBeCloseTo(o2[i]!, 9);
  }, 30_000);
});
