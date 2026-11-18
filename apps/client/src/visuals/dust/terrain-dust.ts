// The dust layer on the CDLOD moon terrain (M1-W3-T05 round 3, the terrain game): the same atlas, GPU stroke replay and
// flat-lookup tables as the dust worksite, read from the terrain's regolith through a `RegolithLayer`.
//
// Sphere -> plot: the fragment is projected gnomonically onto the tangent plane of the lookup's site plot, which is
// exactly how the lookup tables were built (`fromPlotLocal(site, x, -z)`), so the flat lookup serves the curved ground.
// With D = fragment - S (S = R n, the site centre on the sphere; D from the camera-relative `local` plus one CPU-double
// uniform, so it stays precise): u = R (D.e) / (R + D.n), v = R (D.t) / (R + D.n), lookup (x, z) = (u, -v).
//
// Cost: past the lookup square (+-112 m around the site, which follows the player) a fragment pays the projection and
// one compare; inside, the 8 lookup fetches run in a branch (explicit level-0 atlas taps). The site moves with the player
// in 1 ms build slices; render space does not move (moon-centred), so a move is invisible.

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

import { Fn, If, dot, float, length, max, min, select, smoothstep, uniform, vec2, vec4 } from "three/tsl";
import { Vector3, type Camera, type WebGPURenderer } from "three/webgpu";
import type { PlotId } from "@moon-cleanup/shared";
import type { IcoPlotGrid } from "@moon-cleanup/world";
import {
  BERM_HEIGHT_MAX_M,
  DUST_LAYER_DEPTH_M,
  THIN_BASE,
  THIN_SLOPE,
  TAU_BASE,
} from "../materials/regolith-constants";
import type { RegolithLayer, RegolithLayerContext } from "../materials/terrain-regolith";
import { DustLayer } from "./dust-layer";
import type { DustFeedPort } from "./dust-worksite";
import { FLAT_LOOKUP_CELLS, FLAT_LOOKUP_CELL_M, DustFlatLookup } from "./flat-lookup";
import { DUST_TILE_PRESETS } from "./tile-atlas";

/** Re-centre once the avatar is this far (m along the ground) from the lookup's site. */
export const TERRAIN_DUST_RECENTRE_M = 40;
const BUILD_BUDGET_MS = 1;
/** Half the lookup square (m): fragments outside skip the lookup (untouched dust). */
const LOOKUP_HALF_M = (FLAT_LOOKUP_CELLS * FLAT_LOOKUP_CELL_M) / 2;

type TilePreset = keyof typeof DUST_TILE_PRESETS;

export class TerrainDustGround {
  readonly layer: DustLayer;
  readonly lookup: DustFlatLookup;
  readonly tilePreset: TilePreset;
  /** Site moves committed. */
  recentres = 0;
  private readonly radiusM: number;
  private readonly siteN = uniform(new Vector3(0, 1, 0));
  private readonly siteE = uniform(new Vector3(1, 0, 0));
  private readonly siteT = uniform(new Vector3(0, 0, 1));
  /** Camera position minus the site centre S (world axes, metres); computed in doubles each frame. */
  private readonly camToSite = uniform(new Vector3());
  /** Site centre S in doubles. */
  private readonly s = new Float64Array(3);
  private readonly cam = { x: 0, y: 1, z: 0 };
  private readonly avatarPos = { x: 0, y: 1, z: 0 };

  constructor(
    readonly feed: DustFeedPort,
    tilePreset: TilePreset,
  ) {
    this.tilePreset = tilePreset;
    this.radiusM = feed.grid.params.radiusM;
    this.layer = DustLayer.create(feed.grid, feed.ledger, DUST_TILE_PRESETS[tilePreset]);
    this.lookup = new DustFlatLookup(feed.grid, this.layer.atlas, this.layer.pass.texture, feed.sitePlot);
    this.setSite(feed.sitePlot);
    feed.bind(this.layer.atlas);
  }

  /** The regolith layer (dust thickness + berm relief) for `TerrainRegolithOptions.layers`. */
  readonly regolithLayer: RegolithLayer = (ctx: RegolithLayerContext) => {
    const R = this.radiusM;
    const D: TslNode = this.camToSite.add(ctx.local);
    const facing: TslNode = float(R).add(dot(D, this.siteN));
    const denom: TslNode = max(facing, 1);
    const k: TslNode = float(R).div(denom);
    const u: TslNode = dot(D, this.siteE).mul(k);
    const v: TslNode = dot(D, this.siteT).mul(k);
    const xz: TslNode = vec2(u, v.negate());
    const inside: TslNode = facing
      .greaterThan(0)
      .and(u.abs().lessThan(LOOKUP_HALF_M))
      .and(v.abs().lessThan(LOOKUP_HALF_M));
    const source = this.lookup.sourceLevel0;
    // vec4(remaining, dH/dx, dH/dz, polish); outside the square: untouched dust, flat.
    const mask: TslNode = Fn(() => {
      const p = xz.toVar();
      const result = vec4(1, 0, 0, 0).toVar();
      If(inside, () => {
        const taps = source.build(p);
        const h = (tap: TslNode): TslNode => tap.r.mul(DUST_LAYER_DEPTH_M).add(tap.g.mul(BERM_HEIGHT_MAX_M * 1.6));
        const step2: TslNode = float(taps.stepM * 2);
        result.assign(
          vec4(
            taps.centre.r,
            h(taps.px).sub(h(taps.nx)).div(step2),
            h(taps.pz).sub(h(taps.nz)).div(step2),
            taps.centre.b,
          ),
        );
      });
      return result;
    })();
    const remaining: TslNode = mask.x;
    // Thin partial removal reads as a thinner layer; below the threshold the ground is clean (flat regolith's rule,
    // without its sub-pixel relief term).
    const presence: TslNode = smoothstep(TAU_BASE * 0.5, TAU_BASE * 1.5, remaining);
    const thickness: TslNode = presence.mul(remaining.mul(THIN_SLOPE).add(THIN_BASE));
    // Lookup gradient (along e and -t) -> world gradient -> the regolith's projection-plane slope.
    const slopeLookup: TslNode = vec2(mask.y, mask.z);
    const len: TslNode = max(length(slopeLookup), 1e-5);
    const capped: TslNode = slopeLookup.mul(min(float(1), float(1.6).div(len)));
    const g: TslNode = this.siteE.mul(capped.x).sub(this.siteT.mul(capped.y));
    const w: TslNode = ctx.world.abs();
    const onY: TslNode = w.y.greaterThanEqual(w.x).and(w.y.greaterThanEqual(w.z));
    const onX: TslNode = w.x.greaterThanEqual(w.z);
    const slope: TslNode = select(onY, vec2(g.x, g.z), select(onX, vec2(g.z, g.y), vec2(g.x, g.y)));
    // Polished plots read slightly brighter.
    const albedo: TslNode = float(1).add(mask.w.mul(0.06));
    return {
      thickness,
      slope,
      albedo,
      fetches: 8,
      textures: source.textures,
    };
  };

  /** Once per rendered frame before the main render (camera already placed by the game's rig). */
  preRender(renderer: WebGPURenderer, camera: Camera): void {
    const feed = this.feed;
    feed.pump();
    this.follow();
    this.layer.update(this.cam.x, this.cam.y, this.cam.z, renderer);
    this.lookup.sync();
    const p = camera.position;
    const s = this.s;
    this.camToSite.value.set(p.x - s[0]!, p.y - s[1]!, p.z - s[2]!);
  }

  bindRenderer(renderer: WebGPURenderer): void {
    this.layer.bind(renderer);
  }

  dispose(): void {
    this.feed.bind(null);
    this.lookup.dispose();
    this.layer.dispose();
  }

  /** Residency on the avatar; past TERRAIN_DUST_RECENTRE_M the avatar's plot is built in slices and swapped in. */
  private follow(): void {
    const follow = this.feed.follow;
    if (follow === undefined || follow === null) return;
    const lookup = this.lookup;
    const p = this.avatarPos;
    if (!follow.avatar(p)) return;
    const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    if (!(len > 0)) return;
    const cam = this.cam;
    cam.x = p.x / len;
    cam.y = p.y / len;
    cam.z = p.z / len;
    if (lookup.recentring) {
      if (lookup.stepRecentre(BUILD_BUDGET_MS)) {
        const site = lookup.recentreSite;
        lookup.commitRecentre();
        this.setSite(site);
        this.recentres++;
      }
      return;
    }
    const grid = this.feed.grid;
    const c = grid.centers;
    const o = lookup.sitePlot * 3;
    const d = cam.x * c[o]! + cam.y * c[o + 1]! + cam.z * c[o + 2]!;
    const distM = Math.acos(d > 1 ? 1 : d) * this.radiusM;
    if (distM > TERRAIN_DUST_RECENTRE_M) lookup.beginRecentre(grid.plotAt(cam, lookup.sitePlot as PlotId));
  }

  /** Exact grid axes: finite differences introduce a radial component and shift narrow clean paths. */
  private setSite(site: number): void {
    const grid = this.feed.grid;
    const o = site * 3;
    this.siteN.value.fromArray(grid.centers, o);
    this.siteE.value.fromArray(grid.east, o);
    this.siteT.value.fromArray(grid.north, o);
    this.s[0] = grid.centers[o]! * this.radiusM;
    this.s[1] = grid.centers[o + 1]! * this.radiusM;
    this.s[2] = grid.centers[o + 2]! * this.radiusM;
  }
}

/** CPU twin of the shader projection for verifying sphere/lookup registration, including height above the sphere. */
export function projectTerrainDustPoint(grid: IcoPlotGrid, site: number, world: readonly number[]): [number, number] {
  const o = site * 3;
  const R = grid.params.radiusM;
  const dotAxis = (axis: Float64Array): number =>
    world[0]! * axis[o]! + world[1]! * axis[o + 1]! + world[2]! * axis[o + 2]!;
  const k = R / Math.max(dotAxis(grid.centers), 1);
  return [dotAxis(grid.east) * k, -dotAxis(grid.north) * k];
}
