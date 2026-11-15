// Seeded dust scenario for the replay checks (M1-W3-T02): a real GP(128,0) grid, a real `WorldDustLedger` with stroke
// logs, three cleaners walking lanes (hand tools and a vehicle intake), scattered strokes of every tool shape, a
// resync, a camera move and a full atlas rebuild. Used by the Node tests (CPU reference) and by the browser verify
// page (GPU against the CPU reference). No three.js, DOM or Node imports. Not part of the game.

import { STANDARD_GRID_PARAMS, type PlotId, type StrokeRecord, type Tick } from "@moon-cleanup/shared";
import {
  createPlotGrid,
  createUniformPlotAttributes,
  mulberry32,
  WorldDustLedger,
  type IcoPlotGrid,
  type PlotAttributeTables,
} from "@moon-cleanup/world";
import { DustReplayBatch } from "../replay-batch";
import { DUST_TILE_PRESETS, DustTileAtlas } from "../tile-atlas";

/** Dust level per DustClass code and kg per m^2 per level (game-data world.json values on 2026-11-14). */
const DUST_LEVELS = [5, 8, 13, 0] as const;
const KG_PER_M2_PER_LEVEL = 0.062;
/** A hexagon well inside diamond 4. */
export const SCENARIO_SITE = 71_234;

/** [widthCm, depth16, disc] of the scattered strokes (hand tools, Detailing disc, vehicle intakes, robot lanes). */
const TOOLS: readonly (readonly [number, number, boolean])[] = [
  [15, 80, false],
  [28, 96, false],
  [45, 128, false],
  [75, 128, false],
  [100, 208, false],
  [140, 160, false],
  [50, 255, true],
  [160, 112, false],
  [340, 144, false],
  [560, 208, false],
  [80, 16, false],
];

let gridCache: IcoPlotGrid | null = null;
let attrCache: PlotAttributeTables | null = null;
export function scenarioGrid(): IcoPlotGrid {
  gridCache ??= createPlotGrid(STANDARD_GRID_PARAMS);
  return gridCache;
}

export function makeScenarioLedger(): WorldDustLedger {
  const grid = scenarioGrid();
  attrCache ??= createUniformPlotAttributes(grid);
  return new WorldDustLedger({
    grid,
    attributes: attrCache,
    dustLevelByClass: DUST_LEVELS,
    kgPerM2PerLevel: KG_PER_M2_PER_LEVEL,
    strokeLog: true,
    zeroEvents: true,
  });
}

class Sink {
  milligrams = 0;
  removedUnits = 0;
  grime01 = 0;
  plotCount = 0;
  readonly plotIds = new Int32Array(8);
}

interface MutableStroke {
  anchor: PlotId;
  startUMm: number;
  startVMm: number;
  endUMm: number;
  endVMm: number;
  widthCm: number;
  depth16: number;
  toolCode: number;
  tick: Tick;
  actorSlot: number;
  inputSeq: number;
}

interface Cleaner {
  u: number;
  v: number;
  dir: number;
  left: number;
  readonly stepMm: number;
  readonly lane: number;
  readonly laneShiftMm: number;
  readonly widthCm: number;
  readonly depth16: number;
  readonly tool: number;
}

export interface DustScenarioOptions {
  readonly preset: keyof typeof DUST_TILE_PRESETS;
  /** Frames with strokes (60 per second, strokes every 6th frame). */
  readonly frames: number;
  readonly seed?: number;
  readonly budgetMs?: number;
  readonly now?: () => number;
  /** Frame of the resync of the site plot, of the camera move and of the full rebuild (-1 = never). */
  readonly resyncFrame?: number;
  readonly moveFrame?: number;
  readonly rebuildAllFrame?: number;
  /** Scattered strokes on top of the lanes. Default true. */
  readonly scatter?: boolean;
}

export class DustScenario {
  readonly grid = scenarioGrid();
  readonly ledger = makeScenarioLedger();
  readonly batch = new DustReplayBatch();
  readonly atlas: DustTileAtlas;
  readonly frames: number;
  strokes = 0;
  polished = 0;
  zeroEvents = 0;
  frame = 0;
  /** Milliseconds of the last `atlas.frame()` call, measured here (the atlas reads no clock without rebuild work). */
  frameMs = 0;

  private readonly sink = new Sink();
  private readonly rec: MutableStroke = {
    anchor: 0 as PlotId,
    startUMm: 0,
    startVMm: 0,
    endUMm: 0,
    endVMm: 0,
    widthCm: 0,
    depth16: 0,
    toolCode: 0,
    tick: 0 as Tick,
    actorSlot: 0,
    inputSeq: 0,
  };
  private readonly dir = { x: 0, y: 0, z: 1 };
  private readonly loc = { u: 0, v: 0 };
  private readonly cam = { x: 0, y: 0, z: 1 };
  private readonly rng: () => number;
  private readonly cleaners: Cleaner[];
  private readonly opt: DustScenarioOptions;

  constructor(options: DustScenarioOptions) {
    this.opt = options;
    this.frames = options.frames;
    const preset = DUST_TILE_PRESETS[options.preset];
    this.atlas = new DustTileAtlas(this.grid, this.ledger, {
      ...preset,
      ...(options.budgetMs !== undefined ? { budgetMs: options.budgetMs } : {}),
      ...(options.now !== undefined ? { now: options.now } : {}),
    });
    const rnd = mulberry32(options.seed ?? 20261114);
    this.rng = (): number => rnd() / 4294967296;
    this.grid.fromPlotLocal(SCENARIO_SITE as PlotId, 0, 0, this.cam);
    this.cleaners = [
      // Desk Duster, Bristle Broom, Bulldust intake
      {
        u: -6000,
        v: -4000,
        dir: 1,
        left: 30,
        stepMm: 300,
        lane: 30,
        laneShiftMm: 110,
        widthCm: 15,
        depth16: 80,
        tool: 0,
      },
      {
        u: 2000,
        v: 3000,
        dir: 1,
        left: 24,
        stepMm: 450,
        lane: 24,
        laneShiftMm: 340,
        widthCm: 45,
        depth16: 128,
        tool: 2,
      },
      {
        u: -30_000,
        v: 9000,
        dir: 1,
        left: 22,
        stepMm: 2800,
        lane: 22,
        laneShiftMm: 2600,
        widthCm: 340,
        depth16: 144,
        tool: 8,
      },
    ];
  }

  /** Applies a stroke given in the frame of the site plot: ledger first, then the atlas (the host contract). */
  private apply(su: number, sv: number, eu: number, ev: number, widthCm: number, depth16: number, tool: number): void {
    const grid = this.grid;
    const r = this.rec;
    grid.fromPlotLocal(SCENARIO_SITE as PlotId, eu, ev, this.dir);
    const anchor = grid.plotAt(this.dir);
    grid.toPlotLocal(anchor, this.dir, this.loc);
    r.anchor = anchor;
    r.endUMm = this.loc.u;
    r.endVMm = this.loc.v;
    r.startUMm = r.endUMm;
    r.startVMm = r.endVMm;
    if (su !== eu || sv !== ev) {
      grid.fromPlotLocal(SCENARIO_SITE as PlotId, su, sv, this.dir);
      grid.toPlotLocal(anchor, this.dir, this.loc);
      r.startUMm = this.loc.u;
      r.startVMm = this.loc.v;
    }
    r.widthCm = widthCm;
    r.depth16 = depth16;
    r.toolCode = tool;
    r.actorSlot = tool % 6;
    r.tick = (this.frame + 1) as Tick;
    r.inputSeq = this.strokes & 0xffff;
    this.ledger.applyStroke(r as StrokeRecord, this.sink);
    this.atlas.onStroke(r.anchor, r.startUMm, r.startVMm, r.endUMm, r.endVMm, widthCm, depth16);
    this.strokes++;
  }

  /** Forwards the ledger's zero-cell and Polished events to the atlas, as the host does. */
  private forwardEvents(): void {
    const led = this.ledger;
    const nz = led.zeroEventCount;
    for (let k = 0; k < nz; k++) this.atlas.onLedgerZero(led.zeroEventPlotAt(k), led.zeroEventTexelAt(k));
    this.zeroEvents += nz;
    led.clearZeroEvents();
    const np = led.polishedQueueCount;
    for (let k = 0; k < np; k++) this.atlas.onPolished(led.polishedPlotAt(k));
    this.polished += np;
    led.clearPolishedQueue();
  }

  /** One frame of the scenario: strokes (every 6th frame), events, then `atlas.frame()`. The batch is ready after. */
  step(): void {
    const f = this.frame;
    const opt = this.opt;
    if (f < this.frames && f % 6 === 0) {
      for (const c of this.cleaners) {
        const nu = c.u + c.dir * c.stepMm;
        this.apply(c.u, c.v, nu, c.v, c.widthCm, c.depth16, c.tool);
        c.u = nu;
        if (--c.left === 0) {
          c.left = c.lane;
          c.dir = -c.dir;
          c.v += c.laneShiftMm;
        }
      }
      if (opt.scatter !== false && f % 30 === 0) {
        const rng = this.rng;
        const toolCode = Math.floor(rng() * TOOLS.length);
        const tool = TOOLS[toolCode]!;
        const cu = Math.round((rng() * 2 - 1) * 28_000);
        const cv = Math.round((rng() * 2 - 1) * 28_000);
        const len = tool[2] ? 0 : rng() * 3800;
        const ang = rng() * 2 - 1;
        const bng = Math.sqrt(1 - ang * ang) * (rng() < 0.5 ? -1 : 1);
        this.apply(
          Math.round(cu - (ang * len) / 2),
          Math.round(cv - (bng * len) / 2),
          Math.round(cu + (ang * len) / 2),
          Math.round(cv + (bng * len) / 2),
          tool[0],
          tool[1],
          toolCode,
        );
      }
      this.forwardEvents();
    }
    if (f === (opt.resyncFrame ?? -1)) this.atlas.onLedger(SCENARIO_SITE);
    if (f === (opt.moveFrame ?? -1)) this.grid.fromPlotLocal(SCENARIO_SITE as PlotId, 60_000, 20_000, this.cam);
    if (f === (opt.rebuildAllFrame ?? -1)) this.atlas.rebuildAll();
    const t0 = performance.now();
    this.atlas.frame(this.cam.x, this.cam.y, this.cam.z, this.batch);
    this.frameMs = performance.now() - t0;
    this.frame++;
  }
}
