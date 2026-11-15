import { describe, expect, test } from "vitest";
import type { RoomHostState, SimInputCommand } from "@moon-cleanup/shared";
import { WorldDustLedger } from "@moon-cleanup/world";
import type { MoonRoomSim } from "@moon-cleanup/sim";
import { SoloDustView, type DustViewTarget } from "./dust-view";
import { LocalRoomHostImpl } from "./local-room-host";
import {
  FLAT_WORLD,
  TEST_CONTRACT,
  TEST_PLAYER,
  channelWorker,
  directSim,
  scriptedInputs,
  testGrid,
} from "./test-support";

function waitState(host: LocalRoomHostImpl, want: RoomHostState): Promise<void> {
  if (host.state === want) return Promise.resolve();
  return new Promise((resolve) => {
    const off = host.onStateChange((s) => {
      if (s === want) {
        off();
        resolve();
      }
    });
  });
}

function manualHost(): LocalRoomHostImpl {
  return new LocalRoomHostImpl({
    contractId: TEST_CONTRACT,
    player: TEST_PLAYER,
    world: FLAT_WORLD,
    spawnWorker: channelWorker,
    clock: "manual",
    store: "memory",
    checkpointIntervalS: 0,
    statsIntervalMs: 0,
  });
}

/** Counts what the atlas would receive. */
class CountingTarget implements DustViewTarget {
  strokes = 0;
  zeros = 0;
  polished = 0;
  rebuilds = 0;
  /** Strokes received since the last rebuild request (what a resident tile must draw live). */
  sinceRebuild = 0;
  onStroke(): void {
    this.strokes++;
    this.sinceRebuild++;
  }
  onLedgerZero(): void {
    this.zeros++;
  }
  onPolished(): void {
    this.polished++;
  }
  rebuildAll(): void {
    this.rebuilds++;
    this.sinceRebuild = 0;
  }
}

/** One rendered frame's worth of view work, until a pending restore is published. */
function pumpAll(view: SoloDustView): void {
  view.pump();
  for (let i = 0; i < 10_000 && view.restoring; i++) view.pump();
}

/** Inputs [from, to) one per tick; the view is pumped like a render loop; the reference sim follows when given. */
async function play(
  host: LocalRoomHostImpl,
  view: SoloDustView,
  ref: MoonRoomSim | null,
  inputs: readonly SimInputCommand[],
  from: number,
  to: number,
): Promise<number> {
  let strokes = 0;
  for (let i = from; i < to; i++) {
    const cmd = inputs[i]!;
    host.sendInput(cmd);
    host.stepManual(1);
    if (cmd.seq % 2 === 0) await host.requestHash();
    view.pump();
    if (ref) {
      ref.applyInput(0, cmd);
      ref.step(ref.config.dt);
      strokes += ref.strokeCount;
    }
  }
  await host.requestHash();
  pumpAll(view);
  return strokes;
}

function ledgerOf(sim: MoonRoomSim): WorldDustLedger {
  if (!(sim.ledger instanceof WorldDustLedger)) throw new Error("directSim must run the real dust ledger");
  return sim.ledger;
}

describe("SoloDustView: main-thread dust ledger fed by LocalRoomHost frames", { timeout: 120_000 }, () => {
  test("every stroke reaches the target once and the view ledger equals the worker's", async () => {
    const host = manualHost();
    const view = new SoloDustView({ grid: testGrid() });
    const target = new CountingTarget();
    view.bind(target);
    view.attach(host);
    await waitState(host, "running");
    await host.requestHash();
    pumpAll(view);
    expect(view.isSynced).toBe(true);

    const ref = directSim();
    const inputs = scriptedInputs(600);
    const strokes = await play(host, view, ref, inputs, 0, 600);
    const got = await host.requestHash();
    expect(strokes).toBeGreaterThan(50);
    expect(view.stats.strokesApplied).toBe(strokes);
    expect(target.strokes).toBe(strokes);
    expect(view.stats.strokesForwarded).toBe(strokes);
    expect(got.dustHash).toBe(ledgerOf(ref).worldHash());
    expect(view.front.worldHash()).toBe(got.dustHash);
    expect(view.front.ledgerCount).toBe(ledgerOf(ref).ledgerCount);
    expect(view.stats.decodeErrors).toBe(0);
    expect(view.stats.ledgerPoolGrowths).toBe(0);
    expect(host.stats().worker?.strokesDropped).toBe(0);
    // The host's frames were released by the view: none skipped for lack of a pool buffer.
    expect(host.stats().worker?.framesSkippedNoBuffer).toBe(0);
    await host.close("clock_out");
  });

  test("a view attached mid-game restores the worker's state, then follows live", async () => {
    const host = manualHost();
    await waitState(host, "running");
    const ref = directSim();
    const inputs = scriptedInputs(700, 0xd057);
    // No view yet: 300 ticks of strokes the view never sees as frames.
    for (let i = 0; i < 300; i++) {
      host.sendInput(inputs[i]!);
      host.stepManual(1);
      if (i % 2 === 0) await host.requestHash();
      ref.applyInput(0, inputs[i]!);
      ref.step(ref.config.dt);
    }
    const view = new SoloDustView({ grid: testGrid(), restoreBudgetMs: 0.05 });
    const target = new CountingTarget();
    view.bind(target);
    expect(target.rebuilds).toBe(1);
    view.attach(host);
    await host.requestHash();
    expect(view.restoring || view.isSynced).toBe(true);
    pumpAll(view);
    expect(view.isSynced).toBe(true);
    expect(view.stats.restores).toBe(1);
    // Publishing the restored ledger asks the atlas to rebuild every resident tile.
    expect(target.rebuilds).toBe(2);
    expect(view.front.worldHash()).toBe(ledgerOf(ref).worldHash());

    const live = await play(host, view, ref, inputs, 300, 700);
    expect(target.strokes).toBe(live);
    expect(view.front.worldHash()).toBe((await host.requestHash()).dustHash);
    expect(view.front.worldHash()).toBe(ledgerOf(ref).worldHash());
    await host.close("clock_out");
  });

  test("strokes that arrive during a sliced restore are applied before the ledger is published", async () => {
    const host = manualHost();
    await waitState(host, "running");
    const inputs = scriptedInputs(500, 0x10ad);
    for (let i = 0; i < 300; i++) {
      host.sendInput(inputs[i]!);
      host.stepManual(1);
      if (i % 2 === 0) await host.requestHash();
    }
    // A clock that jumps 1 ms per read: every pump runs at most one chunk, so the restore spans many ticks.
    let t = 0;
    const view = new SoloDustView({ grid: testGrid(), restoreBudgetMs: 0.5, now: () => (t += 1) });
    const target = new CountingTarget();
    view.bind(target);
    view.attach(host);
    await host.requestHash();
    for (let i = 300; i < 500; i++) {
      host.sendInput(inputs[i]!);
      host.stepManual(1);
      await host.requestHash();
      if (i === 450) view.pump(); // no rendered frame for 150 ticks (loading), then one budgeted slice
    }
    pumpAll(view);
    expect(view.isSynced).toBe(true);
    expect(view.stats.strokesQueued).toBeGreaterThan(0);
    expect(view.front.worldHash()).toBe((await host.requestHash()).dustHash);
    // Queued strokes are in the published ledger (rebuild snapshots), not sent live.
    expect(target.strokes).toBe(view.stats.strokesForwarded);
    expect(view.stats.strokesForwarded).toBe(view.stats.strokesApplied - view.stats.strokesQueued);
    await host.close("clock_out");
  });

  test("checkpoint -> crash -> reboot: the view rolls back with the worker through the rebuild path", async () => {
    const host = manualHost();
    const view = new SoloDustView({ grid: testGrid() });
    const target = new CountingTarget();
    view.bind(target);
    view.attach(host);
    await waitState(host, "running");
    const inputs = scriptedInputs(800);
    await play(host, view, null, inputs, 0, 400);
    await host.checkpoint("timer");
    const saved = await host.requestHash();
    expect(view.front.worldHash()).toBe(saved.dustHash);

    // 80 ticks that are never saved: the crash loses them in the worker, and the view must lose them too.
    await play(host, view, null, inputs, 400, 480);
    expect(view.front.worldHash()).not.toBe(saved.dustHash);
    const rebuildsBefore = target.rebuilds;
    host.crashWorkerForTest();
    await waitState(host, "booting");
    await waitState(host, "running");
    const after = await host.requestHash();
    expect(after).toEqual(saved);
    pumpAll(view);
    expect(view.front.worldHash()).toBe(saved.dustHash);
    expect(target.rebuilds).toBe(rebuildsBefore + 1);
    expect(view.stats.restores).toBeGreaterThanOrEqual(2);

    // And it follows the rebooted worker live.
    await play(host, view, null, inputs, 480, 800);
    expect(view.front.worldHash()).toBe((await host.requestHash()).dustHash);
    await host.close("clock_out");
  });
});
