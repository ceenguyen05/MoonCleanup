// Small pure helpers of the sky: angular sizes and the world direction convention. No three.
//
// Convention (shared with the render bench): azimuth is measured from +X toward +Z, elevation from the horizon up, so the
// direction is (cos(el) cos(az), sin(el), cos(el) sin(az)). Camera right is world -x when looking down +z (M0-W2-T07).

const DEG = Math.PI / 180;

/** Apparent diameters (degrees). Sun 0.53 is physical; the Earth is 1.9 physical, 2.4 in the art direction (D-09). */
export const SUN_DIAMETER_DEG = 0.53;
export const EARTH_DIAMETER_DEG = 2.4;

export interface Direction {
  x: number;
  y: number;
  z: number;
}

export function directionFromAzEl(azimuthDeg: number, elevationDeg: number, out: Direction): Direction {
  const el = elevationDeg * DEG;
  const az = azimuthDeg * DEG;
  out.x = Math.cos(el) * Math.cos(az);
  out.y = Math.sin(el);
  out.z = Math.cos(el) * Math.sin(az);
  return out;
}

/** Radius of a sphere that subtends `diameterDeg` from `distanceM` away. */
export function sphereRadiusForAngle(diameterDeg: number, distanceM: number): number {
  return distanceM * Math.sin((diameterDeg * DEG) / 2);
}

/** Edge of a camera-facing square that subtends `diameterDeg` from `distanceM` away. */
export function quadEdgeForAngle(diameterDeg: number, distanceM: number): number {
  return 2 * distanceM * Math.tan((diameterDeg * DEG) / 2);
}

/** Pixels subtended by `diameterDeg` for a vertical field of view and a render height in pixels. */
export function pixelsForAngle(diameterDeg: number, verticalFovDeg: number, heightPx: number): number {
  return (Math.tan((diameterDeg * DEG) / 2) / Math.tan((verticalFovDeg * DEG) / 2)) * heightPx;
}
