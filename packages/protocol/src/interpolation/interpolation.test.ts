import { describe, expect, it } from "vitest";
import { FrameReader } from "../codec/frame-reader";
import { ENTITY_KIND_AVATAR, ENTITY_KIND_VEHICLE, FrameView, SlotTable } from "../codec/frame-state";
import { packQuat, type PackedQuat } from "../codec/quantize";
import { ALLOC_ITERATIONS, allocatedBytes } from "../codec/test-util";
import { FakeServer, pongMessage } from "../session/test-helpers";
import { decodePong, type PongTarget } from "../codec/ping";
import { ClockSync } from "./clock-sync";
import {
  DEFAULT_CAPACITY,
  IO_NOW,
  InterpolationBuffer,
  PUSH_OK,
  RESULT_STRIDE,
  R_PX,
  R_QW,
  R_QY,
  R_YAW,
  SAMPLE_BEFORE,
  SAMPLE_EXTRAPOLATING,
  SAMPLE_HOLD,
  SAMPLE_NONE,
  SAMPLE_OK,
  SAMPLE_SIGNAL_LOST,
  avatarActionState,
  avatarFlags,
  avatarPitchCode,
  avatarToolIndex,
  vehicleSteerCode,
} from "./interpolation-buffer";

const PLOTS = 163_842;
const TICK_MS = 50;
const FRAME_TICKS = 2;
const LATENCY = 40;

/** Receives frames like the client: FrameReader + SlotTable, then the buffer. */
class Rig {
  readonly server = new FakeServer();
  readonly reader = new FrameReader();
  readonly table = new SlotTable();
  readonly view = new FrameView();
  readonly buf = new InterpolationBuffer();
  frames = 0;

  receive(msg: Uint8Array, nowMs: number): number {
    const err = this.reader.decode(msg, this.view, this.table, PLOTS);
    if (err === 0) {
      this.buf.io[IO_NOW] = nowMs;
      this.buf.ingest(this.view);
      this.frames++;
    }
    return err;
  }

  update(nowMs: number): void {
    this.buf.io[IO_NOW] = nowMs;
    this.buf.update();
  }
}

/** Entity moving at 10 m/s along x: x = 0.01 * serverTimeMs. */
function xAt(tick: number): number {
  return 0.01 * tick * TICK_MS;
}

/** Runs the client for `untilMs` of local time; frames every 100 ms arrive LATENCY (+ jitter) late. */
function run(rig: Rig, untilMs: number, jitter: (k: number) => number = () => 0, stopFramesAfter = Infinity): number {
  let k = 0;
  let nextFrameTick = 0;
  let lastNow = 0;
  for (let now = 0; now <= untilMs; now += 16) {
    while (nextFrameTick * TICK_MS + LATENCY + jitter(k) <= now && nextFrameTick * TICK_MS <= stopFramesAfter) {
      const e = { slot: 0, x: xAt(nextFrameTick), assign: k === 0 ? 7 : undefined };
      const msg = k === 0 ? rig.server.keyframe(nextFrameTick, [e]) : rig.server.frame(nextFrameTick, [e]);
      rig.receive(msg, nextFrameTick * TICK_MS + LATENCY + jitter(k));
      nextFrameTick += FRAME_TICKS;
      k++;
    }
    rig.update(now);
    lastNow = now;
  }
  return lastNow;
}

describe("ClockSync", () => {
  it("converges to serverTime - localTime and tracks rtt", () => {
    const c = new ClockSync(50);
    // server clock = local + 1000; one-way 30 ms each way
    for (let i = 0; i < 20; i++) {
      const sendLocal = 1000 + i * 2000;
      const serverAtReply = sendLocal + 30 + 1000;
      c.onPong(sendLocal + 60, sendLocal, Math.floor(serverAtReply / 50));
    }
    expect(c.samples).toBe(20);
    expect(c.rttMs).toBeCloseTo(60, 5);
    expect(Math.abs(c.offsetMs - 1000)).toBeLessThan(30);
  });

  it("skips a queued reply, snaps on a jump, rejects stale or future echoes", () => {
    const c = new ClockSync(50);
    for (let i = 0; i < 6; i++) c.onPong(i * 1000 + 60, i * 1000, Math.floor((i * 1000 + 30) / 50));
    const before = c.offsetMs;
    expect(c.onPong(7000 + 600, 7000, Math.floor(7300 / 50))).toBe(false); // rtt 600 > 2 x best
    expect(c.offsetMs).toBe(before);
    expect(c.rejected).toBe(1);
    expect(c.onPong(100, 5000, 0)).toBe(false); // echo from the future
    c.onPong(8060, 8000, Math.floor((8030 + 5000) / 50)); // server restarted / clock jump of 5 s
    expect(Math.abs(c.offsetMs - 5000)).toBeLessThan(60);
  });

  it("is wrap safe for the u32 client clock", () => {
    const c = new ClockSync(50);
    const send = 2 ** 32 - 20;
    expect(c.onPong(send + 60 - 0, (send >>> 0) % 2 ** 32, 100)).toBe(true);
    expect(c.rttMs).toBe(60);
  });

  it("provisional estimate from a frame only until the first PONG", () => {
    const c = new ClockSync(50);
    c.provisionalFromFrame(100, 4000);
    expect(c.hasEstimate).toBe(true);
    expect(c.offsetMs).toBe(100 * 50 - 4000);
    c.onPong(5060, 5000, 120);
    const after = c.offsetMs;
    c.provisionalFromFrame(200, 0);
    expect(c.offsetMs).toBe(after);
  });

  it("PONG test helper round-trips through the real codec", () => {
    const t: PongTarget = { clientTimeMs: 0, serverTick: 0 };
    expect(decodePong(pongMessage(123, 456), t)).toBe(true);
    expect(t).toEqual({ clientTimeMs: 123, serverTick: 456 });
  });
});

describe("InterpolationBuffer: remote avatar", () => {
  it("plays the entity delay behind the newest data, within quantisation error", () => {
    const rig = new Rig();
    run(rig, 3000);
    const b = rig.buf;
    expect(b.started).toBe(true);
    expect(b.targetDelayMs).toBe(150); // 1.5 x 100 ms, no jitter
    expect(b.sample(0)).toBe(SAMPLE_OK);
    const x = b.result[0 * RESULT_STRIDE + R_PX] ?? NaN;
    expect(Math.abs(x - 0.01 * b.renderTimeMs)).toBeLessThan(0.02);
    // rendering ~ (now - latency - delay): lag behind the newest sample is the delay
    const newestT = rig.view.serverTick * TICK_MS;
    expect(newestT - b.renderTimeMs).toBeGreaterThan(50);
    expect(newestT - b.renderTimeMs).toBeLessThan(260);
  });

  it("starts at 200 ms and adapts the target from jitter within 150 .. 250 ms", () => {
    const quiet = new Rig();
    expect(quiet.buf.targetDelayMs).toBe(200);
    run(quiet, 5000);
    expect(quiet.buf.targetDelayMs).toBe(150);
    const noisy = new Rig();
    run(noisy, 8000, (k) => (k % 3 === 0 ? 60 : 0));
    expect(noisy.buf.jitterP95Ms).toBeGreaterThan(30);
    expect(noisy.buf.targetDelayMs).toBeGreaterThan(200);
    expect(noisy.buf.targetDelayMs).toBeLessThanOrEqual(250);
  });

  it("slews: playback rate stays in 0.97 .. 1.03 and the timeline never jumps backwards", () => {
    const rig = new Rig();
    run(rig, 2000);
    const b = rig.buf;
    // offset estimate moves by +300 ms (clock correction): timeline must slew, not jump
    b.clock.offsetMs += 300;
    let prev = b.renderTimeMs;
    let rateMax = 0;
    let rateMin = 10;
    for (let now = 2000; now < 2400; now += 16) {
      rig.update(now);
      expect(b.renderTimeMs).toBeGreaterThanOrEqual(prev);
      prev = b.renderTimeMs;
      rateMax = Math.max(rateMax, b.playbackRate);
      rateMin = Math.min(rateMin, b.playbackRate);
    }
    expect(rateMax).toBeLessThanOrEqual(1.03 + 1e-9);
    expect(rateMin).toBeGreaterThanOrEqual(0.97 - 1e-9);
    expect(b.timelineSnaps).toBe(0);
    // a huge discontinuity (suspended laptop) snaps once
    b.clock.offsetMs += 5000;
    rig.update(2500);
    expect(b.timelineSnaps).toBe(1);
  });

  it("interpolates yaw along the shortest arc across the wrap", () => {
    const rig = new Rig();
    const b = rig.buf;
    rig.receive(rig.server.keyframe(0, [{ slot: 0, x: 0, yawCode: 1000 }]), 40);
    rig.receive(rig.server.frame(2, [{ slot: 0, x: 0, yawCode: 48 }]), 140);
    rig.receive(rig.server.frame(4, [{ slot: 0, x: 0, yawCode: 48 }]), 240);
    b.io[IO_NOW] = 300;
    b.update();
    // place the timeline exactly between the first two samples
    b.renderTimeMs = 50;
    expect(b.sample(0)).toBe(SAMPLE_OK);
    const yaw = b.result[R_YAW] ?? NaN;
    // 1000 -> 48 is +72 codes forward through 0: midpoint code 12 (not ~524)
    expect(Math.abs(Math.sin(yaw) - Math.sin((12 * 2 * Math.PI) / 1024))).toBeLessThan(0.02);
    expect(Math.cos(yaw)).toBeGreaterThan(0.99);
  });

  it("extrapolates up to 250 ms, then holds, then reports signal lost after 1 s", () => {
    const rig = new Rig();
    run(rig, 1000);
    const b = rig.buf;
    const lastTick = rig.view.serverTick;
    const tNew = lastTick * TICK_MS;
    const vel = 0.01; // m per ms
    const at = (over: number): [number, number] => {
      b.renderTimeMs = tNew + over;
      const s = b.sample(0);
      return [s, b.result[R_PX] ?? NaN];
    };
    let [s, x] = at(0);
    expect(s).toBe(SAMPLE_OK);
    expect(x).toBeCloseTo(xAt(lastTick), 2);
    [s, x] = at(100);
    expect(s).toBe(SAMPLE_EXTRAPOLATING);
    expect(x).toBeCloseTo(xAt(lastTick) + vel * 100, 1);
    [s, x] = at(600);
    expect(s).toBe(SAMPLE_HOLD);
    expect(x).toBeCloseTo(xAt(lastTick) + vel * 250, 1);
    [s, x] = at(1500);
    expect(s).toBe(SAMPLE_SIGNAL_LOST);
    expect(x).toBeCloseTo(xAt(lastTick) + vel * 250, 1);
  });

  it("holds the oldest sample when the timeline is before the ring", () => {
    const rig = new Rig();
    run(rig, 600);
    rig.buf.renderTimeMs = -5000;
    expect(rig.buf.sample(0)).toBe(SAMPLE_BEFORE);
  });

  it("wraps its ring: 100 frames into 32 samples, bracket search still right", () => {
    const rig = new Rig();
    run(rig, 12_000);
    const b = rig.buf;
    expect(rig.frames).toBeGreaterThan(100);
    expect(b.sampleCount(0)).toBe(DEFAULT_CAPACITY);
    expect(b.sample(0)).toBe(SAMPLE_OK);
    expect(Math.abs((b.result[R_PX] ?? NaN) - 0.01 * b.renderTimeMs)).toBeLessThan(0.02);
    // rewind into the oldest part of the ring
    const oldest = b.renderTimeMs - 2500;
    b.renderTimeMs = oldest;
    const s = b.sample(0);
    expect([SAMPLE_OK, SAMPLE_BEFORE]).toContain(s);
  });

  it("drops duplicate and out-of-order samples per slot", () => {
    const rig = new Rig();
    const b = rig.buf;
    rig.receive(rig.server.keyframe(10, [{ slot: 0, x: 1 }]), 500);
    rig.receive(rig.server.frame(12, [{ slot: 0, x: 2 }]), 600);
    expect(b.sampleCount(0)).toBe(2);
    // same tick again (duplicate): overwrites the newest sample, count unchanged
    rig.receive(rig.server.frame(12, [{ slot: 0, x: 2.5 }]), 601);
    expect(b.sampleCount(0)).toBe(2);
    expect(b.samplesDuplicate).toBe(1);
    // an older frame (tick 11, reordered): dropped
    rig.receive(rig.server.frame(11, [{ slot: 0, x: 1.5 }]), 602);
    expect(b.sampleCount(0)).toBe(2);
    expect(b.samplesStale).toBe(1);
    expect(PUSH_OK).toBe(0);
  });

  it("a lost frame leaves a gap that interpolation bridges linearly", () => {
    const rig = new Rig();
    const b = rig.buf;
    rig.receive(rig.server.keyframe(0, [{ slot: 0, x: 0 }]), 40);
    rig.receive(rig.server.frame(2, [{ slot: 0, x: 1 }]), 140);
    // frame at tick 4 lost
    rig.receive(rig.server.frame(6, [{ slot: 0, x: 3 }]), 340);
    rig.receive(rig.server.frame(8, [{ slot: 0, x: 4 }]), 440);
    b.io[IO_NOW] = 400;
    b.update();
    b.renderTimeMs = 200; // tick 4 time: halfway between x=1 (100 ms) and x=3 (300 ms)
    expect(b.sample(0)).toBe(SAMPLE_OK);
    expect(b.result[R_PX]).toBeCloseTo(2, 1);
  });

  it("slot changes and REMOVE clear a slot; unknown slots report none", () => {
    const rig = new Rig();
    const b = rig.buf;
    rig.receive(rig.server.keyframe(0, [{ slot: 3, x: 1 }]), 40);
    expect(b.sampleCount(3)).toBe(1);
    expect(b.sample(3)).toBe(SAMPLE_NONE); // timeline not started yet
    b.resetSlot(3);
    expect(b.sampleCount(3)).toBe(0);
    expect(b.sample(9)).toBe(SAMPLE_NONE);
    expect(b.sample(-1)).toBe(SAMPLE_NONE);
    expect(b.sample(999)).toBe(SAMPLE_NONE);
    b.resetAll();
    expect(b.started).toBe(false);
  });

  it("carries the discrete avatar fields of the older bracket sample", () => {
    const rig = new Rig();
    const b = rig.buf;
    rig.receive(rig.server.keyframe(0, [{ slot: 0, x: 0 }]), 40);
    rig.receive(rig.server.frame(2, [{ slot: 0, x: 1 }]), 140);
    b.io[IO_NOW] = 200;
    b.update();
    b.renderTimeMs = 50;
    b.sample(0);
    const w = b.discrete[0] ?? 0;
    expect([avatarActionState(w), avatarToolIndex(w), avatarFlags(w), avatarPitchCode(w)]).toEqual([0, 0, 0, 0]);
    expect(vehicleSteerCode(0x3f << 16)).toBe(-1);
  });

  it("rejects bad constructor options", () => {
    expect(() => new InterpolationBuffer({ capacity: 30 })).toThrow(RangeError);
    expect(() => new InterpolationBuffer({ maxSlots: 0 })).toThrow(RangeError);
  });
});

describe("InterpolationBuffer: vehicle (Hermite + slerp)", () => {
  function quat(angle: number): PackedQuat {
    return packQuat(0, Math.sin(angle / 2), 0, Math.cos(angle / 2), 10, { index: 0, a: 0, b: 0, c: 0 });
  }

  it("follows a constant-acceleration path closely and slerps the orientation", () => {
    const rig = new Rig();
    const b = rig.buf;
    // x = 0.5 * a * t^2 with a = 1e-5 m/ms^2 (10 m/s^2), sampled every 100 ms; yaw turns 10 degrees per frame
    const pos = (tMs: number): number => 0.5 * 1e-5 * tMs * tMs;
    for (let k = 0; k < 12; k++) {
      const tick = k * FRAME_TICKS;
      const t = tick * TICK_MS;
      const o = quat((k * 10 * Math.PI) / 180);
      const e = { slot: 1, kind: ENTITY_KIND_VEHICLE, x: pos(t), orient: o, assign: k === 0 ? 55 : undefined };
      const msg = k === 0 ? rig.server.keyframe(tick, [e]) : rig.server.frame(tick, [e]);
      rig.receive(msg, t + LATENCY);
    }
    b.io[IO_NOW] = 1200;
    b.update();
    let worst = 0;
    for (let t = 300; t < 900; t += 7) {
      b.renderTimeMs = t;
      expect(b.sample(1)).toBe(SAMPLE_OK);
      worst = Math.max(worst, Math.abs((b.result[1 * RESULT_STRIDE + R_PX] ?? NaN) - pos(t)));
    }
    expect(worst).toBeLessThan(0.02); // quantisation 6.25 mm plus Hermite error
    // orientation halfway through frame 3..4 (30 .. 40 degrees about y): 35 degrees
    b.renderTimeMs = 350;
    b.sample(1);
    const qy = b.result[1 * RESULT_STRIDE + R_QY] ?? NaN;
    const qw = b.result[1 * RESULT_STRIDE + R_QW] ?? NaN;
    const angle = 2 * Math.atan2(qy, qw);
    expect((angle * 180) / Math.PI).toBeGreaterThan(34);
    expect((angle * 180) / Math.PI).toBeLessThan(36);
    expect(Math.hypot(qy, qw)).toBeCloseTo(1, 3);
  });
});

describe("InterpolationBuffer: hot path allocation", () => {
  it("ingest, update and sample of 16 entities allocate nothing per call", () => {
    const rig = new Rig();
    const server = rig.server;
    const ents = Array.from({ length: 16 }, (_, i) => ({
      slot: i,
      kind: i % 4 === 0 ? ENTITY_KIND_VEHICLE : ENTITY_KIND_AVATAR,
      x: i,
      orient: { index: 3, a: 0, b: 0, c: 0 },
      assign: i + 1,
    }));
    const key = server.keyframe(0, ents);
    rig.receive(key, 40);
    for (let k = 1; k < 12; k++) {
      rig.receive(
        server.frame(
          k * 2,
          ents.map((e) => ({ ...e, assign: undefined, x: e.x + k * 0.1 })),
        ),
        40 + k * 100,
      );
    }
    const view = rig.view;
    const b = rig.buf;
    let tick = view.serverTick;
    let now = 1300;
    const step = (): void => {
      tick += 2;
      now += 100;
      view.serverTick = tick;
      b.io[IO_NOW] = now;
      b.ingest(view);
      for (let f = 0; f < 6; f++) {
        now += 16;
        b.io[IO_NOW] = now;
        b.update();
        for (let s = 0; s < 16; s++) b.sample(s);
      }
    };
    const bytes = allocatedBytes(step, ALLOC_ITERATIONS / 4, 3);
    // 10,000 iterations x (1 ingest + 6 updates + 96 samples): a single boxed double per call would be >= 16 MB.
    expect(bytes).toBeLessThan(1_500_000);
  });
});
