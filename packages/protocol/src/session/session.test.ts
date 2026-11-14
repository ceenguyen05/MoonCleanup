import { CloseCode, FOREIGN_CLOSE_CODES, FRAME_FLAG_BIT, PROTOCOL_VERSION } from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { ALLOC_BUDGET_BYTES, ALLOC_ITERATIONS, allocatedBytes, randInt, rng } from "../codec/test-util";
import { InterpolationBuffer, IO_NOW } from "../interpolation/interpolation-buffer";
import { backoffDelayMs, CONNECT_BACKOFF, RECONNECT_BACKOFF } from "./backoff";
import {
  ClientSession,
  SESSION_BYTES_DROPPED,
  SESSION_BYTES_HANDLED,
  SESSION_BYTES_UNHANDLED,
  SESSION_FRAME_APPLIED,
  SESSION_FRAME_AWAITING_KEYFRAME,
  SESSION_FRAME_DUPLICATE,
  SESSION_FRAME_IGNORED,
  SESSION_FRAME_INVALID,
  SESSION_FRAME_STALE,
  classifyClose,
  type SessionConfig,
} from "./session";
import { FakeServer, HELLO, RecordingHost, identityInflate, pongMessage, snapshotSlices } from "./test-helpers";

const PLOTS = 20_000;

class Harness {
  readonly host = new RecordingHost();
  readonly server = new FakeServer();
  readonly session: ClientSession;
  now = 0;

  constructor(config: Partial<SessionConfig> = {}) {
    this.session = new ClientSession(this.host, {
      plotCount: PLOTS,
      inflate: identityInflate,
      wakeProbe: false,
      ...config,
    });
  }

  advance(ms: number, step = 250): void {
    const end = this.now + ms;
    while (this.now < end) {
      this.now = Math.min(end, this.now + step);
      this.session.tick(this.now);
    }
  }

  frame(msg: Uint8Array): number {
    this.session.io[IO_NOW] = this.now;
    return this.session.onFrame(msg);
  }

  snapshot(version = 1, order: "forward" | "reverse" = "forward"): void {
    const slices = snapshotSlices(PLOTS, version);
    if (order === "reverse") slices.reverse();
    this.session.io[IO_NOW] = this.now;
    for (const s of slices) this.session.onSnapshotSlice(s);
  }

  keyframe(tick: number): number {
    return this.frame(this.server.keyframe(tick, [{ slot: 0, x: 1, assign: 9 }]));
  }

  /** start (no wake probe) -> connected -> hello + keyframe + snapshot -> joined. */
  join(): void {
    this.session.start(this.now);
    this.session.onConnected(this.now);
    this.session.onHello(this.now, HELLO);
    this.keyframe(100);
    this.snapshot();
  }
}

describe("backoff", () => {
  it("matches the documented schedules", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((n) => backoffDelayMs(RECONNECT_BACKOFF, n))).toEqual([
      500, 1000, 2000, 4000, 8000, 8000, 8000,
    ]);
    expect([0, 1, 2, 3, 4].map((n) => backoffDelayMs(CONNECT_BACKOFF, n))).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(backoffDelayMs({ baseMs: 1000, maxMs: 8000, jitter: 0.5 }, 0, () => 0)).toBe(500);
    expect(backoffDelayMs({ baseMs: 1000, maxMs: 8000, jitter: 0.5 }, 0, () => 1)).toBe(1500);
  });
});

describe("close code classification (netcode.md section 12)", () => {
  it("maps every documented code", () => {
    expect(classifyClose(FOREIGN_CLOSE_CODES.CONSENTED).kind).toBe("closed");
    for (const c of [1005, 1006, 1001, 4010]) expect(classifyClose(c).kind).toBe("reconnect");
    expect(classifyClose(4001).kind).toBe("restore");
    const fail = (c: number) => {
      const a = classifyClose(c);
      return a.kind === "fail" ? a.failure : null;
    };
    expect(fail(CloseCode.PROTOCOL_MISMATCH)).toMatchObject({ reason: "protocol_mismatch", retryable: false });
    expect(fail(CloseCode.AUTH_INVALID)).toMatchObject({ reason: "auth_invalid", retryable: true });
    expect(fail(CloseCode.KICKED)).toMatchObject({ reason: "kicked", retryAfterMs: 15 * 60_000 });
    expect(fail(CloseCode.BANNED)).toMatchObject({ reason: "banned", retryable: false });
    expect(fail(CloseCode.RATE_LIMITED)).toMatchObject({ reason: "rate_limited", retryAfterMs: 30_000 });
    expect(fail(CloseCode.ROOM_FULL)).toMatchObject({ reason: "room_full", retryable: true });
    expect(fail(CloseCode.DUPLICATE_SESSION)?.reason).toBe("duplicate_session");
    expect(fail(CloseCode.IDLE_TIMEOUT)?.reason).toBe("idle_timeout");
    expect(fail(CloseCode.CONTRACT_UNAVAILABLE)?.retryable).toBe(false);
    expect(fail(4002)?.reason).toBe("server_error");
    expect(fail(4003)?.reason).toBe("seat_lost");
    expect(fail(4199)?.reason).toBe("closed_unexpected");
  });
});

describe("waking and connecting", () => {
  it("probes every 3 s through a cold start, reports progress, then joins", () => {
    const h = new Harness({ wakeProbe: true });
    h.session.start(h.now);
    expect(h.session.phase).toBe("waking");
    expect(h.host.probes).toBe(1);
    h.session.onHealth(h.now, false); // Render waking page
    h.advance(2900);
    expect(h.host.probes).toBe(1);
    h.advance(200);
    expect(h.host.probes).toBe(2);
    expect(h.session.wakeFraction(h.now)).toBeCloseTo(3100 / 60_000, 5);
    h.advance(30_000);
    expect(h.session.wakeProbeCount()).toBeGreaterThanOrEqual(8);
    expect(h.session.wakeFraction(h.now)).toBeLessThanOrEqual(0.95);
    h.session.onHealth(h.now, true, PROTOCOL_VERSION);
    expect(h.session.phase).toBe("connecting");
    expect(h.host.connects).toEqual(["join"]);
    h.session.onConnected(h.now);
    expect(h.session.phase).toBe("joining");
  });

  it("a probe that never answers does not block the next probe", () => {
    const h = new Harness({ wakeProbe: true });
    h.session.start(0);
    h.advance(10_000);
    expect(h.host.probes).toBeGreaterThanOrEqual(3);
  });

  it("fails with wake_timeout after the budget, retryable", () => {
    const h = new Harness({ wakeProbe: true, wakeBudgetMs: 20_000 });
    h.session.start(0);
    h.advance(21_000);
    expect(h.session.phase).toBe("failed");
    expect(h.session.failure).toMatchObject({ reason: "wake_timeout", retryable: true });
    h.session.retry(h.now);
    expect(h.session.phase).toBe("waking");
    expect(h.session.failure).toBeNull();
  });

  it("fails on a protocol mismatch seen by /healthz or by the hello", () => {
    const a = new Harness({ wakeProbe: true });
    a.session.start(0);
    a.session.onHealth(0, true, PROTOCOL_VERSION + 1);
    expect(a.session.failure).toMatchObject({ reason: "protocol_mismatch", retryable: false });
    const b = new Harness();
    b.session.start(0);
    b.session.onConnected(0);
    b.session.onHello(0, { ...HELLO, serverProtocol: PROTOCOL_VERSION + 1 });
    expect(b.session.phase).toBe("failed");
  });

  it("retries a failed connect with backoff 1, 2, 4 s, goes back to waking after two failures", () => {
    const h = new Harness({ wakeProbe: false });
    h.session.start(0);
    expect(h.host.connects.length).toBe(1);
    h.session.onConnectFailed(0);
    h.advance(900);
    expect(h.host.connects.length).toBe(1);
    h.advance(200);
    expect(h.host.connects.length).toBe(2);
    h.session.onConnectFailed(h.now);
    h.advance(1900);
    expect(h.host.connects.length).toBe(2);
    h.advance(200);
    expect(h.host.connects.length).toBe(3);

    const w = new Harness({ wakeProbe: true });
    w.session.start(0);
    w.session.onHealth(0, true);
    w.session.onConnectFailed(0);
    w.advance(1100);
    w.session.onConnectFailed(w.now);
    expect(w.session.phase).toBe("waking");
  });

  it("gives up after maxConnectAttempts and times out a silent attempt", () => {
    const h = new Harness({ maxConnectAttempts: 3, connectTimeoutMs: 5000 });
    h.session.start(0);
    h.advance(6000); // first attempt times out
    expect(h.session.phase).toBe("connecting");
    for (let i = 0; i < 6 && h.session.phase === "connecting"; i++) {
      h.session.onConnectFailed(h.now);
      h.advance(9000);
    }
    expect(h.session.failure?.reason).toBe("connect_failed");
  });
});

describe("joining (hello, keyframe, snapshot) and steady state", () => {
  it("sends ready once after hello + keyframe + snapshot, whatever the order", () => {
    const h = new Harness();
    h.session.start(0);
    h.session.onConnected(0);
    h.snapshot(1, "reverse"); // multi-slice, reversed
    expect(h.session.dustReady).toBe(true);
    expect(h.host.readies).toBe(0);
    h.keyframe(100);
    expect(h.session.phase).toBe("joining");
    h.session.onHello(0, HELLO);
    expect(h.session.phase).toBe("joined");
    expect(h.host.readies).toBe(1);
    expect(h.host.snapshots).toBe(1);
    expect(h.session.table.kind[0]).toBe(0);
    h.session.onHello(0, HELLO);
    expect(h.host.readies).toBe(1);
  });

  it("drops non-keyframe frames before the first keyframe", () => {
    const h = new Harness();
    h.session.start(0);
    h.session.onConnected(0);
    h.session.onHello(0, HELLO);
    h.server.keyframe(98, [{ slot: 0, x: 1 }]);
    expect(h.frame(h.server.frame(100, [{ slot: 0, x: 1.1 }]))).toBe(SESSION_FRAME_AWAITING_KEYFRAME);
    expect(h.session.stats.framesAwaitingKeyframe).toBe(1);
    expect(h.session.phase).toBe("joining");
  });

  it("ignores frames outside a room", () => {
    const h = new Harness();
    expect(h.frame(h.server.keyframe(1, []))).toBe(SESSION_FRAME_IGNORED);
    expect(h.session.onSnapshotSlice(snapshotSlices(PLOTS, 1)[0]!)).toBe(false);
  });

  it("applies frames in order and drops duplicates and older frames", () => {
    const h = new Harness();
    h.join();
    expect(h.session.phase).toBe("joined");
    const f102 = h.server.frame(102, [{ slot: 0, x: 1.1 }]);
    const f104 = h.server.frame(104, [{ slot: 0, x: 1.2 }]);
    expect(h.frame(f102)).toBe(SESSION_FRAME_APPLIED);
    expect(h.frame(f102)).toBe(SESSION_FRAME_DUPLICATE);
    // 104 arrives, then a late copy of an older frame (out of order)
    expect(h.frame(f104)).toBe(SESSION_FRAME_APPLIED);
    expect(h.frame(f102)).toBe(SESSION_FRAME_STALE);
    expect(h.session.lastTick).toBe(104);
    expect(h.session.stats).toMatchObject({ framesApplied: 3, framesDuplicate: 1, framesStale: 1 });
    expect(h.session.phase).toBe("joined");
  });

  it("counts frames the server skipped (lost) and stays joined", () => {
    const h = new Harness();
    h.join();
    h.frame(h.server.frame(102, [{ slot: 0, x: 1.1 }]));
    h.server.frame(104, [{ slot: 0, x: 1.2 }]); // lost in transit: never delivered
    h.server.frame(106, [{ slot: 0, x: 1.3 }]); // lost
    expect(h.frame(h.server.frame(108, [{ slot: 0, x: 1.4 }]))).toBe(SESSION_FRAME_APPLIED);
    expect(h.session.stats.framesGapEstimate).toBe(2);
    expect(h.session.phase).toBe("joined");
  });

  it("feeds the interpolation buffer and configures it from the hello", () => {
    const interpolation = new InterpolationBuffer();
    const h = new Harness({ interpolation });
    h.join();
    h.now = 1000;
    expect(h.frame(h.server.frame(102, [{ slot: 0, x: 1.1 }]))).toBe(SESSION_FRAME_APPLIED);
    expect(interpolation.sampleCount(0)).toBe(2);
    expect(interpolation.framesIngested).toBe(2);
  });

  it("PONGs and unknown messages go through onBytes", () => {
    const h = new Harness();
    h.join();
    h.session.io[IO_NOW] = 5060;
    expect(h.session.onBytes(pongMessage(5000, 120))).toBe(SESSION_BYTES_HANDLED);
    expect(h.session.clock.samples).toBe(1);
    expect(h.session.onBytes(new Uint8Array([0x22, 1, 2, 3]))).toBe(SESSION_BYTES_UNHANDLED);
    expect(h.session.onBytes(new Uint8Array(0))).toBe(SESSION_BYTES_DROPPED);
    expect(h.session.onBytes(new Uint8Array([0x27, 1]))).toBe(SESSION_BYTES_DROPPED);
    expect(h.session.stats.pongsInvalid).toBe(1);
  });

  it("pings in a burst of four at 500 ms, then every 2 s", () => {
    const h = new Harness();
    h.session.start(0);
    h.session.onConnected(0);
    h.session.onHello(0, HELLO);
    h.advance(250, 50);
    expect(h.host.pings).toBe(1);
    h.advance(1750, 50);
    expect(h.host.pings).toBe(4); // t = 0, 500, 1000, 1500
    h.advance(2000, 50);
    expect(h.host.pings).toBe(5);
  });

  it("times out a join that never completes, retryable", () => {
    const h = new Harness({ joinTimeoutMs: 10_000 });
    h.session.start(0);
    h.session.onConnected(0);
    h.advance(11_000);
    expect(h.session.failure).toMatchObject({ reason: "join_timeout", retryable: true });
  });

  it("a corrupt snapshot asks for a new one and does not become ready", () => {
    const h = new Harness({ inflate: () => null });
    h.session.start(0);
    h.session.onConnected(0);
    h.session.onHello(0, HELLO);
    h.keyframe(100);
    h.advance(1500);
    h.snapshot();
    expect(h.session.stats.snapshotsInvalid).toBe(1);
    expect(h.host.resyncs).toContain("snapshot");
    expect(h.host.readies).toBe(0);
    expect(h.session.phase).toBe("joining");
  });

  it("drops malformed slices and truncated frames without throwing", () => {
    const h = new Harness();
    h.join();
    const slice = snapshotSlices(PLOTS, 2)[0]!;
    expect(h.session.onSnapshotSlice(slice.subarray(0, 5))).toBe(false);
    expect(h.session.onSnapshotSlice(new Uint8Array([0x21, 9, 9, 1, 0, 0, 0, 0, 0, 1]))).toBe(false);
    expect(h.session.stats.snapshotSlicesInvalid).toBe(2);
    expect(h.frame(new Uint8Array([0x20, 1, 2]))).toBe(SESSION_FRAME_INVALID);
  });
});

describe("resync", () => {
  it("a corrupt frame enters resyncing, drops frames until a keyframe, then rejoins the steady state", () => {
    const h = new Harness();
    h.join();
    h.now = 2000;
    const good = h.server.frame(102, [{ slot: 0, x: 1.1 }]);
    const bad = good.slice();
    bad[bad.length - 1] = 0xff; // flips padding / trailing data
    bad[8] = (bad[8] ?? 0) | 0x80; // reserved flag
    const resetsBefore = h.host.slotResets;
    expect(h.frame(bad)).toBe(SESSION_FRAME_INVALID);
    expect(h.session.phase).toBe("resyncing");
    expect(h.host.resyncs).toEqual(["decode"]);
    expect(h.host.slotResets).toBe(resetsBefore + 1);
    expect(h.session.table.count).toBe(0);
    expect(h.frame(h.server.frame(104, [{ slot: 0, x: 1.2 }]))).toBe(SESSION_FRAME_AWAITING_KEYFRAME);
    expect(h.session.phase).toBe("resyncing");
    // the snapshot is expected too (keyframe + DUST_SNAPSHOT answer)
    h.keyframe(106);
    expect(h.session.phase).toBe("resyncing");
    h.snapshot(2);
    expect(h.session.phase).toBe("joined");
    expect(h.host.readies).toBe(1); // ready is once per join
    expect(h.frame(h.server.frame(108, [{ slot: 0, x: 1.3 }]))).toBe(SESSION_FRAME_APPLIED);
  });

  it("accepts a keyframe whose tick is below the last applied one (server restart)", () => {
    const h = new Harness();
    h.join();
    h.frame(h.server.frame(5000, [{ slot: 0, x: 2 }]));
    h.session.onVisibility(h.now, true);
    h.session.onVisibility(h.now, false);
    expect(h.session.phase).toBe("resyncing");
    expect(h.keyframe(6)).toBe(SESSION_FRAME_APPLIED);
    expect(h.session.lastTick).toBe(6);
  });

  it("rate limits the request to 1/s, repeats after the timeout, fails after the attempt budget", () => {
    const h = new Harness({ resyncMaxAttempts: 3 });
    h.join();
    h.now = 2000;
    const bad = new Uint8Array(40);
    bad[0] = 0x20;
    bad[1] = 112; // tick 112: newer than the joined keyframe (100)
    h.frame(bad); // invalid (trailing bytes): first request
    expect(h.host.resyncs.length).toBe(1);
    bad[8] = 1 << FRAME_FLAG_BIT.keyframe;
    h.frame(bad); // an invalid keyframe while awaiting: throttled (same instant), sent after 1 s
    expect(h.host.resyncs.length).toBe(1);
    h.advance(1000);
    expect(h.host.resyncs.length).toBe(2); // pending request sent after 1 s
    h.advance(4100);
    expect(h.host.resyncs.length).toBe(3);
    h.advance(4100);
    expect(h.session.failure).toMatchObject({ reason: "resync_failed", retryable: true });
  });

  it("a stall longer than 5 s forces a resync on the next frame", () => {
    const h = new Harness();
    h.join();
    h.now = 1000;
    h.frame(h.server.frame(102, [{ slot: 0, x: 1.1 }]));
    h.now = 1000 + 6000;
    expect(h.frame(h.server.frame(200, [{ slot: 0, x: 3 }]))).toBe(SESSION_FRAME_AWAITING_KEYFRAME);
    expect(h.session.phase).toBe("resyncing");
    expect(h.host.resyncs).toEqual(["stall"]);
  });

  it("flags signal lost after 1 s without frames and clears it on the next frame", () => {
    const h = new Harness();
    h.join();
    h.advance(1500);
    expect(h.session.signalLost).toBe(true);
    h.frame(h.server.frame(102, [{ slot: 0, x: 1.1 }]));
    expect(h.session.signalLost).toBe(false);
  });

  it("hidden tab: sends visibility, no signal lost, resync with keyframe + snapshot on return", () => {
    const h = new Harness();
    h.join();
    h.session.onVisibility(h.now, true);
    h.advance(3000);
    expect(h.session.signalLost).toBe(false);
    expect(h.session.phase).toBe("joined");
    h.session.onVisibility(h.now, false);
    expect(h.host.visibility).toEqual([true, false]);
    expect(h.session.phase).toBe("resyncing");
    h.keyframe(300);
    expect(h.session.phase).toBe("resyncing"); // snapshot still missing
    h.snapshot(7);
    expect(h.session.phase).toBe("joined");
  });
});

describe("reconnecting (seat reservation)", () => {
  it("drops to reconnecting on 1006, retries 0.5, 1, 2 s, resyncs without a snapshot when away < 10 s", () => {
    const h = new Harness();
    h.join();
    h.now = 1000;
    h.session.onClosed(h.now, 1006);
    expect(h.session.phase).toBe("reconnecting");
    h.advance(400);
    expect(h.host.connects).toEqual(["join"]);
    h.advance(200);
    expect(h.host.connects).toEqual(["join", "reconnect"]);
    h.session.onConnectFailed(h.now);
    h.advance(900);
    expect(h.host.connects.length).toBe(2);
    h.advance(200);
    expect(h.host.connects.length).toBe(3);
    h.session.onConnected(h.now);
    expect(h.session.phase).toBe("resyncing");
    expect(h.session.stats.reconnects).toBe(1);
    // the server sends the keyframe by itself; no snapshot because the player was away < 10 s
    h.keyframe(500);
    expect(h.session.phase).toBe("joined");
    expect(h.host.readies).toBe(1);
    expect(h.host.resyncs).toEqual([]);
  });

  it("expects a fresh snapshot when away longer than 10 s", () => {
    const h = new Harness();
    h.join();
    h.session.onClosed(h.now, 1001);
    h.advance(12_000);
    h.session.onConnected(h.now);
    h.keyframe(900);
    expect(h.session.phase).toBe("resyncing");
    h.snapshot(3);
    expect(h.session.phase).toBe("joined");
  });

  it("loses the seat after 60 s and reports it, retryable as a normal join", () => {
    const h = new Harness();
    h.join();
    h.session.onClosed(h.now, 1006);
    for (let i = 0; i < 20 && h.session.phase === "reconnecting"; i++) {
      h.advance(3100);
      h.session.onConnectFailed(h.now);
    }
    expect(h.session.failure).toMatchObject({ reason: "seat_lost", retryable: true });
    expect(h.now).toBeGreaterThanOrEqual(60_000);
  });

  it("waits for the SDK when driveReconnect is false", () => {
    const h = new Harness({ driveReconnect: false });
    h.join();
    h.session.onClosed(h.now, 1006);
    h.advance(10_000);
    expect(h.host.connects).toEqual(["join"]);
    h.session.onConnected(h.now);
    expect(h.session.phase).toBe("resyncing");
  });

  it("server shutdown (4001) wakes the server again and rejoins with restore", () => {
    const h = new Harness({ wakeProbe: true });
    h.session.start(0);
    h.session.onHealth(0, true);
    h.session.onConnected(0);
    h.session.onHello(0, HELLO);
    h.keyframe(10);
    h.snapshot();
    expect(h.session.phase).toBe("joined");
    h.session.onClosed(h.now, FOREIGN_CLOSE_CODES.SERVER_SHUTDOWN);
    expect(h.session.phase).toBe("waking");
    h.session.onHealth(h.now, true);
    expect(h.host.connects).toEqual(["join", "restore"]);
    h.session.onConnected(h.now);
    expect(h.session.phase).toBe("joining");
  });

  it("terminal close codes fail or close without reconnecting", () => {
    const kicked = new Harness();
    kicked.join();
    kicked.session.onClosed(0, CloseCode.KICKED);
    expect(kicked.session.phase).toBe("failed");
    expect(kicked.session.failure?.reason).toBe("kicked");
    const left = new Harness();
    left.join();
    left.session.onClosed(0, 4000);
    expect(left.session.phase).toBe("closed");
    const again = new Harness();
    again.join();
    again.session.leave();
    expect(again.session.phase).toBe("closed");
    again.session.start(0);
    expect(again.session.phase).toBe("connecting");
  });

  it("a drop while still joining restarts the join instead of reconnecting", () => {
    const h = new Harness();
    h.session.start(0);
    h.session.onConnected(0);
    h.session.onClosed(0, 1006);
    expect(h.session.phase).toBe("connecting");
    h.advance(1100);
    expect(h.host.connects).toEqual(["join", "join"]);
  });
});

describe("session hot path", () => {
  it("steady-state onFrame allocates nothing per frame", () => {
    const interpolation = new InterpolationBuffer();
    const h = new Harness({ interpolation });
    h.join();
    const frames: Uint8Array[] = [];
    for (let k = 1; k <= 64; k++) frames.push(h.server.frame(100 + k * 2, [{ slot: 0, x: 1 + k * 0.05 }]));
    let tick = 0;
    const s = h.session;
    // The same bytes replayed: the session drops them as duplicates after the first pass, so rewrite the tick bytes.
    const msg = frames[0]!.slice();
    const bytes = allocatedBytes(() => {
      tick += 2;
      const wire = tick + 100;
      msg[1] = wire & 0xff;
      msg[2] = (wire >>> 8) & 0xff;
      msg[3] = (wire >>> 16) & 0xff;
      s.io[IO_NOW] = 1000 + tick * 50;
      s.lastTick = wire - 2;
      s.onFrame(msg);
    }, ALLOC_ITERATIONS);
    expect(bytes).toBeLessThan(ALLOC_BUDGET_BYTES);
    expect(s.stats.framesApplied).toBeGreaterThan(ALLOC_ITERATIONS);
  });
});

describe("session fuzz", () => {
  it("never throws on garbage, truncated or mutated messages in any phase", () => {
    const r = rng(2026);
    const h = new Harness();
    const seeds = [
      h.server.keyframe(100, [{ slot: 0, x: 1, assign: 9 }]),
      h.server.frame(102, [{ slot: 0, x: 1.5 }]),
      ...snapshotSlices(PLOTS, 4),
      pongMessage(1, 2),
    ];
    for (let round = 0; round < 3; round++) {
      h.session.start(h.now);
      if (round > 0) h.session.onConnected(h.now);
      if (round > 1) h.session.onHello(h.now, HELLO);
      for (let i = 0; i < 4000; i++) {
        const base = seeds[randInt(r, 0, seeds.length - 1)]!;
        const m = base.slice(0, randInt(r, 0, base.length));
        if (m.length > 0 && r() < 0.7) m[randInt(r, 0, m.length - 1)] = randInt(r, 0, 255);
        if (r() < 0.2) for (let k = 0; k < m.length; k++) m[k] = randInt(r, 0, 255);
        h.session.io[IO_NOW] = h.now;
        h.session.onBytes(m);
        h.now += 10;
        h.session.tick(h.now);
      }
    }
    expect(["joining", "joined", "resyncing", "failed", "connecting"]).toContain(h.session.phase);
  });
});
