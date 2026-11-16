// The production regolith as the moon terrain's material (M1-W2-T04), handed to `TerrainScene` through its material
// hook (H1, `terrainMaterial`). One provider per moon scene: it owns the shared detail tile and every regolith built
// for a terrain rebuild (preset change), and disposes them with the scene.
//
// URL knobs: `&regolith=0` keeps the plain material (A/B: the provider then supplies no factory), `&rgdebug=1..4` debug
// views, `&rgsingle=1` one tap per close scale (the Low preset path), `&rganiso=<n>` anisotropy of the tile,
// `&rgcost=<list>` cost splits (A/B only, see `RegolithCostSplit`).

import type { Mesh, NodeMaterial, Object3D, Texture } from "three/webgpu";
import { createDetailTexture } from "./regolith-material";
import { TERRAIN_DETAIL_ANISOTROPY } from "./terrain-regolith-constants";
import {
  createTerrainRegolithMaterial,
  type RegolithCostSplit,
  type RegolithSurfaceHooks,
  type TerrainRegolith,
  type TerrainRegolithOptions,
} from "./terrain-regolith";

const COST_SPLITS: readonly RegolithCostSplit[] = ["noclose", "nofar", "nobranch", "gradfar", "oldsel", "localvary"];

/** Parses `&rgcost=a,b` into the known cost splits (unknown names are ignored). */
export function parseCostSplits(raw: string | null): readonly RegolithCostSplit[] {
  if (raw === null) return [];
  const names = raw.split(",").map((s) => s.trim().toLowerCase());
  return COST_SPLITS.filter((s) => names.includes(s));
}

export class TerrainRegolithProvider {
  readonly enabled: boolean;
  private readonly options: Omit<TerrainRegolithOptions, "detail">;
  private readonly aniso: number;
  private readonly handles: TerrainRegolith[] = [];
  private detail: Texture | null = null;
  /** Surface of the latest terrain build, and the A/B variants built on it (diagnostics). */
  private lastSurface: RegolithSurfaceHooks | null = null;
  private lastMaterial: NodeMaterial | null = null;
  private readonly variants = new Map<string, NodeMaterial>();

  /** Quality preset at build time (`low` builds one tap per close scale); default: none (two taps). */
  private readonly preset: () => string;

  constructor(params: URLSearchParams, preset: () => string = () => "") {
    this.preset = preset;
    this.enabled = params.get("regolith") !== "0";
    this.aniso = Number(params.get("rganiso") ?? 0);
    const debug = Number(params.get("rgdebug") ?? 0);
    const splits = parseCostSplits(params.get("rgcost"));
    const graze = (params.get("rggraze") ?? "").split(",").map(Number);
    const far = Number(params.get("rgfar") ?? NaN);
    this.options = {
      ...(debug > 0 ? { debugView: debug } : {}),
      ...(params.get("rgsingle") === "1" ? { singleTap: true } : {}),
      ...(splits.length > 0 ? { costSplits: splits } : {}),
      ...(graze.length === 2 && graze.every((v) => Number.isFinite(v) && v > 0) && graze[1]! > graze[0]!
        ? { grazeStretchFar: [graze[0]!, graze[1]!] as const }
        : {}),
      ...(Number.isFinite(far) && far >= 0 ? { farReliefScale: far } : {}),
    };
  }

  /**
   * The terrain material factory for `TerrainScene` (`undefined` with `&regolith=0`, so the terrain keeps its plain
   * material). `applySurface` is the terrain module's `applyTerrainSurface`.
   */
  factory<S extends RegolithSurfaceHooks>(
    applySurface: (material: NodeMaterial, surface: S) => void,
  ): ((surface: S) => NodeMaterial) | undefined {
    if (!this.enabled) return undefined;
    return (surface) => {
      if (surface !== this.lastSurface) {
        for (const m of this.variants.values()) m.dispose();
        this.variants.clear();
        this.lastSurface = surface;
      }
      const { material, regolith } = createTerrainRegolithMaterial(surface, applySurface, {
        ...(this.preset() === "low" ? { singleTap: true } : {}),
        ...this.options,
        detail: this.detailTexture(),
      });
      this.handles.push(regolith);
      this.lastMaterial = material;
      return material;
    };
  }

  /**
   * Cost A/B in one page (`__mcRegolith.swap`, diagnostics only): builds `variant` of the regolith on the latest terrain
   * surface (`plain` = `plainFactory`; else cost splits joined by `,`, or `full`) and returns it, cached per surface.
   */
  variant<S extends RegolithSurfaceHooks>(
    name: string,
    applySurface: (material: NodeMaterial, surface: S) => void,
    plainFactory: (surface: S) => NodeMaterial,
  ): NodeMaterial | null {
    const surface = this.lastSurface as S | null;
    if (surface === null) return null;
    const key = name.toLowerCase();
    const cached = this.variants.get(key);
    if (cached !== undefined) return cached;
    let material: NodeMaterial;
    if (key === "plain") material = plainFactory(surface);
    else {
      const splits = key === "full" ? [] : parseCostSplits(key);
      const { material: m, regolith } = createTerrainRegolithMaterial(surface, applySurface, {
        ...this.options,
        ...(key === "single" ? { singleTap: true } : {}),
        costSplits: splits,
        detail: this.detailTexture(),
      });
      this.handles.push(regolith);
      material = m;
    }
    this.variants.set(key, material);
    return material;
  }

  /**
   * Swaps the terrain mesh under `world` to `variant` (`default` = the material the terrain was built with). Returns
   * false when no terrain mesh wears one of this provider's materials. Diagnostics only (`__mcRegolith.swap`).
   */
  swap<S extends RegolithSurfaceHooks>(
    world: Object3D,
    name: string,
    applySurface: (material: NodeMaterial, surface: S) => void,
    plainFactory: (surface: S) => NodeMaterial,
  ): boolean {
    const ours = new Set<unknown>(this.variants.values());
    if (this.lastMaterial !== null) ours.add(this.lastMaterial);
    let target: Mesh | null = null;
    world.traverse((o) => {
      const mesh = o as Mesh;
      if (target === null && mesh.isMesh === true && ours.has(mesh.material)) target = mesh;
    });
    if (target === null) return false;
    const material = name === "default" ? this.lastMaterial : this.variant(name, applySurface, plainFactory);
    if (material === null) return false;
    (target as Mesh).material = material;
    return true;
  }

  /** Regolith materials built so far (tests / reports). */
  get count(): number {
    return this.handles.length;
  }

  dispose(): void {
    for (const m of this.variants.values()) m.dispose();
    this.variants.clear();
    this.lastSurface = null;
    this.lastMaterial = null;
    for (const h of this.handles) h.dispose();
    this.handles.length = 0;
    this.detail?.dispose();
    this.detail = null;
  }

  private detailTexture(): Texture {
    if (this.detail === null) {
      this.detail = createDetailTexture();
      this.detail.anisotropy = this.aniso > 0 ? this.aniso : TERRAIN_DETAIL_ANISOTROPY;
    }
    return this.detail;
  }
}
