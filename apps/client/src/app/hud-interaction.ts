// HUD interaction prompt writer and purchase port (composition-root glue, M1 integrator round 5).
//
// InteractionWriter: from the own avatar's position (gameplay's camera-rig feet, moon-centred metres) and the outpost
// stations (the sim's sell points: Assay Counter and Receiving Gates, plus a Desk stand-in), writes `interaction.set`
// with the `prompt.*` ids of the UI catalog. Throttled to HUD_WRITE_HZ; it dispatches only when the nearest station in
// reach changes, and it never allocates per frame (prompts are built once).
//
// PurchasePort: what the UI calls to buy a board node / suit-gear line / tool. Sends a `purchase` control intent to
// the current room host (Solo LocalRoom or a remote room), keeps `desk.pending` and `wallet.pendingSpendLm` honest, and
// turns the own actor's `purchase.rejected` into a notice (`purchase.completed` notices come from the HudWriter).

import {
  RequestIdSchema,
  type RoomHost,
  type RoomSimEvent,
  type UiInteractionPrompt,
  type UiStore,
  type Unsubscribe,
} from "@moon-cleanup/shared";
import { HUD_WRITE_HZ } from "./hud-writer";

export type StationKind = "assay_counter" | "receiving_gate" | "desk";

/** One interactable outpost service: unit direction from the Moon centre and its reach in metres. */
export interface OutpostStation {
  readonly kind: StationKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly reachM: number;
}

/** Sell point as `@moon-cleanup/sim` reports it (structural, so this file does not import the sim). */
export interface SellPointLike {
  readonly kind: "assay_counter" | "receiving_gate";
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Requisitions Desk stand-in: no outpost layout gives the Desk a position yet (sim purchases need no proximity), so it
 * sits this far from the Assay Counter, between the north and east Gates. Replace when the outpost layout lands.
 */
export const DESK_STAND_IN_OFFSET_M = 6;
/** Desk prompt reach (m); same as the Assay Counter pour reach until a feel spec number exists. */
export const DESK_REACH_M = 2.5;

/**
 * Stations from the sim's sell points: pours at the Assay Counter (`assayReachM`, sim ASSAY_POUR_REACH_M), the Dump
 * Plate of each Gate (`plateRadiusM`, sim DUMP_PLATE_RADIUS_M), and the Desk stand-in next to the first counter.
 */
export function outpostStations(
  points: readonly SellPointLike[],
  moonRadiusM: number,
  assayReachM: number,
  plateRadiusM: number,
): OutpostStation[] {
  const out: OutpostStation[] = points.map((p) => ({
    kind: p.kind,
    x: p.x,
    y: p.y,
    z: p.z,
    reachM: p.kind === "assay_counter" ? assayReachM : plateRadiusM,
  }));
  const counter = points.find((p) => p.kind === "assay_counter");
  if (counter !== undefined) {
    // Tangent offset toward +X / -Z (north-east of the counter), renormalised onto the unit sphere.
    const d = DESK_STAND_IN_OFFSET_M / moonRadiusM / Math.SQRT2;
    const x = counter.x + d;
    const y = counter.y;
    const z = counter.z - d;
    const l = Math.hypot(x, y, z);
    out.push({ kind: "desk", x: x / l, y: y / l, z: z / l, reachM: DESK_REACH_M });
  }
  return out;
}

const PROMPTS: Record<StationKind, UiInteractionPrompt> = {
  assay_counter: { actionId: "pour", labelId: "prompt.assay", hold: true, holdMs: 0, blockedReasonId: null },
  receiving_gate: { actionId: "pour", labelId: "prompt.pour", hold: false, holdMs: 0, blockedReasonId: null },
  desk: { actionId: "open_desk", labelId: "prompt.open_desk", hold: false, holdMs: 0, blockedReasonId: null },
};

export interface InteractionWriterOptions {
  readonly store: Pick<UiStore, "dispatch">;
  /** Writes the own avatar's moon-centred position into `out[0..2]`; false while unknown. */
  readonly samplePos: (out: Float64Array) => boolean;
  readonly moonRadiusM: number;
  readonly stations: readonly OutpostStation[];
}

export class InteractionWriter {
  private readonly minIntervalMs = 1000 / HUD_WRITE_HZ;
  private lastMs = Number.NEGATIVE_INFINITY;
  private readonly pos = new Float64Array(3);
  /** Station index written last; -1 = no prompt, -2 = nothing written yet. */
  private written = -2;

  constructor(private readonly options: InteractionWriterOptions) {}

  /** Kind of the station whose prompt is shown now, or null. */
  get currentKind(): StationKind | null {
    return this.written >= 0 ? this.options.stations[this.written]!.kind : null;
  }

  /** Index of the nearest station in reach of the current position, or -1. */
  nearest(): number {
    if (!this.options.samplePos(this.pos)) return -1;
    const p = this.pos;
    const l = Math.hypot(p[0]!, p[1]!, p[2]!);
    if (l === 0) return -1;
    const ux = p[0]! / l;
    const uy = p[1]! / l;
    const uz = p[2]! / l;
    const st = this.options.stations;
    const R = this.options.moonRadiusM;
    let best = -1;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let k = 0; k < st.length; k++) {
      const s = st[k]!;
      const dx = ux - s.x;
      const dy = uy - s.y;
      const dz = uz - s.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const r = s.reachM / R;
      if (d2 <= r * r && d2 < bestD2) {
        best = k;
        bestD2 = d2;
      }
    }
    return best;
  }

  /** Once per frame before the store flush; at most HUD_WRITE_HZ samples, a dispatch only on change. */
  pump(nowMs: number): void {
    if (nowMs - this.lastMs < this.minIntervalMs) return;
    this.lastMs = nowMs;
    const k = this.nearest();
    if (k === this.written) return;
    this.written = k;
    const prompt = k < 0 ? null : PROMPTS[this.options.stations[k]!.kind];
    this.options.store.dispatch({ type: "interaction.set", patch: { prompt } });
  }
}

// ---- Purchases ---------------------------------------------------------------------------------------------------

/** Merge key of the purchase-refused notice (one live notice). */
const MERGE_REJECTED = "hud.purchase_rejected";
/** Text id of the refusal notice; `{reason}` is the sim's PurchaseRejectReason. Needs a UI catalog string. */
export const NOTICE_PURCHASE_REJECTED = "notice.purchase_rejected";

/** The room host as the purchase port needs it (a `RoomHost`; structural so tests can pass a fake). */
export type PurchaseHost = Pick<RoomHost, "kind" | "state" | "sendIntent" | "onEvent">;

export interface PurchasePortOptions {
  /** The `roomHost` service (follows Solo <-> online swaps). */
  readonly roomHost: {
    readonly current: PurchaseHost | null;
    onChange(listener: (host: PurchaseHost | null) => void): Unsubscribe;
  };
  readonly store: Pick<UiStore, "dispatch" | "getState">;
  /** Fresh UUID per request (`crypto.randomUUID`). */
  readonly newRequestId: () => string;
  /** Own actor slot (0 on a local host). */
  readonly mySlot?: () => number;
}

export interface PurchasePort {
  /**
   * Requests one purchase of `itemId` (tool, `node.*` board node, `gear.*` / `cellLevel.*` suit line) from the current
   * room host. Returns the request id, or null when no running host exists (nothing is sent).
   */
  purchase(itemId: string, priceLm?: number): string | null;
  dispose(): void;
}

interface Pending {
  readonly requestId: string;
  readonly itemId: string;
  readonly priceLm: number;
}

export function createPurchasePort(options: PurchasePortOptions): PurchasePort {
  const pending: Pending[] = [];
  let host: PurchaseHost | null = null;
  let offEvent: Unsubscribe | null = null;
  const mySlot = (): number =>
    options.mySlot?.() ?? (host?.kind === "local" ? 0 : options.store.getState().shift.mySlot);

  const publish = (): void => {
    let spend = 0;
    for (const p of pending) spend += p.priceLm;
    options.store.dispatch({ type: "desk.set", patch: { pending: pending.map((p) => p.requestId) } });
    options.store.dispatch({ type: "wallet.set", patch: { pendingSpendLm: spend } });
  };
  const settle = (itemId: string): void => {
    const i = pending.findIndex((p) => p.itemId === itemId);
    if (i < 0) return;
    pending.splice(i, 1);
    publish();
  };
  const onEvent = (event: RoomSimEvent): void => {
    if (event.name === "purchase.completed") {
      if (event.payload.actorSlot === mySlot()) settle(event.payload.itemId);
    } else if (event.name === "purchase.rejected") {
      const p = event.payload;
      if (p.actorSlot !== mySlot()) return;
      settle(p.itemId);
      options.store.dispatch({
        type: "notices.push",
        notice: {
          priority: "action",
          textId: NOTICE_PURCHASE_REJECTED,
          params: { reason: p.reason },
          mergeKey: MERGE_REJECTED,
          actionId: null,
        },
      });
    }
  };
  const bind = (next: PurchaseHost | null): void => {
    if (next === host) return;
    offEvent?.();
    offEvent = null;
    host = next;
    if (pending.length > 0) {
      pending.length = 0;
      publish();
    }
    if (next !== null) offEvent = next.onEvent(onEvent);
  };
  bind(options.roomHost.current);
  const offChange = options.roomHost.onChange(bind);

  return {
    purchase(itemId, priceLm = 0) {
      const h = host;
      if (h === null || h.state !== "running") return null;
      const requestId = RequestIdSchema.parse(options.newRequestId());
      pending.push({ requestId, itemId, priceLm });
      publish();
      h.sendIntent({ kind: "purchase", requestId, itemId });
      return requestId;
    },
    dispose() {
      offChange();
      bind(null);
    },
  };
}
