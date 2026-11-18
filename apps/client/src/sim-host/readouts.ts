// HUD read-outs across the Solo worker boundary (integrator round 5, Job A).
//
// The worker owns the only MoonRoomSim, so the main thread cannot call its pure read helpers (`hopReadout`,
// `lampReadout`, `pickPlot`, `quotePriceLm`). Two halves:
// - `ReadoutSampler` (worker): sampled from the tick loop at most every READOUT_INTERVAL_MS (10 Hz); it fills reused
//   scratch objects, compares with the last posted sample and returns a message only when something changed. Nothing
//   runs on the input path, and the sim helpers write into reused out-buffers (no per-sample allocation).
// - `HostReadouts` (main): caches the newest message and answers the same four reads synchronously from the cache, so it
//   is a `SimReadoutSource` of the app's HUD writer (structurally; the app never imports this directory's internals).
//   Reading costs a few field copies and no allocation. Samples of an older request (`seq`) are ignored.

import type { PlotId, PlotState } from "@moon-cleanup/shared";
import {
  HopReadout,
  LampReadout,
  OutpostReadout,
  PlotCardData,
  VehicleReadout,
  VEHICLE_ENTITY_ID_BASE,
  type MoonRoomSim,
} from "@moon-cleanup/sim";
import { READOUT_INTERVAL_MS, type SimReadoutMessage } from "./messages";

function blank(): SimReadoutMessage {
  return {
    t: "ro",
    reqSeq: 0,
    vehicleMotion: null,
    parkedVehicle: null,
    hopBursts: 0,
    hopMax: 0,
    hopRecharge01: 0,
    lampLevel: 0,
    lampSwitchedOn: false,
    lampLit: false,
    plotOpen: false,
    plotId: 0,
    plotState: 0,
    plotRemainingPct: 100,
    plotTerrainId: null,
    plotCreditedSlot: -1,
    plotCountsTowardShine: false,
    plotShinePctPerPlot: 0,
    quotes: [],
    parcelCount: 0,
    parcelMask: 0,
    parcelDirs: [],
    outpostIds: [],
    outpostDirs: [],
    apronDirs: [],
  };
}

function same(a: SimReadoutMessage, b: SimReadoutMessage): boolean {
  const av = a.vehicleMotion;
  const bv = b.vehicleMotion;
  if (av == null || bv == null) {
    if (av !== bv) return false;
  } else if (
    av.vehicleId !== bv.vehicleId ||
    av.kindId !== bv.kindId ||
    av.speed01 !== bv.speed01 ||
    av.load01 !== bv.load01 ||
    av.workIntensity01 !== bv.workIntensity01 ||
    av.lights !== bv.lights
  )
    return false;
  const ap = a.parkedVehicle;
  const bp = b.parkedVehicle;
  if (ap == null || bp == null) {
    if (ap !== bp) return false;
  } else if (ap.x !== bp.x || ap.y !== bp.y || ap.z !== bp.z || ap.fx !== bp.fx || ap.fy !== bp.fy || ap.fz !== bp.fz)
    return false;
  if (
    a.reqSeq !== b.reqSeq ||
    a.hopBursts !== b.hopBursts ||
    a.hopMax !== b.hopMax ||
    a.hopRecharge01 !== b.hopRecharge01 ||
    a.lampLevel !== b.lampLevel ||
    a.lampSwitchedOn !== b.lampSwitchedOn ||
    a.lampLit !== b.lampLit ||
    a.plotOpen !== b.plotOpen ||
    a.plotId !== b.plotId ||
    a.plotState !== b.plotState ||
    a.plotRemainingPct !== b.plotRemainingPct ||
    a.plotTerrainId !== b.plotTerrainId ||
    a.plotCreditedSlot !== b.plotCreditedSlot ||
    a.plotCountsTowardShine !== b.plotCountsTowardShine ||
    a.plotShinePctPerPlot !== b.plotShinePctPerPlot ||
    a.quotes.length !== b.quotes.length ||
    a.parcelCount !== b.parcelCount ||
    a.parcelMask !== b.parcelMask ||
    a.outpostIds.length !== b.outpostIds.length ||
    a.apronDirs.length !== b.apronDirs.length
  ) {
    return false;
  }
  for (let i = 0; i < a.quotes.length; i++) if (a.quotes[i] !== b.quotes[i]) return false;
  for (let i = 0; i < a.parcelDirs.length; i++) if (a.parcelDirs[i] !== b.parcelDirs[i]) return false;
  for (let i = 0; i < a.outpostIds.length; i++) if (a.outpostIds[i] !== b.outpostIds[i]) return false;
  for (let i = 0; i < a.outpostDirs.length; i++) if (a.outpostDirs[i] !== b.outpostDirs[i]) return false;
  for (let i = 0; i < a.apronDirs.length; i++) if (a.apronDirs[i] !== b.apronDirs[i]) return false;
  return true;
}

/** Worker half. */
export class ReadoutSampler {
  private seq = 0;
  private inspecting = false;
  private itemIds: readonly string[] = [];
  private lastMs = Number.NEGATIVE_INFINITY;
  private hasPosted = false;
  private posted = blank();
  private cand = blank();
  private readonly hop = new HopReadout();
  private readonly lamp = new LampReadout();
  private readonly vehicle = new VehicleReadout();
  private readonly card = new PlotCardData();
  private readonly dir = { x: 0, y: 0, z: 0 };
  private readonly outpost = new OutpostReadout();

  /** New request from the main thread: sampled again at the next tick (not after the interval). */
  request(seq: number, inspecting: boolean, itemIds: readonly string[]): void {
    this.seq = seq;
    this.inspecting = inspecting;
    this.itemIds = itemIds;
    this.lastMs = Number.NEGATIVE_INFINITY;
  }

  /** Nothing to answer before the first request (the main thread has no consumer yet). */
  get active(): boolean {
    return this.seq > 0;
  }

  /** The message to post now, or null (not due, inactive slot, or nothing changed since the last post). */
  sample(sim: MoonRoomSim, slot: number, nowMs: number): SimReadoutMessage | null {
    if (this.seq === 0 || nowMs - this.lastMs < READOUT_INTERVAL_MS) return null;
    this.lastMs = nowMs;
    const m = this.cand;
    if (!sim.hopReadout(slot, this.hop) || !sim.lampReadout(slot, this.lamp)) return null;
    m.reqSeq = this.seq;
    const vi = sim.vehicles.driving[slot] ?? -1;
    const vehicle = vi < 0 ? undefined : sim.vehicles.store.vehicles[vi];
    if (vehicle !== undefined && sim.vehicles.readout(slot, this.vehicle)) {
      const v =
        m.vehicleMotion ??
        (m.vehicleMotion = { tick: 0, vehicleId: 0, kindId: "", speed01: 0, load01: 0, workIntensity01: 0 });
      v.tick = Math.max(0, sim.tick - 1); // the completed tick, matching RoomSim event timestamps
      v.vehicleId = VEHICLE_ENTITY_ID_BASE + vi;
      v.kindId = this.vehicle.kindId;
      v.speed01 = this.vehicle.speed01;
      v.load01 = this.vehicle.hopper01;
      v.lights = this.vehicle.lights;
      v.workIntensity01 =
        this.vehicle.intakeDown &&
        !this.vehicle.airborne &&
        !this.vehicle.boosting &&
        vehicle.speed > 0.05 &&
        vehicle.stats.widthM > 0 &&
        this.vehicle.hopper01 < 1
          ? this.vehicle.speed01
          : 0;
    } else m.vehicleMotion = null;
    let parked: (typeof sim.vehicles.store.vehicles)[number] | undefined;
    if (vi < 0) {
      const vs = sim.vehicles.store.vehicles;
      for (let k = 0; k < vs.length; k++) {
        const c = vs[k]!;
        if (c.active && c.ownerSlot === slot && c.driverSlot < 0) {
          parked = c;
          break;
        }
      }
    }
    if (parked === undefined) m.parkedVehicle = null;
    else {
      const p = m.parkedVehicle ?? (m.parkedVehicle = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 0 });
      p.x = parked.px;
      p.y = parked.py;
      p.z = parked.pz;
      p.fx = parked.fx;
      p.fy = parked.fy;
      p.fz = parked.fz;
    }
    m.hopBursts = this.hop.bursts;
    m.hopMax = this.hop.max;
    m.hopRecharge01 = this.hop.recharge01;
    m.lampLevel = this.lamp.level;
    m.lampSwitchedOn = this.lamp.switchedOn;
    m.lampLit = this.lamp.lit;
    const c = this.card;
    const open = this.inspecting && sim.pickPlot(slot, c);
    m.plotOpen = open;
    m.plotId = open ? c.plotId : 0;
    m.plotState = open ? c.state : 0;
    m.plotRemainingPct = open ? c.remainingPct : 100;
    m.plotTerrainId = open ? c.terrainId : null;
    m.plotCreditedSlot = open ? (c.creditedSlot ?? -1) : -1;
    m.plotCountsTowardShine = open ? c.countsTowardShine : false;
    m.plotShinePctPerPlot = open ? c.shinePctPerPlot : 0;
    const ids = this.itemIds;
    m.quotes.length = ids.length;
    for (let i = 0; i < ids.length; i++) m.quotes[i] = sim.quotePriceLm(slot, ids[i]!);
    const pc = sim.nearParcelCount;
    m.parcelCount = pc;
    m.parcelDirs.length = pc * 3;
    let mask = 0;
    for (let k = 0; k < pc; k++) {
      if (sim.nearParcel(k, this.dir)) mask |= 1 << k;
      m.parcelDirs[3 * k] = this.dir.x;
      m.parcelDirs[3 * k + 1] = this.dir.y;
      m.parcelDirs[3 * k + 2] = this.dir.z;
    }
    m.parcelMask = mask;
    const oc = sim.outpostCount;
    m.outpostIds.length = oc;
    m.outpostDirs.length = oc * 3;
    for (let k = 0; k < oc; k++) {
      if (!sim.outpost(k, this.outpost)) continue;
      m.outpostIds[k] = this.outpost.id;
      m.outpostDirs[3 * k] = this.outpost.x;
      m.outpostDirs[3 * k + 1] = this.outpost.y;
      m.outpostDirs[3 * k + 2] = this.outpost.z;
    }
    const ac = sim.apronPlotCount;
    m.apronDirs.length = ac * 3;
    for (let k = 0; k < ac; k++) {
      if (!sim.apronPlot(k, this.dir)) continue;
      m.apronDirs[3 * k] = this.dir.x;
      m.apronDirs[3 * k + 1] = this.dir.y;
      m.apronDirs[3 * k + 2] = this.dir.z;
    }
    if (this.hasPosted && same(m, this.posted)) return null;
    this.cand = this.posted;
    this.posted = m;
    this.hasPosted = true;
    return m;
  }
}

/** Plot Card out-buffer (structurally the app's `PlotCardOut`). */
export interface HostPlotCardOut {
  plotId: PlotId;
  state: PlotState;
  remainingPct: number;
  terrainId: string | null;
  creditedSlot: number | null;
  countsTowardShine: boolean;
  shinePctPerPlot: number;
}

/** Main thread half: the newest read-outs of the worker, as the same four synchronous reads the sim offers. */
export class HostReadouts {
  private seq = 0;
  private ids = new Map<string, number>();
  private msg: SimReadoutMessage | null = null;

  /** The structured-clone cache is readonly to consumers; no copy or allocation per frame. */
  get vehicleMotion(): SimReadoutMessage["vehicleMotion"] {
    return this.msg?.vehicleMotion;
  }

  /** Own parked (called, not driven) vehicle pose, or null / undefined (no first sample yet). */
  get parkedVehicle(): SimReadoutMessage["parkedVehicle"] {
    return this.msg?.parkedVehicle;
  }

  /** A new request: clears the cache until the worker answers it. Returns the `seq` to send. */
  nextRequest(itemIds: readonly string[]): number {
    this.seq++;
    this.ids = new Map(itemIds.map((id, i) => [id, i]));
    this.msg = null;
    return this.seq;
  }

  /** Worker message in. Returns false when it answers an older request. */
  accept(m: SimReadoutMessage): boolean {
    if (m.reqSeq !== this.seq) return false;
    // The worker reuses its objects; the structured clone is already a private copy, so it is kept as is.
    this.msg = m;
    return true;
  }

  /** Forget the cache (worker reboot): the next request repopulates it. */
  reset(): void {
    this.msg = null;
  }

  /** Slot is ignored: the Solo worker has the own avatar only. */
  hopReadout(_slot: number, out: { bursts: number; max: number; recharge01: number }): boolean {
    const m = this.msg;
    if (m === null) return false;
    out.bursts = m.hopBursts;
    out.max = m.hopMax;
    out.recharge01 = m.hopRecharge01;
    return true;
  }

  lampReadout(_slot: number, out: { level: number; switchedOn: boolean; lit: boolean }): boolean {
    const m = this.msg;
    if (m === null) return false;
    out.level = m.lampLevel;
    out.switchedOn = m.lampSwitchedOn;
    out.lit = m.lampLit;
    return true;
  }

  /** The plot in front of the avatar; only while the host was asked to inspect. */
  pickPlot(_slot: number, out: HostPlotCardOut): boolean {
    const m = this.msg;
    if (m === null || !m.plotOpen) return false;
    out.plotId = m.plotId as PlotId;
    out.state = m.plotState as PlotState;
    out.remainingPct = m.plotRemainingPct;
    out.terrainId = m.plotTerrainId;
    out.creditedSlot = m.plotCreditedSlot < 0 ? null : m.plotCreditedSlot;
    out.countsTowardShine = m.plotCountsTowardShine;
    out.shinePctPerPlot = m.plotShinePctPerPlot;
    return true;
  }

  /** Near Parcels (the shape of the UI's `NearParcelSource`): count, and direction of parcel k (true = collected). */
  get nearParcelCount(): number {
    return this.msg?.parcelCount ?? 0;
  }

  nearParcel(k: number, out: { x: number; y: number; z: number }): boolean {
    const m = this.msg;
    if (m === null || k < 0 || k >= m.parcelCount) return false;
    out.x = m.parcelDirs[3 * k] ?? 0;
    out.y = m.parcelDirs[3 * k + 1] ?? 0;
    out.z = m.parcelDirs[3 * k + 2] ?? 0;
    return ((m.parcelMask >>> k) & 1) === 1;
  }

  get outpostCount(): number {
    return this.msg?.outpostIds.length ?? 0;
  }

  /** Outpost k: id and pad direction. False out of range. */
  outpost(k: number, out: { id: string; x: number; y: number; z: number }): boolean {
    const m = this.msg;
    const id = m?.outpostIds[k];
    if (m === null || id === undefined) return false;
    out.id = id;
    out.x = m.outpostDirs[3 * k] ?? 0;
    out.y = m.outpostDirs[3 * k + 1] ?? 0;
    out.z = m.outpostDirs[3 * k + 2] ?? 0;
    return true;
  }

  /** Landing Apron plots of the home outpost (shape of `MoonRoomSim.apronPlotCount` / `apronPlot`). */
  get apronPlotCount(): number {
    return (this.msg?.apronDirs.length ?? 0) / 3;
  }

  apronPlot(k: number, out: { x: number; y: number; z: number }): boolean {
    const m = this.msg;
    if (m === null || !(k >= 0) || 3 * k + 2 >= m.apronDirs.length) return false;
    out.x = m.apronDirs[3 * k] ?? 0;
    out.y = m.apronDirs[3 * k + 1] ?? 0;
    out.z = m.apronDirs[3 * k + 2] ?? 0;
    return true;
  }

  /** Price of the next purchase; -1 when unknown (not requested yet) or not buyable. */
  quotePriceLm(_slot: number, itemId: string): number {
    const m = this.msg;
    const k = this.ids.get(itemId);
    if (m === null || k === undefined) return -1;
    return m.quotes[k] ?? -1;
  }
}
