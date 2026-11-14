// Render spike bench scene v0 (M0-W2-T02): `?scene=bench&draws=<200|350|600|900>&preset=<low|medium|high>`.
//
// An MVP-representative scene that gives the EARLY signal on whether three r187 `WebGPURenderer` fits the budget:
// 64 terrain chunks carrying the worst-case terrain shader stub, 2,100 instanced rocks in 4 draws, 16 avatar proxies in
// one `BatchedMesh`, 40 outpost props, sun + `CSMShadowNode` (2 / 3 / 4 cascades by preset), and the full post chain.
// v0 numbers are NOT a verdict (E7 is taken on bench v1, M0-W3-T07, on the real baked height cube).
//
// v1 (M0-W3-T07, default `terrain=real`): the same chunks are displaced from the baked height cube (JS decode), shaded by
// the real regolith material (visuals/materials public API) from a static CPU-filled mask, with per-vertex horizon angles
// feeding the shadow; `terrain=standin` keeps the v0 path (terrain stub + procedural height) for comparison. Loading the
// baked files is asynchronous, so everything that depends on the height (chunks, props, fillers, camera) is built in
// `build()` once the terrain is known; until then `update` does nothing and `__mcBench` is not installed.
//
// The module owns frame timing: `update(frame)` is called by RenderModule right before the pipeline renders.
// No per-frame allocation: scratch vectors, one pose record, in-place matrices.

import { BoxGeometry, Group, Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector3, type Camera } from "three/webgpu";
import { vec4, vec3 } from "three/tsl";
import type { FrameInfo, QualitySettings } from "@moon-cleanup/shared";
import type { RenderFrameStats, RenderRendererService } from "../module";
import type { RenderQualityService } from "../quality-service";
import type { SceneRoots } from "../scene-roots";
import { createRegolithMaterial, type RegolithMaterial } from "../../visuals/materials";
import { BenchContent } from "./bench-assets";
import { BENCH_MASK_RECT, BENCH_MASK_SIZE, createBenchMask, type BenchMask } from "./bench-mask";
import { BenchTextures } from "./bench-textures";
import { benchPathSpec, p1Pose, p3Pose, type PathPose, type PathSpec } from "./camera-paths";
import { DrawCalibrator } from "./draw-calibration";
import { parseBenchOptions, type BenchOptions, type BenchPathId } from "./options";
import { addHorizonAttributes, createHorizonVisibility, type HorizonVisibility } from "./horizon-visibility";
import {
  BENCH_SUN_AZIMUTH_RAD,
  BENCH_SUN_ELEVATION_DEG,
  benchEarthDirection,
  benchSunDirection,
  type LookFactory,
  type LookProvider,
} from "./look";
import { createBenchLook } from "./look-factory";
import { createTerrainStub, type TerrainStub } from "./terrain-material";
import { cubeTexelM, sampleHeight } from "./terrain-cube";
import { MOON_RADIUS_M, groundY, setTerrainHeightSource } from "./terrain-data";
import { TerrainChunks } from "./terrain-chunks";
import { loadBakedTerrain, type LoadedTerrain, type TerrainLoadReport } from "./terrain-loader";

/** Frames rendered before calibration starts (the first ones compile pipelines and shadow pipelines). */
export const BENCH_WARMUP_FRAMES = 8;
/** Filler pool (zero-size draws added to reach `?draws=`). */
export const BENCH_FILLER_POOL = 1600;
export { BENCH_SUN_AZIMUTH_RAD, BENCH_SUN_ELEVATION_DEG };
const ANISOTROPY: Record<QualitySettings["preset"], number> = { low: 4, medium: 8, high: 8, ultra: 16 };

/** What `window.__mcBench` exposes to tools/perf and the harness. */
export interface BenchStats {
  readonly ready: boolean;
  readonly backend: string;
  readonly tier: string;
  readonly preset: string;
  readonly reversedZ: boolean;
  readonly renderScale: number;
  readonly targetDraws: number;
  readonly draws: number;
  readonly triangles: number;
  readonly fillers: number;
  readonly calibrationSteps: number;
  readonly terrainChunks: number;
  /** Where the terrain came from: the baked cube, the v0 stand-in, or the stand-in after a failed load (see `terrainError`). */
  readonly terrainSource: "real" | "standin" | "standin-fallback";
  readonly terrainError: string | null;
  readonly terrainLoad: TerrainLoadReport | null;
  readonly terrainVertices: number;
  readonly terrainFetchesPerFragment: number;
  readonly terrainTextureBindings: number;
  readonly rockInstances: number;
  readonly rockDraws: number;
  readonly avatarProxies: number;
  readonly props: number;
  readonly cascades: number;
  /** Which look drives sun / CSM / sky / post: `visuals` (the game's rig) or `v0` (the original bench chain). */
  readonly look: "visuals" | "v0";
  readonly postPasses: readonly string[];
  /** Per-feature look knobs in effect (`visuals` look only), e.g. `bloom=off skydome=baked shadowfilter=vogel5`. */
  readonly lookKnobs: string;
  /** Programs created since the scene reported `ready` (must stay 0). */
  readonly pipelinesAfterWarmup: number;
  readonly textureBytes: number;
  readonly path: string | null;
  readonly animate: boolean;
  /** Scenes built in this page so far (1 = normal; 2 would be a real in-page double build, see the README). */
  readonly buildsInPage: number;
  /** `performance.timeOrigin` of the page: a change between two reads means the page reloaded (Vite HMR full reload). */
  readonly pageTimeOrigin: number;
}

export interface BenchHooks {
  readonly ready: boolean;
  readonly paths: { readonly p1: PathSpec; readonly p3: PathSpec };
  setPath(id: BenchPathId | null): void;
  setDraws(target: number): void;
  stats(): BenchStats;
}

export interface BenchHookTarget {
  __mcBench?: BenchHooks;
}

export interface BenchSceneOptions {
  readonly roots: SceneRoots;
  readonly renderer: RenderRendererService;
  readonly quality: RenderQualityService;
  readonly search: string;
  readonly log?: (line: string) => void;
  /** Where `__mcBench` is installed. Default: `globalThis`. */
  readonly target?: BenchHookTarget;
  /** Builds the look chosen by `?look=` (default: the visuals rig / the v0 chain). Tests inject a fake. */
  readonly lookFactory?: LookFactory;
}

interface HookAccess {
  isReady(): boolean;
  setPath(id: BenchPathId | null): void;
  setDraws(target: number): void;
  stats(): BenchStats;
}

class HookObject implements BenchHooks {
  constructor(
    readonly paths: { readonly p1: PathSpec; readonly p3: PathSpec },
    private readonly access: HookAccess,
  ) {}
  get ready(): boolean {
    return this.access.isReady();
  }
  setPath(id: BenchPathId | null): void {
    this.access.setPath(id);
  }
  setDraws(target: number): void {
    this.access.setDraws(target);
  }
  stats(): BenchStats {
    return this.access.stats();
  }
}

/** Number of bench scenes that finished `build()` in this page; a dev-server full reload resets it with the page. */
let buildsInPage = 0;
const _sunDir = new Vector3();
const _earthDir = new Vector3();

export class BenchScene {
  readonly options: BenchOptions;

  private readonly roots: SceneRoots;
  private readonly renderer: RenderRendererService;
  private readonly quality: RenderQualityService;
  private readonly log: (line: string) => void;
  private readonly target: BenchHookTarget;
  private readonly look: LookProvider;
  private readonly fillerGroup = new Group();
  private readonly fillers: Mesh[] = [];
  private readonly fillerGeometry = new BoxGeometry(1, 1, 1);
  private readonly pose: PathPose = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
  private readonly frameStats: RenderFrameStats = { drawCalls: 0, triangles: 0 };
  private readonly unsubscribe: (() => void)[] = [];

  // Built by `build()` once the terrain is known.
  private textures: BenchTextures | null = null;
  private stub: TerrainStub | null = null;
  private regolith: RegolithMaterial | null = null;
  private mask: BenchMask | null = null;
  private horizonVisibility: HorizonVisibility | null = null;
  private chunks: TerrainChunks | null = null;
  private content: BenchContent | null = null;
  private probe: { meshes: Mesh[]; geometry: PlaneGeometry; materials: MeshBasicNodeMaterial[] } | null = null;
  private specs: { p1: PathSpec; p3: PathSpec } | null = null;
  private terrainSource: BenchStats["terrainSource"] = "standin";
  private terrainError: string | null = null;
  private terrainLoad: TerrainLoadReport | null = null;
  private terrainVertices = 0;
  private maskBytes = 0;
  private built = false;

  private appliedQuality: QualitySettings | null = null;
  private calibrator: DrawCalibrator;
  private targetDraws: number;
  private path: BenchPathId | null;
  private framesSeen = 0;
  private compiled = false;
  private ready = false;
  private programsAtReady = 0;
  private disposed = false;

  constructor(options: BenchSceneOptions) {
    this.roots = options.roots;
    this.renderer = options.renderer;
    this.quality = options.quality;
    this.log = options.log ?? ((line) => console.info(line));
    this.target = options.target ?? (globalThis as unknown as BenchHookTarget);
    this.options = parseBenchOptions(options.search);
    this.targetDraws = this.options.draws;
    this.path = this.options.path;
    this.calibrator = new DrawCalibrator({ target: this.targetDraws, maxFillers: BENCH_FILLER_POOL });

    // Sun, fill, cascaded shadows, sky and post chain come from the look (`?look=visuals|v0`); the sun stands left of and
    // ahead of the default view.
    benchSunDirection(_sunDir);
    this.look = (options.lookFactory ?? createBenchLook)(this.options.look, {
      roots: this.roots,
      renderer: this.renderer,
      search: options.search,
    });

    if (this.options.terrain === "standin") {
      this.build(null);
      return;
    }
    this.terrainSource = "real";
    this.log(`[bench] loading baked terrain from ${this.options.terrainBase} (cube ${String(this.options.cube)})`);
    loadBakedTerrain({
      baseUrl: this.options.terrainBase,
      cube: this.options.cube,
      horizon: this.options.horizon,
      verify: this.options.verifyTerrain,
    }).then(
      (loaded) => {
        if (!this.disposed) this.build(loaded);
      },
      (error: unknown) => {
        if (this.disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        this.terrainError = message;
        this.terrainSource = "standin-fallback";
        console.error(`[bench] terrain=real could not be loaded (${message}); falling back to the v0 stand-in`);
        this.build(null);
      },
    );
  }

  /** Builds everything that depends on the ground height; `loaded` null = the v0 stand-in terrain. */
  private build(loaded: LoadedTerrain | null): void {
    const settings = this.quality.current;
    const anisotropy = ANISOTROPY[settings.preset];
    let chunks: TerrainChunks;
    if (loaded === null) {
      setTerrainHeightSource(null);
      const textures = new BenchTextures(anisotropy);
      const stub = createTerrainStub(textures, this.options.debugView);
      stub.sunAzimuthRad.value = BENCH_SUN_AZIMUTH_RAD;
      stub.sunElevationDeg.value = BENCH_SUN_ELEVATION_DEG;
      this.textures = textures;
      this.stub = stub;
      chunks = new TerrainChunks(stub.material);
    } else {
      const cube = loaded.height;
      setTerrainHeightSource((x, z) => {
        const len = Math.sqrt(x * x + MOON_RADIUS_M * MOON_RADIUS_M + z * z);
        return sampleHeight(cube, x / len, MOON_RADIUS_M / len, z / len);
      });
      this.terrainLoad = loaded.report;
      const mask = createBenchMask(anisotropy);
      this.mask = mask;
      this.maskBytes = mask.bytes;
      const horizonCube = loaded.horizon;
      const visibility = horizonCube === null ? null : createHorizonVisibility();
      visibility?.keyDirection.value.copy(_sunDir);
      this.horizonVisibility = visibility;
      const regolith = createRegolithMaterial({
        mask: mask.texture,
        maskRect: BENCH_MASK_RECT,
        maskSize: [BENCH_MASK_SIZE, BENCH_MASK_SIZE],
        debugView: this.options.debugView,
        horizonVisibility: visibility === null ? null : visibility.node,
      });
      this.regolith = regolith;
      chunks = new TerrainChunks(regolith.material, {
        normalEpsM: Math.max(0.4, 0.5 * cubeTexelM(cube.faceSize, MOON_RADIUS_M)),
        ...(horizonCube === null ? {} : { decorate: (geometry) => addHorizonAttributes(geometry, horizonCube) }),
      });
    }
    this.chunks = chunks;
    this.terrainVertices = chunks.meshes.reduce((n, m) => n + m.geometry.getAttribute("position").count, 0);
    this.roots.world.add(chunks.group);
    const content = new BenchContent();
    content.addTo(this.roots.world, this.roots.sky);
    // A look with its own sky bodies replaces the bench's stand-in sun disk and Earth.
    content.skyGroup.visible = !this.look.ownsSky;
    this.content = content;

    // Draw-count fillers: a pool of zero-size boxes, shown or hidden by adding to / removing from this group.
    this.fillerGroup.name = "mc:bench-fillers";
    this.roots.world.add(this.fillerGroup);
    for (let i = 0; i < BENCH_FILLER_POOL; i++) {
      const mesh = new Mesh(this.fillerGeometry, content.panelMaterial);
      mesh.name = `mc:bench-filler-${String(i)}`;
      mesh.frustumCulled = false;
      mesh.scale.setScalar(1e-4);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.fillers.push(mesh);
    }

    this.probe = this.options.zFightProbe ? this.buildZFightProbe() : null;

    this.specs = { p1: benchPathSpec("p1", groundY), p3: benchPathSpec("p3", groundY) };
    this.setDefaultView();
    this.built = true;
    buildsInPage += 1;
    this.bindRenderer();
    this.unsubscribe.push(this.renderer.onRecreated(() => this.bindRenderer()));
    this.installHooks();
    this.log(
      `[bench] scene=bench look=${this.look.id} terrain=${this.terrainSource} draws=${String(this.targetDraws)} preset=${settings.preset} ` +
        `terrainFetches=${String(this.terrainFetches())} chunks=${String(chunks.meshes.length)} ` +
        `rocks=${String(content.counts.rockInstances)}/${String(content.counts.rockDraws)} ` +
        `avatars=${String(content.counts.avatarInstances)} props=${String(content.counts.props)}`,
    );
  }

  private terrainFetches(): number {
    return this.regolith === null ? (this.stub?.fetchCount ?? 0) : this.regolith.fetchCount;
  }

  private terrainBindings(): number {
    return this.regolith === null ? (this.stub?.textureBindings ?? 0) : this.regolith.textureBindings;
  }

  // ---- Frame ----------------------------------------------------------------------------------------------------

  /** Called by RenderModule once per frame, immediately before the pipeline renders. */
  update(frame: FrameInfo): void {
    const content = this.content;
    if (this.disposed || !this.built || content === null) return;
    const settings = frame.quality;
    if (settings !== this.appliedQuality) this.applyQuality(settings);

    const camera = this.roots.camera;
    if (this.path !== null) {
      if (this.path === "p1") p1Pose(frame.time, groundY, this.pose);
      else p3Pose(frame.time, groundY, this.pose);
      camera.position.set(this.pose.px, this.pose.py, this.pose.pz);
      camera.lookAt(this.pose.tx, this.pose.ty, this.pose.tz);
    }
    camera.updateMatrixWorld();
    this.look.update(frame, camera);
    if (!this.look.ownsSky) content.placeSky(_sunDir, _earthDir, camera.position);
    content.placeAvatars(frame.time, this.options.animate);

    this.step();
  }

  /** Warm-up and draw calibration, one state transition per frame; reads the previous frame's draw statistics. */
  private step(): void {
    this.framesSeen += 1;
    if (this.ready) return;
    if (this.framesSeen < BENCH_WARMUP_FRAMES || !this.compiled) return;
    this.renderer.readStats(this.frameStats);
    const wanted = this.calibrator.next(this.frameStats.drawCalls);
    this.setFillerCount(wanted);
    if (this.calibrator.settled) {
      this.ready = true;
      const info = this.renderer.renderer?.info;
      this.programsAtReady = info === undefined ? 0 : info.memory.programs;
      this.log(
        `[bench] ready draws=${String(this.frameStats.drawCalls)}/${String(this.targetDraws)} fillers=${String(this.fillerCount())} ` +
          `triangles=${String(this.frameStats.triangles)} steps=${String(this.calibrator.steps)}`,
      );
    }
  }

  private fillerCount(): number {
    return this.fillerGroup.children.filter((c) => c.name.startsWith("mc:bench-filler-")).length;
  }

  private setFillerCount(count: number): void {
    const current = this.fillerCount();
    if (count > current) {
      for (let i = current; i < count; i++) {
        const mesh = this.fillers[i];
        if (mesh !== undefined) this.fillerGroup.add(mesh);
      }
    } else if (count < current) {
      for (let i = current - 1; i >= count; i--) {
        const mesh = this.fillers[i];
        if (mesh !== undefined) this.fillerGroup.remove(mesh);
      }
    }
  }

  // ---- Quality and renderer binding --------------------------------------------------------------------------------

  private bindRenderer(): void {
    const renderer = this.renderer.renderer;
    if (renderer === null || !this.built) return;
    renderer.shadowMap.enabled = true;
    this.compiled = false;
    this.ready = false;
    this.framesSeen = 0;
    this.calibrator = new DrawCalibrator({ target: this.targetDraws, maxFillers: BENCH_FILLER_POOL });
    this.applyQuality(this.quality.current);
    // Compile the scene's materials ahead of the first frames (shadow pipelines still need real frames: section 12 step 3).
    renderer.compileAsync(this.roots.scene, this.roots.camera).then(
      () => {
        this.compiled = true;
      },
      (error: unknown) => {
        this.compiled = true;
        this.log(`[bench] compileAsync failed: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
  }

  /** Rebuilds what depends on the preset: CSM cascades, post chain, anisotropy. */
  private applyQuality(settings: QualitySettings): void {
    const first = this.appliedQuality === null;
    this.appliedQuality = settings;
    this.textures?.setAnisotropy(ANISOTROPY[settings.preset]);
    if (this.mask !== null && this.mask.texture.anisotropy !== ANISOTROPY[settings.preset]) {
      this.mask.texture.anisotropy = ANISOTROPY[settings.preset];
      this.mask.texture.needsUpdate = true;
    }
    this.look.applyQuality(settings);
    if (!first) {
      // A preset change creates pipelines: warm up again behind the change (section 12 step 5).
      this.ready = false;
      this.framesSeen = 0;
      this.calibrator = new DrawCalibrator({ target: this.targetDraws, maxFillers: BENCH_FILLER_POOL });
    }
  }

  // ---- Views and hooks ---------------------------------------------------------------------------------------------

  /** Worksite view: standing among the clean lanes, outpost ahead, sun from the left. */
  private setDefaultView(): void {
    const camera: Camera = this.roots.camera;
    camera.position.set(-4, groundY(-4, -45.5) + 1.7, -45.5);
    camera.lookAt(3, groundY(3, -10) + 2.2, -10);
    camera.updateMatrixWorld();
    benchEarthDirection(_earthDir);
  }

  private installHooks(): void {
    if (this.specs === null) return;
    this.target.__mcBench = new HookObject(this.specs, {
      isReady: () => this.ready,
      setPath: (id) => {
        this.path = id;
        if (id === null) this.setDefaultView();
      },
      setDraws: (target) => {
        this.targetDraws = Math.max(0, Math.round(target));
        this.calibrator = new DrawCalibrator({ target: this.targetDraws, maxFillers: BENCH_FILLER_POOL });
        this.ready = false;
        this.framesSeen = Math.max(this.framesSeen, BENCH_WARMUP_FRAMES);
      },
      stats: () => this.stats(),
    });
  }

  stats(): BenchStats {
    this.renderer.readStats(this.frameStats);
    const info = this.renderer.renderer?.info;
    return {
      ready: this.ready,
      backend: this.renderer.backend,
      tier: this.renderer.tier,
      preset: this.quality.current.preset,
      reversedZ: this.quality.capabilities.reversedDepth,
      renderScale: this.renderer.renderScale,
      targetDraws: this.targetDraws,
      draws: this.frameStats.drawCalls,
      triangles: this.frameStats.triangles,
      fillers: this.fillerCount(),
      calibrationSteps: this.calibrator.steps,
      terrainChunks: this.chunks?.meshes.length ?? 0,
      terrainSource: this.terrainSource,
      terrainError: this.terrainError,
      terrainLoad: this.terrainLoad,
      terrainVertices: this.terrainVertices,
      terrainFetchesPerFragment: this.terrainFetches(),
      terrainTextureBindings: this.terrainBindings(),
      rockInstances: this.content?.counts.rockInstances ?? 0,
      rockDraws: this.content?.counts.rockDraws ?? 0,
      avatarProxies: this.content?.counts.avatarInstances ?? 0,
      props: this.content?.counts.props ?? 0,
      cascades: this.look.cascadeCount(),
      look: this.look.id,
      postPasses: this.look.postPasses().slice(),
      lookKnobs: this.look.describeKnobs?.() ?? "n/a",
      pipelinesAfterWarmup: !this.ready || info === undefined ? 0 : info.memory.programs - this.programsAtReady,
      textureBytes: (this.textures?.bytes ?? 0) + this.maskBytes,
      path: this.path,
      animate: this.options.animate,
      buildsInPage,
      pageTimeOrigin: typeof performance === "undefined" ? 0 : performance.timeOrigin,
    };
  }

  /** Two planes 3 m apart at 15 km: with a working reversed-Z depth buffer the rear (green) plane never shows. */
  private buildZFightProbe(): { meshes: Mesh[]; geometry: PlaneGeometry; materials: MeshBasicNodeMaterial[] } {
    const geometry = new PlaneGeometry(9000, 3600);
    const materials: MeshBasicNodeMaterial[] = [];
    const meshes: Mesh[] = [];
    const colours: [number, number, number][] = [
      [0.8, 0.12, 0.1],
      [0.1, 0.8, 0.12],
    ];
    for (let i = 0; i < 2; i++) {
      const material = new MeshBasicNodeMaterial();
      material.name = i === 0 ? "mc:bench-probe-front" : "mc:bench-probe-back";
      const c = colours[i] ?? [1, 1, 1];
      material.colorNode = vec4(vec3(c[0], c[1], c[2]), 1);
      const mesh = new Mesh(geometry, material);
      mesh.name = material.name;
      // In front of the default view (+z), turned to face the camera; the second plane is 3 m farther away.
      mesh.position.set(0, 3200, 15_000 + i * 3);
      mesh.rotation.y = Math.PI;
      mesh.frustumCulled = false;
      this.roots.sky.add(mesh);
      materials.push(material);
      meshes.push(mesh);
    }
    return { meshes, geometry, materials };
  }

  // ---- Lifetime -------------------------------------------------------------------------------------------------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    if (this.target.__mcBench !== undefined) delete this.target.__mcBench;
    this.look.dispose();
    for (const f of this.fillers) f.removeFromParent();
    this.fillers.length = 0;
    this.fillerGeometry.dispose();
    if (this.probe !== null) {
      for (const m of this.probe.meshes) m.removeFromParent();
      this.probe.geometry.dispose();
      for (const m of this.probe.materials) m.dispose();
    }
    this.chunks?.dispose();
    this.stub?.dispose();
    this.regolith?.dispose();
    this.mask?.texture.dispose();
    this.content?.dispose();
    this.textures?.dispose();
    setTerrainHeightSource(null);
  }
}
