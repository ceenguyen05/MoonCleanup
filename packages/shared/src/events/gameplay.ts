// @contract events/gameplay v1.1
// @consumers packages/sim (emits the sim events), apps/client/src/gameplay (emits the presentation events),
//   apps/client/src/{ui,audio,visuals,animation} (listen), apps/client/src/sim-host and apps/client/src/net
//   (carry the sim events over RoomHost.onEvent), apps/server/src/sim (emits to the room), this package's
//   events/catalog (EventMap) and audio/cues (event-to-cue table)
//
// v1.1 (additive, contracts bump 1 of M1, from the M1-W7-T05 audio requests): four new PRESENTATION events
//   `avatar.stepped`, `vehicle.motion`, `audio.cue`, `audio.settings`; optional `placement` (listener-relative distance
//   and pan, audio/cues `AudioPlacement`) on `tool.stroke_contact`, `avatar.jumped`, `avatar.landed`; optional
//   `syllables` on `dot.message`. No sim event changed: `daynight.changed` has no far-side flag and sim events carry
//   no positions (declined, see docs/agent-reports/M1-contracts-bump-1.md). Consumers to update: apps/client/src/
//   gameplay (emit the new events and fill `placement`), apps/client/src/ui (emit `audio.cue` and `audio.settings`),
//   apps/client/src/audio (subscribe), apps/client/src/debug (event log lists them via EVENT_NAMES).
//
// Gameplay event payloads (M1-W0-T03). Specification: docs/design/game-feel-and-controls.md section 7 (the juice
// catalog), docs/architecture/world-and-dust-simulation.md sections 4.6 and 4.7, ADR-0022, ADR-0031. Names are
// `<domain>.<name>` exactly as that table spells them. Every payload is read-only plain data.
//
// Two kinds of event:
// - SIM events (SIM_EVENT_NAMES): produced by the deterministic RoomSim, identical in the Solo worker and on the
//   server; they cross RoomHost.onEvent. Every one carries `tick`.
// - PRESENTATION events (PRESENTATION_EVENT_NAMES, the table's diamond rows): derived on the client from the
//   predicted sim; never on the wire, never in a save.
//
// Conventions: `actorSlot` is the player slot (0 .. MAX_PLAYERS_PER_ROOM - 1); `null` means "not a player" (robots,
// the room, the "Flock"). Ids of game-data records are the dot-namespaced strings of config/common.schema
// (`tool.lane_broom`). Dust masses use integer grams (`grams`, world-and-dust-simulation.md section 4.6), money uses
// `Lumens`. Tiers: MVP unless a comment says v1.0; names marked "parked" exist so the table stays stable and are not
// emitted in the reference-mode baseline.

import type { AudioCueId, AudioCuePlay, AudioPlacement, AudioSurface } from "../audio";
import type { EntityId, PlotId } from "../ids";
import type { Lumens, Metres, Tick } from "../units";

/** Fields of every sim event. */
export interface SimEventBase {
  /** Sim tick the event happened on. */
  readonly tick: Tick;
}

/** Player slot of the actor, or `null` for robots / the room. */
export type EventActor = number | null;

// ---- Tools and dust -----------------------------------------------------------------------------------------------

/** Presentation: one stroke segment touched the ground (tool core layer, grains, berm; game-feel section 3.5). */
export interface ToolStrokeContactEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly toolId: string;
  readonly plotId: PlotId;
  /** Dust taken by this segment in grams (0 on clean ground). */
  readonly grams: number;
  /** Share of the swept texels that still carried dust, 0 = clean ground (timbre: grime vs clean), 1 = all grime. */
  readonly grime01: number;
  /** Tool-head speed over the ground in m/s (swirl rate, cadence). */
  readonly speedMps: number;
  /** True while the Cell is full and the tool "goes dry". */
  readonly dry: boolean;
  /** Where another player's tool is relative to the listener; absent for the listener's own tool (v1.1). */
  readonly placement?: AudioPlacement;
}

/** Sim: a 10 Hz batch of dust moved from plots into one actor's Dust Cell (world-and-dust section 4.6). */
export interface DustCollectedEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly grams: number;
  /** Plots that gave dust in this batch (at most 8; the largest contributors first). */
  readonly plotIds: readonly PlotId[];
  /** The actor's Cell contents after the batch, grams. */
  readonly cellGrams: number;
  /** The actor's Cell capacity, grams. */
  readonly cellCapGrams: number;
}

/** Sim: a Cell crossed 90 % (two-tone, amber pulse). Emitted once per fill. */
export interface CellNearFullEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly toolId: string;
  readonly cellGrams: number;
  readonly cellCapGrams: number;
}

/** Sim: a Cell reached 100 %; pickup stops until it is emptied. */
export interface CellFullEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly toolId: string;
  readonly cellCapGrams: number;
  /** Compass bearing in degrees to the nearest pour point, or `null` when none is known (prompt bearing). */
  readonly pourPointBearingDeg: number | null;
}

/** Presentation: Lane Lock engaged (the Lane Guide line fades in). */
export interface LaneLockedEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly toolId: string;
  /** Locked heading in degrees, 0 = north, clockwise. */
  readonly headingDeg: number;
}

/** Presentation: Lane Lock released. */
export interface LaneUnlockedEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly toolId: string;
}

// ---- Plots and Shine ----------------------------------------------------------------------------------------------

/** Sim: a plot passed the Opened threshold (monotonic Grimy -> Opened). */
export interface PlotOpenedEvent extends SimEventBase {
  readonly plotId: PlotId;
  /** Player credited so far (most dust removed), or `null` when robots lead. */
  readonly creditedSlot: EventActor;
}

/** Credit of a Polished plot: a player, or the robots ("Flock"). */
export const PLOT_CREDITS = ["player", "flock"] as const;
export type PlotCredit = (typeof PLOT_CREDITS)[number];

/** Sim: the Inspector's Stamp. A plot became Polished (latched). */
export interface PlotPolishedEvent extends SimEventBase {
  readonly plotId: PlotId;
  readonly credit: PlotCredit;
  /** Credited player slot; `null` when `credit` is `flock`. */
  readonly creditedSlot: EventActor;
  /** Lumens paid for the Stamp (base x premium x Charge finish). */
  readonly stampLm: Lumens;
  /** The last dust was removed by a Charge tool (x1.5 finish; "Charged" tag). */
  readonly charged: boolean;
  /** Plots Polished after this one (Shine numerator). */
  readonly polishedCount: number;
}

/** Shine milestones in percent (progress celebrations; they pay and unlock nothing: plot-bonus.json). */
export const SHINE_MILESTONE_PCTS = [1, 5, 10, 25, 50, 75, 100] as const;
export type ShineMilestonePct = (typeof SHINE_MILESTONE_PCTS)[number];

/** Sim: the shift's Shine crossed a milestone. 100 is Contract Fulfilled. */
export interface ShineMilestoneEvent extends SimEventBase {
  readonly pct: ShineMilestonePct;
  readonly polishedCount: number;
  readonly totalPlots: number;
}

// ---- Cargo, Pucks and selling -------------------------------------------------------------------------------------

/** Presentation / sim: a Dust Puck was formed from the Cell (press click). */
export interface CargoPuckFormedEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly puckId: EntityId;
}

/** Sim: pucks were banded into a Puck Stack (hold F). */
export interface CargoStackBandedEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly stackId: EntityId;
  readonly pucks: number;
}

/** Sim: an actor picked up a puck or stack. */
export interface CargoPickedUpEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly cargoId: EntityId;
}

/** Sim: an actor threw a puck or stack (Q). */
export interface CargoThrownEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly cargoId: EntityId;
}

/** Sim: a pour started at an Assay Counter slot (hold E). */
export interface CargoPourStartedEvent extends SimEventBase {
  readonly actorSlot: number;
  /** Assay Counter pour slot, 1 .. 4. */
  readonly pourSlot: number;
}

/** Where Lumens for dust came from. `roost_uplink` is the MVP stand-in for rails (scope-tiers section 1). */
export const SALE_SOURCES = ["assay_counter", "receiving_gate", "roost_uplink"] as const;
export type SaleSource = (typeof SALE_SOURCES)[number];

/** Sim: dust was sold (per completed pour, per Gate puck, per Roost delivery). */
export interface CargoSoldEvent extends SimEventBase {
  readonly source: SaleSource;
  /** Seller; `null` for robots. */
  readonly actorSlot: EventActor;
  /** `material.<id>` of game-data (economy.json). */
  readonly materialId: string;
  readonly kg: number;
  readonly lm: Lumens;
  /** The shared wallet after the sale. */
  readonly walletLm: Lumens;
}

/** Sim: the Railshot fired (every 2 t sold into a Gate). */
export interface RailshotFiredEvent extends SimEventBase {
  readonly gateId: EntityId;
  readonly kg: number;
  /** Plot the launcher stands on, for the camera falloff and the ground "thoom". */
  readonly originPlotId: PlotId;
}

// ---- Purchases and unlocks ----------------------------------------------------------------------------------------

/** Why a purchase was refused (`purchase.rejected`). `prereq_missing` names ordinary prerequisites, never gates. */
export const PURCHASE_REJECT_REASONS = [
  "insufficient_funds",
  "prereq_missing",
  "already_owned",
  "max_level",
  "cap_reached",
  "role_blocked",
  "pending_other",
  "unknown_item",
  "rate_limited",
] as const;
export type PurchaseRejectReason = (typeof PURCHASE_REJECT_REASONS)[number];

/** Sim: a purchase succeeded and was charged to the shared wallet. */
export interface PurchaseCompletedEvent extends SimEventBase {
  readonly actorSlot: number;
  /** Game-data id: tool, board node, gear line, vehicle, build piece, vehicle line. */
  readonly itemId: string;
  /** Level now owned for levelled items (Cell III = 3), otherwise 1. */
  readonly level: number;
  readonly priceLm: Lumens;
  readonly walletLm: Lumens;
}

/** Sim: a purchase was refused. Presentation: soft low double buzz and a shake. */
export interface PurchaseRejectedEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly itemId: string;
  readonly reason: PurchaseRejectReason;
}

/** What an unlock opens. */
export const UNLOCK_KINDS = ["tool", "gear", "vehicle", "robot", "node", "feature", "piece"] as const;
export type UnlockKind = (typeof UNLOCK_KINDS)[number];

/** Sim: something became available (Motor Pool owned, Cell line III reached, ...). Reference mode: ordinary prerequisites only. */
export interface UnlockGrantedEvent extends SimEventBase {
  readonly kind: UnlockKind;
  /** Game-data id of what became available (or the feature id for `feature`). */
  readonly unlockId: string;
  /** The purchase that made it available, or `null` when it was available from the start of the shift. */
  readonly viaItemId: string | null;
}

/** Sim (v1.0, Next Requisition tracker): the tracked item reached a funding step. */
export interface RequisitionProgressEvent extends SimEventBase {
  readonly itemId: string;
  readonly pct: 25 | 50 | 75;
}

// ---- Robots -------------------------------------------------------------------------------------------------------

/** Sim: a robot was deployed (Roost clamp, Albatross take-off). */
export interface RobotDeployedEvent extends SimEventBase {
  readonly robotId: EntityId;
  /** `robot.<id>` of game-data (robots.json). */
  readonly kindId: string;
  readonly roostId: EntityId | null;
}

/** Sim: a robot changed state (robots.json `states[]`: `foraging`, `patch_picked_clean`, `roost_brimming`, ...). */
export interface RobotStateChangedEvent extends SimEventBase {
  readonly robotId: EntityId;
  readonly kindId: string;
  readonly state: string;
  readonly previous: string;
  /** The change needs the player (amber two-note, notice with an action). */
  readonly alert: boolean;
}

// ---- Avatar and vehicles ------------------------------------------------------------------------------------------

/** Presentation: the avatar left the ground by jumping (suit push, world mutes after 150 ms). */
export interface AvatarJumpedEvent extends SimEventBase {
  readonly actorSlot: number;
  /** Where another player is relative to the listener; absent for the listener's own avatar (v1.1). */
  readonly placement?: AudioPlacement;
}

/**
 * Presentation (v1.1): one footstep. Emitted once per foot contact by the client's avatar animation/locomotion layer
 * for every visible avatar, own and others' (one event per step, so cadence follows the gait). Not emitted while
 * jumping, seated or standing still.
 */
export interface AvatarSteppedEvent extends SimEventBase {
  readonly actorSlot: number;
  /** Ground under the boot: grime thuds soft, clean taps firm, deck plates ring. */
  readonly surface: AudioSurface;
  /** Ground speed over walk-to-sprint range, 0 .. 1 (step loudness and pitch). */
  readonly speed01: number;
  /** Where another player is relative to the listener; absent for the listener's own avatar. */
  readonly placement?: AudioPlacement;
}

/** Presentation: the avatar touched down. */
export interface AvatarLandedEvent extends SimEventBase {
  readonly actorSlot: number;
  /** Vertical speed at impact in m/s (positive = down). */
  readonly impactMps: number;
  /** Plot-state timbre under the boots. */
  readonly onClean: boolean;
  /** Where another player is relative to the listener; absent for the listener's own avatar (v1.1). */
  readonly placement?: AudioPlacement;
}

/** Sim: an actor sat in a vehicle (seat clunk, Drive layer on the next bar, HUD slides in). */
export interface VehicleEnteredEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly vehicleId: EntityId;
  /** `vehicle.<id>` of game-data (vehicles.json). */
  readonly kindId: string;
  readonly seat: number;
}

/** Sim: an actor left a vehicle. */
export interface VehicleExitedEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly vehicleId: EntityId;
  readonly kindId: string;
}

/**
 * Presentation (v1.1): motion state of an occupied or moving vehicle, driving `vehicle.drive_loop` and
 * `vehicle.work_loop`. Emitted by the gameplay layer at most 10 times per second per vehicle while it moves or
 * works, plus one final event with every level 0 when it stops. The emitter may reuse one payload object (listeners
 * must not keep it, see EventBusListener).
 */
export interface VehicleMotionEvent extends SimEventBase {
  readonly vehicleId: EntityId;
  /** `vehicle.<id>` of game-data (vehicles.json). */
  readonly kindId: string;
  /** Driver slot; `null` for an unoccupied vehicle that is still rolling or working. */
  readonly actorSlot: number | null;
  /** Ground speed over the vehicle's top speed, 0 .. 1 (motor pitch). */
  readonly speed01: number;
  /** Hopper load over capacity, 0 .. 1 (cart rattle). */
  readonly load01: number;
  /** Working-attachment intensity, 0 .. 1 (brush-drum spin of the Trundle). */
  readonly workIntensity01: number;
  /** Where another player's vehicle is relative to the listener; absent for the listener's own vehicle. */
  readonly placement?: AudioPlacement;
}

/** Presentation (v1.0 vehicles): all wheels left the ground. */
export interface VehicleAirborneEvent extends SimEventBase {
  readonly vehicleId: EntityId;
  readonly actorSlot: number | null;
}

/** Presentation (v1.0 vehicles): the vehicle landed. */
export interface VehicleLandedEvent extends SimEventBase {
  readonly vehicleId: EntityId;
  readonly actorSlot: number | null;
  readonly impactMps: number;
  readonly airTimeS: number;
}

/** Sim (v1.0 vehicles): a trick was landed; payout is server-confirmed and capped (economy.json). */
export interface VehicleTrickLandedEvent extends SimEventBase {
  readonly vehicleId: EntityId;
  readonly actorSlot: number;
  /** `trick.<id>` of game-data (economy.json). */
  readonly trickId: string;
  /** Tricks combined in this air (1 = single). */
  readonly combo: number;
  /** Paid after caps; 0 when the cap was reached. */
  readonly lm: Lumens;
}

/** Sim (v1.0 vehicles): the vehicle faceplanted and auto-righted. */
export interface VehicleFaceplantEvent extends SimEventBase {
  readonly vehicleId: EntityId;
  readonly actorSlot: number | null;
}

/** Presentation (v1.0 vehicles): boost started. */
export interface VehicleBoostStartedEvent extends SimEventBase {
  readonly vehicleId: EntityId;
  readonly actorSlot: number;
}

// ---- Exploration, onboarding, achievements ------------------------------------------------------------------------

/** What a found collectible is (collectibles.json). */
export const COLLECTIBLE_KINDS = ["stray_cargo", "survey_point"] as const;
export type CollectibleKind = (typeof COLLECTIBLE_KINDS)[number];

/** Sim: a Stray Cargo crate or Survey Point was found. */
export interface CollectibleFoundEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly kind: CollectibleKind;
  /** Stray Cargo size (`near_parcel`, `parcel`, `crate`, `pallet`) or the `survey.<id>`. */
  readonly id: string;
  readonly lm: Lumens;
  readonly walletLm: Lumens;
}

/** Sim: an Induction step (onboarding.json) was completed. Steps are suggestions; nothing waits on them. */
export interface OnboardingStepCompletedEvent extends SimEventBase {
  /** `onboarding.<id>` of game-data. */
  readonly stepId: string;
  /** Zero-based step index. */
  readonly index: number;
  readonly total: number;
}

/** Sim: an achievement unlocked. */
export interface AchievementUnlockedEvent extends SimEventBase {
  /** `achievement.<id>` of game-data. */
  readonly achievementId: string;
  readonly actorSlot: EventActor;
}

/** Parked (reference mode; progression-and-economy section 24.1, ui-screens U20): a Performance Review was reached. Never emitted in the baseline; nothing may subscribe. */
export interface ReviewReachedEvent extends SimEventBase {
  readonly reviewId: string;
  readonly shinePct: number;
}

// ---- World clock, DOT, compass --------------------------------------------------------------------------------------

/** Parts of the 3,600 s day (audio-direction section 4.1 music sets; sun elevation bands). */
export const DAY_PHASES = ["day", "dusk", "night", "dawn"] as const;
export type DayPhase = (typeof DAY_PHASES)[number];

/** Sim: the sun crossed into another phase (music crossfade, Clip Light prompt, night penalty). */
export interface DaynightChangedEvent extends SimEventBase {
  readonly phase: DayPhase;
  /** Sun elevation at the player in degrees; negative below the horizon. */
  readonly sunElevationDeg: number;
  /** Seconds until the next terminator (sunrise or sunset) at the shift. */
  readonly secondsToTerminator: number;
}

/** DOT message priorities (notification P1 .. P3; ui-screens section 5.2). */
export const DOT_PRIORITIES = ["action", "progress", "ambient"] as const;
export type DotPriority = (typeof DOT_PRIORITIES)[number];

/** Gameplay asks DOT to say something. `textId` indexes the UI text catalog; `params` fill its placeholders. */
export interface DotMessageEvent {
  readonly textId: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly priority: DotPriority;
  /** Induction lines are never dropped from the subtitle queue. */
  readonly keep: boolean;
  /**
   * Syllable count of the resolved line for the chirp-speak (`dot.chirp` `syllables`), 1 .. 32 (v1.1). Absent: the
   * audio module derives a count from `textId`.
   */
  readonly syllables?: number;
}

/** Hard bounds of `DotMessageEvent.syllables` (chirp-speak never runs longer than a few seconds). */
export const DOT_SYLLABLES_MIN = 1;
export const DOT_SYLLABLES_MAX = 32;

/**
 * Presentation (v1.1): play one cue by id, for sounds no gameplay event drives (`ui.click`, `ui.hover`, `ui.toggle`,
 * `ui.panel_open`, `ui.clock_in`, ...). UI and gameplay emit this instead of calling the audio module. `params` is the
 * cue's own parameter shape (`AudioCuePlay`), `{}` for cues without extra parameters.
 */
export type AudioCueEvent = {
  readonly [K in AudioCueId]: { readonly id: K; readonly params: AudioCuePlay<K> };
}[AudioCueId];

/**
 * Presentation (v1.1): the player's audio accessibility settings. Emitted by the UI when a setting changes and once
 * after settings load so the audio module starts in the right state. `monoAudio` sums the master bus to mono;
 * `captions` shows sound captions (the audio module's `onCaption` hook feeds them).
 */
export interface AudioSettingsEvent {
  readonly monoAudio: boolean;
  readonly captions: boolean;
}

/** Sim: the avatar reached the Pilot Fence (soft stop and a DOT message; scope-tiers section 1). */
export interface FenceReachedEvent extends SimEventBase {
  readonly actorSlot: number;
  readonly distanceFromOutpostM: Metres;
}

// ---- Name lists ---------------------------------------------------------------------------------------------------

/** Events produced by the RoomSim (they cross RoomHost.onEvent). All extend SimEventBase. */
export interface SimEventMap {
  "dust.collected": DustCollectedEvent;
  "cell.near_full": CellNearFullEvent;
  "cell.full": CellFullEvent;
  "plot.opened": PlotOpenedEvent;
  "plot.polished": PlotPolishedEvent;
  "shine.milestone": ShineMilestoneEvent;
  "cargo.puck_formed": CargoPuckFormedEvent;
  "cargo.stack_banded": CargoStackBandedEvent;
  "cargo.picked_up": CargoPickedUpEvent;
  "cargo.thrown": CargoThrownEvent;
  "cargo.pour_started": CargoPourStartedEvent;
  "cargo.sold": CargoSoldEvent;
  "railshot.fired": RailshotFiredEvent;
  "purchase.completed": PurchaseCompletedEvent;
  "purchase.rejected": PurchaseRejectedEvent;
  "unlock.granted": UnlockGrantedEvent;
  "requisition.progress": RequisitionProgressEvent;
  "robot.deployed": RobotDeployedEvent;
  "robot.state_changed": RobotStateChangedEvent;
  "vehicle.entered": VehicleEnteredEvent;
  "vehicle.exited": VehicleExitedEvent;
  "vehicle.trick_landed": VehicleTrickLandedEvent;
  "vehicle.faceplant": VehicleFaceplantEvent;
  "collectible.found": CollectibleFoundEvent;
  "onboarding.step_completed": OnboardingStepCompletedEvent;
  "achievement.unlocked": AchievementUnlockedEvent;
  "review.reached": ReviewReachedEvent;
  "daynight.changed": DaynightChangedEvent;
  "fence.reached": FenceReachedEvent;
}

/** Events derived on the client from the predicted sim (never on the wire). */
export interface PresentationEventMap {
  "tool.stroke_contact": ToolStrokeContactEvent;
  "lane.locked": LaneLockedEvent;
  "lane.unlocked": LaneUnlockedEvent;
  "avatar.jumped": AvatarJumpedEvent;
  "avatar.landed": AvatarLandedEvent;
  "avatar.stepped": AvatarSteppedEvent;
  "vehicle.airborne": VehicleAirborneEvent;
  "vehicle.landed": VehicleLandedEvent;
  "vehicle.boost_started": VehicleBoostStartedEvent;
  "vehicle.motion": VehicleMotionEvent;
  "dot.message": DotMessageEvent;
  "audio.cue": AudioCueEvent;
  "audio.settings": AudioSettingsEvent;
}

/** Name of a sim event. */
export type SimEventName = keyof SimEventMap;
/** Name of a presentation event. */
export type PresentationEventName = keyof PresentationEventMap;

/** Every sim event name, for runtime use (RoomHost routing, debug event log). */
export const SIM_EVENT_NAMES = [
  "dust.collected",
  "cell.near_full",
  "cell.full",
  "plot.opened",
  "plot.polished",
  "shine.milestone",
  "cargo.puck_formed",
  "cargo.stack_banded",
  "cargo.picked_up",
  "cargo.thrown",
  "cargo.pour_started",
  "cargo.sold",
  "railshot.fired",
  "purchase.completed",
  "purchase.rejected",
  "unlock.granted",
  "requisition.progress",
  "robot.deployed",
  "robot.state_changed",
  "vehicle.entered",
  "vehicle.exited",
  "vehicle.trick_landed",
  "vehicle.faceplant",
  "collectible.found",
  "onboarding.step_completed",
  "achievement.unlocked",
  "review.reached",
  "daynight.changed",
  "fence.reached",
] as const satisfies readonly SimEventName[];

/** Every presentation event name. */
export const PRESENTATION_EVENT_NAMES = [
  "tool.stroke_contact",
  "lane.locked",
  "lane.unlocked",
  "avatar.jumped",
  "avatar.landed",
  "vehicle.airborne",
  "vehicle.landed",
  "vehicle.boost_started",
  "dot.message",
  "avatar.stepped",
  "vehicle.motion",
  "audio.cue",
  "audio.settings",
] as const satisfies readonly PresentationEventName[];

/**
 * Sim events that no baseline system emits (parked optional progression). They stay in the catalog so names never
 * move; listeners other than the debug log must not rely on them.
 */
export const PARKED_EVENT_NAMES = ["review.reached"] as const satisfies readonly SimEventName[];
