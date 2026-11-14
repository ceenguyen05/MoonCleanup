// Chunked sphere-terrain of the bench (M0-W2-T02, v1 M0-W3-T07): 64 chunk meshes (one draw each) on the 2 km moon.
// Height comes from `terrainHeightM`, which is the procedural stand-in (v0) or the baked height cube (v1,
// `setTerrainHeightSource`). The one-draw CDLOD terrain is M1; this is a JS-decoded stand-in for its mesh.
//
// Each chunk is a (32 + 3)^2 vertex grid: 33 x 33 surface vertices (32 x 32 quads, as the CDLOD patch) plus a skirt
// ring dropped by max(0.3 m, 2 % of the edge) that hides the cracks between chunks of different size.

import { BufferAttribute, BufferGeometry, Group, Mesh, type Material } from "three/webgpu";
import { CHUNK_QUADS, chunkRects, surfacePoint, terrainHeightM, type ChunkRect, MOON_RADIUS_M } from "./terrain-data";

const GRID = CHUNK_QUADS + 3;
const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };
const _c = { x: 0, y: 0, z: 0 };
const _d = { x: 0, y: 0, z: 0 };

/** Builds one chunk's geometry. Positions are world space (the chunk meshes sit at the origin). */
export function buildChunkGeometry(rect: ChunkRect, normalEpsM = 0.4): BufferGeometry {
  const positions = new Float32Array(GRID * GRID * 3);
  const normals = new Float32Array(GRID * GRID * 3);
  const edge = Math.max(rect.x1 - rect.x0, rect.z1 - rect.z0);
  const skirt = Math.max(0.3, 0.02 * edge);
  const eps = normalEpsM;
  for (let gj = 0; gj < GRID; gj++) {
    const sj = Math.min(CHUNK_QUADS, Math.max(0, gj - 1));
    const isSkirtJ = gj === 0 || gj === GRID - 1;
    const z = rect.z0 + ((rect.z1 - rect.z0) * sj) / CHUNK_QUADS;
    for (let gi = 0; gi < GRID; gi++) {
      const si = Math.min(CHUNK_QUADS, Math.max(0, gi - 1));
      const isSkirt = isSkirtJ || gi === 0 || gi === GRID - 1;
      const x = rect.x0 + ((rect.x1 - rect.x0) * si) / CHUNK_QUADS;
      const h = terrainHeightM(x, z);
      surfacePoint(x, z, h - (isSkirt ? skirt : 0), _a);
      // Normal from central differences of the (un-skirted) surface.
      surfacePoint(x - eps, z, terrainHeightM(x - eps, z), _b);
      surfacePoint(x + eps, z, terrainHeightM(x + eps, z), _c);
      const tx = _c.x - _b.x;
      const ty = _c.y - _b.y;
      const tz = _c.z - _b.z;
      surfacePoint(x, z - eps, terrainHeightM(x, z - eps), _b);
      surfacePoint(x, z + eps, terrainHeightM(x, z + eps), _d);
      const ux = _d.x - _b.x;
      const uy = _d.y - _b.y;
      const uz = _d.z - _b.z;
      // n = u x t points up (+y) for the x-right, z-forward parametrisation.
      let nx = uy * tz - uz * ty;
      let ny = uz * tx - ux * tz;
      let nz = ux * ty - uy * tx;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const k = (gj * GRID + gi) * 3;
      positions[k] = _a.x;
      positions[k + 1] = _a.y;
      positions[k + 2] = _a.z;
      normals[k] = nx;
      normals[k + 1] = ny;
      normals[k + 2] = nz;
    }
  }
  const indices = new Uint16Array((GRID - 1) * (GRID - 1) * 6);
  let w = 0;
  for (let j = 0; j < GRID - 1; j++) {
    for (let i = 0; i < GRID - 1; i++) {
      const a = j * GRID + i;
      const b = a + 1;
      const c = a + GRID;
      const d = c + 1;
      // Counter-clockwise seen from above (+y).
      indices[w++] = a;
      indices[w++] = c;
      indices[w++] = b;
      indices[w++] = b;
      indices[w++] = c;
      indices[w++] = d;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

export interface TerrainChunkOptions {
  /** Half-width of the central difference that gives vertex normals (metres); wider smooths coarse height data. */
  readonly normalEpsM?: number;
  /** Called once per built geometry, e.g. to add per-vertex horizon angles. */
  readonly decorate?: (geometry: BufferGeometry, rect: ChunkRect) => void;
}

/** The 64 chunk meshes under one group. Shares one material; owns the geometries. */
export class TerrainChunks {
  readonly group = new Group();
  readonly meshes: Mesh[] = [];
  /** Triangles of all chunks (what a frame draws without culling). */
  readonly triangles: number;

  private readonly geometries: BufferGeometry[] = [];

  constructor(material: Material, options: TerrainChunkOptions = {}) {
    this.group.name = "mc:bench-terrain";
    let tris = 0;
    for (const rect of chunkRects()) {
      const geometry = buildChunkGeometry(rect, options.normalEpsM);
      options.decorate?.(geometry, rect);
      const mesh = new Mesh(geometry, material);
      mesh.name = `mc:bench-chunk-${String(rect.index)}`;
      mesh.castShadow = rect.castsShadow;
      mesh.receiveShadow = true;
      // Static: matrices never change, so skip the per-frame matrix update work.
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.geometries.push(geometry);
      tris += geometry.index === null ? 0 : geometry.index.count / 3;
    }
    this.triangles = tris;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    this.meshes.length = 0;
  }
}

/** Height of the sphere surface under the camera, exposed for tests (the surface drops away from the tangent plane). */
export function sphereDropM(distanceM: number): number {
  return MOON_RADIUS_M - Math.sqrt(MOON_RADIUS_M * MOON_RADIUS_M - distanceM * distanceM);
}
