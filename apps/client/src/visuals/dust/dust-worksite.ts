// `?scene=dust` (M1-W3-T02): the dust layer running inside the visuals module on the real regolith material. A flat
// ground patch around one site plot. Two stroke sources:
//   - a host feed (`DustFeedPort`, M1-W3-T02b): the Solo LocalRoom's main-thread ledger view (sim-host dust-view.ts),
//     fed from the worker's FRAMEs, so the strokes are the game's own; the composition root passes it when solo is on;
//   - otherwise the seeded scenario (verify/scenario.ts: three cleaners in lanes plus scattered strokes of every tool
//     shape, on a real plot grid and a real `WorldDustLedger`), e.g. with `&solo=0`.
// Everything after the feed is the production path: ledger -> stroke logs -> `DustTileAtlas` -> `DustReplayPass` (GPU)
// -> atlas sampled by the regolith shader through `DustFlatLookup`.
//
//   &tiles=low|medium|high   atlas preset (default: from the quality preset)
//   &warm=<frames>           scenario frames run ahead at start (8 per rendered frame), for captures
//   &freeze=1                stop the scenario after the warm-up
//   &view=play|top|wide      camera;  &dbg=1..7  regolith debug view (1 = remaining dust)
//   &src=0                   A/B: the ground without the atlas lookup (it then reads the raw atlas as one mask)

import { Group, Mesh, type BufferGeometry, type WebGPURenderer } from "three/webgpu";
import type { SceneRoots } from "../../render";
import { buildCapGeometry } from "../lookdev/cap-geometry";
import { numberParam, type LookScene, type Pose, type SceneContext } from "../lookdev/scene-base";
import { createRegolithMaterial, type RegolithMaterial } from "../materials";
import type { PlotId } from "@moon-cleanup/shared";
import type { IcoPlotGrid } from "@moon-cleanup/world";
import { DustLayer } from "./dust-layer";
import { DustFlatLookup } from "./flat-lookup";
import { DUST_TILE_PRESETS, type DustLedgerView, type DustTileAtlas } from "./tile-atlas";
import { DustScenario, SCENARIO_SITE } from "./verify/scenario";

export const DUST_SCENE_ID = "dust";
/** Site plot of the flat ground patch (the scenario's site; a host feed spawns its player here). */
export const DUST_SCENE_SITE = SCENARIO_SITE;

/**
 * A stroke source owned outside visuals (the Solo host's main-thread ledger view, adapted by the composition root).
 * `bind` hands it the atlas: it then calls `onStroke` / `onLedgerZero` / `onPolished` after its ledger applied them and
 * `rebuildAll` after its ledger was replaced. `pump` runs once per rendered frame before `atlas.frame()`.
 */
export interface DustFeedPort {
  readonly grid: IcoPlotGrid;
  readonly ledger: DustLedgerView;
  readonly sitePlot: number;
  bind(target: DustTileAtlas | null): void;
  pump(): void;
  /** Numbers for `__mcLook.info().dustFeed` (strokes, restores, ...). */
  info(): Readonly<Record<string, number | boolean>>;
  /** The patch follows the player (game worksite); absent: the patch stays on `sitePlot` (dev scene). */
  readonly follow?: DustSiteFollow | null;
}

/**
 * How the dust ground follows the player (M1-W3-T05): the avatar position, and on the flat worksite the render frame's
 * site, which the gameplay camera mapper (`PlotFrameMapper`) owns. The worksite builds the tables of a new site in slices,
 * asks the frame to move (`requestSite`); the frame applies the move at its next mapping (first in the next frame, the
 * gameplay present), and the worksite swaps its tables in that same frame, so the camera, the avatar and the ground move
 * together. On the terrain (moon-centred render space) there is no frame: the tables swap as soon as they are built.
 */
export interface DustSiteFollow {
  /** Avatar position (moon-centred, any scale) into `out`; false before the first pose. Must not allocate. */
  avatar(out: { x: number; y: number; z: number }): boolean;
  /** The flat worksite's render frame (required there; ignored on the terrain). */
  readonly frame?: DustSiteFrame | null;
}

/** The render frame of the flat worksite (`PlotFrameMapper` satisfies it). */
export interface DustSiteFrame {
  readonly site: number;
  readonly siteVersion: number;
  readonly sitePending: boolean;
  requestSite(plot: number): void;
  applyPendingSite(): boolean;
}

/** The patch re-centres once the avatar is this far (m along the ground) from its site; the lookup covers +-112 m. */
export const FOLLOW_RECENTRE_M = 40;
/** Main-thread budget per frame of a re-centre build (ms). */
const FOLLOW_BUILD_BUDGET_MS = 1;

const GROUND_RADIUS_M = 150;
// World z = -v since the W3-T05 mirror fix: the poses are the earlier ones with z negated (same ground in view).
const VIEWS: Readonly<Record<string, Pose>> = {
  play: { position: [-4, 5, 16], target: [-2, 0, -2] },
  top: { position: [0, 75, -14.01], target: [0, 0, -14] },
  wide: { position: [34, 26, 44], target: [-8, 0, -10] },
};
/** Scenario frames run per rendered frame during the warm-up. */
const WARM_STEPS_PER_FRAME = 8;

type TilePreset = keyof typeof DUST_TILE_PRESETS;

export class DustWorksite implements LookScene {
  readonly id = DUST_SCENE_ID;
  readonly views = Object.keys(VIEWS);
  readonly probes = {};
  /** The seeded stand-in source; null when a host feed drives the scene. */
  readonly scenario: DustScenario | null;
  readonly feed: DustFeedPort | null;
  readonly layer: DustLayer;
  readonly lookup: DustFlatLookup;
  readonly tilePreset: TilePreset;
  /** Texture fetches per fragment and distinct textures of the ground material. */
  readonly groundFetches: number;
  readonly groundTextures: number;

  private readonly roots: SceneRoots;
  private readonly group = new Group();
  private readonly regolith: RegolithMaterial;
  private readonly geometry: BufferGeometry;
  private warmLeft: number;
  private readonly freeze: boolean;
  /** Camera unit direction for the atlas residency (the site's centre). */
  private readonly cam = { x: 0, y: 0, z: 1 };

  constructor(ctx: SceneContext, feed: DustFeedPort | null = null) {
    const { roots, params, state } = ctx;
    this.roots = roots;
    state.sunElevationDeg = numberParam(params, "sun", 38);
    state.sunAzimuthDeg = numberParam(params, "az", 165);
    state.sunRateDegPerS = numberParam(params, "rate", 0);

    const asked = (params.get("tiles") ?? "").toLowerCase();
    const quality = ctx.quality?.preset ?? "medium";
    this.tilePreset =
      asked === "low" || asked === "medium" || asked === "high"
        ? asked
        : quality === "low"
          ? "low"
          : quality === "medium"
            ? "medium"
            : "high";
    this.freeze = params.get("freeze") === "1";
    this.feed = feed;
    if (feed !== null) {
      // The game's own strokes: the atlas reads the host's ledger view and is fed by it.
      this.warmLeft = 0;
      this.scenario = null;
      this.layer = DustLayer.create(feed.grid, feed.ledger, DUST_TILE_PRESETS[this.tilePreset]);
      feed.grid.fromPlotLocal(feed.sitePlot as PlotId, 0, 0, this.cam);
      this.lookup = new DustFlatLookup(feed.grid, this.layer.atlas, this.layer.pass.texture, feed.sitePlot);
      feed.bind(this.layer.atlas);
    } else {
      this.warmLeft = Math.max(0, Math.round(numberParam(params, "warm", 0)));
      this.scenario = new DustScenario({ preset: this.tilePreset, frames: 1_000_000_000 });
      this.layer = new DustLayer(this.scenario.atlas, this.scenario.batch);
      this.lookup = new DustFlatLookup(this.scenario.grid, this.scenario.atlas, this.layer.pass.texture, SCENARIO_SITE);
    }

    this.regolith = createRegolithMaterial({
      mask: this.layer.pass.texture,
      maskRect: { originX: 0, originZ: 0, sizeX: 1, sizeZ: 1 },
      maskSize: [1, 1],
      ...(params.get("src") === "0" ? {} : { maskSource: this.lookup.source }),
      debugView: Math.max(0, Math.min(7, Math.round(numberParam(params, "dbg", 0)))),
    });
    this.groundFetches = this.regolith.fetchCount;
    this.groundTextures = this.regolith.textureBindings;

    this.geometry = buildCapGeometry({ radiusM: GROUND_RADIUS_M, rings: 96, segments: 160 });
    const ground = new Mesh(this.geometry, this.regolith.material);
    ground.name = "mc:dust-ground";
    ground.castShadow = true;
    ground.receiveShadow = true;
    ground.frustumCulled = false;
    this.group.name = "mc:look-dust";
    this.group.add(ground);
    roots.world.add(this.group);
    this.setView(params.get("view") ?? "play");
  }

  /** `true` once the warm-up has run (captures wait for it). */
  get ready(): boolean {
    return this.warmLeft === 0;
  }

  /** Renderer created or recreated: create the replay pipelines, rebuild the tiles after a device loss. */
  bindRenderer(renderer: WebGPURenderer): void {
    this.layer.bind(renderer);
  }

  /** Before the main render: the scenario's strokes of this frame, the GPU replay, the slot table. */
  preRender(renderer: WebGPURenderer): void {
    const feed = this.feed;
    if (feed !== null) {
      // Restore slices of the ledger view, then this frame's atlas work (the strokes arrived with the host's frames).
      feed.pump();
      const follow = feed.follow;
      const frame = follow?.frame;
      if (follow !== undefined && follow !== null && frame !== undefined && frame !== null)
        this.follow(feed.grid, follow, frame);
      this.layer.update(this.cam.x, this.cam.y, this.cam.z, renderer);
      this.lookup.sync();
      return;
    }
    const scenario = this.scenario;
    if (scenario === null) return;
    const steps = this.warmLeft > 0 ? Math.min(this.warmLeft, WARM_STEPS_PER_FRAME) : this.freeze ? 0 : 1;
    if (this.warmLeft > 0) this.warmLeft -= steps;
    for (let i = 0; i < steps; i++) {
      // `step()` applies strokes to the ledger, feeds the atlas and runs `atlas.frame()`; the batch is then drawn.
      scenario.step();
      this.layer.pass.flush(renderer);
    }
    this.lookup.sync();
  }

  /** Patch moves (re-centres committed) and the frame version they follow (`follow`). */
  recentres = 0;
  private followVersion = -1;
  private readonly avatarPos = { x: 0, y: 0, z: 1 };

  /**
   * Follows the player (cold except on a move): the atlas residency centres on the avatar every frame; past
   * FOLLOW_RECENTRE_M from the site the tables of the avatar's plot are built in 1 ms slices, then the move is staged on
   * the frame and committed here in the frame the frame applied it. No allocation.
   */
  private follow(grid: IcoPlotGrid, follow: DustSiteFollow, f: DustSiteFrame): void {
    const lookup = this.lookup;
    if (this.followVersion < 0) this.followVersion = f.siteVersion;
    // The camera mapper did not run this frame (no pose): apply a staged move here so it never waits.
    if (f.sitePending) f.applyPendingSite();
    if (f.siteVersion !== this.followVersion) {
      this.followVersion = f.siteVersion;
      if (lookup.recentreReady && lookup.recentreSite === f.site) {
        lookup.commitRecentre();
        this.recentres++;
      }
    }
    const p = this.avatarPos;
    if (!follow.avatar(p)) return;
    const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    if (!(len > 0)) return;
    const cam = this.cam;
    cam.x = p.x / len;
    cam.y = p.y / len;
    cam.z = p.z / len;
    if (lookup.recentring) {
      if (lookup.stepRecentre(FOLLOW_BUILD_BUDGET_MS) && !f.sitePending) f.requestSite(lookup.recentreSite);
      return;
    }
    const c = grid.centers;
    const o = lookup.sitePlot * 3;
    const dot = cam.x * c[o]! + cam.y * c[o + 1]! + cam.z * c[o + 2]!;
    const distM = Math.acos(dot > 1 ? 1 : dot) * grid.params.radiusM;
    if (distM > FOLLOW_RECENTRE_M) lookup.beginRecentre(grid.plotAt(cam, lookup.sitePlot as PlotId));
  }

  setView(name: string): void {
    const pose = VIEWS[name] ?? VIEWS["play"];
    if (pose === undefined) return;
    const camera = this.roots.camera;
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld();
  }

  update(): void {
    // The dust work runs in `preRender` (it needs the renderer).
  }

  dispose(): void {
    this.feed?.bind(null);
    this.group.removeFromParent();
    this.regolith.dispose();
    this.geometry.dispose();
    this.lookup.dispose();
    this.layer.dispose();
  }
}
