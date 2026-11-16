// The blockout custodian instance (M1-W3-T07): LOD meshes on the shared custodian material, the Desk Duster v0 in the
// right hand, name-tag and lamp anchors, and the procedural motion. Render-side only: it reads a velocity / facing
// and never touches sim state. W4-T07 swaps the asset; W5-T04 replaces `CustodianMotion` with the animator.
//
// Hierarchy: `object` (caller: feet position + tangent frame) > yaw group (heading) > body (bob, lean, roll) >
// LOD meshes and anchors. `handAnchor` follows the right forearm rotation so the tool stays in the glove.

import { Group, LOD, Mesh, Object3D, Quaternion, Vector3 } from "three/webgpu";
import type { AssetSocket, LoadedAsset } from "./assets";
import { createShading, type CustodianMaterial, type CustodianShading } from "./material";
import { CustodianMotion } from "./motion";
import { playerSlot, PLAYER_COLORS, srgbHexToLinear } from "./palette";

/** LOD switch distances (m) at a 60 degree vertical FOV: ~96 / 46 / 23 px tall at 720p (art-direction 10). */
export const CUSTODIAN_LOD_DISTANCES: readonly number[] = [0, 12, 25, 50];
export const DUSTER_LOD_DISTANCES: readonly number[] = [0, 3, 8];
/** The tool is not drawn beyond this distance (it is 16 cm long: < 1 px there). */
export const DUSTER_CULL_M = 40;

export interface BlockoutCustodianOptions {
  readonly custodian: LoadedAsset;
  readonly duster: LoadedAsset | null;
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

const X_AXIS = new Vector3(1, 0, 0);

export class BlockoutCustodian {
  /** Caller-owned transform (feet on the ground, local up = +Y). */
  readonly object = new Group();
  readonly yawGroup = new Group();
  readonly body = new Group();
  readonly lod = new LOD();
  readonly tool: LOD | null;
  readonly handAnchor = new Object3D();
  readonly nameTagAnchor = new Object3D();
  readonly lampAnchor = new Object3D();
  readonly motion = new CustodianMotion();
  readonly shading: CustodianShading;
  readonly input: CustodianInput = { vx: 0, vz: 0, facing: Number.NaN, toolActive: false, airborne: false };
  player = 0;

  private readonly hand: AssetSocket;
  private readonly elbowR: Vector3;
  private readonly shoulderR: Vector3;
  private readonly tmpQ = new Quaternion();
  private readonly tmpV = new Vector3();

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

    if (duster !== null) {
      const tool = new LOD();
      tool.name = "mc:desk-duster";
      duster.levels.forEach((geometry, i) => {
        const mesh = new Mesh(geometry, material.material);
        mesh.name = `mc:desk-duster-lod${i}`;
        mesh.castShadow = true;
        tool.addLevel(mesh, DUSTER_LOD_DISTANCES[i] ?? 8 * i, 0.1);
      });
      tool.addLevel(new Object3D(), DUSTER_CULL_M, 0.1);
      this.handAnchor.add(tool);
      this.tool = tool;
    } else {
      this.tool = null;
    }
    this.setPlayer(options.player ?? 0);
    this.applyPose();
  }

  /** Player colour slot 0..15 (P01..P16). */
  setPlayer(index: number): void {
    this.player = playerSlot(index);
    const lin = srgbHexToLinear(PLAYER_COLORS[this.player]!);
    this.shading.color.setRGB(lin[0], lin[1], lin[2]);
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

  private applyPose(): void {
    const m = this.motion;
    this.yawGroup.rotation.y = m.yaw;
    this.body.position.y = m.bob;
    this.body.rotation.set(m.pitch, 0, m.roll);
    this.shading.legs.set(m.hipL, m.hipR, m.kneeL, m.kneeR);
    this.shading.arms.set(m.shoulderL, m.shoulderR, m.elbowL, m.elbowR);
    // Right hand: the shader's forearm transform (elbow, then shoulder; forward = negative rotation about X).
    const p = this.tmpV.copy(this.hand.position).sub(this.elbowR);
    p.applyAxisAngle(X_AXIS, -m.elbowR).add(this.elbowR).sub(this.shoulderR);
    p.applyAxisAngle(X_AXIS, -m.shoulderR).add(this.shoulderR);
    this.handAnchor.position.copy(p);
    this.handAnchor.quaternion
      .copy(this.tmpQ.setFromAxisAngle(X_AXIS, -m.shoulderR - m.elbowR))
      .multiply(this.hand.quaternion);
  }

  dispose(): void {
    this.object.removeFromParent();
    // Geometry and material are shared (owned by the asset set); nothing per instance to free.
  }
}
