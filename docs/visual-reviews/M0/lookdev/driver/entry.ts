import { createEventBus } from "/src/app/event-bus.ts";
import { createServiceRegistry } from "/src/app/service-registry.ts";
import { FrameLoop, RenderModule, installHarnessHooks, parseRenderUrlOptions } from "/src/render/index.ts";
import { VisualsModule } from "/src/visuals/index.ts";

const doc = document;
doc.documentElement.style.cssText = "margin:0;height:100%;background:#000";
doc.body.style.cssText = "margin:0;height:100%;background:#000;overflow:hidden";
const stage = doc.createElement("div");
stage.style.cssText = "position:fixed;inset:0;background:#000";
doc.body.append(stage);
const events = createEventBus({ onListenerError: (n: string, e: unknown) => console.error("listener", n, e) });
const services: any = createServiceRegistry();
services.register("eventBus", events);
const render = new RenderModule({ container: stage, search: location.search, smokeScene: false, trackTimestamp: false });
const visuals = new VisualsModule();
const modules = [render, visuals];
const ctx = { services, events };
for (const m of modules) await (m as any).init(ctx);
const quality = services.get("quality");
const loop = new FrameLoop({
  modules,
  scheduler: render.scheduler,
  getQuality: () => quality.current,
  viewport: render.viewportSource,
  onError: (step: string, error: unknown) => console.error("frame step " + step, error),
} as any);
loop.start();
await installHarnessHooks(window as any, { loop, renderer: render, quality, capture: parseRenderUrlOptions(location.search).capture } as any);
