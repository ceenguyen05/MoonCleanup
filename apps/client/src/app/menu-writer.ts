// Menu slices writer and UI frame bridge (composition-root glue, M1 integrator round 5).
//
// MenuWriter: `desk.items` (tools and the MVP suit-gear lines) and `board.nodes` / `board.caps` (Promotions Board /
// Ops Console) from game-data plus the room host's shift state (owned tools, suit-gear and board levels, Roosts).
// Shift state arrives only on change; the writer marks dirty and writes at most HUD_WRITE_HZ.
//
// UiFrameBridge (once per frame before the UI flush): gamepad menu edges -> `UiModule.navigate`, an interact press in
// reach of the Desk -> `menus.open requisitions_desk`, and the look yaw -> `UiModule.setCompassHeading`. No allocation
// unless a press happened; the compass write is skipped when the heading did not change.
//
// Prices shown: the sim's own quote when a quote source is attached (`setQuote`, `quotePriceLm`: Rebate, Repeat
// Requisition and Roost growth included), otherwise list prices with the Rebate estimate (`setPricing`). The sim stays
// authoritative and answers through `purchase.completed` / `purchase.rejected`.

import type { GameData } from "@moon-cleanup/game-data";
import {
  MVP_SCOPE,
  type RoomHost,
  type RoomHostService,
  type ShiftStateView,
  type UiBoardNode,
  type UiDeskItem,
  type UiStore,
  type Unsubscribe,
} from "@moon-cleanup/shared";
import {
  PAD_NAV_BACK,
  PAD_NAV_CONFIRM,
  PAD_NAV_DOWN,
  PAD_NAV_LEFT,
  PAD_NAV_NEXT,
  PAD_NAV_PREV,
  PAD_NAV_RIGHT,
  PAD_NAV_UP,
} from "../gameplay";
import type { UiNavAction } from "../ui";
import { HUD_WRITE_HZ } from "./hud-writer";

export interface MenuCatalog {
  readonly tools: readonly { readonly id: string; readonly tier: number; readonly priceLm: number }[];
  /** Suit-gear lines offered in the MVP, with their sell cap. */
  readonly gear: readonly { readonly id: string; readonly costsLm: readonly number[]; readonly cap: number }[];
  readonly nodes: readonly {
    readonly id: string;
    readonly departmentId: string;
    readonly costsLm: readonly number[];
    readonly max: number;
    /** Each entry is met when any of its alternatives is (a plain prerequisite is a one-element list). */
    readonly prereqs: readonly (readonly { readonly nodeId: string; readonly level: number }[])[];
  }[];
  readonly hubId: string;
  readonly roostCap: number;
}

const CELL_NODE_PREFIX = "node.dust_cell_";

/** Every Desk / Board item id the menus quote (tools, suit gear, board nodes). */
export function catalogItemIds(cat: MenuCatalog): string[] {
  return [...cat.tools.map((t) => t.id), ...cat.gear.map((g) => g.id), ...cat.nodes.map((n) => n.id)];
}

export function menuCatalogFromGameData(data: GameData): MenuCatalog {
  const board = data["promotions-board"];
  const offered = new Set<string>(MVP_SCOPE.boardNodeIds);
  const gearCaps: Readonly<Record<string, number>> = MVP_SCOPE.suitGearMaxLevel;
  return {
    tools: data.tools.tools.map((t) => ({ id: t.id, tier: t.tier, priceLm: t.priceLm })),
    gear: data["suit-gear"].lines.flatMap((l) => {
      const cap = Math.min(Math.floor(gearCaps[l.id] ?? 0), l.levels.length);
      return cap > 0 ? [{ id: l.id, costsLm: l.levels.map((v) => v.costLm), cap }] : [];
    }),
    nodes: board.nodes
      .filter((n) => offered.has(n.id))
      .map((n) => ({
        id: n.id,
        departmentId: n.departmentId,
        costsLm: n.levels.map((v) => v.costLm),
        max: n.id.startsWith(CELL_NODE_PREFIX)
          ? Math.min(n.levels.length, MVP_SCOPE.dustCellMaxLevel)
          : n.levels.length,
        prereqs: (n.prereqs ?? []).map((p) =>
          "anyOf" in p
            ? p.anyOf.map((a) => ({ nodeId: a.nodeId, level: a.level }))
            : [{ nodeId: p.nodeId, level: p.level }],
        ),
      })),
    hubId: board.hubId,
    roostCap: MVP_SCOPE.roostCap,
  };
}

/**
 * The sim's Rebate pricing, built from `@moon-cleanup/sim` (PromotionsBoard, discountedPriceLm) in the app's lazy sim
 * chunk. Without it the menus show list prices. Repeat Requisition (a tier's second copy) needs the sim's quote
 * (`MenuWriter.setQuote`): shift state does not carry copies bought, so without a quote those rows show the first-copy
 * price.
 */
export interface MenuPricing {
  /** Rebate fraction for these board levels (sim `purchaseDiscountFrac`). */
  discountFrac(levels: Readonly<Record<string, number>>): number;
  /** Rebate covers tools and Dust Cell nodes; other nodes and suit gear pay list. */
  isCellNode(nodeId: string): boolean;
  discounted(listLm: number, frac: number): number;
}

/** Structural view of the sim's PromotionsBoard (only what pricing reads). */
export interface BoardLike {
  readonly nodeIds: readonly string[];
  readonly isCellNode: readonly boolean[];
  indexOf(id: string): number;
  stat(levels: ArrayLike<number>, stat: string, base: number): number;
}

export function createMenuPricing(
  board: BoardLike,
  discountStat: string,
  discounted: (listLm: number, frac: number) => number,
): MenuPricing {
  const levels = new Uint8Array(board.nodeIds.length);
  return {
    discountFrac(rec) {
      for (let k = 0; k < levels.length; k++) levels[k] = rec[board.nodeIds[k]!] ?? 0;
      return Math.max(0, board.stat(levels, discountStat, 0));
    },
    isCellNode(id) {
      const n = board.indexOf(id);
      return n >= 0 && board.isCellNode[n] === true;
    },
    discounted,
  };
}

/**
 * The sim's quote for the own actor (`MoonRoomSim.quotePriceLm`): what the next purchase charges with Rebate, Repeat
 * Requisition and Roost growth; 0 = owned tool handed back free; negative = not buyable (keep the list-derived price).
 */
export type PriceQuote = (itemId: string) => number;

export function deskItems(
  cat: MenuCatalog,
  s: ShiftStateView,
  mySlot: number,
  pricing: MenuPricing | null = null,
  quote: PriceQuote | null = null,
): UiDeskItem[] {
  const frac = pricing === null ? 0 : pricing.discountFrac(s.sharedUpgrades);
  const me = s.players.find((p) => p.slot === mySlot);
  const owned = me?.toolsOwned ?? 0;
  const items: UiDeskItem[] = cat.tools.map((t, k) => {
    const q = quote === null ? -1 : quote(t.id);
    return {
      itemId: t.id,
      category: "tool",
      tier: t.tier,
      levelOwned: (owned & (1 << k)) !== 0 ? 1 : 0,
      levelMax: 1,
      listPriceLm: t.priceLm,
      priceLm: q >= 0 ? q : pricing === null ? t.priceLm : pricing.discounted(t.priceLm, frac),
      standardIssue: t.priceLm === 0,
      requires: [],
    };
  });
  for (const g of cat.gear) {
    const level = s.suitGear[g.id] ?? 0;
    const price = g.costsLm[Math.min(level, g.costsLm.length - 1)] ?? 0;
    const q = quote === null ? -1 : quote(g.id);
    items.push({
      itemId: g.id,
      category: "gear",
      tier: 1,
      levelOwned: level,
      levelMax: g.cap,
      listPriceLm: price,
      priceLm: q >= 0 ? q : price,
      standardIssue: false,
      requires: [],
    });
  }
  return items;
}

export function boardNodes(
  cat: MenuCatalog,
  s: ShiftStateView,
  pricing: MenuPricing | null = null,
  quote: PriceQuote | null = null,
): UiBoardNode[] {
  const levels = s.sharedUpgrades;
  const frac = pricing === null ? 0 : pricing.discountFrac(levels);
  return cat.nodes.map((n) => {
    const level = levels[n.id] ?? 0;
    // The hub (Employee Badge) is held from the start of a shift.
    const met = (p: { readonly nodeId: string; readonly level: number }): boolean =>
      p.nodeId === cat.hubId || (levels[p.nodeId] ?? 0) >= p.level;
    const requires = n.prereqs.filter((group) => !group.some(met)).map((group) => group[0]!.nodeId);
    const list = level >= n.max ? null : (n.costsLm[level] ?? null);
    const q = list === null || quote === null ? -1 : quote(n.id);
    return {
      nodeId: n.id,
      departmentId: n.departmentId,
      level,
      max: n.max,
      nextCostLm:
        q >= 0
          ? q
          : list !== null && pricing !== null && pricing.isCellNode(n.id)
            ? pricing.discounted(list, frac)
            : list,
      prereqMet: requires.length === 0,
      requires,
    };
  });
}

export class MenuWriter {
  private readonly minIntervalMs = 1000 / HUD_WRITE_HZ;
  private lastMs = Number.NEGATIVE_INFINITY;
  private host: RoomHost | null = null;
  private off: Unsubscribe | null = null;
  private shift: ShiftStateView | null = null;
  private catalog: MenuCatalog | null = null;
  private pricing: MenuPricing | null = null;
  private quote: PriceQuote | null = null;
  private dirty = false;

  constructor(private readonly store: Pick<UiStore, "dispatch" | "getState">) {}

  follow(service: RoomHostService): Unsubscribe {
    this.bind(service.current);
    return service.onChange((h) => this.bind(h));
  }

  bind(host: RoomHost | null): void {
    if (host === this.host) return;
    this.off?.();
    this.off = null;
    this.host = host;
    this.shift = null;
    if (host !== null) {
      this.off = host.onShiftState((s) => {
        this.shift = s;
        this.dirty = true;
      });
    }
  }

  /** The sim's Rebate pricing (lazy sim chunk); rows are rewritten with it. */
  setPricing(pricing: MenuPricing): void {
    this.pricing = pricing;
    this.dirty = true;
  }

  /** The sim's price quote for the own actor (see `PriceQuote`); `null` returns to list/Rebate prices. */
  setQuote(quote: PriceQuote | null): void {
    this.quote = quote;
    this.dirty = true;
  }

  setCatalog(catalog: MenuCatalog): void {
    this.catalog = catalog;
    this.dirty = true;
  }

  pump(nowMs: number): void {
    if (!this.dirty || nowMs - this.lastMs < this.minIntervalMs) return;
    const s = this.shift;
    const cat = this.catalog;
    if (s === null || cat === null) return;
    this.lastMs = nowMs;
    this.dirty = false;
    const mySlot = this.host?.kind === "local" ? 0 : this.store.getState().shift.mySlot;
    let roosts = 0;
    for (const n of Object.values(s.robotCounts)) roosts += n;
    this.store.dispatch({ type: "desk.set", patch: { items: deskItems(cat, s, mySlot, this.pricing, this.quote) } });
    this.store.dispatch({
      type: "board.set",
      patch: {
        nodes: boardNodes(cat, s, this.pricing, this.quote),
        caps: { roost: { used: roosts, cap: cat.roostCap } },
      },
    });
  }

  dispose(): void {
    this.bind(null);
  }
}

/** The UI module as the bridge drives it. */
export interface UiFrameTarget {
  navigate(action: UiNavAction): boolean;
  setCompassHeading(headingDeg: number): void;
  /** Rebinding capture in progress: "pad" = route every pad press to `offerInput` instead of menu navigation. */
  capturing(): "key" | "pad" | null;
  offerInput(code: string): boolean;
}

/** The input state as the bridge reads it (gameplay `InputState`). */
export interface BridgeInput {
  readonly yawRad: number;
  takeNav(): number;
  takeInteractPresses(): number;
  /** Plot Card key presses (C) since the last call. */
  takePlotCardToggles(): number;
  /** Newly pressed gamepad buttons as a bit mask (bit i = Pad<i>). */
  takePadEdges(): number;
  /** Game actions off while a menu is open (gameplay `InputState.setSuspended`). */
  setSuspended(on: boolean): void;
}

const NAV_BITS: readonly (readonly [number, UiNavAction])[] = [
  [PAD_NAV_UP, "up"],
  [PAD_NAV_DOWN, "down"],
  [PAD_NAV_LEFT, "left"],
  [PAD_NAV_RIGHT, "right"],
  [PAD_NAV_PREV, "prev"],
  [PAD_NAV_NEXT, "next"],
  [PAD_NAV_CONFIRM, "confirm"],
  [PAD_NAV_BACK, "back"],
];

export interface UiFrameBridgeOptions {
  readonly store: Pick<UiStore, "dispatch" | "getState">;
  readonly ui: UiFrameTarget;
  readonly input: BridgeInput;
  /** Kind of the station prompt shown now (InteractionWriter.currentKind). */
  readonly station: () => string | null;
  /** The Plot Card was toggled by the player (true = inspecting). Absent: the key does nothing. */
  readonly onInspect?: (on: boolean) => void;
}

export class UiFrameBridge {
  private lastHeading = Number.NaN;
  private inspecting = false;

  constructor(private readonly o: UiFrameBridgeOptions) {}

  pump(): void {
    const { input, ui, store } = this.o;
    // A modal (the save-conflict "Which copy?" prompt) suspends game input and takes pad navigation like a menu.
    const menus = store.getState().menus;
    const menuOpen = menus.open !== null || menus.modal !== null;
    input.setSuspended(menuOpen);
    let nav = input.takeNav();
    const presses = input.takeInteractPresses();
    // Rebinding a gamepad button: every press (B included) goes to the capture, none to menu navigation.
    const padEdges = input.takePadEdges();
    if (padEdges !== 0 && ui.capturing() === "pad") {
      for (let i = 0; i < 17; i++) if ((padEdges & (1 << i)) !== 0 && ui.offerInput(`Pad${i}`)) break;
      nav = 0;
    }
    // Plot Card (C): toggles; a menu opening closes it.
    const toggles = input.takePlotCardToggles();
    const want = menuOpen ? false : toggles % 2 === 1 ? !this.inspecting : this.inspecting;
    if (want !== this.inspecting) {
      this.inspecting = want;
      this.o.onInspect?.(want);
    }
    if (nav !== 0 || presses !== 0) {
      if (menuOpen) {
        for (const [bit, action] of NAV_BITS) if ((nav & bit) !== 0) ui.navigate(action);
      } else if (presses > 0 && this.o.station() === "desk") {
        store.dispatch({ type: "menus.open", surface: "requisitions_desk" });
      }
    }
    // Heading: 0 = north, clockwise (yaw + toward east).
    const deg = (input.yawRad * 180) / Math.PI;
    if (deg !== this.lastHeading) {
      this.lastHeading = deg;
      ui.setCompassHeading(deg);
    }
  }
}
