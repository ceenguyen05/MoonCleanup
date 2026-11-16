import { describe, expect, expectTypeOf, it } from "vitest";
import type { SoloCheckpointSummary } from "../api";
import {
  INITIAL_UI_STATE,
  MENU_SURFACE_IDS,
  UI_DOT_HISTORY_MAX,
  UI_NOTICE_QUEUE_MAX,
  UI_NOTICE_TTL_MS,
  UI_NOTICE_VISIBLE_MAX,
  UI_SLICE_NAMES,
  UI_WALLET_DELTA_RING,
  type UiAction,
  type UiActionType,
  type UiSliceName,
  type UiState,
} from "./index";

describe("ui store v1", () => {
  it("has one initial value per slice, in step with UI_SLICE_NAMES", () => {
    expect(Object.keys(INITIAL_UI_STATE).sort()).toEqual([...UI_SLICE_NAMES].sort());
    expectTypeOf<(typeof UI_SLICE_NAMES)[number]>().toEqualTypeOf<UiSliceName>();
    expect(new Set(UI_SLICE_NAMES).size).toBe(UI_SLICE_NAMES.length);
    expectTypeOf(INITIAL_UI_STATE).toExtend<UiState>();
  });

  it("covers the slices the MVP card names", () => {
    for (const name of ["wallet", "shine", "holster", "compass", "suit", "checklist", "menus", "notices"] as const) {
      expect(UI_SLICE_NAMES).toContain(name);
    }
  });

  it("starts as a shift that has not begun", () => {
    expect(INITIAL_UI_STATE.session.conn).toBe("asleep");
    expect(INITIAL_UI_STATE.wallet.lm).toBe(0);
    expect(INITIAL_UI_STATE.shine.total).toBe(163_842);
    expect(INITIAL_UI_STATE.menus.open).toBeNull();
    expect(INITIAL_UI_STATE.board.caps.roost.cap).toBe(3);
    expect(INITIAL_UI_STATE.assay.railshot.nextAtKg).toBe(2000);
  });

  it("keeps the notification and DOT limits of ui-screens section 5.2", () => {
    expect(UI_NOTICE_VISIBLE_MAX).toBe(3);
    expect(UI_NOTICE_QUEUE_MAX).toBe(8);
    expect(UI_NOTICE_TTL_MS).toEqual({ action: 8000, progress: 3500, ambient: 3500 });
    expect(UI_WALLET_DELTA_RING).toBe(8);
    expect(UI_DOT_HISTORY_MAX).toBe(50);
  });

  it("lists unique menu surfaces", () => {
    expect(new Set(MENU_SURFACE_IDS).size).toBe(MENU_SURFACE_IDS.length);
    expect(MENU_SURFACE_IDS).toContain("requisitions_desk");
  });

  it("has the saveSync slice (ADR-0031) starting local-only with no conflict and no default choice", () => {
    expect(UI_SLICE_NAMES).toContain("saveSync");
    const s = INITIAL_UI_STATE.saveSync;
    expect(s.state).toBe("local_only");
    expect(s.conflict).toBeNull();
    expect(s.request).toBeNull();
    expect(s.backupAvailable).toBe(false);
    expect(s.serverGeneration).toBeNull();
    expect(Object.keys(s).sort()).toEqual(
      [
        "backupAvailable",
        "backupExpiresAtMs",
        "conflict",
        "error",
        "lastSyncedAtMs",
        "localGeneration",
        "pendingSinceMs",
        "request",
        "serverGeneration",
        "state",
        "storageWarning",
      ].sort(),
    );
    // plain data only: it survives a JSON round trip
    expect(JSON.parse(JSON.stringify(INITIAL_UI_STATE.saveSync))).toEqual(s);
  });

  it("types the saveSync actions and the conflict payload", () => {
    const summary: SoloCheckpointSummary = {
      generation: 5,
      parentGeneration: 4,
      originKind: "solo",
      savedAt: "2026-11-13T12:00:00.000Z",
      simTick: 10,
      playtimeS: 30,
      shinePolished: 2,
      walletLumens: 10,
      saveFormatVersion: 1,
      gameDataVersion: "1",
    };
    const ok: UiAction[] = [
      { type: "saveSync.set", patch: { state: "conflict", conflict: { local: summary, server: summary } } },
      { type: "saveSync.set", patch: { request: { kind: "resolve_conflict", choice: "keep_local" } } },
      { type: "saveSync.resolveConflict", choice: "use_server" },
      { type: "saveSync.restoreBackup" },
    ];
    // @ts-expect-error -- there is no default or third choice
    const none: UiAction = { type: "saveSync.resolveConflict", choice: "later" };
    // @ts-expect-error -- state outside SAVE_SYNC_STATES
    const badState: UiAction = { type: "saveSync.set", patch: { state: "syncing" } };
    expect(ok.length + [none, badState].length).toBe(6);
    expectTypeOf<"saveSync.set">().toExtend<UiActionType>();
    expectTypeOf<"saveSync.resolveConflict">().toExtend<UiActionType>();
    expectTypeOf<"saveSync.restoreBackup">().toExtend<UiActionType>();
  });

  it("has an optional nullable compass.objectiveDistanceM set through compass.set", () => {
    expect(INITIAL_UI_STATE.compass.objectiveDistanceM).toBeNull();
    const legacy: UiState["compass"] = { outposts: [], pings: [], fenceBearingDeg: null, objectiveMarkerId: null };
    expect(legacy.objectiveDistanceM).toBeUndefined();
    const ok: UiAction[] = [
      { type: "compass.set", patch: { objectiveMarkerId: "assay_counter", objectiveDistanceM: 38 } },
      { type: "compass.set", patch: { objectiveDistanceM: null } },
    ];
    // @ts-expect-error -- metres are a number, not text
    const bad: UiAction = { type: "compass.set", patch: { objectiveDistanceM: "38 m" } };
    expect(ok.length + [bad].length).toBe(3);
    expect(JSON.parse(JSON.stringify(INITIAL_UI_STATE.compass))).toEqual(INITIAL_UI_STATE.compass);
  });

  it("types actions", () => {
    const ok: UiAction[] = [
      { type: "session.set", patch: { conn: "connected" } },
      { type: "wallet.set", patch: { lm: 120 } },
      { type: "menus.open", surface: "motor_pool" },
      { type: "wallet.delta", delta: { amountLm: 88, source: "stamp", actorSlot: 0, atMs: 1 }, settle: false },
    ];
    // @ts-expect-error -- patch of another slice
    const badPatch: UiAction = { type: "wallet.set", patch: { conn: "lost" } };
    // @ts-expect-error -- unknown surface
    const badSurface: UiAction = { type: "menus.open", surface: "casino" };
    expect(ok.length + [badPatch, badSurface].length).toBe(6);
    expectTypeOf<"session.set">().toExtend<UiActionType>();
    expectTypeOf<"shine.set">().toExtend<UiActionType>();
  });
});
