import { describe, expect, test } from "vitest";
import { loadGameData } from "@moon-cleanup/game-data";
import type {
  RoomHost,
  RoomHostState,
  RoomSimEvent,
  ShiftStateView,
  UiAction,
  UiStore,
  Unsubscribe,
} from "@moon-cleanup/shared";
import { LocalRoomHostImpl } from "../sim-host/local-room-host";
import { FLAT_WORLD, TEST_CONTRACT, TEST_PLAYER, channelWorker, scriptedInputs } from "../sim-host/test-support";
import { HUD_WRITE_HZ, HudWriter, withHudPump, type HudCatalog } from "./hud-writer";
import { createRoomHostService } from "./solo-host";
import { createUiStore } from "./ui-store";

function catalog(): HudCatalog {
  const tools = loadGameData().tools.tools;
  return { toolIds: tools.map((t) => t.id), cellBaseGrams: tools.map((t) => Math.round(t.cellBaseKg * 1000)) };
}

const settle = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("HUD writer: solo room", { timeout: 60_000 }, () => {
  test("shift.ready, wallet, Shine and Holster follow a real Solo LocalRoom host", async () => {
    const base = createUiStore(1000);
    const writer = new HudWriter({ store: base });
    writer.setCatalog(catalog());
    const store = withHudPump(base, writer);
    const service = createRoomHostService();
    const off = writer.follow(service);
    const host = new LocalRoomHostImpl({
      contractId: TEST_CONTRACT,
      player: TEST_PLAYER,
      world: FLAT_WORLD,
      spawnWorker: channelWorker,
      clock: "manual",
      store: "memory",
      checkpointIntervalS: 0,
      statsIntervalMs: 0,
    });
    service.publish(host);
    let last: ShiftStateView | null = null;
    host.onShiftState((s) => (last = s));
    const collected: number[] = [];
    host.onEvent((e) => {
      if (e.name === "dust.collected") collected.push(e.payload.cellGrams);
    });
    while (host.state !== "running") await settle(5);
    let t = 0;
    for (const cmd of scriptedInputs(300)) {
      host.sendInput(cmd);
      host.stepManual(1);
      if (cmd.seq % 20 === 0) {
        await settle(2);
        t += 1000;
        store.flush(t);
      }
    }
    await settle(50);
    store.flush((t += 1000));
    store.flush((t += 1000));

    const ui = store.getState();
    expect(ui.shift.ready).toBe(true);
    expect(ui.shift.contractId).toBe(TEST_CONTRACT);
    expect(last).not.toBeNull();
    const shift = last as unknown as ShiftStateView;
    expect(ui.wallet.lm).toBe(shift.walletLumens);
    expect(ui.shine.total).toBe(shift.plotCount);
    expect(ui.shine.polished).toBe(shift.shinePolished);
    expect(ui.holster.slots.length).toBeGreaterThanOrEqual(1);
    expect(ui.holster.slots[0]?.toolId).toBe(catalog().toolIds[shift.players[0]!.equippedTool]);
    expect(ui.holster.slots[0]?.cellCapKg).toBeGreaterThan(0);
    // The scripted sweep collects dust: the gauge shows the newest Cell amount the sim reported.
    expect(collected.length).toBeGreaterThan(0);
    expect(ui.holster.slots[0]?.cellKg).toBeCloseTo(collected[collected.length - 1]! / 1000, 2);

    service.publish(null);
    store.flush((t += 1000));
    expect(store.getState().shift.ready).toBe(false);
    off();
    await host.close("clock_out");
  });
});

/** Minimal RoomHost that emits what the test tells it to (event mapping, throttle). */
function fakeHost(): { host: RoomHost; emit(e: RoomSimEvent): void; shift(s: ShiftStateView): void } {
  const ev: ((e: RoomSimEvent) => void)[] = [];
  const sh: ((s: ShiftStateView) => void)[] = [];
  const none: Unsubscribe = () => undefined;
  const host = {
    kind: "local",
    contractId: TEST_CONTRACT,
    simTickHz: 20,
    state: "running" as RoomHostState,
    generation: 0,
    sendInput: () => undefined,
    sendIntent: () => undefined,
    onFrame: () => none,
    onShiftState: (l: (s: ShiftStateView) => void) => (sh.push(l), none),
    onEvent: (l: (e: RoomSimEvent) => void) => (ev.push(l), none),
    onStateChange: () => none,
    close: () => Promise.resolve(),
    checkpoint: () => Promise.reject(new Error("unused")),
    pause: () => undefined,
    suspend: () => Promise.reject(new Error("unused")),
    resume: () => undefined,
  } satisfies RoomHost;
  return { host, emit: (e) => ev.forEach((l) => l(e)), shift: (s) => sh.forEach((l) => l(s)) };
}

describe("HUD writer: events and throttle", () => {
  test("events become wallet deltas, notices, nextReq and the day ring with catalog ids", () => {
    const base = createUiStore(1000, () => 5_000);
    const writer = new HudWriter({ store: base, wallMs: () => 5_000 });
    const f = fakeHost();
    writer.bind(f.host);
    f.emit({
      name: "plot.polished",
      payload: { tick: 1, plotId: 42, credit: "solo", creditedSlot: 0, stampLm: 12, charged: false, polishedCount: 1 },
    } as unknown as RoomSimEvent);
    f.emit({
      name: "cell.full",
      payload: { tick: 2, actorSlot: 0, toolId: "tool.desk_duster", cellCapGrams: 4000, pourPointBearingDeg: null },
    });
    f.emit({
      name: "shine.milestone",
      payload: { tick: 3, pct: 1, polishedCount: 9, totalPlots: 100 },
    } as unknown as RoomSimEvent);
    f.emit({ name: "requisition.progress", payload: { tick: 4, itemId: "tool.bristle_broom", pct: 50 } });
    f.emit({
      name: "daynight.changed",
      payload: { tick: 5, phase: "day", sunElevationDeg: 20, secondsToTerminator: 720 },
    });
    writer.pump(0);
    base.flush(0);
    const ui = base.getState();
    expect(ui.wallet.lastDeltas.map((d) => [d.amountLm, d.source])).toEqual([[12, "stamp"]]);
    const texts = ui.notices.queue.map((n) => n.textId).sort();
    expect(texts).toEqual(
      ["notice.cell_full", "notice.plot_polished", "notice.requisition_funded", "notice.shine_milestone"].sort(),
    );
    expect(ui.notices.visible.length).toBeGreaterThan(0);
    expect(ui.nextReq).toMatchObject({ itemId: "tool.bristle_broom", fundedPct: 50, lastPingStep: 50 });
    expect(ui.shine.milestonePct).toBe(1);
    expect(ui.suit.day).toMatchObject({ isDay: true, minutesToTerminator: 12 });
  });

  test("continuous Cell updates are written at most HUD_WRITE_HZ and an idle pump dispatches nothing", () => {
    const dispatched: UiAction[] = [];
    const base = createUiStore(1000);
    const spy: Pick<UiStore, "dispatch" | "getState"> = {
      dispatch: (a) => {
        dispatched.push(a);
        base.dispatch(a);
      },
      getState: base.getState,
    };
    const writer = new HudWriter({ store: spy });
    writer.setCatalog(catalog());
    const f = fakeHost();
    writer.bind(f.host);
    f.shift({
      contractId: TEST_CONTRACT,
      shiftType: "solo",
      protocolVersion: 1,
      simTickHz: 20,
      snapshotHz: 10,
      walletLumens: 30,
      shinePolished: 2,
      plotCount: 100,
      sharedUpgrades: {},
      suitGear: {},
      visitedOutposts: 0,
      beacons: [],
      players: [{ slot: 0, toolsOwned: 1, equippedTool: 0 }],
      vehicles: [],
      robotCounts: {},
      permissions: {},
      fulfilled: false,
      tick: 40,
    } as unknown as ShiftStateView);
    const interval = 1000 / HUD_WRITE_HZ;
    writer.pump(0);
    const afterFirst = dispatched.length;
    expect(dispatched.some((a) => a.type === "shift.set")).toBe(true);
    // 30 dust events inside one write interval: one holster write when the interval elapses.
    for (let k = 1; k <= 30; k++) {
      f.emit({
        name: "dust.collected",
        payload: { tick: k, actorSlot: 0, grams: 10, plotIds: [], cellGrams: k * 10, cellCapGrams: 4000 },
      } as unknown as RoomSimEvent);
      writer.pump(k * (interval / 40));
    }
    expect(dispatched.length).toBe(afterFirst);
    writer.pump(interval + 1);
    expect(dispatched.length).toBe(afterFirst + 1);
    base.flush(1000);
    expect(base.getState().holster.slots[0]?.cellKg).toBeCloseTo(0.3, 3);
    writer.pump(10_000);
    expect(dispatched.length).toBe(afterFirst + 1);
  });

  test("shine.total is always a real plot count: the snapshot's, else the last known one (never 0)", () => {
    const base = createUiStore(1000);
    const writer = new HudWriter({ store: base });
    writer.setCatalog(catalog());
    const f = fakeHost();
    writer.bind(f.host);
    const snapshot = (plotCount: number, shinePolished: number): ShiftStateView =>
      ({
        contractId: TEST_CONTRACT,
        shiftType: "solo",
        protocolVersion: 1,
        simTickHz: 20,
        snapshotHz: 10,
        walletLumens: 0,
        shinePolished,
        plotCount,
        sharedUpgrades: {},
        suitGear: {},
        visitedOutposts: 0,
        beacons: [],
        players: [{ slot: 0, toolsOwned: 1, equippedTool: 0 }],
        vehicles: [],
        robotCounts: {},
        permissions: {},
        fulfilled: false,
        tick: 20,
      }) as unknown as ShiftStateView;
    f.shift(snapshot(200, 50));
    writer.pump(0);
    base.flush(0);
    expect(base.getState().shine).toMatchObject({ polished: 50, total: 200, pct: 25 });
    // A snapshot that carries no plot count keeps 200 and still computes the percentage against it.
    f.shift(snapshot(0, 100));
    writer.pump(10_000);
    base.flush(10_000);
    expect(base.getState().shine).toMatchObject({ polished: 100, total: 200, pct: 50 });
    f.shift(snapshot(Number.NaN, 20));
    writer.pump(20_000);
    base.flush(20_000);
    expect(base.getState().shine).toMatchObject({ polished: 20, total: 200, pct: 10 });
  });
});
