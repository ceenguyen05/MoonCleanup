// Trundle lab (M1-W7-T02 evidence, VT-M1-35). Dev-only page, NOT in the game bundle:
//   /src/visuals/vfx/vehicles/verify/index.html?scene=typical&backend=webgpu|webgl2&preset=medium&sun=38&model=glb|procedural
// Boots the real RenderModule + VisualsModule (`typical` worksite, sun rig, sky, post) and puts a `TrundlePresenter`
// on the lookdev spot with a scripted pose: `__mcTrundle.set({ camAzDeg, camDist, camHeight, tgth, speed, work, lights })`
// orbits the camera; speed / work drive the drum spin and the drum spray grains, lights shows the head lamps.

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
import { TrundlePresenter, type TrundlePoseOut, type TrundlePoseSource } from "..";

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
const R = 2000;

interface LabState {
  camAzDeg: number;
  camDist: number;
  camHeight: number;
  tgth: number;
  fovDeg: number;
  yawDeg: number;
  speed: number;
  work: number;
  lights: boolean;
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
  const roots = services.get("sceneRoots") as unknown as { world: Object3D; vfx: Object3D; camera: PerspectiveCamera };
  roots.world.traverse((o) => {
    if (o.name === "mc:look-custodian") o.visible = false;
  });
  const ray = new Raycaster(new Vector3(SPOT[0], 50, SPOT[1]), new Vector3(0, -1, 0));
  const gy = ray.intersectObjects(roots.world.children, true).find((h) => h.object.name.includes("ground"))?.point.y ?? 0;

  const s: LabState = {
    camAzDeg: Number(params.get("camaz") ?? 30),
    camDist: Number(params.get("dist") ?? 3.2),
    camHeight: Number(params.get("camh") ?? 1.2),
    tgth: Number(params.get("tgth") ?? 0.5),
    fovDeg: Number(params.get("fov") ?? 45),
    yawDeg: Number(params.get("yaw") ?? 0),
    speed: Number(params.get("speed") ?? 0),
    work: Number(params.get("work") ?? 0),
    lights: params.get("lights") === "1",
  };
  const source: TrundlePoseSource = {
    read(out: TrundlePoseOut): boolean {
      const y = (s.yawDeg * Math.PI) / 180;
      out.px = 0;
      out.py = R;
      out.pz = 0;
      out.fx = Math.sin(y);
      out.fy = 0;
      out.fz = Math.cos(y);
      out.speed = s.speed;
      out.work01 = s.work;
      out.lights = s.lights;
      return true;
    },
  };
  const mapper = {
    point: (src: Float64Array, so: number, out: Float64Array, o: number): void => {
      out[o] = src[so]! + SPOT[0];
      out[o + 1] = src[so + 1]! - R + gy;
      out[o + 2] = src[so + 2]! + SPOT[1];
    },
    direction: (src: Float64Array, so: number, out: Float64Array, o: number): void => {
      out[o] = src[so]!;
      out[o + 1] = src[so + 1]!;
      out[o + 2] = src[so + 2]!;
    },
  };
  const presenter = new TrundlePresenter(source, mapper);
  const wantGlb = params.get("model") !== "procedural";
  presenter.loadAuthored = false;
  presenter.attach(roots.world, roots.vfx);
  let model: "glb" | "procedural" = "procedural";
  if (wantGlb) {
    const ok = await presenter.upgrade();
    model = ok ? "glb" : "procedural";
  }

  const lab: ClientModule<ServiceTypes> = {
    id: "animation",
    init: () => undefined,
    update: (frame: FrameInfo) => {
      presenter.update(frame.dt, render.renderer as never);
      const cam = roots.camera;
      const az = (s.camAzDeg * Math.PI) / 180;
      const px = SPOT[0];
      const pz = SPOT[1];
      cam.fov = s.fovDeg;
      cam.updateProjectionMatrix();
      cam.position.set(px + Math.sin(az) * s.camDist, gy + s.camHeight, pz + Math.cos(az) * s.camDist);
      cam.lookAt(px, gy + s.tgth, pz);
      cam.updateMatrixWorld();
    },
    dispose: () => presenter.dispose(),
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
  let draws = 0;
  presenter.parts.root.traverse((o) => {
    if ((o as { isMesh?: boolean }).isMesh) draws++;
  });
  (win as unknown as { __mcTrundle: unknown }).__mcTrundle = {
    state: s,
    set: (patch: Partial<LabState>) => Object.assign(s, patch),
    info: () => ({ model, meshes: draws, grains: presenter.grains.pool.live() }),
    ready: true,
  };
}

main().catch((e: unknown) => {
  console.error(`[lab] boot failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
});
