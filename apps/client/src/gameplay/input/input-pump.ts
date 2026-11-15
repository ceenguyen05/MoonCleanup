// Sends exactly one input per sim tick (M1-W3-T05). The worker (Solo) and the server (online) both consume one input
// per tick (sim-host input-queue.ts, netcode.md section 5.1), so the render thread samples at the sim rate from a
// frame-time accumulator: at most `MAX_INPUTS_PER_FRAME` per frame after a hitch (the queue double-steps a backlog).
// One reused command object; the sink copies it synchronously (RoomHost contract: `sendInput` never allocates).
//
// The sink is the Solo LocalRoom host (`roomHost.current`) or, online, the app's OnlineRoom (`sendInput`): the same
// input source drives both, and nothing here imports the net chunk.

import { INPUT_BUTTON_MASK, type SimInputCommand } from "@moon-cleanup/shared";

const TOOL_BUTTONS = INPUT_BUTTON_MASK.toolPrimary | INPUT_BUTTON_MASK.toolSecondary;
import { createInputCommand, type FrameTime, type InputState, type MutableInputCommand } from "./input-state";

/** Where inputs go. `state` (when present) must be "running" for a send (RoomHost); OnlineRoom has none. */
export interface InputSink {
  readonly state?: string;
  sendInput(cmd: SimInputCommand): void;
}

/** Inputs sent in one rendered frame at most (a long hitch drops the rest instead of flooding the queue). */
export const MAX_INPUTS_PER_FRAME = 3;
/**
 * Extra inputs sent when a sink appears or resumes, so the host queue holds one input of slack. Without it, a frame of
 * jitter between the render clock and the worker clock leaves a worker tick with no input: the worker repeats the last
 * one without consuming a seq, and every acked prediction is off by one tick of motion (0.1-0.33 m in the smoke).
 * Costs one tick of authoritative latency, hidden by Solo prediction. The host double-steps only above 4 queued.
 */
export const INPUT_PREFILL = 1;

export class InputPump {
  readonly cmd: MutableInputCommand = createInputCommand();
  /** Inputs handed to a sink. */
  sent = 0;
  /** Inputs sent with a tool button held (strokes requested). */
  toolInputs = 0;
  /** Ticks skipped because no sink was running (paused, booting, no host). */
  idle = 0;
  /** Frame clock (ms) of the newest send (latency instrumentation). */
  lastSendMs = 0;
  private acc = 0;
  private stepS: number;
  private sink: InputSink | null = null;
  /** Called after every send with the command just sent (Solo prediction steps here). */
  listener: ((cmd: SimInputCommand) => void) | null = null;

  constructor(
    private readonly input: InputState,
    tickHz = 20,
  ) {
    this.stepS = 1 / tickHz;
  }

  setTickHz(hz: number): void {
    this.stepS = 1 / hz;
  }

  setSink(sink: InputSink | null): void {
    if (sink === this.sink) return;
    this.sink = sink;
    this.acc = this.stepS * (1 + INPUT_PREFILL);
  }

  get currentSink(): InputSink | null {
    return this.sink;
  }

  /** Seconds since the newest send, as a fraction of a tick (0..1): the Solo predictor's partial-step lead. */
  get phase(): number {
    const p = this.acc / this.stepS;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  /**
   * Per rendered frame. Returns the inputs sent this frame. The first frame after a sink appears sends at once, so a
   * press never waits a whole tick for the accumulator to fill.
   */
  update(t: FrameTime): number {
    const sink = this.sink;
    if (sink === null || (sink.state !== undefined && sink.state !== "running")) {
      this.acc = this.stepS * (1 + INPUT_PREFILL);
      this.idle++;
      return 0;
    }
    this.acc += t.dt;
    let n = 0;

    while (this.acc >= this.stepS && n < MAX_INPUTS_PER_FRAME) {
      this.acc -= this.stepS;
      this.send(sink);
      this.lastSendMs = t.nowMs;
      n++;
    }
    if (this.acc >= this.stepS) this.acc = 0; // drop the backlog of a long hitch
    return n;
  }

  private send(sink: InputSink): void {
    const cmd = this.cmd;
    cmd.seq = (cmd.seq + 1) & 0xffff;
    this.input.sample(cmd);
    sink.sendInput(cmd);
    this.sent++;
    if ((cmd.buttons & TOOL_BUTTONS) !== 0) this.toolInputs++;
    this.listener?.(cmd);
  }
}
