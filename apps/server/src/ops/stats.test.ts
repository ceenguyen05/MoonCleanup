import { describe, expect, it } from "vitest";
import { BandwidthCounter, EGRESS_ALLOWANCE_BYTES, monthKeyUtc } from "./bandwidth";
import { LateInputLog } from "./late-input-log";
import { RoomStats, cpuPercentOfQuota, percentileSorted, type ProcessProbe } from "./room-stats";
import {
  BANDWIDTH_LINE_INTERVAL_MS,
  ROOM_LINE_INTERVAL_MS,
  SPIKE_ROOM_LINE_INTERVAL_MS,
  StatsReporter,
  createNodeProcessProbe,
  type TimerApi,
} from "./stats-reporter";

function fakeProbe() {
  const state = { cpu: 0, eld: 0, resets: 0 };
  const probe: ProcessProbe = {
    cpuMicros: () => state.cpu,
    eventLoopDelayP99Ms: () => state.eld,
    resetWindow: () => void (state.resets += 1),
  };
  return { state, probe };
}

describe("percentileSorted and cpuPercentOfQuota", () => {
  it("uses nearest rank", () => {
    const data = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(percentileSorted(data, 0.5)).toBe(5);
    expect(percentileSorted(data, 0.95)).toBe(10);
    expect(percentileSorted(data, 0.1)).toBe(1);
    expect(percentileSorted(new Float64Array(0), 0.95)).toBe(0);
  });

  it("reports CPU against the 0.1-CPU quota", () => {
    // 10 ms of CPU in 1000 ms wall = 1 % of a CPU = 10 % of the 0.1 quota.
    expect(cpuPercentOfQuota(10_000, 1000)).toBeCloseTo(10, 6);
    expect(cpuPercentOfQuota(100_000, 1000)).toBeCloseTo(100, 6);
    expect(cpuPercentOfQuota(5, 0)).toBe(0);
  });

  it("does not blow up on a tiny final window (regression: 5000 % reading)", () => {
    // 5 ms of CPU over 10 ms of wall time used to read 500 % of a CPU = 5000 % of the quota.
    expect(cpuPercentOfQuota(5_000, 10)).toBe(0);
    expect(cpuPercentOfQuota(5_000, Number.NaN)).toBe(0);
    expect(cpuPercentOfQuota(-1, 5000)).toBe(0);
  });
});

describe("RoomStats", () => {
  it("computes p50/p95/max and resets the window", () => {
    const { probe, state } = fakeProbe();
    const stats = new RoomStats("r1", probe, undefined, 0);
    for (let i = 1; i <= 100; i += 1) stats.recordTick(i / 10); // 0.1 .. 10.0 ms
    stats.setClients(5);
    state.cpu = 60_000; // 60 ms CPU over 60 s -> 0.1 % CPU -> 1 % of quota
    state.eld = 12.345;
    const snap = stats.snapshotAndReset(60_000);
    expect(snap.tick).toEqual({ count: 100, p50Ms: 5, p95Ms: 9.5, maxMs: 10 });
    expect(snap.clients).toBe(5);
    expect(snap.windowS).toBe(60);
    expect(snap.cpuPercentOfQuota).toBe(1);
    expect(snap.eventLoopDelayP99Ms).toBe(12.35);

    const next = stats.snapshotAndReset(120_000);
    expect(next.tick).toEqual({ count: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 });
    expect(next.bytesOut).toBe(0);
  });

  it("keeps only the newest samples once the ring is full", () => {
    const { probe } = fakeProbe();
    const stats = new RoomStats("r1", probe, undefined, 0);
    for (let i = 0; i < 5000; i += 1) stats.recordTick(1);
    stats.recordTick(50);
    const snap = stats.snapshotAndReset(1000);
    expect(snap.tick.count).toBe(5001);
    expect(snap.tick.maxMs).toBe(50);
    expect(snap.tick.p50Ms).toBe(1);
  });

  it("sums bytes out per message type and feeds the process counter", () => {
    const { probe } = fakeProbe();
    const bandwidth = new BandwidthCounter(0);
    const stats = new RoomStats("r1", probe, bandwidth, 0);
    stats.recordBytesOut("frame", 100);
    stats.recordBytesOut("frame", 50);
    stats.recordBytesOut("dust", 7);
    const snap = stats.snapshotAndReset(1000);
    expect(snap.bytesOut).toBe(157);
    expect(snap.bytesOutByType).toEqual({ frame: 150, dust: 7 });
    expect(bandwidth.report(1000).monthToDateBytes).toBe(157);
  });

  it("exposes the current p95 without resetting", () => {
    const { probe } = fakeProbe();
    const stats = new RoomStats("r1", probe, undefined, 0);
    [1, 2, 3, 4, 20].forEach((ms) => stats.recordTick(ms));
    expect(stats.currentTickP95Ms()).toBe(20);
    expect(stats.snapshotAndReset(1000).tick.count).toBe(5);
  });
});

describe("late inputs and process memory", () => {
  it("counts late inputs per window and resets them", () => {
    const { probe } = fakeProbe();
    const seen: number[] = [];
    const stats = new RoomStats("r1", probe, undefined, 0, { onLateInputs: (n) => seen.push(n) });
    stats.recordLateInputs(2);
    stats.recordLateInputs(0); // ignored
    stats.recordLateInputs(3);
    expect(seen).toEqual([2, 3]);
    expect(stats.snapshotAndReset(1000).lateInputs).toBe(5);
    expect(stats.snapshotAndReset(2000).lateInputs).toBe(0);
  });

  it("LateInputLog emits at most one warn per interval with the dropped count since the last line", () => {
    const lines: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const logger = { warn: (obj: Record<string, unknown>, msg: string) => void lines.push({ obj, msg }) };
    let now = 1_000_000;
    const log = new LateInputLog(logger as never, "r1", () => now, 10_000);
    log.record(1); // first drop logs at once
    log.record(4);
    now += 9_999;
    log.record(2);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.obj).toMatchObject({ kind: "late-inputs", roomId: "r1", dropped: 1 });
    now += 1; // 10 s since the first line: the throttled drops (4 + 2) plus this one are reported together
    log.record(1);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.obj).toMatchObject({ dropped: 7, sinceLastLogS: 10 });
    log.record(0);
    log.record(-3);
    expect(lines).toHaveLength(2);
  });

  it("StatsReporter forwards late inputs to a rate-limited warn and adds RSS/heap to the room line", () => {
    const { probe: base } = fakeProbe();
    const probe: ProcessProbe = {
      ...base,
      memoryBytes: () => ({ rss: 120 * 1_048_576, heapUsed: 30.04 * 1_048_576, heapTotal: 45 * 1_048_576 }),
    };
    const lines: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
    const logger = {
      info: (obj: Record<string, unknown>, msg: string) => void lines.push({ level: "info", obj, msg }),
      warn: (obj: Record<string, unknown>, msg: string) => void lines.push({ level: "warn", obj, msg }),
    };
    let now = 0;
    const reporter = new StatsReporter({ logger: logger as never, probe, netSpike: false, now: () => now });
    const room = reporter.addRoom("a");
    for (let i = 0; i < 50; i++) room.recordLateInputs(1); // a burst: one warn line, not fifty
    expect(lines.filter((l) => l.level === "warn")).toHaveLength(1);
    now = 60_000;
    reporter.emitRooms();
    const roomLine = lines.find((l) => l.obj.kind === "room-stats");
    expect(roomLine?.obj).toMatchObject({ lateInputs: 50, rssMb: 120, heapUsedMb: 30, heapTotalMb: 45 });
  });

  it("omits memory fields when the probe does not provide them, and the real probe reports sane numbers", () => {
    const { probe } = fakeProbe();
    const lines: Array<Record<string, unknown>> = [];
    const logger = { info: (obj: Record<string, unknown>) => void lines.push(obj) };
    const reporter = new StatsReporter({ logger: logger as never, probe, netSpike: false, now: () => 0 });
    reporter.addRoom("a");
    reporter.emitRooms();
    expect(lines[0]).not.toHaveProperty("rssMb");

    const real = createNodeProcessProbe();
    try {
      const memory = real.memoryBytes?.();
      expect(memory?.rss).toBeGreaterThan(10_000_000);
      expect(memory?.heapUsed).toBeLessThanOrEqual(memory?.heapTotal ?? 0);
    } finally {
      real.dispose();
    }
  });
});

describe("BandwidthCounter", () => {
  const JAN = Date.UTC(2026, 0, 15);
  const FEB = Date.UTC(2026, 1, 1, 0, 5);

  it("accumulates month-to-date and reports deltas", () => {
    const counter = new BandwidthCounter(JAN);
    counter.add(1_000_000);
    const first = counter.report(JAN + 1000);
    expect(first).toMatchObject({ month: "2026-01", bytesSincePreviousReport: 1_000_000, monthToDateBytes: 1_000_000 });
    counter.add(500_000_000);
    const second = counter.report(JAN + 2000);
    expect(second.bytesSincePreviousReport).toBe(500_000_000);
    expect(second.monthToDateBytes).toBe(501_000_000);
    expect(second.percentOfAllowance).toBeCloseTo((501_000_000 / EGRESS_ALLOWANCE_BYTES) * 100, 2);
  });

  it("rolls over at the UTC month boundary", () => {
    const counter = new BandwidthCounter(JAN);
    counter.add(10);
    counter.report(JAN);
    counter.add(5);
    const feb = counter.report(FEB);
    expect(feb.month).toBe("2026-02");
    expect(feb.monthToDateBytes).toBe(5);
  });

  it("seeds a persisted total only for the current month", () => {
    const counter = new BandwidthCounter(JAN);
    counter.seed("2025-12", 999);
    expect(counter.report(JAN).monthToDateBytes).toBe(0);
    counter.seed("2026-01", 1234);
    counter.add(6);
    expect(counter.report(JAN).monthToDateBytes).toBe(1240);
    expect(monthKeyUtc(Date.UTC(2026, 11, 31, 23, 59))).toBe("2026-12");
  });
});

describe("StatsReporter", () => {
  function setup(netSpike: boolean) {
    const { probe, state } = fakeProbe();
    const lines: Array<{ obj: Record<string, unknown>; msg: string }> = [];
    const logger = { info: (obj: Record<string, unknown>, msg: string) => void lines.push({ obj, msg }) };
    const intervals: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
    const timers: TimerApi = {
      setInterval(fn, ms) {
        const entry = { fn, ms, cleared: false };
        intervals.push(entry);
        return entry;
      },
      clearInterval(handle) {
        (handle as { cleared: boolean }).cleared = true;
      },
    };
    let now = 0;
    const reporter = new StatsReporter({
      logger: logger as never,
      probe,
      netSpike,
      now: () => now,
      timers,
    });
    return { reporter, lines, intervals, state, advance: (ms: number) => void (now += ms) };
  }

  it("schedules room lines every 60 s and bandwidth hourly", () => {
    const { reporter, intervals } = setup(false);
    reporter.start();
    reporter.start(); // idempotent
    expect(intervals.map((i) => i.ms)).toEqual([ROOM_LINE_INTERVAL_MS, BANDWIDTH_LINE_INTERVAL_MS]);
    reporter.stop();
    expect(intervals.every((i) => i.cleared)).toBe(true);
  });

  it("emits room lines every 10 s under NET_SPIKE", () => {
    const { reporter, intervals } = setup(true);
    reporter.start();
    expect(intervals[0]?.ms).toBe(SPIKE_ROOM_LINE_INTERVAL_MS);
  });

  it("emits one line per room and resets the event-loop window", () => {
    const { reporter, lines, state, advance } = setup(false);
    const a = reporter.addRoom("a");
    reporter.addRoom("b");
    a.recordTick(2);
    a.recordBytesOut("frame", 64);
    advance(60_000);
    reporter.emitRooms();
    expect(lines.filter((l) => l.obj.kind === "room-stats").map((l) => l.obj.roomId)).toEqual(["a", "b"]);
    expect(state.resets).toBe(1);
    expect(reporter.sumTickP95Ms()).toBe(0);
  });

  it("emits a final line when a room is removed and an hourly bandwidth line", () => {
    const { reporter, lines, advance } = setup(false);
    const room = reporter.addRoom("a");
    room.recordBytesOut("frame", 1000);
    reporter.removeRoom("a");
    expect(reporter.roomCount()).toBe(0);
    advance(3_600_000);
    reporter.emitBandwidth();
    const bandwidth = lines.find((l) => l.obj.kind === "bandwidth");
    expect(bandwidth?.obj).toMatchObject({ monthToDateBytes: 1000, bytesSincePreviousReport: 1000 });
  });
});
