// @contract ui/store v1.1
// @consumers apps/client/src/ui (reads, renders; React `useSyncExternalStore`), apps/client/src/net,
//   apps/client/src/sim-host and apps/client/src/gameplay (write through actions), apps/client/src/app (creates the
//   store and applies the actions), this package's client/module
//
// Version note: v1.1 (M1-W0-T06) adds the saveSync slice and its two request actions; additive.
//
// UI store shape and actions. Specification: docs/architecture/module-boundaries.md sections 2 and 4;
// docs/design/ui-screens-and-flows.md section 1.3. The UI reads a snapshot of plain read-only data; writers change it
// only through actions; the UI flush runs at most UI_FLUSH_MAX_HZ. Slice shapes are in ./slices.
//
// v0 had the session slice. v1 (M1-W0-T03) adds the HUD, wallet, Shine, compass, holster/Cells, suit, vehicle,
// checklist, Next Requisition, interaction, roster, plot card, assay, achievements, desk, board, Motor Pool, equipment,
// DOT, notices, menus, settings and input slices, and their actions. Additive: the M0 store implementation keeps
// working because it ignores actions it does not know and spreads the state it holds. v1.1 (M1-W0-T06) adds the
// `saveSync` slice (ADR-0031). The profile and shift detail fields beyond the v1 shapes arrive with their owners.
//
// Action rules: every slice has a `<slice>.set` action that shallow-merges `patch` into the slice (writers send whole
// arrays, never element patches). The few extra actions carry logic the writers must not duplicate (ring buffers,
// queue caps, menu stack); the store implementation applies them with the limits exported from ./slices.

import type { Unsubscribe } from "../events";
import type { SaveConflictChoice } from "../save";
import type {
  MenuSurfaceId,
  UiAchievementsState,
  UiAssayState,
  UiBoardState,
  UiChecklistState,
  UiCompassPing,
  UiCompassState,
  UiDeskState,
  UiDotLine,
  UiDotState,
  UiEquipmentState,
  UiHolsterState,
  UiInputState,
  UiInteractionState,
  UiMenusState,
  UiModal,
  UiMotorPoolState,
  UiNextRequisitionState,
  UiNotice,
  UiNoticesState,
  UiPlotCardState,
  UiProfileState,
  UiRosterState,
  UiSaveSyncState,
  UiSessionState,
  UiSettingsState,
  UiShineState,
  UiShiftState,
  UiSuitState,
  UiVehicleState,
  UiWalletDelta,
  UiWalletState,
} from "./slices";

/** UI store updates reach the screen at most this often (module-boundaries.md section 4). */
export const UI_FLUSH_MAX_HZ = 15;

/** The whole UI state: one entry per slice. */
export interface UiState {
  readonly session: UiSessionState;
  readonly profile: UiProfileState;
  readonly shift: UiShiftState;
  readonly wallet: UiWalletState;
  readonly shine: UiShineState;
  readonly compass: UiCompassState;
  readonly holster: UiHolsterState;
  readonly suit: UiSuitState;
  readonly vehicle: UiVehicleState;
  readonly checklist: UiChecklistState;
  readonly nextReq: UiNextRequisitionState;
  readonly interaction: UiInteractionState;
  readonly roster: UiRosterState;
  readonly plotCard: UiPlotCardState;
  readonly assay: UiAssayState;
  readonly achievements: UiAchievementsState;
  readonly desk: UiDeskState;
  readonly board: UiBoardState;
  readonly motorPool: UiMotorPoolState;
  readonly equipment: UiEquipmentState;
  readonly dot: UiDotState;
  readonly notices: UiNoticesState;
  readonly menus: UiMenusState;
  readonly settings: UiSettingsState;
  readonly input: UiInputState;
  readonly saveSync: UiSaveSyncState;
}

/** Name of a slice. */
export type UiSliceName = keyof UiState;

/** Every slice name, in the order of UiState (the store implementation and the tests iterate it). */
export const UI_SLICE_NAMES = [
  "session",
  "profile",
  "shift",
  "wallet",
  "shine",
  "compass",
  "holster",
  "suit",
  "vehicle",
  "checklist",
  "nextReq",
  "interaction",
  "roster",
  "plotCard",
  "assay",
  "achievements",
  "desk",
  "board",
  "motorPool",
  "equipment",
  "dot",
  "notices",
  "menus",
  "settings",
  "input",
  "saveSync",
] as const satisfies readonly UiSliceName[];

/** `<slice>.set`: shallow-merges `patch` into the slice. */
export type UiSetAction = {
  [K in UiSliceName]: { readonly type: `${K}.set`; readonly patch: Partial<UiState[K]> };
}[UiSliceName];

/** What a writer provides for a notice; the store assigns `id`, `count` and `createdAtMs`. */
export type UiNoticeInput = Omit<UiNotice, "id" | "count" | "createdAtMs" | "ttlMs"> & { readonly ttlMs?: number };

/** Actions with their own behavior. Limits come from ./slices (UI_WALLET_DELTA_RING, UI_NOTICE_*, UI_DOT_*). */
export type UiSpecialAction =
  /** Pushes a delta into the ring and adds `amountLm` to `wallet.lm` unless `settle` is true (the server value is set separately). */
  | { readonly type: "wallet.delta"; readonly delta: UiWalletDelta; readonly settle: boolean }
  /** Adds a notice, merging by `mergeKey`; drops the oldest P3 first when the queue is full. */
  | { readonly type: "notices.push"; readonly notice: UiNoticeInput }
  /** Removes one notice (expired, answered or dismissed). */
  | { readonly type: "notices.dismiss"; readonly id: number }
  /** Shows a DOT subtitle line now, or queues it behind the current one. */
  | { readonly type: "dot.say"; readonly line: UiDotLine; readonly keep: boolean }
  /** Ends the current line and shows the next queued one. */
  | { readonly type: "dot.next" }
  /** Opens a surface, pushing the current one onto the stack. */
  | { readonly type: "menus.open"; readonly surface: MenuSurfaceId; readonly focusReturnId?: string }
  /** Closes the open surface and reopens the one below it, if any. */
  | { readonly type: "menus.back" }
  /** Closes every surface and returns to play. */
  | { readonly type: "menus.closeAll" }
  /** Shows or hides the modal on top of the open surface. */
  | { readonly type: "menus.modal"; readonly modal: UiModal | null }
  /** Adds or replaces a compass ping by id. */
  | { readonly type: "compass.ping"; readonly ping: UiCompassPing }
  /** Marks an Induction item done and advances `stepIndex`. */
  | { readonly type: "checklist.complete"; readonly itemId: string }
  /**
   * The player answered "Which copy?" (save/sync-rules, rule 4). The store applies it only while
   * `saveSync.state === "conflict"` (otherwise it ignores it) by setting `saveSync.request` to
   * `{ kind: "resolve_conflict", choice }`; the net module performs the work and clears `request`. There is no default
   * choice: the UI must not dispatch this without an explicit player action.
   */
  | { readonly type: "saveSync.resolveConflict"; readonly choice: SaveConflictChoice }
  /**
   * The player asked to restore the local backup slot (save/sync-rules, rule 4). The store applies it only while
   * `saveSync.backupAvailable` is true, by setting `saveSync.request` to `{ kind: "restore_backup" }`.
   */
  | { readonly type: "saveSync.restoreBackup" };

/** Writes to the store. */
export type UiAction = UiSetAction | UiSpecialAction;

/** Type of every action. */
export type UiActionType = UiAction["type"];

/** The store service (`ServiceTypes.uiStore`). Shape matches React's `useSyncExternalStore` contract. */
export interface UiStore {
  /** Current snapshot. The same object is returned until the next flush changes it. */
  getState(): UiState;
  /** Calls `listener` after each flush that changed the state. */
  subscribe(listener: () => void): Unsubscribe;
  /** Queues an action; it is applied before the next flush. */
  dispatch(action: UiAction): void;
}

/** State before anything has happened. Treat as read-only. */
export const INITIAL_UI_STATE = {
  session: { conn: "asleep", rttMs: null, closeCode: null },
  profile: { playerId: null, displayName: "", isGuest: true, pendingRecoveryCode: null },
  shift: {
    contractId: null,
    contractName: "",
    shiftType: "solo",
    myRole: "holder",
    mySlot: 0,
    inviteCode: null,
    elapsedS: 0,
    ready: false,
  },
  wallet: { lm: 0, lastDeltas: [], pendingSpendLm: 0 },
  shine: { polished: 0, total: 163_842, pct: 0, albedo: 0, dustRemovedKg: 0, milestonePct: 0 },
  compass: { outposts: [], pings: [], fenceBearingDeg: null, objectiveMarkerId: null },
  holster: { slots: [], active: -1, slotCount: 1, laneLock: false, trait: null },
  suit: {
    lampLevel: 0,
    lampMode: "off",
    hop: null,
    ballast: null,
    day: { isDay: true, minutesToTerminator: 30, ringFrac01: 0 },
  },
  vehicle: {
    seated: false,
    kindId: null,
    entityId: null,
    payloadKg: 0,
    payloadCapKg: 0,
    boostPct: 0,
    throttleLock: false,
    puckSlots: { used: 0, max: 0 },
  },
  checklist: { mode: "none", items: [], stepIndex: 0, hidden: false },
  nextReq: { itemId: null, priceLm: 0, fundedPct: 0, lastPingStep: 0 },
  interaction: { prompt: null },
  roster: { players: [] },
  plotCard: {
    open: false,
    plotId: null,
    label: "",
    state: null,
    remainingPct: 100,
    terrainId: null,
    creditedSlot: null,
  },
  assay: {
    active: false,
    slot: null,
    queuePos: 0,
    kgPoured: 0,
    kgRemaining: 0,
    rateLmPerKg: 0,
    lmRunning: 0,
    railshot: { kg: 0, nextAtKg: 2000 },
  },
  achievements: { items: [] },
  desk: { items: [], pending: [] },
  board: { nodes: [], caps: { roost: { used: 0, cap: 3 } } },
  motorPool: { vehicles: [], poolId: null },
  equipment: { target: null },
  dot: { line: null, queued: [], history: [], handbookUnread: 0 },
  notices: { queue: [], visible: [] },
  menus: { open: null, stack: [], focusReturnId: null, modal: null },
  settings: {
    hudScalePct: 100,
    noticeVerbosity: "all",
    reduceMotion: false,
    volume: { master: 1, effects: 1, music: 1, ambience: 1, interface: 1, voice: 1, breathing: 1 },
  },
  input: { lastDevice: "kbm" },
  saveSync: {
    state: "local_only",
    localGeneration: 0,
    serverGeneration: null,
    lastSyncedAtMs: null,
    pendingSinceMs: null,
    conflict: null,
    backupAvailable: false,
    backupExpiresAtMs: null,
    error: null,
    storageWarning: null,
    request: null,
  },
} as const satisfies UiState;
