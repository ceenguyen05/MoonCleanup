import { describe, expect, it } from "vitest";
import {
  STANDARD_GRID_PARAMS,
  type ContractId,
  type PlotId,
  type PlotState,
  type UiAction,
} from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { MoonRoomSim, createRoomDustLedger, type SimWorld } from "@moon-cleanup/sim";
import { createPlotGrid } from "@moon-cleanup/world";
import { FLAT_GROUND } from "../gameplay";
import { MenuWriter, boardNodes, deskItems, menuCatalogFromGameData } from "./menu-writer";
import {
  ReadoutWriter,
  attachSimReadouts,
  type HopOut,
  type LampOut,
  type PlotCardOut,
  type SimReadoutSource,
} from "./readout-writer";

// Compile-time proof that the sim itself is a valid read source (no adapter, no cast).
const asSource = (sim: MoonRoomSim): SimReadoutSource => sim;

interface FakeState {
  hop: HopOut;
  lamp: LampOut;
  plot: PlotCardOut | null;
  prices: Record<string, number>;
  picks: number;
}

function fake(): { src: SimReadoutSource; s: FakeState } {
  const s: FakeState = {
    hop: { bursts: 2, max: 3, recharge01: 0.5 },
    lamp: { level: 1, switchedOn: false, lit: false },
    plot: null,
    prices: {},
    picks: 0,
  };
  const src: SimReadoutSource = {
    pickPlot(_slot, out) {
      s.picks++;
      if (s.plot === null) return false;
      Object.assign(out, s.plot);
      return true;
    },
    hopReadout(_slot, out) {
      Object.assign(out, s.hop);
      return true;
    },
    lampReadout(_slot, out) {
      Object.assign(out, s.lamp);
      return true;
    },
    quotePriceLm: (_slot, id) => s.prices[id] ?? -1,
  };
  return { src, s };
}

const card = (over: Partial<PlotCardOut> = {}): PlotCardOut => ({
  plotId: 4_100 as PlotId,
  state: 1 as PlotState,
  remainingPct: 60,
  terrainId: "terrain.mare",
  creditedSlot: 0,
  countsTowardShine: false,
  shinePctPerPlot: 100 / 163_842,
  ...over,
});

describe("ReadoutWriter", () => {
  it("writes Hop gauge and lamp mode only on change, at HUD_WRITE_HZ, and hides the gauge without a Hop Pack", () => {
    const actions: UiAction[] = [];
    const w = new ReadoutWriter({ store: { dispatch: (a) => void actions.push(a) }, mySlot: () => 0 });
    const { src, s } = fake();
    w.pump(0);
    expect(actions).toEqual([]); // no source: nothing
    w.setSource(src);
    w.pump(0);
    expect(actions).toEqual([
      {
        type: "suit.set",
        patch: { lampLevel: 1, lampMode: "off", hop: { bursts: 2, max: 3, rechargePct: 50 } },
      },
    ]);
    w.pump(100);
    expect(actions.length).toBe(1); // unchanged
    s.hop.recharge01 = 0.9;
    w.pump(150);
    expect(actions.length).toBe(1); // throttled (< 100 ms)
    w.pump(220);
    expect(actions[1]).toEqual({
      type: "suit.set",
      patch: { lampLevel: 1, lampMode: "off", hop: { bursts: 2, max: 3, rechargePct: 90 } },
    });
    s.lamp.switchedOn = true;
    s.lamp.lit = true;
    w.pump(400);
    expect(actions[2]).toMatchObject({ patch: { lampMode: "lamp" } });
    s.hop.max = 0;
    s.hop.bursts = 0;
    s.hop.recharge01 = 0;
    w.pump(600);
    expect(actions[3]).toMatchObject({ patch: { hop: null } });
    // Detach clears the slice once.
    w.setSource(null);
    expect(actions[4]).toEqual({ type: "suit.set", patch: { lampLevel: 0, lampMode: "off", hop: null } });
  });

  it("feeds the Plot Card from pickPlot only while inspecting, on change, and closes it when the pick ends", () => {
    const actions: UiAction[] = [];
    const w = new ReadoutWriter({ store: { dispatch: (a) => void actions.push(a) }, mySlot: () => 0 });
    const { src, s } = fake();
    s.plot = card();
    w.setSource(src);
    w.pump(0);
    expect(actions.filter((a) => a.type === "plotCard.set")).toEqual([]);
    expect(s.picks).toBe(0); // not inspecting: no pick at all
    w.setInspecting(true);
    w.pump(200);
    const sets = (): UiAction[] => actions.filter((a) => a.type === "plotCard.set");
    expect(sets()).toEqual([
      {
        type: "plotCard.set",
        patch: {
          open: true,
          plotId: 4_100,
          label: "4100",
          state: 1,
          remainingPct: 60,
          terrainId: "terrain.mare",
          creditedSlot: 0,
        },
      },
    ]);
    w.pump(400);
    expect(sets().length).toBe(1); // same plot, same numbers
    s.plot = card({ remainingPct: 41 });
    w.pump(600);
    expect(sets().length).toBe(2);
    expect(sets()[1]).toMatchObject({ patch: { remainingPct: 41 } });
    s.plot = null;
    w.pump(800);
    expect(sets()[2]).toEqual({ type: "plotCard.set", patch: { open: false } });
    w.pump(1000);
    expect(sets().length).toBe(3);
    s.plot = card();
    w.pump(1200);
    w.setInspecting(false);
    w.pump(1400);
    expect(sets().at(-1)).toEqual({ type: "plotCard.set", patch: { open: false } });
  });

  it("writes compass chips with the Boreal accent", () => {
    const actions: UiAction[] = [];
    const w = new ReadoutWriter({ store: { dispatch: (a) => void actions.push(a) }, mySlot: () => 0 });
    w.setOutposts([{ id: "Boreal", visited: true }]);
    expect(actions).toEqual([
      { type: "compass.set", patch: { outposts: [{ id: "Boreal", visited: true, accent: "teal" }] } },
    ]);
  });

  it("reuses its out-buffers: a steady pump does not allocate dispatches or patches", () => {
    let dispatches = 0;
    const w = new ReadoutWriter({ store: { dispatch: () => void dispatches++ }, mySlot: () => 0 });
    const { src, s } = fake();
    s.plot = card();
    w.setSource(src);
    w.setInspecting(true);
    w.pump(0);
    const first = dispatches;
    for (let t = 100; t < 10_000; t += 100) w.pump(t);
    expect(dispatches).toBe(first);
  });
});

describe("price quotes (Desk / Repeat Requisition)", () => {
  const data = loadGameData();
  const cat = menuCatalogFromGameData(data);
  const shift = {
    sharedUpgrades: {},
    suitGear: {},
    robotCounts: {},
    players: [{ slot: 0, toolsOwned: 1 }],
  } as unknown as Parameters<typeof deskItems>[1];

  it("uses the sim quote for tools, gear and nodes; a negative quote keeps the list-derived price", () => {
    const tool = cat.tools.find((t) => t.priceLm > 0)!;
    const base = deskItems(cat, shift, 0).find((i) => i.itemId === tool.id)!;
    expect(base.priceLm).toBe(tool.priceLm);
    const quoted = deskItems(cat, shift, 0, null, (id) => (id === tool.id ? 41 : id === "gear.holster_rig" ? 0 : -1));
    expect(quoted.find((i) => i.itemId === tool.id)).toMatchObject({ priceLm: 41, listPriceLm: tool.priceLm });
    expect(quoted.find((i) => i.itemId === "gear.holster_rig")!.priceLm).toBe(0);
    expect(quoted.find((i) => i.itemId !== tool.id && i.category === "tool")!.priceLm).toBe(
      deskItems(cat, shift, 0).find((i) => i.itemId !== tool.id && i.category === "tool")!.priceLm,
    );
    const node = boardNodes(cat, shift).find((n) => n.nextCostLm !== null)!;
    expect(
      boardNodes(cat, shift, null, (id) => (id === node.nodeId ? 7 : -1)).find((n) => n.nodeId === node.nodeId)!
        .nextCostLm,
    ).toBe(7);
    expect(boardNodes(cat, shift, null, () => -1).find((n) => n.nodeId === node.nodeId)!.nextCostLm).toBe(
      node.nextCostLm,
    );
  });

  it("MenuWriter rewrites the rows when a quote source is attached and falls back on detach", () => {
    const actions: UiAction[] = [];
    const store = {
      dispatch: (a: UiAction) => void actions.push(a),
      getState: () => ({ shift: { mySlot: 0 } }) as never,
    };
    const menus = new MenuWriter(store);
    menus.setCatalog(cat);
    const readouts = new ReadoutWriter({ store, mySlot: () => 0 });
    const { src, s } = fake();
    const tool = cat.tools.find((t) => t.priceLm > 0)!;
    s.prices[tool.id] = 33;
    menus.bind({
      kind: "local",
      onShiftState: (l: (s: typeof shift) => void) => {
        l(shift);
        return () => undefined;
      },
    } as never);
    attachSimReadouts({ readouts, menus, mySlot: () => 0 }, src);
    menus.pump(0);
    const desk = actions.find((a) => a.type === "desk.set");
    expect(desk).toBeDefined();
    const items = (desk as Extract<UiAction, { type: "desk.set" }>).patch.items!;
    expect(items.find((i) => i.itemId === tool.id)!.priceLm).toBe(33);
    attachSimReadouts({ readouts, menus, mySlot: () => 0 }, null);
    actions.length = 0;
    menus.pump(1000);
    const after = (actions.find((a) => a.type === "desk.set") as Extract<UiAction, { type: "desk.set" }>).patch.items!;
    expect(after.find((i) => i.itemId === tool.id)!.priceLm).toBe(tool.priceLm);
  });
});

describe("the sim as a read source", () => {
  it("MoonRoomSim satisfies SimReadoutSource and reads Hop / lamp / quotes for the own slot", () => {
    const data = loadGameData();
    const grid = createPlotGrid(STANDARD_GRID_PARAMS);
    const world: SimWorld = { grid, ground: FLAT_GROUND };
    const sim = new MoonRoomSim({
      data,
      world,
      ledger: createRoomDustLedger(grid, data, { tickHz: 20 }),
      contractId: "00000000-0000-4000-8000-0000000000ab" as ContractId,
      shiftType: "private",
      tickHz: 20,
      snapshotHz: 10,
    });
    sim.addActor(0, { playerId: "p" as never, displayName: "P", role: "holder" });
    sim.onEvent(() => undefined);
    const actions: UiAction[] = [];
    const w = new ReadoutWriter({ store: { dispatch: (a) => void actions.push(a) }, mySlot: () => 0 });
    w.setSource(asSource(sim));
    w.pump(0);
    // No Hop Pack and no lamp at the start of a shift: gauge hidden, lamp off.
    expect(actions[0]).toEqual({ type: "suit.set", patch: { lampLevel: 0, lampMode: "off", hop: null } });
    const tool = data.tools.tools.find((t) => t.priceLm > 0)!;
    expect(asSource(sim).quotePriceLm(0, tool.id)).toBeGreaterThanOrEqual(0);
    expect(asSource(sim).quotePriceLm(0, "tool.does_not_exist")).toBe(-1);
  });
});
