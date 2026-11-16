// Grains v0 (M1-W3-T07; W6-T03 extends it): ballistic, grime-tinted dust grains for cleaning strokes. Public barrel.
//
//   const grains = new GrainLayer({ capacity: 4096 });
//   grains.attachTo(roots.vfx);   // pool-local frame = the mesh's frame (+Y = local up)
//   grains.pool.emitStroke(x, y, z, dirX, dirZ, groundY, DESK_DUSTER_BURST); // on a tool stroke event
//   grains.update(dt, renderer);   // per frame
export {
  DESK_DUSTER_BURST,
  GLINT_SHARE,
  GRAIN_G,
  GrainPool,
  landingTime,
  mulberry32,
  VANISH_S,
  type StrokeEmission,
} from "./grain-pool";
export { GRAIN_TINT, GrainLayer, MIN_GRAIN_PX, type GrainLayerOptions } from "./grain-layer";
