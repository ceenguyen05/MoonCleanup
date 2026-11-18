// MoonRoomSim: the deterministic RoomSim implementation (shared/sim/room-sim v1). One instance per room; the same
// code runs in the Solo LocalRoom Web Worker (apps/client/src/sim-host) and on the server (ShiftRoom driver in
// apps/server/src/sim). Environment-agnostic: no DOM, Node, three.js or Colyseus.
//
// Per tick the host calls applyInput (per actor, by netcode section 5.1 sequencing), applyIntent (queued control
// requests), then step(dt). step runs actors in ascending slot order: movement, tool head, stroke, Dust Cell
// acceptance, ledger op (WDS section 4.5a order), plot events and the Inspector's Stamp (the ledger's Opened /
// Polished queues are read and emptied after every stroke), events; then the sun clock. Hot path allocates nothing except event
// payloads (at most a few per second per actor); strokes go to a pooled list read through strokeCount / strokeAt.

import type {
  ActorJoinInfo,
  ActorSlot,
  ActorSnapshot,
  CargoComponent,
  ContractId,
  ControlIntent,
  DayPhase,
  EntityId,
  IntentResult,
  PlayerInfo,
  PlotGrid,
  PlotId,
  PurchaseRejectReason,
  RequestId,
  RoomSim,
  RoomSimEvent,
  RoomSimSnapshot,
  ShiftState,
  ShiftType,
  ShineMilestonePct,
  SimEventMap,
  SimEventName,
  SimInputCommand,
  StrokeRecord,
  Tick,
  Unsubscribe,
  VehicleComponent,
  VehicleInfo,
} from "@moon-cleanup/shared";
import {
  AVATAR_FLAG_BIT,
  BEACON_COUNT,
  DAY_PHASES,
  HOLSTER_SLOT_COUNT,
  INPUT_AXIS_MAX,
  INPUT_BUTTON_MASK,
  MAX_PLAYERS_PER_ROOM,
  MOVE_STATES,
  MVP_SCOPE,
  PlotState,
  PROTOCOL_VERSION,
  SHINE_MILESTONE_PCTS,
  STROKE_NON_PLAYER_ACTOR_SLOT_MIN,
} from "@moon-cleanup/shared";
import type { GameData } from "@moon-cleanup/game-data";
import type { SimConfig } from "../config/sim-config";
import { createSimConfig } from "../config/sim-config";
import {
  ApproxDustLedger,
  plotEventsOf,
  StrokeApplyResult,
  type DustLedgerPlotEvents,
  type DustLedgerPort,
} from "../dust/ledger-port";
import { stampIsCharged, stampPayoutLm, type StampInput } from "../economy/stamp";
import {
  FLAG_GOLDEN_HANDSHAKE_CREDIT,
  PromotionsBoard,
  STAT_PURCHASE_DISCOUNT_FRAC,
  STAT_STAMP_PREMIUM_LEVEL,
} from "../economy/board";
import { discountedPriceLm, PurchaseGuard } from "../economy/purchase";
import { NEAR_PARCEL_SAVE_KEY, NEAR_PARCEL_SIZE, placeNearParcels, seedOfString } from "../economy/parcels";
import {
  ACH_STAT_PLOTS_POLISHED,
  ACH_STAT_SHIFT_PLAYERS,
  ACH_STAT_STROKES,
  AchievementTracker,
} from "../economy/achievements";
import { dayPhaseAt, isDaylightAt, secondsToTerminator, sunElevationAt } from "../clock/sun-clock";
import { Fnv1a32 } from "../math/quantize";
import { atan2Det, radiansToTurn, turnToRadians } from "../math/trig";
import { landingApronPlots } from "./landing-apron";
import {
  AvatarState,
  headingBasis,
  MoveIntent,
  MOVE_GROUNDED,
  spawnAvatar,
  stepAvatar,
  type SimGround,
} from "../movement/avatar";
import { actorCellCap, MutableStroke, relatchCell, stepToolHead, ToolState, type ToolTickInput } from "../tools/tool";
import {
  bandCell,
  CARGO_CARRIED,
  CARGO_FREE,
  CargoActorResult,
  CargoStore,
  drop,
  dropAllCarried,
  formPuck,
  isLooseUnit,
  pickUp,
  pourBack,
  stepCargo,
  takeLooseUnit,
  throwCarried,
} from "../cargo/pucks";
import {
  ASSAY_POUR_REACH_M,
  borealStandInSellPoints,
  createSellRules,
  DUMP_PLATE_RADIUS_M,
  DUST_MATERIAL_ID,
  pourGramsPerTick,
  saleMicroLm,
  SERVICE_ENTITY_ID_BASE,
  STAT_PAYOUT_BONUS,
  STAT_POUR_TIME_MULT,
  type SellPoint,
  type SellRules,
} from "../economy/selling";
import { decodeCheckpointPucks, encodeCheckpointPucks, SIM_CHECKPOINT_PUCKS_VERSION } from "../cargo/checkpoint";
import { groundSlopeTan } from "../movement/steep";
import {
  MOTOR_POOL_ITEM_ID,
  RoomVehicles,
  VEHICLE_ENTITY_ID_BASE,
  VehicleReadout,
  type VehicleHost,
  type VehicleItem,
} from "../vehicles/room-vehicles";
import type { VehicleState } from "../vehicles/vehicle";
import {
  CheckpointFail,
  checkpointLimits,
  CheckpointTally,
  CheckpointWriter,
  copyAvatarState,
  copyToolState,
  decodeCheckpointMeta,
  decodeCheckpointPlayers,
  encodeCheckpointMeta,
  SIM_CHECKPOINT_META_MAX_BYTES,
  SIM_CHECKPOINT_META_VERSION,
  SIM_CHECKPOINT_PLAYERS_MAX_BYTES,
  SIM_CHECKPOINT_PLAYERS_VERSION,
  simCheckpointPlayersBytes,
  validateCheckpointMeta,
  validateCheckpointPlayer,
  writeCheckpointPlayer,
  type CheckpointLimits,
  type SimCheckpoint,
  type SimRestoreResult,
} from "./checkpoint";

/** The world the sim runs on: plot grid and analytic ground (packages/world). */
export interface SimWorld {
  readonly grid: PlotGrid;
  readonly ground: SimGround;
}

export interface MoonRoomSimOptions {
  readonly data: GameData;
  readonly world: SimWorld;
  /**
   * Dust ledger. Hosts pass the real one (`createRoomDustLedger`); default: the ApproxDustLedger stand-in, which has
   * no plot states (no `plot.opened` / `plot.polished`, no Stamp).
   */
  readonly ledger?: DustLedgerPort;
  readonly contractId: ContractId;
  readonly shiftType: ShiftType;
  readonly tickHz?: number;
  readonly snapshotHz?: number;
  /** Unit direction where actors spawn (default: Outpost Boreal, +Y, offset so spawns sit off the pad centre). */
  readonly spawnDirection?: { readonly x: number; readonly y: number; readonly z: number };
  /** Restored wallet (default economy.startWalletLm). */
  readonly walletLm?: number;
  /**
   * Restored Near Parcel mask (bit k = parcel k already collected; default 0). Bits past the parcel count are dropped.
   * A host that restores `walletLm` must restore this too, or a restart re-pays the parcels.
   */
  readonly nearParcelsCollected?: number;
  /** Restored suit-gear / Dust Cell levels (`gear.hop_pack` -> level, `cellLevel.<toolId>` -> level). */
  readonly suitGear?: Readonly<Record<string, number>>;
  /**
   * Restored Promotions Board levels (node id -> owned level, ShiftState.sharedUpgrades). Unknown ids are ignored,
   * levels are clamped to the node's top level.
   */
  readonly sharedUpgrades?: Readonly<Record<string, number>>;
  /**
   * Promotions Board nodes this build sells in play (default: the MVP slice, `MVP_SCOPE.boardNodeIds`). Nodes outside
   * the list keep working when restored but a `purchase` of them is `unknown_item`.
   */
  readonly purchasableNodeIds?: readonly string[];
  /**
   * Highest suit-gear level this build sells per line (default: `MVP_SCOPE.suitGearMaxLevel`); lines not listed are
   * not sold. Clamped to the line's level count.
   */
  readonly gearLevelCaps?: Readonly<Record<string, number>>;
  /**
   * Outpost services that buy dust (Assay Counters, Receiving Gates), as unit directions. Default: the stand-in
   * Outpost Boreal layout (`borealStandInSellPoints`) until the outpost layout exists.
   */
  readonly sellPoints?: readonly SellPoint[];
  /**
   * Outposts of the Contract for the compass read-out, index 0 = home (directions need not be unit length). Default:
   * `BOREAL_STAND_IN_OUTPOSTS` until the outpost layout exists. Read-only; never simulated or hashed.
   */
  readonly outposts?: readonly SimOutpost[];
  /** Achievements this build triggers (default `MVP_SCOPE.achievementIds`; stats the sim does not own are ignored). */
  readonly achievementIds?: readonly string[];
  /** Tick to start at (restored checkpoint), default 0. */
  readonly startTick?: number;
  /** Vehicles sold (default `MVP_SCOPE.vehicleIds`: the Trundle). */
  readonly vehicleIds?: readonly string[];
  /**
   * Vehicle upgrade lines sold. Default: every line of `vehicle-upgrades.json` (owner decision 2026-11-17: all 7 lines
   * are in scope, superseding the mvp-scope cut); `[]` sells none.
   */
  readonly vehicleUpgradeLineIds?: readonly string[];
  /** Motor Pools the shift starts with (default 1: the MVP slice has the Motor Pool pre-built). */
  readonly motorPoolsBuilt?: number;
  /** Motor Pool positions as unit directions (default: the spawn direction, until the outpost layout exists). */
  readonly motorPoolPoints?: readonly { readonly x: number; readonly y: number; readonly z: number }[];
}

/** The 7 vehicle upgrade lines (naming bible). The room's default is every line of the game-data table. */
export const DEFAULT_VEHICLE_UPGRADE_LINE_IDS: readonly string[] = [
  "vehicle_upgrade.gear_ratio",
  "vehicle_upgrade.cargo_expander",
  "vehicle_upgrade.afterburner",
  "vehicle_upgrade.throttle_lock",
  "vehicle_upgrade.wide_mouth",
  "vehicle_upgrade.fast_tip",
  "vehicle_upgrade.running_lamps",
];

/** Plot Card (C) data of one plot (GDD section 10; ui-screens `plotCard`). Mutable, reused by the caller. */
export class PlotCardData {
  plotId = 0 as PlotId;
  /** PlotState code (Grimy / Opened / Polished / Empty). */
  state: PlotState = PlotState.Grimy;
  /** Remaining dust, 0 .. 100 (integer percent of the plot's starting dust, from the 0..255 L0 fraction). */
  remainingPct = 100;
  /** Dust level of the plot (0 = Empty); `terrainId` is the terrain class with that level, or null. */
  dustLevel = 0;
  terrainId: string | null = null;
  /** Slot that removed the most dust so far; null when the shift (robots) leads or nobody swept. */
  creditedSlot: number | null = null;
  /** Escorted by the flock (v1.0 Flock Formations): always false in MVP. */
  escorted = false;
  /** True when the plot counts toward the Shine Index now (Polished or Empty). */
  countsTowardShine = false;
  /** Shine Index percent one plot is worth (100 / plot count); the plot adds it when it counts toward Shine. */
  shinePctPerPlot = 0;
}

/** Hop Pack read-out of one avatar (HUD suit `hop`). Mutable, reused by the caller. */
export class HopReadout {
  /** Bursts left now. */
  bursts = 0;
  /** Bursts of the owned Hop Pack level (0 = no Hop Pack: the HUD hides the gauge). */
  max = 0;
  /** Progress of the grounded refill to full, 0 .. 1 (0 when full or without a Hop Pack). */
  recharge01 = 0;
}

/** Crown Lamp read-out of one avatar (HUD suit `lampLevel` / `lampMode`). Mutable, reused by the caller. */
export class LampReadout {
  /** Owned Crown Lamp level (shift suit gear `gear.crown_lamp`): 0 = none, 1 = Clip Light. */
  level = 0;
  /** The avatar's lamp toggle (Lamp button); it lights only with a lamp owned. */
  switchedOn = false;
  /** True when the lamp is on and owned: the level the night stroke penalty relief uses this tick. */
  lit = false;
}

/** One outpost of the Contract (compass `outposts`). Mutable, reused by the caller. */
export class OutpostReadout {
  /** Outpost id as the compass shows it (`Boreal` in the MVP). */
  id = "";
  /** Unit direction of the outpost pad centre from the Moon centre. */
  x = 0;
  y = 1;
  z = 0;
  /** The shift's home outpost (spawn and services); always visited. */
  home = false;
  /** Visited by the shift (Relay Pad eligibility; ShiftState.visitedOutposts bit). */
  visited = false;
}

/** An outpost the sim knows: compass id and pad-centre unit direction. */
export interface SimOutpost {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Stand-in outpost list until the outpost layout lands (world / visuals): Outpost Boreal on the pole pad (+Y), the
 * same site as `borealStandInSellPoints`. Index 0 is the home outpost.
 */
export const BOREAL_STAND_IN_OUTPOSTS: readonly SimOutpost[] = Object.freeze([
  Object.freeze({ id: "Boreal", x: 0, y: 1, z: 0 }),
]);

/** Per-plot read-out of a ledger that has one (packages/world WorldDustLedger). */
interface DustLedgerPlotQuery {
  readonly state: Uint8Array;
  readonly frac: Uint8Array;
  readonly levelOf: Uint8Array;
}

function plotQueryOf(ledger: DustLedgerPort): DustLedgerPlotQuery | null {
  const l = ledger as Partial<DustLedgerPlotQuery>;
  return l.state instanceof Uint8Array && l.frac instanceof Uint8Array && l.levelOf instanceof Uint8Array
    ? (l as DustLedgerPlotQuery)
    : null;
}

/** Tools carried without a Holster Rig (progression section 7: "Without it you carry 1 tool in hand"). */
const HOLSTER_BASE_SLOTS = 1;
/** Suit-gear line and stat that set the holster size. */
const HOLSTER_RIG_ID = "gear.holster_rig";
const STAT_HOLSTER_SLOTS = "holsterSlots";
/** META key prefix of a slot's holster (bitmask of carried tool codes): `hol.0` .. `hol.5`. */
const HOLSTER_SAVE_KEY_PREFIX = "hol.";

/** META key prefix of a slot's announced-achievement mask (`ach.0` .. `ach.5`). */
const ACHIEVEMENT_SAVE_KEY_PREFIX = "ach.";

/** Purchase item id of a Roost (robots.json unit bought with it). */
const ROOST_ITEM_ID = "robot.sandpiper";

/** Board stat of the shift-wide Densifier bonus on every Dust Cell. */
const STAT_CELL_CAPACITY_BONUS = "cellCapacityBonus";

/** Spawn spacing between slots, metres along the frame east axis. */
const SPAWN_SPACING_M = 2;
const MAX_STROKES_PER_TICK = MAX_PLAYERS_PER_ROOM * 2;

class ActorInput {
  seq = 0;
  moveX = 0;
  moveY = 0;
  yaw = 0;
  pitch = 0;
  buttons = 0;
  toolParam = 0;
  prevButtons = 0;
}

class ActorInfo {
  playerId = "" as PlayerInfo["playerId"];
  displayName = "";
  role: ActorJoinInfo["role"] = "staff";
  lampOn = false;
}

export class MoonRoomSim implements RoomSim {
  readonly config: SimConfig;
  readonly world: SimWorld;
  readonly ledger: DustLedgerPort;
  /** The ledger's Opened / Polished queues, or null for a ledger without plot states. */
  private readonly plotEvents: DustLedgerPlotEvents | null;
  /** Reused input of the Stamp payout. */
  private readonly stampInput = { playerCredited: false, chargeFinish: false, premiumLevel: 0, premiumOnFlock: false };
  private tickNo: number;
  private readonly contractId: ContractId;
  private readonly shiftType: ShiftType;
  private walletLm: number;
  private suitGear: Record<string, number>;
  /** Promotions Board table of this build and the shift's owned level per node (index = node index). */
  private readonly board: PromotionsBoard;
  private readonly boardLevels: Uint8Array;
  /** Stamp inputs derived from the board (recomputed whenever the levels change). */
  private stampPremiumLevel = 0;
  private stampPremiumOnFlock = false;
  /** Rebate: discount on tools and Dust Cell lines (board `purchaseDiscountFrac`). */
  private purchaseDiscountFrac = 0;
  /** 1 for the board nodes this build sells (index = node index). */
  private readonly nodeOnSale: Uint8Array;
  /** Prerequisites met per node before the purchase being applied (unlock.granted diff), reused. */
  private readonly nodePrereqScratch: Uint8Array;
  /** Suit-gear lines in data order: ids, list price per level and the highest level sold (0 = not sold). */
  private readonly gearIds: readonly string[];
  private readonly gearCostsLm: readonly (readonly number[])[];
  private readonly gearSellCap: Uint8Array;
  private readonly gearIndexById = new Map<string, number>();
  /** Race window and replay ring; items are board nodes (0 .. nodes - 1) then gear lines. */
  private readonly purchaseGuard: PurchaseGuard;
  /** Selling: rules from game-data, sell points (unit directions, kind 0 = Assay Counter, 1 = Gate). */
  private readonly sellRules: SellRules;
  private readonly sellX: Float64Array;
  private readonly sellY: Float64Array;
  private readonly sellZ: Float64Array;
  private readonly sellKind: Uint8Array;
  /** Plot under each sell point (Railshot origin). */
  private readonly sellPlot: Int32Array;
  /** Index of the first Receiving Gate, or -1 (Railshot launcher and the despawn ledger). */
  private readonly firstGate: number;
  /** Board-derived selling multipliers: 1 + payoutBonus, and Quick Pour / Smooth Handoff pour time. */
  private payoutMult = 1;
  private pourTimeMult = 1;
  /** Per actor: Assay Counter being poured into (-1 none), its pour slot, grams and Lumens of the current pour. */
  private readonly pourAt = new Int8Array(MAX_PLAYERS_PER_ROOM).fill(-1);
  private readonly pourSlot = new Int8Array(MAX_PLAYERS_PER_ROOM);
  private readonly pourGrams = new Float64Array(MAX_PLAYERS_PER_ROOM);
  private readonly pourLm = new Float64Array(MAX_PLAYERS_PER_ROOM);
  /** Micro-Lumen remainder per seller (last index: robots / the shift), so split sales stay whole. */
  private readonly saleRemMicro = new Float64Array(MAX_PLAYERS_PER_ROOM + 1);
  /** Grams sold at the outpost since the last Railshot. */
  private railshotGrams = 0;
  /** Roosts bought by the shift (first Roost purchasable from the start; price grows per owned Roost; MVP cap). */
  private roostCount = 0;
  private readonly roostCap: number;
  private readonly roostBaseLm: number;
  private readonly roostGrowth: number;
  /** Near Parcels: unit directions (x, y, z triples), Lumens each, collected bitmask (saved in META). */
  private readonly parcelDirs: Float64Array;
  private readonly parcelCount: number;
  private readonly parcelLm: number;
  private parcelsCollected = 0;
  /** Achievement triggers (events only; the profile layer stores unlocks). */
  private readonly achievements: AchievementTracker;
  /** Per actor: cleaning tools carried in the holster (bitmask by tool code, always includes the equipped tool). */
  private readonly holsterMask = new Uint8Array(MAX_PLAYERS_PER_ROOM);
  /** Holster size per Holster Rig level (index 0 = no Rig). */
  private readonly holsterSlotsByLevel: readonly number[];
  /** Loaner Kit cap of Temps: rules and, per actor, Lumens spent in the current window and the window's first tick. */
  private readonly loanerKit: { readonly walletFrac: number; readonly capLm: number; readonly windowTicks: number };
  private readonly loanerSpent = new Float64Array(MAX_PLAYERS_PER_ROOM);
  private readonly loanerWindowStart = new Int32Array(MAX_PLAYERS_PER_ROOM);
  /** Holder-controlled permissions of the `temp` role (hosts set them; not part of the save). */
  private readonly tempPerms = { tempCanBuild: false, tempCanSpendShared: false, tempCanDriveShared: false };
  /** Shine milestones: Shine numerator needed (ascending) and the pct each announces; next one not yet reached. */
  private readonly shineThresholds: number[] = [];
  private readonly shinePcts: ShineMilestonePct[] = [];
  private shineNext = 0;
  private readonly avatars: AvatarState[] = [];
  private readonly tools: ToolState[] = [];
  private readonly inputs: ActorInput[] = [];
  private readonly infos: ActorInfo[] = [];
  private readonly listeners: ((e: RoomSimEvent) => void)[] = [];
  /** Dust Pucks and Puck Stacks (replaced on restore: the PUCKS save section is not written yet). */
  cargo: CargoStore;
  private readonly cargoResult = new CargoActorResult();
  private readonly slopeOut = new Float64Array(1);
  /** Shift Dust Cell level per tool code from the board (`cellLevel.<toolId>` stats) and the Densifier bonus. */
  private readonly boardCellLevel: Uint8Array;
  private cellCapBonus = 0;
  private readonly intent = new MoveIntent();
  private readonly toolInput = { seq: 0, toolParam: 0, night: false, lampLevel: 0 };
  private readonly strokePool: MutableStroke[] = [];
  private strokes = 0;
  private readonly scratchStroke = new MutableStroke();
  private readonly applyResult = new StrokeApplyResult();
  private readonly spawnDir: { x: number; y: number; z: number };
  private dayPhase: DayPhase;
  /** Shift-wide ownership of Standard Issue tools (bitmask by tool code). */
  private standardIssueOwned = 0;
  /** Copies of each tool bought in this shift (Repeat Requisition pricing). */
  private readonly copiesBought: Int32Array;
  /** Outposts of the Contract (compass read-out; index 0 = home). Not simulated state. */
  private readonly outposts: readonly SimOutpost[];
  /**
   * Landing Apron of the home outpost (`world.landingApron.plotsPerOutpost` plots of ring 2 around the home pad plot,
   * ascending ids) Derived from the grid and game-data at construction; never hashed.
   */
  private apronPlots: readonly number[] = [];
  /** Induction step (index into onboarding.json `induction`) completed by a first hand stroke / a Polish; -1 = none. */
  private readonly stepFirstStroke: number;
  private readonly stepPolish: number;
  private readonly stepIds: readonly string[];
  /** Per slot: bit 0 first-stroke step, bit 1 polish step already announced (observational; never hashed). */
  private readonly onboardingSent = new Uint8Array(MAX_PLAYERS_PER_ROOM);
  /** Plot pick scratch (unit direction) and grid search hint: a cache, never part of the state. */
  private readonly pickDir = { x: 0, y: 1, z: 0 };
  private pickHint = 0;
  private readonly hasher = new Fnv1a32();
  /** Motor Pool, Trundle, upgrade lines, vehicle cleaning (packages/sim/src/vehicles). */
  readonly vehicles: RoomVehicles;
  private readonly vehicleHost: VehicleHost;
  private readonly handleTmp = new Float64Array(3);
  /** The driver rides the handle: position follows the vehicle, no walking, no tool. */
  private readonly syncDriver = (slot: number, v: VehicleState): void => {
    const a = this.avatars[slot]!;
    const h = this.handleTmp;
    this.vehicles.handlePoint(v, this.world.ground, h);
    a.px = h[0]!;
    a.py = h[1]!;
    a.pz = h[2]!;
    a.vx = a.vy = a.vz = 0;
    a.fx = v.fx;
    a.fy = v.fy;
    a.fz = v.fz;
    a.moveState = MOVE_GROUNDED;
    a.heightAboveGround = 0;
  };
  /** Codes of the cleaning tools by ascending tier (Holster order), fixed at construction. */
  private readonly cleaningOrder: readonly number[];
  /** Bitmask of the free cleaning tools (Standard Issue from the start). */
  private readonly freeToolMask: number;
  /** Suit-gear key of each tool's Dust Cell level (`cellLevel.<toolId>`), by tool code. */
  private readonly cellLevelKeys: readonly string[];
  /** Top level of every suit-gear key this build knows (checkpoint validation). */
  private readonly gearMaxLevel = new Map<string, number>();
  private readonly checkpointLimits: CheckpointLimits;
  /** Rejected / dropped counters (counted, never thrown). */
  readonly counters = {
    strokesCellFull: 0,
    strokesEmptyPlot: 0,
    inputsForInactiveSlot: 0,
    intentsRejected: 0,
    dtMismatch: 0,
    restoresRejected: 0,
    plotsOpened: 0,
    plotsPolished: 0,
  };

  constructor(options: MoonRoomSimOptions) {
    this.config = createSimConfig(options.data, { tickHz: options.tickHz, snapshotHz: options.snapshotHz });
    this.world = options.world;
    const cfg = this.config;
    const grid = options.world.grid;
    const plotArea = (4 * Math.PI * grid.params.radiusM * grid.params.radiusM) / grid.count;
    this.ledger =
      options.ledger ??
      new ApproxDustLedger({
        plotAreaM2: plotArea,
        detailingDiameterMm: cfg.detailingDiameterMm,
        defaultDustLevel: cfg.terrainDustLevel["terrain.highland"] ?? 5,
        kgPerM2PerLevel: cfg.dustKgPerM2PerLevel,
      });
    this.plotEvents = plotEventsOf(this.ledger);
    // From here on the sim is the reader of the queues; whatever was queued before (a host that restored or prepared
    // the ledger) is not news for this sim and must not be paid.
    this.plotEvents?.clearPolishedQueue();
    this.plotEvents?.clearOpenedQueue();
    this.tickNo = options.startTick ?? 0;
    this.contractId = options.contractId;
    this.shiftType = options.shiftType;
    this.walletLm = options.walletLm ?? cfg.startWalletLm;
    this.suitGear = { ...(options.suitGear ?? {}) };
    this.cargo = new CargoStore(cfg);
    this.boardCellLevel = new Uint8Array(cfg.tools.length);
    this.cellLevelKeys = cfg.tools.map((x) => `cellLevel.${x.id}`);
    this.board = new PromotionsBoard(options.data);
    this.boardLevels = new Uint8Array(this.board.count);
    for (const [id, level] of Object.entries(options.sharedUpgrades ?? {})) {
      const n = this.board.indexOf(id);
      if (n < 0 || !Number.isFinite(level) || level <= 0) continue;
      this.boardLevels[n] = Math.min(Math.floor(level), this.board.maxLevels[n]!);
    }
    this.refreshBoardEffects();
    this.nodeOnSale = new Uint8Array(this.board.count);
    this.nodePrereqScratch = new Uint8Array(this.board.count);
    for (const id of options.purchasableNodeIds ?? MVP_SCOPE.boardNodeIds) {
      const n = this.board.indexOf(id);
      if (n >= 0) this.nodeOnSale[n] = 1;
    }
    const gearLines = options.data["suit-gear"].lines;
    const gearCaps: Readonly<Record<string, number>> = options.gearLevelCaps ?? MVP_SCOPE.suitGearMaxLevel;
    this.gearIds = gearLines.map((l) => l.id);
    this.gearCostsLm = gearLines.map((l) => l.levels.map((v) => v.costLm));
    this.gearSellCap = new Uint8Array(gearLines.length);
    gearLines.forEach((l, k) => {
      this.gearIndexById.set(l.id, k);
      const cap = Math.floor(gearCaps[l.id] ?? 0);
      this.gearSellCap[k] = cap <= 0 ? 0 : Math.min(cap, l.levels.length);
    });
    this.purchaseGuard = new PurchaseGuard(this.board.count + gearLines.length, cfg.tickHz);
    this.sellRules = createSellRules(options.data);
    this.roostBaseLm = options.data.robots.roost.basePriceLm;
    this.roostGrowth = options.data.robots.roost.priceGrowthMult;
    this.roostCap = MVP_SCOPE.roostCap;
    // Loaner Kit (security section 2 "Temp defaults"; game-data moderation.loanerKit, config contract v1.1).
    const lk = options.data.moderation.loanerKit;
    this.loanerKit = {
      walletFrac: lk.walletFrac,
      capLm: lk.capLm,
      windowTicks: Math.round(lk.windowS * cfg.tickHz),
    };
    const rig = options.data["suit-gear"].lines.find((l) => l.id === HOLSTER_RIG_ID);
    this.holsterSlotsByLevel = [
      HOLSTER_BASE_SLOTS,
      ...(rig?.levels ?? []).map((l) => {
        const e = l.effects.find((x) => "stat" in x && x.stat === STAT_HOLSTER_SLOTS);
        return Math.min(HOLSTER_SLOT_COUNT, e && "value" in e ? e.value : HOLSTER_BASE_SLOTS);
      }),
    ];
    const near = options.data.collectibles.strayCargo.find((c) => c.size === NEAR_PARCEL_SIZE);
    this.parcelCount = near ? Math.min(MVP_SCOPE.nearParcelCount, near.count, 8) : 0;
    this.parcelLm = near?.lm ?? 0;
    this.parcelDirs = new Float64Array(3 * this.parcelCount);
    placeNearParcels(seedOfString(options.contractId), this.parcelCount, cfg.moonRadiusM, this.parcelDirs);
    this.parcelsCollected = (options.nearParcelsCollected ?? 0) & ((1 << this.parcelCount) - 1);
    this.achievements = new AchievementTracker(
      options.data,
      options.achievementIds ?? MVP_SCOPE.achievementIds,
      (actor, achievementId) =>
        this.emit("achievement.unlocked", { tick: this.tickNo as Tick, achievementId, actorSlot: actor }),
    );
    const points = options.sellPoints ?? borealStandInSellPoints(cfg.moonRadiusM);
    this.sellX = new Float64Array(points.length);
    this.sellY = new Float64Array(points.length);
    this.sellZ = new Float64Array(points.length);
    this.sellKind = new Uint8Array(points.length);
    this.sellPlot = new Int32Array(points.length);
    let firstGate = -1;
    points.forEach((pt, k) => {
      const l = Math.sqrt(pt.x * pt.x + pt.y * pt.y + pt.z * pt.z) || 1;
      this.sellX[k] = pt.x / l;
      this.sellY[k] = pt.y / l;
      this.sellZ[k] = pt.z / l;
      this.sellKind[k] = pt.kind === "assay_counter" ? 0 : 1;
      this.sellPlot[k] = grid.plotAt({ x: pt.x / l, y: pt.y / l, z: pt.z / l });
      if (pt.kind === "receiving_gate" && firstGate < 0) firstGate = k;
    });
    this.firstGate = firstGate;
    this.outposts = Object.freeze(
      (options.outposts ?? BOREAL_STAND_IN_OUTPOSTS).map((o) => {
        const l = Math.sqrt(o.x * o.x + o.y * o.y + o.z * o.z) || 1;
        return Object.freeze({ id: o.id, x: o.x / l, y: o.y / l, z: o.z / l });
      }),
    );
    this.computeApron(grid, options.data.world.landingApron.plotsPerOutpost);
    const induction = options.data.onboarding.induction;
    this.stepIds = induction.map((x) => x.id);
    this.stepFirstStroke = induction.findIndex((x) => x.trigger === "firstStroke");
    this.stepPolish = induction.findIndex((x) => x.trigger === "plotPolished");
    this.buildShineMilestones(grid.count);
    this.shineNext = this.shineMilestoneIndexFor(this.shinePolished);
    const sd = options.spawnDirection ?? { x: 0.02, y: 1, z: 0.02 };
    const sl = Math.sqrt(sd.x * sd.x + sd.y * sd.y + sd.z * sd.z);
    this.spawnDir = { x: sd.x / sl, y: sd.y / sl, z: sd.z / sl };
    this.vehicles = new RoomVehicles(options.data, cfg, {
      offeredKindIds: options.vehicleIds ?? MVP_SCOPE.vehicleIds,
      ...(options.vehicleUpgradeLineIds !== undefined ? { offeredLineIds: options.vehicleUpgradeLineIds } : {}),
      motorPoolsBuilt: options.motorPoolsBuilt ?? 1,
      motorPoolPoints: options.motorPoolPoints ?? [this.spawnDir],
    });
    this.vehicleHost = {
      config: cfg,
      ground: options.world.ground,
      grid,
      ledger: this.ledger,
      emit: (name, payload) => this.emit(name, payload),
      gateNear: (x, y, z, reachM) => {
        for (let k = 0; k < this.sellKind.length; k++) {
          if (this.sellKind[k] === 1 && this.nearSellPoint(x, y, z, k, reachM)) return true;
        }
        return false;
      },
      sellAtGate: (owner, grams, tick) => this.sellAtGate(owner, grams, tick),
      strokeApplied: (stroke, tick) => {
        if (this.strokes < this.strokePool.length) copyStroke(stroke, this.strokePool[this.strokes++]!);
        this.drainPlotEvents(false, tick);
      },
    };
    this.copiesBought = new Int32Array(cfg.tools.length);
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      this.avatars.push(new AvatarState());
      this.tools.push(new ToolState(cfg.tools.length));
      this.inputs.push(new ActorInput());
      this.infos.push(new ActorInfo());
    }
    for (let k = 0; k < MAX_STROKES_PER_TICK; k++) this.strokePool.push(new MutableStroke());
    // Free tools (price 0, the Desk Duster) are Standard Issue from the start.
    let free = 0;
    for (const t of cfg.tools) if (t.cleans && t.priceLm === 0) free |= 1 << t.code;
    this.freeToolMask = free;
    this.standardIssueOwned = free;
    this.cleaningOrder = cfg.tools
      .filter((x) => x.cleans)
      .sort((p, q) => p.tier - q.tier)
      .map((x) => x.code);
    for (const line of options.data["suit-gear"].lines) this.gearMaxLevel.set(line.id, line.levels.length);
    for (const key of this.cellLevelKeys) this.gearMaxLevel.set(key, cfg.cellLevelMult.length);
    // Board node levels share the META key list with the suit gear (node ids never collide with gear keys).
    for (let n = 0; n < this.board.count; n++) this.gearMaxLevel.set(this.board.nodeIds[n]!, this.board.maxLevels[n]!);
    // The Roost count rides in the same META key list (`robot.sandpiper` -> Roosts owned).
    this.gearMaxLevel.set(ROOST_ITEM_ID, this.roostCap);
    this.gearMaxLevel.set(NEAR_PARCEL_SAVE_KEY, (1 << this.parcelCount) - 1);
    this.vehicles.registerKeys(this.gearMaxLevel);
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      this.gearMaxLevel.set(`${ACHIEVEMENT_SAVE_KEY_PREFIX}${s}`, (1 << this.achievements.ids.length) - 1);
      this.gearMaxLevel.set(`${HOLSTER_SAVE_KEY_PREFIX}${s}`, 0xff);
    }
    this.checkpointLimits = checkpointLimits(cfg, grid.count);
    this.dayPhase = dayPhaseAt(cfg, this.tickNo);
  }

  // ---- RoomSim ------------------------------------------------------------------------------------------------------

  get tick(): Tick {
    return this.tickNo as Tick;
  }

  step(dt: number): void {
    // The step is always cfg.dt: hosts pass 1 / SIM_TICK_HZ; a fixed step keeps every host identical. A host passing
    // another value is counted (a driver bug), never honoured.
    const cfg = this.config;
    if (Math.abs(dt - cfg.dt) > 1e-9) this.counters.dtMismatch++;
    const tick = this.tickNo;
    this.strokes = 0;
    const night = !isDaylightAt(cfg, tick);
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const a = this.avatars[s]!;
      if (!a.active) continue;
      this.stepActor(s, a, night, tick);
    }
    this.vehicles.step(tick, night, this.vehicleHost, this.syncDriver);
    stepCargo(cfg, this.cargo, this.avatars, this.world.ground, tick);
    this.stepGateIntake(tick);
    this.stepParcels(tick);
    const phase = dayPhaseAt(cfg, tick);
    if (phase !== this.dayPhase) {
      this.dayPhase = phase;
      this.emit("daynight.changed", {
        tick: tick as Tick,
        phase,
        sunElevationDeg: sunElevationAt(cfg, tick),
        secondsToTerminator: secondsToTerminator(cfg, tick),
      });
    }
    this.tickNo = tick + 1;
  }

  applyInput(actor: ActorSlot, input: SimInputCommand): void {
    const a = this.avatars[actor];
    if (!a?.active) {
      this.counters.inputsForInactiveSlot++;
      return;
    }
    const i = this.inputs[actor]!;
    i.seq = input.seq & 0xffff;
    i.moveX = clampInt(input.moveX, -INPUT_AXIS_MAX, INPUT_AXIS_MAX);
    i.moveY = clampInt(input.moveY, -INPUT_AXIS_MAX, INPUT_AXIS_MAX);
    i.yaw = clampInt(input.yaw, 0, 0xffff);
    i.pitch = clampInt(input.pitch, -127, 127);
    i.buttons = clampInt(input.buttons, 0, 0xffff);
    i.toolParam = clampInt(input.toolParam, 0, 255);
  }

  applyIntent(actor: ActorSlot, intent: ControlIntent): IntentResult {
    const a = this.avatars[actor];
    if (!a?.active) {
      this.counters.intentsRejected++;
      return intent.kind === "purchase" ? { requestId: intent.requestId, ok: false, code: "role_blocked" } : null;
    }
    if (intent.kind === "select_tool") {
      this.selectHolster(actor, intent.slot);
      return null;
    }
    return this.purchase(actor, intent.requestId, intent.itemId);
  }

  addActor(actor: ActorSlot, info: ActorJoinInfo): void {
    if (!(actor >= 0 && actor < MAX_PLAYERS_PER_ROOM && (actor | 0) === actor)) {
      throw new RangeError(`actor slot ${actor} out of range`);
    }
    const cfg = this.config;
    const a = this.avatars[actor]!;
    a.hopMaxCharges = this.hopMaxChargesOf(this.suitGear);
    // Spawn spread along a fixed tangent axis so slots never overlap visually.
    const d = this.spawnDir;
    const ex = -d.z;
    const ez = d.x;
    const el = Math.sqrt(ex * ex + ez * ez) || 1;
    const off = ((actor - (MAX_PLAYERS_PER_ROOM - 1) / 2) * SPAWN_SPACING_M) / cfg.moonRadiusM;
    spawnAvatar(a, cfg, this.world.ground, d.x + (ex / el) * off, d.y, d.z + (ez / el) * off);
    const t = new ToolState(cfg.tools.length);
    t.owned = this.standardIssueOwned;
    for (let k = 0; k < cfg.tools.length; k++) t.cellLevel[k] = this.suitGear[this.cellLevelKeys[k]!] ?? 0;
    this.applyCellLevels(t);
    t.toolCode = this.lowestOwnedCleaningTool(t.owned);
    this.tools[actor] = t;
    this.normalizeHolster(actor, 0);
    const inp = this.inputs[actor]!;
    inp.seq = inp.moveX = inp.moveY = inp.yaw = inp.pitch = inp.buttons = inp.toolParam = inp.prevButtons = 0;
    const inf = this.infos[actor]!;
    inf.playerId = info.playerId;
    inf.displayName = info.displayName;
    inf.role = info.role;
    inf.lampOn = false;
    this.achievements.resetActor(actor);
    this.loanerSpent[actor] = 0;
    this.refreshShiftPlayers();
  }

  /** Announced-achievement masks of the present members, as META keys (`ach.<slot>`), only non-zero ones. */
  private announcedRecord(): Record<string, number> {
    const out: Record<string, number> = {};
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const m = this.achievements.announcedMask(s);
      if (m !== 0 && this.avatars[s]!.active) out[`${ACHIEVEMENT_SAVE_KEY_PREFIX}${s}`] = m;
    }
    return out;
  }

  /** Feeds the `shiftPlayers` achievement stat of every present member. */
  private refreshShiftPlayers(): void {
    let n = 0;
    for (const a of this.avatars) if (a.active) n++;
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      if (this.avatars[s]!.active) this.achievements.set(s, ACH_STAT_SHIFT_PLAYERS, n);
    }
  }

  removeActor(actor: ActorSlot): void {
    const a = this.avatars[actor];
    if (!a) return;
    if (a.active) {
      this.vehicles.removeActor(actor, this.tickNo, this.vehicleHost);
      dropAllCarried(this.config, this.cargo, a, this.world.ground, actor, this.tickNo);
    }
    a.active = false;
    if (this.pourAt[actor]! >= 0) this.endPour(actor, this.tickNo);
    this.cargo.formHeld[actor] = -1;
    this.cargo.qHeld[actor] = -1;
  }

  /** Holder toggles of the `temp` role (hosts apply them between ticks, in order with intents). */
  setTempPermissions(p: { tempCanBuild: boolean; tempCanSpendShared: boolean; tempCanDriveShared: boolean }): void {
    this.tempPerms.tempCanBuild = p.tempCanBuild;
    this.tempPerms.tempCanSpendShared = p.tempCanSpendShared;
    this.tempPerms.tempCanDriveShared = p.tempCanDriveShared;
  }

  /** Near Parcels of this Contract: count, unit direction of parcel `k` into `out`, and whether it was collected. */
  get nearParcelCount(): number {
    return this.parcelCount;
  }

  nearParcel(k: number, out: { x: number; y: number; z: number }): boolean {
    out.x = this.parcelDirs[3 * k]!;
    out.y = this.parcelDirs[3 * k + 1]!;
    out.z = this.parcelDirs[3 * k + 2]!;
    return ((this.parcelsCollected >>> k) & 1) === 1;
  }

  snapshot(): RoomSimSnapshot {
    const actors: ActorSnapshot[] = [];
    const entityIds: EntityId[] = [];
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const a = this.avatars[s]!;
      if (!a.active) continue;
      const t = this.tools[s]!;
      const tool = this.config.tools[t.toolCode]!;
      const entityId = (s + 1) as EntityId;
      entityIds.push(entityId);
      actors.push({
        avatar: {
          entityId,
          slot: s,
          playerId: this.infos[s]!.playerId,
          position: { x: a.px, y: a.py, z: a.pz },
          velocity: { x: a.vx, y: a.vy, z: a.vz },
          yaw: this.bodyYawRadians(a),
          pitch: (this.inputs[s]!.pitch / 127) * (Math.PI / 2),
          moveState: MOVE_STATES[a.moveState] ?? "grounded",
          actionState: t.detailing
            ? "trait_detailing"
            : t.sweeping
              ? "sweep"
              : a.moveState !== MOVE_GROUNDED
                ? "airborne"
                : "none",
          hopCharges: a.hopCharges,
          flags:
            (t.inContact ? 1 << AVATAR_FLAG_BIT.cleaning : 0) | (this.infos[s]!.lampOn ? 1 << AVATAR_FLAG_BIT.lamp : 0),
          vehicleId:
            this.vehicles.driving[s]! >= 0 ? ((VEHICLE_ENTITY_ID_BASE + this.vehicles.driving[s]!) as EntityId) : null,
          seat: 0,
          plotId: a.plotHint as PlotId,
        },
        tool: {
          slot: s,
          holsterSlot: t.holsterSlot,
          toolId: tool.id,
          toolCode: tool.code,
          cellGrams: t.cellGrams[t.toolCode] ?? 0,
          cellCapGrams: actorCellCap(this.config, t, t.toolCode),
          sweeping: t.sweeping,
          laneLocked: t.laneLocked,
          laneAngle: t.laneAngle,
          aim01: t.aim01,
        },
        carrying: this.carryingIds(s),
      });
    }
    const vehicles: VehicleComponent[] = [];
    this.vehicles.components(vehicles, entityIds);
    return {
      tick: this.tickNo as Tick,
      shift: this.shiftState(),
      actors,
      vehicles,
      robots: [],
      cargo: this.cargoComponents(),
      buildings: [],
      entityIds,
    };
  }

  onEvent(listener: (event: RoomSimEvent) => void): Unsubscribe {
    this.listeners.push(listener);
    return () => {
      const k = this.listeners.indexOf(listener);
      if (k >= 0) this.listeners.splice(k, 1);
    };
  }

  // ---- Extras (hot-path readers for hosts, prediction and tests) ------------------------------------------------------

  /** Strokes accepted during the last step (pooled; copy what you keep). */
  get strokeCount(): number {
    return this.strokes;
  }

  strokeAt(index: number): StrokeRecord {
    if (index < 0 || index >= this.strokes) throw new RangeError(`stroke ${index} of ${this.strokes}`);
    return this.strokePool[index]!;
  }

  /** Live avatar state of a slot (read-only by convention). */
  avatar(slot: ActorSlot): Readonly<AvatarState> {
    return this.avatars[slot]!;
  }

  /** Live tool / Dust Cell state of a slot (read-only by convention). */
  toolState(slot: ActorSlot): Readonly<ToolState> {
    return this.tools[slot]!;
  }

  /** Polished + Empty plots (the Shine Index numerator); 0 on a ledger without plot states. */
  get shinePolished(): number {
    return this.plotEvents === null ? 0 : this.plotEvents.shinePlots;
  }

  get wallet(): number {
    return this.walletLm;
  }

  /** FNV-1a 32 over the quantised authoritative state (golden replays, drift checks). Allocation-free. */
  stateHash(): number {
    const h = this.hasher;
    h.reset();
    h.int(this.tickNo);
    h.real(this.walletLm);
    // Owned board levels only (none: nothing hashed), so a shift without board levels hashes as before.
    const bl = this.boardLevels;
    for (let n = 0; n < bl.length; n++) if (bl[n]! > 0) h.int((n << 8) | bl[n]!);
    // Selling state only while it exists (nothing hashed before the first sale, as before selling existed).
    if (this.railshotGrams > 0) h.real(this.railshotGrams);
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      if (this.pourAt[s]! < 0) continue;
      h.int(0x20000 | (s << 8) | (this.pourAt[s]! << 3) | this.pourSlot[s]!);
      h.real(this.pourGrams[s]!);
    }
    if (this.roostCount > 0) h.int(0x30000 | this.roostCount);
    if (this.parcelsCollected !== 0) h.int(0x40000 | this.parcelsCollected);
    // Owned suit-gear levels in data order (none: nothing hashed, as before gear could be bought).
    for (let g = 0; g < this.gearIds.length; g++) {
      const level = this.suitGear[this.gearIds[g]!] ?? 0;
      if (level > 0) h.int(0x10000 | (g << 8) | level);
    }
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const a = this.avatars[s]!;
      h.int(a.active ? 1 : 0);
      if (!a.active) continue;
      h.real(a.px);
      h.real(a.py);
      h.real(a.pz);
      h.real(a.vx);
      h.real(a.vy);
      h.real(a.vz);
      h.real(a.fx);
      h.real(a.fy);
      h.real(a.fz);
      h.int(a.moveState | (a.yawFrame << 4) | (a.jumped ? 32 : 0) | (a.jumpCutUsed ? 64 : 0));
      h.int(a.coyoteTicks | (a.jumpBufferTicks << 8) | (a.snapOffTicks << 16));
      h.int(a.hopCharges | (a.hopIntervalTicks << 8) | (a.recoverTicks << 16));
      h.int(a.hopRechargeTicks);
      h.int(a.moveLockTicks | (a.jumpLockTicks << 8));
      const t = this.tools[s]!;
      h.int(t.toolCode | (t.holsterSlot << 8) | (t.swapTicks << 16));
      if (this.holsterMask[s] !== 1 << t.toolCode) h.int(0x50000 | this.holsterMask[s]!);
      h.int(t.owned);
      h.int(t.mgAccum);
      h.int(t.detailCooldownMs);
      h.int(
        (t.inContact ? 1 : 0) |
          (t.speedLifted ? 2 : 0) |
          (t.anchorValid ? 4 : 0) |
          (t.nearFullLatched ? 8 : 0) |
          (t.fullLatched ? 16 : 0),
      );
      for (let k = 0; k < t.cellGrams.length; k++) h.int(t.cellGrams[k]!);
      h.real(t.headX);
      h.real(t.headY);
      h.real(t.headZ);
    }
    // Cargo only when any exists, so a shift without pucks hashes as before.
    const c = this.cargo;
    for (let i = 0; i < c.capacity; i++) {
      if (c.state[i] === CARGO_FREE) continue;
      h.int(i | (c.state[i]! << 16) | ((c.carriedBy[i]! + 1) << 20) | ((c.owner[i]! + 1) << 24));
      h.int(c.entityId[i]!);
      h.int(c.grams[i]!);
      h.int(c.count[i]!);
      h.real(c.px[i]!);
      h.real(c.py[i]!);
      h.real(c.pz[i]!);
      h.real(c.vx[i]!);
      h.real(c.vy[i]!);
      h.real(c.vz[i]!);
    }
    // Vehicles only once the shift has bought one or moved off the default Motor Pools, so a shift without them hashes
    // as before; vehicles out always count.
    if (this.vehicles.dirty || this.vehicles.store.activeCount() > 0) this.vehicles.hash(h);
    return h.value;
  }

  // ---- Checkpoints (host calls between ticks; never on the tick path) ------------------------------------------------

  /**
   * Captures the sim-owned save sections (META and PLAYERS bodies, see ./checkpoint) of the current state: tick,
   * wallet, Standard Issue and Repeat Requisition counts, suit gear, and for every joined actor the full avatar, tool,
   * Holster, Dust Cell and input state. Call between ticks. The dust ledger is not included (DustLedgerPort owner).
   */
  captureCheckpoint(): SimCheckpoint {
    const cfg = this.config;
    const meta = encodeCheckpointMeta(cfg, {
      tick: this.tickNo,
      dayPhase: DAY_PHASES.indexOf(this.dayPhase),
      walletLm: this.walletLm,
      standardIssueOwned: this.standardIssueOwned,
      copiesBought: this.copiesBought,
      suitGear: {
        ...this.suitGear,
        ...this.board.toRecord(this.boardLevels),
        ...(this.roostCount > 0 ? { [ROOST_ITEM_ID]: this.roostCount } : {}),
        ...(this.parcelsCollected !== 0 ? { [NEAR_PARCEL_SAVE_KEY]: this.parcelsCollected } : {}),
        ...this.announcedRecord(),
        ...this.holsterRecord(),
        ...this.vehicles.captureKeys(),
      },
    });
    let count = 0;
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) if (this.avatars[s]!.active) count++;
    const w = new CheckpointWriter(simCheckpointPlayersBytes(count, cfg.tools.length));
    w.u8(count);
    w.u8(cfg.tools.length);
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const a = this.avatars[s]!;
      if (!a.active) continue;
      writeCheckpointPlayer(w, s, a, this.tools[s]!, this.inputs[s]!, this.infos[s]!.lampOn);
    }
    return {
      metaVersion: SIM_CHECKPOINT_META_VERSION,
      meta,
      playersVersion: SIM_CHECKPOINT_PLAYERS_VERSION,
      players: w.finish(),
      pucksVersion: SIM_CHECKPOINT_PUCKS_VERSION,
      pucks: encodeCheckpointPucks(this.cargo),
    };
  }

  /**
   * Restores a checkpoint captured by `captureCheckpoint` (same tick rate and tool table). Join the actors first
   * (`addActor`), then call this between ticks: each record replaces the state of the joined actor in its slot;
   * records of slots nobody joined are skipped and counted; joined actors without a record keep their state.
   *
   * The input is untrusted: it is fully decoded and validated before anything changes, so a rejected checkpoint
   * (returned with `ok: false` and counted in `counters.restoresRejected`, never thrown) leaves the sim untouched.
   * A restored sim continues exactly like the one that was saved, given the same inputs and the same dust ledger.
   */
  restoreCheckpoint(checkpoint: SimCheckpoint): SimRestoreResult {
    const cfg = this.config;
    const tally = new CheckpointTally();
    const raw = checkpoint as Partial<SimCheckpoint> | null | undefined;
    const meta = raw?.meta;
    const players = raw?.players;
    if (!(meta instanceof Uint8Array) || !(players instanceof Uint8Array)) {
      return this.rejectRestore(new CheckpointFail("malformed", "checkpoint"));
    }
    if (raw?.metaVersion !== SIM_CHECKPOINT_META_VERSION) {
      return this.rejectRestore(new CheckpointFail("unsupported_version", "metaVersion"));
    }
    if (raw.playersVersion !== SIM_CHECKPOINT_PLAYERS_VERSION) {
      return this.rejectRestore(new CheckpointFail("unsupported_version", "playersVersion"));
    }
    if (meta.length > SIM_CHECKPOINT_META_MAX_BYTES) return this.rejectRestore(new CheckpointFail("oversize", "meta"));
    if (players.length > SIM_CHECKPOINT_PLAYERS_MAX_BYTES) {
      return this.rejectRestore(new CheckpointFail("oversize", "players"));
    }

    // Decode and validate everything first.
    const m = decodeCheckpointMeta(meta);
    if (m instanceof CheckpointFail) return this.rejectRestore(m);
    const gear: Record<string, number> = {};
    const metaFail = validateCheckpointMeta(m, cfg, this.gearMaxLevel, gear, tally);
    if (metaFail) return this.rejectRestore(metaFail);
    const records = decodeCheckpointPlayers(players, cfg.tools.length);
    if (records instanceof CheckpointFail) return this.rejectRestore(records);
    const standardIssueOwned = m.standardIssueOwned | this.freeToolMask;
    const cellLevel = new Uint8Array(cfg.tools.length);
    for (let k = 0; k < cellLevel.length; k++) cellLevel[k] = gear[this.cellLevelKeys[k]!] ?? 0;
    const hopMaxCharges = this.hopMaxChargesOf(gear);
    const ctx = { cfg, limits: this.checkpointLimits, standardIssueOwned, hopMaxCharges, cellLevel };
    for (const p of records) {
      const fail = validateCheckpointPlayer(p, ctx, tally);
      if (fail) return this.rejectRestore(fail);
    }

    // Pucks (optional section: older checkpoints have none).
    let cargo: CargoStore;
    if (raw.pucks === undefined) cargo = new CargoStore(cfg);
    else {
      if (raw.pucksVersion !== SIM_CHECKPOINT_PUCKS_VERSION) {
        return this.rejectRestore(new CheckpointFail("unsupported_version", "pucksVersion"));
      }
      if (!(raw.pucks instanceof Uint8Array)) return this.rejectRestore(new CheckpointFail("malformed", "pucks"));
      const active = this.avatars.map((x) => x.active);
      const decoded = decodeCheckpointPucks(cfg, raw.pucks, active);
      if (decoded instanceof CheckpointFail) return this.rejectRestore(decoded);
      cargo = decoded;
    }

    // Commit.
    this.tickNo = m.tick;
    this.walletLm = m.walletLm;
    this.standardIssueOwned = standardIssueOwned;
    this.copiesBought.set(m.copiesBought);
    this.boardLevels.fill(0);
    this.roostCount = gear[ROOST_ITEM_ID] ?? 0;
    delete gear[ROOST_ITEM_ID];
    this.parcelsCollected = gear[NEAR_PARCEL_SAVE_KEY] ?? 0;
    delete gear[NEAR_PARCEL_SAVE_KEY];
    this.vehicles.restoreKeys(gear);
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const key = `${ACHIEVEMENT_SAVE_KEY_PREFIX}${s}`;
      this.achievements.setAnnouncedMask(s, gear[key] ?? 0);
      delete gear[key];
      const hk = `${HOLSTER_SAVE_KEY_PREFIX}${s}`;
      this.holsterMask[s] = gear[hk] ?? 0;
      delete gear[hk];
    }
    for (const key of Object.keys(gear)) {
      const n = this.board.indexOf(key);
      if (n < 0) continue;
      this.boardLevels[n] = gear[key]!;
      delete gear[key];
    }
    this.refreshBoardEffects();
    this.shineNext = this.shineMilestoneIndexFor(this.shinePolished);
    this.suitGear = gear;
    this.purchaseGuard.reset();
    // Pours restart from the restored buttons (E still held); the Railshot counter and remainders are not saved.
    this.pourAt.fill(-1);
    this.pourGrams.fill(0);
    this.pourLm.fill(0);
    this.saleRemMicro.fill(0);
    this.railshotGrams = 0;
    this.dayPhase = DAY_PHASES[m.dayPhase]!;
    this.strokes = 0;
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      // Derived from the restored gear and Standard Issue set, for every slot (restored or not).
      const a = this.avatars[s]!;
      a.hopMaxCharges = hopMaxCharges;
      if (a.hopCharges > hopMaxCharges) a.hopCharges = hopMaxCharges;
      const t = this.tools[s]!;
      t.cellLevel.set(cellLevel);
      t.owned |= standardIssueOwned;
    }
    this.cargo = cargo;
    let restored = 0;
    let skipped = 0;
    for (const p of records) {
      const a = this.avatars[p.slot]!;
      if (!a.active) {
        skipped++;
        continue;
      }
      copyAvatarState(p.avatar, a);
      copyToolState(p.tool, this.tools[p.slot]!);
      const inp = this.inputs[p.slot]!;
      inp.seq = p.seq;
      inp.moveX = p.moveX;
      inp.moveY = p.moveY;
      inp.yaw = p.yaw;
      inp.pitch = p.pitch;
      inp.buttons = p.buttons;
      inp.toolParam = p.toolParam;
      inp.prevButtons = p.prevButtons;
      this.infos[p.slot]!.lampOn = p.lampOn;
      restored++;
    }
    // Saved holsters are untrusted: keep only owned cleaning tools, the equipped one included, within the size.
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) this.normalizeHolster(s, this.holsterMask[s]!);
    for (const t of this.tools) this.applyCellLevels(t);
    return {
      ok: true,
      code: "ok",
      detail: "",
      tick: this.tickNo,
      restoredActors: restored,
      skippedRecords: skipped,
      clampedValues: tally.clamped,
      ignoredGearKeys: tally.ignoredGear,
    };
  }

  private rejectRestore(fail: CheckpointFail): SimRestoreResult {
    this.counters.restoresRejected++;
    return {
      ok: false,
      code: fail.code,
      detail: fail.detail,
      tick: this.tickNo,
      restoredActors: 0,
      skippedRecords: 0,
      clampedValues: 0,
      ignoredGearKeys: 0,
    };
  }

  private hopMaxChargesOf(gear: Readonly<Record<string, number>>): number {
    return this.config.hopBurstsByLevel[gear["gear.hop_pack"] ?? 0] ?? 0;
  }

  // ---- Internals ----------------------------------------------------------------------------------------------------

  private stepActor(s: number, a: AvatarState, night: boolean, tick: number): void {
    const cfg = this.config;
    const inp = this.inputs[s]!;
    const t = this.tools[s]!;
    const b = inp.buttons;
    const pressed = b & ~inp.prevButtons;
    const released = inp.prevButtons & ~b;
    const M = INPUT_BUTTON_MASK;

    // Driving a vehicle: the avatar rides the handle (no walking, no tool); the vehicle step reads the intent.
    const driving = this.vehicles.driving[s]!;
    if (driving >= 0) {
      this.stepDriver(s, driving, pressed, tick);
      inp.prevButtons = b;
      return;
    }

    // Holster cycling and swap timer.
    if (t.swapTicks > 0) t.swapTicks--;
    if (pressed & M.holsterNext) this.cycleHolster(s, 1);
    if (pressed & M.holsterPrev) this.cycleHolster(s, -1);
    if (pressed & M.lampCycle) this.infos[s]!.lampOn = !this.infos[s]!.lampOn;

    const tool = cfg.tools[t.toolCode]!;
    const canWork = tool.cleans && t.swapTicks === 0 && a.moveLockTicks === 0;
    t.detailing = canWork && tool.detailing && (b & M.toolSecondary) !== 0;
    t.sweeping = canWork && !t.detailing && (b & M.toolPrimary) !== 0;
    t.laneLocked = t.sweeping && (b & M.laneLock) !== 0;
    if (t.laneLocked) t.laneAngle = turnToRadians(inp.yaw);

    // Movement intent. Doubles go straight into the intent's double fields: a double local reassigned across a branch
    // (or picked by a ternary) is a phi, which Maglev boxes into a fresh HeapNumber per actor-tick (Pass 6 alloc guard:
    // ~105 B/tick while stepActor ran in Maglev).
    const mi = this.intent;
    const mx = inp.moveX / INPUT_AXIS_MAX;
    const my = inp.moveY / INPUT_AXIS_MAX;
    const ml = Math.sqrt(mx * mx + my * my);
    mi.moveX = mx;
    mi.moveY = my;
    if (ml > 1) {
      mi.moveX = mx / ml;
      mi.moveY = my / ml;
    }
    mi.yaw = inp.yaw;
    mi.jumpPressed = (pressed & M.jump) !== 0;
    mi.jumpHeld = (b & M.jump) !== 0;
    mi.jumpReleased = (released & M.jump) !== 0;
    mi.hopPressed = (pressed & M.hopPack) !== 0;
    mi.lope = (b & M.lope) !== 0;
    mi.descend = (b & M.descend) !== 0;
    mi.sweeping = t.sweeping || t.detailing;
    mi.faceAim = t.sweeping || t.detailing;
    if (t.detailing) mi.speedMult = cfg.toolFeel.detailingSpeedMult;
    else if (t.laneLocked) mi.speedMult = tool.laneLockBonus;
    else mi.speedMult = 1;
    // Steep rule (game-feel section 2.3): sweeping on ground steeper than world.steepSlopeDeg runs at the tool's
    // Steep multiplier (x0.6; 1.0 with Sure Footing or Charge: no probe then). The plot class is not in the sim, so
    // the local slope at the feet (same probe as stepAvatar, before the move) stands in for "Steep plot".
    if (t.sweeping && tool.steepSweepMult !== 1) {
      groundSlopeTan(a, cfg, this.world.ground, this.slopeOut);
      if (this.slopeOut[0]! > cfg.tanSteepSlope) mi.speedMult *= tool.steepSweepMult;
    }
    stepAvatar(a, mi, cfg, this.world.ground);

    // Tool head and stroke.
    const ti = this.toolInput as { seq: number; toolParam: number; night: boolean; lampLevel: number };
    ti.seq = inp.seq;
    ti.toolParam = inp.toolParam;
    ti.night = night;
    ti.lampLevel = this.infos[s]!.lampOn ? (this.suitGear["gear.crown_lamp"] ?? 0) : 0;
    const out = this.scratchStroke;
    if (stepToolHead(a, t, ti as ToolTickInput, cfg, this.world.ground, this.world.grid, tick, s, out)) {
      this.acceptStroke(s, t, out, tick);
    }
    this.stepActorCargo(s, a, t, b, pressed, released, inp.yaw, tick);
    this.stepPour(s, a, t, b, tick);
    if ((pressed & (M.interact | M.seatSwitch)) !== 0) this.onFootVehicleKeys(s, a, t, pressed, tick);
    inp.prevButtons = b;
  }

  /** On foot: `interact` sits down at a Trundle handle within reach, `seatSwitch` calls / returns it at the Motor Pool. */
  private onFootVehicleKeys(s: number, a: AvatarState, t: ToolState, pressed: number, tick: number): void {
    const M = INPUT_BUTTON_MASK;
    if ((pressed & M.interact) !== 0 && this.pourAt[s]! < 0) {
      const role = this.infos[s]!.role;
      const shared = role !== "temp" || this.tempPerms.tempCanDriveShared;
      if (this.vehicles.tryEnter(s, a.px, a.py, a.pz, shared, tick, this.vehicleHost)) {
        t.sweeping = t.detailing = t.wasActive = t.inContact = t.anchorValid = false;
        t.laneLocked = false;
        return;
      }
    }
    if ((pressed & M.seatSwitch) !== 0) {
      this.vehicles.callOrReturn(s, a.px, a.py, a.pz, a.fx, a.fy, a.fz, tick, this.vehicleHost);
    }
  }

  /** One tick of a seated driver: the exit button lets go, otherwise the input becomes the vehicle's intent. */
  private stepDriver(s: number, vehicleIndex: number, pressed: number, tick: number): void {
    const inp = this.inputs[s]!;
    if ((pressed & INPUT_BUTTON_MASK.interact) !== 0) {
      this.vehicles.leave(s, tick, this.vehicleHost);
      return;
    }
    this.vehicles.driverIntent(vehicleIndex, inp.moveX, inp.moveY, inp.buttons, inp.prevButtons);
    // The driver's own Crown Lamp still relieves the night penalty of the vehicle's strokes (progression night factor).
    const lamp = this.infos[s]!.lampOn ? (this.suitGear["gear.crown_lamp"] ?? 0) : 0;
    this.vehicles.driverRelief[s] = lamp * this.config.lampPenaltyReliefFrac;
  }

  private acceptStroke(s: number, t: ToolState, st: MutableStroke, tick: number): void {
    const cfg = this.config;
    const tool = cfg.tools[t.toolCode]!;
    const cap = actorCellCap(cfg, t, t.toolCode);
    const cell = t.cellGrams[t.toolCode]!;
    if (cell >= cap) {
      t.rejectedFull++;
      this.counters.strokesCellFull++;
      return;
    }
    if (this.ledger.isEmptyPlot(st.anchor)) {
      this.counters.strokesEmptyPlot++;
      return;
    }
    if (this.strokes >= this.strokePool.length) return; // cannot happen: <= 1 stroke per actor per tick
    const rec = this.strokePool[this.strokes++]!;
    copyStroke(st, rec);
    const res = this.applyResult;
    res.clear();
    this.ledger.applyStroke(rec, res);
    t.mgAccum += res.milligrams;
    const grams = Math.floor(t.mgAccum / 1000);
    t.mgAccum -= grams * 1000;
    if (grams <= 0) {
      this.drainPlotEvents(tool.charge, tick);
      return;
    }
    const added = Math.min(grams, cap - cell);
    const after = cell + added;
    t.cellGrams[t.toolCode] = after;
    this.achievements.add(s, ACH_STAT_STROKES, 1);
    // Event payloads are fresh objects (hosts may queue them), so they are the only allocation of a stroke; skip them
    // when nobody listens. plotIds is sized exactly (push from [] would grow a 17-slot backing store).
    const listening = this.listeners.length > 0;
    if (listening) {
      const n = res.plotCount;
      const plotIds = new Array<PlotId>(n);
      for (let k = 0; k < n; k++) plotIds[k] = res.plotIds[k]! as PlotId;
      this.emit("dust.collected", {
        tick: tick as Tick,
        actorSlot: s,
        grams: added,
        plotIds,
        cellGrams: after,
        cellCapGrams: cap,
      });
    }
    if (this.stepFirstStroke >= 0 && (this.onboardingSent[s]! & 1) === 0) {
      for (let k = 0, n = res.plotCount; k < n; k++) {
        if (this.isApronPlot(res.plotIds[k]!)) {
          this.completeStep(s, this.stepFirstStroke, 1, tick);
          break;
        }
      }
    }
    if (!t.nearFullLatched && after >= cap * this.config.toolFeel.cellNearFullFrac) {
      t.nearFullLatched = true;
      this.emit("cell.near_full", {
        tick: tick as Tick,
        actorSlot: s,
        toolId: tool.id,
        cellGrams: after,
        cellCapGrams: cap,
      });
    }
    if (!t.fullLatched && after >= cap) {
      t.fullLatched = true;
      this.emit("cell.full", {
        tick: tick as Tick,
        actorSlot: s,
        toolId: tool.id,
        cellCapGrams: cap,
        pourPointBearingDeg: null,
      });
    }
    this.drainPlotEvents(tool.charge, tick);
  }

  /**
   * Reads and empties the ledger's Opened / Polished queues after one applied stroke: `plot.opened`, then for every
   * Polished plot the Inspector's Stamp (Lumens into the shift wallet) and `plot.polished`. Called once per stroke,
   * so `chargeFinish` is the trait of the tool whose stroke removed the last dust. The payout never depends on a
   * listener; only the event objects do.
   */
  private drainPlotEvents(chargeFinish: boolean, tick: number): void {
    const q = this.plotEvents;
    if (q === null) return;
    const opened = q.openedQueueCount;
    if (opened > 0) {
      this.counters.plotsOpened += opened;
      if (this.listeners.length > 0) {
        for (let k = 0; k < opened; k++) {
          const plot = q.openedPlotAt(k);
          this.emit("plot.opened", {
            tick: tick as Tick,
            plotId: plot as PlotId,
            creditedSlot: this.leadingSlot(q, plot),
          });
        }
      }
      q.clearOpenedQueue();
    }
    const polished = q.polishedQueueCount;
    if (polished === 0) return;
    const input = this.stampInput as { -readonly [K in keyof StampInput]: StampInput[K] };
    // Stamp Premium and Golden Handshake come from the shift's Promotions Board levels.
    input.premiumLevel = this.stampPremiumLevel;
    input.premiumOnFlock = this.stampPremiumOnFlock;
    input.chargeFinish = chargeFinish;
    // The ledger has already counted every plot of this stroke; report the counts as they stood after each one.
    // polishedCount counts Polished plots only; Shine (milestones) also counts Empty plots (WDS section 4.2).
    const polishedBefore = q.polishedTotal - polished;
    const shineBefore = q.shinePlots - polished;
    const totalPlots = this.world.grid.count;
    for (let k = 0; k < polished; k++) {
      const plot = q.polishedPlotAt(k);
      const credit = q.polishedCreditAt(k);
      const byPlayer = credit >= 0 && credit < MAX_PLAYERS_PER_ROOM;
      input.playerCredited = byPlayer;
      const stampLm = stampPayoutLm(this.config, input);
      this.walletLm += stampLm;
      this.counters.plotsPolished++;
      if (byPlayer) this.achievements.add(credit, ACH_STAT_PLOTS_POLISHED, 1);
      this.emit("plot.polished", {
        tick: tick as Tick,
        plotId: plot as PlotId,
        credit: byPlayer ? "player" : "flock",
        creditedSlot: byPlayer ? credit : null,
        stampLm,
        charged: stampIsCharged(input),
        polishedCount: polishedBefore + k + 1,
      });
      if (byPlayer && this.stepPolish >= 0 && this.isApronPlot(plot)) this.completeStep(credit, this.stepPolish, 2, tick);
      const shine =shineBefore + k + 1;
      while (this.shineNext < this.shineThresholds.length && shine >= this.shineThresholds[this.shineNext]!) {
        this.emit("shine.milestone", {
          tick: tick as Tick,
          pct: this.shinePcts[this.shineNext]!,
          polishedCount: polishedBefore + k + 1,
          totalPlots,
        });
        this.shineNext++;
      }
    }
    q.clearPolishedQueue();
  }

  /** Re-derives the Stamp inputs from the board levels (construction, restore). */
  private refreshBoardEffects(): void {
    const lv = this.boardLevels;
    this.stampPremiumLevel = Math.max(0, Math.floor(this.board.stat(lv, STAT_STAMP_PREMIUM_LEVEL, 0)));
    this.stampPremiumOnFlock = this.board.flag(lv, FLAG_GOLDEN_HANDSHAKE_CREDIT);
    const max = this.config.cellLevelMult.length;
    for (let k = 0; k < this.boardCellLevel.length; k++) {
      const v = Math.floor(this.board.stat(lv, this.cellLevelKeys[k]!, 0));
      this.boardCellLevel[k] = v < 0 ? 0 : v > max ? max : v;
    }
    this.cellCapBonus = Math.max(0, this.board.stat(lv, STAT_CELL_CAPACITY_BONUS, 0));
    this.purchaseDiscountFrac = Math.max(0, this.board.stat(lv, STAT_PURCHASE_DISCOUNT_FRAC, 0));
    this.payoutMult = 1 + Math.max(0, this.board.stat(lv, STAT_PAYOUT_BONUS, 0));
    const pourMult = this.board.stat(lv, STAT_POUR_TIME_MULT, 1);
    this.pourTimeMult = pourMult > 0 ? pourMult : 1;
    for (const t of this.tools) this.applyCellLevels(t);
  }

  /**
   * Shine milestones of this grid: one per plot-bonus.json fraction (the pcts of the shine.milestone contract), plus
   * 100 % (Contract Fulfilled, progression section 13) at the full plot count. A fraction becomes the smallest whole
   * number of plots that reaches it, in integer arithmetic (parts per million) so every host agrees.
   */
  private buildShineMilestones(totalPlots: number): void {
    const pcts = SHINE_MILESTONE_PCTS as readonly number[];
    for (const frac of this.config.shineMilestonesFrac) {
      const pct = Math.round(frac * 100);
      if (pct >= 100 || !pcts.includes(pct)) continue;
      const ppm = Math.round(frac * 1_000_000);
      this.shineThresholds.push(Math.max(1, Math.floor((ppm * totalPlots + 999_999) / 1_000_000)));
      this.shinePcts.push(pct as ShineMilestonePct);
    }
    this.shineThresholds.push(totalPlots);
    this.shinePcts.push(100);
  }

  /** Index of the first milestone a Shine numerator of `shine` has not reached (reached ones are not announced). */
  private shineMilestoneIndexFor(shine: number): number {
    let k = 0;
    while (k < this.shineThresholds.length && shine >= this.shineThresholds[k]!) k++;
    return k;
  }

  /** Player slot that removed the most dust from `plot` so far (ties: the lower slot), or null when the shift leads. */
  private leadingSlot(q: DustLedgerPlotEvents, plot: number): number | null {
    let best = -1;
    let bestUnits = 0;
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const units = q.contributionOf(plot, s);
      if (units > bestUnits) {
        bestUnits = units;
        best = s;
      }
    }
    return best >= 0 && bestUnits >= q.contributionOf(plot, STROKE_NON_PLAYER_ACTOR_SLOT_MIN) ? best : null;
  }

  /** Empties an actor's Cell (pour / puck systems call this; also used by tests). Returns the grams removed. */
  drainCell(actor: ActorSlot, toolCode?: number): number {
    const t = this.tools[actor]!;
    const code = toolCode ?? t.toolCode;
    const g = t.cellGrams[code] ?? 0;
    t.cellGrams[code] = 0;
    if (code === t.toolCode) relatchCell(this.config, t);
    return g;
  }

  // ---- Cargo (Dust Pucks, Puck Stacks) --------------------------------------------------------------------------------

  /**
   * F: tap forms a puck, holding formHoldTicks bands the Cell (once per press). Q: tap picks up / drops, a longer hold
   * throws on release (charge = held ticks). E while carrying pours the carried unit back into the Cell.
   */
  private stepActorCargo(
    s: number,
    a: AvatarState,
    t: ToolState,
    b: number,
    pressed: number,
    released: number,
    yaw: number,
    tick: number,
  ): void {
    const cfg = this.config;
    const c = this.cargo;
    const M = INPUT_BUTTON_MASK;
    const hold = cfg.cargo.formHoldTicks;
    const r = this.cargoResult;
    r.clear();
    const ground = this.world.ground;
    if (pressed & M.puckForm) {
      c.formHeld[s] = 0;
      c.formBanded[s] = 0;
    } else if (b & M.puckForm && c.formHeld[s]! >= 0) {
      c.formHeld[s]!++;
      if (c.formHeld[s]! >= hold && c.formBanded[s] === 0) {
        c.formBanded[s] = 1;
        bandCell(cfg, c, a, t, ground, s, tick, r);
      }
    }
    if (released & M.puckForm) {
      if (c.formHeld[s]! >= 0 && c.formBanded[s] === 0) r.formedId = formPuck(cfg, c, a, t, ground, s, tick);
      c.formHeld[s] = -1;
    }
    if (pressed & M.pickupDrop) c.qHeld[s] = 0;
    else if (b & M.pickupDrop && c.qHeld[s]! >= 0) c.qHeld[s]!++;
    if (released & M.pickupDrop && c.qHeld[s]! >= 0) {
      const held = c.qHeld[s]!;
      c.qHeld[s] = -1;
      if (c.carriedCount(s) === 0) r.pickedUpId = pickUp(cfg, c, a, ground, s);
      else if (held < hold) drop(cfg, c, a, ground, s, tick);
      else r.thrownId = throwCarried(cfg, c, a, ground, s, yaw, held, tick);
    }
    if (pressed & M.interact) pourBack(cfg, c, t, s);
    if (this.listeners.length === 0) return;
    const T = tick as Tick;
    if (r.formedId !== 0) this.emit("cargo.puck_formed", { tick: T, actorSlot: s, puckId: r.formedId as EntityId });
    if (r.bandedStacks > 0) {
      this.emit("cargo.stack_banded", {
        tick: T,
        actorSlot: s,
        stackId: r.bandedFirstId as EntityId,
        pucks: r.bandedPucks,
      });
    }
    if (r.pickedUpId !== 0) this.emit("cargo.picked_up", { tick: T, actorSlot: s, cargoId: r.pickedUpId as EntityId });
    if (r.thrownId !== 0) this.emit("cargo.thrown", { tick: T, actorSlot: s, cargoId: r.thrownId as EntityId });
  }

  private carryingIds(slot: number): EntityId[] {
    const c = this.cargo;
    const out: EntityId[] = [];
    for (let i = 0; i < c.capacity; i++) {
      if (c.state[i] === CARGO_CARRIED && c.carriedBy[i] === slot) out.push(c.entityId[i]! as EntityId);
    }
    return out;
  }

  private cargoComponents(): CargoComponent[] {
    const c = this.cargo;
    const out: CargoComponent[] = [];
    for (let i = 0; i < c.capacity; i++) {
      const st = c.state[i]!;
      if (st === CARGO_FREE) continue;
      out.push({
        entityId: c.entityId[i]! as EntityId,
        kind: c.count[i]! > 1 ? "stack" : "puck",
        count: c.count[i]!,
        grams: c.grams[i]! as CargoComponent["grams"],
        position: { x: c.px[i]!, y: c.py[i]!, z: c.pz[i]! },
        carriedBy: st === CARGO_CARRIED ? (c.carriedBy[i]! as ActorSlot) : null,
        onVehicle: null,
      });
    }
    return out;
  }

  // ---- Plot Card -------------------------------------------------------------------------------------------------------

  /**
   * Plot Card (C) data of `plotId` into `out`: state, % remaining, dust level / terrain, credited slot, Escorted.
   * False (out untouched) for an id outside the grid or a ledger without per-plot state (the stand-in ledger).
   */
  plotCard(plotId: PlotId, out: PlotCardData): boolean {
    const q = plotQueryOf(this.ledger);
    if (q === null || !(plotId >= 0 && plotId < q.state.length)) return false;
    out.plotId = plotId;
    out.state = q.state[plotId]! as PlotState;
    out.remainingPct = Math.round((q.frac[plotId]! * 100) / 255);
    const level = q.levelOf[plotId]!;
    out.dustLevel = level;
    out.terrainId = null;
    for (const id in this.config.terrainDustLevel) {
      if (this.config.terrainDustLevel[id] === level) {
        out.terrainId = id;
        break;
      }
    }
    const ev = this.plotEvents;
    out.creditedSlot = ev === null ? null : this.leadingSlot(ev, plotId);
    out.escorted = false;
    out.countsTowardShine = out.state === PlotState.Polished || out.state === PlotState.Empty;
    const plots = this.world.grid.count;
    out.shinePctPerPlot = plots > 0 ? 100 / plots : 0;
    return true;
  }

  // ---- HUD read-outs (pure reads: no state change, nothing hashed, no allocation) --------------------------------------

  /**
   * Plot under a world-space point (metres from the Moon centre), e.g. the client's camera / reticle ray hit. Returns
   * -1 for the origin. Pure read: the grid search hint is a cache that never changes the result.
   */
  plotIdAt(x: number, y: number, z: number): PlotId | -1 {
    const l = Math.sqrt(x * x + y * y + z * z);
    if (!(l > 0)) return -1;
    const d = this.pickDir;
    d.x = x / l;
    d.y = y / l;
    d.z = z / l;
    const id = this.world.grid.plotAt(d, this.pickHint as PlotId);
    this.pickHint = id;
    return id;
  }

  /**
   * Plot Card of the plot an avatar is looking at: the ground point `aimM` metres ahead along the avatar's facing
   * (default: its tool reticle distance from the last input's aim, clamped to the equipped tool's [aimMin, reach];
   * tools without reach use 0, the plot underfoot). False for an inactive slot or when `plotCard` is false.
   */
  pickPlot(slot: ActorSlot, out: PlotCardData, aimM?: number): boolean {
    const a = this.avatars[slot];
    if (a === undefined || !a.active) return false;
    let dist = aimM;
    if (dist === undefined) {
      const tool = this.config.tools[this.tools[slot]!.toolCode]!;
      dist = (tool.reachM * this.inputs[slot]!.toolParam) / 255;
      if (dist < tool.aimMinM) dist = tool.aimMinM;
      if (dist > tool.reachM) dist = tool.reachM;
    }
    if (!(dist >= 0)) dist = 0;
    const l = Math.sqrt(a.px * a.px + a.py * a.py + a.pz * a.pz);
    if (!(l > 0)) return false;
    const k = (l - a.heightAboveGround) / l;
    const id = this.plotIdAt(a.px * k + a.fx * dist, a.py * k + a.fy * dist, a.pz * k + a.fz * dist);
    return id >= 0 && this.plotCard(id as PlotId, out);
  }

  /** Copies of tool `toolCode` bought this shift (Repeat Requisition); 0 for an unknown code. */
  copiesBoughtOf(toolCode: number): number {
    return this.copiesBought[toolCode] ?? 0;
  }

  /**
   * Lumens the next purchase of `itemId` by `actor` would charge now, with Rebate, Repeat Requisition and Roost growth
   * applied exactly as the purchase rules do; 0 for an owned tool the Desk hands back. -1 when the item cannot be
   * bought (unknown, not on sale, top level, cap reached, prerequisites missing, already carried). Wallet, role,
   * Loaner Kit and the race window are not checked (they decide accept / reject, not the price).
   */
  quotePriceLm(actor: ActorSlot, itemId: string): number {
    const n = this.board.indexOf(itemId);
    if (n < 0) {
      const vi = this.vehicles.classify(itemId);
      if (vi !== null) {
        const q = this.vehicles.quote(vi, this.purchaseDiscountFrac);
        return q < 0 ? -1 : q;
      }
    }
    if (n >= 0) {
      const board = this.board;
      const level = this.boardLevels[n]!;
      if (this.nodeOnSale[n] !== 1 || level >= board.maxLevels[n]! || !board.prereqsMet(this.boardLevels, n)) return -1;
      const list = board.levelCostsLm[n]![level]!;
      return board.isCellNode[n] ? discountedPriceLm(list, this.purchaseDiscountFrac) : list;
    }
    const g = this.gearIndexById.get(itemId);
    if (g !== undefined) {
      const cap = this.gearSellCap[g]!;
      const level = this.suitGear[itemId] ?? 0;
      return cap === 0 || level >= cap ? -1 : this.gearCostsLm[g]![level]!;
    }
    if (itemId === ROOST_ITEM_ID) {
      return this.roostCount >= this.roostCap
        ? -1
        : Math.round(this.roostBaseLm * Math.pow(this.roostGrowth, this.roostCount));
    }
    const cfg = this.config;
    const tool = cfg.tools.find((x) => x.id === itemId);
    const t = this.tools[actor];
    if (!tool || t === undefined) return -1;
    if ((t.owned >> tool.code) & 1) {
      return !tool.cleans || (this.holsterMask[actor]! >> tool.code) & 1 ? -1 : 0;
    }
    const repeat = tool.tier >= cfg.repeatRequisitionMinTier && this.copiesBought[tool.code]! > 0;
    const list = repeat ? Math.round(tool.priceLm * cfg.repeatRequisitionFrac) : tool.priceLm;
    return discountedPriceLm(list, this.purchaseDiscountFrac);
  }

  /** HUD read-out of the vehicle `slot` is driving; false (out untouched) on foot. Allocation-free. */
  vehicleReadout(slot: ActorSlot, out: VehicleReadout): boolean {
    return this.vehicles.readout(slot, out);
  }

  /** Hop Pack bursts, max and refill progress of `slot` into `out`. False (out untouched) for an inactive slot. */
  hopReadout(slot: ActorSlot, out: HopReadout): boolean {
    const a = this.avatars[slot];
    if (a === undefined || !a.active) return false;
    out.bursts = a.hopCharges;
    out.max = a.hopMaxCharges;
    const full = this.config.hopRechargeTicks;
    out.recharge01 = a.hopCharges < a.hopMaxCharges && full > 0 ? Math.min(1, a.hopRechargeTicks / full) : 0;
    return true;
  }

  /** Crown Lamp level and toggle of `slot` into `out`. False (out untouched) for an inactive slot. */
  lampReadout(slot: ActorSlot, out: LampReadout): boolean {
    const a = this.avatars[slot];
    if (a === undefined || !a.active) return false;
    out.level = this.suitGear["gear.crown_lamp"] ?? 0;
    out.switchedOn = this.infos[slot]!.lampOn;
    out.lit = out.switchedOn && out.level > 0;
    return true;
  }

  /** Outposts of this Contract (compass). */
  get outpostCount(): number {
    return this.outposts.length;
  }

  /**
   * Outpost `k` into `out`: id, pad direction, home flag, visited. The home outpost (index 0, where the shift spawns
   * and sells) is always visited; others read ShiftState.visitedOutposts (no other outpost exists in the MVP, and
   * Relay Pads are post-MVP, so no visit is recorded yet). False (out untouched) for `k` out of range.
   */
  outpost(k: number, out: OutpostReadout): boolean {
    const o = this.outposts[k];
    if (o === undefined) return false;
    out.id = o.id;
    out.x = o.x;
    out.y = o.y;
    out.z = o.z;
    out.home = k === 0;
    out.visited = k === 0;
    return true;
  }

  /** Ring 2 around the home pad plot, lowest ids first, `count` of them (fewer on a tiny grid). Constructor only. */
  private computeApron(grid: PlotGrid, count: number): void {
    const home = this.outposts[0];
    if (home === undefined || count <= 0) return;
    this.apronPlots = landingApronPlots(grid, home, count);
  }

  /** Landing Apron plots of the home outpost (compass objective: first stroke, first Polish). */
  get apronPlotCount(): number {
    return this.apronPlots.length;
  }

  /** Unit direction of Landing Apron plot `k` (0 .. apronPlotCount-1) into `out`; false when out of range. */
  apronPlot(k: number, out: { x: number; y: number; z: number }): boolean {
    const p = this.apronPlots[k];
    if (p === undefined) return false;
    const d = this.world.grid.centerDirection(p as PlotId);
    out.x = d.x;
    out.y = d.y;
    out.z = d.z;
    return true;
  }

  /** True when `plotId` is one of the Landing Apron plots (at most `plotsPerOutpost` entries: a linear scan). */
  isApronPlot(plotId: number): boolean {
    for (let k = 0; k < this.apronPlots.length; k++) if (this.apronPlots[k] === plotId) return true;
    return false;
  }

  /** Announces Induction step `index` once per slot (bit), as `onboarding.step_completed`. */
  private completeStep(slot: number, index: number, bit: number, tick: number): void {
    if (index < 0 || slot < 0 || slot >= MAX_PLAYERS_PER_ROOM) return;
    const sent = this.onboardingSent[slot]!;
    if ((sent & bit) !== 0) return;
    this.onboardingSent[slot] = sent | bit;
    this.emit("onboarding.step_completed", {
      tick: tick as Tick,
      stepId: this.stepIds[index]!,
      actorSlot: slot,
      index,
      total: this.stepIds.length,
    });
  }

  // ---- Dust Cell levels ----------------------------------------------------------------------------------------------

  /** Cell level per tool = max(suit-gear key, board `cellLevel.<toolId>` stat); Densifier bonus from the board. */
  private applyCellLevels(t: ToolState): void {
    const max = this.config.cellLevelMult.length;
    for (let k = 0; k < t.cellLevel.length; k++) {
      const gear = t.cellLevel[k]!;
      const board = this.boardCellLevel[k]!;
      const lv = gear > board ? gear : board;
      t.cellLevel[k] = lv > max ? max : lv;
    }
    t.cellCapacityBonus = this.cellCapBonus;
    relatchCell(this.config, t);
  }

  private ownedCleaningCodes(owned: number, out: number[]): number {
    // Holster slot i = the i-th owned cleaning tool by tier (GDD section 9 slots 1..6). Allocation-free.
    let n = 0;
    const order = this.cleaningOrder;
    for (let k = 0; k < order.length; k++) {
      const code = order[k]!;
      if ((owned >> code) & 1 && n < HOLSTER_SLOT_COUNT) out[n++] = code;
    }
    return n;
  }

  private readonly holsterScratch: number[] = [];

  private selectHolster(actor: ActorSlot, slot: number): void {
    const t = this.tools[actor]!;
    const n = this.ownedCleaningCodes(this.holsterMask[actor]!, this.holsterScratch);
    if (!(slot >= 0 && slot < n)) return;
    const code = this.holsterScratch[slot]!;
    if (code === t.toolCode) return;
    t.toolCode = code;
    t.holsterSlot = slot;
    t.swapTicks = this.config.holsterSwapTicks;
    relatchCell(this.config, t);
  }

  private cycleHolster(actor: ActorSlot, dir: number): void {
    const t = this.tools[actor]!;
    const n = this.ownedCleaningCodes(this.holsterMask[actor]!, this.holsterScratch);
    if (n <= 1) return;
    this.selectHolster(actor, (t.holsterSlot + dir + n) % n);
  }

  /**
   * Loaner Kit: true when a Temp may spend `price` now (lower of walletFrac x wallet and capLm per window); records
   * the spend when allowed. The window restarts `windowTicks` after its first spend. Not saved (a reload resets it).
   */
  private loanerKitAllows(actor: number, price: number): boolean {
    const k = this.loanerKit;
    if (this.tickNo - this.loanerWindowStart[actor]! >= k.windowTicks || this.loanerSpent[actor] === 0) {
      this.loanerWindowStart[actor] = this.tickNo;
      this.loanerSpent[actor] = 0;
    }
    const frac = Math.floor(this.walletLm * k.walletFrac);
    const limit = frac < k.capLm ? frac : k.capLm;
    if (this.loanerSpent[actor]! + price > limit) return false;
    this.loanerSpent[actor] = this.loanerSpent[actor]! + price;
    return true;
  }

  /** Holster size of the shift (Holster Rig level). */
  private holsterSlots(): number {
    const lv = this.suitGear[HOLSTER_RIG_ID] ?? 0;
    const k = lv < this.holsterSlotsByLevel.length ? lv : this.holsterSlotsByLevel.length - 1;
    return this.holsterSlotsByLevel[k]!;
  }

  /**
   * Makes actor `s`'s holster valid from `mask`: owned cleaning tools only, the equipped tool always in it, at most
   * `holsterSlots()` tools (the lowest tiers that are not equipped leave first), free slots filled with the highest
   * owned tiers. Re-derives `holsterSlot` (index of the equipped tool). Allocation-free.
   */
  private normalizeHolster(s: number, mask: number): void {
    const t = this.tools[s]!;
    const order = this.cleaningOrder;
    let cleaning = 0;
    for (let k = 0; k < order.length; k++) cleaning |= 1 << order[k]!;
    let m = (mask & t.owned & cleaning) | (1 << t.toolCode);
    const slots = this.holsterSlots();
    let n = 0;
    for (let k = 0; k < order.length; k++) if ((m >> order[k]!) & 1) n++;
    for (let k = 0; k < order.length && n > slots; k++) {
      const code = order[k]!;
      if ((m >> code) & 1 && code !== t.toolCode) {
        m &= ~(1 << code);
        n--;
      }
    }
    for (let k = order.length - 1; k >= 0 && n < slots; k--) {
      const code = order[k]!;
      if ((t.owned >> code) & 1 && !((m >> code) & 1)) {
        m |= 1 << code;
        n++;
      }
    }
    this.holsterMask[s] = m;
    const count = this.ownedCleaningCodes(m, this.holsterScratch);
    for (let i = 0; i < count; i++) if (this.holsterScratch[i] === t.toolCode) t.holsterSlot = i;
  }

  /**
   * Puts tool `code` into actor `s`'s holster and equips it: it takes a free slot, else it replaces the equipped
   * tool (owner decision 2026-11-15: without a Holster Rig a new tool replaces the one in hand and is equipped).
   */
  private holsterTool(s: number, code: number): void {
    const t = this.tools[s]!;
    let m = this.holsterMask[s]!;
    let n = 0;
    for (let k = 0; k < this.cleaningOrder.length; k++) if ((m >> this.cleaningOrder[k]!) & 1) n++;
    if (n >= this.holsterSlots()) m &= ~(1 << t.toolCode);
    m |= 1 << code;
    if (t.toolCode !== code) {
      t.toolCode = code;
      t.swapTicks = this.config.holsterSwapTicks;
    }
    this.normalizeHolster(s, m);
    relatchCell(this.config, t);
  }

  /** Holster masks of the present members as META keys (`hol.<slot>`), only where more than the equipped tool. */
  private holsterRecord(): Record<string, number> {
    const out: Record<string, number> = {};
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      if (!this.avatars[s]!.active) continue;
      const m = this.holsterMask[s]!;
      if (m !== 1 << this.tools[s]!.toolCode) out[`${HOLSTER_SAVE_KEY_PREFIX}${s}`] = m;
    }
    return out;
  }

  private lowestOwnedCleaningTool(owned: number): number {
    const n = this.ownedCleaningCodes(owned, this.holsterScratch);
    return n > 0 ? this.holsterScratch[0]! : 0;
  }

  /**
   * `purchase` intent (M1-W6-T02): a tool, a Promotions Board node (its next level) or a suit-gear line (its next
   * level), charged to the shared wallet. Applied one at a time in arrival order, so the wallet is never spent twice
   * and never goes negative; replays and races are resolved by `PurchaseGuard` (economy/purchase.ts). Every price
   * comes from game-data; nothing the client sends besides the item id is trusted.
   */
  private purchase(actor: ActorSlot, requestId: RequestId, itemId: string): IntentResult {
    const replay = this.purchaseGuard.replayWalletAfter(actor, requestId, itemId);
    if (replay >= 0) return { requestId, ok: true, walletAfter: replay };
    const n = this.board.indexOf(itemId);
    const vehicleItem = n >= 0 ? null : this.vehicles.classify(itemId);
    // Temps buy only their own tools (Loaner Kit); shared items (board, suit gear, Roosts, Motor Pool, vehicles) need the
    // Holder's `tempCanSpendShared` (security section 2 "Temp defaults").
    const shared = n >= 0 || vehicleItem !== null || this.gearIndexById.has(itemId) || itemId === ROOST_ITEM_ID;
    if (shared && this.infos[actor]!.role === "temp" && !this.tempPerms.tempCanSpendShared) {
      return this.rejectPurchase(actor, requestId, itemId, "role_blocked");
    }
    if (vehicleItem !== null) return this.purchaseVehicleItem(actor, requestId, itemId, vehicleItem);
    if (n >= 0) return this.purchaseNode(actor, requestId, itemId, n);
    const g = this.gearIndexById.get(itemId);
    if (g !== undefined) return this.purchaseGear(actor, requestId, itemId, g);
    if (itemId === ROOST_ITEM_ID) return this.purchaseRoost(actor, requestId, itemId);
    return this.purchaseTool(actor, requestId, itemId);
  }

  private rejectPurchase(
    actor: ActorSlot,
    requestId: RequestId,
    itemId: string,
    code: PurchaseRejectReason,
  ): IntentResult {
    this.counters.intentsRejected++;
    this.emit("purchase.rejected", { tick: this.tickNo as Tick, actorSlot: actor, itemId, reason: code });
    return { requestId, ok: false, code };
  }

  private completePurchase(
    actor: ActorSlot,
    requestId: RequestId,
    itemId: string,
    level: number,
    priceLm: number,
  ): IntentResult {
    this.purchaseGuard.remember(actor, requestId, itemId, this.walletLm);
    this.emit("purchase.completed", {
      tick: this.tickNo as Tick,
      actorSlot: actor,
      itemId,
      level,
      priceLm,
      walletLm: this.walletLm,
    });
    return { requestId, ok: true, walletAfter: this.walletLm };
  }

  private purchaseTool(actor: ActorSlot, requestId: RequestId, itemId: string): IntentResult {
    const cfg = this.config;
    const tool = cfg.tools.find((x) => x.id === itemId);
    if (!tool) return this.rejectPurchase(actor, requestId, itemId, "unknown_item");
    const t = this.tools[actor]!;
    if ((t.owned >> tool.code) & 1) {
      // Owned but not carried (replaced earlier): the Requisitions Desk hands it back for free, equipped.
      if (!tool.cleans || (this.holsterMask[actor]! >> tool.code) & 1) {
        return this.rejectPurchase(actor, requestId, itemId, "already_owned");
      }
      this.holsterTool(actor, tool.code);
      return this.completePurchase(actor, requestId, itemId, 1, 0);
    }
    const repeat = tool.tier >= cfg.repeatRequisitionMinTier && this.copiesBought[tool.code]! > 0;
    const list = repeat ? Math.round(tool.priceLm * cfg.repeatRequisitionFrac) : tool.priceLm;
    const price = discountedPriceLm(list, this.purchaseDiscountFrac);
    if (this.walletLm < price) return this.rejectPurchase(actor, requestId, itemId, "insufficient_funds");
    if (this.infos[actor]!.role === "temp" && !this.loanerKitAllows(actor, price)) {
      return this.rejectPurchase(actor, requestId, itemId, "cap_reached");
    }
    this.walletLm -= price;
    this.copiesBought[tool.code]!++;
    if (tool.cleans && tool.tier <= cfg.standardIssueMaxTier) {
      // Standard Issue: every member, present or future, gets it once anyone owns one (others carry it only if
      // their holster has a free slot).
      this.standardIssueOwned |= 1 << tool.code;
      for (const other of this.tools) other.owned |= 1 << tool.code;
      for (let o = 0; o < MAX_PLAYERS_PER_ROOM; o++) {
        if (o !== actor && this.avatars[o]!.active) this.normalizeHolster(o, this.holsterMask[o]!);
      }
    } else {
      t.owned |= 1 << tool.code;
    }
    if (tool.cleans) this.holsterTool(actor, tool.code);
    return this.completePurchase(actor, requestId, itemId, 1, price);
  }

  /** Motor Pool, a vehicle, or a vehicle upgrade line: prerequisites and prices in `RoomVehicles.quote`. */
  private purchaseVehicleItem(actor: ActorSlot, requestId: RequestId, itemId: string, item: VehicleItem): IntentResult {
    const price = this.vehicles.quote(item, this.purchaseDiscountFrac);
    if (price < 0) {
      const code: PurchaseRejectReason =
        price === -2 ? "prereq_missing" : price === -3 ? "max_level" : price === -4 ? "cap_reached" : "unknown_item";
      return this.rejectPurchase(actor, requestId, itemId, code);
    }
    if (this.walletLm < price) return this.rejectPurchase(actor, requestId, itemId, "insufficient_funds");
    this.walletLm -= price;
    const level = this.vehicles.apply(item);
    if (item.type === 0 && level === 1) {
      // The first Motor Pool opens the vehicles on sale (an ordinary prerequisite).
      for (const k of this.vehicles.tuning.kinds) {
        if (!this.vehicles.isOffered(k.code)) continue;
        this.emit("unlock.granted", {
          tick: this.tickNo as Tick,
          kind: "vehicle",
          unlockId: k.id,
          viaItemId: MOTOR_POOL_ITEM_ID,
        });
      }
    }
    return this.completePurchase(actor, requestId, itemId, level, price);
  }

  /** Next level of board node `n`: on sale, below its top level, prerequisites met, no race, affordable. */
  private purchaseNode(actor: ActorSlot, requestId: RequestId, itemId: string, n: number): IntentResult {
    const board = this.board;
    const levels = this.boardLevels;
    if (this.nodeOnSale[n] !== 1) return this.rejectPurchase(actor, requestId, itemId, "unknown_item");
    const level = levels[n]!;
    if (level >= board.maxLevels[n]!) return this.rejectPurchase(actor, requestId, itemId, "max_level");
    if (!board.prereqsMet(levels, n)) return this.rejectPurchase(actor, requestId, itemId, "prereq_missing");
    if (this.purchaseGuard.raced(n, actor, this.tickNo)) {
      return this.rejectPurchase(actor, requestId, itemId, "pending_other");
    }
    const list = board.levelCostsLm[n]![level]!;
    // Rebate covers tools, Dust Cells and vehicles; other nodes pay list.
    const price = board.isCellNode[n] ? discountedPriceLm(list, this.purchaseDiscountFrac) : list;
    if (this.walletLm < price) return this.rejectPurchase(actor, requestId, itemId, "insufficient_funds");
    const before = this.nodePrereqScratch;
    for (let k = 0; k < board.count; k++) before[k] = board.prereqsMet(levels, k) ? 1 : 0;
    this.walletLm -= price;
    levels[n] = level + 1;
    this.refreshBoardEffects();
    this.purchaseGuard.noteBought(n, actor, this.tickNo);
    const result = this.completePurchase(actor, requestId, itemId, level + 1, price);
    // Nodes this level opened (their prerequisites just became met), in data order. Ordinary prerequisites only.
    for (let k = 0; k < board.count; k++) {
      if (before[k] === 0 && this.nodeOnSale[k] === 1 && board.prereqsMet(levels, k)) {
        this.emit("unlock.granted", {
          tick: this.tickNo as Tick,
          kind: "node",
          unlockId: board.nodeIds[k]!,
          viaItemId: itemId,
        });
      }
    }
    return result;
  }

  /**
   * A Roost (with its Sandpiper): purchasable with money from the start, no quest gate. Price = base x growth^owned
   * (4,500 x 1.15^(n-1) for the n-th), whole Lumens; the MVP cap is MVP_SCOPE.roostCap. Placement and the robot
   * itself belong to the robot task; the sim records the count (ShiftState.robotCounts).
   */
  private purchaseRoost(actor: ActorSlot, requestId: RequestId, itemId: string): IntentResult {
    if (this.roostCount >= this.roostCap) return this.rejectPurchase(actor, requestId, itemId, "cap_reached");
    const price = Math.round(this.roostBaseLm * Math.pow(this.roostGrowth, this.roostCount));
    if (this.walletLm < price) return this.rejectPurchase(actor, requestId, itemId, "insufficient_funds");
    this.walletLm -= price;
    this.roostCount++;
    return this.completePurchase(actor, requestId, itemId, this.roostCount, price);
  }

  /** Next level of suit-gear line `g` (shared by the shift): sold up to its cap, no race, affordable. */
  private purchaseGear(actor: ActorSlot, requestId: RequestId, itemId: string, g: number): IntentResult {
    const cap = this.gearSellCap[g]!;
    if (cap === 0) return this.rejectPurchase(actor, requestId, itemId, "unknown_item");
    const level = this.suitGear[itemId] ?? 0;
    if (level >= cap) return this.rejectPurchase(actor, requestId, itemId, "max_level");
    const item = this.board.count + g;
    if (this.purchaseGuard.raced(item, actor, this.tickNo)) {
      return this.rejectPurchase(actor, requestId, itemId, "pending_other");
    }
    const price = this.gearCostsLm[g]![level]!;
    if (this.walletLm < price) return this.rejectPurchase(actor, requestId, itemId, "insufficient_funds");
    this.walletLm -= price;
    this.suitGear[itemId] = level + 1;
    // Derived per-avatar gear stats (Hop Pack bursts); the Crown Lamp level is read every tick.
    const hopMax = this.hopMaxChargesOf(this.suitGear);
    for (const a of this.avatars) {
      a.hopMaxCharges = hopMax;
      if (a.hopCharges > hopMax) a.hopCharges = hopMax;
    }
    if (itemId === HOLSTER_RIG_ID) {
      for (let o = 0; o < MAX_PLAYERS_PER_ROOM; o++) {
        if (this.avatars[o]!.active) this.normalizeHolster(o, this.holsterMask[o]!);
      }
    }
    this.purchaseGuard.noteBought(item, actor, this.tickNo);
    return this.completePurchase(actor, requestId, itemId, level + 1, price);
  }

  // ---- Selling (Assay Counter pour, Receiving Gate intake, Railshot) ---------------------------------------------------

  /** True when unit direction-ish point (x, y, z) lies within `reachM` (ground distance) of sell point `k`. */
  private nearSellPoint(x: number, y: number, z: number, k: number, reachM: number): boolean {
    const l = Math.sqrt(x * x + y * y + z * z);
    if (l === 0) return false;
    const dx = x / l - this.sellX[k]!;
    const dy = y / l - this.sellY[k]!;
    const dz = z / l - this.sellZ[k]!;
    const r = reachM / this.config.moonRadiusM;
    return dx * dx + dy * dy + dz * dz <= r * r;
  }

  /**
   * Hold E within reach of an Assay Counter with a free pour slot, carrying nothing (E while carrying pours the unit
   * back into the Cell): the Cells drain, equipped Cell first, and every drained gram is sold as it drains. Releasing
   * E, walking out of reach or running out of dust ends the pour with `cargo.sold`.
   */
  private stepPour(s: number, a: AvatarState, t: ToolState, b: number, tick: number): void {
    const holding = (b & INPUT_BUTTON_MASK.interact) !== 0;
    const at = this.pourAt[s]!;
    if (at >= 0) {
      if (
        !holding ||
        !this.nearSellPoint(a.px, a.py, a.pz, at, ASSAY_POUR_REACH_M) ||
        !this.drainPourTick(s, t, tick)
      ) {
        this.endPour(s, tick);
      }
      return;
    }
    if (!holding || this.pourableCell(t) < 0) return;
    for (let k = 0; k < this.sellKind.length; k++) {
      if (this.sellKind[k] !== 0 || !this.nearSellPoint(a.px, a.py, a.pz, k, ASSAY_POUR_REACH_M)) continue;
      if (this.cargo.carriedCount(s) > 0) return;
      // Lowest free pour slot of this counter.
      let used = 0;
      for (let o = 0; o < MAX_PLAYERS_PER_ROOM; o++) if (this.pourAt[o] === k) used |= 1 << this.pourSlot[o]!;
      let slot = 0;
      while (slot < this.sellRules.pourSlots && (used >> slot) & 1) slot++;
      if (slot >= this.sellRules.pourSlots) continue;
      this.pourAt[s] = k;
      this.pourSlot[s] = slot;
      this.pourGrams[s] = 0;
      this.pourLm[s] = 0;
      this.emit("cargo.pour_started", { tick: tick as Tick, actorSlot: s, pourSlot: slot + 1 });
      if (!this.drainPourTick(s, t, tick)) this.endPour(s, tick);
      return;
    }
  }

  /** Cell to pour from: the equipped one while it holds dust, else the lowest tool code with dust; -1 when empty. */
  private pourableCell(t: ToolState): number {
    if ((t.cellGrams[t.toolCode] ?? 0) > 0) return t.toolCode;
    for (let k = 0; k < t.cellGrams.length; k++) if (t.cellGrams[k]! > 0) return k;
    return -1;
  }

  /** One pour tick: drains (a full Cell takes pourS x pourTimeMult) and sells. False when every Cell is empty. */
  private drainPourTick(s: number, t: ToolState, tick: number): boolean {
    const code = this.pourableCell(t);
    if (code < 0) return false;
    const cfg = this.config;
    const cap = actorCellCap(cfg, t, code);
    const rate = pourGramsPerTick(cap, this.sellRules.pourS * this.pourTimeMult, cfg.tickHz);
    const have = t.cellGrams[code]!;
    const g = have < rate ? have : rate;
    t.cellGrams[code] = have - g;
    if (code === t.toolCode) relatchCell(cfg, t);
    this.pourGrams[s] = this.pourGrams[s]! + g;
    this.pourLm[s] = this.pourLm[s]! + this.creditSale(s, g, tick);
    return true;
  }

  private endPour(s: number, tick: number): void {
    const grams = this.pourGrams[s]!;
    this.pourAt[s] = -1;
    if (grams > 0) {
      this.emit("cargo.sold", {
        tick: tick as Tick,
        source: "assay_counter",
        actorSlot: s,
        materialId: DUST_MATERIAL_ID,
        kg: grams / 1000,
        lm: this.pourLm[s]!,
        walletLm: this.walletLm,
      });
    }
    this.pourGrams[s] = 0;
    this.pourLm[s] = 0;
  }

  /** Walking over an uncollected Near Parcel (within the cargo pickup radius) pays it once. */
  private stepParcels(tick: number): void {
    const all = (1 << this.parcelCount) - 1;
    if (this.parcelsCollected === all) return;
    const r = this.config.cargo.pickupRadiusM / this.config.moonRadiusM;
    const r2 = r * r;
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const a = this.avatars[s]!;
      if (!a.active) continue;
      const l = Math.sqrt(a.px * a.px + a.py * a.py + a.pz * a.pz);
      if (l === 0) continue;
      for (let k = 0; k < this.parcelCount; k++) {
        if ((this.parcelsCollected >>> k) & 1) continue;
        const dx = a.px / l - this.parcelDirs[3 * k]!;
        const dy = a.py / l - this.parcelDirs[3 * k + 1]!;
        const dz = a.pz / l - this.parcelDirs[3 * k + 2]!;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        this.parcelsCollected |= 1 << k;
        this.walletLm += this.parcelLm;
        this.emit("collectible.found", {
          tick: tick as Tick,
          actorSlot: s,
          kind: "stray_cargo",
          id: NEAR_PARCEL_SIZE,
          lm: this.parcelLm,
          walletLm: this.walletLm,
        });
      }
    }
  }

  /** Despawn credit and loose units on a Dump Plate are sold at the Receiving Gate on arrival. */
  private stepGateIntake(tick: number): void {
    const gate0 = this.firstGate;
    if (gate0 < 0) return;
    const c = this.cargo;
    if (c.pendingGateGrams > 0) {
      const g = c.pendingGateGrams;
      c.pendingGateGrams = 0;
      this.sellAtGate(-1, g, tick);
    }
    if (c.loose === 0) return;
    for (let i = 0; i < c.capacity; i++) {
      if (!isLooseUnit(c, i)) continue;
      for (let k = gate0; k < this.sellKind.length; k++) {
        if (this.sellKind[k] !== 1 || !this.nearSellPoint(c.px[i]!, c.py[i]!, c.pz[i]!, k, DUMP_PLATE_RADIUS_M))
          continue;
        const owner = c.owner[i]!;
        const g = takeLooseUnit(c, i);
        if (g > 0) this.sellAtGate(owner, g, tick);
        break;
      }
    }
  }

  private sellAtGate(seller: number, grams: number, tick: number): void {
    const lm = this.creditSale(seller, grams, tick);
    this.emit("cargo.sold", {
      tick: tick as Tick,
      source: "receiving_gate",
      actorSlot: seller >= 0 ? seller : null,
      materialId: DUST_MATERIAL_ID,
      kg: grams / 1000,
      lm,
      walletLm: this.walletLm,
    });
  }

  /**
   * Credits a dust sale to the shared wallet: lmPerKg x payout multiplier, whole Lumens with a micro-Lumen remainder
   * per seller (-1: robots / the shift). Counts toward the Railshot. Returns the Lumens credited now.
   */
  private creditSale(seller: number, grams: number, tick: number): number {
    const idx = seller >= 0 && seller < MAX_PLAYERS_PER_ROOM ? seller : MAX_PLAYERS_PER_ROOM;
    const micro = saleMicroLm(grams, this.sellRules.dustLmPerKg, this.payoutMult) + this.saleRemMicro[idx]!;
    const lm = Math.floor(micro / 1_000_000);
    this.saleRemMicro[idx] = micro - lm * 1_000_000;
    this.walletLm += lm;
    this.railshotGrams += grams;
    const every = this.sellRules.railshotEveryGrams;
    while (every > 0 && this.railshotGrams >= every) {
      this.railshotGrams -= every;
      const k = this.firstGate >= 0 ? this.firstGate : 0;
      this.emit("railshot.fired", {
        tick: tick as Tick,
        gateId: (SERVICE_ENTITY_ID_BASE + k) as EntityId,
        kg: every / 1000,
        originPlotId: (this.sellPlot[k] ?? 0) as PlotId,
      });
    }
    return lm;
  }

  private shiftState(): ShiftState {
    const players: PlayerInfo[] = [];
    const ownedVehicles = this.vehicles.ownedKindIds();
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      if (!this.avatars[s]!.active) continue;
      const inf = this.infos[s]!;
      const t = this.tools[s]!;
      players.push({
        playerId: inf.playerId,
        displayName: inf.displayName,
        slot: s,
        role: inf.role,
        tenureLevel: 0,
        equippedCosmetics: [],
        connected: true,
        afk: false,
        hidden: false,
        toolsOwned: t.owned & 0xff,
        equippedTool: t.toolCode,
        vehicleIds: ownedVehicles,
      });
    }
    const vehicleRecords: VehicleInfo[] = [];
    this.vehicles.shiftRecords((slot) => this.infos[slot]!.playerId, vehicleRecords);
    return {
      contractId: this.contractId,
      shiftType: this.shiftType,
      protocolVersion: PROTOCOL_VERSION,
      simTickHz: this.config.tickHz,
      snapshotHz: this.config.snapshotHz,
      walletLumens: this.walletLm,
      shinePolished: this.shinePolished,
      plotCount: this.world.grid.count,
      sharedUpgrades: this.board.toRecord(this.boardLevels),
      suitGear: { ...this.suitGear },
      visitedOutposts: 0,
      beacons: Array.from({ length: BEACON_COUNT }, () => ({ plotId: 0 as PlotId, active: false })),
      players,
      vehicles: vehicleRecords,
      robotCounts: this.roostCount > 0 ? { [ROOST_ITEM_ID]: this.roostCount } : {},
      permissions: { ...this.tempPerms },
      fulfilled: false,
    };
  }

  private bodyYawRadians(a: AvatarState): number {
    const basis = this.yawBasis;
    headingBasis(a, basis);
    const north = a.fx * basis[3]! + a.fy * basis[4]! + a.fz * basis[5]!;
    const east = a.fx * basis[6]! + a.fy * basis[7]! + a.fz * basis[8]!;
    return turnToRadians(radiansToTurn(atan2Det(east, north)));
  }

  private readonly yawBasis = new Float64Array(9);

  private emit<K extends SimEventName>(name: K, payload: SimEventMap[K]): void {
    if (this.listeners.length === 0) return;
    const e = { name, payload } as RoomSimEvent;
    for (const l of this.listeners) l(e);
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  const x = Math.round(Number.isFinite(v) ? v : 0);
  return x < lo ? lo : x > hi ? hi : x;
}

function copyStroke(src: MutableStroke, dst: MutableStroke): void {
  dst.anchor = src.anchor;
  dst.startUMm = src.startUMm;
  dst.startVMm = src.startVMm;
  dst.endUMm = src.endUMm;
  dst.endVMm = src.endVMm;
  dst.widthCm = src.widthCm;
  dst.depth16 = src.depth16;
  dst.toolCode = src.toolCode;
  dst.tick = src.tick;
  dst.actorSlot = src.actorSlot;
  dst.inputSeq = src.inputSeq;
}
