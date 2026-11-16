// `?scene=moon` (M1-W2-T01): the whole Moon as the CDLOD terrain on the baked height cube, with the Pilot Fence ring
// 900 m from Outpost Boreal. World frame = the game's (WDS section 1): origin at the moon centre, +Y = Boreal.
// Hosted by the visuals module (sun, cascades, sky and post are the look rig's); this file is the terrain's own scene.
//
//   &view=ground|pad|fence|rim|high|orbit    camera (default ground)
//   &arc=<m>&brg=<deg>&eye=<m>&hdg=<deg>&pitch=<deg>   camera by hand: distance from Boreal along the surface,
//                                             bearing round the pole, height over the ground, heading (0 = away
//                                             from the pole), pitch
//   &fly=p2|p4   camera path (visual-target 6.3): P2 dolly 1 m -> 60 m in 20 s, P4 flyover 300 m at 30 m in 30 s
//   &ft=<s>      freeze the path at this time (captures)
//   &sun=<deg>&az=<deg>   sun elevation / azimuth;  &cull=0  no frustum culling;  &exempt=<m>  shadow-caster margin
//   &site=view|boreal   frame the sun / Earth angles are read in: the view's ground point (default, so `&sun=14` is
//                       14 degrees above the local horizon of the shot) or Outpost Boreal (world axes)
//   &horizon=0  no horizon-map term;  &spec=1  standard material with its specular lobe (A/B of the diffuse default)
//   &skirt=0  no skirts (diagnostic: cracks show the sky);  &cast=0  terrain casts no shadow
//
// `__mcTerrain.info()` reports the selection (nodes per level, culled, triangles, select ms) and the fence zone.

import { Group, Quaternion, Vector3, type Camera, type PerspectiveCamera } from "three/webgpu";
import type { QualitySettings } from "@moon-cleanup/shared";
import { GroundHeight } from "@moon-cleanup/world";
import type { SceneRoots } from "../render";
import { numberParam, type LookScene, type ProbeFn, type SceneContext } from "../visuals/lookdev/scene-base";
import {
  CdlodTerrain,
  createPlainTerrainMaterial,
  createSpecularTerrainMaterial,
  type CdlodQuality,
  type TerrainMaterialFactory,
} from "./cdlod/cdlod-terrain";
import { createHorizonArrayTexture } from "./cdlod/terrain-surface";
import type { HorizonVisibility } from "../visuals/lookdev/terrain-patch";
import type { SiteFrame } from "../visuals/lookdev/scene-base";
import { HeightMinMax } from "./cdlod/min-max";
import { createHeightMipTextures, createHeightTexture } from "./height/height-twin";

/** The render service calls the terrain scene uses (structural: `renderer.holdWarmup()`). */
export interface TerrainRenderHooks {
  holdWarmup(): () => void;
}
import { loadHorizonAsset, loadTerrainAsset, type HorizonAsset, type TerrainAsset } from "./height-asset";
import { borealPilotFence, PilotFenceWatch, type PilotFenceZone } from "./pilot-fence";
import { PilotFenceMarkers } from "./pilot-fence-markers";
import type { DataArrayTexture } from "three/webgpu";

export const MOON_SCENE_ID = "moon";

/** Hook H1 (W2-T04): the visuals module may supply the terrain surface material; absent, the plain material is used. */
export interface TerrainSceneOptions {
  readonly terrainMaterial?: TerrainMaterialFactory;
}

/** The supplied factory wins; else `&spec=1` picks the specular A/B material; else the plain diffuse default. */
export function selectTerrainMaterial(
  supplied: TerrainMaterialFactory | undefined,
  params: URLSearchParams,
): TerrainMaterialFactory {
  if (supplied !== undefined) return supplied;
  return params.get("spec") === "1" ? createSpecularTerrainMaterial : createPlainTerrainMaterial;
}

interface View {
  /** Distance from Boreal along the surface, bearing round the pole, height over the ground, heading, pitch. */
  readonly arcM: number;
  readonly bearingDeg: number;
  readonly eyeM: number;
  readonly headingDeg: number;
  readonly pitchDeg: number;
}

const VIEWS: Readonly<Record<string, View>> = {
  ground: { arcM: 150, bearingDeg: 30, eyeM: 1.7, headingDeg: 0, pitchDeg: -4 },
  pad: { arcM: 95, bearingDeg: 200, eyeM: 1.7, headingDeg: 180, pitchDeg: -3 },
  fence: { arcM: 868, bearingDeg: 30, eyeM: 1.7, headingDeg: 12, pitchDeg: -2 },
  rim: { arcM: 300, bearingDeg: 30, eyeM: 30, headingDeg: 0, pitchDeg: -12 },
  high: { arcM: 100, bearingDeg: 30, eyeM: 60, headingDeg: 0, pitchDeg: -35 },
};
const ORBIT_VIEW = "orbit";
const SELECT_SAMPLES = 240;

export interface TerrainSceneInfo {
  readonly ready: boolean;
  readonly error: string | null;
  readonly nodes: number;
  readonly perLevel: number[];
  readonly triangles: number;
  readonly visited: number;
  readonly culledHorizon: number;
  readonly culledFrustum: number;
  readonly overflow: number;
  /** Horizon-map term: asked for by the preset / URL, switched on (map loaded), bytes on the GPU, load times. */
  readonly horizon: {
    readonly wanted: boolean;
    readonly on: boolean;
    readonly bytes: number;
    readonly fetchMs: number;
    readonly decodeMs: number;
  };
  /** Local vertical of the frame the sun / Earth angles are read in. */
  readonly siteUp: number[];
  /** Terrain instances drawn into the shadow cascades (sum, and per cascade). */
  readonly shadowInstances: number;
  readonly shadowPerCascade: number[];
  /** Caster nodes dropped per cascade because the instance buffer was full (must be 0). */
  readonly casterOverflow: number[];
  /** Camera cuts that made the main mesh cast for two frames (stale cascade boxes). */
  readonly cuts: number;
  /** Warm-up hold still out. */
  readonly warmupHeld: boolean;
  /** CPU time of the per-cascade caster selection (all cascades), ms. */
  readonly casterSelectMs: { readonly p50: number; readonly p95: number; readonly max: number; readonly n: number };
  readonly selectMs: { readonly p50: number; readonly p95: number; readonly max: number; readonly n: number };
  readonly heightTextureBytes: number;
  readonly minMaxBytes: number;
  readonly asset: { readonly file: string; readonly fetchMs: number; readonly decodeMs: number } | null;
  readonly fence: { readonly zone: PilotFenceZone; readonly distanceToFenceM: number; readonly posts: number };
  readonly cameraAltitudeM: number;
}

export class TerrainScene implements LookScene {
  readonly id = MOON_SCENE_ID;
  readonly views = [...Object.keys(VIEWS), ORBIT_VIEW];
  readonly probes: Record<string, ProbeFn> = {};
  ready = false;
  error: string | null = null;

  private readonly roots: SceneRoots;
  private readonly params: URLSearchParams;
  private readonly group = new Group();
  private quality: CdlodQuality;
  private asset: TerrainAsset | null = null;
  private ground: GroundHeight | null = null;
  private minMax: HeightMinMax | null = null;
  private heightTexture: DataArrayTexture | null = null;
  private terrain: CdlodTerrain | null = null;
  private fence: PilotFenceMarkers | null = null;
  private watch: PilotFenceWatch | null = null;
  private view: string;
  private readonly fly: string;
  private flyFixedS: number | null;
  private flyStartS = -1;
  private disposed = false;
  private castOff = false;
  private readonly percascadeOff: boolean;
  private releaseWarmup: (() => void) | null;
  /** Frames drawn with the terrain and its casters in the scene (releases the warm-up hold after a few). */
  private shownFrames = 0;
  private shownAtMs = 0;
  private heightMips: DataArrayTexture[] | null = null;
  private readonly casterMs = new Float32Array(SELECT_SAMPLES);
  private casterN = 0;
  /** Frame the look rig reads the sun / Earth angles in (`LookScene.siteFrame`). */
  readonly siteFrame: SiteFrame = { x: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
  private readonly siteAtView: boolean;
  private horizonWanted: boolean;
  private horizonAsset: HorizonAsset | null = null;
  private horizonTextures: [DataArrayTexture, DataArrayTexture] | null = null;
  private horizonLoading = false;
  private readonly baseUrl: string;
  private readonly _q = new Quaternion();
  private readonly selectMs = new Float32Array(SELECT_SAMPLES);
  private selectN = 0;
  private readonly _dir = new Vector3();
  private readonly _t1 = new Vector3();
  private readonly _t2 = new Vector3();
  private readonly _f = new Vector3();
  private readonly _target = new Vector3();

  private readonly terrainMaterial: TerrainMaterialFactory | undefined;

  constructor(ctx: SceneContext & TerrainSceneOptions & { readonly render?: TerrainRenderHooks }) {
    const { roots, params, state } = ctx;
    this.roots = roots;
    this.terrainMaterial = ctx.terrainMaterial;
    this.params = params;
    // The warm-up must not end before the baked terrain and its casters are on screen (W2-T03 hand-off: WebGL2 built
    // 8 pipelines after warm-up without this).
    this.releaseWarmup = ctx.render?.holdWarmup() ?? null;
    this.percascadeOff = params.get("percascade") === "0";
    this.group.name = "mc:moon";
    roots.world.add(this.group);
    this.quality = ctx.quality?.terrain ?? { cdlodLeafLevel: 8, cdlodPatchVerts: 17, cdlodRangeMult: 1 };
    this.siteAtView = (params.get("site") ?? "view").toLowerCase() !== "boreal";
    this.horizonWanted = (ctx.quality?.shadows.horizonMap ?? true) && params.get("horizon") !== "0";

    state.sunElevationDeg = numberParam(params, "sun", 14);
    state.sunAzimuthDeg = numberParam(params, "az", 215);
    state.earthElevationDeg = numberParam(params, "earthEl", 16);
    state.earthAzimuthDeg = numberParam(params, "earthAz", 62);
    state.sunRateDegPerS = numberParam(params, "rate", 0);

    this.view = (params.get("view") ?? "ground").toLowerCase();
    this.fly = (params.get("fly") ?? "").toLowerCase();
    const ft = params.get("ft");
    this.flyFixedS = ft === null || ft.trim() === "" ? null : Number(ft);

    (globalThis as unknown as Record<string, unknown>)["__mcTerrain"] = {
      info: (): TerrainSceneInfo => this.info(),
      setView: (name: string): void => {
        this.setView(name);
      },
      /** Freezes the `&fly=` path at `seconds` (`null` = run it again): motion captures step it frame by frame. */
      setFlyTime: (seconds: number | null): void => {
        this.flyFixedS = seconds;
      },
    };

    const baseUrl = params.get("terrainUrl") ?? "/assets/terrain/";
    this.baseUrl = baseUrl;
    loadTerrainAsset({ baseUrl }).then(
      (asset) => {
        if (this.disposed) return;
        try {
          this.build(asset);
        } catch (e) {
          // Never leave the warm-up hold out on a failed build.
          this.error = String(e);
          console.error("[terrain] build failed", e);
          this.release();
        }
      },
      (e: unknown) => {
        this.error = String(e);
        console.error("[terrain] load failed", e);
        this.release();
      },
    );
  }

  private release(): void {
    this.releaseWarmup?.();
    this.releaseWarmup = null;
  }

  private build(asset: TerrainAsset): void {
    this.asset = asset;
    this.ground = new GroundHeight(asset.cube, { radiusM: asset.radiusM, pads: asset.pads });
    this.minMax = new HeightMinMax(asset.cube);
    this.heightTexture = createHeightTexture(asset.cube);
    if (this.params.get("farn") !== "0") this.heightMips = createHeightMipTextures(asset.cube);
    this.rebuildTerrain();
    const ground = this.ground;
    const spec = borealPilotFence(asset.radiusM);
    this.fence = new PilotFenceMarkers({ spec, heightAt: (x, y, z) => ground.heightAtXYZ(x, y, z) });
    this.group.add(this.fence.mesh);
    this.watch = new PilotFenceWatch(spec);
    this.ready = true;
    this.setView(this.view);
    this.loadHorizon();
  }

  /** Far-occluder term of the terrain for the look rig (`LookScene.horizon`): it writes the key direction into it. */
  get horizon(): HorizonVisibility | null {
    return (this.terrain?.surface.horizon ?? null) as HorizonVisibility | null;
  }

  /** Fetches the horizon map once (7 MB) after the terrain is up; the term stays off until it is there. */
  private loadHorizon(): void {
    if (!this.horizonWanted || this.horizonLoading || this.horizonAsset !== null) return;
    this.horizonLoading = true;
    loadHorizonAsset({ baseUrl: this.baseUrl }).then(
      (asset) => {
        this.horizonLoading = false;
        if (this.disposed) return;
        this.horizonAsset = asset;
        this.horizonTextures = [
          createHorizonArrayTexture(asset.a, asset.faceSize, "mc:horizon-map-a"),
          createHorizonArrayTexture(asset.b, asset.faceSize, "mc:horizon-map-b"),
        ];
        this.applyHorizon();
      },
      (e: unknown) => {
        this.horizonLoading = false;
        console.error("[terrain] horizon map load failed", e);
      },
    );
  }

  private applyHorizon(): void {
    const term = this.terrain?.surface.horizon ?? null;
    const asset = this.horizonAsset;
    const textures = this.horizonTextures;
    if (term === null || asset === null || textures === null) return;
    if (this.horizonWanted) term.setTextures(textures[0], textures[1], asset.minAngleDeg, asset.maxAngleDeg);
    else term.enabled.value = 0;
  }

  /** Site frame at a point `arcM` from Boreal at `bearingDeg`: Boreal's axes carried there along the great circle. */
  private siteAt(arcM: number, bearingDeg: number): void {
    const site = this.siteFrame;
    const radius = this.ground?.radiusM ?? 2000;
    if (!this.siteAtView || arcM <= 0) {
      site.x.set(1, 0, 0);
      site.up.set(0, 1, 0);
      site.z.set(0, 0, 1);
      return;
    }
    const theta = arcM / radius;
    const phi = (bearingDeg * Math.PI) / 180;
    site.up.set(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    const q = this._q.setFromUnitVectors(this._t1.set(0, 1, 0), site.up);
    site.x.set(1, 0, 0).applyQuaternion(q);
    site.z.set(0, 0, 1).applyQuaternion(q);
  }

  private rebuildTerrain(): void {
    const { asset, ground, minMax, heightTexture } = this;
    if (asset === null || ground === null || minMax === null || heightTexture === null) return;
    this.terrain?.dispose();
    // Cost A/B knobs (diagnostics): `&pverts=17|33|65` patch vertices, `&leafrange=<m>` leaf LOD range, `&detail=0` no
    // procedural detail in the vertex stage, `&normtaps=20` the old 20-tap base normal.
    const p = this.params;
    const pverts = Number(p.get("pverts"));
    const quality: CdlodQuality =
      pverts === 17 || pverts === 33 || pverts === 65 ? { ...this.quality, cdlodPatchVerts: pverts } : this.quality;
    const leafRange = Number(p.get("leafrange"));
    const terrain = new CdlodTerrain(
      {
        cube: asset.cube,
        radiusM: asset.radiusM,
        pads: asset.pads,
        quality,
        ...(leafRange > 0 ? { leafRangeM: leafRange } : {}),
        ...(p.get("detail") === "0" ? { detail: null } : {}),
        heightAt: (x, y, z) => ground.heightAtXYZ(x, y, z),
        minMax,
        heightTexture,
        ...(this.heightMips === null ? {} : { heightMips: this.heightMips }),
        farNormals: this.params.get("farn") !== "0",
        ...(p.get("normtaps") === "20" ? { baseNormalTaps: 20 as const } : {}),
      },
      selectTerrainMaterial(this.terrainMaterial, this.params),
    );
    terrain.view.frustumCull = this.params.get("cull") !== "0";
    // `&exempt=<m>`: main-view frustum exemption while per-cascade casters cast (default 2 m, review F1).
    terrain.frustumExemptM = numberParam(this.params, "exempt", terrain.frustumExemptM);
    // Diagnostics: `&skirt=0` removes the skirts (cracks show the sky), `&cast=0` stops the terrain casting shadows.
    terrain.surface.uniforms.skirtScale.value = numberParam(this.params, "skirt", 1);
    terrain.hidden = this.params.get("terrain") === "0"; // A/B: the frame without the terrain draw
    this.castOff = this.params.get("cast") === "0";
    const sdrop = this.params.get("sdrop");
    if (sdrop !== null) terrain.casterDropM = Number(sdrop);
    const sdf = this.params.get("sdf");
    terrain.shadowDetailFloorM = sdf === null ? null : Number(sdf);
    if (this.castOff) terrain.updateShadowCascades([], [], 0);
    this.group.add(terrain.mesh);
    this.terrain = terrain;
    this.selectN = 0;
    this.applyHorizon();
  }

  applyQuality(settings: QualitySettings): void {
    const horizonWanted = settings.shadows.horizonMap && this.params.get("horizon") !== "0";
    if (horizonWanted !== this.horizonWanted) {
      this.horizonWanted = horizonWanted;
      this.applyHorizon();
      if (this.ready) this.loadHorizon();
    }
    const q = settings.terrain;
    const now = this.quality;
    if (
      q.cdlodLeafLevel === now.cdlodLeafLevel &&
      q.cdlodPatchVerts === now.cdlodPatchVerts &&
      q.cdlodRangeMult === now.cdlodRangeMult
    ) {
      return;
    }
    this.quality = q;
    this.rebuildTerrain();
  }

  setView(name: string): void {
    this.view = name;
    this.terrain?.invalidate();
    const camera = this.roots.camera;
    const ground = this.ground;
    if (ground === null) return;
    if (name === ORBIT_VIEW) {
      const r = ground.radiusM * numberParam(this.params, "orbit", 3.2);
      camera.up.set(0, 1, 0);
      camera.position.set(0.52, 0.72, 0.46).normalize().multiplyScalar(r);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      this.siteAt(0, 0);
      return;
    }
    const base = VIEWS[name] ?? VIEWS["ground"]!;
    const p = this.params;
    this.siteAt(numberParam(p, "arc", base.arcM), numberParam(p, "brg", base.bearingDeg));
    this.pose(
      camera,
      numberParam(p, "arc", base.arcM),
      numberParam(p, "brg", base.bearingDeg),
      numberParam(p, "eye", base.eyeM),
      numberParam(p, "hdg", base.headingDeg),
      numberParam(p, "pitch", base.pitchDeg),
      null,
    );
  }

  /** Places the camera `eyeM` over the ground (or at `radiusM` from the centre when given). */
  private pose(
    camera: PerspectiveCamera,
    arcM: number,
    bearingDeg: number,
    eyeM: number,
    headingDeg: number,
    pitchDeg: number,
    radiusM: number | null,
  ): void {
    const ground = this.ground;
    if (ground === null) return;
    const theta = arcM / ground.radiusM;
    const phi = (bearingDeg * Math.PI) / 180;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    const dir = this._dir.set(st * Math.cos(phi), ct, st * Math.sin(phi));
    // t1: away from the pole along the surface; t2: increasing bearing.
    const t1 = this._t1.set(ct * Math.cos(phi), -st, ct * Math.sin(phi));
    const t2 = this._t2.set(-Math.sin(phi), 0, Math.cos(phi));
    const h = (headingDeg * Math.PI) / 180;
    const pt = (pitchDeg * Math.PI) / 180;
    const f = this._f
      .copy(t1)
      .multiplyScalar(Math.cos(h) * Math.cos(pt))
      .addScaledVector(t2, Math.sin(h) * Math.cos(pt))
      .addScaledVector(dir, Math.sin(pt));
    const r = radiusM ?? ground.radiusM + ground.heightAtXYZ(dir.x, dir.y, dir.z) + eyeM;
    camera.up.copy(dir);
    camera.position.copy(dir).multiplyScalar(r);
    camera.lookAt(this._target.copy(camera.position).add(f));
    camera.updateMatrixWorld();
  }

  update(_dtS: number, timeS: number): void {
    const terrain = this.terrain;
    const ground = this.ground;
    if (terrain === null || ground === null) return;
    const camera = this.roots.camera;

    if (this.fly === "p2" || this.fly === "p4") {
      if (this.flyStartS < 0) {
        this.flyStartS = timeS;
        // The whole path is lit in the frame of its start point.
        this.siteAt(this.fly === "p2" ? 200 : 150, 30);
      }
      const duration = this.fly === "p2" ? 20 : 30;
      const ts = this.flyFixedS ?? (timeS - this.flyStartS) % (duration + 2);
      const k = Math.min(1, Math.max(0, ts / duration));
      if (this.fly === "p2") {
        // Dolly out from 1 m above the ground to 60 m, looking down at the same spot.
        this.pose(camera, 200, 30, 1 + 59 * k, 0, -55, null);
      } else {
        // Straight line 300 m long at 30 m over the start point's ground (constant radius: no bobbing).
        const theta = 150 / ground.radiusM;
        const phi = Math.PI / 6;
        const h0 = ground.heightAtXYZ(
          Math.sin(theta) * Math.cos(phi),
          Math.cos(theta),
          Math.sin(theta) * Math.sin(phi),
        );
        this.pose(camera, 150 + 300 * k, 30, 0, 0, -12, ground.radiusM + h0 + 30);
      }
    }

    const t0 = performance.now();
    terrain.update(camera);
    this.selectMs[this.selectN % SELECT_SAMPLES] = performance.now() - t0;
    this.selectN++;
    // Warm-up hold: released once the terrain, the fence and (when cascades cast) the casters, created on the first
    // cascade update after the build, have been drawn: after 3 frames or 1.5 s, whichever comes first (early frames
    // take seconds each on software GL; the warm-up itself then waits for the pipeline count to stand still).
    if (this.releaseWarmup !== null) {
      if (this.shownFrames === 0) this.shownAtMs = performance.now();
      this.shownFrames++;
      if (this.shownFrames >= 3 || performance.now() - this.shownAtMs >= 1500) this.release();
    }

    const p = camera.position;
    this.watch?.update(p.x, p.y, p.z);
  }

  updateShadowCascades(cameras: readonly Camera[], endsM: readonly number[], layerBase: number): void {
    const terrain = this.terrain;
    if (terrain === null) return;
    if (!this.percascadeOff) {
      // `&percascade=0` A/B: the main mesh casts into every cascade.
      const t0 = performance.now();
      terrain.updateShadowCascades(this.castOff ? [] : cameras, endsM, layerBase);
      this.casterMs[this.casterN % SELECT_SAMPLES] = performance.now() - t0;
      this.casterN++;
    }
  }

  info(): TerrainSceneInfo {
    const terrain = this.terrain;
    const quantiles = (samples: Float32Array, count: number) => {
      const n = Math.min(count, SELECT_SAMPLES);
      const s = Float32Array.from(samples.subarray(0, n)).sort();
      const q = (f: number): number => (n === 0 ? 0 : s[Math.min(n - 1, Math.floor(n * f))]!);
      return { p50: q(0.5), p95: q(0.95), max: q(1), n };
    };
    const stats = terrain?.selector.stats;
    const camera = this.roots.camera.position;
    const ground = this.ground;
    const len = camera.length();
    return {
      ready: this.ready,
      error: this.error,
      nodes: terrain?.selector.count ?? 0,
      perLevel: stats === undefined ? [] : Array.from(stats.perLevel),
      triangles: terrain?.triangles ?? 0,
      visited: stats?.visited ?? 0,
      culledHorizon: stats?.culledHorizon ?? 0,
      culledFrustum: stats?.culledFrustum ?? 0,
      overflow: stats?.overflow ?? 0,
      horizon: {
        wanted: this.horizonWanted,
        on: (terrain?.surface.horizon?.enabled.value ?? 0) > 0,
        bytes: this.horizonAsset === null ? 0 : this.horizonAsset.a.byteLength + this.horizonAsset.b.byteLength,
        fetchMs: this.horizonAsset?.fetchMs ?? 0,
        decodeMs: this.horizonAsset?.decodeMs ?? 0,
      },
      siteUp: [this.siteFrame.up.x, this.siteFrame.up.y, this.siteFrame.up.z],
      shadowInstances: terrain?.shadowInstances ?? 0,
      shadowPerCascade: terrain === null ? [] : [0, 1, 2, 3].map((k) => terrain.cascadeInstances(k)),
      casterOverflow: terrain === null ? [] : [0, 1, 2, 3].map((k) => terrain.cascadeOverflow(k)),
      cuts: terrain?.cuts ?? 0,
      warmupHeld: this.releaseWarmup !== null,
      casterSelectMs: quantiles(this.casterMs, this.casterN),
      selectMs: quantiles(this.selectMs, this.selectN),
      heightTextureBytes: this.asset === null ? 0 : this.asset.cube.data.byteLength,
      minMaxBytes: this.minMax?.byteLength ?? 0,
      asset:
        this.asset === null
          ? null
          : { file: this.asset.file, fetchMs: this.asset.fetchMs, decodeMs: this.asset.decodeMs },
      fence: {
        zone: this.watch?.report.zone ?? "inside",
        distanceToFenceM: this.watch?.report.distanceToFenceM ?? 0,
        posts: this.fence?.count ?? 0,
      },
      cameraAltitudeM:
        ground === null || len === 0
          ? 0
          : len - ground.radiusM - ground.heightAtXYZ(camera.x / len, camera.y / len, camera.z / len),
    };
  }

  dispose(): void {
    this.disposed = true;
    this.release();
    this.group.removeFromParent();
    for (const mip of this.heightMips ?? []) mip.dispose();
    this.heightMips = null;
    this.terrain?.dispose();
    this.terrain = null;
    this.fence?.dispose();
    this.fence = null;
    this.heightTexture?.dispose();
    this.heightTexture = null;
    for (const tex of this.horizonTextures ?? []) tex.dispose();
    this.horizonTextures = null;
    delete (globalThis as unknown as Record<string, unknown>)["__mcTerrain"];
  }
}
