// Remote avatars -> animation pool (M1-W4-T06). LAZY CHUNK (online only, re-exported by online-room.ts).
//
// Pool slot OWN_POOL_SLOT (the last) is the local player's own avatar, read from the room's predictor (present state plus
// its decaying correction offset, the same pose the camera follows); the app marks it with `setLocalSlot`.
// An `AnimInputProvider` for `AnimationModule.bind`: pool slot i (< OWN_POOL_SLOT) is the i-th avatar entity of the room's slot table
// (rebuilt once per frame on the slot-0 call), filled from the session's interpolation buffer (sampled after
// `OnlineRoom.frame()` ran `updateInterpolation`). Velocity is a smoothed estimate of the interpolated motion (never the
// display derivative, per the animator contract); facing follows the horizontal velocity while moving. Allocation-free.

import type { FrameInfo } from "@moon-cleanup/shared";
import { ENTITY_KIND_AVATAR, RESULT_STRIDE, R_PX, R_PY, R_PZ, SAMPLE_NONE } from "@moon-cleanup/protocol";
import { MOVE_GROUNDED } from "@moon-cleanup/sim";
import type { AnimInputProvider, AvatarAnimInput } from "../animation";
import type { OnlineRoom } from "./online-room";

/** Pool size the provider maps (AnimationModule MAX_ANIMATED_AVATARS). */
const POOL = 16;
/** Pool slot of the own avatar (the server's slot table never carries it). */
export const OWN_POOL_SLOT = POOL - 1;
/** Velocity smoothing per update (exponential, 0..1). */
const VEL_SMOOTH = 0.35;
/** Below this speed (m/s) the facing is kept. */
const FACING_MIN_MPS = 0.2;

export class RemoteAvatarFeed {
  readonly stats = { present: 0, rebuilds: 0, ownPresent: false };
  /** Pool slot of the own avatar (`AnimationModule.setLocalSlot`). */
  readonly ownSlot = OWN_POOL_SLOT;
  private ownFresh = true;
  /** Entity slot of each pool slot (-1 = empty). */
  readonly entitySlot = new Int16Array(POOL).fill(-1);
  private readonly lastEntity = new Int16Array(POOL).fill(-1);
  private readonly lastPos = new Float64Array(POOL * 3);
  private readonly smoothed = new Float64Array(POOL * 3);
  readonly provider: AnimInputProvider = (slot, frame, input) => this.fill(slot, frame, input);

  constructor(private readonly room: OnlineRoom) {}

  /** Rebuilds the pool -> entity map from the slot table (called by the provider on pool slot 0). */
  rebuild(): void {
    const kinds = this.room.session.core.table.kind;
    let n = 0;
    for (let s = 0; s < kinds.length && n < OWN_POOL_SLOT; s++)
      if (kinds[s] === ENTITY_KIND_AVATAR) this.entitySlot[n++] = s;
    for (let i = n; i < POOL; i++) this.entitySlot[i] = -1;
    this.stats.rebuilds++;
  }

  private fill(slot: number, frame: FrameInfo, input: AvatarAnimInput): boolean {
    if (slot === 0) {
      this.rebuild();
      this.stats.present = 0;
    }
    if (slot === OWN_POOL_SLOT) return this.fillOwn(input);
    if (slot < 0 || slot >= POOL) return false;
    const e = this.entitySlot[slot]!;
    if (e < 0) return false;
    const interp = this.room.session.interpolation;
    if (interp.sample(e) === SAMPLE_NONE) return false;
    const r = interp.result;
    const o = e * RESULT_STRIDE;
    const px = r[o + R_PX]!;
    const py = r[o + R_PY]!;
    const pz = r[o + R_PZ]!;
    const k = slot * 3;
    const lp = this.lastPos;
    const sv = this.smoothed;
    const fresh = this.lastEntity[slot] !== e;
    this.lastEntity[slot] = e;
    if (fresh || frame.dt <= 0) {
      sv[k] = 0;
      sv[k + 1] = 0;
      sv[k + 2] = 0;
      input.teleport = fresh;
    } else {
      const inv = 1 / frame.dt;
      sv[k] = sv[k]! + ((px - lp[k]!) * inv - sv[k]!) * VEL_SMOOTH;
      sv[k + 1] = sv[k + 1]! + ((py - lp[k + 1]!) * inv - sv[k + 1]!) * VEL_SMOOTH;
      sv[k + 2] = sv[k + 2]! + ((pz - lp[k + 2]!) * inv - sv[k + 2]!) * VEL_SMOOTH;
    }
    lp[k] = px;
    lp[k + 1] = py;
    lp[k + 2] = pz;
    input.pos[0] = px;
    input.pos[1] = py;
    input.pos[2] = pz;
    input.vel[0] = sv[k]!;
    input.vel[1] = sv[k + 1]!;
    input.vel[2] = sv[k + 2]!;
    // Horizontal speed (velocity minus its radial part) drives the facing.
    const len = Math.hypot(px, py, pz) || 1;
    const ux = px / len;
    const uy = py / len;
    const uz = pz / len;
    const radial = sv[k]! * ux + sv[k + 1]! * uy + sv[k + 2]! * uz;
    const hx = sv[k]! - radial * ux;
    const hy = sv[k + 1]! - radial * uy;
    const hz = sv[k + 2]! - radial * uz;
    const speed = Math.hypot(hx, hy, hz);
    if (speed > FACING_MIN_MPS) {
      input.facing[0] = hx / speed;
      input.facing[1] = hy / speed;
      input.facing[2] = hz / speed;
    }
    input.grounded = true;
    this.stats.present++;
    return true;
  }

  /** Own avatar from the predictor; absent until the first authoritative Self started it. */
  private fillOwn(input: AvatarAnimInput): boolean {
    const p = this.room.predictor;
    if (!p.ready) {
      this.ownFresh = true;
      this.stats.ownPresent = false;
      return false;
    }
    const st = p.state;
    const off = p.offset;
    input.pos[0] = st.px + off[0]!;
    input.pos[1] = st.py + off[1]!;
    input.pos[2] = st.pz + off[2]!;
    input.vel[0] = st.vx;
    input.vel[1] = st.vy;
    input.vel[2] = st.vz;
    input.facing[0] = st.fx;
    input.facing[1] = st.fy;
    input.facing[2] = st.fz;
    input.grounded = st.moveState === MOVE_GROUNDED;
    input.heightAboveGround = st.heightAboveGround;
    input.jumped = st.jumped;
    input.impactMps = st.lastImpactMps;
    input.teleport = this.ownFresh;
    this.ownFresh = false;
    this.stats.ownPresent = true;
    this.stats.present++;
    return true;
  }
}

export function createRemoteAvatarFeed(room: OnlineRoom): RemoteAvatarFeed {
  return new RemoteAvatarFeed(room);
}
