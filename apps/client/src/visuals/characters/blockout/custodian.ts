// The blockout custodian instance (M1-W3-T07): LOD meshes on the shared custodian material, the Desk Duster v0 in the
// right hand, name-tag and lamp anchors, and the procedural motion. Render-side only: it reads a velocity / facing
// and never touches sim state. W4-T07 swaps the asset; W5-T04 replaces `CustodianMotion` with the animator.
//
// Hierarchy: `object` (caller: feet position + tangent frame) > yaw group (heading) > body (bob, lean, roll) >
// LOD meshes and anchors. `handAnchor` follows the right forearm rotation so the tool stays in the glove.

import { Group, LOD, Mesh, Object3D, type Vector3 } from "three/webgpu";
import type { AssetSocket, LoadedAsset } from "./assets";
import { createShading, type CustodianMaterial, type CustodianShading } from "./material";
import { CustodianMotion } from "./motion";
import { playerSlot, PLAYER_COLORS, srgbHexToLinear } from "./palette";

/** LOD switch distances (m) at a 60 degree vertical FOV: ~96 / 46 / 23 px tall at 720p (art-direction 10). */
export const CUSTODIAN_LOD_DISTANCES: readonly number[] = [0, 12, 25, 50];
export const DUSTER_LOD_DISTANCES: readonly number[] = [0, 3, 8];
/** The tool is not drawn beyond this distance (it is 16 cm long: < 1 px there). */
export const DUSTER_CULL_M = 40;
/** Animation tool classes with held models (`TOOL_CLASS` in src/animation/tuning.ts; numbers kept local, no import). */
const PALM_CLASS = 1;
const BROOM_CLASS = 3;
const BAR_CLASS = 4;

export interface BlockoutCustodianOptions {
  readonly custodian: LoadedAsset;
  readonly duster: LoadedAsset | null;
  /**
   * Production hand tools by animation tool class (`TOOL_CLASS`: 1 palm Desk Duster, 2 blade Crescent Squeegee,
   * 3 broom Bristle Broom, 4 bar Lane Broom). The palm entry, when present, replaces `duster`.
   */
  readonly tools?: ReadonlyMap<number, LoadedAsset>;
  readonly material: CustodianMaterial;
  readonly player?: number;
}

export interface CustodianInput {
  /** Planar velocity (m/s) in the frame of `object` (x right, z forward at yaw 0). */
  vx: number;
  vz: number;
  /** Explicit heading (rad, from +z toward +x) or NaN: face the travel direction. */
  facing: number;
  toolActive: boolean;
  airborne: boolean;
}

function socket(asset: LoadedAsset, name: string): AssetSocket {
  const s = asset.sockets.get(name);
  if (s === undefined) throw new Error(`${asset.id}: socket ${name} missing`);
  return s;
}

export class BlockoutCustodian {
  /** Caller-owned transform (feet on the ground, local up = +Y). */
  readonly object = new Group();
  readonly yawGroup = new Group();
  readonly body = new Group();
  readonly lod = new LOD();
  /** The Desk Duster (palm class) LOD, or null. */
  readonly tool: LOD | null;
  /** Held-tool LOD per tool class (palm included). */
  readonly tools = new Map<number, LOD>();
  private readonly contacts = new Map<number, Vector3>();
  private shownTool = -1;
  readonly handAnchor = new Object3D();
  readonly nameTagAnchor = new Object3D();
  readonly lampAnchor = new Object3D();
  /** Desk Duster bristle-tip contact (`socket_contact`), a child of `handAnchor`; at the hand when there is no tool. */
  readonly toolContact = new Object3D();
  readonly motion = new CustodianMotion();
  readonly shading: CustodianShading;
  readonly input: CustodianInput = { vx: 0, vz: 0, facing: Number.NaN, toolActive: false, airborne: false };
  player = 0;

  private readonly hand: AssetSocket;
  private readonly elbowR: Vector3;
  private readonly shoulderR: Vector3;

  constructor(options: BlockoutCustodianOptions) {
    const { custodian, duster, material } = options;
    this.object.name = "mc:custodian";
    this.yawGroup.name = "mc:custodian-yaw";
    this.body.name = "mc:custodian-body";
    this.object.add(this.yawGroup);
    this.yawGroup.add(this.body);
    this.shading = createShading(0);
    this.object.userData["custodian"] = this.shading;

    this.lod.name = "mc:custodian-lod";
    this.lod.autoUpdate = true;
    custodian.levels.forEach((geometry, i) => {
      const mesh = new Mesh(geometry, material.material);
      mesh.name = `mc:custodian-lod${i}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.lod.addLevel(mesh, CUSTODIAN_LOD_DISTANCES[i] ?? 50 * i, 0.1);
    });
    this.body.add(this.lod);

    this.hand = socket(custodian, "socket_hand_R");
    this.elbowR = socket(custodian, "pivot_elbow_R").position;
    this.shoulderR = socket(custodian, "pivot_shoulder_R").position;
    const tag = socket(custodian, "socket_nametag");
    this.nameTagAnchor.name = "mc:custodian-nametag";
    this.nameTagAnchor.position.copy(tag.position);
    const lamp = socket(custodian, "socket_lamp");
    this.lampAnchor.name = "mc:custodian-lamp";
    this.lampAnchor.position.copy(lamp.position);
    this.lampAnchor.quaternion.copy(lamp.quaternion);
    this.handAnchor.name = "mc:custodian-hand-r";
    this.body.add(this.handAnchor, this.nameTagAnchor, this.lampAnchor);

    const assets = new Map<number, LoadedAsset>(options.tools ?? []);
    if (!assets.has(PALM_CLASS) && duster !== null) assets.set(PALM_CLASS, duster);
    for (const [cls, asset] of assets) {
      const tool = new LOD();
      tool.name = `mc:tool-${asset.id}`;
      const long = cls === BROOM_CLASS || cls === BAR_CLASS;
      asset.levels.forEach((geometry, i) => {
        const mesh = new Mesh(geometry, material.material);
        mesh.name = `mc:tool-${asset.id}-lod${i}`;
        mesh.castShadow = true;
        const d = DUSTER_LOD_DISTANCES[i] ?? 8 * i;
        tool.addLevel(mesh, long ? d * 4 : d, 0.1);
      });
      tool.addLevel(new Object3D(), long ? DUSTER_CULL_M * 2 : DUSTER_CULL_M, 0.1);
      tool.visible = false;
      this.handAnchor.add(tool);
      this.tools.set(cls, tool);
      const contact = asset.sockets.get("socket_contact");
      if (contact !== undefined) this.contacts.set(cls, contact.position);
    }
    this.tool = this.tools.get(PALM_CLASS) ?? null;
    const palmContact = this.contacts.get(PALM_CLASS);
    if (palmContact !== undefined) this.toolContact.position.copy(palmContact);
    if (this.tool !== null) this.tool.visible = true;
    this.shownTool = this.tool !== null ? PALM_CLASS : -1;
    this.toolContact.name = "mc:custodian-tool-contact";
    this.handAnchor.add(this.toolContact);
    this.setPlayer(options.player ?? 0);
    this.applyPose();
  }

  /** Shows or hides the held Desk Duster (empty hands, or a tool class without a model yet). */
  setToolVisible(visible: boolean): void {
    this.setTool(PALM_CLASS, visible);
  }

  /**
   * Shows the held model of a tool class (hides the others); `visible` false or a class without a model shows none.
   * Moves `toolContact` to that tool's contact socket. No allocation.
   */
  setTool(toolClass: number, visible: boolean): void {
    const show = visible && this.tools.has(toolClass) ? toolClass : -1;
    if (show === this.shownTool) return;
    const previous = this.tools.get(this.shownTool);
    if (previous !== undefined) previous.visible = false;
    const next = this.tools.get(show);
    if (next !== undefined) next.visible = true;
    const contact = this.contacts.get(show);
    if (contact !== undefined) this.toolContact.position.copy(contact);
    else this.toolContact.position.set(0, 0, 0);
    this.shownTool = show;
  }

  /** Player colour slot 0..15 (P01..P16). */
  setPlayer(index: number): void {
    this.player = playerSlot(index);
    const lin = srgbHexToLinear(PLAYER_COLORS[this.player]!);
    this.shading.color.setRGB(lin[0], lin[1], lin[2]);
    this.shading.glyph = this.player;
  }

  /** Crown Lamp lens emission 0..1. */
  setLamp(level: number): void {
    this.shading.lamp = Math.min(1, Math.max(0, level));
  }

  /** Snaps heading and gait (spawn / teleport). */
  reset(yaw = 0): void {
    this.motion.reset(yaw);
    this.applyPose();
  }

  /** Advances the procedural motion from `input` and writes the pose. No allocation. */
  update(dt: number): void {
    const i = this.input;
    this.motion.step(dt, i.vx, i.vz, i.facing, i.toolActive, i.airborne);
    this.applyPose();
  }

  /**
   * Writes the joint fields of `motion` (yaw, body offset / lean / twist, limb angles) into the hierarchy and the
   * shading uniforms. `update()` calls it after the procedural motion; the animator adapter fills `motion` itself and
   * calls this. No allocation.
   */
  applyPose(): void {
    const m = this.motion;
    // Plain field writes and arithmetic only (no doubles through calls: allocation-free under 16 custodians).
    this.yawGroup.rotation.y = m.yaw;
    const bp = this.body.position;
    bp.x = m.bodyX;
    bp.y = m.bob;
    bp.z = m.bodyZ;
    this.body.rotation.set(m.pitch, m.twist, m.roll);
    const legs = this.shading.legs;
    legs.x = m.hipL;
    legs.y = m.hipR;
    legs.z = m.kneeL;
    legs.w = m.kneeR;
    const arms = this.shading.arms;
    arms.x = m.shoulderL;
    arms.y = m.shoulderR;
    arms.z = m.elbowL;
    arms.w = m.elbowR;
    // Right hand: the shader's forearm transform (about the elbow, then the shoulder; forward = negative about X).
    const e = this.elbowR;
    const sh = this.shoulderR;
    const h = this.hand.position;
    let c = Math.cos(-m.elbowR);
    let s = Math.sin(-m.elbowR);
    let y = h.y - e.y;
    let z = h.z - e.z;
    let y2 = y * c - z * s + e.y - sh.y;
    let z2 = y * s + z * c + e.z - sh.z;
    c = Math.cos(-m.shoulderR);
    s = Math.sin(-m.shoulderR);
    y = y2 * c - z2 * s + sh.y;
    z = y2 * s + z2 * c + sh.z;
    const hp = this.handAnchor.position;
    hp.x = h.x;
    hp.y = y;
    hp.z = z;
    // Orientation: rotation about X by -(shoulder + elbow), then the socket's bind rotation.
    const half = -0.5 * (m.shoulderR + m.elbowR);
    const ax = Math.sin(half);
    const aw = Math.cos(half);
    const q = this.hand.quaternion;
    y2 = aw * q.y - ax * q.z;
    z2 = aw * q.z + ax * q.y;
    this.handAnchor.quaternion.set(ax * q.w + aw * q.x, y2, z2, aw * q.w - ax * q.x);
  }

  dispose(): void {
    this.object.removeFromParent();
    // Geometry and material are shared (owned by the asset set); nothing per instance to free.
  }
}
