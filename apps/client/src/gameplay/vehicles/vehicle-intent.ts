// Input -> VehicleIntent (game-feel-and-controls.md section 6.2 driver column, INPUT_BUTTON_MEANING).
//
// While driving, the wire input keeps its fields: moveY = throttle (forward / reverse), moveX = steer, `jump` = handbrake,
// `boost` = Afterburner (hold), `laneLock` = Throttle Lock toggle (edge), `lampCycle` = Running Lamps (edge),
// `holsterNext` = Wide Mouth cycle (edge), `interact` = exit. The mapping is the sim's own `fillVehicleIntent` (the room
// and the Trundle predictor call the same function), so prediction can never drift from the server on input meaning.

import { INPUT_BUTTON_MASK as M, type SimInputCommand } from "@moon-cleanup/shared";
import { fillVehicleIntent, type VehicleIntent } from "@moon-cleanup/sim";

/** Fills `out` from the command and the previous tick's buttons (edge detection). Allocation-free. */
export function vehicleIntentFromInput(
  cmd: Pick<SimInputCommand, "moveX" | "moveY" | "buttons">,
  prevButtons: number,
  out: VehicleIntent,
): void {
  fillVehicleIntent(out, cmd.moveX, cmd.moveY, cmd.buttons, prevButtons);
}

/** True on the tick the exit button goes down (the room then calls `exitVehicle`). */
export function vehicleExitPressed(buttons: number, prevButtons: number): boolean {
  return (buttons & ~prevButtons & M.interact) !== 0;
}
