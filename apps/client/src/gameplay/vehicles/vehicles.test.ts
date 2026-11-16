// M1-W7-T01: vehicle input mapping and chase camera (FOV rules, Chase delay / Free Look, reduced motion, blend).
import { describe, expect, test } from "vitest";
import { INPUT_BUTTON_MASK as M } from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import {
  createSimConfig,
  resolveVehicleTuning,
  spawnVehicle,
  VehicleIntent,
  VehicleState,
  vehicleKindOf,
} from "@moon-cleanup/sim";
import { DEFAULT_BINDINGS } from "../input/bindings";
import { createInputCommand, InputState } from "../input/input-state";
import {
  TOTAL_FOV_OFFSET_CAP_DEG,
  VehicleCameraRig,
  VehicleDriveView,
  VEHICLE_CAMERA_BLEND_S,
  vehicleExitPressed,
  vehicleIntentFromInput,
} from "./index";

const data = loadGameData();
const cfg = createSimConfig(data);
const tuning = resolveVehicleTuning(data, cfg);
const flat = { heightAtXYZ: () => 0 };

function vehicle(): VehicleState {
  const v = new VehicleState(tuning.lines.length);
  spawnVehicle(v, tuning, cfg, flat, vehicleKindOf(tuning, "vehicle.trundle"), 0, 0, 0, 1, 1, 0, 0);
  v.driverSlot = 0;
  return v;
}

describe("vehicle input mapping", () => {
  test("axes, handbrake, boost and edge buttons", () => {
    const out = new VehicleIntent();
    vehicleIntentFromInput({ moveX: 127, moveY: -127, buttons: M.jump | M.boost | M.laneLock }, 0, out);
    expect([out.steer, out.throttle, out.handbrake, out.boost, out.lockPressed, out.lightsPressed]).toEqual([
      1,
      -1,
      true,
      true,
      true,
      false,
    ]);
    vehicleIntentFromInput({ moveX: 0, moveY: 64, buttons: M.laneLock | M.lampCycle }, M.laneLock, out);
    expect(out.lockPressed).toBe(false);
    expect(out.lightsPressed).toBe(true);
    expect(out.throttle).toBeCloseTo(64 / 127, 9);
    expect(vehicleExitPressed(M.interact, 0)).toBe(true);
    expect(vehicleExitPressed(M.interact, M.interact)).toBe(false);
  });
});

describe("driving context", () => {
  test("seated, the lope key is sent as boost; on foot it stays lope", () => {
    const input = new InputState(DEFAULT_BINDINGS);
    input.keyDown("ShiftLeft");
    const cmd = createInputCommand();
    input.sample(cmd);
    expect(cmd.buttons & M.lope).toBe(M.lope);
    expect(cmd.buttons & M.boost).toBe(0);
    input.driving = true;
    input.sample(cmd);
    expect(cmd.buttons & M.lope).toBe(0);
    expect(cmd.buttons & M.boost).toBe(M.boost);
  });

  test("drive view rebuilds the vehicle pose from the handle pose, estimates speed, and releases the blend on exit", () => {
    const view = new VehicleDriveView();
    const R = cfg.moonRadiusM;
    const feet = new Float64Array([0, R, 0]);
    view.setActive(true, "vehicle.trundle");
    expect(view.engaged).toBe(true);
    // Heading north (yaw 0) on the pole: the heading frame is B there, so just require a tangent unit heading and speed.
    const dt = 1 / 60;
    for (let k = 0; k < 120; k++) {
      view.update(feet, 0, 0, -0.35, false, { dt });
    }
    expect(view.camera.fovDeg).toBe(60);
    // Move along the heading at 3 m/s for a second: the estimate follows.
    const along = new Float64Array(3);
    for (let k = 0; k < 60; k++) {
      along[0] = feet[0]!;
      along[1] = feet[1]!;
      along[2] = feet[2]!;
      view.update(feet, 0, 0, -0.35, false, { dt });
      // Step the feet 3 m/s along the pose heading read from the camera's own state: use +X tangent on the pole.
      feet[0] = feet[0]! + 3 * dt;
    }
    expect(Math.abs(view.camera.eye[1]! - R)).toBeGreaterThan(1); // eye is above the ground
    view.setActive(false, "");
    for (let k = 0; k < 40; k++) view.update(feet, 0, 0, -0.35, false, { dt });
    expect(view.camera.blend01).toBe(0);
    expect(view.engaged).toBe(false);
  });
});

describe("vehicle chase camera", () => {
  test("FOV: base 60, speed term above 5 m/s, boost kick, total capped at +10; reduced motion has none", () => {
    const rig = new VehicleCameraRig();
    const v = vehicle();
    rig.setActive(true);
    rig.update(v, null, { dt: 1 / 60 });
    expect(rig.fovDeg).toBe(60);
    v.speed = 9; // (9 - 5) x 0.4 = 1.6
    rig.update(v, null, { dt: 1 / 60 });
    expect(rig.fovDeg).toBeCloseTo(61.6, 6);
    v.speed = 30;
    v.boosting = true;
    for (let k = 0; k < 120; k++) rig.update(v, null, { dt: 1 / 60 });
    expect(rig.fovDeg).toBeCloseTo(60 + Math.min(TOTAL_FOV_OFFSET_CAP_DEG, 5 + 3), 6);
    rig.settings.reducedMotion = true;
    rig.update(v, null, { dt: 1 / 60 });
    expect(rig.fovDeg).toBe(60);
  });

  test("the eye sits behind and above the vehicle at the boom distance, horizon level", () => {
    const rig = new VehicleCameraRig();
    const v = vehicle();
    rig.setActive(true);
    rig.update(v, null, { dt: 1 / 60 });
    const px = v.px;
    const py = v.py;
    const pz = v.pz;
    const d = Math.hypot(rig.eye[0]! - px, rig.eye[1]! - py, rig.eye[2]! - pz);
    // boom 4.6 m from the pivot (1.5 m up): distance to the chassis point is between 3 and 6.5 m.
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(6.5);
    const upDot = rig.forward[0]! * rig.up[0]! + rig.forward[1]! * rig.up[1]! + rig.forward[2]! * rig.up[2]!;
    expect(upDot).toBeCloseTo(Math.sin((-20 * Math.PI) / 180), 6);
  });

  test("Chase swings back after the delay; Free Look keeps the orbit; wheel zoom is clamped to +-30 %", () => {
    const look = { yawRad: 1, pitchRad: 0 };
    const chase = new VehicleCameraRig();
    const free = new VehicleCameraRig();
    free.settings.freeLook = true;
    const v = vehicle();
    for (const r of [chase, free]) {
      r.setActive(true);
      r.update(v, look, { dt: 1 / 60 });
      expect(r.yawOffsetRad).toBeCloseTo(1, 9);
    }
    for (let k = 0; k < 60 * 3; k++) {
      chase.update(v, null, { dt: 1 / 60 });
      free.update(v, null, { dt: 1 / 60 });
    }
    expect(chase.yawOffsetRad).toBe(0); // 1 s delay, then 120 deg/s: back within ~0.5 s
    expect(free.yawOffsetRad).toBeCloseTo(1, 9);
    for (let k = 0; k < 20; k++) chase.wheel(1);
    expect(chase.zoom).toBe(1.3);
    for (let k = 0; k < 40; k++) chase.wheel(-1);
    expect(chase.zoom).toBe(0.7);
  });

  test("the enter / exit blend takes 0.35 s, eased, and is frame-rate independent", () => {
    const run = (dt: number): number => {
      const rig = new VehicleCameraRig();
      const v = vehicle();
      rig.setActive(true);
      const frames = Math.round(VEHICLE_CAMERA_BLEND_S / 2 / dt);
      for (let k = 0; k < frames; k++) rig.update(v, null, { dt });
      return rig.blend01;
    };
    expect(run(1 / 100)).toBeCloseTo(0.5, 1); // 17.5 frames rounds to 18: close to the midpoint
    expect(Math.abs(run(1 / 60) - run(1 / 144))).toBeLessThan(0.12);
    const rig = new VehicleCameraRig();
    const v = vehicle();
    rig.setActive(true);
    for (let k = 0; k < 30; k++) rig.update(v, null, { dt: 1 / 60 });
    expect(rig.blend01).toBe(1);
    rig.setActive(false);
    for (let k = 0; k < 30; k++) rig.update(v, null, { dt: 1 / 60 });
    expect(rig.blend01).toBe(0);
  });
});
