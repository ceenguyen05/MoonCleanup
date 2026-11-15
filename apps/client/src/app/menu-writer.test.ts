import { describe, expect, test } from "vitest";
import { loadGameData } from "@moon-cleanup/game-data";
import type { UiNavAction } from "../ui";
import { InputState, PAD_NAV_BACK, PAD_NAV_DOWN } from "../gameplay";
import { LocalRoomHostImpl } from "../sim-host/local-room-host";
import { FLAT_WORLD, TEST_CONTRACT, TEST_PLAYER, channelWorker } from "../sim-host/test-support";
import { createPurchasePort } from "./hud-interaction";
import { PromotionsBoard, STAT_PURCHASE_DISCOUNT_FRAC, discountedPriceLm } from "@moon-cleanup/sim";
import {
  MenuWriter,
  UiFrameBridge,
  boardNodes,
  createMenuPricing,
  deskItems,
  menuCatalogFromGameData,
} from "./menu-writer";
import { createRoomHostService } from "./solo-host";
import { createUiStore } from "./ui-store";

const settle = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("menus: open the Desk and buy in Solo", { timeout: 60_000 }, () => {
  test("interact at the Desk opens it; buying the Holster Rig levels it up through a real Solo room", async () => {
    const store = createUiStore(1000, () => 1);
    const service = createRoomHostService();
    const menus = new MenuWriter(store);
    menus.setCatalog(menuCatalogFromGameData(loadGameData()));
    const offMenus = menus.follow(service);
    const port = createPurchasePort({ roomHost: service, store, newRequestId: () => crypto.randomUUID() });
    const host = new LocalRoomHostImpl({
      contractId: TEST_CONTRACT,
      player: TEST_PLAYER,
      world: FLAT_WORLD,
      spawnWorker: channelWorker,
      clock: "manual",
      store: "memory",
      checkpointIntervalS: 0,
      statsIntervalMs: 0,
      fresh: { walletLm: 500, spawnDirection: undefined },
    });
    service.publish(host);
    while (host.state !== "running") await settle(5);

    // Frame bridge: the Desk prompt is up, the player presses interact (E).
    const input = new InputState();
    const navs: UiNavAction[] = [];
    let heading = -1;
    const bridge = new UiFrameBridge({
      store,
      ui: {
        navigate: (a) => (navs.push(a), true),
        setCompassHeading: (d) => void (heading = d),
        capturing: () => null,
        offerInput: () => false,
      },
      input,
      station: () => "desk",
    });
    input.keyDown("KeyE");
    input.keyUp("KeyE");
    bridge.pump();
    let t = 1000;
    store.flush(t);
    expect(store.getState().menus.open).toBe("requisitions_desk");
    expect(heading).toBe(0);
    // Next frame: the open menu suspends game input (move / jump / interact / tool).
    bridge.pump();
    expect(input.isSuspended).toBe(true);

    // Shift state reaches the Desk rows.
    host.stepManual(2);
    await settle(50);
    menus.pump((t += 1000));
    store.flush(t);
    const rig = () => store.getState().desk.items.find((i) => i.itemId === "gear.holster_rig");
    expect(rig()).toMatchObject({ levelOwned: 0, levelMax: 1, priceLm: 100 });
    expect(store.getState().board.nodes.length).toBeGreaterThan(0);

    // Buy (the UI calls the port with the row price), let the sim step, rows follow the shift state.
    expect(port.purchase("gear.holster_rig", 100)).not.toBeNull();
    store.flush((t += 1000));
    expect(store.getState().desk.pending.length).toBe(1);
    host.stepManual(2);
    await settle(50);
    host.stepManual(1);
    await settle(50);
    menus.pump((t += 1000));
    store.flush(t);
    expect(rig()?.levelOwned).toBe(1);
    expect(store.getState().desk.pending).toEqual([]);
    expect(store.getState().wallet.pendingSpendLm).toBe(0);

    // A refused second level (max_level in the MVP) becomes a notice.
    port.purchase("gear.holster_rig", 400);
    host.stepManual(2);
    await settle(50);
    store.flush((t += 1000));
    expect(store.getState().notices.queue.some((n) => n.textId === "notice.purchase_rejected")).toBe(true);

    // Gamepad: with the menu open, D-pad down and B go to the UI's navigation.
    input.setGamepad(0, 0, 0, 0, 1 << 13);
    input.setGamepad(0, 0, 0, 0, 0);
    input.setGamepad(0, 0, 0, 0, 1 << 1);
    expect(input.takeNav()).toBe(PAD_NAV_DOWN | PAD_NAV_BACK);
    input.setGamepad(0, 0, 0, 0, 0);
    input.setGamepad(0, 0, 0, 0, 1 << 13);
    bridge.pump();
    expect(navs).toEqual(["down"]);

    port.dispose();
    offMenus();
    await host.close("clock_out");
  });
});

describe("board rows", () => {
  test("Cell nodes respect the MVP cap and the hub counts as held", () => {
    const cat = menuCatalogFromGameData(loadGameData());
    const rows = boardNodes(cat, { sharedUpgrades: {} } as unknown as Parameters<typeof boardNodes>[1]);
    const cell = rows.find((r) => r.nodeId === "node.dust_cell_desk_duster");
    expect(cell).toMatchObject({ level: 0, prereqMet: true, nextCostLm: 90 });
    expect(cell!.max).toBeLessThanOrEqual(3);
  });
});

describe("menu pricing", () => {
  test("Rebate discounts tools and Dust Cell nodes like the sim; suit gear and other nodes pay list", () => {
    const data = loadGameData();
    const cat = menuCatalogFromGameData(data);
    const board = new PromotionsBoard(data);
    const pricing = createMenuPricing(board, STAT_PURCHASE_DISCOUNT_FRAC, discountedPriceLm);
    const shift = {
      sharedUpgrades: { "node.rebate": 1 },
      suitGear: {},
      players: [{ slot: 0, toolsOwned: 1 }],
    } as unknown as Parameters<typeof deskItems>[1];
    const frac = pricing.discountFrac({ "node.rebate": 1 });
    expect(frac).toBeGreaterThan(0);
    const squeegee = deskItems(cat, shift, 0, pricing).find((i) => i.itemId === "tool.crescent_squeegee")!;
    expect(squeegee.listPriceLm).toBe(75);
    expect(squeegee.priceLm).toBe(discountedPriceLm(75, frac));
    expect(squeegee.priceLm).toBeLessThan(75);
    const rig = deskItems(cat, shift, 0, pricing).find((i) => i.itemId === "gear.holster_rig")!;
    expect(rig.priceLm).toBe(100);
    const rows = boardNodes(cat, shift, pricing);
    expect(rows.find((r) => r.nodeId === "node.dust_cell_desk_duster")!.nextCostLm).toBe(discountedPriceLm(90, frac));
    const plain = rows.find((r) => !r.nodeId.startsWith("node.dust_cell_") && r.nextCostLm !== null)!;
    const listed = boardNodes(cat, shift).find((r) => r.nodeId === plain.nodeId)!;
    expect(plain.nextCostLm).toBe(listed.nextCostLm);
  });
});
