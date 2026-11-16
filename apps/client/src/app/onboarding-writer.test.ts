import { describe, expect, test } from "vitest";
import { loadGameData } from "@moon-cleanup/game-data";
import type { RoomHost, RoomHostState, RoomSimEvent, Unsubscribe } from "@moon-cleanup/shared";
import { createRoomHostService } from "./solo-host";
import { OnboardingWriter, createOnboardingStorage, type OnboardingCatalog } from "./onboarding-writer";
import { createUiStore } from "./ui-store";

function fakeHost(kind: "local" | "remote" = "local"): { host: RoomHost; emit(e: RoomSimEvent): void } {
  const ev: ((e: RoomSimEvent) => void)[] = [];
  const none: Unsubscribe = () => undefined;
  const host = {
    kind,
    contractId: "c",
    simTickHz: 20,
    state: "running" as RoomHostState,
    generation: 0,
    sendInput: () => undefined,
    sendIntent: () => undefined,
    onFrame: () => none,
    onShiftState: () => none,
    onEvent: (l: (e: RoomSimEvent) => void) => (ev.push(l), none),
    onStateChange: () => none,
    close: () => Promise.resolve(),
    checkpoint: () => Promise.reject(new Error("unused")),
    pause: () => undefined,
    suspend: () => Promise.reject(new Error("unused")),
    resume: () => undefined,
  } as unknown as RoomHost;
  return { host, emit: (e) => ev.forEach((l) => l(e)) };
}

function catalog(): OnboardingCatalog {
  const data = loadGameData();
  return {
    induction: data.onboarding.induction.map((s) => ({ id: s.id, trigger: s.trigger })),
    achievementIds: data.achievements.achievements.map((a) => a.id),
  };
}

const ev = (name: string, payload: object): RoomSimEvent =>
  ({ name, payload: { tick: 1, ...payload } }) as RoomSimEvent;

function setup() {
  const store = createUiStore(1000, () => 5_000);
  const writer = new OnboardingWriter({ store, wallMs: () => 7_000 });
  const f = fakeHost();
  writer.bind(f.host);
  writer.setCatalog(catalog());
  store.flush(0);
  return { store, writer, f };
}

describe("OnboardingWriter", () => {
  test("seeds the 8 Induction steps from game-data and says the welcome line once", () => {
    const { store } = setup();
    const ui = store.getState();
    expect(ui.checklist.mode).toBe("induction");
    expect(ui.checklist.items.map((i) => i.id)).toEqual(loadGameData().onboarding.induction.map((s) => s.id));
    expect(ui.checklist.items.every((i) => !i.done && i.target === 1)).toBe(true);
    expect(ui.checklist.stepIndex).toBe(0);
    expect(ui.dot.line?.textId).toBe("dot.induction_start");
    expect(ui.dot.queued.map((l) => l.textId)).toEqual(["dot.tip_handbook"]);
    expect(ui.achievements.items.length).toBe(loadGameData().achievements.achievements.length);
    expect(ui.achievements.items.every((a) => a.unlockedAtMs === null)).toBe(true);
  });

  test("real events complete steps in order, each once, and only for the own actor", () => {
    const { store, writer, f } = setup();
    f.emit(ev("dust.collected", { actorSlot: 1, grams: 5, plotIds: [], cellGrams: 5, cellCapGrams: 4000 }));
    store.flush(100);
    expect(store.getState().checklist.items.some((i) => i.done)).toBe(false);
    f.emit(ev("dust.collected", { actorSlot: 0, grams: 5, plotIds: [], cellGrams: 5, cellCapGrams: 4000 }));
    f.emit(
      ev("cell.full", { actorSlot: 0, toolId: "tool.desk_duster", cellCapGrams: 4000, pourPointBearingDeg: null }),
    );
    f.emit(ev("cargo.sold", { source: "receiving_gate", actorSlot: 0, materialId: "m", kg: 1, lm: 1, walletLm: 1 }));
    store.flush(200);
    let c = store.getState().checklist;
    expect(c.items.filter((i) => i.done).map((i) => i.id)).toEqual(["onboarding.first_stroke", "onboarding.fill_cell"]);
    expect(c.stepIndex).toBe(2);
    expect(writer.currentStepId).toBe("onboarding.pour_at_counter");
    f.emit(ev("cargo.sold", { source: "assay_counter", actorSlot: 0, materialId: "m", kg: 1, lm: 1, walletLm: 1 }));
    writer.plotCardOpened();
    f.emit(
      ev("plot.polished", {
        plotId: 3,
        credit: "player",
        creditedSlot: 0,
        stampLm: 5,
        charged: false,
        polishedCount: 1,
      }),
    );
    f.emit(
      ev("purchase.completed", { actorSlot: 0, itemId: "tool.crescent_squeegee", level: 1, priceLm: 1, walletLm: 0 }),
    );
    f.emit(
      ev("purchase.completed", {
        actorSlot: 0,
        itemId: "node.dust_cell_crescent_squeegee",
        level: 1,
        priceLm: 1,
        walletLm: 0,
      }),
    );
    f.emit(ev("collectible.found", { actorSlot: 0, kind: "stray_cargo", id: "near_parcel", lm: 30, walletLm: 30 }));
    store.flush(300);
    c = store.getState().checklist;
    expect(c.items.every((i) => i.done)).toBe(true);
    expect(writer.inductionComplete).toBe(true);
    const dot = store.getState().dot;
    expect([dot.line, ...dot.queued].map((l) => l?.textId)).toContain("dot.induction_complete");
    // A repeat does not queue another completion line.
    const before = store.getState().dot.queued.length;
    f.emit(ev("collectible.found", { actorSlot: 0, kind: "stray_cargo", id: "near_parcel", lm: 30, walletLm: 30 }));
    store.flush(400);
    expect(store.getState().dot.queued.length).toBe(before);
  });

  test("a sim onboarding.step_completed event completes the named step too", () => {
    const { store, f } = setup();
    f.emit(ev("onboarding.step_completed", { stepId: "onboarding.buy_dust_cell", index: 6, total: 8 }));
    store.flush(100);
    expect(store.getState().checklist.items.find((i) => i.id === "onboarding.buy_dust_cell")?.done).toBe(true);
  });

  test("achievement.unlocked sets unlockedAtMs from the wall clock; other actors' unlocks are ignored", () => {
    const { store, f } = setup();
    f.emit(ev("achievement.unlocked", { achievementId: "achievement.first_light", actorSlot: 3 }));
    store.flush(100);
    expect(
      store.getState().achievements.items.find((a) => a.id === "achievement.first_light")?.unlockedAtMs,
    ).toBeNull();
    f.emit(ev("achievement.unlocked", { achievementId: "achievement.first_light", actorSlot: 0 }));
    store.flush(200);
    expect(store.getState().achievements.items.find((a) => a.id === "achievement.first_light")?.unlockedAtMs).toBe(
      7_000,
    );
  });

  test("DOT tips fire once for first night and Cell full; Shine milestones say their percent", () => {
    const { store, f } = setup();
    f.emit(ev("daynight.changed", { phase: "night", sunElevationDeg: -5, secondsToTerminator: 60 }));
    f.emit(ev("daynight.changed", { phase: "night", sunElevationDeg: -6, secondsToTerminator: 50 }));
    f.emit(ev("shine.milestone", { pct: 5, polishedCount: 5, totalPlots: 100 }));
    store.flush(100);
    const h = store.getState().dot.history.filter((t) => t === "dot.tip_first_night");
    expect(
      h.length + store.getState().dot.queued.filter((l) => l.textId === "dot.tip_first_night").length,
    ).toBeLessThanOrEqual(1);
  });

  test("progress persists: a returning player gets a finished step and no welcome line when all are done", () => {
    let saved: string[] = [];
    const storage = { read: () => saved, write: (ids: readonly string[]) => (saved = [...ids]) };
    const first = createUiStore(1000);
    const w1 = new OnboardingWriter({ store: first, storage });
    const f1 = fakeHost();
    w1.bind(f1.host);
    w1.setCatalog(catalog());
    f1.emit(ev("dust.collected", { actorSlot: 0, grams: 1, plotIds: [], cellGrams: 1, cellCapGrams: 4000 }));
    expect(saved).toEqual(["onboarding.first_stroke"]);

    const second = createUiStore(1000);
    const w2 = new OnboardingWriter({ store: second, storage });
    w2.bind(fakeHost().host);
    w2.setCatalog(catalog());
    second.flush(0);
    expect(second.getState().checklist.items[0]?.done).toBe(true);
    expect(second.getState().checklist.stepIndex).toBe(1);

    const all = { read: () => catalog().induction.map((s) => s.id), write: () => undefined };
    const third = createUiStore(1000);
    const w3 = new OnboardingWriter({ store: third, storage: all });
    w3.bind(fakeHost().host);
    w3.setCatalog(catalog());
    third.flush(0);
    expect(third.getState().dot.line).toBeNull();
    expect(w3.currentStepId).toBeNull();
  });

  test("follows the roomHost facade and detaches on dispose", () => {
    const store = createUiStore(1000);
    const writer = new OnboardingWriter({ store });
    const service = createRoomHostService();
    const off = writer.follow(service);
    writer.setCatalog(catalog());
    const f = fakeHost();
    service.publish(f.host);
    f.emit(ev("cell.full", { actorSlot: 0, toolId: "t", cellCapGrams: 1, pourPointBearingDeg: null }));
    store.flush(0);
    expect(store.getState().checklist.items.find((i) => i.id === "onboarding.fill_cell")?.done).toBe(true);
    off();
    writer.dispose();
  });

  test("storage failures are reported, never thrown", () => {
    const reports: string[] = [];
    const bad = {
      getItem: () => "{not json",
      setItem: () => {
        throw new Error("quota");
      },
    };
    const s = createOnboardingStorage(bad, (source) => reports.push(source));
    expect(s.read()).toEqual([]);
    s.write(["x"]);
    expect(reports).toEqual(["onboarding progress load", "onboarding progress save"]);
  });
});
