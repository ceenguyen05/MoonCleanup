// Stand-alone boot of the S02 / S03 look-dev scenes (M0-W3-T04 dev tooling). It is NOT the app: the composition root
// (`app/boot.ts`) and the render module's scene routing belong to other owners, and `?scene=s02|s03` is routed by the
// integrator in M0-W3-T06. Until then a page that imports this file boots exactly what the app will: the real
// `RenderModule`, the real `FrameLoop` and capture hooks, plus the look-dev scene as the `visuals` module.
//
//   <script type="module">import { bootLookdev } from "/src/visuals/lookdev/s02-dev-entry.ts"; bootLookdev();</script>
//   ?scene=s02|s03 &backend=webgpu|webgl2 &preset=low|medium|high &capture=1 [&variant=noon|dawn|d1|d3|d10|d25] [&dbg=1..7]
//
// `s02-run.mjs` drives it. The file is dev-only: nothing in the app imports it, so it never reaches the production bundle.

import type {
  ClientModule,
  EventBus,
  FrameInfo,
  ModuleContext,
  ServiceRegistry,
  ServiceTypes,
} from "@moon-cleanup/shared";
import {
  FrameLoop,
  installHarnessHooks,
  parseRenderUrlOptions,
  RenderModule,
  type RenderQualityService,
} from "../../render";
import { S02_SCENE_ID, S02Scene } from "./s02-first-stroke";
import type { LookdevScene, LookdevSceneOptions } from "./s02-lookdev-kit";
import { S03_SCENE_ID, S03Scene } from "./s03-distance-ladder";

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

/** Boots the look-dev page. Resolves when the harness hooks report ready. */
export async function bootLookdev(win: Window = window): Promise<void> {
  const doc = win.document;
  doc.documentElement.style.cssText = "margin:0;height:100%;background:#000";
  doc.body.style.cssText = "margin:0;height:100%;background:#000;overflow:hidden";
  const stage = doc.createElement("div");
  stage.style.cssText = "position:fixed;inset:0;background:#000";
  doc.body.append(stage);

  const search = win.location.search;
  const url = parseRenderUrlOptions(search);
  const services = createRegistry();
  const ctx: ModuleContext<ServiceTypes> = { services, events: silentBus };

  const render = new RenderModule({ container: stage, search, smokeScene: false });
  await render.init(ctx as unknown as ModuleContext<never>);
  const quality = services.get("quality") as unknown as RenderQualityService;

  const options: LookdevSceneOptions = {
    roots: services.get("sceneRoots") as never,
    renderer: render,
    quality,
    search,
  };
  let scene: LookdevScene;
  try {
    scene = url.scene === S03_SCENE_ID ? new S03Scene(options) : new S02Scene(options);
  } catch (e) {
    console.error(`[lookdev] scene build failed: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
  console.info(`[lookdev] scene=${scene.id === S03_SCENE_ID ? S03_SCENE_ID : S02_SCENE_ID}`);

  const visuals: ClientModule<ServiceTypes> = {
    id: "visuals",
    init: () => undefined,
    update: (frame: FrameInfo) => {
      scene.update(frame);
    },
    dispose: () => {
      scene.dispose();
    },
  };
  const loop = new FrameLoop<ServiceTypes>({
    modules: [visuals, render as unknown as ClientModule<ServiceTypes>],
    scheduler: render.scheduler,
    getQuality: () => quality.current,
    viewport: render.viewportSource,
    onError: (step, error) => {
      console.error(`[lookdev] frame step "${step}": ${error instanceof Error ? error.message : String(error)}`);
    },
  });
  loop.start();
  await installHarnessHooks(win as never, { loop, renderer: render, quality, capture: url.capture });
}
