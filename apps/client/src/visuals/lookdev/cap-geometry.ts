// Polar cap of the 2 km moon sphere as a render mesh (look-dev ground). Local origin = the pole (tangent point), +Y up, the
// sphere centre at (0, -R, 0): y = sqrt(R^2 - r^2) - R + height(x, z). Rings are dense near the camera and coarse far away
// (r = rMax * t^2.2), 320 segments around. Pure geometry: three BufferGeometry only, no node materials.

import { BufferAttribute, BufferGeometry } from "three/webgpu";

export const MOON_RADIUS_M = 2000;

export interface CapOptions {
  /** Radius of the cap in metres. */
  readonly radiusM: number;
  /** Number of rings (default 200). */
  readonly rings?: number;
  /** Segments around (default 320). */
  readonly segments?: number;
  /** Extra height above the sphere at local (x, z), metres. Default flat. */
  readonly height?: (x: number, z: number) => number;
  /** Radius of the planet; `Infinity` for a flat plane. Default 2000 m. */
  readonly planetRadiusM?: number;
  /** Innermost ring radius (default 0.15 m). */
  readonly innerRadiusM?: number;
}

/** Vertical drop of the sphere at horizontal distance r from the tangent point. */
export function sphereDrop(r: number, planetRadiusM: number): number {
  if (!Number.isFinite(planetRadiusM)) return 0;
  return Math.sqrt(Math.max(planetRadiusM * planetRadiusM - r * r, 0)) - planetRadiusM;
}

export function capRingRadius(i: number, rings: number, radiusM: number, innerM: number): number {
  if (i <= 0) return 0;
  const t = i / rings;
  return innerM + (radiusM - innerM) * Math.pow(t, 2.2);
}

export function buildCapGeometry(options: CapOptions): BufferGeometry {
  const rings = options.rings ?? 200;
  const segments = options.segments ?? 320;
  const planetR = options.planetRadiusM ?? MOON_RADIUS_M;
  const height = options.height ?? (() => 0);
  const inner = options.innerRadiusM ?? 0.15;
  const vertexCount = 1 + rings * segments;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const surface = (x: number, z: number): number => sphereDrop(Math.hypot(x, z), planetR) + height(x, z);

  const put = (v: number, x: number, z: number): void => {
    const y = surface(x, z);
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    // Central differences of the surface (2 cm near the camera, wider far away) give the shading normal.
    const e = Math.max(0.02, Math.hypot(x, z) * 0.004);
    const dx = (surface(x + e, z) - surface(x - e, z)) / (2 * e);
    const dz = (surface(x, z + e) - surface(x, z - e)) / (2 * e);
    const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
    normals[v * 3] = -dx * inv;
    normals[v * 3 + 1] = inv;
    normals[v * 3 + 2] = -dz * inv;
  };

  put(0, 0, 0);
  for (let i = 1; i <= rings; i++) {
    const r = capRingRadius(i, rings, options.radiusM, inner);
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      put(1 + (i - 1) * segments + j, Math.cos(a) * r, Math.sin(a) * r);
    }
  }

  const indices = new Uint32Array((segments + (rings - 1) * segments * 2) * 3);
  let k = 0;
  // Fan around the pole (counter-clockwise seen from +Y).
  for (let j = 0; j < segments; j++) {
    const a = 1 + j;
    const b = 1 + ((j + 1) % segments);
    indices[k++] = 0;
    indices[k++] = b;
    indices[k++] = a;
  }
  for (let i = 1; i < rings; i++) {
    const base0 = 1 + (i - 1) * segments;
    const base1 = 1 + i * segments;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      const a = base0 + j;
      const b = base0 + j1;
      const c = base1 + j;
      const d = base1 + j1;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
      indices[k++] = c;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
