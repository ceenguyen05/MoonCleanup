// Worker-side input queue of the local player (netcode.md section 5.1 rules, local flavour). Inputs arrive in order
// over the MessagePort; each sim tick takes exactly one:
//   - backlog above INPUT_SEQUENCING.backlogDoubleStep: the oldest is skipped (its button levels are OR-ed into the
//     next so a tap is never lost) and the next one is used: two seqs per tick until the backlog drains;
//   - empty: the last input repeats verbatim (levels kept, so no phantom edge) for up to maxSubstitutions ticks, then
//     a neutral input (no move, no buttons; yaw/pitch/toolParam kept) until inputs flow again;
//   - a seq at or behind the last consumed one (within lateWindow) is dropped as late.
// Structure-of-arrays ring, no allocation after construction.

import { INPUT_SEQUENCING } from "@moon-cleanup/shared";
import type { MutableInput } from "@moon-cleanup/protocol";

const CAPACITY = 32;

export class InputQueue {
  private readonly seq = new Uint16Array(CAPACITY);
  private readonly moveX = new Int8Array(CAPACITY);
  private readonly moveY = new Int8Array(CAPACITY);
  private readonly yaw = new Uint16Array(CAPACITY);
  private readonly pitch = new Int8Array(CAPACITY);
  private readonly buttons = new Uint16Array(CAPACITY);
  private readonly toolParam = new Uint8Array(CAPACITY);
  private head = 0;
  private size = 0;
  private substitutions = 0;
  private carryButtons = 0;
  private consumedAny = false;
  /** Seq of the newest input consumed (the FRAME ack). */
  lastConsumedSeq = 0;
  readonly counters = { consumed: 0, substituted: 0, starved: 0, doubleStepped: 0, droppedLate: 0, droppedFull: 0 };

  get length(): number {
    return this.size;
  }

  /** Queues one decoded input. */
  push(input: MutableInput): void {
    const s = input.seq & 0xffff;
    if (this.isLate(s)) {
      this.counters.droppedLate++;
      return;
    }
    if (this.size === CAPACITY) {
      // Keep the newest: drop the oldest (its taps folded forward like a double step).
      this.carryButtons |= this.buttons[this.head] ?? 0;
      this.head = (this.head + 1) % CAPACITY;
      this.size--;
      this.counters.droppedFull++;
    }
    const k = (this.head + this.size) % CAPACITY;
    this.seq[k] = s;
    this.moveX[k] = input.moveX;
    this.moveY[k] = input.moveY;
    this.yaw[k] = input.yaw;
    this.pitch[k] = input.pitch;
    this.buttons[k] = input.buttons;
    this.toolParam[k] = input.toolParam;
    this.size++;
  }

  /**
   * Writes the input for the coming tick into `out` (which holds the previous tick's input on entry). Returns true
   * when `out` changed from a queued input, false on repeat/neutral.
   */
  nextForTick(out: MutableInput): boolean {
    if (this.size > INPUT_SEQUENCING.backlogDoubleStep) {
      this.carryButtons |= this.buttons[this.head] ?? 0;
      this.head = (this.head + 1) % CAPACITY;
      this.size--;
      this.counters.doubleStepped++;
    }
    if (this.size > 0) {
      const k = this.head;
      out.seq = this.seq[k] ?? 0;
      out.moveX = this.moveX[k] ?? 0;
      out.moveY = this.moveY[k] ?? 0;
      out.yaw = this.yaw[k] ?? 0;
      out.pitch = this.pitch[k] ?? 0;
      out.buttons = (this.buttons[k] ?? 0) | this.carryButtons;
      out.toolParam = this.toolParam[k] ?? 0;
      this.carryButtons = 0;
      this.head = (this.head + 1) % CAPACITY;
      this.size--;
      this.substitutions = 0;
      this.lastConsumedSeq = out.seq;
      this.consumedAny = true;
      this.counters.consumed++;
      return true;
    }
    if (this.substitutions < INPUT_SEQUENCING.maxSubstitutions) {
      this.substitutions++;
      this.counters.substituted++;
      return false;
    }
    out.moveX = 0;
    out.moveY = 0;
    out.buttons = 0;
    this.counters.starved++;
    return false;
  }

  /** Forgets queued inputs and sequencing (worker reboot / restore). */
  reset(): void {
    this.head = 0;
    this.size = 0;
    this.substitutions = 0;
    this.carryButtons = 0;
    this.consumedAny = false;
    this.lastConsumedSeq = 0;
  }

  private isLate(s: number): boolean {
    if (!this.consumedAny) return false;
    const behind = (this.lastConsumedSeq - s + INPUT_SEQUENCING.seqModulus) % INPUT_SEQUENCING.seqModulus;
    return behind < INPUT_SEQUENCING.lateWindow;
  }
}
