// Default `LookFactory` of the bench: the only place that picks a concrete look from `?look=`.

import type { LookContext, LookFactory, LookProvider, BenchLookId } from "./look";
import { V0Look } from "./look-v0";
import { VisualsLook } from "./look-visuals";

export const createBenchLook: LookFactory = (id: BenchLookId, context: LookContext): LookProvider =>
  id === "v0" ? new V0Look(context) : new VisualsLook(context);
