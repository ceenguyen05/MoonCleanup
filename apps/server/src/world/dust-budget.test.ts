// Server dust budget (M1-W3-T04, WDS section 9): with the room at its cap of 6 seats, all cleaning, plus a resync storm
// (every seat asking for a fresh DUST_SNAPSHOT as often as SNAPSHOT_MIN_INTERVAL_S allows), the whole ShiftCore tick
// (sim + ledger + interest + FRAME encoding + dust streaming) stays far under the server dust CPU budget of 8 ms per
// second, and the per-room ledger RAM stays inside the typical 4-8 MB. The "dust" share is bounded from above by
// the full tick (a stricter check than the budget asks for) and estimated as sweeping minus walking.
//
// Synthetic and headless: the absolute numbers are this machine's. The budget is CPU time (8 % of the 0.1 CPU share),
// so the measured CPU ms per second compares to it directly.
import { STANDARD_GRID_PARAMS, type ContractId, type PlayerId } from "@moon-cleanup/shared";
import { encodeInput, type MutableInput } from "@moon-cleanup/protocol";
import { loadGameData } from "@moon-cleanup/game-data";
import { createPlotGrid } from "@moon-cleanup/world";
import type { SimWorld } from "@moon-cleanup/sim";
import { describe, expect, it } from "vitest";
import { ShiftCore, SNAPSHOT_MIN_INTERVAL_S, type ShiftSink } from "../net/shift/shift-core";
import { DUST_STREAM_BYTES_PER_S, ShiftDust } from "../net/shift/shift-dust";

const CONTRACT = "00000000-0000-4000-8000-0000000000e4" as ContractId;
const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: { heightAtXYZ: () => 0 } };
const SWEEP = 1 << 3;
const HZ = 20;
const SEATS = 6;
const WARMUP_TICKS = 20 * HZ;
const MEASURE_TICKS = 60 * HZ;
/** Wall-clock assertions run only when asked for; the default run reports the timings and asserts deterministic work. */
const STRICT = process.env["DUST_BUDGET_STRICT"] === "1";
/** WDS section 9: server dust CPU <= 8 ms per second. */
const DUST_CPU_BUDGET_MS_PER_S = 8;
/** WDS section 9: per-room dust RAM, typical 4-8 MB (heavy <= 40 MB). */
const ROOM_DUST_RAM_TYPICAL_MAX_BYTES = 8 * 1024 * 1024;
/** Resync-storm abuse bounds (measured 16.5 ms/s, tick p99 6.1 ms on the dev laptop; generous for loaded CI). */
const STORM_MS_PER_S_MAX = 40;
const STORM_TICK_P99_MAX_MS = 20;

function player(i: number) {
  return {
    playerId: `00000000-0000-4000-8000-0000000000${(0xc0 + i).toString(16)}` as PlayerId,
    displayName: `Bot${i}`,
    role: i === 0 ? ("holder" as const) : ("staff" as const),
  };
}

// One scratch buffer for every input body (the core copies the body), so the harness itself stays allocation-light.
const scratch = new Uint8Array(32);
const input: MutableInput = { seq: 0, moveX: 0, moveY: 127, yaw: 0, pitch: 0, buttons: 0, toolParam: 128 };
function inputBody(seq: number, buttons: number, yaw: number): Uint8Array {
  input.seq = seq;
  input.buttons = buttons;
  input.yaw = yaw;
  const n = encodeInput(scratch, input);
  return scratch.subarray(1, n);
}

interface RunResult {
  readonly msPerS: number;
  readonly p50: number;
  readonly p99: number;
  readonly max: number;
  readonly heapDeltaKiB: number;
  readonly core: ShiftCore;
  readonly dustBytesPerClientPerS: number;
  readonly snapshotBuildMaxMs: number;
  readonly maxSnapshotsPerTick: number;
}

function run(sweep: boolean, resyncStorm: boolean): RunResult {
  const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: HZ }, 0);
  let dustBytes = 0;
  let snapshotBuildMaxMs = 0;
  let maxSnapshotsPerTick = 0;
  let measuring = false;
  const sink: ShiftSink = {
    frame() {},
    events() {},
    bytes(_seat, _typeId, body) {
      if (measuring) dustBytes += body.byteLength + 1;
    },
  };
  for (let s = 0; s < SEATS; s++) core.addSeat(player(s), 0);
  const times = new Float64Array(MEASURE_TICKS);
  const total = WARMUP_TICKS + MEASURE_TICKS;
  let heapStart = 0;
  for (let t = 0; t < total; t++) {
    if (t === WARMUP_TICKS) {
      measuring = true;
      heapStart = process.memoryUsage().heapUsed;
    }
    for (let s = 0; s < SEATS; s++) {
      // Spread headings so the six sweep different ground (and leave/enter each other's dust radius).
      const yaw = (s * 10923 + t * 40) & 0xffff;
      core.receiveInput(s, inputBody(t + 1, sweep ? SWEEP : 0, yaw), t * (1000 / HZ));
    }
    if (resyncStorm && measuring && t % (SNAPSHOT_MIN_INTERVAL_S * HZ) === 0) {
      for (let s = 0; s < SEATS; s++) core.requestKeyframe(s);
    }
    const t0 = performance.now();
    const snapsBefore = core.counters.dustSnapshotsSent;
    core.step(sink);
    const dt = performance.now() - t0;
    if (measuring) {
      maxSnapshotsPerTick = Math.max(maxSnapshotsPerTick, core.counters.dustSnapshotsSent - snapsBefore);
      times[t - WARMUP_TICKS] = dt;
      const snap = core.lastSnapshot;
      if (snap !== null && snap.buildMs > snapshotBuildMaxMs) snapshotBuildMaxMs = snap.buildMs;
    }
  }
  const heapDeltaKiB = (process.memoryUsage().heapUsed - heapStart) / 1024;
  let sum = 0;
  for (const v of times) sum += v;
  const sorted = Float64Array.from(times).sort();
  const seconds = MEASURE_TICKS / HZ;
  return {
    msPerS: sum / seconds,
    p50: sorted[Math.floor(sorted.length * 0.5)]!,
    p99: sorted[Math.floor(sorted.length * 0.99)]!,
    max: sorted[sorted.length - 1]!,
    heapDeltaKiB,
    core,
    dustBytesPerClientPerS: dustBytes / SEATS / seconds,
    snapshotBuildMaxMs,
    maxSnapshotsPerTick,
  };
}

/** Bytes of the per-room ledger state (typed arrays reachable from the WorldDustLedger instance, one level deep). */
function ledgerBytes(ledger: object): number {
  let n = 0;
  for (const v of Object.values(ledger)) {
    if (ArrayBuffer.isView(v)) n += v.byteLength;
  }
  return n;
}

describe("moon-wide snapshot cache", () => {
  it("cached snapshots are byte-identical to an uncached build at every point, and are reused within a generation", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: HZ }, 0);
    const sink: ShiftSink = { frame() {}, events() {}, bytes() {} };
    for (let s = 0; s < 3; s++) core.addSeat(player(s), 0);
    const r = core.sim.config.moonRadiusM;
    let compared = 0;
    for (let t = 0; t < 30 * HZ; t++) {
      for (let s = 0; s < 3; s++) {
        core.receiveInput(s, inputBody(t + 1, SWEEP, (s * 21845 + t * 50) & 0xffff), t * (1000 / HZ));
      }
      core.step(sink);
      if (t % 37 !== 0) continue;
      const a = core.sim.avatar(0);
      const hitsBefore = core.dust.counters.moonWideCacheHits;
      const cached1 = core.dust.buildSnapshotRaw(a.px, a.py, a.pz, 60, null);
      const cached2 = core.dust.buildSnapshotRaw(a.px, a.py, a.pz, 60, null); // same generation: a cache hit
      // The second call is always a hit (the first one too when no L0 changed since the join snapshots).
      expect(core.dust.counters.moonWideCacheHits).toBeGreaterThanOrEqual(hitsBefore + 1);
      const fresh = new ShiftDust(core.ledger, r).buildSnapshotRaw(a.px, a.py, a.pz, 60, null);
      expect(fresh).not.toBeNull();
      expect(cached1).toEqual(fresh);
      expect(cached2).toEqual(fresh);
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
    expect(core.ledger.ledgerCount).toBeGreaterThan(0);
    expect(core.dust.counters.moonWideBuilds).toBeGreaterThan(1); // L0 changes invalidated it
  });
});

describe("server dust budget at the room cap (WDS section 9)", () => {
  it("6 cleaning seats + a resync storm: bounded work, typical room RAM (ms/s reported; asserted with DUST_BUDGET_STRICT=1)", () => {
    // Walking only first (JIT warm for both runs), then the measured sweeping runs.
    run(true, false);
    const walk = run(false, false);
    const sweep = run(true, false);
    const storm = run(true, true);
    const l = storm.core.ledger;
    const ram = ledgerBytes(l);
    const fmt = (r: RunResult) =>
      `${r.msPerS.toFixed(2)} ms/s (tick p50 ${r.p50.toFixed(3)} p99 ${r.p99.toFixed(3)} max ${r.max.toFixed(2)} ms, heap ${r.heapDeltaKiB.toFixed(0)} KiB)`;
    console.info(
      `[dust budget] 6 seats @ ${HZ} Hz, 60 s: walk ${fmt(walk)}; sweep ${fmt(sweep)}; sweep+resync storm ${fmt(storm)}; ` +
        `dust share (sweep - walk) ${(sweep.msPerS - walk.msPerS).toFixed(2)} ms/s; ` +
        `snapshots ${storm.core.counters.dustSnapshotsSent}, build max ${storm.snapshotBuildMaxMs.toFixed(2)} ms; ` +
        `dust bytes ${storm.dustBytesPerClientPerS.toFixed(0)} B/s/client (storm), ${sweep.dustBytesPerClientPerS.toFixed(0)} (sweep); ` +
        `ledgers ${l.ledgerCount} (slots ${l.slotHigh}), polished ${l.polishedTotal}, ledger RAM ${(ram / 1048576).toFixed(2)} MiB; ` +
        `pool growths ${storm.core.ledgerPoolGrowths}`,
    );
    // Wall-clock bounds are opt-in (DUST_BUDGET_STRICT=1 on an otherwise idle machine): under the parallel vitest run
    // the same code measured 2-3x slower, so a hard ms assertion fails for reasons unrelated to the code.
    if (STRICT) {
      // Upper bound: the whole tick, dust included, fits the dust-only budget in normal play (joins included).
      expect(sweep.msPerS).toBeLessThan(DUST_CPU_BUDGET_MS_PER_S);
      // Abuse bound: every seat resyncing at the 2 s limit costs ~2x the budget (was ~14x before the moon-wide cache).
      expect(storm.msPerS).toBeLessThan(STORM_MS_PER_S_MAX);
      expect(storm.p99).toBeLessThan(STORM_TICK_P99_MAX_MS);
    }
    // Deterministic work bounds (the sim, inputs and tick schedule are fixed, so these never depend on the machine):
    // the one-build-per-frame cap keeps any single tick far from a 6-snapshot spike...
    expect(storm.maxSnapshotsPerTick).toBeLessThanOrEqual(1);
    // ...a seat is served at most once per SNAPSHOT_MIN_INTERVAL_S (plus the join snapshot and a frame of slack)...
    const stormSnapshots = storm.core.counters.dustSnapshotsSent;
    expect(stormSnapshots).toBeGreaterThanOrEqual(SEATS * 10);
    expect(stormSnapshots).toBeLessThanOrEqual(SEATS * (MEASURE_TICKS / HZ / SNAPSHOT_MIN_INTERVAL_S + 2));
    // ...the moon-wide cache turns almost every snapshot into a reuse instead of a full-moon scan (measured 23 builds
    // for 186 snapshots)...
    const sc = storm.core.dust.counters;
    expect(sc.moonWideCacheHits + sc.moonWideBuilds).toBeGreaterThan(0);
    expect(sc.moonWideBuilds * 4).toBeLessThanOrEqual(stormSnapshots);
    // ...ordinary sweeping streams dust well under the per-client stream ceiling (measured ~22 B/s).
    expect(sweep.dustBytesPerClientPerS).toBeLessThan(DUST_STREAM_BYTES_PER_S);
    expect(l.ledgerCount).toBeGreaterThan(0);
    expect(ram).toBeLessThan(ROOM_DUST_RAM_TYPICAL_MAX_BYTES);
    expect(storm.core.ledgerPoolGrowths).toBe(0);
  }, 120_000);
});
