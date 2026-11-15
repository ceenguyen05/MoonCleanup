// Test world: the Standard GP(128,0) grid and the 64^2 fixture height cube with the default procedural detail.
// Identical in the Node and browser lanes (Vite inlines the .bin; no node:fs, no fetch).
import cubeDataUrl from "../../../../assets/terrain/fixtures/height-cube-fixture-64.bin?inline";
import cubeMeta from "../../../../assets/terrain/fixtures/height-cube-fixture-64.json";
import { STANDARD_GRID_PARAMS, type ContractId } from "@moon-cleanup/shared";
import { createPlotGrid, GroundHeight, HeightCube, type IcoPlotGrid, type WorldDustLedger } from "@moon-cleanup/world";
import { loadGameData } from "@moon-cleanup/game-data";
import {
  createRoomDustLedger,
  MoonRoomSim,
  type MoonRoomSimOptions,
  type SimGround,
  type SimWorld,
} from "../../src/index";

function dataUrlToArrayBuffer(url: string): ArrayBuffer {
  const comma = url.indexOf(",");
  const bin = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return bytes.buffer;
}

let grid: IcoPlotGrid | undefined;
let ground: GroundHeight | undefined;

export function testWorld(): SimWorld {
  grid ??= createPlotGrid(STANDARD_GRID_PARAMS);
  ground ??= new GroundHeight(new HeightCube(dataUrlToArrayBuffer(cubeDataUrl), cubeMeta), { radiusM: 2000 });
  return { grid, ground };
}

/** A perfectly flat moon (H = 0), for exact kinematics checks. */
export const FLAT_GROUND: SimGround = { heightAtXYZ: () => 0 };

export function flatWorld(): SimWorld {
  grid ??= createPlotGrid(STANDARD_GRID_PARAMS);
  return { grid, ground: FLAT_GROUND };
}

/**
 * The real dust ledger of packages/world (exact rasteriser, thresholds, Inspector's Stamp) on the Standard grid, built
 * by the factory every host uses (`createRoomDustLedger`). A fresh, untouched ledger per call.
 */
export function makeWorldLedger(): WorldDustLedger {
  grid ??= createPlotGrid(STANDARD_GRID_PARAMS);
  return createRoomDustLedger(grid, loadGameData());
}

export const TEST_CONTRACT = "00000000-0000-4000-8000-000000000001" as ContractId;

export function makeSim(world: SimWorld, extra: Partial<MoonRoomSimOptions> = {}): MoonRoomSim {
  return new MoonRoomSim({ data: loadGameData(), world, contractId: TEST_CONTRACT, shiftType: "solo", ...extra });
}

export const PLAYER = {
  playerId: "00000000-0000-4000-8000-0000000000aa" as never,
  displayName: "Tester",
  role: "holder" as const,
};
