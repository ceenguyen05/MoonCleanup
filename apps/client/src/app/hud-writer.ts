// HUD store writer (composition root glue): turns the room host's low-rate shift state and sim events into the UI
// store slices the in-game HUD reads (`shift`, `wallet`, `shine`, `holster`, `suit.day`, `nextReq`, `notices`).
//
// Solo-first rules:
// - Nothing here runs in the input or sim path. Host listeners only copy numbers and set dirty flags; `pump(nowMs)` is
//   called once per frame right before the UI store flush and returns immediately (no allocation) unless a slice is
//   dirty AND at least 1 / HUD_WRITE_HZ seconds passed since the last write. Patches are built only on change.
// - Rare discrete events (Stamp, sale, purchase, milestone, Cell full, funding tick) dispatch their wallet deltas and
//   notices straight away; the store applies them at its own <= 15 Hz flush.
// - Text ids are the UI catalog's (`notice.*`, `prompt.*`); unknown ids render nothing.

import type {
  RoomHost,
  RoomHostService,
  RoomSimEvent,
  ShiftStateView,
  UiAction,
  UiCellLevel,
  UiHolsterSlot,
  UiStore,
  Unsubscribe,
  WalletDeltaSource,
} from "@moon-cleanup/shared";

/** Highest rate the writer patches continuous slices (Cell gauge, Shine, day ring). Below the store's 15 Hz. */
export const HUD_WRITE_HZ = 10;

/** Game-data facts the writer needs; loaded lazily by the app (never on the first-frame path). */
export interface HudCatalog {
  /** Tool ids in game-data tool-table order (`toolsOwned` bit k / `equippedTool` index k). */
  readonly toolIds: readonly string[];
  /** Base Dust Cell grams per tool, same order; used until the sim reports the real capacity. */
  readonly cellBaseGrams: readonly number[];
}

export interface HudWriterOptions {
  readonly store: Pick<UiStore, "dispatch" | "getState">;
  /** Wall clock for `UiWalletDelta.atMs`. */
  readonly wallMs?: () => number;
}

const HOLSTER_RIG = "gear.holster_rig";
const cellLevelKey = (toolId: string): string => `cellLevel.${toolId}`;
/** Notice merge keys (one live notice per kind). */
const MERGE = {
  polished: "hud.plot_polished",
  milestone: "hud.shine_milestone",
  cellFull: "hud.cell_full",
  approved: "hud.requisition_approved",
  funded: "hud.requisition_funded",
} as const;

const clampCellLevel = (n: number): UiCellLevel => (n >= 3 ? 3 : n >= 2 ? 2 : n >= 1 ? 1 : 0);

export class HudWriter {
  private readonly minIntervalMs = 1000 / HUD_WRITE_HZ;
  private lastWriteMs = Number.NEGATIVE_INFINITY;
  private host: RoomHost | null = null;
  private offHost: Unsubscribe[] = [];
  private catalog: HudCatalog | null = null;

  // Latest values (plain numbers; copied by listeners, read by pump).
  private shift: ShiftStateView | null = null;
  private running = false;
  private cellGrams = 0;
  /** Capacity reported by the sim for the equipped tool; 0 until the first dust event. */
  private cellCapGrams = 0;
  private dayPhaseDay = true;
  private secondsToTerminator = -1;

  // Dirty flags.
  private dirtyShift = false;
  private dirtyCell = false;
  private dirtyDay = false;
  /** Written values, so an unchanged rounded value is not dispatched again. */
  private writtenCellKgCenti = -1;
  private writtenReady = false;

  private readonly onShiftFn = (state: ShiftStateView): void => {
    this.shift = state;
    this.dirtyShift = true;
  };
  private readonly onEventFn = (event: RoomSimEvent): void => this.onEvent(event);
  private readonly onStateFn = (): void => {
    const running = this.host !== null && this.host.state === "running";
    if (running !== this.running) {
      this.running = running;
      this.dirtyShift = true;
    }
  };

  constructor(private readonly options: HudWriterOptions) {}

  /** Follows the `roomHost` facade; returns the unsubscribe. */
  follow(service: RoomHostService): Unsubscribe {
    this.bind(service.current);
    return service.onChange((host) => this.bind(host));
  }

  setCatalog(catalog: HudCatalog): void {
    this.catalog = catalog;
    this.dirtyShift = true;
    this.dirtyCell = true;
  }

  /** Own actor slot: 0 in Solo; the session's slot on a remote host. */
  private mySlot(): number {
    return this.host?.kind === "local" ? 0 : this.options.store.getState().shift.mySlot;
  }

  bind(host: RoomHost | null): void {
    if (host === this.host) return;
    for (const off of this.offHost) off();
    this.offHost = [];
    this.host = host;
    this.shift = null;
    this.cellGrams = 0;
    this.cellCapGrams = 0;
    this.secondsToTerminator = -1;
    this.writtenCellKgCenti = -1;
    this.running = false;
    this.dirtyShift = true;
    if (host === null) return;
    this.offHost.push(
      host.onShiftState(this.onShiftFn),
      host.onEvent(this.onEventFn),
      host.onStateChange(this.onStateFn),
    );
    this.onStateFn();
  }

  dispose(): void {
    this.bind(null);
  }

  /** Called once per frame before the store flush. Cheap and allocation-free unless something is due. */
  pump(nowMs: number): void {
    if (!(this.dirtyShift || this.dirtyCell || this.dirtyDay)) return;
    if (nowMs - this.lastWriteMs < this.minIntervalMs) return;
    this.lastWriteMs = nowMs;
    const dispatch = this.options.store.dispatch;
    if (this.dirtyShift) {
      this.dirtyShift = false;
      this.writeShift(dispatch);
    }
    if (this.dirtyCell) {
      this.dirtyCell = false;
      this.writeHolster(dispatch, false);
    }
    if (this.dirtyDay) {
      this.dirtyDay = false;
      this.writeDay(dispatch);
    }
  }

  private writeShift(dispatch: (a: UiAction) => void): void {
    const s = this.shift;
    const ready = this.host !== null && this.running && s !== null;
    if (ready !== this.writtenReady || ready) {
      if (s !== null) {
        dispatch({
          type: "shift.set",
          patch: {
            ready,
            contractId: s.contractId,
            // The UI knows Solo and Private Shifts; an Open Shift leaves the session writer's value alone.
            ...(s.shiftType === "open" ? {} : { shiftType: s.shiftType }),
            elapsedS: s.tick / Math.max(1, s.simTickHz),
          },
        });
      } else dispatch({ type: "shift.set", patch: { ready: false } });
      this.writtenReady = ready;
    }
    if (s === null) return;
    dispatch({ type: "wallet.set", patch: { lm: s.walletLumens } });
    // The Shine total is always a real plot count: a snapshot without one (0, not finite) keeps the last known total
    // (the slice starts at the standard Moon's count), so the "Which copy?" prompt never falls back to plot counts.
    const known = this.options.store.getState().shine.total;
    const total = Number.isFinite(s.plotCount) && s.plotCount > 0 ? s.plotCount : known;
    dispatch({
      type: "shine.set",
      patch: { polished: s.shinePolished, total, pct: total > 0 ? (s.shinePolished / total) * 100 : 0 },
    });
    this.writeHolster(dispatch, true);
  }

  private writeHolster(dispatch: (a: UiAction) => void, force: boolean): void {
    const s = this.shift;
    const cat = this.catalog;
    if (s === null || cat === null) return;
    const me = s.players.find((p) => p.slot === this.mySlot());
    if (me === undefined) return;
    const centi = Math.round(this.cellGrams / 10);
    if (!force && centi === this.writtenCellKgCenti) return;
    this.writtenCellKgCenti = centi;
    const slotCount = (s.suitGear[HOLSTER_RIG] ?? 0) >= 1 ? 2 : 1;
    // Equipped tool first, then other owned tools in table order up to the slot count. The real Holster order is the
    // sim's (economy agent is adding Holster gating); this list is display-only.
    const order: number[] = [me.equippedTool];
    for (let k = 0; k < cat.toolIds.length && order.length < slotCount; k++) {
      if (k !== me.equippedTool && (me.toolsOwned & (1 << k)) !== 0) order.push(k);
    }
    const slots: UiHolsterSlot[] = order.map((k, i) => {
      const toolId = cat.toolIds[k] ?? null;
      const level = toolId === null ? 0 : (s.suitGear[cellLevelKey(toolId)] ?? 0);
      const capGrams = i === 0 && this.cellCapGrams > 0 ? this.cellCapGrams : (cat.cellBaseGrams[k] ?? 0);
      return {
        toolId,
        owned: (me.toolsOwned & (1 << k)) !== 0,
        // Only the equipped tool's Cell is reported live (dust events); others show empty until the sim exposes them.
        cellKg: i === 0 ? this.cellGrams / 1000 : 0,
        cellCapKg: capGrams / 1000,
        cellLevel: clampCellLevel(level),
      };
    });
    dispatch({ type: "holster.set", patch: { slots, active: 0, slotCount } });
  }

  private writeDay(dispatch: (a: UiAction) => void): void {
    if (this.secondsToTerminator < 0) return;
    const day = this.options.store.getState().suit.day;
    dispatch({
      type: "suit.set",
      patch: {
        day: {
          isDay: this.dayPhaseDay,
          minutesToTerminator: Math.max(0, Math.round(this.secondsToTerminator / 60)),
          ringFrac01: day.ringFrac01,
        },
      },
    });
  }

  private delta(amountLm: number, source: WalletDeltaSource, actorSlot: number | null): void {
    if (amountLm === 0) return;
    const atMs = (this.options.wallMs ?? Date.now)();
    // `settle`: the authoritative total arrives with the shift state (wallet.set); the delta only feeds floaters.
    this.options.store.dispatch({ type: "wallet.delta", delta: { amountLm, source, actorSlot, atMs }, settle: true });
  }

  private onEvent(event: RoomSimEvent): void {
    const dispatch = this.options.store.dispatch;
    const me = this.mySlot();
    switch (event.name) {
      case "dust.collected": {
        const p = event.payload;
        if (p.actorSlot !== me) return;
        this.cellGrams = p.cellGrams;
        this.cellCapGrams = p.cellCapGrams;
        this.dirtyCell = true;
        return;
      }
      case "cell.full": {
        const p = event.payload;
        if (p.actorSlot !== me) return;
        this.cellGrams = p.cellCapGrams;
        this.cellCapGrams = p.cellCapGrams;
        this.dirtyCell = true;
        dispatch({
          type: "notices.push",
          notice: {
            priority: "action",
            textId: "notice.cell_full",
            params: {},
            mergeKey: MERGE.cellFull,
            actionId: "pour",
          },
        });
        return;
      }
      case "plot.polished": {
        const p = event.payload;
        this.delta(p.stampLm, "stamp", p.creditedSlot);
        if (p.creditedSlot !== me) return;
        dispatch({
          type: "notices.push",
          notice: {
            priority: "ambient",
            textId: "notice.plot_polished",
            params: { plot: p.plotId },
            mergeKey: MERGE.polished,
            actionId: null,
          },
        });
        return;
      }
      case "shine.milestone": {
        const p = event.payload;
        dispatch({ type: "shine.set", patch: { milestonePct: p.pct } });
        dispatch({
          type: "notices.push",
          notice: {
            priority: "progress",
            textId: "notice.shine_milestone",
            params: { pct: p.pct },
            mergeKey: MERGE.milestone,
            actionId: null,
          },
        });
        return;
      }
      case "cargo.sold":
        this.delta(event.payload.lm, "sale", event.payload.actorSlot);
        if (event.payload.actorSlot === me) {
          // A pour or sale empties the Cell; the next dust event reports the new amount.
          this.cellGrams = 0;
          this.dirtyCell = true;
        }
        return;
      case "purchase.completed": {
        const p = event.payload;
        this.delta(-p.priceLm, "purchase", p.actorSlot);
        const tracked = this.options.store.getState().nextReq.itemId;
        if (tracked === p.itemId) dispatch({ type: "nextReq.set", patch: { fundedPct: 100 } });
        dispatch({
          type: "notices.push",
          notice: {
            priority: "progress",
            textId: "notice.requisition_approved",
            params: {},
            mergeKey: MERGE.approved,
            actionId: null,
          },
        });
        return;
      }
      case "requisition.progress": {
        const p = event.payload;
        dispatch({ type: "nextReq.set", patch: { itemId: p.itemId, fundedPct: p.pct, lastPingStep: p.pct } });
        dispatch({
          type: "notices.push",
          notice: {
            priority: "ambient",
            textId: "notice.requisition_funded",
            params: { pct: p.pct },
            mergeKey: MERGE.funded,
            actionId: null,
          },
        });
        return;
      }
      case "daynight.changed": {
        const p = event.payload;
        this.dayPhaseDay = p.phase === "day" || p.phase === "dawn";
        this.secondsToTerminator = p.secondsToTerminator;
        this.dirtyDay = true;
        return;
      }
      default:
        return;
    }
  }
}

/** The store the UI module flushes, with the HUD writer pumped right before each flush (same state, same listeners). */
export function withHudPump<S extends UiStore & { flush(nowMs: number): boolean }>(
  store: S,
  writer: HudWriter,
  extra: { pump(nowMs: number): void } | null = null,
): S {
  return {
    ...store,
    flush(nowMs: number): boolean {
      writer.pump(nowMs);
      extra?.pump(nowMs);
      return store.flush(nowMs);
    },
  };
}
