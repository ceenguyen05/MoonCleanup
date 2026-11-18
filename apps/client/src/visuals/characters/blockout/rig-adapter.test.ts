// M1-W3-T07 hookup of the M1-W5-T04 animator onto the blockout custodian: the planar two-bone, the rig profile from
// the asset's joints, the adapter's poses (feet on the IK targets, hands-and-knees scrub with the bristle tips on the
// ground, air tuck) checked by forward kinematics that mirror the material's vertex transform, and the avatar view.
import { readFileSync } from "node:fs";
import v8 from "node:v8";
import vm from "node:vm";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three/webgpu";
import {
  AnimEventQueue,
  AvatarAnimInput,
  AvatarAnimator,
  TOOL_CLASS,
  strokeCurve,
  type AnimGround,
} from "../../../animation";
import { extractAsset, type LoadedAsset } from "./assets";
import { CustodianAvatarView, type AnimatorSource, type PoseMapper } from "./avatar-view";
import type { BlockoutCustodian } from "./custodian";
import { BlockoutCast } from "./index";
import {
  BlockoutPoser,
  blockoutRigGeometry,
  blockoutRigProfile,
  planarTwoBoneIO,
  STANCE_DROP_M,
  type BlockoutRigGeometry,
} from "./rig-adapter";

const DIR = fileURLToPath(new URL("../../../../public/assets/blockout/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as {
  assets: Record<string, { file: string; placeholder?: boolean }>;
};

async function load(id: string): Promise<LoadedAsset> {
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { MeshoptDecoder } = await import("three/addons/libs/meshopt_decoder.module.js");
  const entry = manifest.assets[id]!;
  const bytes = readFileSync(join(DIR, entry.file));
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  return extractAsset(id, gltf.scene, entry.file, entry.placeholder === true);
}

const R = 2000;
const DT = 1 / 60;
const flat: AnimGround = {
  heightsAt(_dirs: Float64Array, out: Float64Array, n: number): void {
    for (let i = 0; i < n; i++) out[i] = 0;
  },
};

let cast: BlockoutCast;
let geo: BlockoutRigGeometry;

beforeAll(async () => {
  const [custodian, duster] = await Promise.all([load("custodian_blockout"), load("desk_duster_v0")]);
  cast = new BlockoutCast(custodian, duster);
  geo = blockoutRigGeometry(custodian, duster);
});

/** The material's limb transform (material.ts positionNode): child about its pivot, then root about its pivot. */
function rotX(y: number, z: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [y * c - z * s, y * s + z * c];
}

/** Bind-space point on a leg (shin part) -> object space (asset axes). */
function legPoint(c: BlockoutCustodian, left: boolean, x: number, y: number, z: number): Vector3 {
  const m = c.motion;
  const hip = left ? m.hipL : m.hipR;
  const knee = left ? m.kneeL : m.kneeR;
  let [qy, qz] = rotX(y - geo.kneeY, z - geo.kneeZ, knee);
  qy += geo.kneeY;
  qz += geo.kneeZ;
  const [py0, pz] = rotX(qy - geo.hipY, qz, -hip);
  const py = py0 + geo.hipY;
  c.body.updateMatrix();
  return new Vector3(x, py, pz).applyMatrix4(c.body.matrix);
}

/** Bind-space point on the right forearm part (hand / tool) -> object space. */
function armPointR(c: BlockoutCustodian, y: number, z: number): Vector3 {
  const m = c.motion;
  let [qy, qz] = rotX(y - geo.elbowY, z - geo.elbowZ, -m.elbowR);
  qy += geo.elbowY;
  qz += geo.elbowZ;
  const [py0, pz] = rotX(qy - geo.shoulderY, qz, -m.shoulderR);
  const py = py0 + geo.shoulderY;
  c.body.updateMatrix();
  return new Vector3(-geo.handX, py, pz).applyMatrix4(c.body.matrix);
}

function newInput(): AvatarAnimInput {
  const i = new AvatarAnimInput();
  i.pos.set([0, R, 0]);
  i.facing.set([0, 0, 1]);
  i.moonRadiusM = R;
  i.dt = DT;
  return i;
}

describe("planar two-bone", () => {
  it("reaches a reachable target exactly, knee ahead (+1) / elbow behind (-1), clamps out of reach", () => {
    const io = new Float64Array(10);
    for (const bend of [1, -1]) {
      io.set([1, 0, 0.3, 0.25, 0.4, 0.4, bend]);
      planarTwoBoneIO(io);
      const my = 1 - 0.4 * Math.cos(io[7]!);
      const mz = 0.4 * Math.sin(io[7]!);
      const ey = my - 0.4 * Math.cos(io[8]!);
      const ez = mz + 0.4 * Math.sin(io[8]!);
      expect(ey).toBeCloseTo(0.3, 9);
      expect(ez).toBeCloseTo(0.25, 9);
      // Middle joint side of the root -> target line.
      // Normal of the root -> target line pointing forward (+z): (dz, -dy) = (0.25, 0.7).
      const side = (my - 1) * 0.25 + mz * 0.7;
      expect(Math.sign(side)).toBe(bend);
    }
    io.set([1, 0, -5, 0, 0.4, 0.4, 1]);
    planarTwoBoneIO(io);
    expect(io[9]).toBeLessThan(0.8);
    expect(io[7]).toBeCloseTo(0, 1);
  });
});

describe("blockout rig profile", () => {
  it("is built from the asset's pivots; the rest stance leaves the knees soft", () => {
    const p = blockoutRigProfile(geo);
    expect(geo.hipY).toBeCloseTo(0.93, 2);
    expect(p.hipHeightM).toBeCloseTo(geo.hipY - STANCE_DROP_M, 9);
    expect(p.thighM + p.calfM + p.ankleHeightM).toBeGreaterThan(p.hipHeightM);
    // The Desk Duster contact (bristle tips) sits below and ahead of the glove.
    expect(geo.tipY).toBeLessThan(geo.handY);
    expect(geo.tipZ).toBeGreaterThan(geo.handZ);
  });
});

describe("blockout poser on the W5-T04 animator", () => {
  function setup(): { a: AvatarAnimator; c: BlockoutCustodian; poser: BlockoutPoser; inp: AvatarAnimInput } {
    const a = new AvatarAnimator(0, new AnimEventQueue(64));
    a.rig = blockoutRigProfile(geo);
    const c = cast.spawn(0);
    return { a, c, poser: new BlockoutPoser(geo), inp: newInput() };
  }

  it("idle: both ankles land on the IK targets with soft knees", () => {
    const { a, c, poser, inp } = setup();
    for (let f = 0; f < 60; f++) {
      a.step(inp, flat);
      poser.apply(a, c);
    }
    for (const left of [true, false]) {
      const k = left ? 0 : 1;
      const ankle = legPoint(c, left, left ? geo.hipX : -geo.hipX, geo.ankleY, 0);
      expect(ankle.y).toBeCloseTo(a.ik.soleTarget[k * 3 + 1]! + geo.ankleY, 2);
      expect(ankle.z).toBeCloseTo(a.ik.soleTarget[k * 3 + 2]!, 2);
      expect(left ? c.motion.kneeL : c.motion.kneeR).toBeGreaterThan(0.05);
    }
    expect(poser.kneel).toBe(0);
  });

  it("walking 1.6 m/s for 3 s: every ankle on its target, finite joints, arms counter-swing", () => {
    const { a, c, poser, inp } = setup();
    inp.vel.set([0, 0, 1.6]);
    let worst = 0;
    let swingSeen = 0;
    for (let f = 0; f < 180; f++) {
      const z = 1.6 * f * DT;
      inp.pos.set([0, Math.sqrt(R * R - z * z), z]);
      a.step(inp, flat);
      poser.apply(a, c);
      if (f < 30) continue;
      for (const left of [true, false]) {
        const k = left ? 0 : 1;
        const ankle = legPoint(c, left, 0, geo.ankleY, 0);
        const ty = a.ik.soleTarget[k * 3 + 1]! + geo.ankleY;
        const tz = a.ik.soleTarget[k * 3 + 2]!;
        worst = Math.max(worst, Math.hypot(ankle.y - ty, ankle.z - tz));
      }
      const m = c.motion;
      for (const v of [m.hipL, m.hipR, m.kneeL, m.kneeR, m.shoulderL, m.shoulderR, m.elbowL, m.elbowR, m.bob])
        expect(Number.isFinite(v)).toBe(true);
      // Left arm swings against the left leg.
      if (Math.abs(m.hipL - m.hipR) > 0.2) {
        expect(Math.sign(m.shoulderL - m.shoulderR)).toBe(-Math.sign(m.hipL - m.hipR));
        swingSeen++;
      }
    }
    // Only the low-g hop lifts the pelvis past full leg reach for a moment (the stretch clamp lifts the planted foot).
    expect(worst).toBeLessThan(0.03);
    expect(swingSeen).toBeGreaterThan(20);
  });

  it("Desk Duster down, standing still: drops to hands and knees, bristle tips on the ground in the push", () => {
    const { a, c, poser, inp } = setup();
    inp.toolClass = TOOL_CLASS.palm;
    inp.toolPeriodS = 0.45;
    let contactMax = 0;
    let liftMax = 0;
    let zMin = 1e9;
    let zMax = -1e9;
    for (let f = 0; f < 150; f++) {
      inp.toolActive = f >= 20;
      inp.toolPhase = ((f * DT) / 0.45) % 1;
      inp.toolInContact = inp.toolActive && inp.toolPhase < 0.7;
      a.step(inp, flat);
      poser.apply(a, c);
      if (f < 90) continue;
      c.body.updateMatrixWorld(true);
      const tip = armPointR(c, geo.tipY, geo.tipZ);
      if (inp.toolPhase < 0.7) {
        contactMax = Math.max(contactMax, tip.y);
        zMin = Math.min(zMin, tip.z);
        zMax = Math.max(zMax, tip.z);
      } else liftMax = Math.max(liftMax, tip.y);
      expect(poser.reachErrorM).toBeLessThan(0.03);
    }
    expect(poser.kneel).toBeGreaterThan(0.99);
    // Kneeling: hips low, knees on the ground.
    expect(c.motion.bob + geo.hipY).toBeLessThan(1.2);
    const kneeL = legPoint(c, true, geo.hipX, geo.kneeY, geo.kneeZ);
    expect(kneeL.y).toBeLessThan(0.12);
    // Bristle tips (tuft radius ~1.5 cm) within 3 cm of the ground through the push, lifted on the return.
    expect(contactMax).toBeLessThan(0.045);
    expect(liftMax).toBeGreaterThan(0.03);
    // The stroke covers ground ahead of the knees.
    expect(zMax - zMin).toBeGreaterThan(0.12);
    expect(zMin).toBeGreaterThan(0.25);
    // The scene-graph contact (tool socket under the hand anchor) agrees with the shader-side FK.
    c.object.updateMatrixWorld(true);
    const world = c.toolContact.getWorldPosition(new Vector3());
    const fk = armPointR(c, geo.tipY, geo.tipZ);
    expect(world.distanceTo(fk)).toBeLessThan(0.02);
  });

  it("walking with the tool down: bends over instead of kneeling; tool up: stands back up", () => {
    const { a, c, poser, inp } = setup();
    inp.toolClass = TOOL_CLASS.palm;
    inp.toolActive = true;
    inp.vel.set([0, 0, 1.4]);
    for (let f = 0; f < 90; f++) {
      const z = 1.4 * f * DT;
      inp.pos.set([0, Math.sqrt(R * R - z * z), z]);
      inp.toolPhase = ((f * DT) / 0.45) % 1;
      a.step(inp, flat);
      poser.apply(a, c);
    }
    expect(poser.kneel).toBeLessThan(0.05);
    expect(poser.bend).toBeGreaterThan(0.9);
    expect(c.motion.pitch).toBeGreaterThan(0.3);
    inp.toolActive = false;
    inp.vel.set([0, 0, 0]);
    for (let f = 0; f < 60; f++) {
      a.step(inp, flat);
      poser.apply(a, c);
    }
    expect(poser.bend).toBe(0);
    expect(Math.abs(c.motion.pitch)).toBeLessThan(0.1);
  });

  it("airborne: legs tuck (feet above the hanging position)", () => {
    const { a, c, poser, inp } = setup();
    for (let f = 0; f < 30; f++) {
      a.step(inp, flat);
      poser.apply(a, c);
    }
    inp.grounded = false;
    inp.jumped = true;
    inp.heightAboveGround = 0.8;
    inp.vel.set([0, 0.2, 0]);
    for (let f = 0; f < 30; f++) {
      a.step(inp, flat);
      inp.jumped = false;
      poser.apply(a, c);
    }
    const ankle = legPoint(c, true, geo.hipX, geo.ankleY, 0);
    expect(ankle.y).toBeGreaterThan(geo.ankleY + 0.06);
  });
});

describe("custodian avatar view", () => {
  it("places active slots on the pose root and frame, hides inactive / first-person local, feeds LOD heights", () => {
    const animators = [0, 1].map((i) => new AvatarAnimator(i, new AnimEventQueue(16)));
    const active = [true, false];
    const heights: number[] = [];
    const source: AnimatorSource = {
      animatorFor: (slot) => (active[slot] === true ? animators[slot]! : null),
      setProjectedHeight: (slot, h) => {
        heights[slot] = h;
      },
    };
    // North-pole tangent mapper: render = moon-centred minus (0, R, 0) (a pure translation).
    const mapper: PoseMapper = {
      point: (src, so, out, o) => {
        out[o] = src[so]!;
        out[o + 1] = src[so + 1]! - R;
        out[o + 2] = src[so + 2]!;
      },
      direction: (src, so, out, o) => {
        out[o] = src[so]!;
        out[o + 1] = src[so + 1]!;
        out[o + 2] = src[so + 2]!;
      },
    };
    const view = new CustodianAvatarView(cast, source, mapper, 2);
    const inp = newInput();
    inp.pos.set([3, R, 4]);
    inp.facing.set([1, 0, 0]);
    animators[0]!.step(inp, flat);
    const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 1000);
    cam.position.set(3, 1.6, 4 + 10);
    cam.updateMatrixWorld();
    view.update(DT, cam, 720);
    const c0 = view.custodianFor(0)!;
    expect(c0.object.visible).toBe(true);
    expect(view.custodianFor(1)).toBeNull();
    expect(c0.object.position.x).toBeCloseTo(3, 6);
    expect(c0.object.position.z).toBeCloseTo(4, 6);
    // Facing +X: the asset's forward (+Z) maps to +X, its up stays +Y.
    const fwd = new Vector3(0, 0, 1).applyQuaternion(c0.object.quaternion);
    expect(fwd.x).toBeCloseTo(1, 4);
    expect(new Vector3(0, 1, 0).applyQuaternion(c0.object.quaternion).y).toBeCloseTo(1, 4);
    // ~1.86 m at ~10 m, 60 deg FOV, 720 px: ~ 1.86 / 10 * 623.5 = 116 px.
    expect(heights[0]).toBeGreaterThan(100);
    expect(heights[0]).toBeLessThan(130);
    expect(animators[0]!.rig.id).toBe("rig.custodian.blockout");
    view.localSlot = 0;
    view.hideLocal = true;
    view.update(DT, cam, 720);
    expect(c0.object.visible).toBe(false);
    active[0] = false;
    view.hideLocal = false;
    view.update(DT, cam, 720);
    expect(c0.object.visible).toBe(false);
    expect(view.stats.visible).toBe(0);
    view.dispose();
  });
});

describe("tool-head glue (sim head -> animator pose -> view -> poser)", () => {
  // North-pole tangent mapper: render = moon-centred minus (0, R, 0) (a pure translation).
  const mapper: PoseMapper = {
    point: (src, so, out, o) => {
      out[o] = src[so]!;
      out[o + 1] = src[so + 1]! - R;
      out[o + 2] = src[so + 2]!;
    },
    direction: (src, so, out, o) => {
      out[o] = src[so]!;
      out[o + 1] = src[so + 1]!;
      out[o + 2] = src[so + 2]!;
    },
  };

  /**
   * Desk Duster scrub standing still at the pole, facing +Z: the sim head runs aim - L .. aim (packages/sim tool.ts
   * headPhase, contact 70 %); returns the worst horizontal tip-to-head distance in the push and the tip height.
   */
  function scrub(aim: number, L: number, lateral: number) {
    const a = new AvatarAnimator(0, new AnimEventQueue(64));
    const view = new CustodianAvatarView(cast, { animatorFor: (s) => (s === 0 ? a : null) }, mapper, 1);
    const inp = newInput();
    inp.toolClass = TOOL_CLASS.palm;
    inp.toolPeriodS = 0.45;
    const cf = 0.7;
    let worst = 0;
    let yMax = -1;
    let reachErr = 0;
    const tip = new Vector3();
    for (let f = 0; f < 200; f++) {
      const phase = ((f * DT) / 0.45) % 1;
      inp.toolActive = true;
      inp.toolPhase = phase;
      inp.toolInContact = phase < cf;
      const z = aim - L + L * strokeCurve(phase, cf);
      inp.headValid = true;
      inp.headTarget.set([lateral, R, z]);
      inp.headCentre.set([lateral, R, aim - L / 2]);
      a.step(inp, flat);
      view.update(DT, null, 720);
      if (f < 120 || phase >= cf) continue;
      const c = view.custodianFor(0)!;
      c.object.updateMatrixWorld(true);
      c.toolContact.getWorldPosition(tip);
      worst = Math.max(worst, Math.hypot(tip.x - lateral, tip.z - z));
      yMax = Math.max(yMax, tip.y);
      reachErr = Math.max(reachErr, view.poserFor(0)!.reachErrorM);
    }
    const poser = view.poserFor(0)!;
    const out = { worst, yMax, reachErr, headValid: poser.headValid, kneel: poser.kneel };
    view.dispose();
    return out;
  }

  it("kneeling scrub: the bristle tips follow the sim head through the push (near and far aim, off-axis)", () => {
    for (const [aim, lateral] of [
      [0.9, 0],
      [1.2, 0],
      [0.9, 0.12],
    ] as const) {
      const r = scrub(aim, 0.45, lateral);
      expect(r.headValid).toBe(true);
      expect(r.kneel).toBeGreaterThan(0.99);
      // Within the palm wobble (3 cm) plus 2 cm of the dust contact, on the ground.
      expect(r.worst).toBeLessThan(0.05);
      expect(r.yMax).toBeLessThan(0.05);
      expect(r.reachErr).toBeLessThan(0.02);
    }
  });
});

describe("poser cost (16 custodians)", () => {
  /** 16 animators in mixed states (idle, walk, scrub, air), each stepped once per frame, then posed. */
  function crowd(): {
    run(frames: number, pose: boolean, timed: boolean): void;
    poseOnly(frames: number): void;
    poseMs: number[];
  } {
    const items = Array.from({ length: 16 }, (_, i) => {
      const a = new AvatarAnimator(i, new AnimEventQueue(64));
      a.rig = blockoutRigProfile(geo);
      const inp = newInput();
      inp.toolClass = TOOL_CLASS.palm;
      inp.toolPeriodS = 0.45;
      return { a, inp, c: cast.spawn(i), p: new BlockoutPoser(geo), kind: i % 4, t: 0 };
    });
    const poseMs: number[] = [];
    return {
      poseMs,
      poseOnly(frames: number): void {
        for (let f = 0; f < frames; f++) for (const it of items) it.p.apply(it.a, it.c);
      },
      run(frames: number, pose: boolean, timed: boolean): void {
        for (let f = 0; f < frames; f++) {
          for (const it of items) {
            it.t += DT;
            const i = it.inp;
            const z = it.kind === 1 ? 1.5 * it.t : 0;
            i.pos[0] = it.a.slot;
            i.pos[1] = R;
            i.pos[2] = z % 50;
            i.vel[2] = it.kind === 1 ? 1.5 : 0;
            i.toolActive = it.kind === 2;
            i.toolPhase = (it.t / 0.45) % 1;
            i.grounded = !(it.kind === 3 && it.t % 4 < 2);
            i.heightAboveGround = i.grounded ? 0 : 0.5;
            it.a.step(i, flat);
          }
          if (!pose) continue;
          if (!timed) {
            for (const it of items) it.p.apply(it.a, it.c);
            continue;
          }
          const t0 = performance.now();
          for (const it of items) it.p.apply(it.a, it.c);
          poseMs.push(performance.now() - t0);
        }
      },
    };
  }

  it("allocation-free in steady state; CPU per frame for 16 (Node)", () => {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as () => void;
    const c = crowd();
    // Warm-up through every state (idle, walk, scrub, air), then pose the last stepped states again and again, so the
    // measured windows hold only the poser.
    c.run(6000, true, false);
    c.poseOnly(12000);
    // GC-anchored windows (best of 3) of 600 and of 6,000 frames x 16 poses. The short window still carries JIT
    // tier-up bookkeeping (~0.2-0.3 MB, not per pose); the long one is asserted: one boxed double per pose would add
    // ~1.5 MB over its 96,000 poses, the bar is < 32 KB (AN-M1-09's bar, over 10x as many updates).
    const window = (frames: number): number => {
      let g = Number.POSITIVE_INFINITY;
      for (let w = 0; w < 3; w++) {
        gc();
        const before = process.memoryUsage().heapUsed;
        c.poseOnly(frames);
        g = Math.min(g, process.memoryUsage().heapUsed - before);
      }
      return g;
    };
    const small = window(600);
    const large = window(6000);
    gc();
    const b2 = process.memoryUsage().heapUsed;
    const keepAlive: Float64Array[] = [];
    for (let i = 0; i < 600 * 16; i++) keepAlive.push(new Float64Array(3));
    const controlGrew = process.memoryUsage().heapUsed - b2;
    expect(keepAlive.length).toBe(9600);
    expect(controlGrew).toBeGreaterThan(128 * 1024);
    c.run(600, true, true);
    const ms = c.poseMs.slice(-600).sort((x, y) => x - y);
    console.info(
      `[blockout poser] heap x16 poses: 600 frames ${small} B, 6000 frames ${large} B (control ${controlGrew} B); pose p50 ${ms[300]!.toFixed(4)} ms p95 ${ms[570]!.toFixed(4)} ms`,
    );
    expect(large).toBeLessThan(32 * 1024);
    expect(ms[570]!).toBeLessThan(1.0);
    // ~170k poses plus GC windows: seconds on a loaded laptop, beyond vitest's 5 s default.
  }, 60_000);
});
