// Input -> VehicleIntent (game-feel-and-controls.md section 6.2 driver column, INPUT_BUTTON_MEANING).
//
// While driving, the wire input keeps its fields: moveY = throttle (forward / reverse), moveX = steer, `jump` = handbrake,
// `boost` = Afterburner (hold), `laneLock` = Throttle Lock toggle (edge), `lampCycle` = Running Lamps (edge),
// `interact` = exit. The sim derives the same VehicleIntent from the same command on the server, so this mapping is
// shared with prediction and tests; it allocates nothing (the caller owns the intent object).

import { INPUT_AXIS_MAX, INPUT_BUTTON_MASK as M, type SimInputCommand } from "@moon-cleanup/shared";
import type { VehicleIntent } from "@moon-cleanup/sim";

/**
 * Fills `out` from the command and the previous tick's buttons (edge detection). Axes are -1 .. 1; the throttle keeps
 * its sign (the Trundle reverses at 1.5 m/s).
 */
export function vehicleIntentFromInput(
  cmd: Pick<SimInputCommand, "moveX" | "moveY" | "buttons">,
  prevButtons: number,
  out: VehicleIntent,
): void {
  const b = cmd.buttons;
  const pressed = b & ~prevButtons;
  const ty = cmd.moveY / INPUT_AXIS_MAX;
  const sx = cmd.moveX / INPUT_AXIS_MAX;
  out.throttle = ty > 1 ? 1 : ty < -1 ? -1 : ty;
  out.steer = sx > 1 ? 1 : sx < -1 ? -1 : sx;
  out.boost = (b & M.boost) !== 0;
  out.handbrake = (b & M.jump) !== 0;
  out.lockPressed = (pressed & M.laneLock) !== 0;
  out.lightsPressed = (pressed & M.lampCycle) !== 0;
}

/** True on the tick the exit button goes down (the room then calls `exitVehicle`). */
export function vehicleExitPressed(buttons: number, prevButtons: number): boolean {
  return (buttons & ~prevButtons & M.interact) !== 0;
}
