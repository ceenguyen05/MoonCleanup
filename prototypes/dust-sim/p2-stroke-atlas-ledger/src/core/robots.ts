// P2 prototype: robots as ledger operations (WDS 4.8). A robot intent fixes a lane plan on one plot; server and
// interested clients expand it into the same 1-second chunks (one flat-ended segment each) keyed by server tick:
// chunk k is applied at tick startTick + (k + 1) * simTickHz. Lanes run parallel to the plot's u axis, spacing
// 0.9 x width, lane 0 at the smallest v, alternating direction; laneMask selects lanes (two u32 words).
// Environment-agnostic. step() allocates nothing.

import type { DustView } from "./dust-view";
import { FRAME_EDGE_MM, FRAME_HALF_MM } from "./dust-view";
import type { StrokeLog } from "./stroke-log";
import { applyLogged, type StrokeSink } from "./util";

/** Robots are credited to the shift (actor slots 16 .. 63 are non-player). */
export const ROBOT_ACTOR_SLOT = 63;
export const ROBOT_TOOL_CODE = 62;
/** robot.plot record: robotId 16 + plotId 18 + startTick 32 + width 10 + depth16 8 + speed 10 + laneMask 64 bits. */
export const ROBOT_INTENT_BYTES = 20;

export class RobotPlans {
  private cap = 0;
  active = new Uint8Array(0);
  plot = new Int32Array(0);
  startTick = new Int32Array(0);
  /** Chunks with tick < fromTick are not applied (intent learned late through interest entry). */
  fromTick = new Int32Array(0);
  widthCm = new Uint16Array(0);
  depth16 = new Uint8Array(0);
  speedCmPerS = new Uint16Array(0);
  mask0 = new Uint32Array(0);
  mask1 = new Uint32Array(0);
  /** Bumped every time the robot gets a new intent (lets a peer know which intent it holds). */
  serial = new Int32Array(0);
  /** Highest robot id seen + 1. */
  n = 0;
  activeCount = 0;
  chunksApplied = 0;

  // chunk geometry (set by chunk())
  private cU0 = 0;
  private cU1 = 0;
  private cV = 0;

  private grow(cap: number): void {
    const g = <T extends Uint8Array | Int32Array | Uint16Array | Uint32Array>(old: T, fresh: T): T => {
      fresh.set(old);
      return fresh;
    };
    this.active = g(this.active, new Uint8Array(cap));
    this.plot = g(this.plot, new Int32Array(cap));
    this.startTick = g(this.startTick, new Int32Array(cap));
    this.fromTick = g(this.fromTick, new Int32Array(cap));
    this.widthCm = g(this.widthCm, new Uint16Array(cap));
    this.depth16 = g(this.depth16, new Uint8Array(cap));
    this.speedCmPerS = g(this.speedCmPerS, new Uint16Array(cap));
    this.mask0 = g(this.mask0, new Uint32Array(cap));
    this.mask1 = g(this.mask1, new Uint32Array(cap));
    this.serial = g(this.serial, new Int32Array(cap));
    this.cap = cap;
  }

  set(
    id: number,
    plot: number,
    startTick: number,
    widthCm: number,
    depth16: number,
    speedCmPerS: number,
    mask0: number,
    mask1: number,
    fromTick: number,
  ): void {
    if (id >= this.cap) this.grow(Math.max(64, (id + 1) * 2));
    if (id >= this.n) this.n = id + 1;
    if (this.active[id] === 0) this.activeCount++;
    this.active[id] = 1;
    this.plot[id] = plot;
    this.startTick[id] = startTick;
    this.fromTick[id] = fromTick;
    this.widthCm[id] = widthCm;
    this.depth16[id] = depth16;
    this.speedCmPerS[id] = speedCmPerS;
    this.mask0[id] = mask0;
    this.mask1[id] = mask1;
    this.serial[id] = this.serial[id]! + 1;
  }

  clear(): void {
    this.active.fill(0);
    this.activeCount = 0;
    this.n = 0;
  }

  /** Geometry of chunk k of robot `id`: 1 = segment in cU0/cU1/cV, 0 = nothing to do, -1 = plan finished. */
  private chunk(id: number, k: number): number {
    const chunkLen = this.speedCmPerS[id]! * 10;
    const perLane = Math.ceil(FRAME_EDGE_MM / chunkLen);
    const ordinal = Math.floor(k / perLane);
    // The ordinal-th enabled lane.
    let lane = -1;
    let seen = 0;
    const m0 = this.mask0[id]!;
    const m1 = this.mask1[id]!;
    for (let b = 0; b < 64; b++) {
      const bit = b < 32 ? (m0 >>> b) & 1 : (m1 >>> (b - 32)) & 1;
      if (bit === 1) {
        if (seen === ordinal) {
          lane = b;
          break;
        }
        seen++;
      }
    }
    if (lane < 0) return -1;
    const v = Math.floor(((2 * lane + 1) * this.widthCm[id]! * 9) / 2) - FRAME_HALF_MM;
    if (v >= FRAME_HALF_MM) return -1;
    const a = (k % perLane) * chunkLen;
    let b = a + chunkLen;
    if (b > FRAME_EDGE_MM) b = FRAME_EDGE_MM;
    if ((ordinal & 1) === 0) {
      this.cU0 = a - FRAME_HALF_MM;
      this.cU1 = b - FRAME_HALF_MM;
    } else {
      this.cU0 = FRAME_HALF_MM - a;
      this.cU1 = FRAME_HALF_MM - b;
    }
    this.cV = v;
    return 1;
  }

  /** Applies every chunk due at `tick`, robots in ascending id (WDS 4.5a). Returns units removed. */
  step(
    tick: number,
    hz: number,
    view: DustView,
    log: StrokeLog | null,
    chunkDirty: Uint8Array | null,
    sink: StrokeSink | null,
  ): number {
    if (this.activeCount === 0) return 0;
    let removed = 0;
    for (let id = 0; id < this.n; id++) {
      if (this.active[id] === 0) continue;
      const dt = tick - this.startTick[id]!;
      if (dt <= 0 || dt % hz !== 0) continue;
      const r = this.chunk(id, dt / hz - 1);
      if (r < 0) {
        this.active[id] = 0;
        this.activeCount--;
        continue;
      }
      if (tick < this.fromTick[id]!) continue;
      removed += applyLogged(
        view,
        log,
        this.plot[id]!,
        this.cU0,
        this.cV,
        this.cU1,
        this.cV,
        this.widthCm[id]!,
        this.depth16[id]!,
        ROBOT_TOOL_CODE,
        ROBOT_ACTOR_SLOT,
      );
      this.chunksApplied++;
      if (sink !== null) {
        sink.onStroke(this.plot[id]!, this.cU0, this.cV, this.cU1, this.cV, this.widthCm[id]!, this.depth16[id]!);
      }
      if (chunkDirty !== null) {
        for (let i = 0; i < view.outN; i++) {
          if (view.outRemoved[i]! > 0) chunkDirty[view.t.chunkOf[view.outPlots[i]!]!] = 1;
        }
      }
    }
    return removed;
  }
}
