// Custodian avatars driven by the animation pool (M1-W3-T07 hookup of M1-W5-T04). Replaces the gameplay capsule.
//
//   const cast = await BlockoutCast.load();                       // cold, lazy chunk
//   const view = new CustodianAvatarView(cast, animation, mapper); // animation: AnimationModule; mapper: RenderMapper
//   roots.world.add(view.root);
//   view.localSlot = ownSlot; view.hideLocal = rig.mode === "first"; // per frame or on change
//   view.update(frame.dt, camera, viewportHeightPx);              // after AnimationModule.update, before render
//
// Per pool slot with an active animator: lazily spawns a blockout custodian (cold, once per slot), places it at the
// pose root with the pose's tangent frame (moon-centred metres -> render space through the mapper), poses it with
// `BlockoutPoser`, shows the Desk Duster for the palm tool class, and feeds the projected height back to the pool's
// LOD buckets. Inactive slots are hidden. Pure consumer of animation output: never touches sim state. No allocation
// per frame after a slot's first appearance.

import { Group, Matrix4, Vector3, type PerspectiveCamera } from "three/webgpu";
import { TOOL_CLASS, type AvatarAnimator, type RigProfile } from "../../../animation";
import type { BlockoutCustodian } from "./custodian";
import { BlockoutPoser, blockoutRigGeometry, blockoutRigProfile, type BlockoutRigGeometry } from "./rig-adapter";
import type { BlockoutCast } from "./index";

/** What the view reads from the animation pool (`AnimationModule` satisfies it). */
export interface AnimatorSource {
  animatorFor(slot: number): AvatarAnimator | null;
  setProjectedHeight?(slot: number, heightPx: number): void;
}

/** Moon-centred metres -> render space (gameplay `RenderMapper` satisfies it). */
export interface PoseMapper {
  point(src: Float64Array, so: number, out: Float64Array, o: number): void;
  direction(src: Float64Array, so: number, out: Float64Array, o: number): void;
}

/** Custodian height used for the projected-height LOD feedback (m). */
const CUSTODIAN_HEIGHT_M = 1.86;

interface ViewSlot {
  custodian: BlockoutCustodian | null;
  readonly poser: BlockoutPoser;
  colour: number;
  rigBound: AvatarAnimator | null;
}

export class CustodianAvatarView {
  readonly root = new Group();
  /** Pool slot of the local player (`AnimationModule.setLocalSlot`), -1 none. */
  localSlot = -1;
  /** First-person: the local custodian is not drawn (the camera sits in its helmet). */
  hideLocal = false;
  readonly geometry: BlockoutRigGeometry;
  /** The animator rig profile built from the blockout's joints (set on every bound animator). */
  readonly profile: RigProfile;
  readonly stats = { visible: 0, spawned: 0 };
  private readonly slots: ViewSlot[] = [];
  private readonly r = new Float64Array(9);
  /** Tool head and stroke centre in render space (0..2, 3..5). */
  private readonly h = new Float64Array(6);
  private readonly basis = new Matrix4();
  private readonly ax = new Vector3();
  private readonly ay = new Vector3();
  private readonly az = new Vector3();
  private readonly cam = new Vector3();

  constructor(
    private readonly cast: BlockoutCast,
    private readonly source: AnimatorSource,
    private readonly mapper: PoseMapper,
    slotCount = 16,
  ) {
    this.root.name = "mc:custodian-avatars";
    this.geometry = blockoutRigGeometry(cast.custodian, cast.duster);
    this.profile = blockoutRigProfile(this.geometry);
    for (let i = 0; i < slotCount; i++)
      this.slots.push({ custodian: null, poser: new BlockoutPoser(this.geometry), colour: i, rigBound: null });
  }

  /** Player colour index (P01..P16) of a pool slot (cold; on roster change). */
  setPlayerColour(slot: number, colourIndex: number): void {
    const s = this.slots[slot];
    if (s === undefined) return;
    s.colour = colourIndex;
    s.custodian?.setPlayer(colourIndex);
  }

  /** The custodian of a slot, if it has appeared (name-tag / lamp anchors, debug). */
  custodianFor(slot: number): BlockoutCustodian | null {
    return this.slots[slot]?.custodian ?? null;
  }

  poserFor(slot: number): BlockoutPoser | null {
    return this.slots[slot]?.poser ?? null;
  }

  /**
   * Places and poses every active slot. Call after the animation pool's update. `camera` (render space) drives the
   * LOD feedback; `viewportHeightPx` is the drawing-buffer height in CSS px.
   */
  update(dt: number, camera: PerspectiveCamera | null, viewportHeightPx: number): void {
    let visible = 0;
    const r = this.r;
    const mapper = this.mapper;
    let pxPerRad = 0;
    if (camera !== null) {
      camera.getWorldPosition(this.cam);
      pxPerRad = viewportHeightPx / (2 * Math.tan((camera.fov * Math.PI) / 360));
    }
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i]!;
      const animator = this.source.animatorFor(i);
      if (animator === null) {
        if (s.custodian !== null) s.custodian.object.visible = false;
        s.rigBound = null;
        continue;
      }
      if (s.rigBound !== animator) {
        // First frame of this animator on the slot: the blockout's own leg lengths; forget smoothed work weights.
        animator.rig = this.profile;
        s.rigBound = animator;
        s.poser.reset();
      }
      let c = s.custodian;
      if (c === null) {
        c = this.cast.spawn(s.colour);
        c.object.matrixAutoUpdate = true;
        this.root.add(c.object);
        s.custodian = c;
        this.stats.spawned++;
      }
      const hidden = i === this.localSlot && this.hideLocal;
      c.object.visible = !hidden;
      const pose = animator.pose;
      // Root and tangent frame in render space. X = up x fwd keeps the basis right-handed under a mirrored mapper.
      mapper.point(pose.root, 0, r, 0);
      mapper.direction(pose.frame.up, 0, r, 3);
      mapper.direction(pose.frame.fwd, 0, r, 6);
      c.object.position.set(r[0]!, r[1]!, r[2]!);
      const ay = this.ay.set(r[3]!, r[4]!, r[5]!).normalize();
      const az = this.az.set(r[6]!, r[7]!, r[8]!);
      az.addScaledVector(ay, -az.dot(ay)).normalize();
      const ax = this.ax.crossVectors(ay, az);
      c.object.quaternion.setFromRotationMatrix(this.basis.makeBasis(ax, ay, az));
      if (hidden) {
        this.source.setProjectedHeight?.(i, 1e9);
        continue;
      }
      c.setTool(
        animator.tool.toolClass,
        animator.tool.toolClass !== TOOL_CLASS.none && animator.tool.holdWeight > 0.02,
      );
      // Tool-head IK target: the sim head and stroke centre in the custodian's object frame (asset axes from the
      // feet). Only written while valid, so the poser's glue fades out from the last real point.
      const poser = s.poser;
      poser.headValid = pose.headValid;
      if (pose.headValid) {
        const h = this.h;
        mapper.point(pose.headTarget, 0, h, 0);
        mapper.point(pose.headCentre, 0, h, 3);
        this.toObjectFrame(h, 0, poser.headLocal);
        this.toObjectFrame(h, 3, poser.centreLocal);
      }
      s.poser.dt = dt;
      s.poser.apply(animator, c);
      visible++;
      if (camera !== null && this.source.setProjectedHeight !== undefined) {
        const dist = this.cam.distanceTo(c.object.position);
        this.source.setProjectedHeight(i, dist > 1e-3 ? (CUSTODIAN_HEIGHT_M / dist) * pxPerRad : 1e9);
      }
    }
    this.stats.visible = visible;
  }

  /** Render-space point h[o..o+2] -> the current custodian's object frame (origin r[0..2], axes ax / ay / az). */
  private toObjectFrame(h: Float64Array, o: number, out: Float64Array): void {
    const r = this.r;
    const dx = h[o]! - r[0]!;
    const dy = h[o + 1]! - r[1]!;
    const dz = h[o + 2]! - r[2]!;
    const ax = this.ax;
    const ay = this.ay;
    const az = this.az;
    out[0] = dx * ax.x + dy * ax.y + dz * ax.z;
    out[1] = dx * ay.x + dy * ay.y + dz * ay.z;
    out[2] = dx * az.x + dy * az.y + dz * az.z;
  }

  dispose(): void {
    for (const s of this.slots) {
      s.custodian?.dispose();
      s.custodian = null;
    }
    this.root.removeFromParent();
  }
}
