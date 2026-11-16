// Custodian / grains lab (M1-W3-T07 evidence). Dev-only page, NOT in the game bundle: open it through the dev server,
//   /src/visuals/characters/blockout/verify/index.html?scene=typical&backend=webgpu|webgl2&preset=medium&sun=38
// It boots the real RenderModule + VisualsModule (`typical` worksite: real regolith, sun rig, sky, post) and adds the
// blockout custodian (on the lookdev proxy's spot, proxy hidden), the Desk Duster v0 and the grains layer.
// `window.__mcLab` drives captures: turntable views, walk, Desk Duster strokes, 16-colour lineup, projection helper.

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
import { BlockoutCast, type BlockoutCustodian } from "..";

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

interface LabState {
  mode: "still" | "walk" | "stroke" | "lineup";
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
  const ground = (x: number, z: number): number => {
    const ray = new Raycaster(new Vector3(x, 50, z), new Vector3(0, -1, 0));
    const hit = ray.intersectObjects(roots.world.children, true).find((h) => h.object.name.includes("ground"));
    return hit?.point.y ?? 0;
  };
  roots.world.traverse((o) => {
    if (o.name === "mc:look-custodian") o.visible = false;
  });
  const lineup: BlockoutCustodian[] = [];
  const hero = cast.spawn(Number(params.get("player") ?? 0));
  const gy = ground(SPOT[0], SPOT[1]);
  hero.object.position.set(SPOT[0], gy, SPOT[1]);
  roots.world.add(hero.object);
  const grains = new GrainLayer({ capacity: 4096, seed: 11 });
  grains.attachTo(roots.vfx);

  const s: LabState = {
    mode: (params.get("lab") as LabState["mode"] | null) ?? "still",
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

  const tmp = new Vector3();
  const lab: ClientModule<ServiceTypes> = {
    // Runs in the "animation" slot (before visuals): the frame loop only steps the known module ids.
    id: "animation",
    init: () => undefined,
    update: (frame: FrameInfo) => {
      const dt = s.frozen ? 0 : frame.dt;
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
      const p = hero.object.position;
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
