// The dust ledger of a ShiftRoom: the same `createRoomDustLedger` (packages/sim) the Solo sim host builds, so a server
// room and a Solo Shift agree on dust levels, plot areas, Dust Cell grams and `plot.opened` / `plot.polished`. One
// ledger per room (it is mutable state); the plot grid and its attribute tables are shared per process.

import type { GameData } from "@moon-cleanup/game-data";
import { createRoomDustLedger, type SimWorld } from "@moon-cleanup/sim";
import { IcoPlotGrid, type WorldDustLedger } from "@moon-cleanup/world";

/**
 * Ledger slots allocated up front: touching a new plot must not grow the ledger pool on the tick path (a growth
 * copies every pool array). One slot is about 1.3 kB, so this is about 1.3 MB per room, the same headroom as the
 * Solo host (`SOLO_LEDGER_HEADROOM_SLOTS`). A slot is freed when its plot is Polished.
 */
export const SHIFT_LEDGER_HEADROOM_SLOTS = 1024;

/** A fresh, untouched ledger for a room on `world` (its grid must be the packages/world `IcoPlotGrid`). */
export function createShiftLedger(data: GameData, world: SimWorld, tickHz: number): WorldDustLedger {
  const grid = world.grid;
  if (!(grid instanceof IcoPlotGrid)) throw new TypeError("shift room: world.grid must be an IcoPlotGrid");
  return createRoomDustLedger(grid, data, { tickHz, initialLedgerSlots: SHIFT_LEDGER_HEADROOM_SLOTS });
}
