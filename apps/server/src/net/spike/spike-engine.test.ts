import {
  SPIKE_BUTTON_TOOL_PRIMARY,
  SPIKE_FRAME_MAX_BODY_BYTES,
  createSpikeDustHeader,
  createSpikeFrameHeader,
  createSpikeInput,
  readSpikeDustHeader,
  readSpikeFrameHeader,
  writeSpikeInputBody,
  type SpikeInput,
} from "@moon-cleanup/protocol";
import { describe, expect, it } from "vitest";
import { SpikeRoomOptionsSchema } from "./options";
import {
  INBOUND_BYTES_PER_S_LIMIT,
  InputVerdict,
  SPIKE_VIOLATION_LIMIT,
  SpikeEngine,
  type SpikeSink,
} from "./spike-engine";

const SEATS = 6;

function engine(tickHz: 20 | 30, snapshotHz: 10 | 15 | 20 | 30): SpikeEngine {
  // Defaults from the schema; rates set directly so the engine's scheduler is still covered for 30/20, which the join
  // schema now refuses (snapshotHz must divide tickHz).
  return new SpikeEngine({ ...SpikeRoomOptionsSchema.parse({}), tickHz, snapshotHz }, SEATS);
}

interface Recorded {
  frames: number[][];
  dust: number[][];
  frameBytes: number[];
  lastFrame: Uint8Array[];
}

function recorder(): { sink: SpikeSink; rec: Recorded } {
  const rec: Recorded = { frames: [], dust: [], frameBytes: [], lastFrame: [] };
  const sink: SpikeSink = {
    frame(seat, body) {
      (rec.frames[seat] ??= []).push(body.byteLength);
      rec.frameBytes.push(body.byteLength);
      rec.lastFrame[seat] = body.slice();
    },
    dust(seat, body) {
      const h = createSpikeDustHeader();
      expect(readSpikeDustHeader(body, h)).toBe(true);
      (rec.dust[seat] ??= []).push(body.byteLength);
    },
  };
  return { sink, rec };
}

function body(inputs: Partial<SpikeInput>[]): Uint8Array {
  const out = new Uint8Array(32);
  const n = writeSpikeInputBody(
    inputs.map((p) => ({ ...createSpikeInput(), ...p })),
    inputs.length,
    out,
  );
  return out.slice(0, n);
}

describe("SpikeEngine schedule", () => {
  it.each([
    [20, 10, 20, 10],
    [30, 20, 30, 20],
    [30, 15, 30, 15],
    [20, 20, 20, 20],
  ] as const)("%i Hz tick / %i Hz snapshot: %i ticks give %i frames per client", (tick, snap, ticks, frames) => {
    const e = engine(tick, snap);
    e.addSeat(0);
    const { sink, rec } = recorder();
    for (let i = 0; i < ticks * 4; i++) e.step(sink);
    expect(rec.frames[0]?.length).toBe(frames * 4);
    expect(rec.dust[0]?.length).toBe(ticks);
  });

  it("30/20 frames are spaced 1 or 2 ticks apart (never bunched)", () => {
    const e = engine(30, 20);
    e.addSeat(0);
    const frameTicks: number[] = [];
    const sink: SpikeSink = { frame: () => frameTicks.push(e.tick), dust: () => undefined };
    for (let i = 0; i < 60; i++) e.step(sink);
    const gaps = frameTicks.slice(1).map((t, i) => t - (frameTicks[i] ?? 0));
    expect(new Set(gaps)).toEqual(new Set([1, 2]));
  });
});

describe("SpikeEngine inputs (netcode.md sections 5.1 and 11)", () => {
  it("consumes one input per tick, acks it, and drops late duplicates", () => {
    const e = engine(20, 10);
    const seat = e.addSeat(0);
    expect(e.receiveInput(seat, body([{ seq: 10, moveY: 127 }]), 0)).toBe(InputVerdict.Accepted);
    expect(e.receiveInput(seat, body([{ seq: 11, moveY: 127 }]), 1)).toBe(InputVerdict.Accepted);
    expect(e.receiveInput(seat, body([{ seq: 11 }]), 2)).toBe(InputVerdict.Late);
    const { sink } = recorder();
    e.step(sink);
    expect(e.ackSeq(seat)).toBe(10);
    e.step(sink);
    expect(e.ackSeq(seat)).toBe(11);
    // Starvation: substitute and consume seq 12; a late seq 12 is then dropped, 13 is applied.
    e.step(sink);
    expect(e.ackSeq(seat)).toBe(12);
    expect(e.counters.inputsSubstituted).toBe(1);
    e.receiveInput(seat, body([{ seq: 12 }, { seq: 13 }]), 3);
    e.step(sink);
    expect(e.ackSeq(seat)).toBe(13);
    expect(e.counters.inputsLate).toBe(2);
  });

  it("double-steps when the backlog is deeper than 4 and wraps the u16 sequence", () => {
    const e = engine(20, 10);
    const seat = e.addSeat(0);
    for (let i = 0; i < 6; i++) e.receiveInput(seat, body([{ seq: (0xfffd + i) & 0xffff }]), i);
    const { sink } = recorder();
    e.step(sink);
    expect(e.ackSeq(seat)).toBe(0xfffe);
    expect(e.pendingInputs(seat)).toBe(4);
    e.step(sink);
    expect(e.ackSeq(seat)).toBe(0xffff);
    e.step(sink);
    expect(e.ackSeq(seat)).toBe(0);
  });

  it("rate-limits above the burst and refills at 1.5 x tickHz", () => {
    const e = engine(20, 10);
    const seat = e.addSeat(0);
    let accepted = 0;
    let limited = 0;
    for (let i = 0; i < 60; i++) {
      const v = e.receiveInput(seat, body([{ seq: i + 1 }]), 0);
      if (v === InputVerdict.Accepted) accepted++;
      if (v === InputVerdict.RateLimited) limited++;
    }
    expect(accepted).toBe(40);
    expect(limited).toBe(20);
    // 1 s later: 30 tokens.
    let refilled = 0;
    for (let i = 0; i < 40; i++) {
      if (e.receiveInput(seat, body([{ seq: 100 + i }]), 1000) === InputVerdict.Accepted) refilled++;
    }
    expect(refilled).toBe(30);
  });

  it("flags malformed input and closes after 50 violations in 10 s", () => {
    const e = engine(20, 10);
    const seat = e.addSeat(0);
    expect(e.receiveInput(seat, new Uint8Array([3, 1, 2]), 0)).toBe(InputVerdict.Malformed);
    expect(e.receiveInput(seat, new Uint8Array(0), 0)).toBe(InputVerdict.Malformed);
    expect(e.receiveInput(5, body([{ seq: 1 }]), 0)).toBe(InputVerdict.NoSeat);
    let closed = false;
    for (let i = 0; i < SPIKE_VIOLATION_LIMIT; i++) closed ||= e.violation(seat, 100);
    expect(closed).toBe(false);
    expect(e.violation(seat, 200)).toBe(true);
    expect(e.violation(seat, 20_000)).toBe(false);
  });

  it("closes a seat that sends more than 8 KB/s for 5 s", () => {
    const e = engine(20, 10);
    const seat = e.addSeat(0);
    let closedAt = -1;
    for (let s = 0; s < 8 && closedAt < 0; s++) {
      for (let k = 0; k < 10; k++) {
        if (e.noteInbound(seat, INBOUND_BYTES_PER_S_LIMIT / 9, s * 1000 + k)) closedAt = s;
      }
    }
    expect(closedAt).toBe(5);
  });
});

describe("SpikeEngine frames (busy clustered case, netcode.md section 14)", () => {
  it("stays under the 1,000 B cap, acks inputs in the header, and lands near the 6-player budget", () => {
    const e = engine(20, 10);
    const { sink, rec } = recorder();
    for (let s = 0; s < SEATS; s++) e.addSeat(0);
    let seq = 0;
    for (let tick = 0; tick < 400; tick++) {
      seq++;
      for (let s = 0; s < SEATS; s++) {
        e.receiveInput(
          s,
          body([{ seq, moveY: 127, yaw: (tick * 300 + s * 9000) & 0xffff, buttons: SPIKE_BUTTON_TOOL_PRIMARY }]),
          tick * 50,
        );
      }
      e.step(sink);
    }
    expect(Math.max(...rec.frameBytes)).toBeLessThanOrEqual(SPIKE_FRAME_MAX_BODY_BYTES);
    const header = createSpikeFrameHeader();
    expect(readSpikeFrameHeader(rec.lastFrame[0] as Uint8Array, header)).toBe(true);
    expect(header.serverTick).toBe(e.tick);
    expect(header.ackInputSeq).toBe(400);
    // Steady state (skip the join burst): bytes/s per client of FRAME bodies.
    const steady = (rec.frames[0] ?? []).slice(20);
    const perSecond = (steady.reduce((a, b) => a + b, 0) / steady.length) * 10;
    expect(perSecond).toBeGreaterThan(1500);
    expect(perSecond).toBeLessThan(4500);
    expect(e.encoder.spills).toBeLessThan(10);
  });
});
