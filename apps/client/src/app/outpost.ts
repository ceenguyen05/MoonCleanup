import type { ClientModule, ModuleContext } from "@moon-cleanup/shared";
import { borealStandInSellPoints } from "@moon-cleanup/sim";
import {
  disposeOutpostKit,
  loadOutpostKit,
  OutpostView,
  type OutpostKit,
  type OutpostMapper,
} from "../visuals/outpost";
import type { ClientServices } from "./services";

/** Lazy gameplay-only wrapper: preserves the visuals lifecycle and survives a renderer replacement or late load. */
export function withOutpost(
  visuals: ClientModule<ClientServices>,
  mapper: OutpostMapper,
  radius: number,
  flat: boolean,
  report: (source: string, error: unknown) => void,
): ClientModule<ClientServices> {
  let context: ModuleContext<ClientServices> | null = null;
  let kit: OutpostKit | null = null;
  let view: OutpostView | null = null;
  let generation = 0;
  let off: (() => void) | null = null;
  const clear = (): void => {
    view?.dispose();
    view = null;
    if (kit) disposeOutpostKit(kit);
    kit = null;
  };
  const load = (): void => {
    const current = ++generation;
    clear();
    const renderer = context?.services.get("renderer").renderer;
    if (!renderer) return;
    void loadOutpostKit(renderer)
      .then((loaded) => {
        if (current !== generation || !context) {
          disposeOutpostKit(loaded);
          return;
        }
        kit = loaded;
        view = new OutpostView(loaded, borealStandInSellPoints(radius), radius, mapper, flat);
        const roots = context.services.get("sceneRoots");
        roots.world.add(view.root);
        view.update(roots.camera);
      })
      .catch((error: unknown) => {
        if (current === generation && context) report("Outpost Boreal assets", error);
      });
  };
  return {
    id: visuals.id,
    async init(ctx) {
      await visuals.init(ctx);
      context = ctx;
      off = ctx.services.get("renderer").onRecreated(load);
      load();
    },
    update(frame) {
      visuals.update(frame);
      if (context) view?.update(context.services.get("sceneRoots").camera);
    },
    resize(size) {
      visuals.resize?.(size);
    },
    dispose() {
      ++generation;
      off?.();
      off = null;
      context = null;
      clear();
      visuals.dispose();
    },
  };
}
