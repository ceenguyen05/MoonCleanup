import { describe, expect, it } from "vitest";
import { createRng } from "../rng";
import { signed16, steer, targetGap, type SteerResult } from "./steering";

describe("steer", () => {
  const out: SteerResult = { count: 1, resyncSeq: -1 };
  it("sends one input before any frame arrives", () => {
    expect(steer({ seq: 5, ack: -1, rttMs: 100, tickMs: 50 }, out)).toEqual({ count: 1, resyncSeq: -1 });
  });
  it("resyncs when behind or level with the server, including across u16 wrap", () => {
    // Jump only to ack + 1 and send two: a bigger jump adds no queued inputs (the old self-inflicted resync loop).
    expect(steer({ seq: 10, ack: 12, rttMs: 100, tickMs: 50 }, out)).toEqual({ count: 2, resyncSeq: 13 });
    expect(steer({ seq: 3, ack: 0xfffe, rttMs: 100, tickMs: 50 }, out).count).toBeGreaterThan(0);
    expect(steer({ seq: 0xfff0, ack: 0xfff0, rttMs: 100, tickMs: 50 }, out).resyncSeq).toBe(0xfff1);
    expect(steer({ seq: 0xffff, ack: 0xffff, rttMs: 100, tickMs: 50 }, out).resyncSeq).toBe(0);
  });
  it("catches up with two inputs when thin and skips when fat", () => {
    const target = targetGap(100, 50);
    expect(steer({ seq: 100 + target - 3, ack: 100, rttMs: 100, tickMs: 50 }, out)).toMatchObject({ count: 2 });
    expect(steer({ seq: 100 + target + 6, ack: 100, rttMs: 100, tickMs: 50 }, out)).toMatchObject({ count: 0 });
    expect(steer({ seq: 100 + target, ack: 100, rttMs: 100, tickMs: 50 }, out)).toMatchObject({ count: 1 });
  });
});

// Clean zero-latency loopback with the bot timer a fixed phase after the server timer. The server consumes the next
// queued input FIFO (any seq ahead of the last consumed), substituting when the queue is empty. Fake clock: ms ints.
describe("clean loopback resync trigger", () => {
  const tickMs = 50;
  /** The pre-fix rule: hard resync jumped the seq to ack + target, which queued nothing. */
  function oldSteer(input: { seq: number; ack: number; rttMs: number }, o: SteerResult): SteerResult {
    o.count = 1;
    o.resyncSeq = -1;
    if (input.ack < 0) return o;
    const target = targetGap(input.rttMs, tickMs);
    const gap = signed16(input.seq - input.ack);
    if (gap <= 0 || gap > 0x2000) {
      o.resyncSeq = (input.ack + target) & 0xffff;
      return o;
    }
    if (gap > target + 3) o.count = 0;
    else if (gap < target - 1) o.count = 2;
    return o;
  }

  function run(rule: "old" | "new", frameLag: number): { resyncs: number; ticks: number; avgDepth: number } {
    const ticks = 2000;
    const queue: number[] = [];
    let consumed = 0;
    let seq = 0;
    let ack = -1;
    let resyncs = 0;
    let depthSum = 0;
    const res: SteerResult = { count: 1, resyncSeq: -1 };
    const acks: number[] = [];
    // Per iteration: server tick, then the bot tick that follows it. `frameLag` = whole ticks by which the bot's
    // newest FRAME trails the server (timer phase / jitter makes a frame land just after the bot tick: lag 1).
    for (let k = 0; k < ticks; k++) {
      // Server tick: consume next valid queued seq (else substitute), publish ack immediately.
      let next = -1;
      while (queue.length && next < 0) {
        const s = queue.shift() as number;
        const diff = (s - consumed) & 0xffff;
        if (diff !== 0 && diff <= 1024) next = s;
      }
      consumed = next >= 0 ? next : (consumed + 1) & 0xffff;
      acks.push(consumed);
      ack = k >= frameLag ? (acks[k - frameLag] as number) : -1;
      depthSum += queue.length;
      if (rule === "old") oldSteer({ seq, ack, rttMs: 0 }, res);
      else steer({ seq, ack, rttMs: 0, tickMs }, res);
      if (res.resyncSeq >= 0) {
        seq = (res.resyncSeq - 1) & 0xffff;
        resyncs++;
      }
      for (let c = 0; c < res.count; c++) {
        seq = (seq + 1) & 0xffff;
        queue.push(seq);
      }
    }
    return { resyncs, ticks, avgDepth: depthSum / ticks };
  }

  it("reproduces the old trigger: resync on a large share of frames and an empty server buffer", () => {
    // Lag 0 = the bot tick lands right after the server tick and sees the frame it just produced (the unlucky phase).
    const r = run("old", 0);
    expect(r.resyncs).toBeGreaterThan(r.ticks * 0.3);
    expect(r.avgDepth).toBeLessThan(0.5);
  });
  it("fixed rule: at most a startup resync and a standing positive server buffer", () => {
    for (const lag of [0, 1]) {
      const r = run("new", lag);
      expect(r.resyncs).toBeLessThanOrEqual(2);
      expect(r.avgDepth).toBeGreaterThan(0.9);
    }
  });
});

// Closed-loop model of the server input path (spike-engine: one seq consumed per tick, late-drop by seq) with a
// stall. Without steering the client never recovers; with steering the late-drop count stays small.
describe("steering against a modelled server", () => {
  function simulate(steered: boolean): { accepted: number; late: number } {
    const rng = createRng(9);
    const tickMs = 50;
    const owdTicks = 2;
    let consumed = 0;
    let seq = 0;
    let ack = -1;
    let accepted = 0;
    let late = 0;
    const toServer: { at: number; seqs: number[] }[] = [];
    const toClient: { at: number; ack: number }[] = [];
    const res: SteerResult = { count: 1, resyncSeq: -1 };
    const ring: number[] = [];
    for (let t = 0; t < 2000; t++) {
      // Client tick.
      while (toClient.length && (toClient[0] as { at: number }).at <= t)
        ack = (toClient.shift() as { ack: number }).ack;
      let count = 1;
      if (steered) {
        steer({ seq, ack, rttMs: owdTicks * 2 * tickMs, tickMs }, res);
        if (res.resyncSeq >= 0) seq = (res.resyncSeq - 1) & 0xffff;
        count = res.count;
      }
      const seqs: number[] = [];
      for (let k = 0; k < count; k++) {
        seq = (seq + 1) & 0xffff;
        seqs.push(seq);
      }
      if (seqs.length) {
        // A host stall at t=500..520 delays this client's packets and the server's ticks.
        const extra = t >= 500 && t < 520 ? 520 - t : 0;
        toServer.push({ at: t + owdTicks + extra + Math.floor(rng() * 2), seqs });
      }
      // Server: deliver, then one tick (consume one seq, substitute when missing).
      while (toServer.length && (toServer[0] as { at: number }).at <= t) {
        for (const s of (toServer.shift() as { seqs: number[] }).seqs) {
          const diff = (s - consumed) & 0xffff;
          if (diff === 0 || diff > 1024) late++;
          else {
            ring.push(s);
            accepted++;
          }
        }
      }
      // Pull the oldest valid seq; otherwise substitute.
      let next = -1;
      while (ring.length && next < 0) {
        const s = ring.shift() as number;
        const diff = (s - consumed) & 0xffff;
        if (diff === 0 || diff > 1024) late++;
        else next = s;
      }
      consumed = next >= 0 ? next : (consumed + 1) & 0xffff;
      toClient.push({ at: t + owdTicks, ack: consumed });
    }
    return { accepted, late };
  }

  it("recovers after a stall only when steered", () => {
    const naive = simulate(false);
    const steeredRun = simulate(true);
    expect(steeredRun.late).toBeLessThan(steeredRun.accepted * 0.05);
    expect(naive.late).toBeGreaterThan(steeredRun.late * 3);
  });
});
