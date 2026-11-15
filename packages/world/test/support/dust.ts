// Shared helpers of the dust ledger tests: the GP(128,0) grid, ledger factories, a seeded stroke generator around a
// site, digests. No Node or DOM imports: the golden cases also run in the browser lane.
import { DustClass, STANDARD_GRID_PARAMS, type PlotId, type StrokeRecord } from "@moon-cleanup/shared";
import {
  createPlotGrid,
  createUniformPlotAttributes,
  mulberry32,
  PlotAttributeTables,
  WorldDustLedger,
  type IcoPlotGrid,
  type StrokeApplySink,
  type WorldDustLedgerOptions,
} from "../../src/index";

export const SEED = 20261114;

/** Dust level per DustClass code (game-data world.json terrainClasses: 5 / 8 / 13; Empty has none). */
export const DUST_LEVELS = [5, 8, 13, 0] as const;
/** game-data world.json dustKgPerM2PerLevel. */
export const KG_PER_M2_PER_LEVEL = 0.062;

/**
 * Tool table of the vectors as [widthCm, depth16, disc]. Widths and Depths are the game-data values on 2026-11-14
 * (tools.json T1 .. T6, vehicles.json intakes); robots have no width in game-data yet, so two lane widths stand in.
 */
export const TOOLS: readonly (readonly [number, number, boolean])[] = [
  [15, 80, false], // T1 Desk Duster, Depth 5
  [28, 96, false], // T2 Crescent Squeegee, Depth 6
  [45, 128, false], // T3 Bristle Broom, Depth 8
  [75, 128, false], // T4 Lane Broom, Depth 8
  [100, 208, false], // T5 Static Rake, Depth 13
  [140, 160, false], // T6 Ion Curtain, Depth 10
  [50, 255, true], // Detailing disc (0.5 m diameter)
  [100, 255, false], // Charge (Static Rake)
  [160, 112, false], // Trundle intake, Depth 7
  [220, 112, false], // Skiff intake, Depth 7
  [340, 144, false], // Bulldust intake, Depth 9
  [560, 208, false], // Behemoth intake, Depth 13
  [80, 16, false], // robot lane (stand-in width)
  [140, 32, false], // robot lane (stand-in width)
];

/** A hexagon well inside diamond 4. */
export const SITE_PLOT = 71_234;

let gridCache: IcoPlotGrid | null = null;
export function standardGrid(): IcoPlotGrid {
  gridCache ??= createPlotGrid(STANDARD_GRID_PARAMS);
  return gridCache;
}

let uniformCache: PlotAttributeTables | null = null;
/** Every plot Highland, real areas. */
export function uniformAttributes(): PlotAttributeTables {
  uniformCache ??= createUniformPlotAttributes(standardGrid());
  return uniformCache;
}

let mixedCache: PlotAttributeTables | null = null;
/**
 * A seeded class per plot (55 % Highland, 35 % Mare, 10 % Crater Floor) and about 1 % Empty plots: a stand-in for
 * the class bake so the vectors cover every class and Empty neighbours.
 */
export function mixedAttributes(): PlotAttributeTables {
  if (mixedCache === null) {
    const grid = standardGrid();
    const classes = new Uint8Array(grid.count);
    for (let p = 0; p < grid.count; p++) {
      const h = (Math.imul(p ^ 0x9e3779b1, 0x85ebca6b) >>> 0) % 1000;
      classes[p] =
        h < 545 ? DustClass.Highland : h < 890 ? DustClass.Mare : h < 990 ? DustClass.CraterFloor : DustClass.Empty;
    }
    classes[SITE_PLOT] = DustClass.Highland;
    mixedCache = new PlotAttributeTables(classes, uniformAttributes().areas);
  }
  return mixedCache;
}

export function makeLedger(overrides: Partial<WorldDustLedgerOptions> = {}): WorldDustLedger {
  return new WorldDustLedger({
    grid: standardGrid(),
    attributes: uniformAttributes(),
    dustLevelByClass: DUST_LEVELS,
    kgPerM2PerLevel: KG_PER_M2_PER_LEVEL,
    ...overrides,
  });
}

/** A result object shaped like the sim's StrokeApplyResult. */
export class Sink implements StrokeApplySink {
  milligrams = 0;
  removedUnits = 0;
  grime01 = 0;
  plotCount = 0;
  readonly plotIds = new Int32Array(8);
}

export interface Stroke {
  anchor: PlotId;
  startUMm: number;
  startVMm: number;
  endUMm: number;
  endVMm: number;
  widthCm: number;
  depth16: number;
  toolCode: number;
  tick: number;
  actorSlot: number;
  inputSeq: number;
}

const dir = { x: 0, y: 0, z: 0 };
const local = { u: 0, v: 0 };

/**
 * A stroke given in the frame of `site` (mm), re-expressed canonically: anchored on the plot under its end point,
 * endpoints rounded to mm in that plot's frame.
 */
export function strokeAt(
  site: number,
  su: number,
  sv: number,
  eu: number,
  ev: number,
  widthCm: number,
  depth16: number,
  actorSlot = 0,
  toolCode = 0,
  tick = 0,
): Stroke {
  const grid = standardGrid();
  grid.fromPlotLocal(site as PlotId, eu, ev, dir);
  const anchor = grid.plotAt(dir);
  grid.toPlotLocal(anchor, dir, local);
  const endUMm = local.u;
  const endVMm = local.v;
  let startUMm = endUMm;
  let startVMm = endVMm;
  if (su !== eu || sv !== ev) {
    grid.fromPlotLocal(site as PlotId, su, sv, dir);
    grid.toPlotLocal(anchor, dir, local);
    startUMm = local.u;
    startVMm = local.v;
  }
  return {
    anchor,
    startUMm,
    startVMm,
    endUMm,
    endVMm,
    widthCm,
    depth16,
    toolCode,
    tick,
    actorSlot,
    inputSeq: tick & 0xffff,
  };
}

/**
 * `n` seeded strokes within about `spreadMm` of the site (about 20 plots at 40 m), every tool of TOOLS, `actors`
 * actor slots (slot 20 stands for a robot every 9th stroke).
 */
export function seededStrokes(
  n: number,
  seed: number,
  spreadMm = 40_000,
  actors = 6,
  site = SITE_PLOT,
  maxLenMm = 3800,
): Stroke[] {
  const rnd = mulberry32(seed);
  const rng = (): number => rnd() / 4294967296;
  const out: Stroke[] = [];
  for (let i = 0; i < n; i++) {
    const toolCode = Math.floor(rng() * TOOLS.length);
    const tool = TOOLS[toolCode]!;
    const cu = Math.round((rng() * 2 - 1) * spreadMm * 0.7);
    const cv = Math.round((rng() * 2 - 1) * spreadMm * 0.7);
    const len = tool[2] ? 0 : rng() * maxLenMm;
    const ang = rng() * 2 - 1;
    const bng = Math.sqrt(1 - ang * ang) * (rng() < 0.5 ? -1 : 1);
    const su = Math.round(cu - (ang * len) / 2);
    const sv = Math.round(cv - (bng * len) / 2);
    const eu = Math.round(cu + (ang * len) / 2);
    const ev = Math.round(cv + (bng * len) / 2);
    const actor = i % 9 === 8 ? 20 : i % actors;
    out.push(strokeAt(site, su, sv, eu, ev, tool[0], tool[1], actor, toolCode, i + 1));
  }
  return out;
}

const sink = new Sink();

export function applyAll(ledger: WorldDustLedger, strokes: readonly StrokeRecord[], order?: readonly number[]): void {
  for (let k = 0; k < strokes.length; k++) ledger.applyStroke(strokes[order ? order[k]! : k]!, sink);
}

/** FNV-1a 32 over (plot id, state, L0 byte, texels) of every plot that is not untouched Grimy, in PlotId order. */
export function fullDigest(ledger: WorldDustLedger): number {
  let h = 0x811c9dc5;
  const mix = (b: number): void => {
    h = Math.imul(h ^ (b & 0xff), 0x01000193);
  };
  for (let p = 0; p < ledger.plotCount; p++) {
    const slot = ledger.slotOf[p]!;
    if (slot < 0 && ledger.state[p] !== 2) continue;
    mix(p);
    mix(p >>> 8);
    mix(p >>> 16);
    mix(ledger.state[p]!);
    mix(ledger.frac[p]!);
    if (slot >= 0) for (let i = 0; i < 1024; i++) mix(ledger.texels[slot * 1024 + i]!);
  }
  return h >>> 0;
}

/** Fisher-Yates permutation of 0 .. n-1 from a seeded generator. */
export function permutation(n: number, seed: number): number[] {
  const rnd = mulberry32(seed);
  const order = Array.from({ length: n }, (_, k) => k);
  for (let k = n - 1; k > 0; k--) {
    const j = rnd() % (k + 1);
    const t = order[k]!;
    order[k] = order[j]!;
    order[j] = t;
  }
  return order;
}

/** CRC32 (IEEE), for the dust chunk golden vectors. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
