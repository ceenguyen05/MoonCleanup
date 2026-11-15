// Base-layer and upper-layer state machine (spec 3.5). Reads only sim-derived inputs; the sim always wins.
// Base weights crossfade so they sum to exactly 1 every update (AN-M1-01): the target state gains dt / blend and the
// others share the remainder proportionally.

import { AVATAR_ACTION_STATES } from "@moon-cleanup/shared";
import { LAND_HARD, LAND_NONE, LAND_SOFT, LAND_STUMBLE } from "./low-g";
import { AIR, BLEND } from "./tuning";

/** Base states (index into the base weight array). Priority per spec 3.5 in BASE_PRIORITY. */
export const BASE = {
  locomotion: 0,
  air: 1,
  landPrep: 2,
  landSoft: 3,
  landHard: 4,
  stumble: 5,
  vehicle: 6,
  pour: 7,
  pickup: 8,
  detailing: 9,
  emote: 10,
  onBreak: 11,
} as const;
export const BASE_COUNT = 12;
export const BASE_NAMES = [
  "locomotion",
  "air",
  "air.land_prep",
  "land_soft",
  "land_hard",
  "stumble",
  "vehicle",
  "pour",
  "pickup",
  "detailing",
  "emote",
  "on_break",
] as const;
/** Lower number = higher priority (spec 3.5). */
export const BASE_PRIORITY: readonly number[] = [7, 4, 4, 3, 3, 2, 1, 5, 5, 5, 6, 6];

/** Upper states. */
export const UPPER = {
  empty: 0,
  tool: 1,
  carry: 2,
  handling: 3,
  throwing: 4,
  emote: 5,
  holsterSwap: 6,
} as const;

const A = (name: (typeof AVATAR_ACTION_STATES)[number]): number => AVATAR_ACTION_STATES.indexOf(name);
const ACT_SEATED = A("seated");
const ACT_VEHICLE_ENTER = A("vehicle_enter");
const ACT_POUR_ASSAY = A("pour_assay");
const ACT_POUR_FORMER = A("pour_former");
const ACT_PICKUP = A("pickup");
const ACT_DETAILING = A("trait_detailing");
const ACT_ON_BREAK = A("on_break");
const ACT_EMOTE_1 = A("emote_1");
const ACT_EMOTE_8 = A("emote_8");
const ACT_CARRY_PUCK = A("carry_puck");
const ACT_CARRY_TWO = A("carry_two");
const ACT_WINDUP_PUCK = A("throw_windup_puck");
const ACT_THROW_RELEASE = A("throw_release");
const ACT_FORM_PUCK = A("form_puck");
const ACT_BAND_STACK = A("band_stack");
const ACT_POUR_BACK = A("pour_back");
const ACT_HOLSTER = A("holster_swap");
const ACT_CONSOLE = A("interact_console");
const ACT_PRESS = A("interact_press");

/** Emote slots that are full-body (B) clips; others are upper (U). MVP: 1 Hail (B), 2 Top Marks (U), 3 Brush-Off (B). */
export const EMOTE_IS_BASE: readonly boolean[] = [true, false, true, true, false, false, true, false];

/** Inputs the state machine needs, all sim-derived. */
export interface StateInput {
  readonly grounded: boolean;
  readonly vUp: number;
  /** Time to ground while falling (seconds), Infinity when unknown. */
  readonly timeToGround: number;
  /** Landing class on the airborne -> grounded edge this update (LAND_*), else LAND_NONE. */
  readonly landedClass: number;
  /** Sim reports this update was a jump take-off (vertical launch). */
  readonly jumped: boolean;
  readonly actionState: number;
  /** Planar speed, m/s. */
  readonly speed: number;
  /** Tool class held (0 none). */
  readonly toolClass: number;
}

export class StateMachine {
  base: number = BASE.locomotion;
  upper: number = UPPER.empty;
  /** Blend time (s) the current base / upper state was entered with. */
  baseBlendS = 0;
  upperBlendS = 0;
  baseTime = 0;
  upperTime = 0;
  /** Base layer weights (sum 1). */
  readonly baseWeights = new Float32Array(BASE_COUNT);
  /** Upper override weight w_U. */
  upperWeight = 0;
  /** Debug: base transitions and watchdog resets. */
  transitions = 0;
  stuckResets = 0;
  private notGroundedS = 0;
  private sinceChangeS = 1e9;
  private upperOutS = 0.2;

  constructor() {
    this.baseWeights[BASE.locomotion] = 1;
  }

  /** 0 ms reset (teleport, spawn, LOD wake-up). */
  reset(): void {
    this.baseWeights.fill(0);
    this.baseWeights[BASE.locomotion] = 1;
    this.base = BASE.locomotion;
    this.baseTime = 0;
    this.notGroundedS = 0;
    this.sinceChangeS = 1e9;
  }

  private enter(state: number, blendS: number, force: boolean): void {
    if (state === this.base) return;
    const prio = BASE_PRIORITY[state]!;
    if (!force && prio > 3 && this.sinceChangeS < BLEND.minStateIntervalS) return;
    this.base = state;
    this.baseBlendS = blendS;
    this.baseTime = 0;
    this.sinceChangeS = 0;
    this.transitions++;
  }

  /** Decides the base state for this update. */
  private decideBase(i: StateInput): void {
    const dt = this.dt;
    const act = i.actionState;
    this.notGroundedS = i.grounded ? 0 : this.notGroundedS + dt;
    // 1) vehicle: the sim forces it.
    if (act === ACT_SEATED || act === ACT_VEHICLE_ENTER) {
      this.enter(BASE.vehicle, BLEND.vehicleIn, true);
      return;
    }
    if (this.base === BASE.vehicle) this.enter(BASE.locomotion, BLEND.vehicleOut, true);
    // 2/3) landings on the grounded edge.
    if (i.grounded && i.landedClass !== LAND_NONE) {
      if (i.landedClass === LAND_STUMBLE) this.enter(BASE.stumble, BLEND.stumbleIn, true);
      else if (i.landedClass === LAND_HARD) this.enter(BASE.landHard, BLEND.landHardIn, true);
      else if (i.landedClass === LAND_SOFT) this.enter(BASE.landSoft, BLEND.landSoftIn, true);
      return;
    }
    // 4) air: jump immediately, walk-off after the debounce.
    if (!i.grounded && (i.jumped || this.notGroundedS >= AIR.airDebounceS || this.isAir())) {
      const prep = i.vUp < 0 && i.timeToGround < AIR.landPrepS;
      if (prep) {
        const b = i.timeToGround > AIR.landPrepMinBlendS ? i.timeToGround : AIR.landPrepMinBlendS;
        this.enter(BASE.landPrep, b, true);
      } else if (this.base !== BASE.landPrep) {
        this.enter(BASE.air, i.jumped ? BLEND.takeoffIn : BLEND.walkOffIn, true);
      }
      return;
    }
    if (i.grounded && this.isAir()) {
      // Landed below the clip threshold: straight back to locomotion.
      this.enter(BASE.locomotion, BLEND.airToLocoOut, true);
      return;
    }
    // Timed landing states: hold until the clip ends or a permitted interrupt.
    if (this.base === BASE.landSoft || this.base === BASE.landHard || this.base === BASE.stumble) {
      const len =
        this.base === BASE.landSoft ? BLEND.landSoftS : this.base === BASE.landHard ? BLEND.landHardS : BLEND.stumbleS;
      const moveAfter =
        this.base === BASE.landSoft
          ? BLEND.landSoftMoveS
          : this.base === BASE.landHard
            ? BLEND.landHardMoveS
            : BLEND.stumbleMoveS;
      const out =
        this.base === BASE.landSoft
          ? BLEND.landSoftOut
          : this.base === BASE.landHard
            ? BLEND.landHardOut
            : BLEND.stumbleOut;
      if (this.baseTime >= len || (i.speed > 0.5 && this.baseTime >= moveAfter)) {
        this.enter(BASE.locomotion, out, true);
      }
      return;
    }
    // Watchdog (spec 3.5 rule 4): one-shot clip states (emote <= 4 s, pickup 0.55 s) never outlive their longest clip
    // by more than 2 s even if the sim's action state sticks. Sim-held states (pour, on_break, vehicle) follow the sim.
    if ((this.base === BASE.emote || this.base === BASE.pickup) && this.baseTime > 4 + BLEND.watchdogS) {
      this.stuckResets++;
      this.enter(BASE.locomotion, BLEND.airToLocoOut, true);
      return;
    }
    // 5) action stances.
    if (act === ACT_POUR_ASSAY || act === ACT_POUR_FORMER) {
      this.enter(BASE.pour, BLEND.pourIn, false);
      return;
    }
    if (act === ACT_PICKUP) {
      this.enter(BASE.pickup, BLEND.pickupIn, false);
      return;
    }
    if (act === ACT_DETAILING) {
      this.enter(BASE.detailing, BLEND.detailingIn, false);
      return;
    }
    // 6) emotes (base) and On Break.
    if (act >= ACT_EMOTE_1 && act <= ACT_EMOTE_8 && EMOTE_IS_BASE[act - ACT_EMOTE_1] === true) {
      this.enter(BASE.emote, BLEND.emoteIn, false);
      return;
    }
    if (act === ACT_ON_BREAK) {
      this.enter(BASE.onBreak, BLEND.onBreakIn, false);
      return;
    }
    // 7) default.
    const out =
      this.base === BASE.pour
        ? BLEND.pourOut
        : this.base === BASE.pickup
          ? BLEND.pickupOut
          : this.base === BASE.detailing
            ? BLEND.detailingOut
            : this.base === BASE.emote
              ? BLEND.emoteOut
              : this.base === BASE.onBreak
                ? BLEND.onBreakOut
                : BLEND.airToLocoOut;
    if (this.base !== BASE.locomotion) this.enter(BASE.locomotion, out, false);
  }

  isAir(): boolean {
    return this.base === BASE.air || this.base === BASE.landPrep;
  }

  private decideUpper(i: StateInput): void {
    const act = i.actionState;
    let u: number = UPPER.empty;
    let inS = 0.2;
    let outS = 0.2;
    if (act === ACT_HOLSTER) u = UPPER.holsterSwap;
    else if (act >= ACT_WINDUP_PUCK && act <= ACT_THROW_RELEASE) {
      u = UPPER.throwing;
      inS = 0.08;
    } else if (act >= ACT_CARRY_PUCK && act <= ACT_CARRY_TWO) {
      u = UPPER.carry;
      inS = 0.15;
      outS = 0.15;
    } else if (
      act === ACT_POUR_ASSAY ||
      act === ACT_POUR_FORMER ||
      act === ACT_FORM_PUCK ||
      act === ACT_BAND_STACK ||
      act === ACT_POUR_BACK ||
      act === ACT_CONSOLE ||
      act === ACT_PRESS
    ) {
      u = UPPER.handling;
      inS = 0.15;
      outS = 0.2;
    } else if (act >= ACT_EMOTE_1 && act <= ACT_EMOTE_8 && EMOTE_IS_BASE[act - ACT_EMOTE_1] !== true) {
      u = UPPER.emote;
    } else if (i.toolClass !== 0) u = UPPER.tool;
    if (u !== this.upper) {
      this.upper = u;
      this.upperTime = 0;
      this.upperBlendS = u === UPPER.empty ? this.upperOutS : inS;
    }
    this.upperOutS = outS;
  }

  /** Step length for `step` (field, so no double crosses a call; AN-M1-09). */
  dt = 0;
  private readonly cfIO = new Float64Array(2);

  /** Wrapper for tests / cold callers. */
  update(i: StateInput, dt: number): void {
    this.dt = dt;
    this.step(i);
  }

  step(i: StateInput): void {
    const dt = this.dt;
    this.sinceChangeS += dt;
    this.baseTime += dt;
    this.upperTime += dt;
    this.decideBase(i);
    this.decideUpper(i);
    this.cfIO[0] = this.baseBlendS;
    this.cfIO[1] = dt;
    crossfadeCore(this.baseWeights, this.base, this.cfIO);
    const target = this.upper === UPPER.empty ? 0 : 1;
    const b = this.upperBlendS;
    if (b <= 0) this.upperWeight = target;
    else {
      const step = dt / b;
      const w = this.upperWeight;
      this.upperWeight = w < target ? Math.min(target, w + step) : Math.max(target, w - step);
    }
  }
}

/**
 * Crossfades `weights` toward one-hot `k` over `blendS`; the sum stays exactly 1 (re-normalised every call).
 * blendS <= 0 snaps (0 ms transitions only: teleport, spawn, LOD wake-up).
 */
export function crossfadeTo(weights: Float32Array, k: number, blendS: number, dt: number): void {
  cfScratch[0] = blendS;
  cfScratch[1] = dt;
  crossfadeCore(weights, k, cfScratch);
}

const cfScratch = new Float64Array(2);

/** Allocation-free core of `crossfadeTo`: p[0] = blendS, p[1] = dt. */
export function crossfadeCore(weights: Float32Array, k: number, p: Float64Array): void {
  const blendS = p[0]!;
  const dt = p[1]!;
  const n = weights.length;
  let wk = weights[k]!;
  wk = blendS <= 0 ? 1 : Math.min(1, wk + dt / blendS);
  let others = 0;
  for (let j = 0; j < n; j++) if (j !== k) others += weights[j]!;
  const rest = 1 - wk;
  if (others > 1e-9) {
    const s = rest / others;
    for (let j = 0; j < n; j++) if (j !== k) weights[j] = weights[j]! * s;
  } else wk = 1;
  weights[k] = wk;
  if (wk >= 1) for (let j = 0; j < n; j++) if (j !== k) weights[j] = 0;
}
