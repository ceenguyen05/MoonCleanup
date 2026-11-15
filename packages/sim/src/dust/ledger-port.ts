// The dust ledger seen from the room simulation.
//
// packages/world owns the exact integer ledger, rasterisation, thresholds and the Inspector's Stamp (M1-W3-T01, WDS
// sections 4.2 to 4.7); apps/server/src/world owns the authoritative per-room dust state (M1-W3-T04). The sim only
// needs one operation: "apply this accepted stroke and tell me how many milligrams it removed". It calls the port in
// the fixed tick order of WDS section 4.5a (players by ascending slot, each actor's ops in emission order), AFTER it
// has decided Dust Cell acceptance (a full Cell never reaches the ledger, section 4.6).
//
// Hosts plug in the real ledger (server: authoritative state; Solo worker: local authoritative copy; predicting client:
// the predicted overlay), built by `createRoomDustLedger` (./room-ledger). `ApproxDustLedger` below is a deterministic
// stand-in for tests that need no texels. It is NOT the ADR-0026 ledger: it tracks one milligram budget per plot and
// charges stroke area x depth against it (no coverage lattice, anchor plot only, no plot states).
//
// Plot events: a ledger that also implements `DustLedgerPlotEvents` (the real one does) tells the sim which plots
// became Opened or Polished. The sim reads and empties those queues after every stroke it applies, pays the
// Inspector's Stamp and emits `plot.opened` / `plot.polished`. A ledger without them (the stand-in) never does.

import type { PlotId, StrokeRecord } from "@moon-cleanup/shared";

/** Plots reported per stroke result (dust.collected carries at most 8). */
export const STROKE_RESULT_MAX_PLOTS = 8;

/** Output of one applied stroke. Reused by the caller; the port overwrites every field. */
export class StrokeApplyResult {
  /** Mass removed by the stroke, integer milligrams. */
  milligrams = 0;
  /** Ledger units removed (1/16 level x texel), for credit. */
  removedUnits = 0;
  /** Share of the swept area that still carried dust, 0 .. 1 (presentation timbre). */
  grime01 = 0;
  /** Number of valid entries in `plotIds`. */
  plotCount = 0;
  /** Plots that gave dust, largest contributor first. */
  readonly plotIds = new Int32Array(STROKE_RESULT_MAX_PLOTS);

  clear(): void {
    this.milligrams = 0;
    this.removedUnits = 0;
    this.grime01 = 0;
    this.plotCount = 0;
  }
}

/** What the sim needs from the dust ledger. */
export interface DustLedgerPort {
  /** True when the plot has no dust (Empty / outpost pad): the stroke is skipped (WDS section 4.4 check 7). */
  isEmptyPlot(plotId: PlotId): boolean;
  /** Applies one accepted stroke and writes what it removed into `out` (which the caller cleared). */
  applyStroke(stroke: StrokeRecord, out: StrokeApplyResult): void;
}

/**
 * What happened to plots, queued by the ledger while it applies strokes. Optional part of a ledger; the sim is the
 * only reader and empties the queues (a host must not).
 */
export interface DustLedgerPlotEvents {
  /** Plots that became Polished since `clearPolishedQueue`. */
  readonly polishedQueueCount: number;
  polishedPlotAt(k: number): number;
  /** Player slot credited with entry k, or a negative value for the shift (no player removed at least half). */
  polishedCreditAt(k: number): number;
  clearPolishedQueue(): void;
  /** Plots that became Opened since `clearOpenedQueue` (a plot that goes straight to Polished is not listed). */
  readonly openedQueueCount: number;
  openedPlotAt(k: number): number;
  clearOpenedQueue(): void;
  /** Ledger units removed from `plot` by one bucket: a player slot, or the first non-player slot for the shift. */
  contributionOf(plot: number, actorSlot: number): number;
  /** Polished + Empty plots: the Shine Index numerator (WDS section 4.2: Shine = (Polished + Empty) / plot count). */
  readonly shinePlots: number;
  /** Polished plots only (no Empty plots): what `plot.polished` reports as `polishedCount`. */
  readonly polishedTotal: number;
}

/** The plot-event part of `ledger`, or null when it has none. */
export function plotEventsOf(ledger: DustLedgerPort): DustLedgerPlotEvents | null {
  const l = ledger as Partial<DustLedgerPlotEvents>;
  return typeof l.polishedQueueCount === "number" &&
    typeof l.polishedPlotAt === "function" &&
    typeof l.polishedCreditAt === "function" &&
    typeof l.clearPolishedQueue === "function" &&
    typeof l.openedQueueCount === "number" &&
    typeof l.openedPlotAt === "function" &&
    typeof l.clearOpenedQueue === "function" &&
    typeof l.contributionOf === "function" &&
    typeof l.shinePlots === "number" &&
    typeof l.polishedTotal === "number"
    ? (ledger as DustLedgerPort & DustLedgerPlotEvents)
    : null;
}

/** Inputs of the stand-in ledger. */
export interface ApproxDustLedgerOptions {
  /** Plot area in square metres; default: mean plot area of the grid. */
  readonly plotAreaM2: number;
  /** Dust level of a plot (5 / 8 / 13 per terrain class); default: every plot uses `defaultDustLevel`. */
  readonly dustLevelOf?: (plotId: PlotId) => number;
  readonly defaultDustLevel: number;
  /** Disc diameter in mm for a zero-width stroke (`SimConfig.detailingDiameterMm`, from `trait.detailing`). */
  readonly detailingDiameterMm: number;
  /** kg per m^2 per dust level (game-data world.dustKgPerM2PerLevel). */
  readonly kgPerM2PerLevel: number;
  /** Plots without dust. */
  readonly isEmpty?: (plotId: PlotId) => boolean;
}

/**
 * Deterministic stand-in for the ADR-0026 ledger (integer arithmetic only). Removal per stroke:
 * coverage_mm2 x min(depth16, 16 L) x mgPerMm2PerUnit, clamped to the plot's remaining budget. Coverage is the flat
 * capsule length x width, or the Detailing disc area. Plot budget = area x L x kgPerM2PerLevel.
 */
export class ApproxDustLedger implements DustLedgerPort {
  private readonly remaining = new Map<number, number>();
  private readonly levelOf: (plotId: PlotId) => number;
  private readonly emptyOf: (plotId: PlotId) => boolean;
  /** Milligrams per mm^2 per ledger unit, scaled by 1e6 to stay integer. */
  private readonly mgPerMm2PerUnitE6: number;
  private readonly areaMm2: number;

  constructor(private readonly options: ApproxDustLedgerOptions) {
    this.levelOf = options.dustLevelOf ?? (() => options.defaultDustLevel);
    this.emptyOf = options.isEmpty ?? (() => false);
    // kg/m^2/level -> mg/mm^2/unit: x 1e6 mg/kg / 1e6 mm^2/m^2 / 16 units per level.
    this.mgPerMm2PerUnitE6 = Math.round((options.kgPerM2PerLevel * 1e6) / 16);
    this.areaMm2 = Math.round(options.plotAreaM2 * 1e6);
  }

  isEmptyPlot(plotId: PlotId): boolean {
    return this.emptyOf(plotId);
  }

  /** Remaining milligrams of a plot (initial budget if untouched). */
  remainingMg(plotId: PlotId): number {
    return this.remaining.get(plotId) ?? this.initialMg(plotId);
  }

  initialMg(plotId: PlotId): number {
    const level = this.levelOf(plotId);
    // area_mm2 x 16 L units x mgPerMm2PerUnit; split to keep every product below 2^53.
    return Math.floor((this.areaMm2 / 1e6) * 16 * level * this.mgPerMm2PerUnitE6);
  }

  applyStroke(stroke: StrokeRecord, out: StrokeApplyResult): void {
    const plot = stroke.anchor;
    if (this.emptyOf(plot)) return;
    const du = stroke.endUMm - stroke.startUMm;
    const dv = stroke.endVMm - stroke.startVMm;
    const widthMm = stroke.widthCm * 10;
    let coverMm2: number;
    if (du === 0 && dv === 0) {
      // Disc: pi d^2 / 4 with pi/4 ~ 785398 / 1e6.
      const d = stroke.widthCm === 0 ? this.options.detailingDiameterMm : widthMm;
      coverMm2 = Math.floor((d * d * 785_398) / 1_000_000);
    } else {
      coverMm2 = Math.floor(Math.sqrt(du * du + dv * dv)) * widthMm;
    }
    const level = this.levelOf(plot);
    const units = Math.min(stroke.depth16, 16 * level);
    const want = Math.floor((coverMm2 * units * this.mgPerMm2PerUnitE6) / 1_000_000);
    const left = this.remainingMg(plot);
    const took = want < left ? want : left;
    this.remaining.set(plot, left - took);
    out.milligrams += took;
    out.removedUnits += units;
    out.grime01 = left > 0 ? 1 : 0;
    if (took > 0 && out.plotCount < STROKE_RESULT_MAX_PLOTS) out.plotIds[out.plotCount++] = plot;
  }
}
