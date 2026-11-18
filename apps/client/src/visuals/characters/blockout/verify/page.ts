// Custodian / grains lab (M1-W3-T07 evidence). Dev-only page, NOT in the game bundle: open it through the dev server,
//   /src/visuals/characters/blockout/verify/index.html?scene=typical&backend=webgpu|webgl2&preset=medium&sun=38
// It boots the real RenderModule + VisualsModule (`typical` worksite: real regolith, sun rig, sky, post) and adds the
// blockout custodian (on the lookdev proxy's spot, proxy hidden), the Desk Duster v0 and the grains layer.
// `window.__mcLab` drives captures: turntable views, walk, Desk Duster strokes, 16-colour lineup, projection helper.
// `lab=anim&act=idle|walk|lope|sweep|sweepwalk|jump|cycle`: the W5-T04 `AvatarAnimator` drives the custodian through
// `CustodianAvatarView` / `BlockoutPoser` (the game's hookup path) on a scripted input, with foot IK on the lab ground.

import type {
  ClientModule,
  EventBus,
  FrameInfo,
  ModuleContext,
  ServiceRegistry,
  ServiceTypes,
} from "@moon-cleanup/shared";
import { Raycaster, Vector3, type Object3D, type PerspectiveCamera } from "three/webgpu";
import {
  FrameLoop,
  installHarnessHooks,
  parseRenderUrlOptions,
  RenderModule,
  type RenderQualityService,
} from "../../../../render";
import { VisualsModule } from "../../../module";
import { DESK_DUSTER_BURST, GrainLayer } from "../../../vfx/grains";
import { AnimEventQueue, AvatarAnimInput, AvatarAnimator, TOOL_CLASS, type AnimGround } from "../../../../animation";
import { BlockoutCast, CustodianAvatarView, type BlockoutCustodian, type PoseMapper } from "..";

type Registry = ServiceRegistry<ServiceTypes>;

function createRegistry(): Registry {
  const services = new Map<string, unknown>();
  return {
    get: (key) => {
      if (!services.has(key)) throw new Error(`service "${key}" is not registered`);
      return services.get(key) as never;
    },
    has: (key) => services.has(key),
    register: (key, service) => {
      services.set(key, service);
    },
  };
}
const silentBus: EventBus = { emit: () => undefined, on: () => () => undefined };

const SPOT: readonly [number, number] = [-2.4, -3];

/** Moon radius of the lab's animation sphere (the lab spot sits at its north pole). */
const ANIM_R = 2000;

type AnimAct = "idle" | "walk" | "lope" | "sweep" | "sweepwalk" | "jump" | "cycle";

interface LabState {
  mode: "still" | "walk" | "stroke" | "lineup" | "anim";
  act: AnimAct;
  actT: number;
  yawDeg: number;
  /** Camera: distance (m), height of the eye and of the target above the feet, azimuth around the custodian (deg). */
  camDist: number;
  camHeight: number;
  targetHeight: number;
  camAzDeg: number;
  fovDeg: number;
  strokeEvery: number;
  strokeTimer: number;
  walkT: number;
  frozen: boolean;
  /** Fixed 1/60 s steps to run on the next frame while frozen (deterministic capture sequences). */
  pending: number;
}

async function main(): Promise<void> {
  const win = window;
  const doc = document;
  doc.body.style.cssText = "margin:0;height:100%;background:#000;overflow:hidden";
  const stage = doc.createElement("div");
  stage.style.cssText = "position:fixed;inset:0;background:#000";
  doc.body.append(stage);

  const search = win.location.search;
  const params = new URLSearchParams(search);
  const url = parseRenderUrlOptions(search);
  const services = createRegistry();
  const ctx: ModuleContext<ServiceTypes> = { services, events: silentBus };
  const render = new RenderModule({ container: stage, search, smokeScene: false });
  await render.init(ctx as unknown as ModuleContext<never>);
  const quality = services.get("quality") as unknown as RenderQualityService;
  const visuals = new VisualsModule({ search });
  visuals.init(ctx as unknown as ModuleContext<never>);
  const roots = services.get("sceneRoots") as unknown as {
    world: Object3D;
    vfx: Object3D;
    camera: PerspectiveCamera;
  };

  const cast = await BlockoutCast.load();
  // Lab ground height: a raycast against the worksite meshes, memoised on a 4 cm grid (bilinear between the cached
  // corners) so the animator's foot-IK probes do not raycast the whole scene several times per step.
  const groundCache = new Map<number, number>();
  const rayGround = (x: number, z: number): number => {
    const ray = new Raycaster(new Vector3(x, 50, z), new Vector3(0, -1, 0));
    const hit = ray.intersectObjects(roots.world.children, true).find((h) => h.object.name.includes("ground"));
    return hit?.point.y ?? 0;
  };
  const CELL = 0.04;
  const corner = (i: number, j: number): number => {
    const key = (i + 32768) * 65536 + (j + 32768);
    let h = groundCache.get(key);
    if (h === undefined) {
      h = rayGround(i * CELL, j * CELL);
      groundCache.set(key, h);
    }
    return h;
  };
  const ground = (x: number, z: number): number => {
    const fx = x / CELL;
    const fz = z / CELL;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = corner(i, j) + (corner(i + 1, j) - corner(i, j)) * u;
    const b = corner(i, j + 1) + (corner(i + 1, j + 1) - corner(i, j + 1)) * u;
    return a + (b - a) * v;
  };
  roots.world.traverse((o) => {
    if (o.name === "mc:look-custodian") o.visible = false;
  });
  const lineup: BlockoutCustodian[] = [];
  const gy = ground(SPOT[0], SPOT[1]);
  const hero = cast.spawn(Number(params.get("player") ?? 0));
  hero.object.position.set(SPOT[0], gy, SPOT[1]);
  roots.world.add(hero.object);
  const grains = new GrainLayer({ capacity: 4096, seed: 11 });
  grains.attachTo(roots.vfx);

  const s: LabState = {
    mode: (params.get("lab") as LabState["mode"] | null) ?? "still",
    act: (params.get("act") as AnimAct | null) ?? "cycle",
    actT: 0,
    yawDeg: Number(params.get("yaw") ?? 200),
    camDist: Number(params.get("dist") ?? 3.5),
    camHeight: Number(params.get("camh") ?? 1.6),
    targetHeight: Number(params.get("tgth") ?? 1.0),
    camAzDeg: Number(params.get("camaz") ?? 200),
    fovDeg: Number(params.get("fov") ?? 50),
    strokeEvery: 0.32,
    strokeTimer: 0,
    walkT: 0,
    frozen: params.get("freeze") === "1",
    pending: 0,
  };
  hero.reset((s.yawDeg * Math.PI) / 180);

  const setLineup = (on: boolean): void => {
    for (const c of lineup.splice(0)) c.dispose();
    if (!on) return;
    for (let i = 0; i < 16; i++) {
      const c = cast.spawn(i);
      const x = SPOT[0] - 7.5 + i;
      const z = SPOT[1] + 2;
      c.object.position.set(x, ground(x, z), z);
      c.reset(Math.PI);
      roots.world.add(c.object);
      lineup.push(c);
    }
  };
  if (s.mode === "lineup") setLineup(true);

  // ---- animator-driven custodian (the game's path): moon-centred input at the north pole of a 2 km sphere ----
  const mapper: PoseMapper = {
    point: (src, so, out, o) => {
      out[o] = src[so]! + SPOT[0];
      out[o + 1] = src[so + 1]! - ANIM_R + gy;
      out[o + 2] = src[so + 2]! + SPOT[1];
    },
    direction: (src, so, out, o) => {
      out[o] = src[so]!;
      out[o + 1] = src[so + 1]!;
      out[o + 2] = src[so + 2]!;
    },
  };
  const animGround: AnimGround = {
    heightsAt(dirs: Float64Array, out: Float64Array, n: number): void {
      for (let k = 0; k < n; k++)
        out[k] = ground(dirs[k * 3]! * ANIM_R + SPOT[0], dirs[k * 3 + 2]! * ANIM_R + SPOT[1]) - gy;
    },
  };
  const animator = new AvatarAnimator(0, new AnimEventQueue(64));
  const animIn = new AvatarAnimInput();
  animIn.moonRadiusM = ANIM_R;
  animIn.pos.set([0, ANIM_R, 0]);
  animIn.facing.set([Math.sin((s.yawDeg * Math.PI) / 180), 0, Math.cos((s.yawDeg * Math.PI) / 180)]);
  animIn.teleport = true;
  let animOn = false;
  const view = new CustodianAvatarView(cast, { animatorFor: () => (animOn ? animator : null) }, mapper, 1);
  view.setPlayerColour(0, Number(params.get("player") ?? 0));
  roots.world.add(view.root);
  const jump = { t: -1, v0: 2.2 };
  let lastPhase = 0;
  /** `grains=0`: no stroke grains in anim mode (capture isolation). */
  const labGrains = params.get("grains") !== "0";
  /** Scripted input for `act` at time `t` (s) into `animIn` (moon-centred, north pole). */
  const script = (act: AnimAct, t: number, dt: number): void => {
    const i = animIn;
    let a = act;
    if (act === "cycle") {
      // 0-1.5 idle, 1.5-5 walk, 5-9 sweep, 9-10.5 idle, 10.5-14 jump, then loop.
      const c = t % 14;
      a = c < 1.5 ? "idle" : c < 5 ? "walk" : c < 9 ? "sweep" : c < 10.5 ? "idle" : "jump";
    }
    const speed = a === "lope" ? 3.4 : a === "sweepwalk" ? 1.0 : a === "walk" ? 1.6 : 0;
    const yaw0 = (s.yawDeg * Math.PI) / 180;
    let x = i.pos[0]!;
    let z = i.pos[2]!;
    if (speed > 0) {
      // Circle of radius 3 m round the spot.
      const ang = Math.atan2(z, x) + (speed / 3) * dt;
      x = Math.cos(ang) * 3;
      z = Math.sin(ang) * 3;
      i.vel[0] = -Math.sin(ang) * speed;
      i.vel[1] = 0;
      i.vel[2] = Math.cos(ang) * speed;
      i.facing[0] = i.vel[0];
      i.facing[1] = 0;
      i.facing[2] = i.vel[2];
    } else {
      i.vel[0] = 0;
      i.vel[1] = 0;
      i.vel[2] = 0;
      if (act !== "cycle") {
        i.facing[0] = Math.sin(yaw0);
        i.facing[2] = Math.cos(yaw0);
      }
    }
    const sweeping = a === "sweep" || a === "sweepwalk";
    i.toolClass = params.has("tool") ? Number(params.get("tool")) : TOOL_CLASS.palm; // W4-T07: ?tool=1..4 (palm, blade, broom, bar)
    i.toolActive = sweeping;
    i.toolPeriodS = 0.45;
    i.toolPhase = sweeping ? (i.toolPhase + dt / 0.45) % 1 : 0;
    i.toolInContact = sweeping && i.toolPhase < i.toolContactFrac;
    // Jump: a ballistic hop every 3.5 s at lunar gravity.
    let h = 0;
    i.jumped = false;
    if (a === "jump") {
      if (jump.t < 0) {
        jump.t = 0;
        i.jumped = true;
      } else jump.t += dt;
      const tt = jump.t;
      h = jump.v0 * tt - 0.5 * 1.62 * tt * tt;
      const vUp = jump.v0 - 1.62 * tt;
      if (h <= 0 && tt > 0.1) {
        i.impactMps = -vUp;
        h = 0;
        if (tt > 3.5) jump.t = -1;
      }
      i.vel[1] = h > 0 ? vUp : 0;
    } else jump.t = -1;
    i.grounded = h <= 0;
    i.heightAboveGround = h;
    const r = Math.sqrt(ANIM_R * ANIM_R - x * x - z * z);
    const base = r + ground(x + SPOT[0], z + SPOT[1]) - gy + h;
    i.pos[0] = (x * base) / r;
    i.pos[1] = base;
    i.pos[2] = (z * base) / r;
  };

  const tmp = new Vector3();
  const lab: ClientModule<ServiceTypes> = {
    // Runs in the "animation" slot (before visuals): the frame loop only steps the known module ids.
    id: "animation",
    init: () => undefined,
    update: (frame: FrameInfo) => {
      const steps = s.frozen ? s.pending : 1;
      s.pending = 0;
      const dt = s.frozen ? steps / 60 : frame.dt;
      const i = hero.input;
      i.toolActive = s.mode === "stroke";
      i.vx = i.vz = 0;
      i.facing = (s.yawDeg * Math.PI) / 180;
      if (s.mode === "walk") {
        s.walkT += dt;
        const speed = Number(params.get("speed") ?? 2.0);
        const a = s.walkT * (speed / 4);
        const x = SPOT[0] + Math.cos(a) * 4;
        const z = SPOT[1] + Math.sin(a) * 4;
        i.vx = -Math.sin(a) * speed;
        i.vz = Math.cos(a) * speed;
        i.facing = Number.NaN;
        hero.object.position.set(x, ground(x, z), z);
      }
      animOn = s.mode === "anim";
      hero.object.visible = !animOn;
      if (animOn) {
        const sub = s.frozen ? steps : dt > 0 ? 1 : 0;
        const h = s.frozen ? 1 / 60 : dt;
        for (let k = 0; k < sub; k++) {
          s.actT += h;
          script(s.act, s.actT, h);
          animIn.dt = h;
          animator.ikEnabled = true;
          animator.step(animIn, animGround);
        }
        view.update(dt, roots.camera, win.innerHeight);
        // Grains from the bristle tips at the start of every push (sim contact start), on the lab ground.
        const ph = animIn.toolPhase;
        const me = view.custodianFor(0);
        if (labGrains && me !== null && animIn.toolActive && ph < lastPhase && view.poserFor(0)!.kneel > 0.8) {
          me.object.updateMatrixWorld(true);
          me.toolContact.getWorldPosition(tmp);
          const fx = animIn.facing[0]!;
          const fz = animIn.facing[2]!;
          const fl = Math.hypot(fx, fz) || 1;
          grains.pool.emitStroke(tmp.x, tmp.y, tmp.z, fx / fl, fz / fl, ground(tmp.x, tmp.z), DESK_DUSTER_BURST);
        }
        lastPhase = ph;
      }
      hero.update(dt);
      for (const c of lineup) c.update(dt);
      if (s.mode === "stroke" && dt > 0) {
        s.strokeTimer -= dt;
        if (s.strokeTimer <= 0) {
          s.strokeTimer += s.strokeEvery;
          const contact = hero.tool?.children[0] ?? hero.handAnchor;
          contact.getWorldPosition(tmp);
          const fx = Math.sin(hero.motion.yaw);
          const fz = Math.cos(hero.motion.yaw);
          // Contact on the ground ahead of the custodian (v0 arm does not reach the ground; see report).
          const cx = hero.object.position.x + fx * 0.55;
          const cz = hero.object.position.z + fz * 0.55;
          const cy = ground(cx, cz);
          grains.pool.emitStroke(cx, cy, cz, fx, fz, cy, DESK_DUSTER_BURST);
        }
      }
      grains.update(dt, render.renderer as never);
      // Camera around the custodian.
      const cam = roots.camera;
      const followed = animOn ? view.custodianFor(0) : null;
      const p = followed !== null ? followed.object.position : hero.object.position;
      const az = (s.camAzDeg * Math.PI) / 180;
      cam.fov = s.fovDeg;
      cam.updateProjectionMatrix();
      cam.position.set(p.x + Math.sin(az) * s.camDist, p.y + s.camHeight, p.z + Math.cos(az) * s.camDist);
      cam.lookAt(p.x, p.y + s.targetHeight, p.z);
      cam.updateMatrixWorld();
    },
    dispose: () => {
      grains.dispose();
      cast.dispose();
    },
  };

  const loop = new FrameLoop<ServiceTypes>({
    modules: [visuals as unknown as ClientModule<ServiceTypes>, lab, render as unknown as ClientModule<ServiceTypes>],
    scheduler: render.scheduler,
    getQuality: () => quality.current,
    viewport: render.viewportSource,
    onError: (step, error) => console.error(`[lab] ${step}: ${error instanceof Error ? error.message : String(error)}`),
  });
  loop.start();
  await installHarnessHooks(win as never, { loop, renderer: render, quality, capture: url.capture });

  (win as unknown as { __mcLab: unknown }).__mcLab = {
    state: s,
    set: (patch: Partial<LabState>) => {
      Object.assign(s, patch);
      if (patch.yawDeg !== undefined) hero.reset((patch.yawDeg * Math.PI) / 180);
      if (patch.mode !== undefined) setLineup(patch.mode === "lineup");
      if (patch.act !== undefined) s.actT = 0;
    },
    /** Screen-space box (px) of the hero's bounding box, for 32 px / crop measurements. */
    heroBox: () => {
      const cam = roots.camera;
      const w = win.innerWidth;
      const h = win.innerHeight;
      let minX = 1e9;
      let minY = 1e9;
      let maxX = -1e9;
      let maxY = -1e9;
      const box = cast.custodian.levels[0]!.boundingBox!;
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            tmp.set(x, y, z);
            hero.body.localToWorld(tmp);
            tmp.project(cam);
            const sx = ((tmp.x + 1) / 2) * w;
            const sy = ((1 - tmp.y) / 2) * h;
            minX = Math.min(minX, sx);
            maxX = Math.max(maxX, sx);
            minY = Math.min(minY, sy);
            maxY = Math.max(maxY, sy);
          }
      return { minX, minY, maxX, maxY };
    },
    grains: () => ({
      live: grains.pool.live(),
      emitted: grains.pool.emitted,
      used: grains.pool.used,
      time: grains.pool.time,
      uploads: grains.stats.uploads,
    }),
    /** Screen positions (px) and pool-space positions of the live grains (VT-M1-16 telemetry). */
    trackGrains: () => {
      const out = new Float64Array(3);
      const cam = roots.camera;
      const list: { i: number; x: number; y: number; z: number; sx: number; sy: number; r: number }[] = [];
      for (let i = 0; i < grains.pool.used; i++) {
        if (!grains.pool.sample(i, grains.pool.time, out)) continue;
        tmp.set(out[0]!, out[1]!, out[2]!).project(cam);
        list.push({
          i,
          x: out[0]!,
          y: out[1]!,
          z: out[2]!,
          sx: ((tmp.x + 1) / 2) * win.innerWidth,
          sy: ((1 - tmp.y) / 2) * win.innerHeight,
          r: grains.pool.look[i * 4]!,
        });
      }
      return list;
    },
    placeholderAssets: () => cast.placeholderAssets(),
    /** Animator-driven custodian readout (anim mode). */
    anim: () => {
      const p = view.poserFor(0)!;
      const me = view.custodianFor(0);
      let tip: { sx: number; sy: number; y: number; groundY: number } | null = null;
      if (me !== null) {
        me.object.updateMatrixWorld(true);
        me.toolContact.getWorldPosition(tmp);
        const y = tmp.y;
        const groundY = ground(tmp.x, tmp.z);
        tmp.project(roots.camera);
        tip = { sx: ((tmp.x + 1) / 2) * win.innerWidth, sy: ((1 - tmp.y) / 2) * win.innerHeight, y, groundY };
      }
      const m = me?.motion;
      return {
        act: s.act,
        t: s.actT,
        kneel: p.kneel,
        bend: p.bend,
        reachErrorM: p.reachErrorM,
        base: Array.from(animator.pose.base),
        gaitPhase: animator.pose.gaitPhase,
        pelvisY: animator.pose.pelvisY,
        locked: Array.from(animator.ik.locked),
        joints:
          m === undefined ? null : [m.hipL, m.hipR, m.kneeL, m.kneeR, m.shoulderL, m.shoulderR, m.elbowL, m.elbowR],
        toolTip: tip,
      };
    },
    setGrainsVisible: (v: boolean) => {
      grains.mesh.visible = v;
    },
    toolTip: () => {
      const contact = hero.tool;
      if (contact === null) return null;
      contact.getWorldPosition(tmp);
      tmp.project(roots.camera);
      return { sx: ((tmp.x + 1) / 2) * win.innerWidth, sy: ((1 - tmp.y) / 2) * win.innerHeight };
    },
    ready: true,
  };
}

main().catch((e: unknown) => {
  console.error(`[lab] boot failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
});
