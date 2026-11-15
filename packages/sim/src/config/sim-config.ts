// SimConfig: every number the room simulation uses, derived once from the validated game-data bundle.
//
// Every balance and feel value (speeds, jump apex, accelerations, coyote time, landing thresholds, sweep head rules,
// tool width/depth/reach/stroke time, Detailing disc diameter, Dust Cell sizes, day length, prices) comes from
// `packages/game-data` (`movement`, `tool-feel`, `traits`, `tools`, ...), resolved once here (config v1.3). Hot paths
// read `config.feel` / `config.toolFeel`, never the raw bundle.

import {
  DEFAULT_SIM_TICK_HZ,
  DEFAULT_SNAPSHOT_HZ,
  DETAILING_DIAMETER_PARAM,
  DETAILING_TRAIT_ID,
} from "@moon-cleanup/shared";
import type { GameData } from "@moon-cleanup/game-data";
import { cosTurn, sinTurn, TURN_UNITS } from "../math/trig";

/**
 * Movement feel resolved from `movement.json` (game-feel-and-controls.md section 10.1). Field names are the sim's
 * short names; `resolveMovementFeel` maps each to its game-data key.
 */
export interface MovementFeel {
  readonly accelWalkMps2: number;
  readonly accelLopeMps2: number;
  readonly releaseMps2: number;
  readonly reverseMps2: number;
  readonly minStickFrac: number;
  readonly turnRateDegPerS: number;
  readonly slopeSlowStartDeg: number;
  readonly slopeNoTractionDeg: number;
  readonly slopeSlowMinMult: number;
  readonly slideFriction: number;
  readonly jumpCutMult: number;
  readonly coyoteS: number;
  readonly jumpBufferS: number;
  readonly snapSweepM: number;
  readonly snapWalkM: number;
  readonly snapLopeM: number;
  readonly snapOffAfterJumpS: number;
  readonly touchdownGravityMult: number;
  readonly airAccelMps2: number;
  readonly airBrakeMps2: number;
  /** cos / sin of `hopBurstAngleDeg`, computed once at config time. */
  readonly hopCos35: number;
  readonly hopSin35: number;
  readonly hopMaxUpMps: number;
  readonly hopMaxHorizontalMps: number;
  readonly hopMinIntervalS: number;
  readonly landSoftMps: number;
  readonly landHeavyMps: number;
  readonly landFaceplantMps: number;
  readonly landMediumRecoverS: number;
  readonly landMediumAccelMult: number;
  readonly landHeavyRecoverS: number;
  readonly landHeavyAccelMult: number;
  readonly faceplantMoveLockS: number;
  readonly faceplantJumpLockS: number;
  readonly maxSubstepM: number;
  readonly minSubsteps: number;
  readonly maxSubsteps: number;
  readonly slopeProbeM: number;
  readonly capsuleRadiusM: number;
  readonly capsuleHeightM: number;
  readonly holsterSwapS: number;
}

/** Tool feel resolved from `tool-feel.json` (game-feel-and-controls.md section 10.2). */
export interface ToolFeel {
  readonly contactFrac: number;
  readonly pushK: number;
  readonly pushPadM: number;
  readonly sweepVMaxMps: number;
  readonly bootClearM: number;
  readonly headLiftMps: number;
  readonly headDropMps: number;
  readonly sweepTurnRateDegPerS: number;
  readonly detailingSpeedMult: number;
  readonly flickMaxHeightM: number;
  readonly cellNearFullFrac: number;
}

function resolveMovementFeel(m: GameData["movement"]): MovementFeel {
  const angle = (m.hopBurstAngleDeg * Math.PI) / 180;
  return Object.freeze({
    accelWalkMps2: m.groundAccelMps2,
    accelLopeMps2: m.lopeAccelMps2,
    releaseMps2: m.groundDecelMps2,
    reverseMps2: m.groundReverseAccelMps2,
    minStickFrac: m.analogMinSpeedFrac,
    turnRateDegPerS: m.facingTurnDegPerS,
    slopeSlowStartDeg: m.slopeSlowStartDeg,
    slopeNoTractionDeg: m.slopeWalkMaxDeg,
    slopeSlowMinMult: m.slopeUphillMinMult,
    slideFriction: m.slopeSlideFrictionFrac,
    jumpCutMult: m.jumpCutVelocityMult,
    coyoteS: m.coyoteS,
    jumpBufferS: m.jumpBufferS,
    snapSweepM: m.groundSnapSweepM,
    snapWalkM: m.groundSnapWalkM,
    snapLopeM: m.groundSnapLopeM,
    snapOffAfterJumpS: m.groundSnapOffAfterJumpS,
    touchdownGravityMult: m.touchdownGravityMult,
    airAccelMps2: m.airAccelMps2,
    airBrakeMps2: m.airBrakeMps2,
    // Config time only (V8 cos/sin are bit-identical to the former 35 degree literals; asserted by the golden hash).
    hopCos35: Math.cos(angle),
    hopSin35: Math.sin(angle),
    hopMaxUpMps: m.hopMaxUpMps,
    hopMaxHorizontalMps: m.hopMaxHorizontalMps,
    hopMinIntervalS: m.hopMinIntervalS,
    landSoftMps: m.landingSoftMps,
    landHeavyMps: m.landingHeavyMps,
    landFaceplantMps: m.faceplantMps,
    landMediumRecoverS: m.landingMediumRecoveryS,
    landMediumAccelMult: m.landingMediumAccelMult,
    landHeavyRecoverS: m.landingHeavyRecoveryS,
    landHeavyAccelMult: m.landingHeavyAccelMult,
    faceplantMoveLockS: m.faceplantMoveLockS,
    faceplantJumpLockS: m.faceplantJumpLockS,
    maxSubstepM: m.substepMaxDispM,
    minSubsteps: m.substepsMin,
    maxSubsteps: m.substepsMax,
    slopeProbeM: m.slopeProbeM,
    capsuleRadiusM: m.capsuleRadiusM,
    capsuleHeightM: m.capsuleHeightM,
    holsterSwapS: m.holsterSwapS,
  });
}

function resolveToolFeel(t: GameData["tool-feel"]): ToolFeel {
  return Object.freeze({
    contactFrac: t.contactFrac,
    pushK: t.strokeLengthStrideFrac,
    pushPadM: t.strokeLengthPadM,
    sweepVMaxMps: t.strokeLengthMaxSweepMps,
    bootClearM: t.bootClearanceM,
    headLiftMps: t.headSpeedLiftMps,
    headDropMps: t.headSpeedResumeMps,
    sweepTurnRateDegPerS: t.sweepFacingTurnDegPerS,
    detailingSpeedMult: t.detailingMoveMult,
    flickMaxHeightM: t.flickMaxFeetHeightM,
    cellNearFullFrac: t.cellNearFullFrac,
  });
}

/** Day-phase split: the first / last share of the lit half counts as dawn / dusk (sun below about 10 degrees). [R] */
export const TWILIGHT_FRAC_OF_DAYLIGHT = 0.08;

/** One tool row, resolved for the sim. `code` = index in the game-data tool table (stroke `toolCode`). */
export interface ToolTuning {
  readonly code: number;
  readonly id: string;
  readonly tier: number;
  readonly cleans: boolean;
  readonly priceLm: number;
  readonly widthCm: number;
  readonly depthLevels: number;
  readonly reachM: number;
  /** Stroke cycle in milliseconds (integer; sweep phase arithmetic is integer). */
  readonly periodMs: number;
  /** Contact part of the cycle, milliseconds. */
  readonly contactMs: number;
  /** Push length L, metres. */
  readonly pushM: number;
  /** Smallest aim distance, metres. */
  readonly aimMinM: number;
  readonly cellBaseGrams: number;
  readonly traitId: string | null;
  readonly detailing: boolean;
  readonly flick: boolean;
  readonly charge: boolean;
  readonly laneLockBonus: number;
  /** Sweep-walk multiplier on Steep ground (> world.steepSlopeDeg): world.steepSweepMult, or the trait's
   *  `steepSweepMult` (Sure Footing, Charge: 1.0). */
  readonly steepSweepMult: number;
}

/**
 * Dust Puck / Puck Stack rules (progression-and-economy section 5; game-feel-and-controls sections 3.6, 10.1, 10.2).
 * Masses, stack size and loose-puck caps come from `dust-cells.json`; the hand count from `movement.carryUnits`.
 */
export interface CargoTuning {
  readonly puckGrams: number;
  readonly stackMaxGrams: number;
  readonly loosePerPlayer: number;
  readonly loosePerContract: number;
  readonly despawnTicks: number;
  readonly despawnValueFrac: number;
  readonly carryUnits: number;
  /** F / Q held this long is a hold (band into stacks / throw), shorter is a tap. */
  readonly formHoldTicks: number;
  readonly throwMinMps: number;
  readonly throwMaxMps: number;
  readonly throwChargeTicks: number;
  /** cos / sin of the fixed throw launch pitch above the camera heading. */
  readonly throwCos: number;
  readonly throwSin: number;
  readonly skidDecelMps2: number;
  readonly pickupRadiusM: number;
  /** Resting loose pucks closer than this merge into one stack (<= stackMaxGrams). */
  readonly mergeRadiusM: number;
  /** Where a formed / dropped puck lands in front of the feet, metres. */
  readonly dropForwardM: number;
  /** Release height of a throw above the feet, metres. */
  readonly throwHeightM: number;
}

export interface SimConfig {
  readonly tickHz: number;
  readonly snapshotHz: number;
  /** Fixed step, seconds. */
  readonly dt: number;
  /** SIM_TICK_HZ / SNAPSHOT_HZ: ticks per stroke (one stroke per frame interval, WDS section 4.4). */
  readonly frameIntervalTicks: number;
  /** Milliseconds per tick (integer at 20 / 25 / 40 / 50 Hz; sweep phase step). */
  readonly stepMs: number;
  readonly gravityMps2: number;
  readonly moonRadiusM: number;
  readonly walkMps: number;
  readonly lopeMps: number;
  readonly sweepWalkMps: number;
  /** Jump launch speed sqrt(2 g apex). */
  readonly jumpV0Mps: number;
  readonly hopBurstMps: number;
  readonly hopRechargeTicks: number;
  readonly nightPenaltyFrac: number;
  readonly lampPenaltyReliefFrac: number;
  readonly coyoteTicks: number;
  readonly jumpBufferTicks: number;
  readonly snapOffTicks: number;
  readonly hopMinIntervalTicks: number;
  readonly landMediumTicks: number;
  readonly landHeavyTicks: number;
  readonly faceplantMoveTicks: number;
  readonly faceplantJumpTicks: number;
  readonly holsterSwapTicks: number;
  /** cos / sin of the per-tick turn step (not sweeping / sweeping). */
  readonly turnCos: number;
  readonly turnSin: number;
  readonly sweepTurnCos: number;
  readonly sweepTurnSin: number;
  /** Movement feel table (`movement.json`), resolved. */
  readonly feel: MovementFeel;
  /** Tool feel table (`tool-feel.json`), resolved. */
  readonly toolFeel: ToolFeel;
  /** Detailing disc diameter in millimetres (`trait.detailing` `params.diameterM`). */
  readonly detailingDiameterMm: number;
  /** Detailing disc diameter as the stroke `widthCm`. */
  readonly detailingWidthCm: number;
  readonly tanSlopeSlowStart: number;
  readonly tanSlopeNoTraction: number;
  readonly slopeSlowStartRad: number;
  readonly slopeNoTractionRad: number;
  readonly tools: readonly ToolTuning[];
  /** tan of world.steepSlopeDeg: ground steeper than this is Steep for sweep-walk. */
  readonly tanSteepSlope: number;
  readonly cargo: CargoTuning;
  /** Dust Cell capacity multipliers of levels I, II, III. */
  readonly cellLevelMult: readonly number[];
  /** `hopBursts` per Hop Pack level (index 0 = not owned). */
  readonly hopBurstsByLevel: readonly number[];
  readonly dayTicks: number;
  readonly daylightTicks: number;
  readonly twilightTicks: number;
  readonly startPhaseTicks: number;
  readonly dayLengthS: number;
  readonly daylightFrac: number;
  readonly contractStartSunPhase: number;
  readonly startWalletLm: number;
  readonly standardIssueMaxTier: number;
  readonly repeatRequisitionFrac: number;
  readonly repeatRequisitionMinTier: number;
  /** Inspector's Stamp (plot-bonus.json): base Lumens, Stamp Premium multiplier per level, Charge finish multiplier. */
  readonly stampBaseLm: number;
  readonly stampPremiumMult: readonly number[];
  readonly chargeFinishMult: number;
  /** Shine milestones as fractions of the plot count (plot-bonus.json; celebrations only, ascending). */
  readonly shineMilestonesFrac: readonly number[];
  readonly dustKgPerM2PerLevel: number;
  /** Dust level per terrain id. */
  readonly terrainDustLevel: Readonly<Record<string, number>>;
}

export interface SimConfigOptions {
  readonly tickHz?: number;
  readonly snapshotHz?: number;
}

function degToTurn(deg: number): number {
  return (deg * TURN_UNITS) / 360;
}

function turnStep(degPerS: number, dt: number): { cos: number; sin: number } {
  // Config constant from the deterministic sine table (no Math.cos/sin anywhere on a state path).
  const u = degToTurn(degPerS * dt);
  return { cos: cosTurn(u), sin: sinTurn(u) };
}

function tanDeg(deg: number): number {
  const u = degToTurn(deg);
  return sinTurn(u) / cosTurn(u);
}

/** Builds the SimConfig from the validated game-data bundle. */
export function createSimConfig(data: GameData, options: SimConfigOptions = {}): SimConfig {
  const tickHz = options.tickHz ?? DEFAULT_SIM_TICK_HZ;
  const snapshotHz = options.snapshotHz ?? DEFAULT_SNAPSHOT_HZ;
  if (!(Number.isInteger(tickHz) && tickHz > 0 && Number.isInteger(snapshotHz) && snapshotHz > 0)) {
    throw new RangeError("tickHz and snapshotHz must be positive integers");
  }
  if (tickHz % snapshotHz !== 0) throw new RangeError("tickHz must be a multiple of snapshotHz");
  const dt = 1 / tickHz;
  const stepMs = 1000 / tickHz;
  if (!Number.isInteger(stepMs)) throw new RangeError("1000 / tickHz must be an integer (sweep phase is integer ms)");
  const m = data.movement;
  const w = data.world;
  const ticks = (s: number): number => Math.max(1, Math.round(s * tickHz));
  const F = resolveMovementFeel(m);
  const T = resolveToolFeel(data["tool-feel"]);
  const traitsById = new Map(data.traits.traits.map((t) => [t.id, t]));
  const detailingDiameterM = Number(traitsById.get(DETAILING_TRAIT_ID)?.params[DETAILING_DIAMETER_PARAM]);
  if (!(detailingDiameterM > 0)) throw new RangeError("traits: trait.detailing params.diameterM is missing");
  const tools: ToolTuning[] = data.tools.tools.map((tool, code) => {
    const periodMs = Math.round(tool.strokeS * 1000);
    const trait = tool.traitId ? traitsById.get(tool.traitId) : undefined;
    const laneMult = tool.traitId === "trait.lane_lock" ? Number(trait?.params["sweepSpeedMult"] ?? 1) : 1;
    const traitSteep = trait?.params["steepSweepMult"];
    const steepSweepMult = typeof traitSteep === "number" ? traitSteep : w.steepSweepMult;
    const vMax = T.sweepVMaxMps * laneMult;
    const pushM = T.pushK * vMax * tool.strokeS + T.pushPadM;
    return {
      code,
      id: tool.id,
      tier: tool.tier,
      cleans: tool.tier > 0,
      priceLm: tool.priceLm,
      widthCm: Math.max(1, Math.round(tool.widthM * 100)),
      depthLevels: tool.depthLevels,
      reachM: tool.reachM,
      periodMs: Math.max(stepMs, periodMs),
      contactMs: Math.round(periodMs * T.contactFrac),
      pushM,
      aimMinM: Math.min(tool.reachM, pushM + T.bootClearM),
      cellBaseGrams: Math.round(tool.cellBaseKg * 1000),
      traitId: tool.traitId,
      detailing: tool.traitId === "trait.detailing",
      flick: tool.traitId === "trait.flick",
      charge: tool.traitId === "trait.charge",
      laneLockBonus: laneMult,
      steepSweepMult,
    };
  });
  const hopLine = data["suit-gear"].lines.find((l) => l.id === "gear.hop_pack");
  const hopBurstsByLevel = [0];
  for (const level of hopLine?.levels ?? []) {
    let bursts = 0;
    for (const e of level.effects) if ("stat" in e && e.stat === "hopBursts") bursts = e.value;
    hopBurstsByLevel.push(bursts);
  }
  const turn = turnStep(F.turnRateDegPerS, dt);
  const sweepTurn = turnStep(T.sweepTurnRateDegPerS, dt);
  const dayTicks = Math.round(w.dayLengthS * tickHz);
  const daylightTicks = Math.round(dayTicks * w.daylightFrac);
  const deg = Math.PI / 180;
  const terrainDustLevel: Record<string, number> = {};
  for (const t of w.terrainClasses) terrainDustLevel[t.id] = t.dustLevel;
  return Object.freeze({
    tickHz,
    snapshotHz,
    dt,
    frameIntervalTicks: tickHz / snapshotHz,
    stepMs,
    gravityMps2: w.gravityMps2,
    moonRadiusM: w.moonRadiusM,
    walkMps: m.walkMps,
    lopeMps: m.lopeMps,
    sweepWalkMps: m.sweepWalkMps,
    jumpV0Mps: Math.sqrt(2 * w.gravityMps2 * m.jumpApexM),
    hopBurstMps: m.hopBurstMps,
    hopRechargeTicks: ticks(m.hopRechargeS),
    nightPenaltyFrac: m.nightPenaltyFrac,
    lampPenaltyReliefFrac: m.lampPenaltyReliefFrac,
    coyoteTicks: ticks(F.coyoteS),
    jumpBufferTicks: ticks(F.jumpBufferS),
    snapOffTicks: ticks(F.snapOffAfterJumpS),
    hopMinIntervalTicks: ticks(F.hopMinIntervalS),
    landMediumTicks: ticks(F.landMediumRecoverS),
    landHeavyTicks: ticks(F.landHeavyRecoverS),
    faceplantMoveTicks: ticks(F.faceplantMoveLockS),
    faceplantJumpTicks: ticks(F.faceplantJumpLockS),
    holsterSwapTicks: ticks(F.holsterSwapS),
    turnCos: turn.cos,
    turnSin: turn.sin,
    sweepTurnCos: sweepTurn.cos,
    sweepTurnSin: sweepTurn.sin,
    feel: F,
    toolFeel: T,
    detailingDiameterMm: Math.round(detailingDiameterM * 1000),
    detailingWidthCm: Math.round(detailingDiameterM * 100),
    tanSlopeSlowStart: tanDeg(F.slopeSlowStartDeg),
    tanSlopeNoTraction: tanDeg(F.slopeNoTractionDeg),
    slopeSlowStartRad: F.slopeSlowStartDeg * deg,
    slopeNoTractionRad: F.slopeNoTractionDeg * deg,
    tools: Object.freeze(tools),
    tanSteepSlope: tanDeg(w.steepSlopeDeg),
    cargo: resolveCargo(data, tickHz, ticks),
    cellLevelMult: Object.freeze([...data["dust-cells"].levelMult]),
    hopBurstsByLevel: Object.freeze(hopBurstsByLevel),
    dayTicks,
    daylightTicks,
    twilightTicks: Math.round(daylightTicks * TWILIGHT_FRAC_OF_DAYLIGHT),
    startPhaseTicks: Math.round(w.contractStartSunPhase * dayTicks) % dayTicks,
    dayLengthS: w.dayLengthS,
    daylightFrac: w.daylightFrac,
    contractStartSunPhase: w.contractStartSunPhase,
    startWalletLm: data.economy.startWalletLm,
    standardIssueMaxTier: data.economy.standardIssueMaxTier,
    repeatRequisitionFrac: data.economy.repeatRequisitionFrac,
    repeatRequisitionMinTier: data.economy.repeatRequisitionMinTier,
    stampBaseLm: data["plot-bonus"].stampBaseLm,
    stampPremiumMult: Object.freeze([...data["plot-bonus"].stampPremiumMult]),
    chargeFinishMult: data["plot-bonus"].chargeFinishMult,
    shineMilestonesFrac: Object.freeze([...data["plot-bonus"].shineMilestonesFrac].sort((x, y) => x - y)),
    dustKgPerM2PerLevel: w.dustKgPerM2PerLevel,
    terrainDustLevel: Object.freeze(terrainDustLevel),
  });
}

function resolveCargo(data: GameData, tickHz: number, ticks: (s: number) => number): CargoTuning {
  const c = data["dust-cells"];
  const f = data["tool-feel"];
  const pitch = degToTurn(f.throwPitchDeg);
  return Object.freeze({
    puckGrams: Math.round(c.puckKg * 1000),
    stackMaxGrams: Math.round(c.stackMaxKg * 1000),
    loosePerPlayer: c.loosePuckCap.perPlayer,
    loosePerContract: c.loosePuckCap.perContract,
    despawnTicks: Math.round(c.loosePuckCap.despawnS * tickHz),
    despawnValueFrac: c.loosePuckCap.despawnValueFrac,
    carryUnits: Math.max(1, data.movement.carryUnits),
    formHoldTicks: ticks(f.formPuckHoldS),
    throwMinMps: f.throwMinMps,
    throwMaxMps: f.throwMaxMps,
    throwChargeTicks: ticks(f.throwChargeS),
    throwCos: cosTurn(pitch),
    throwSin: sinTurn(pitch),
    skidDecelMps2: f.puckSkidDecelMps2,
    pickupRadiusM: f.pickupRadiusM,
    mergeRadiusM: f.puckMergeRadiusM,
    dropForwardM: f.puckDropForwardM,
    throwHeightM: f.throwHeightM,
  });
}

/** Index of the tool with `id`, or -1. */
export function toolCodeOf(config: SimConfig, id: string): number {
  for (const t of config.tools) if (t.id === id) return t.code;
  return -1;
}
