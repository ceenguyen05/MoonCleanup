// CDLOD node selection on the spherified cube (WDS section 3.6). Pure and allocation-free per call: no three, no DOM.
//
// Six quadtrees, node (face, level, x, y) covering a in [-1 + x s, -1 + (x + 1) s], s = 2 / 2^level (b likewise).
//
// LOD distance. One function for the CPU and the vertex shader: the distance from the camera to the point of the
// direction on the "LOD sphere" of radius R + h0 (h0 = ground height under the camera). A node's distance is a lower
// bound of that over its footprint (centre distance minus the footprint's bounding radius; the footprint is a convex
// spherical quad, so the farthest point from its centre is a corner). A node is split while that bound is below the
// range of the child level, so every vertex of a drawn node of level L that touches a coarser node lies at or beyond
// range[L], where its morph factor is 1 and it sits on the coarser grid: no T-junction can open. The vertex shader
// applies the morph of the following levels as well (`MORPH_STAGES`), so nodes two or three levels apart still meet.
//
// Culling. Horizon: a node is hidden when its whole footprint lies below the horizon of the sphere R + H_min_global seen
// from the camera (angles at the moon centre, node at its maximum height). Frustum: bounding sphere from the node's
// min / max height against the four side planes; nodes within `frustumExemptM` of the camera are kept so they can
// cast shadows into view.
//
// Output: two vec4 per instance for the one instanced draw:
//   node = (a0, b0, size, face)     lod = (range of the level, level, skirt depth m, detail floor m)
//
// Skirts. Inside a face the vertex positions of neighbouring nodes are bit-identical (same expression, exact inputs),
// so the surface is watertight without skirts; only nodes on a cube-face edge get one (across an edge the two faces
// sample different texels and morph along opposite directions). Skirt walls elsewhere were pure overdraw.

import { CUBE_FACE_BASIS } from "@moon-cleanup/world";
import type { HeightMinMax } from "./min-max";

const QUARTER_PI = Math.PI / 4;

/** Levels of morph the vertex shader chains (a drawn node may border one up to this many levels coarser). */
export const MORPH_STAGES = 3;
/** Morph starts at this fraction of a level's range (WDS section 3.6: last 30 %). */
export const MORPH_START = 0.7;
/** Procedural detail (WDS section 3.5) above / below H_base, metres: bounds of the three crater bands plus noise. */
export const DETAIL_ABOVE_M = 1.2;
export const DETAIL_BELOW_M = 2.3;

export interface CdlodSelectorOptions {
  /** Moon radius R, metres. */
  readonly radiusM: number;
  /** Finest quadtree level (8; Ultra 9). */
  readonly leafLevel: number;
  /** Preset multiplier on the LOD ranges (0.75 / 1 / 1.25 / 1.5). */
  readonly rangeMult: number;
  readonly minMax: HeightMinMax;
  /** Instance capacity (default 512). */
  readonly maxInstances?: number;
  /** Range of the leaf level before the multiplier (default: 20 m for leaf 8, 12 m for leaf 9). */
  readonly leafRangeM?: number;
}

/** Camera input of one selection. Reused by the caller; coordinates are moon-centred metres. */
export interface CdlodView {
  camX: number;
  camY: number;
  camZ: number;
  /** Ground height under the camera above R (radius of the LOD sphere = R + this). */
  lodHeightM: number;
  /** `planeCount` planes (nx, ny, nz, d), inside when n.p + d >= 0: the four side planes, optionally up to two more. */
  readonly planes: Float64Array;
  planeCount: number;
  frustumCull: boolean;
  /** Nodes whose bounding sphere comes within this distance of the camera skip the frustum test. */
  frustumExemptM: number;
  /** Planes are pushed outward by this margin, metres (shadow cascades: their boxes are one frame old). */
  planeMarginM: number;
  /** Horizon culling on (off for shadow casters: a caster below the camera's horizon can still shade what is seen). */
  horizonCull: boolean;
  /** Nodes whose bounding sphere is farther than this from the camera are dropped. */
  maxDistanceM: number;
  /**
   * Lower limit of the LOD distance: nodes nearer than this are selected as if they were this far (shadow cascade k
   * only shades receivers beyond the previous cascade, where the surface is identical; nearer casters may be coarser).
   */
  lodFloorM: number;
  /**
   * Written to every instance: the vertex stage fades the procedural detail by max(LOD distance, this), so a shadow
   * cascade can leave out the small craters and the noise (they cast nothing a cascade resolves).
   */
  detailFloorM: number;
}

export function createCdlodView(): CdlodView {
  return {
    camX: 0,
    camY: 0,
    camZ: 0,
    lodHeightM: 0,
    planes: new Float64Array(24),
    planeCount: 4,
    frustumCull: true,
    frustumExemptM: 0,
    planeMarginM: 0,
    horizonCull: true,
    maxDistanceM: Infinity,
    lodFloorM: 0,
    detailFloorM: 0,
  };
}

export interface CdlodStats {
  visited: number;
  culledHorizon: number;
  culledFrustum: number;
  /** Nodes dropped because the instance buffers were full. */
  overflow: number;
  readonly perLevel: Int32Array;
}

export class CdlodSelector {
  readonly radiusM: number;
  readonly leafLevel: number;
  readonly capacity: number;
  /** Range per level, metres (index = level). */
  readonly ranges: Float64Array;
  /** Instance data, `count` entries of 4 floats each. */
  readonly nodeData: Float32Array;
  readonly lodData: Float32Array;
  count = 0;
  readonly stats: CdlodStats;

  private readonly minMax: HeightMinMax;
  /** tan(pi/4 a) at the grid lines of level leaf + 1 (node corners and centres of every level). */
  private readonly tanTable: Float64Array;
  private readonly tanShift: number;
  private readonly skirts: Float64Array;

  // Per-select camera state.
  private camX = 0;
  private camY = 0;
  private camZ = 0;
  private camDirX = 0;
  private camDirY = 1;
  private camDirZ = 0;
  private lodRadius = 0;
  private horizonOn = false;
  private camHorizon = 0;
  private horizonRadius = 0;
  private frustumOn = true;
  private exemptM = 0;
  private planeMarginM = 0;
  private maxDistanceM = Infinity;
  private lodFloorM = 0;
  private detailFloorM = 0;
  private planes: Float64Array = new Float64Array(24);
  private planeFloats = 16;
  /** Unit directions of the four corners of the node being visited. */
  private readonly cornerDirs = new Float64Array(12);

  constructor(options: CdlodSelectorOptions) {
    const leaf = options.leafLevel;
    if (!(Number.isInteger(leaf) && leaf >= 1 && leaf <= 12)) throw new RangeError(`leafLevel ${String(leaf)}`);
    this.radiusM = options.radiusM;
    this.leafLevel = leaf;
    this.minMax = options.minMax;
    this.capacity = options.maxInstances ?? 512;
    this.nodeData = new Float32Array(this.capacity * 4);
    this.lodData = new Float32Array(this.capacity * 4);
    this.stats = { visited: 0, culledHorizon: 0, culledFrustum: 0, overflow: 0, perLevel: new Int32Array(leaf + 1) };

    const leafRange = (options.leafRangeM ?? (leaf >= 9 ? 12 : 20)) * options.rangeMult;
    this.ranges = new Float64Array(leaf + 1);
    this.skirts = new Float64Array(leaf + 1);
    for (let level = 0; level <= leaf; level++) {
      this.ranges[level] = leafRange * 2 ** (leaf - level);
      const edgeM = (2 / 2 ** level) * QUARTER_PI * options.radiusM;
      this.skirts[level] = Math.max(0.3, 0.02 * edgeM);
    }
    this.tanShift = leaf + 1;
    const lines = (1 << this.tanShift) + 1;
    this.tanTable = new Float64Array(lines);
    for (let k = 0; k < lines; k++) this.tanTable[k] = Math.tan(QUARTER_PI * (-1 + (2 * k) / (lines - 1)));
  }

  /** Selects the nodes to draw for `view`; returns the instance count. */
  select(view: CdlodView): number {
    const stats = this.stats;
    stats.visited = 0;
    stats.culledHorizon = 0;
    stats.culledFrustum = 0;
    stats.overflow = 0;
    stats.perLevel.fill(0);
    this.count = 0;

    this.camX = view.camX;
    this.camY = view.camY;
    this.camZ = view.camZ;
    const c = Math.sqrt(view.camX * view.camX + view.camY * view.camY + view.camZ * view.camZ);
    const inv = c > 0 ? 1 / c : 0;
    this.camDirX = view.camX * inv;
    this.camDirY = view.camY * inv;
    this.camDirZ = view.camZ * inv;
    this.lodRadius = this.radiusM + view.lodHeightM;
    this.horizonRadius = this.radiusM + this.minMax.globalMinM - DETAIL_BELOW_M;
    this.horizonOn = view.horizonCull && c > this.horizonRadius + 0.5;
    this.camHorizon = this.horizonOn ? Math.acos(this.horizonRadius / c) : 0;
    this.frustumOn = view.frustumCull;
    this.exemptM = view.frustumExemptM;
    this.planeMarginM = view.planeMarginM;
    this.maxDistanceM = view.maxDistanceM;
    this.lodFloorM = view.lodFloorM;
    this.detailFloorM = view.detailFloorM;
    this.planes = view.planes;
    this.planeFloats = view.planeCount * 4;

    for (let face = 0; face < 6; face++) this.visit(face, 0, 0, 0);
    return this.count;
  }

  private visit(face: number, level: number, x: number, y: number): void {
    this.stats.visited++;
    const T = this.tanTable;
    const sh = this.tanShift - level;
    const ta0 = T[x << sh]!;
    const ta1 = T[(x + 1) << sh]!;
    const tac = T[((x << 1) + 1) << (sh - 1)]!;
    const tb0 = T[y << sh]!;
    const tb1 = T[(y + 1) << sh]!;
    const tbc = T[((y << 1) + 1) << (sh - 1)]!;
    const B = CUBE_FACE_BASIS;
    const o = face * 9;
    const nx = B[o]!;
    const ny = B[o + 1]!;
    const nz = B[o + 2]!;
    const ux = B[o + 3]!;
    const uy = B[o + 4]!;
    const uz = B[o + 5]!;
    const vx = B[o + 6]!;
    const vy = B[o + 7]!;
    const vz = B[o + 8]!;

    // Centre direction and the footprint's bounding chord on the unit sphere (largest corner distance).
    let qx = nx + tac * ux + tbc * vx;
    let qy = ny + tac * uy + tbc * vy;
    let qz = nz + tac * uz + tbc * vz;
    let qi = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz);
    const cx = qx * qi;
    const cy = qy * qi;
    const cz = qz * qi;
    let chord2 = 0;
    for (let corner = 0; corner < 4; corner++) {
      const ta = (corner & 1) === 0 ? ta0 : ta1;
      const tb = (corner & 2) === 0 ? tb0 : tb1;
      qx = nx + ta * ux + tb * vx;
      qy = ny + ta * uy + tb * vy;
      qz = nz + ta * uz + tb * vz;
      qi = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz);
      const K = this.cornerDirs;
      K[corner * 3] = qx * qi;
      K[corner * 3 + 1] = qy * qi;
      K[corner * 3 + 2] = qz * qi;
      const dx = qx * qi - cx;
      const dy = qy * qi - cy;
      const dz = qz * qi - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > chord2) chord2 = d2;
    }
    const chord = Math.sqrt(chord2);

    // Culling bounds: sphere around the centre at the middle of the node's height range.
    const mm = this.minMax;
    mm.get(face, level, x, y);
    const lo = mm.lo - DETAIL_BELOW_M;
    const hi = mm.hi + DETAIL_ABOVE_M;
    const rMax = this.radiusM + hi;

    if (this.horizonOn) {
      const cosPhi = cx * this.camDirX + cy * this.camDirY + cz * this.camDirZ;
      const phi = Math.acos(Math.min(1, Math.max(-1, cosPhi)));
      const beta = 2 * Math.asin(Math.min(1, chord * 0.5));
      if (phi - beta > this.camHorizon + Math.acos(Math.min(1, this.horizonRadius / rMax))) {
        this.stats.culledHorizon++;
        return;
      }
    }
    {
      const rc = this.radiusM + (lo + hi) * 0.5;
      const rho = rMax * chord + (hi - lo) * 0.5 + this.skirts[Math.min(level, this.leafLevel)]!;
      const px = cx * rc;
      const py = cy * rc;
      const pz = cz * rc;
      const ex = px - this.camX;
      const ey = py - this.camY;
      const ez = pz - this.camZ;
      const nearest = Math.sqrt(ex * ex + ey * ey + ez * ez) - rho;
      if (nearest > this.maxDistanceM) {
        this.stats.culledFrustum++;
        return;
      }
      if (this.frustumOn && nearest >= this.exemptM) {
        const P = this.planes;
        const margin = this.planeMarginM;
        const reach = rho + margin;
        const K = this.cornerDirs;
        const rLo = this.radiusM + lo - this.skirts[Math.min(level, this.leafLevel)]!;
        // The patch bulges past the hull of its corners by less than the sagitta of its half diagonal.
        const slack = margin + rMax * chord * chord * 0.6;
        for (let k = 0; k < this.planeFloats; k += 4) {
          const a = P[k]!;
          const b = P[k + 1]!;
          const c = P[k + 2]!;
          const d = P[k + 3]!;
          const centre = a * px + b * py + c * pz + d;
          let outside = centre < -reach;
          if (!outside && centre < reach) {
            // The sphere straddles the plane: test the corner columns (each corner at its lowest and highest radius).
            let best = -Infinity;
            for (let q = 0; q < 12; q += 3) {
              const along = a * K[q]! + b * K[q + 1]! + c * K[q + 2]!;
              const v = d + (along > 0 ? along * rMax : along * rLo);
              if (v > best) best = v;
            }
            outside = best < -slack;
          }
          if (outside) {
            this.stats.culledFrustum++;
            return;
          }
        }
      }
    }

    if (level < this.leafLevel) {
      const rl = this.lodRadius;
      const lx = cx * rl - this.camX;
      const ly = cy * rl - this.camY;
      const lz = cz * rl - this.camZ;
      const lodDistance = Math.max(this.lodFloorM, Math.sqrt(lx * lx + ly * ly + lz * lz) - chord * rl);
      if (lodDistance < this.ranges[level + 1]!) {
        const x2 = x << 1;
        const y2 = y << 1;
        this.visit(face, level + 1, x2, y2);
        this.visit(face, level + 1, x2 + 1, y2);
        this.visit(face, level + 1, x2, y2 + 1);
        this.visit(face, level + 1, x2 + 1, y2 + 1);
        return;
      }
    }

    const i = this.count;
    if (i >= this.capacity) {
      this.stats.overflow++;
      return;
    }
    this.count = i + 1;
    this.stats.perLevel[level]!++;
    const size = 2 / (1 << level);
    const k = i * 4;
    const node = this.nodeData;
    node[k] = -1 + x * size;
    node[k + 1] = -1 + y * size;
    node[k + 2] = size;
    node[k + 3] = face;
    const lod = this.lodData;
    lod[k] = this.ranges[level]!;
    lod[k + 1] = level;
    const last = (1 << level) - 1;
    lod[k + 2] = x === 0 || y === 0 || x === last || y === last ? this.skirts[level]! : 0;
    lod[k + 3] = this.detailFloorM;
  }
}

/**
 * Side planes of a camera from its view-projection matrix (column-major, three's layout), shifted so points are
 * moon-centred: writes four (nx, ny, nz, d) into `out`. Left, right, bottom, top do not depend on the depth convention.
 */
export function sidePlanesFromViewProjection(
  vp: ArrayLike<number>,
  centerX: number,
  centerY: number,
  centerZ: number,
  out: Float64Array,
): void {
  for (let p = 0; p < 4; p++) {
    const axis = p >> 1; // 0: x (left / right), 1: y (bottom / top)
    const sign = (p & 1) === 0 ? 1 : -1;
    const a = vp[3]! + sign * vp[axis]!;
    const b = vp[7]! + sign * vp[4 + axis]!;
    const c = vp[11]! + sign * vp[8 + axis]!;
    const d = vp[15]! + sign * vp[12 + axis]!;
    const inv = 1 / (Math.sqrt(a * a + b * b + c * c) || 1);
    out[p * 4] = a * inv;
    out[p * 4 + 1] = b * inv;
    out[p * 4 + 2] = c * inv;
    out[p * 4 + 3] = (d + a * centerX + b * centerY + c * centerZ) * inv;
  }
}
