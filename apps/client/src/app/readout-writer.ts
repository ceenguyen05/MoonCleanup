// Sim read-out writer (composition-root glue, M1 integrator round 5, HUD read-outs pass).
//
// Turns the sim's pure read helpers (`MoonRoomSim.pickPlot / hopReadout / lampReadout / quotePriceLm`, Pass 5 of the
// gameplay report) into UI store patches:
// - `suit.hop` / `suit.lampLevel` / `suit.lampMode` (Hop gauge, Crown Lamp mode),
// - `plotCard.*` (the plot in front of the avatar, only while the player inspects),
// - `compass.outposts` (static list, written once).
//
// The Desk / Ops Console price (`quotePriceLm`) is applied by `MenuWriter.setQuote` (menu-writer.ts); `attachSimReadouts`
// binds one source to both writers.
//
// Solo-first: nothing here runs in the input or sim path. `pump(nowMs)` runs once per frame right before the UI store
// flush, returns immediately without a source, samples at most HUD_WRITE_HZ times a second into reused out-buffers (no
// per-frame allocation) and builds a patch only when a rounded value changed.
//
// Data source: the authoritative MoonRoomSim lives in the Solo Web Worker (apps/client/src/sim-host), so the main thread
// has no instance to call. The source is therefore a port (`SimReadoutSource`): a MoonRoomSim satisfies it structurally
// (checked in the test), and a worker-fed cache of the same four reads can implement it. Until one is attached nothing
// is written (the HUD keeps its defaults: no Hop gauge, lamp off, no Plot Card, list prices).

import type { PlotId, PlotState, UiLampMode, UiStore } from "@moon-cleanup/shared";
import { HUD_WRITE_HZ } from "./hud-writer";
import type { MenuWriter } from "./menu-writer";

/** Out-buffer of `pickPlot` (same shape as the sim's `PlotCardData`). */
export interface PlotCardOut {
  plotId: PlotId;
  state: PlotState;
  remainingPct: number;
  terrainId: string | null;
  creditedSlot: number | null;
  countsTowardShine: boolean;
  shinePctPerPlot: number;
}

/** Out-buffer of `hopReadout` (sim `HopReadout`). */
export interface HopOut {
  bursts: number;
  max: number;
  recharge01: number;
}

/** Out-buffer of `lampReadout` (sim `LampReadout`). */
export interface LampOut {
  level: number;
  switchedOn: boolean;
  lit: boolean;
}

/** The sim reads the HUD needs. Method syntax on purpose (bivariant parameters: the sim's branded slot type fits). */
export interface SimReadoutSource {
  /** Plot `aimM` metres ahead of the avatar (default: the tool reticle distance). False when there is none. */
  pickPlot(slot: number, out: PlotCardOut, aimM?: number): boolean;
  hopReadout(slot: number, out: HopOut): boolean;
  lampReadout(slot: number, out: LampOut): boolean;
  /** Next purchase price; 0 = free handback, -1 = not buyable. */
  quotePriceLm(slot: number, itemId: string): number;
}

/** Compass outpost as the sim lists it (`outpost(k, out)`), reduced to what the chip needs. */
export interface CompassOutpostInput {
  readonly id: string;
  readonly visited: boolean;
}

/** Accent token of the Boreal chip (art-direction 7.1); every MVP outpost is Boreal. */
export const COMPASS_ACCENT = "teal";

export interface ReadoutWriterOptions {
  readonly store: Pick<UiStore, "dispatch">;
  /** Own actor slot: 0 in Solo. */
  readonly mySlot: () => number;
}

export class ReadoutWriter {
  private readonly minIntervalMs = 1000 / HUD_WRITE_HZ;
  private lastMs = Number.NEGATIVE_INFINITY;
  private source: SimReadoutSource | null = null;
  private inspecting = false;

  private readonly hop: HopOut = { bursts: 0, max: 0, recharge01: 0 };
  private readonly lamp: LampOut = { level: 0, switchedOn: false, lit: false };
  private readonly card: PlotCardOut = {
    plotId: 0 as PlotId,
    state: 0 as PlotState,
    remainingPct: 100,
    terrainId: null,
    creditedSlot: null,
    countsTowardShine: false,
    shinePctPerPlot: 0,
  };

  // Written values (so an unchanged read dispatches nothing). -1 = nothing written.
  private wBursts = -1;
  private wMax = -1;
  private wPct = -1;
  private wLampLevel = -1;
  private wLit = false;
  private wCardOpen = false;
  private wPlot = -1;
  private wState = -1;
  private wRemaining = -1;
  private wCredited: number | null = null;

  constructor(private readonly options: ReadoutWriterOptions) {}

  /** Attaches (or detaches, `null`) the sim reads. Detaching clears what was written. */
  setSource(source: SimReadoutSource | null): void {
    if (source === this.source) return;
    const had = this.source !== null;
    this.source = source;
    this.lastMs = Number.NEGATIVE_INFINITY;
    if (had) this.clear();
  }

  /** The player is inspecting a plot (Plot Card key held / toggled). The card is written only while true. */
  setInspecting(on: boolean): void {
    this.inspecting = on;
  }

  /** Compass chips (written once; the list is static in the MVP). */
  setOutposts(outposts: readonly CompassOutpostInput[]): void {
    this.options.store.dispatch({
      type: "compass.set",
      patch: { outposts: outposts.map((o) => ({ id: o.id, visited: o.visited, accent: COMPASS_ACCENT })) },
    });
  }

  /** Once per frame before the store flush. */
  pump(nowMs: number): void {
    const src = this.source;
    if (src === null || nowMs - this.lastMs < this.minIntervalMs) return;
    this.lastMs = nowMs;
    const slot = this.options.mySlot();
    this.pumpSuit(src, slot);
    this.pumpPlotCard(src, slot);
  }

  private pumpSuit(src: SimReadoutSource, slot: number): void {
    const hop = this.hop;
    const lamp = this.lamp;
    if (!src.hopReadout(slot, hop) || !src.lampReadout(slot, lamp)) return;
    const pct = hop.max > 0 ? Math.round(hop.recharge01 * 100) : 0;
    if (
      hop.bursts === this.wBursts &&
      hop.max === this.wMax &&
      pct === this.wPct &&
      lamp.level === this.wLampLevel &&
      lamp.lit === this.wLit
    ) {
      return;
    }
    this.wBursts = hop.bursts;
    this.wMax = hop.max;
    this.wPct = pct;
    this.wLampLevel = lamp.level;
    this.wLit = lamp.lit;
    const mode: UiLampMode = lamp.lit ? "lamp" : "off";
    this.options.store.dispatch({
      type: "suit.set",
      patch: {
        lampLevel: lamp.level,
        lampMode: mode,
        // max 0 = no Hop Pack: the HUD hides the gauge.
        hop: hop.max > 0 ? { bursts: hop.bursts, max: hop.max, rechargePct: pct } : null,
      },
    });
  }

  private pumpPlotCard(src: SimReadoutSource, slot: number): void {
    if (!this.inspecting) {
      if (this.wCardOpen) this.closeCard();
      return;
    }
    const c = this.card;
    if (!src.pickPlot(slot, c)) {
      if (this.wCardOpen) this.closeCard();
      return;
    }
    if (
      this.wCardOpen &&
      c.plotId === this.wPlot &&
      c.state === this.wState &&
      c.remainingPct === this.wRemaining &&
      c.creditedSlot === this.wCredited
    ) {
      return;
    }
    this.wCardOpen = true;
    this.wPlot = c.plotId;
    this.wState = c.state;
    this.wRemaining = c.remainingPct;
    this.wCredited = c.creditedSlot;
    this.options.store.dispatch({
      type: "plotCard.set",
      patch: {
        open: true,
        plotId: c.plotId,
        label: String(c.plotId),
        state: c.state,
        remainingPct: c.remainingPct,
        terrainId: c.terrainId,
        creditedSlot: c.creditedSlot,
      },
    });
  }

  private closeCard(): void {
    this.wCardOpen = false;
    this.wPlot = -1;
    this.wState = -1;
    this.wRemaining = -1;
    this.wCredited = null;
    this.options.store.dispatch({ type: "plotCard.set", patch: { open: false } });
  }

  private clear(): void {
    this.wBursts = -1;
    this.wMax = -1;
    this.wPct = -1;
    this.wLampLevel = -1;
    this.wLit = false;
    this.options.store.dispatch({ type: "suit.set", patch: { lampLevel: 0, lampMode: "off", hop: null } });
    if (this.wCardOpen) this.closeCard();
  }
}

/**
 * Binds one sim read source to the HUD writers: Hop / Lamp / Plot Card (ReadoutWriter) and Desk / Board prices
 * (MenuWriter, quoted for the own slot). `null` detaches both.
 */
export function attachSimReadouts(
  targets: { readonly readouts: ReadoutWriter; readonly menus: Pick<MenuWriter, "setQuote">; mySlot: () => number },
  source: SimReadoutSource | null,
): void {
  targets.readouts.setSource(source);
  targets.menus.setQuote(source === null ? null : (itemId) => source.quotePriceLm(targets.mySlot(), itemId));
}
