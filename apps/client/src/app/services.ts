// The client's concrete service registry type. It narrows the contract's opaque services (client/module v0): the
// render module's real handles (`renderer`, `sceneRoots`, `quality`) plus the app-owned event bus / UI store and the
// net session. `input`, `sim` and `assetLoader` are not registered in the M0 hello world (their owners arrive in
// M0-W2/W3 and M1); `REQUIRED_SERVICES` lists what must exist before the first frame.

import type { ServiceKey } from "@moon-cleanup/shared";
import type { RenderServices } from "../render";
import type { NetSession } from "../net";
import type { AppUiStore } from "./ui-store";

export interface ClientServices extends RenderServices {
  netSession: NetSession;
  uiStore: AppUiStore;
}

/** Services the hello world needs registered after every module's `init`. */
export const REQUIRED_SERVICES = [
  "eventBus",
  "uiStore",
  "renderer",
  "sceneRoots",
  "quality",
  "netSession",
] as const satisfies readonly ServiceKey[];
