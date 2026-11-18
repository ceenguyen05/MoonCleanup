// Own Trundle presentation wiring (M1-W7-T02): a cold chunk that wraps the gameplay module and drives a
// TrundlePresenter from the driven chassis (predicted drive view) or, after a Motor Pool call, the parked pose of the
// local host's 10 Hz read-out. Presentation only; nothing here decides gameplay.

import type { ClientModule, FrameInfo, ModuleContext, RoomHost } from "@moon-cleanup/shared";
import type { GameplayModule, RenderMapper } from "../gameplay";
import { TrundlePresenter, type TrundlePoseOut, type TrundlePoseSource } from "../visuals/vfx/vehicles";
import type { ClientServices } from "./services";

interface HostReadoutsView {
  readonly vehicleMotion?: { readonly workIntensity01: number; readonly lights?: boolean } | null;
  readonly parkedVehicle?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly fx: number;
    readonly fy: number;
    readonly fz: number;
  } | null;
}

/** Pose source: seated = the drive view's chassis; else the parked read-out pose; else nothing. */
export function createTrundleSource(gameplay: GameplayModule, host: () => RoomHost | null): TrundlePoseSource {
  return {
    read(out: TrundlePoseOut): boolean {
      const h = host();
      const readouts =
        h !== null && h.kind === "local" && "readouts" in h ? (h as { readouts: HostReadoutsView }).readouts : null;
      if (gameplay.drive.isActive || gameplay.drive.engaged) {
        const v = gameplay.drive.vehiclePose;
        out.px = v.px;
        out.py = v.py;
        out.pz = v.pz;
        out.fx = v.fx;
        out.fy = v.fy;
        out.fz = v.fz;
        out.speed = v.speed;
        out.work01 = readouts?.vehicleMotion?.workIntensity01 ?? 0;
        out.lights = readouts?.vehicleMotion?.lights === true;
        return true;
      }
      const p = readouts?.parkedVehicle;
      if (p === undefined || p === null) return false;
      out.px = p.x;
      out.py = p.y;
      out.pz = p.z;
      out.fx = p.fx;
      out.fy = p.fy;
      out.fz = p.fz;
      out.speed = 0;
      out.work01 = 0;
      out.lights = false;
      return true;
    },
  };
}

export function withTrundle(
  gameplay: GameplayModule,
  mapper: RenderMapper,
  host: () => RoomHost | null,
): ClientModule<ClientServices> {
  let presenter: TrundlePresenter | null = null;
  let renderer: ModuleContext<ClientServices>["services"] | null = null;
  return {
    id: "gameplay",
    init: async (ctx) => {
      await gameplay.init(ctx);
      const roots = ctx.services.get("sceneRoots");
      presenter = new TrundlePresenter(createTrundleSource(gameplay, host), mapper);
      presenter.attach(roots.world, roots.vfx);
      renderer = ctx.services;
    },
    update: (frame: FrameInfo) => {
      gameplay.update(frame);
      presenter?.update(frame.dt, renderer?.get("renderer").renderer ?? null);
    },
    dispose: () => {
      presenter?.dispose();
      presenter = null;
      gameplay.dispose();
    },
  };
}
