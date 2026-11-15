// Per-seat input sequencer (netcode.md section 5.1, "never double-apply"). Preallocated; no allocation per input.
//
// - Buffer: inputs keyed by `seq` up to INPUT_AHEAD_MAX ahead of `lastConsumedSeq`; duplicates of a buffered seq and
//   late inputs (`seq <= lastConsumedSeq`, mod 2^16) are dropped and counted as `late` (not a violation).
// - One seq per tick: `consume` takes `expectedSeq = lastConsumedSeq + 1` when buffered.
// - Substitution: a missing `expectedSeq` repeats the last input verbatim (levels kept, so no phantom edge, see
//   shared sim/input) and CONSUMES the seq, for up to SUBSTITUTE_MAX ticks in a row.
// - Starvation: after that, a neutral input (no move, no buttons) is applied WITHOUT consuming seqs until input resumes.
// - Not implemented (gap, see report): the "backlog > 4 consumes two seqs as two sub-steps" rule. RoomSim.step advances
//   every actor at once, so a per-actor double step needs a sim API; until then a backlog drains one seq per tick and
//   the client's clock steering (inputBufferDepth in FRAME) pulls it back.

import type { MutableInput } from "@moon-cleanup/protocol";

/** Largest lead of a buffered seq over `lastConsumedSeq` (section 5.1: "<= 16 ahead"). */
export const INPUT_AHEAD_MAX = 16;
/** Consecutive substituted ticks before neutral input (section 5.1). */
export const SUBSTITUTE_MAX = 3;
const RING = 32; // power of two > INPUT_AHEAD_MAX
const MASK = RING - 1;

export const InputAccept = {
  Buffered: 0,
  Late: 1,
  TooFarAhead: 2,
} as const;
export type InputAccept = (typeof InputAccept)[keyof typeof InputAccept];

/** What `consume` applied this tick. */
export const ConsumeKind = {
  Real: 0,
  Substituted: 1,
  Neutral: 2,
  /** No input has ever arrived for this seat: nothing applied. */
  None: 3,
} as const;
export type ConsumeKind = (typeof ConsumeKind)[keyof typeof ConsumeKind];

function newInput(): MutableInput {
  return { seq: 0, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 0 };
}

function copy(src: MutableInput, dst: MutableInput): void {
  dst.seq = src.seq;
  dst.moveX = src.moveX;
  dst.moveY = src.moveY;
  dst.yaw = src.yaw;
  dst.pitch = src.pitch;
  dst.buttons = src.buttons;
  dst.toolParam = src.toolParam;
}

export class InputSequencer {
  /** Seq of the last consumed (or substituted) input; the FRAME `ackInputSeq`. */
  lastConsumedSeq = 0;
  /** True once the first input arrived (it defines the sequence start). */
  started = false;
  /** The input `consume` filled last (what the sim got). */
  readonly current: MutableInput = newInput();
  readonly counters = { late: 0, tooFarAhead: 0, substituted: 0, neutral: 0, consumed: 0 };
  private readonly ring: MutableInput[] = Array.from({ length: RING }, newInput);
  private readonly has = new Uint8Array(RING);
  private substitutions = 0;
  private buffered = 0;

  reset(): void {
    this.started = false;
    this.lastConsumedSeq = 0;
    this.has.fill(0);
    this.buffered = 0;
    this.substitutions = 0;
    const c = this.current;
    c.seq = c.moveX = c.moveY = c.yaw = c.pitch = c.buttons = c.toolParam = 0;
  }

  /** Inputs buffered ahead of `lastConsumedSeq` (the FRAME `inputBufferDepth`). */
  get depth(): number {
    return this.buffered;
  }

  /** Buffers one decoded input. Never throws. */
  push(input: MutableInput): InputAccept {
    const seq = input.seq & 0xffff;
    if (!this.started) {
      this.started = true;
      this.lastConsumedSeq = (seq - 1) & 0xffff;
    }
    const lead = (seq - this.lastConsumedSeq) & 0xffff;
    if (lead === 0 || lead > 0x8000) {
      this.counters.late++;
      return InputAccept.Late;
    }
    if (lead > INPUT_AHEAD_MAX && this.substitutions >= SUBSTITUTE_MAX && this.buffered === 0) {
      // Starved seat (hidden tab, long stall) resuming far ahead: restart the sequence at this input.
      this.lastConsumedSeq = (seq - 1) & 0xffff;
    } else if (lead > INPUT_AHEAD_MAX) {
      this.counters.tooFarAhead++;
      return InputAccept.TooFarAhead;
    }
    const k = seq & MASK;
    if (this.has[k] === 1 && this.ring[k]!.seq === seq) {
      this.counters.late++; // duplicate
      return InputAccept.Late;
    }
    copy(input, this.ring[k]!);
    this.ring[k]!.seq = seq;
    if (this.has[k] !== 1) this.buffered++;
    this.has[k] = 1;
    return InputAccept.Buffered;
  }

  /** Picks this tick's input into `current` by the section 5.1 rules. */
  consume(): ConsumeKind {
    if (!this.started) return ConsumeKind.None;
    const expected = (this.lastConsumedSeq + 1) & 0xffff;
    const k = expected & MASK;
    const c = this.current;
    if (this.has[k] === 1 && this.ring[k]!.seq === expected) {
      copy(this.ring[k]!, c);
      this.has[k] = 0;
      this.buffered--;
      this.lastConsumedSeq = expected;
      this.substitutions = 0;
      this.counters.consumed++;
      return ConsumeKind.Real;
    }
    if (this.substitutions < SUBSTITUTE_MAX) {
      // Repeat the last input verbatim, consuming the seq: a late arrival of `expected` is then dropped as late.
      this.substitutions++;
      c.seq = expected;
      this.lastConsumedSeq = expected;
      // A stale slot that holds an older seq for this ring index is dead now.
      if (this.has[k] === 1 && this.ring[k]!.seq !== expected && ((this.ring[k]!.seq - expected) & 0xffff) > 0x8000) {
        this.has[k] = 0;
        this.buffered--;
      }
      this.counters.substituted++;
      return ConsumeKind.Substituted;
    }
    c.moveX = 0;
    c.moveY = 0;
    c.buttons = 0;
    this.counters.neutral++;
    return ConsumeKind.Neutral;
  }
}
