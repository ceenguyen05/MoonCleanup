// Test-only helpers of sim-host (Node lane and browser worker lane). Not exported from the barrel.
import {
  DUST_MODEL_VERSION,
  MAX_PLAYERS_PER_ROOM,
  SAVE_FORMAT_VERSION,
  SAVE_SECTION_ID,
  STANDARD_GRID_PARAMS,
  type ContractId,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { encodeSaveEnvelope } from "./save-envelope";
import { createPlotGrid, mulberry32, type IcoPlotGrid, type WorldDustLedger } from "@moon-cleanup/world";
import { loadGameData } from "@moon-cleanup/game-data";
import { MoonRoomSim, createRoomDustLedger, type SimGround } from "@moon-cleanup/sim";
import type { SimHostWorldConfig } from "./messages";
import type { SimWorkerLike } from "./local-room-host";
import { SimWorkerCore } from "./worker-core";

export const TEST_CONTRACT = "00000000-0000-4000-8000-0000000000c1" as ContractId;
export const TEST_PLAYER = {
  playerId: "00000000-0000-4000-8000-0000000000aa" as never,
  displayName: "Tester",
  role: "holder" as const,
};
/** Flat test world (H = 0): the Node lane has no `.bin` asset loader; the browser lane uses the fixture cube. */
export const FLAT_WORLD: SimHostWorldConfig = { kind: "flat" };
const FLAT_GROUND: SimGround = { heightAtXYZ: () => 0 };

let grid: IcoPlotGrid | undefined;

/** The Standard grid shared by the test helpers. */
export function testGrid(): IcoPlotGrid {
  return (grid ??= createPlotGrid(STANDARD_GRID_PARAMS));
}

/** A fresh dust ledger built exactly like the worker's. */
export function soloLedger(): WorldDustLedger {
  return createRoomDustLedger(testGrid(), loadGameData());
}

/**
 * The same sim the worker builds (real dust ledger included), run directly (parity reference). `ledger`: continue on
 * an existing dust state instead of an untouched moon.
 */
export function directSim(ground: SimGround = FLAT_GROUND, ledger: WorldDustLedger = soloLedger()): MoonRoomSim {
  const sim = new MoonRoomSim({
    data: loadGameData(),
    world: { grid: testGrid(), ground },
    ledger,
    contractId: TEST_CONTRACT,
    shiftType: "solo",
  });
  sim.addActor(0, TEST_PLAYER);
  return sim;
}

/**
 * A save written exactly like the pre-codec sim-host did (sections META v0 / PLAYERS v0, see sim-checkpoint.ts), so the
 * legacy read path is tested against the real old layout. Test-only: the host never writes version 0 any more.
 */
export function encodeLegacyV0Save(sim: MoonRoomSim, generation = 3): Uint8Array {
  const meta = new Uint8Array(8);
  new DataView(meta.buffer).setFloat64(0, sim.wallet, true);
  const toolCount = sim.config.tools.length;
  const per = 1 + 72 + 4 + 3 + 4 * toolCount;
  let count = 0;
  for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) if (sim.avatar(s).active) count++;
  const players = new Uint8Array(1 + count * per);
  const v = new DataView(players.buffer);
  players[0] = count;
  let at = 1;
  for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
    const a = sim.avatar(s);
    if (!a.active) continue;
    const t = sim.toolState(s);
    players[at++] = s;
    for (const x of [a.px, a.py, a.pz, a.vx, a.vy, a.vz, a.fx, a.fy, a.fz]) {
      v.setFloat64(at, x, true);
      at += 8;
    }
    v.setUint32(at, t.owned >>> 0, true);
    at += 4;
    players[at++] = t.toolCode;
    players[at++] = t.holsterSlot;
    players[at++] = toolCount;
    for (let k = 0; k < toolCount; k++) {
      v.setInt32(at, t.cellGrams[k] ?? 0, true);
      at += 4;
    }
  }
  return encodeSaveEnvelope(
    {
      saveFormatVersion: SAVE_FORMAT_VERSION,
      gridM: STANDARD_GRID_PARAMS.gridM,
      radiusM: STANDARD_GRID_PARAMS.radiusM,
      plotCount: STANDARD_GRID_PARAMS.plotCount,
      bakeHash: "0".repeat(64),
      dustModelVersion: DUST_MODEL_VERSION,
      simTick: sim.tick,
      generation,
      parentGeneration: generation - 1,
      originKind: "solo",
      originId: "0".repeat(32),
      sections: [
        { id: SAVE_SECTION_ID.META, version: 0, length: meta.length },
        { id: SAVE_SECTION_ID.PLAYERS, version: 0, length: players.length },
      ],
    },
    [meta, players],
  );
}

/** Deterministic scripted inputs (walk, Lope, jumps, sweeping), one per tick, seq 1.. */
export function scriptedInputs(n: number, seed = 0x51ed): SimInputCommand[] {
  const next = mulberry32(seed);
  const out: SimInputCommand[] = [];
  let hold = 0;
  let moveX = 0;
  let moveY = 0;
  let yaw = 0;
  let yawRate = 0;
  let buttons = 0;
  for (let i = 0; i < n; i++) {
    if (hold-- <= 0) {
      hold = 5 + (next() % 30);
      moveX = (next() % 255) - 127;
      moveY = (next() % 255) - 127;
      yawRate = (next() % 800) - 400;
      const r = next() % 100;
      buttons = r < 55 ? 1 << 3 : r < 70 ? 1 << 2 : r < 80 ? 1 << 0 : 0;
    }
    yaw = (yaw + yawRate + 65536) % 65536;
    out.push({ seq: (i + 1) & 0xffff, moveX, moveY, yaw, pitch: -20, buttons, toolParam: 180 });
  }
  return out;
}

/**
 * A SimWorkerLike backed by a MessageChannel and an in-process SimWorkerCore: real structured clone and ArrayBuffer
 * transfer semantics, no Worker global needed. An exception inside the core surfaces as the host's `onerror`, like a
 * real worker error event.
 */
export function channelWorker(): SimWorkerLike {
  const ch = new MessageChannel();
  const core = new SimWorkerCore({ postMessage: (m, t) => ch.port2.postMessage(m, t) });
  const fake: SimWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (m, t) => ch.port1.postMessage(m, t),
    terminate: () => {
      ch.port1.close();
      ch.port2.close();
    },
  };
  ch.port2.onmessage = (e: MessageEvent) => {
    try {
      core.handle(e.data);
    } catch (err) {
      fake.onerror?.({ message: String(err) } as ErrorEvent);
    }
  };
  ch.port1.onmessage = (e: MessageEvent) => fake.onmessage?.(e);
  return fake;
}
