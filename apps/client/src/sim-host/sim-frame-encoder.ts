// MoonRoomSim -> FRAME bytes (packages/protocol FrameWriter: one decode path for local and remote hosts, ADR-0031).
// Per frame: header (tick, ackInputSeq), Self = the local avatar, SlotChanges + avatar entity records for the other
// active slots, and every stroke accepted since the last SENT frame. Strokes of ticks whose frame was skipped (no
// free pool buffer) stay pending, so dust results are never lost; chains that do not fit roll over to the next frame.
// This is the interim frame source (the sim's hot-path `readSelf` proposal is still open, M1-W0-T02 open item 1); it
// reads the sim's live state objects, so it allocates nothing per frame.

import { AVATAR_ACTION_STATES, AVATAR_FLAG_BIT, MAX_PLAYERS_PER_ROOM, type ActorSlot } from "@moon-cleanup/shared";
import {
  FrameWriter,
  SlotTable,
  StrokeChainBuffer,
  createEntityState,
  createSelfState,
  pitchToCode,
  yawToCode,
  inputPitchToRadians,
} from "@moon-cleanup/protocol";
import { MOVE_GROUNDED, atan2Det, headingBasis, type AvatarState, type MoonRoomSim } from "@moon-cleanup/sim";

const ENTITY_KIND_AVATAR = 0;
const REC_DELTA = 1;
/** Pending stroke chains kept across skipped frames (about 3 s of one player sweeping at the 20 Hz chain rate). */
const PENDING_STROKE_CHAINS = 64;

const ACTION = {
  none: AVATAR_ACTION_STATES.indexOf("none"),
  airborne: AVATAR_ACTION_STATES.indexOf("airborne"),
  sweep: AVATAR_ACTION_STATES.indexOf("sweep"),
  detailing: AVATAR_ACTION_STATES.indexOf("trait_detailing"),
} as const;

export class SimFrameEncoder {
  private readonly writer = new FrameWriter();
  private readonly table = new SlotTable();
  private readonly self = createSelfState();
  private readonly ent = createEntityState();
  private readonly basis = new Float64Array(9);
  private readonly pending = new StrokeChainBuffer(PENDING_STROKE_CHAINS, 1);
  private keyframe = true;
  /** Strokes that did not fit the pending buffer (dust visuals would miss them; counted, never thrown). */
  strokesDropped = 0;
  /** Pending chains not yet sent. */
  get pendingStrokes(): number {
    return this.pending.chainCount;
  }

  /** Next encode starts over: keyframe, empty slot table (worker reboot / restore). */
  reset(): void {
    this.table.reset();
    this.pending.clear();
    this.keyframe = true;
  }

  /** Forgets the strokes not yet sent (a full dust state that already contains them went to the main thread). */
  dropPendingStrokes(): void {
    this.pending.clear();
  }

  /** Call after every `sim.step`: queues the strokes the step accepted. */
  collectStrokes(sim: MoonRoomSim): void {
    const n = sim.strokeCount;
    for (let k = 0; k < n; k++) {
      const r = sim.strokeAt(k);
      const i = this.pending.addChain(
        r.anchor,
        r.startUMm,
        r.startVMm,
        r.endUMm,
        r.endVMm,
        r.widthCm,
        r.depth16,
        r.toolCode,
        r.actorSlot,
        r.tick,
        r.inputSeq,
      );
      if (i < 0) this.strokesDropped++;
    }
  }

  /**
   * Encodes the current state as one FRAME into `out` (length >= FRAME_MAX_BYTES). Returns the byte length, or 0 on
   * an encoder failure (then nothing was consumed). `tick` is the tick just simulated (`sim.tick - 1`).
   */
  encode(sim: MoonRoomSim, selfSlot: ActorSlot, ackInputSeq: number, inputDepth: number, out: Uint8Array): number {
    const w = this.writer;
    const tick = sim.tick - 1;
    w.begin(tick < 0 ? 0 : tick, ackInputSeq, inputDepth, this.keyframe);
    this.fillSelf(sim, selfSlot);
    if (!w.writeSelf(this.self)) return 0;
    const table = this.table;
    // SlotChanges first (wire order), then entity records.
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      if (s === selfSlot) continue;
      const active = sim.avatar(s).active;
      const assigned = table.kind[s] !== -1;
      if (active && !assigned) w.slotAssign(table, s, s + 1, ENTITY_KIND_AVATAR);
      else if (!active && assigned) w.slotRelease(table, s);
    }
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      if (s === selfSlot || table.kind[s] !== ENTITY_KIND_AVATAR) continue;
      this.fillEntity(sim, s);
      w.writeEntity(table, this.ent);
    }
    const written = this.pending.chainCount > 0 ? w.writeStrokes(this.pending, 0, tick < 0 ? 0 : tick) : 0;
    const len = w.finish();
    if (len === 0) return 0;
    this.dropSentStrokes(written);
    this.keyframe = false;
    const src = w.buffer;
    for (let i = 0; i < len; i++) out[i] = src[i]!;
    return len;
  }

  private bodyYawCode(a: Readonly<AvatarState>): number {
    const b = this.basis;
    headingBasis(a as AvatarState, b);
    const north = a.fx * b[3]! + a.fy * b[4]! + a.fz * b[5]!;
    const east = a.fx * b[6]! + a.fy * b[7]! + a.fz * b[8]!;
    return yawToCode(atan2Det(east, north));
  }

  private fillSelf(sim: MoonRoomSim, slot: ActorSlot): void {
    const a = sim.avatar(slot);
    const t = sim.toolState(slot);
    const s = this.self;
    s.moveState = a.moveState;
    s.hopCharges = a.hopCharges;
    s.px = a.px;
    s.py = a.py;
    s.pz = a.pz;
    s.vx = a.vx;
    s.vy = a.vy;
    s.vz = a.vz;
    s.yawCode = a.active ? this.bodyYawCode(a) : 0;
    s.cellGrams = t.cellGrams[t.toolCode] ?? 0;
  }

  private fillEntity(sim: MoonRoomSim, slot: ActorSlot): void {
    const a = sim.avatar(slot);
    const t = sim.toolState(slot);
    const e = this.ent;
    e.slot = slot;
    e.rec = REC_DELTA;
    e.kind = ENTITY_KIND_AVATAR;
    e.px = a.px;
    e.py = a.py;
    e.pz = a.pz;
    e.yawCode = this.bodyYawCode(a);
    e.pitchCode = pitchToCode(inputPitchToRadians(0));
    e.actionState = t.detailing
      ? ACTION.detailing
      : t.sweeping
        ? ACTION.sweep
        : a.moveState !== MOVE_GROUNDED
          ? ACTION.airborne
          : ACTION.none;
    e.toolIndex = t.toolCode;
    e.flags = t.inContact ? 1 << AVATAR_FLAG_BIT.cleaning : 0;
  }

  /** Removes the first `n` chains (sent) and moves the rest to the front. */
  private dropSentStrokes(n: number): void {
    const p = this.pending;
    if (n <= 0) return;
    const rest = p.chainCount - n;
    if (rest > 0) {
      const end = p.chainCount;
      p.anchor.copyWithin(0, n, end);
      p.startUMm.copyWithin(0, n, end);
      p.startVMm.copyWithin(0, n, end);
      p.endUMm.copyWithin(0, n, end);
      p.endVMm.copyWithin(0, n, end);
      p.widthCm.copyWithin(0, n, end);
      p.depth16.copyWithin(0, n, end);
      p.toolCode.copyWithin(0, n, end);
      p.actorSlot.copyWithin(0, n, end);
      p.tick.copyWithin(0, n, end);
      p.inputSeq.copyWithin(0, n, end);
      p.contStart.copyWithin(0, n, end);
      p.contCount.copyWithin(0, n, end);
    }
    p.chainCount = rest > 0 ? rest : 0;
    p.continuationCount = 0;
  }
}
