// Animation client module (M1-W5-T04): a pool of per-slot animators with update-rate LOD (spec 8.1). The integrator
// binds an input provider (fills AvatarAnimInput from predicted / interpolated sim state) and a ground function (the
// sim's own heightAtXYZ); rig adapters read `animatorFor(slot).pose` after `update`. Pure consumer: never mutates sim.

import type { ClientModule, FrameInfo, ModuleContext } from "@moon-cleanup/shared";
import { AnimEventQueue } from "./anim-events";
import { AvatarAnimInput, AvatarAnimator } from "./avatar-animator";
import type { AnimGround } from "./foot-ik";

/** Max animated avatars per room view (6-player rooms; 16 keeps the spec's crowd budget). */
export const MAX_ANIMATED_AVATARS = 16;

/** Update buckets U0..U4 (spec 8.1): rate divisor at 60 Hz; 0 = frozen. */
export const BUCKET_DIVISOR: readonly number[] = [1, 2, 4, 8, 0];
/** Custodian projected-height bucket edges in px (U0 >= 110, U1 >= 43, U2 >= 17, U3 >= 10, U4 below). */
export const BUCKET_EDGES_PX: readonly number[] = [110, 43, 17, 10];

/** Bucket from projected height with 10 % hysteresis (spec 8.1). The local avatar is always U0. */
export function bucketFor(heightPx: number, prev: number, isLocal: boolean): number {
  bucketScratch.heightPx = heightPx;
  bucketScratch.bucket = prev;
  bucketScratch.isLocal = isLocal;
  return bucketCore(bucketScratch);
}

interface BucketState {
  heightPx: number;
  bucket: number;
  isLocal: boolean;
}
const bucketScratch: BucketState = { heightPx: 0, bucket: 0, isLocal: false };

/** Allocation-free core of `bucketFor` (reads the slot fields; no double crosses a call). */
function bucketCore(st: BucketState): number {
  const heightPx = st.heightPx;
  const prev = st.bucket;
  if (st.isLocal) return 0;
  let b = 4;
  for (let i = 0; i < BUCKET_EDGES_PX.length; i++) {
    if (heightPx >= BUCKET_EDGES_PX[i]!) {
      b = i;
      break;
    }
  }
  if (b > prev && prev < 4) {
    // Getting smaller: only drop once clearly below the previous bucket's edge.
    if (heightPx >= BUCKET_EDGES_PX[prev]! * 0.9) return prev;
  } else if (b < prev && b < 4) {
    if (heightPx < BUCKET_EDGES_PX[b]! * 1.1) return prev;
  }
  return b;
}

/** Whether a slot in `bucket` updates on `frameIndex` (staggered by slot mod divisor). */
export function shouldUpdate(bucket: number, frameIndex: number, slot: number): boolean {
  const d = BUCKET_DIVISOR[bucket] ?? 0;
  if (d === 0) return false;
  return (frameIndex + slot) % d === 0;
}

/** Fills `input` for `slot`; returns false when the avatar is not present this frame. */
export type AnimInputProvider = (slot: number, frame: FrameInfo, input: AvatarAnimInput) => boolean;

interface Slot {
  readonly animator: AvatarAnimator;
  readonly input: AvatarAnimInput;
  active: boolean;
  bucket: number;
  heightPx: number;
  isLocal: boolean;
  pendingDt: number;
}

export class AnimationModule implements ClientModule {
  readonly id = "animation" as const;
  readonly events = new AnimEventQueue(256);
  private readonly slots: Slot[] = [];
  private provider: AnimInputProvider | null = null;
  private ground: AnimGround | null = null;
  private moonRadiusM = 2000;
  private frameIndex = 0;
  /** Debug: animators updated in the last frame and CPU ms of the last update (only while `profile`). */
  lastUpdated = 0;
  lastCpuMs = 0;
  /** Time each update with `now()` (F3 Anim page / perf tests); off by default (a timer read boxes a double). */
  profile = false;

  constructor(private readonly now: () => number = () => performance.now()) {
    for (let i = 0; i < MAX_ANIMATED_AVATARS; i++) {
      this.slots.push({
        animator: new AvatarAnimator(i, this.events),
        input: new AvatarAnimInput(),
        active: false,
        bucket: 0,
        heightPx: 1e9,
        isLocal: false,
        pendingDt: 0,
      });
    }
  }

  /** Wiring (provider, ground, local slot) is done by the integrator through `bind`; nothing to acquire here. */
  init(ctx: ModuleContext): void {
    void ctx;
  }

  bind(provider: AnimInputProvider | null, ground: AnimGround | null, moonRadiusM: number): void {
    this.provider = provider;
    this.ground = ground;
    this.moonRadiusM = moonRadiusM;
  }

  setLocalSlot(slot: number): void {
    for (let i = 0; i < this.slots.length; i++) this.slots[i]!.isLocal = i === slot;
  }

  /** Projected custodian height in px for LOD (render/camera supplies it). */
  setProjectedHeight(slot: number, heightPx: number): void {
    const s = this.slots[slot];
    if (s !== undefined) s.heightPx = heightPx;
  }

  animatorFor(slot: number): AvatarAnimator | null {
    const s = this.slots[slot];
    return s?.active === true ? s.animator : null;
  }

  update(frame: FrameInfo): void {
    const t0 = this.profile ? this.now() : 0;
    this.events.clear();
    const provider = this.provider;
    const ground = this.ground;
    let n = 0;
    this.frameIndex++;
    if (provider !== null && ground !== null) {
      for (let i = 0; i < this.slots.length; i++) {
        const s = this.slots[i]!;
        const present = provider(i, frame, s.input);
        if (!present) {
          if (s.active) s.active = false;
          continue;
        }
        if (!s.active) {
          s.active = true;
          s.input.teleport = true;
          s.pendingDt = 0;
        }
        const nb = bucketCore(s);
        if (s.bucket === 4 && nb !== 4) s.input.teleport = true; // wake-up from frozen: 0 ms
        s.bucket = nb;
        s.pendingDt += frame.dt;
        if (!shouldUpdate(nb, this.frameIndex, i) && !s.input.teleport) continue;
        // Leg IK only in U0/U1 (spec 8.1).
        s.input.dt = s.pendingDt;
        s.input.moonRadiusM = this.moonRadiusM;
        s.animator.ikEnabled = nb <= 1;
        s.animator.step(s.input, ground);
        s.pendingDt = 0;
        n++;
      }
    }
    this.lastUpdated = n;
    if (this.profile) this.lastCpuMs = this.now() - t0;
  }

  dispose(): void {
    this.provider = null;
    this.ground = null;
    for (const s of this.slots) {
      s.active = false;
      s.animator.reset();
    }
    this.events.clear();
  }
}
