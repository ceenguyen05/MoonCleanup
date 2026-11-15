// The dust ledger of a room: the real `WorldDustLedger` of packages/world, built from game-data. Every host builds
// its ledger here (Solo worker, server room, tests), so they agree on dust levels and plot areas; a difference would
// change milligrams per ledger unit and with it Dust Cell grams and the state hash.
//
// The result goes to MoonRoomSim as its `ledger` option; the host saves and restores it as dust chunk payloads
// (packages/world chunk-codec) next to the sim checkpoint.

import { DUST_CLASS_TERRAIN_ID, DustClass, type PlotAttributes } from "@moon-cleanup/shared";
import type { GameData } from "@moon-cleanup/game-data";
import {
  createUniformPlotAttributes,
  WorldDustLedger,
  type IcoPlotGrid,
  type PlotAttributeTables,
} from "@moon-cleanup/world";
import { createSimConfig } from "../config/sim-config";

export interface RoomDustLedgerOptions {
  /** Tick rate of the room (default: the contract's). Dust numbers do not depend on it; it only has to be valid. */
  readonly tickHz?: number;
  /**
   * Dust class and area per plot. Default: every plot Highland with real areas (see `defaultPlotAttributes`), until
   * the per-plot class bake exists. Every host of one Contract must pass the same table.
   */
  readonly attributes?: PlotAttributes;
  /** Ledger slots allocated up front (default 64). Hosts with a tick budget reserve what they expect to need. */
  readonly initialLedgerSlots?: number;
  /** Keep stroke logs (default true). */
  readonly strokeLog?: boolean;
  /** Record ledger-zero events (rendering clients only; default false). */
  readonly zeroEvents?: boolean;
}

let defaultGrid: IcoPlotGrid | undefined;
let defaultTables: PlotAttributeTables | undefined;

/**
 * Class and area per plot when no bake is given: areas are real (about 60 ms once per grid, then cached), every
 * plot is Highland and none is Empty. The per-plot class bake (WDS section 3.2 step 8) replaces the class table;
 * saves keep working because a restore recounts every ledger against the levels in force.
 */
export function defaultPlotAttributes(grid: IcoPlotGrid): PlotAttributeTables {
  if (defaultTables === undefined || defaultGrid !== grid) {
    defaultTables = createUniformPlotAttributes(grid, DustClass.Highland);
    defaultGrid = grid;
  }
  return defaultTables;
}

/** Dust level per DustClass code (index = code) from the game-data terrain table; Empty is 0. */
export function dustLevelsByClass(data: GameData, tickHz?: number): number[] {
  const cfg = createSimConfig(data, { tickHz });
  const levels = [0, 0, 0, 0];
  levels[DustClass.Highland] = cfg.terrainDustLevel[DUST_CLASS_TERRAIN_ID[DustClass.Highland]] ?? 0;
  levels[DustClass.Mare] = cfg.terrainDustLevel[DUST_CLASS_TERRAIN_ID[DustClass.Mare]] ?? 0;
  levels[DustClass.CraterFloor] = cfg.terrainDustLevel[DUST_CLASS_TERRAIN_ID[DustClass.CraterFloor]] ?? 0;
  return levels;
}

/** A fresh, untouched dust ledger for a room on `grid`. */
export function createRoomDustLedger(
  grid: IcoPlotGrid,
  data: GameData,
  options: RoomDustLedgerOptions = {},
): WorldDustLedger {
  return new WorldDustLedger({
    grid,
    attributes: options.attributes ?? defaultPlotAttributes(grid),
    dustLevelByClass: dustLevelsByClass(data, options.tickHz),
    kgPerM2PerLevel: createSimConfig(data, { tickHz: options.tickHz }).dustKgPerM2PerLevel,
    ...(options.initialLedgerSlots !== undefined ? { initialLedgerSlots: options.initialLedgerSlots } : {}),
    ...(options.strokeLog !== undefined ? { strokeLog: options.strokeLog } : {}),
    ...(options.zeroEvents !== undefined ? { zeroEvents: options.zeroEvents } : {}),
  });
}

/** `bakeCheck` byte of a dust chunk payload: the first byte of the Contract's bakeHash (64 hex characters). */
export function bakeCheckOf(bakeHash: string): number {
  const v = parseInt(bakeHash.slice(0, 2), 16);
  return Number.isFinite(v) ? v & 0xff : 0;
}
