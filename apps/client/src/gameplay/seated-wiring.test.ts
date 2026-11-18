// GameplayModule <-> Solo Trundle prediction wiring (M1-W7-T01 integration). A fake local host runs a real MoonRoomSim
// behind the real Solo frame encoder (with the Self vehicle block); frames arrive one module frame late, like the
// worker. While seated, the module must present the predicted chassis (SeatedTrundle) through
// VehicleDriveView.updatePredicted, reconcile exactly from the vehicle block, and stop on exit / host change.
import { describe, expect, test } from "vitest";
import {
  STANDARD_GRID_PARAMS,
  type ContractId,
  type RequestId,
  type RoomHostFrame,
  type RoomSimEvent,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import {
  createRoomDustLedger,
  createSimConfig,
  MoonRoomSim,
  resolveVehicleTuning,
  type SimWorld,
} from "@moon-cleanup/sim";
import { createPlotGrid } from "@moon-cleanup/world";
import { SimFrameEncoder } from "../sim-host/sim-frame-encoder";
import { FRAME_BUF_BYTES } from "../sim-host/messages";
import { FLAT_GROUND, GameplayModule } from "./module";

const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: FLAT_GROUND };
const cfg = createSimConfig(data, { tickHz: 20 });
const tuning = resolveVehicleTuning(data, cfg);

function harness() {
  const sim = new MoonRoomSim({
    data,
    world,
    ledger: createRoomDustLedger(grid, data, { tickHz: 20 }),
    contractId: "00000000-0000-4000-8000-0000000000af" as ContractId,
    shiftType: "private",
    tickHz: 20,
    snapshotHz: 10,
    walletLm: 100_000,
  });
  sim.addActor(0, { playerId: "p" as never, displayName: "P", role: "holder" });
  const enc = new SimFrameEncoder();
  const queued: Uint8Array[] = [];
  const events: RoomSimEvent[] = [];
  let frameCb: ((f: RoomHostFrame) => void) | null = null;
  let eventCb: ((e: RoomSimEvent) => void) | null = null;
  sim.onEvent((e) => events.push(e));
  const step = (c: SimInputCommand): void => {
    sim.applyInput(0, c);
    sim.step(sim.config.dt);
    const buf = new Uint8Array(FRAME_BUF_BYTES);
    const len = enc.encode(sim, 0, c.seq, 0, buf);
    queued.push(buf.subarray(0, len));
  };
  const host = {
    kind: "local",
    state: "running",
    simTickHz: 20,
    sendInput: step,
    sendIntent: () => undefined,
    onFrame: (cb: (f: RoomHostFrame) => void) => {
      frameCb = cb;
      return () => (frameCb = null);
    },
    onShiftState: () => () => undefined,
    onEvent: (cb: (e: RoomSimEvent) => void) => {
      eventCb = cb;
      return () => (eventCb = null);
    },
    onStateChange: () => () => undefined,
  };
  /** Delivers the frames and events produced since the last flush (the worker's one-frame latency). */
  const flush = (): void => {
    for (const e of events.splice(0)) eventCb?.(e);
    for (const b of queued.splice(0)) {
      const copy = b.slice();
      frameCb?.({
        tick: 0 as never,
        ackInputSeq: 0,
        bytes: copy.buffer,
        byteLength: copy.byteLength,
        release: () => {},
      });
    }
  };
  let nowMs = 0;
  const m = new GameplayModule({
    win: null,
    cameraControl: false,
    placeholder: false,
    simConfig: cfg,
    vehicleTuning: tuning,
    ground: FLAT_GROUND,
    now: () => nowMs,
  });
  let hostListener: ((h: unknown) => void) | null = null;
  const roomHost = {
    current: host,
    onChange: (cb: (h: unknown) => void) => {
      hostListener = cb;
      return () => (hostListener = null);
    },
  };
  const roots = { camera: null, world: { add: () => undefined } };
  m.init({ services: { get: (k: string) => (k === "sceneRoots" ? roots : roomHost) }, events: {} } as never);
  const frame = (): void => {
    flush();
    nowMs += 1000 / 60;
    m.update({ dt: 1 / 60 } as never);
  };
  return { sim, m, frame, setHost: (h: unknown) => hostListener?.(h) };
}

describe("GameplayModule seated Trundle prediction", () => {
  test("seated: predicted chassis drives the chase camera, reconciled exactly from the vehicle block", () => {
    const { sim, m, frame, setHost } = harness();
    for (let i = 0; i < 20; i++) frame();
    const r = sim.applyIntent(0, { kind: "purchase", requestId: "rT" as RequestId, itemId: "vehicle.trundle" });
    expect(r?.ok).toBe(true);
    // Seat through the real input path: seat switch, then interact (held over a few ticks each).
    for (const key of ["KeyT", "KeyE"]) {
      m.input.keyDown(key);
      for (let i = 0; i < 6; i++) frame();
      m.input.keyUp(key);
      for (let i = 0; i < 6; i++) frame();
    }
    for (let i = 0; i < 6; i++) frame();
    expect(sim.vehicles.driving[0]).toBe(0);
    expect(m.drive.isActive).toBe(true);

    m.input.keyDown("KeyW");
    for (let i = 0; i < 90; i++) frame();
    const v = sim.vehicles.store.vehicles[0]!;
    expect(v.speed).toBeGreaterThan(1);
    expect(m.seated.ready).toBe(true);
    const stats = m.snapshot().vehiclePrediction!;
    expect(stats.exactReconciles).toBeGreaterThan(20);
    expect(stats.maxCorrectionM).toBeLessThan(0.05);
    // The chase camera ran on the predicted pose (updatePredicted copies it verbatim).
    expect(m.drive.vehiclePose.px).toBe(m.seated.pose.px);
    expect(m.drive.vehiclePose.speed).toBe(m.seated.pose.speed);
    // The predicted chassis is at (or a fraction of a tick ahead of) the authoritative one.
    const d = Math.hypot(m.seated.pose.px - v.px, m.seated.pose.py - v.py, m.seated.pose.pz - v.pz);
    expect(d).toBeLessThan(Math.abs(v.speed) * 0.1 + 0.02);
    m.input.keyUp("KeyW");

    // Host change: the seat and the prediction are dropped.
    setHost(null);
    expect(m.seated.ready).toBe(false);
    expect(m.drive.isActive).toBe(false);
    m.dispose();
  }, 60_000);
});
