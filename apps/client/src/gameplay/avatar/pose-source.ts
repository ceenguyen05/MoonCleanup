// Own-avatar pose for the camera rig and the placeholder avatar (M1-W3-T05).
//
// - `FrameAvatarSource` (Solo and any RoomHost): decodes the Self block of every host FRAME with the packages/protocol
//   FrameReader (same decode path as the dust view and a server room) and interpolates the two newest authoritative
//   positions by arrival time (one tick of render delay, like sim-host FrameTimeline). Allocation-free per frame for
//   the LocalRoom host (its pooled `frameBytes` view); a host without `frameBytes` costs one view per frame.
// - `PredictorPoseSource` (online): reads a predictor's present state plus its decaying correction offset. Typed
//   structurally, so this file never imports the net chunk.

import {
  FRAME_MAX_BYTES,
  STANDARD_GRID_PARAMS,
  type RoomHost,
  type RoomHostFrame,
  type Unsubscribe,
} from "@moon-cleanup/shared";
import { FRAME_OK, FrameReader, FrameView, SlotTable, type SelfState } from "@moon-cleanup/protocol";
import { createPlotGrid } from "@moon-cleanup/world";

/** Where the avatar is: moon-centred metres. */
export interface AvatarPoseSource {
  /** Writes the render-time position into `out[0..2]`; false while no pose is known. */
  sample(t: { readonly nowMs: number }, out: Float64Array): boolean;
  /** Not standing on the ground (jump presses then also ask for the Hop Pack). */
  readonly airborne: boolean;
}

/** A host as the source needs it; `frameBytes` is the LocalRoom host's pooled view (optional). */
export type FrameHostLike = Pick<RoomHost, "onFrame" | "simTickHz"> & {
  frameBytes?(frame: RoomHostFrame): Uint8Array;
};

let standardPlotCount = -1;
/** Plot count of the standard grid (the FRAME decoder validates plot ids against it); built once per page. */
export function standardGridPlotCount(): number {
  if (standardPlotCount < 0) standardPlotCount = createPlotGrid(STANDARD_GRID_PARAMS).count;
  return standardPlotCount;
}

export class FrameAvatarSource implements AvatarPoseSource {
  airborne = false;
  framesDecoded = 0;
  decodeErrors = 0;
  /** Tick of the newest decoded frame (-1 before the first). */
  tick = -1;
  /** Highest own input seq acknowledged by the newest frame. */
  ackInputSeq = 0;
  /** Own-actor stroke evidence (dev hook): stroke chains in decoded frames, frames that had any, newest such tick. */
  strokeChains = 0;
  strokeFrames = 0;
  lastStrokeTick = -1;
  /** Dust Cell grams of the own actor (Self `cellGrams`, the worker's dust ack). */
  cellGrams = 0;
  /** Body yaw code of the newest Self (10 bit; while driving, the vehicle heading). */
  yawCode = 0;
  /** Called with every decoded Self and its ack (the Solo predictor reconciles here). Inside the frame listener. */
  selfListener: ((self: SelfState, ackInputSeq: number) => void) | null = null;
  private readonly reader = new FrameReader();
  private readonly view = new FrameView();
  private readonly table = new SlotTable();
  private readonly scratch = new Uint8Array(FRAME_MAX_BYTES);
  private readonly views: (Uint8Array | undefined)[] = [];
  private readonly prev = new Float64Array(3);
  private readonly cur = new Float64Array(3);
  private known = 0;
  private arrivalMs = 0;
  private tickMs = 50;
  private off: Unsubscribe | null = null;
  private host: FrameHostLike | null = null;
  private readonly onFrameFn = (f: RoomHostFrame): void => this.onFrame(f);

  constructor(
    private readonly now: () => number,
    private readonly plotCount: () => number = standardGridPlotCount,
  ) {}

  /** Follows `host` (null detaches). The pose is kept until the new host's first frame. */
  attach(host: FrameHostLike | null): void {
    if (host === this.host) return;
    this.off?.();
    this.off = null;
    this.host = host;
    this.table.reset();
    if (host === null) return;
    this.tickMs = 1000 / host.simTickHz;
    this.off = host.onFrame(this.onFrameFn);
  }

  sample(t: { readonly nowMs: number }, out: Float64Array): boolean {
    if (this.known === 0) return false;
    let a = this.known === 1 ? 1 : (t.nowMs - this.arrivalMs) / this.tickMs;
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    const p = this.prev;
    const c = this.cur;
    out[0] = p[0]! + (c[0]! - p[0]!) * a;
    out[1] = p[1]! + (c[1]! - p[1]!) * a;
    out[2] = p[2]! + (c[2]! - p[2]!) * a;
    return true;
  }

  /** Decodes one frame (public for tests). Reads inside the listener and releases, per the RoomHost contract. */
  onFrame(f: RoomHostFrame): void {
    const len = f.byteLength;
    if (len <= 0 || len > FRAME_MAX_BYTES) {
      f.release();
      return;
    }
    const src = this.host?.frameBytes?.(f) ?? new Uint8Array(f.bytes, 0, len);
    const scratch = this.scratch;
    for (let i = 0; i < len; i++) scratch[i] = src[i]!;
    f.release();
    let view = this.views[len];
    if (view === undefined) {
      view = scratch.subarray(0, len);
      this.views[len] = view;
    }
    const fv = this.view;
    if (this.reader.decode(view, fv, this.table, this.plotCount()) !== FRAME_OK) {
      this.decodeErrors++;
      this.table.reset();
      return;
    }
    this.framesDecoded++;
    const s = fv.self;
    const p = this.prev;
    const c = this.cur;
    if (this.known === 0) {
      p[0] = s.px;
      p[1] = s.py;
      p[2] = s.pz;
    } else {
      p[0] = c[0]!;
      p[1] = c[1]!;
      p[2] = c[2]!;
    }
    c[0] = s.px;
    c[1] = s.py;
    c[2] = s.pz;
    this.known = this.known === 0 ? 1 : 2;
    this.arrivalMs = this.now();
    this.airborne = s.moveState !== 0;
    this.tick = fv.serverTick;
    this.ackInputSeq = fv.ackInputSeq;
    this.cellGrams = s.cellGrams;
    this.yawCode = s.yawCode;
    const chains = fv.strokes.chainCount;
    if (chains > 0) {
      this.strokeChains += chains;
      this.strokeFrames++;
      this.lastStrokeTick = fv.serverTick;
    }
    this.selfListener?.(s, fv.ackInputSeq);
  }

  dispose(): void {
    this.attach(null);
  }
}

/** What the online predictor exposes (net/predictor.ts OwnAvatarPredictor satisfies it structurally). */
export interface PredictorLike {
  readonly ready: boolean;
  readonly state: { readonly px: number; readonly py: number; readonly pz: number; readonly moveState: number };
  readonly offset: Float64Array;
}

export class PredictorPoseSource implements AvatarPoseSource {
  constructor(private readonly predictor: PredictorLike) {}

  get airborne(): boolean {
    return this.predictor.state.moveState !== 0;
  }

  sample(_t: { readonly nowMs: number }, out: Float64Array): boolean {
    const p = this.predictor;
    if (!p.ready) return false;
    out[0] = p.state.px + p.offset[0]!;
    out[1] = p.state.py + p.offset[1]!;
    out[2] = p.state.pz + p.offset[2]!;
    return true;
  }
}
