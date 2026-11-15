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
}

const GROUND_RADIUS_M = 150;
const VIEWS: Readonly<Record<string, Pose>> = {
  play: { position: [-4, 5, -16], target: [-2, 0, 2] },
  top: { position: [0, 75, 14.01], target: [0, 0, 14] },
  wide: { position: [34, 26, -44], target: [-8, 0, 10] },
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
