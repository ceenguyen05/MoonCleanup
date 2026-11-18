// Self vehicle block of the Solo frame encoder (M1-W7-T01 integration): a real MoonRoomSim drives a Trundle, the
// encoder writes the FRAME, the protocol reader decodes it; the block must match the sim's vehicle (wire precision).
import { describe, expect, test } from "vitest";
import {
  FRAME_MAX_BYTES,
  FRAME_SELF_DRIVER_MOVE_STATE,
  INPUT_BUTTON_MASK as M,
  QUANT,
  STANDARD_GRID_PARAMS,
  type ContractId,
  type RequestId,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { FRAME_OK, FrameReader, FrameView, SlotTable, unpackQuat } from "@moon-cleanup/protocol";
import { createRoomDustLedger, MoonRoomSim, vehicleBasis, type SimWorld } from "@moon-cleanup/sim";
import { createPlotGrid } from "@moon-cleanup/world";
import { SimFrameEncoder } from "./sim-frame-encoder";
import { FRAME_BUF_BYTES, FRAME_TRAILER_OFFSET } from "./messages";

const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: { heightAtXYZ: () => 0 } };

function newSim(): MoonRoomSim {
  const sim = new MoonRoomSim({
    data,
    world,
    ledger: createRoomDustLedger(grid, data, { tickHz: 20 }),
    contractId: "00000000-0000-4000-8000-0000000000ae" as ContractId,
    shiftType: "private",
    tickHz: 20,
    snapshotHz: 10,
    walletLm: 100_000,
  });
  sim.addActor(0, { playerId: "p" as never, displayName: "P", role: "holder" });
  sim.onEvent(() => undefined);
  return sim;
}

let seq = 0;
function tick(sim: MoonRoomSim, over: Partial<SimInputCommand> = {}): number {
  seq = (seq + 1) & 0xffff;
  sim.applyInput(0, { seq, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 255, ...over });
  sim.step(sim.config.dt);
  return seq;
}

function decode(enc: SimFrameEncoder, sim: MoonRoomSim, ack: number, out: Uint8Array): FrameView {
  const len = enc.encode(sim, 0, ack, 0, out);
  expect(len).toBeGreaterThan(0);
  expect(len).toBeLessThanOrEqual(FRAME_MAX_BYTES);
  const fv = new FrameView();
  expect(new FrameReader().decode(out.subarray(0, len), fv, new SlotTable(), grid.count)).toBe(FRAME_OK);
  return fv;
}

describe("SimFrameEncoder Self vehicle block", () => {
  test("on foot: avatar-only Self; seated: the block matches the driven Trundle", () => {
    const sim = newSim();
    const enc = new SimFrameEncoder();
    const out = new Uint8Array(FRAME_BUF_BYTES);
    // The private trailer area after FRAME_MAX_BYTES must never be written by the encoder.
    out.fill(0xa5, FRAME_TRAILER_OFFSET);
    let ack = tick(sim);
    expect(decode(enc, sim, ack, out).self.moveState).not.toBe(FRAME_SELF_DRIVER_MOVE_STATE);

    const r = sim.applyIntent(0, { kind: "purchase", requestId: "rTrundle" as RequestId, itemId: "vehicle.trundle" });
    expect(r?.ok).toBe(true);
    for (const b of [M.seatSwitch, M.interact]) {
      tick(sim, { buttons: b });
      tick(sim);
    }
    expect(sim.vehicles.driving[0]).toBe(0);
    for (let i = 0; i < 30; i++) ack = tick(sim, { moveY: 127, moveX: i > 15 ? 60 : 0 });

    const s = decode(enc, sim, ack, out).self;
    const v = sim.vehicles.store.vehicles[0]!;
    const rec = sim.snapshot().vehicles[0]!;
    expect(s.moveState).toBe(FRAME_SELF_DRIVER_MOVE_STATE);
    expect(Math.abs(v.speed)).toBeGreaterThan(0.5);
    const posStep = 1 / 2048;
    expect(Math.abs(s.vpx - v.px)).toBeLessThanOrEqual(posStep);
    expect(Math.abs(s.vpy - v.py)).toBeLessThanOrEqual(posStep);
    expect(Math.abs(s.vpz - v.pz)).toBeLessThanOrEqual(posStep);
    const velStep = 1 / 256;
    expect(Math.abs(s.lvx - rec.linearVelocity.x)).toBeLessThanOrEqual(velStep);
    expect(Math.abs(s.lvy - rec.linearVelocity.y)).toBeLessThanOrEqual(velStep);
    expect(Math.abs(s.lvz - rec.linearVelocity.z)).toBeLessThanOrEqual(velStep);
    // Orientation: forward (-z body axis) of the decoded quaternion = the sim's heading.
    const q = unpackQuat(s.orientIndex, s.orientA, s.orientB, s.orientC, QUANT.vehicleOrientationOwn.componentBits, {
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    });
    const b = new Float64Array(9);
    vehicleBasis(v, b);
    expect(-2 * (q.x * q.z + q.w * q.y)).toBeCloseTo(b[3]!, 3);
    expect(-2 * (q.y * q.z - q.w * q.x)).toBeCloseTo(b[4]!, 3);
    expect(-(1 - 2 * (q.x * q.x + q.y * q.y))).toBeCloseTo(b[5]!, 3);
    // and its up (y body axis) = the surface normal.
    expect(2 * (q.x * q.y - q.w * q.z)).toBeCloseTo(b[0]!, 3);
    expect(Math.abs(s.steer - Math.round(v.steer * 127))).toBeLessThanOrEqual(1);
    expect(s.gear).toBe(v.gear);
    expect(s.boost).toBe(v.boosting);
    expect(s.lights).toBe(v.lights);
    for (let i = FRAME_TRAILER_OFFSET; i < out.length; i++) expect(out[i]).toBe(0xa5);
  });
});
