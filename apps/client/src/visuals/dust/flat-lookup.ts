// World point -> dust tile lookup for a FLAT world patch (M1-W3-T02): the ground of a look scene is the tangent plane of
// one site plot, world (x, z) in metres = site plot-local (u, -v) in mm / 1000 (x = east, y = up, z = south: a
// right-handed frame, so the scene is not a mirror image of the sim's world). The regolith material asks this source for
// its five mask taps; the answer comes from the tile atlas of `DustReplayPass` in the mask contract (r grime, g berm
// height, b polish).
//
// Per fragment: 1 fetch of a static cell texture (1 m cells, owner plot of the cell centre), 2 fetches of a small plot
// table (affine world -> tile texel, and the atlas origin of the plot's slot, -1 = no tile), then 5 bilinear atlas taps
// inside that one tile. A cell centre lies inside its owner hexagon and a tile covers 25.6 m, so every tap of the cell
// stays inside the tile (strokes are drawn into the gutters of the neighbouring tiles as well).
//
// The site can move (M1-W3-T05, the game worksite follows the player): `beginRecentre(site)` builds the tables of the
// new site into spare buffers in budgeted slices (`stepRecentre(ms)`, about 50,000 point-to-plot queries in all), and
// `commitRecentre()` swaps them in with one upload; the shader graph is unchanged (same textures, same size).
// The curved terrain (CDLOD, M1-W2) needs its own point -> plot lookup; the atlas, slot table and channel mapping
// below stay the same. `sync()` after `atlas.frame()` costs one loop over at most 256 plots and a 2 KB upload when the
// slot table changed, nothing otherwise.

import {
  DataTexture,
  FloatType,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
  type Texture,
} from "three/webgpu";
import { clamp, float, floor, ivec2, select, texture, textureLoad, vec2, vec4 } from "three/tsl";
import type { PlotId } from "@moon-cleanup/shared";
import type { IcoPlotGrid } from "@moon-cleanup/world";
import type { MaskTapSource, MaskTaps } from "../materials";
import { FRAME_EDGE_MM, FRAME_HALF_MM, atlasHeight, atlasWidth } from "./replay-batch";
import type { DustTileAtlas } from "./tile-atlas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL node graphs are built untyped, as in the material
type TslNode = any;

/** Cells per edge and cell size: the lookup covers the site +- 112 m. */
export const FLAT_LOOKUP_CELLS = 224;
export const FLAT_LOOKUP_CELL_M = 1;
/** Plots the table can hold (the covered square holds about 190). */
export const FLAT_LOOKUP_MAX_PLOTS = 256;
/** Fetches the source adds per fragment: cell, 2 table rows, 5 atlas taps. */
export const FLAT_LOOKUP_FETCHES = 8;

/** One set of lookup tables (live or under construction). */
class LookupTables {
  readonly plots = new Int32Array(FLAT_LOOKUP_MAX_PLOTS);
  /** Row 0: a00, a01, a10, a11 (tile texels per metre). Row 1: tx, ty, slot origin x, y (atlas texels; x = -1: none). */
  readonly table = new Float32Array(FLAT_LOOKUP_MAX_PLOTS * 2 * 4);
  /** Plot-table index per cell (the bytes of `cellTexture`: low byte, high byte, 0, 255). */
  readonly cellBytes = new Uint8Array(FLAT_LOOKUP_CELLS * FLAT_LOOKUP_CELLS * 4);
  readonly indexOf = new Map<number, number>();
  site = 0;
  count = 0;
  /** Next cell row to fill; `FLAT_LOOKUP_CELLS` = cells done, then the plot table. */
  row = 0;
  hint = 0;
  done = false;

  reset(site: number): void {
    this.site = site;
    this.count = 0;
    this.row = 0;
    this.hint = site;
    this.done = false;
    this.indexOf.clear();
  }
}

export class DustFlatLookup {
  readonly cellTexture: DataTexture;
  readonly plotTexture: DataTexture;
  /** Mask source for `createRegolithMaterial({ maskSource })`. */
  readonly source: MaskTapSource;

  private live = new LookupTables();
  private spare: LookupTables | null = null;
  private building = false;
  private version = -1;
  private readonly dir = { x: 0, y: 0, z: 1 };
  private readonly loc = { u: 0, v: 0 };

  constructor(
    private readonly grid: IcoPlotGrid,
    private readonly atlas: DustTileAtlas,
    atlasTexture: Texture,
    sitePlot: number,
  ) {
    const cells = FLAT_LOOKUP_CELLS;
    const half = (cells * FLAT_LOOKUP_CELL_M) / 2;
    const px = atlas.layout.slotPx;
    const ts = FRAME_EDGE_MM / px;
    this.live.reset(sitePlot);
    while (!this.fill(this.live, Number.POSITIVE_INFINITY, () => 0)) {
      /* the whole build at once */
    }

    this.cellTexture = new DataTexture(this.live.cellBytes, cells, cells, RGBAFormat, UnsignedByteType);
    this.cellTexture.name = "mc:dust-cells";
    this.plotTexture = new DataTexture(this.live.table, FLAT_LOOKUP_MAX_PLOTS, 2, RGBAFormat, FloatType);
    this.plotTexture.name = "mc:dust-plot-table";
    for (const t of [this.cellTexture, this.plotTexture]) {
      t.colorSpace = NoColorSpace;
      t.minFilter = NearestFilter;
      t.magFilter = NearestFilter;
      t.generateMipmaps = false;
      t.flipY = false;
      t.needsUpdate = true;
    }

    const atlasW = atlasWidth(atlas.layout);
    const atlasH = atlasHeight(atlas.layout);
    const stepM = ts / 1000;
    const cellTexture = this.cellTexture;
    const plotTexture = this.plotTexture;
    /** `level0`: explicit-LOD atlas taps (allowed in non-uniform control flow, e.g. inside a TSL `If`). */
    const buildTaps = (xz: TslNode, level0: boolean): MaskTaps => {
      {
        const cellF: TslNode = xz.add(half).div(FLAT_LOOKUP_CELL_M);
        const inside: TslNode = cellF.x
          .greaterThanEqual(0)
          .and(cellF.x.lessThan(cells))
          .and(cellF.y.greaterThanEqual(0))
          .and(cellF.y.lessThan(cells));
        const cellI: TslNode = clamp(floor(cellF), 0, cells - 1);
        const cell: TslNode = textureLoad(cellTexture, ivec2(cellI));
        const index: TslNode = floor(cell.x.mul(255).add(0.5)).add(floor(cell.y.mul(255).add(0.5)).mul(256));
        const m: TslNode = textureLoad(plotTexture, ivec2(vec2(index, 0)));
        const t: TslNode = textureLoad(plotTexture, ivec2(vec2(index, 1)));
        const tile: TslNode = vec2(m.x.mul(xz.x).add(m.y.mul(xz.y)), m.z.mul(xz.x).add(m.w.mul(xz.y))).add(t.xy);
        const has: TslNode = inside.and(t.z.greaterThanEqual(0));
        const atlasNode: TslNode = texture(atlasTexture);
        const tap = (offset: TslNode | null): TslNode => {
          const p: TslNode = clamp(offset === null ? tile : tile.add(offset), 0.5, px - 0.5);
          // Atlas row r is at v = (r + 0.5) / height on both backends (three flips v itself for a render-target
          // texture on WebGL2; measured, as for the texel fetches of the replay pass).
          const uv: TslNode = vec2(t.z.add(p.x).div(atlasW), t.w.add(p.y).div(atlasH));
          const a: TslNode = level0 ? atlasNode.sample(uv).level(0) : atlasNode.sample(uv);
          // Atlas channels (R dust, G unpolish, A berm) -> mask contract (r grime, g berm, b polish). No tile: dust.
          return select(has, vec4(a.x, a.w, float(1).sub(a.y), 1), vec4(1, 0, 0, 1));
        };
        // One atlas texel along world x and world z, in tile texels.
        const stepX: TslNode = vec2(m.x, m.z).mul(stepM);
        const stepZ: TslNode = vec2(m.y, m.w).mul(stepM);
        return {
          centre: tap(null),
          px: tap(stepX),
          nx: tap(stepX.negate()),
          pz: tap(stepZ),
          nz: tap(stepZ.negate()),
          stepM,
          fetches: FLAT_LOOKUP_FETCHES,
        };
      }
    };
    this.source = {
      textures: [atlasTexture, cellTexture, plotTexture],
      build: (xz: TslNode): MaskTaps => buildTaps(xz, false),
    };
    this.sourceLevel0 = {
      textures: [atlasTexture, cellTexture, plotTexture],
      build: (xz: TslNode): MaskTaps => buildTaps(xz, true),
    };
  }

  /** The same taps with explicit level-0 atlas samples (for use inside a branch, e.g. the terrain's dust layer). */
  readonly sourceLevel0: MaskTapSource;

  /** Site plot of the live tables (world origin). */
  get sitePlot(): number {
    return this.live.site;
  }

  /** Plots in the live table. */
  get plotCount(): number {
    return this.live.count;
  }

  /** A recentre is being built (`stepRecentre`) or waits for `commitRecentre`. */
  get recentring(): boolean {
    return this.building;
  }

  /** Site of the recentre being built (-1: none). */
  get recentreSite(): number {
    return this.building && this.spare !== null ? this.spare.site : -1;
  }

  /** The recentre build has finished; `commitRecentre()` swaps it in. */
  get recentreReady(): boolean {
    return this.building && this.spare !== null && this.spare.done;
  }

  /** Starts building the tables of `site` (spare buffers; the live ones keep serving). No-op while one is building. */
  beginRecentre(site: number): void {
    if (this.building || site === this.live.site) return;
    const spare = (this.spare ??= new LookupTables());
    spare.reset(site);
    this.building = true;
  }

  /** Runs the recentre build for about `budgetMs`; true once it is ready to commit. */
  stepRecentre(budgetMs: number, now: () => number = () => performance.now()): boolean {
    const spare = this.spare;
    if (!this.building || spare === null) return false;
    if (spare.done) return true;
    return this.fill(spare, budgetMs, now);
  }

  /** Swaps the finished spare tables in (one upload of both textures). False when no build is ready. */
  commitRecentre(): boolean {
    const spare = this.spare;
    if (!this.building || spare === null || !spare.done) return false;
    const old = this.live;
    this.live = spare;
    this.spare = old;
    this.building = false;
    this.cellTexture.image.data = this.live.cellBytes;
    this.plotTexture.image.data = this.live.table;
    this.cellTexture.needsUpdate = true;
    this.version = -1;
    this.sync();
    return true;
  }

  /** Abandons a recentre build in flight. */
  cancelRecentre(): void {
    this.building = false;
  }

  /** Call once per frame after `atlas.frame()`: refreshes the slot origins when the slot table changed. */
  sync(): void {
    const atlas = this.atlas;
    if (atlas.version === this.version) return;
    this.version = atlas.version;
    const t = this.live;
    const table = t.table;
    const rowB = FLAT_LOOKUP_MAX_PLOTS * 4;
    const slotOfPlot = atlas.slotOfPlot;
    for (let k = 0; k < t.count; k++) {
      const slot = slotOfPlot[t.plots[k]!]!;
      table[rowB + k * 4 + 2] = slot < 0 ? -1 : atlas.slotX(slot);
      table[rowB + k * 4 + 3] = slot < 0 ? -1 : atlas.slotY(slot);
    }
    this.plotTexture.needsUpdate = true;
  }

  /**
   * CPU twin of the shader lookup: the plot whose tile serves world point (x, z) metres into `out[0]` and the tile
   * texel coordinates into `out[1]`, `out[2]`. False outside the lookup square.
   */
  locate(x: number, z: number, out: Float64Array): boolean {
    const cells = FLAT_LOOKUP_CELLS;
    const half = (cells * FLAT_LOOKUP_CELL_M) / 2;
    const i = Math.floor((x + half) / FLAT_LOOKUP_CELL_M);
    const j = Math.floor((z + half) / FLAT_LOOKUP_CELL_M);
    if (i < 0 || i >= cells || j < 0 || j >= cells) return false;
    const live = this.live;
    const o = (j * cells + i) * 4;
    const k = live.cellBytes[o]! + live.cellBytes[o + 1]! * 256;
    const t = live.table;
    const rowB = FLAT_LOOKUP_MAX_PLOTS * 4;
    out[0] = live.plots[k]!;
    out[1] = t[k * 4]! * x + t[k * 4 + 1]! * z + t[rowB + k * 4]!;
    out[2] = t[k * 4 + 2]! * x + t[k * 4 + 3]! * z + t[rowB + k * 4 + 1]!;
    return true;
  }

  /** Unit direction on the sphere of world point (x, z) metres of the flat patch, into `out[0 .. 2]`. */
  directionAt(x: number, z: number, out: Float64Array): void {
    const o = this.live.site * 3;
    const c = this.grid.centers;
    const e = this.grid.east;
    const t = this.grid.north;
    const r = this.grid.params.radiusM;
    const a = x / r;
    const b = -z / r; // world z = -v (south)
    const dx = c[o]! + a * e[o]! + b * t[o]!;
    const dy = c[o + 1]! + a * e[o + 1]! + b * t[o + 1]!;
    const dz = c[o + 2]! + a * e[o + 2]! + b * t[o + 2]!;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    out[0] = dx / len;
    out[1] = dy / len;
    out[2] = dz / len;
  }

  dispose(): void {
    this.cellTexture.dispose();
    this.plotTexture.dispose();
  }

  /** Fills `t` row by row within the budget, then its plot table; true when complete. */
  private fill(t: LookupTables, budgetMs: number, now: () => number): boolean {
    const grid = this.grid;
    const cells = FLAT_LOOKUP_CELLS;
    const half = (cells * FLAT_LOOKUP_CELL_M) / 2;
    const site = t.site as PlotId;
    const dir = this.dir;
    const t0 = now();
    // Owner plot of every cell centre, as an index into the plot table.
    while (t.row < cells) {
      const j = t.row;
      const z = (j + 0.5) * FLAT_LOOKUP_CELL_M - half;
      for (let i = 0; i < cells; i++) {
        const x = (i + 0.5) * FLAT_LOOKUP_CELL_M - half;
        grid.fromPlotLocal(site, x * 1000, -z * 1000, dir);
        t.hint = grid.plotAt(dir, t.hint as PlotId);
        let k = t.indexOf.get(t.hint);
        if (k === undefined) {
          if (t.count === FLAT_LOOKUP_MAX_PLOTS)
            throw new RangeError("dust flat lookup: more plots than the table holds");
          k = t.count++;
          t.indexOf.set(t.hint, k);
          t.plots[k] = t.hint;
        }
        const o = (j * cells + i) * 4;
        t.cellBytes[o] = k & 255;
        t.cellBytes[o + 1] = k >> 8;
        t.cellBytes[o + 3] = 255;
      }
      t.row++;
      if (t.row < cells && now() - t0 >= budgetMs) return false;
    }
    this.fillPlotTable(t);
    t.done = true;
    return true;
  }

  /** Affine map world metres -> tile texels of each plot, from three points 10 m apart around the plot centre. */
  private fillPlotTable(t: LookupTables): void {
    const grid = this.grid;
    const site = t.site as PlotId;
    const dir = this.dir;
    const loc = this.loc;
    const ts = FRAME_EDGE_MM / this.atlas.layout.slotPx;
    const local = (plot: number, uMm: number, vMm: number, out: number[]): void => {
      grid.fromPlotLocal(site, uMm, vMm, dir);
      grid.toPlotLocal(plot as PlotId, dir, loc);
      out[0] = loc.u;
      out[1] = loc.v;
    };
    const p0 = [0, 0];
    const p1 = [0, 0];
    const p2 = [0, 0];
    const table = t.table;
    const rowB = FLAT_LOOKUP_MAX_PLOTS * 4;
    for (let k = 0; k < t.count; k++) {
      const plot = t.plots[k]!;
      grid.toPlotLocal(site, grid.centerDirection(plot as PlotId), loc);
      const cu = loc.u;
      const cv = loc.v;
      local(plot, cu, cv, p0);
      local(plot, cu + 10_000, cv, p1);
      local(plot, cu, cv + 10_000, p2);
      // Per metre of (u, v); world z = -v, so the z column is negated.
      const a00 = (p1[0]! - p0[0]!) / 10 / ts;
      const a10 = (p1[1]! - p0[1]!) / 10 / ts;
      const a01 = (p2[0]! - p0[0]!) / 10 / ts;
      const a11 = (p2[1]! - p0[1]!) / 10 / ts;
      const cx = cu / 1000;
      const cv1 = cv / 1000;
      table[k * 4] = a00;
      table[k * 4 + 1] = -a01;
      table[k * 4 + 2] = a10;
      table[k * 4 + 3] = -a11;
      table[rowB + k * 4] = (p0[0]! + FRAME_HALF_MM) / ts - (a00 * cx + a01 * cv1);
      table[rowB + k * 4 + 1] = (p0[1]! + FRAME_HALF_MM) / ts - (a10 * cx + a11 * cv1);
      table[rowB + k * 4 + 2] = -1;
      table[rowB + k * 4 + 3] = -1;
    }
  }
}
