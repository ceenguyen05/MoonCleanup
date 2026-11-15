// Tool layer (spec 2.6, 3.5 upper table, 4.6 inputs). The sweep is phase-locked to the sim: packages/sim tool.ts
// drives the head with a cycle of `periodS` that has a contact (push) segment of `contactFrac` (smoothstep eased,
// head from d - L to d) and a lift (return) segment. The tool clip's normalised time equals that phase; the body
// (torso twist / reach curve) samples the same curve `anticipationS` ahead, so shoulders and hips lead each reversal
// by ~100 ms while the head stays on the sim point; a decaying overshoot sells the follow-through.
// Hot path: set the input fields, call `step()` (no double crosses a call; AN-M1-09).

import { TOOL, TOOL_CLASS, TOOL_TWIST_RAD } from "./tuning";

/** io[0] = phase u, io[1] = contactFrac -> io[2] = normalised reach in [0, 1] (mirrors packages/sim headPhase). */
export function strokeCurveIO(io: Float64Array): void {
  const u = io[0]!;
  const cf = io[1]!;
  const p = u - Math.floor(u);
  let t: number;
  let up: boolean;
  if (p < cf) {
    t = cf > 0 ? p / cf : 1;
    up = true;
  } else {
    const lift = 1 - cf;
    t = lift > 0 ? (p - cf) / lift : 1;
    up = false;
  }
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const s = t * t * (3 - 2 * t);
  io[2] = up ? s : 1 - s;
}

const curveScratch = new Float64Array(3);

/** The sim head curve as a normalised reach (0 = pulled back, 1 = full reach) at cycle phase `u`. Wrapper. */
export function strokeCurve(u: number, contactFrac: number): number {
  curveScratch[0] = u;
  curveScratch[1] = contactFrac;
  strokeCurveIO(curveScratch);
  return curveScratch[2]!;
}

/** Did phase move across `mark` going from `prev` to `cur` (wrapping forward through 1 -> 0)? Cold helper. */
export function crossed(prev: number, cur: number, mark: number): boolean {
  if (cur >= prev) return prev < mark && mark <= cur;
  return mark > prev || mark <= cur;
}

/** Per-avatar tool layer state and output. */
export class ToolLayer {
  // ---- inputs (set before `step`) ----
  /** TOOL_CLASS code of the held tool (0 = empty hands). */
  inClass = 0;
  /** The sim's sweeping flag (tool down). */
  inActive = false;
  /** Sim cycle phase in [0, 1) at render time. */
  inPhase = 0;
  /** Sim cycle period, seconds. */
  inPeriodS = 0.9;
  inContactFrac: number = TOOL.defaultContactFrac;
  /** The sim's head-in-contact flag. */
  inContact = false;
  dt = 0;
  // ---- outputs ----
  /** Upper-override weight w_U of the tool hold (0..1). */
  holdWeight = 0;
  /** Additive sweep weight (0..1). */
  sweepWeight = 0;
  /** Sweep clip normalised time (= sim phase). */
  clipPhase = 0;
  /** Body reach curve sampled ahead by the anticipation lead, 0..1. */
  bodyReach = 0;
  /** Torso twist, radians (class amplitude x lead curve + follow-through). */
  twist = 0;
  /** Cosmetic palm wobble offsets (local x right, z forward), metres. */
  wobbleX = 0;
  wobbleZ = 0;
  /** Edges for this update: reversal crossed (+1 at full reach, -1 at pulled back, 0 none); contact edge. */
  turn = 0;
  contactEdge = 0;
  toolClass = 0;

  private prevPhase = 0;
  private hasPhase = false;
  private ftT = 1e9;
  private ftSign = 0;
  private wobbleT = 0;
  private wasActive = false;
  private wasContact = false;
  private readonly io = new Float64Array(3);

  reset(): void {
    this.holdWeight = 0;
    this.sweepWeight = 0;
    this.hasPhase = false;
    this.ftT = 1e9;
    this.wasActive = false;
    this.wasContact = false;
    this.twist = 0;
  }

  /** Convenience wrapper (tests / cold callers): sets the inputs and steps. */
  update(
    toolClass: number,
    active: boolean,
    phase: number,
    periodS: number,
    contactFrac: number,
    inContact: boolean,
    dt: number,
  ): void {
    this.inClass = toolClass;
    this.inActive = active;
    this.inPhase = phase;
    this.inPeriodS = periodS;
    this.inContactFrac = contactFrac;
    this.inContact = inContact;
    this.dt = dt;
    this.step();
  }

  step(): void {
    const dt = this.dt;
    const toolClass = this.inClass;
    const cf = this.inContactFrac;
    this.turn = 0;
    this.contactEdge = 0;
    if (toolClass !== this.toolClass) {
      this.toolClass = toolClass;
      this.hasPhase = false;
    }
    const hasTool = toolClass !== TOOL_CLASS.none;
    // Hold (w_U) and sweep weight ramps.
    let h = this.holdWeight;
    if (hasTool) h = h + dt / TOOL.holdInS >= 1 ? 1 : h + dt / TOOL.holdInS;
    else h = h - dt / TOOL.holdOutS <= 0 ? 0 : h - dt / TOOL.holdOutS;
    this.holdWeight = h;
    const sweeping = hasTool && this.inActive;
    let sw = this.sweepWeight;
    if (sweeping) sw = sw + dt / TOOL.sweepInS >= 1 ? 1 : sw + dt / TOOL.sweepInS;
    else sw = sw - dt / TOOL.sweepOutS <= 0 ? 0 : sw - dt / TOOL.sweepOutS;
    this.sweepWeight = sw;
    if (sweeping !== this.wasActive) this.contactEdge = sweeping ? 1 : -1;
    this.wasActive = sweeping;
    const inContact = this.inContact;
    if (inContact !== this.wasContact && sweeping && this.contactEdge === 0) this.contactEdge = inContact ? 1 : -1;
    this.wasContact = inContact;

    const p = this.inPhase - Math.floor(this.inPhase);
    this.clipPhase = p;
    const period = this.inPeriodS;
    const io = this.io;
    io[0] = p + (period > 1e-6 ? TOOL.anticipationS / period : 0);
    io[1] = cf;
    strokeCurveIO(io);
    const reach = io[2]!;
    this.bodyReach = reach;
    if (sweeping && this.hasPhase) {
      const prev = this.prevPhase;
      const wrapped = p < prev;
      const crossContact = wrapped ? cf > prev || cf <= p : prev < cf && cf <= p;
      if (crossContact) {
        this.turn = 1;
        this.ftSign = 1;
        this.ftT = 0;
      } else if (wrapped) {
        this.turn = -1;
        this.ftSign = -1;
        this.ftT = 0;
      }
    }
    this.prevPhase = p;
    this.hasPhase = sweeping;
    // Follow-through: overshoot past the reversal, sin-shaped, decaying over followThroughS.
    this.ftT += dt;
    let ft = 0;
    if (this.ftT < TOOL.followThroughS) {
      const u = this.ftT / TOOL.followThroughS;
      ft = this.ftSign * TOOL.followThroughRad * Math.sin(Math.PI * u) * (1 - u);
    }
    const amp = TOOL_TWIST_RAD[toolClass] ?? 0;
    this.twist = (amp * (2 * reach - 1) + ft) * sw;
    // Palm: small fussy circles round the sim head point.
    if (toolClass === TOOL_CLASS.palm && sw > 0) {
      this.wobbleT += dt;
      const a = 2 * Math.PI * TOOL.palmWobbleHz * this.wobbleT;
      this.wobbleX = Math.cos(a) * TOOL.palmWobbleM * sw;
      this.wobbleZ = Math.sin(a) * TOOL.palmWobbleM * sw;
    } else {
      this.wobbleT = 0;
      this.wobbleX = 0;
      this.wobbleZ = 0;
    }
  }
}
