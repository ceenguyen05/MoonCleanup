// @contract ui/slices v1.1
// @consumers apps/client/src/ui (reads through selectors, renders HUD and menus), apps/client/src/gameplay (writes
//   holster, suit, vehicle, interaction, plotCard, assay, dot, checklist), apps/client/src/net and
//   apps/client/src/sim-host (write session, shift, wallet, shine, roster, compass, desk, board, motorPool),
//   apps/client/src/app (creates the store), this package's ui/store
//
// Version note: v1.1 (M1-W0-T06) adds the saveSync slice; additive.
//
// Shapes of the UI store slices (M1-W0-T03). Specification: docs/design/ui-screens-and-flows.md section 1.3 (proposed
// slices), section 2 (HUD widget table), section 5.2 (notification queue). Plain read-only data: no functions, no
// class instances, nothing a structured clone cannot carry. Fields the spec marks as per-frame values (compass
// bearings, hold-ring progress, world labels) are NOT in the store; direct DOM writers handle them.
//
// Reference mode: no Review, Brief, Docket, On-Shift, Bulk Rate, Commendation or gate fields exist in any slice
// (ui-screens-and-flows section 1.3, "Retired from the baseline store"). Units: Lumens are integer `lm`; masses are kg
// (the sim's integer grams are converted by the writer); percentages are 0..100 unless the name ends in `01`.

import type { CheckpointRejectReason, SoloCheckpointSummary } from "../api";
import type { NetConnectionState } from "../events";
import type { EntityId, PlotId } from "../ids";
import type { SaveConflictChoice, SaveStorageWarning, SaveSyncState, SaveUploadFailureKind } from "../save";
import type { Milliseconds } from "../units";
import type { PlotState } from "../world";

/** Player slot, 0 .. MAX_PLAYERS_PER_ROOM - 1. */
type Slot = number;

// ---- session ------------------------------------------------------------------------------------------------------

/** Connection slice, mirrored from the `net.status` event. v0 shape, unchanged; the wake and join detail fields of
 * ui-screens-and-flows section 1.3 join it with the M1 session flow. */
export interface UiSessionState {
  readonly conn: NetConnectionState;
  /** Last round-trip time; `null` until measured. */
  readonly rttMs: Milliseconds | null;
  /** Close code of the last lost connection; `null` while none. */
  readonly closeCode: number | null;
}

/** Account and display name (guest accounts only in the MVP). */
export interface UiProfileState {
  readonly playerId: string | null;
  readonly displayName: string;
  readonly isGuest: boolean;
  /** One-time recovery code, memory only; `null` once the player confirmed it. */
  readonly pendingRecoveryCode: string | null;
}

// ---- shift --------------------------------------------------------------------------------------------------------

/** Shift (room) types of the MVP: a Solo Shift or a Private Shift. */
export const UI_SHIFT_TYPES = ["solo", "private"] as const;
export type UiShiftType = (typeof UI_SHIFT_TYPES)[number];

/** Roles of the MVP: Holder and Staff (Supervisor, Temp arrive with v1.0). */
export const UI_SHIFT_ROLES = ["holder", "staff"] as const;
export type UiShiftRole = (typeof UI_SHIFT_ROLES)[number];

export interface UiShiftState {
  readonly contractId: string | null;
  readonly contractName: string;
  readonly shiftType: UiShiftType;
  readonly myRole: UiShiftRole;
  readonly mySlot: Slot;
  /** Invite code of a Private Shift (Holder only). */
  readonly inviteCode: string | null;
  /** The shift ran for this many seconds of sim time (Time Card, Shift Report). */
  readonly elapsedS: number;
  /** The `ready` flag: the world is visible and input is live. */
  readonly ready: boolean;
}

// ---- wallet and Shine ---------------------------------------------------------------------------------------------

/** Most deltas kept in `wallet.lastDeltas` (ring; the tooltip shows the last 8). */
export const UI_WALLET_DELTA_RING = 8;

/** Where a wallet change came from (HUD-01 tooltip, floaters). */
export const WALLET_DELTA_SOURCES = [
  "stamp",
  "sale",
  "collectible",
  "trick",
  "purchase",
  "refund",
  "reward",
  "other",
] as const;
export type WalletDeltaSource = (typeof WALLET_DELTA_SOURCES)[number];

export interface UiWalletDelta {
  readonly amountLm: number;
  readonly source: WalletDeltaSource;
  /** Slot of the actor who caused it; `null` for robots / the room. */
  readonly actorSlot: Slot | null;
  /** Wall-clock milliseconds (`performance.timeOrigin + now`) the UI saw it. */
  readonly atMs: number;
}

export interface UiWalletState {
  /** Shared wallet in Lumens, server-authoritative. The tick-up display animates toward it. */
  readonly lm: number;
  /** Newest last; at most UI_WALLET_DELTA_RING entries. */
  readonly lastDeltas: readonly UiWalletDelta[];
  /** Lumens reserved by purchases that are waiting for the server's answer. */
  readonly pendingSpendLm: number;
}

export interface UiShineState {
  /** Plots Polished (Empty plots count as Polished). */
  readonly polished: number;
  /** Plot count of the Moon (163,842). */
  readonly total: number;
  /** `polished / total * 100`; the writer computes it, the HUD shows 4 decimals. */
  readonly pct: number;
  /** Albedo readout, 3 decimals on screen. */
  readonly albedo: number;
  /** Dust removed in kilograms (integer). */
  readonly dustRemovedKg: number;
  /** Highest milestone percent reached (see SHINE_MILESTONE_PCTS), 0 before the first. */
  readonly milestonePct: number;
}

// ---- compass ------------------------------------------------------------------------------------------------------

export interface UiCompassOutpost {
  /** Outpost id (`Boreal` is the only one in the MVP). */
  readonly id: string;
  readonly visited: boolean;
  /** Accent token name from art-direction section 7.1. */
  readonly accent: string;
}

/** Ping kinds of the MVP wheel (Spot Check is v1.0 and disabled in the MVP). */
export const UI_PING_KINDS = ["over_here", "spot_check", "objective"] as const;
export type UiPingKind = (typeof UI_PING_KINDS)[number];

export interface UiCompassPing {
  readonly id: number;
  readonly slot: Slot;
  readonly kind: UiPingKind;
  readonly plotId: PlotId;
  /** Wall-clock milliseconds the ping expires (8 s life). */
  readonly expiresAtMs: number;
}

export interface UiCompassState {
  readonly outposts: readonly UiCompassOutpost[];
  readonly pings: readonly UiCompassPing[];
  /** Compass bearing in degrees of the Pilot Fence when within 100 m of it, otherwise `null`. */
  readonly fenceBearingDeg: number | null;
  /** Temporary marker for the active Induction step ("Assay Counter, 38 m"), as an outpost-relative id; `null` when none. */
  readonly objectiveMarkerId: string | null;
}

// ---- holster, suit, vehicle ---------------------------------------------------------------------------------------

/** Dust Cell level I..III as 1..3; 0 = no Cell upgrade bought (the base Cell). */
export type UiCellLevel = 0 | 1 | 2 | 3;

export interface UiHolsterSlot {
  /** `tool.<id>`; `null` for an empty slot. */
  readonly toolId: string | null;
  readonly owned: boolean;
  readonly cellKg: number;
  readonly cellCapKg: number;
  readonly cellLevel: UiCellLevel;
}

export interface UiHolsterState {
  readonly slots: readonly UiHolsterSlot[];
  /** Index of the tool in hand; -1 when nothing is drawn. */
  readonly active: number;
  /** 1 without a Holster Rig, 2 with Rig level 1 (MVP). */
  readonly slotCount: number;
  readonly laneLock: boolean;
  /** Trait of the active tool (`trait.<id>`) and whether it is ready (HUD-12). */
  readonly trait: { readonly id: string; readonly ready: boolean } | null;
}

/** Crown Lamp modes (HUD-06). The Lowlight Visor is v1.0. */
export const UI_LAMP_MODES = ["off", "lamp", "visor"] as const;
export type UiLampMode = (typeof UI_LAMP_MODES)[number];

export interface UiSuitState {
  /** 0 = no lamp, 1 = Clip Light (MVP), 2..4 later levels. */
  readonly lampLevel: number;
  readonly lampMode: UiLampMode;
  readonly hop: { readonly bursts: number; readonly max: number; readonly rechargePct: number } | null;
  readonly ballast: { readonly owned: boolean; readonly on: boolean } | null;
  readonly day: {
    readonly isDay: boolean;
    /** Whole minutes until the next sunrise or sunset ("12 min to dusk"). */
    readonly minutesToTerminator: number;
    /** 0..1 position in the day/night ring. */
    readonly ringFrac01: number;
  };
}

export interface UiVehicleState {
  readonly seated: boolean;
  /** `vehicle.<id>` of game-data; `null` on foot. */
  readonly kindId: string | null;
  readonly entityId: EntityId | null;
  readonly payloadKg: number;
  readonly payloadCapKg: number;
  readonly boostPct: number;
  readonly throttleLock: boolean;
  readonly puckSlots: { readonly used: number; readonly max: number };
}

// ---- checklist, Next Requisition, interaction ---------------------------------------------------------------------

export interface UiChecklistItem {
  /** `onboarding.<id>` of game-data. */
  readonly id: string;
  /** Text catalog id of the label. */
  readonly labelId: string;
  readonly progress: number;
  readonly target: number;
  readonly done: boolean;
}

/** Checklist modes: the Induction guide, or hidden. Probation and Docket are parked (ui-screens section 11). */
export const UI_CHECKLIST_MODES = ["induction", "none"] as const;
export type UiChecklistMode = (typeof UI_CHECKLIST_MODES)[number];

export interface UiChecklistState {
  readonly mode: UiChecklistMode;
  readonly items: readonly UiChecklistItem[];
  readonly stepIndex: number;
  /** The player hid the block (it never locks anything). */
  readonly hidden: boolean;
}

/** The tracked purchase (Next Requisition, HUD-07, v1.0 tier; the slice exists so the MVP can show one tracked item). */
export interface UiNextRequisitionState {
  readonly itemId: string | null;
  readonly priceLm: number;
  /** 0..100. */
  readonly fundedPct: number;
  /** Last funding tick announced: 0, 25, 50 or 75. */
  readonly lastPingStep: 0 | 25 | 50 | 75;
}

export interface UiInteractionPrompt {
  /** Action id of the input layer (`pour`, `open_desk`, `band_pucks`, ...). */
  readonly actionId: string;
  /** Text catalog id of the verb. */
  readonly labelId: string;
  /** True for hold actions; `holdMs` is the hold time. */
  readonly hold: boolean;
  readonly holdMs: number;
  /** Text catalog id of why the action is blocked; `null` when it is available. */
  readonly blockedReasonId: string | null;
}

export interface UiInteractionState {
  readonly prompt: UiInteractionPrompt | null;
}

// ---- roster, plot card, assay, achievements -------------------------------------------------------------------------

export interface UiRosterPlayer {
  readonly playerId: string;
  readonly slot: Slot;
  readonly name: string;
  readonly colorId: number;
  readonly role: UiShiftRole;
  readonly onBreak: boolean;
  readonly signalLost: boolean;
  readonly isSelf: boolean;
}

export interface UiRosterState {
  readonly players: readonly UiRosterPlayer[];
}

export interface UiPlotCardState {
  readonly open: boolean;
  readonly plotId: PlotId | null;
  /** Display label such as "41-207". */
  readonly label: string;
  readonly state: PlotState | null;
  readonly remainingPct: number;
  /** `terrain.<id>` of game-data. */
  readonly terrainId: string | null;
  /** Slot credited so far; `null` when robots lead or nobody has swept. */
  readonly creditedSlot: Slot | null;
}

export interface UiAssayState {
  readonly active: boolean;
  /** Pour slot 1..4; `null` when waiting. */
  readonly slot: number | null;
  /** Queue position when all slots are busy; 0 = not queued. */
  readonly queuePos: number;
  readonly kgPoured: number;
  readonly kgRemaining: number;
  /** Lumens per kg after multipliers. */
  readonly rateLmPerKg: number;
  readonly lmRunning: number;
  /** Railshot progress: kg since the last shot and the interval. */
  readonly railshot: { readonly kg: number; readonly nextAtKg: number };
}

export interface UiAchievementItem {
  /** `achievement.<id>` of game-data. */
  readonly id: string;
  readonly unlockedAtMs: number | null;
  /** 0..1 progress toward the threshold; `null` when hidden and locked. */
  readonly progress01: number | null;
}

export interface UiAchievementsState {
  readonly items: readonly UiAchievementItem[];
}

// ---- Requisitions Desk, Promotions Board, Motor Pool, Equipment Card -----------------------------------------------

/** Item categories of the Desk. */
export const DESK_CATEGORIES = ["tool", "gear", "vehicle", "other"] as const;
export type DeskCategory = (typeof DESK_CATEGORIES)[number];

export interface UiDeskItem {
  /** Game-data id: `tool.<id>`, `gear.<id>`. */
  readonly itemId: string;
  readonly category: DeskCategory;
  readonly tier: number;
  readonly levelOwned: number;
  readonly levelMax: number;
  readonly listPriceLm: number;
  /** Price after rebates; equals `listPriceLm` when none apply. */
  readonly priceLm: number;
  /** Standard Issue (free to a joining player). */
  readonly standardIssue: boolean;
  /** Missing ordinary prerequisite item ids; empty when purchasable. */
  readonly requires: readonly string[];
}

export interface UiDeskState {
  readonly items: readonly UiDeskItem[];
  /** Request ids of purchases waiting for the server. */
  readonly pending: readonly string[];
}

export interface UiBoardNode {
  /** `node.<id>` of game-data. */
  readonly nodeId: string;
  readonly departmentId: string;
  readonly level: number;
  readonly max: number;
  /** Cost of the next level; `null` when maxed. */
  readonly nextCostLm: number | null;
  readonly prereqMet: boolean;
  readonly requires: readonly string[];
}

export interface UiBoardCaps {
  readonly used: number;
  readonly cap: number;
}

export interface UiBoardState {
  readonly nodes: readonly UiBoardNode[];
  /** Robot / machine caps shown as "Roosts 1 / 3" (caps.json `mvpRoostCap`). */
  readonly caps: { readonly roost: UiBoardCaps };
}

export interface UiMotorPoolVehicle {
  /** `vehicle.<id>` of game-data. */
  readonly vehicleId: string;
  readonly owned: boolean;
  /** Owned by me (vehicles are per player). */
  readonly mine: boolean;
  /** Currently out of the pool. */
  readonly out: boolean;
  readonly priceLm: number;
  /** Repeat Requisition price. */
  readonly repeatPriceLm: number;
  readonly requires: readonly string[];
}

export interface UiMotorPoolState {
  readonly vehicles: readonly UiMotorPoolVehicle[];
  readonly poolId: EntityId | null;
}

/** Equipment kinds with a card (MVP: Roost). */
export const EQUIPMENT_KINDS = ["roost", "motor_pool", "assay_counter", "gate"] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export interface UiEquipmentTarget {
  readonly entityId: EntityId;
  readonly kind: EquipmentKind;
  readonly name: string;
  /** Machine state token (robots.json `states[]` for robots). */
  readonly state: string;
  /** Text catalog id of the "Why isn't this working?" status line. */
  readonly statusLineId: string;
  readonly statusParams: Readonly<Record<string, string | number>>;
  /** Action ids the card offers (`resite`, `ground`, ...). */
  readonly actions: readonly string[];
}

export interface UiEquipmentState {
  readonly target: UiEquipmentTarget | null;
}

// ---- DOT, notices, menus, settings, input ---------------------------------------------------------------------------

/** Notice priorities (ui-screens section 5.2): P1 action, P2 progress, P3 ambient. P0 system is an overlay, never a notice. */
export const NOTICE_PRIORITIES = ["action", "progress", "ambient"] as const;
export type NoticePriority = (typeof NOTICE_PRIORITIES)[number];

/** Toast kinds that merge by `mergeKey` (same Roost updates in place, "Railshot away x2"). */
export interface UiNotice {
  readonly id: number;
  readonly priority: NoticePriority;
  /** Text catalog id. */
  readonly textId: string;
  readonly params: Readonly<Record<string, string | number>>;
  /** Merge key: a newer notice with the same key updates this one and bumps `count`. */
  readonly mergeKey: string | null;
  readonly count: number;
  /** Input action id the notice answers to (P1 only), such as `resite`. */
  readonly actionId: string | null;
  readonly createdAtMs: number;
  /** Visible time in ms; 0 for actionable notices that wait for input (8 s cap applies). */
  readonly ttlMs: number;
}

/** Most notices visible at once, queue cap, TTLs (ui-screens-and-flows section 5.2). */
export const UI_NOTICE_VISIBLE_MAX = 3;
export const UI_NOTICE_QUEUE_MAX = 8;
export const UI_NOTICE_TTL_MS = { action: 8000, progress: 3500, ambient: 3500 } as const satisfies Record<
  NoticePriority,
  number
>;

export interface UiNoticesState {
  /** Everything waiting or shown, oldest first; at most UI_NOTICE_QUEUE_MAX. */
  readonly queue: readonly UiNotice[];
  /** Ids of the visible notices, newest first; at most UI_NOTICE_VISIBLE_MAX. */
  readonly visible: readonly number[];
}

export interface UiDotLine {
  readonly textId: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly durationMs: number;
}

/** DOT subtitle queue limits (ui-screens section 5.2, rule 7). */
export const UI_DOT_QUEUE_MAX = 3;
export const UI_DOT_HISTORY_MAX = 50;

export interface UiDotState {
  /** The line on screen. */
  readonly line: UiDotLine | null;
  /** Lines waiting behind it; at most UI_DOT_QUEUE_MAX. */
  readonly queued: readonly UiDotLine[];
  /** Last UI_DOT_HISTORY_MAX text ids shown (Handbook log). */
  readonly history: readonly string[];
  readonly handbookUnread: number;
}

/** Menu surfaces (ui-screens-and-flows section 2 screen table). */
export const MENU_SURFACE_IDS = [
  "time_card",
  "roster",
  "requisitions_desk",
  "ops_console",
  "motor_pool",
  "equipment_card",
  "handbook",
  "settings",
  "achievements",
  "locker",
  "contracts",
  "credits",
  "survey_globe",
  "parts_catalog",
] as const;
export type MenuSurfaceId = (typeof MENU_SURFACE_IDS)[number];

/** Modal dialog kinds (C-09). */
export const MODAL_IDS = ["confirm", "input", "info", "destructive"] as const;
export type ModalId = (typeof MODAL_IDS)[number];

export interface UiModal {
  readonly id: ModalId;
  /** Text catalog ids and values the modal shows. */
  readonly props: Readonly<Record<string, string | number | boolean>>;
}

export interface UiMenusState {
  /** The open surface; `null` while playing. */
  readonly open: MenuSurfaceId | null;
  /** Surfaces below the open one, so Back returns to them. */
  readonly stack: readonly MenuSurfaceId[];
  /** Element id that gets focus when the surface closes. */
  readonly focusReturnId: string | null;
  readonly modal: UiModal | null;
}

/** Notification verbosity (Settings > Interface). */
export const NOTICE_VERBOSITIES = ["all", "important", "minimal"] as const;
export type NoticeVerbosity = (typeof NOTICE_VERBOSITIES)[number];

/** Settings the HUD and the audio mix read (the MVP subset: scale, verbosity, volumes; rebinding lives in the input layer). */
export interface UiSettingsState {
  readonly hudScalePct: number;
  readonly noticeVerbosity: NoticeVerbosity;
  readonly reduceMotion: boolean;
  /** Bus volumes 0..1 (audio-direction section 5.1 sliders). */
  readonly volume: {
    readonly master: number;
    readonly effects: number;
    readonly music: number;
    readonly ambience: number;
    readonly interface: number;
    readonly voice: number;
    readonly breathing: number;
  };
}

/** Which device drives the prompt glyphs (C-13). */
export const INPUT_DEVICES = ["kbm", "xbox", "playstation", "generic"] as const;
export type InputDevice = (typeof INPUT_DEVICES)[number];

export interface UiInputState {
  readonly lastDevice: InputDevice;
}

// ---- saveSync (ADR-0031) -------------------------------------------------------------------------------------------

/** What the player asked for through a `saveSync.*` request action; the net module consumes it and clears it. */
export type UiSaveSyncRequest =
  { readonly kind: "resolve_conflict"; readonly choice: SaveConflictChoice } | { readonly kind: "restore_backup" };

/**
 * Local-first Solo save status, written by the net module (sync) and the sim-host (local generation, backup), read by
 * the sync indicator and the "Which copy?" prompt. Timestamps are `Date.now()` milliseconds, `null` when unknown. The
 * prompt rule is normative in save/sync-rules: `conflict` is non-null exactly when `state === "conflict"`, and the
 * prompt has no default choice.
 */
export interface UiSaveSyncState {
  readonly state: SaveSyncState;
  /** Newest local generation; 0 before the first checkpoint of a new Contract. */
  readonly localGeneration: number;
  /** Last server generation this device saw (`baseGeneration` of the next upload); `null` while `local_only`. */
  readonly serverGeneration: number | null;
  readonly lastSyncedAtMs: number | null;
  /** When the oldest unsynced checkpoint was written; `null` while nothing is pending. */
  readonly pendingSinceMs: number | null;
  /** Both copies while the player has to choose; `null` otherwise. */
  readonly conflict: { readonly local: SoloCheckpointSummary; readonly server: SoloCheckpointSummary } | null;
  /** The local backup slot holds a copy that lost a conflict (kept SOLO_BACKUP_RETENTION_DAYS days). */
  readonly backupAvailable: boolean;
  readonly backupExpiresAtMs: number | null;
  /** Why the state is `error` (or the last failure while `offline`); `null` otherwise. */
  readonly error: { readonly kind: SaveUploadFailureKind; readonly reason: CheckpointRejectReason | null } | null;
  readonly storageWarning: SaveStorageWarning | null;
  /** The player's pending request (set by `saveSync.resolveConflict` / `saveSync.restoreBackup`). */
  readonly request: UiSaveSyncRequest | null;
}
