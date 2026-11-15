// E14 worker lane: the RoomSim golden replay inside a real module Web Worker, the production sim worker (fixture cube,
// IndexedDB) in parity with a direct main-thread MoonRoomSim, and a realtime latency capture (E13 evidence start).
import { expect, test } from "vitest";
import type { RoomHostState } from "@moon-cleanup/shared";
import { LocalRoomHostImpl } from "../local-room-host";
import { spawnModuleWorker } from "../create-local-room-host";
import { WorldDustLedger } from "@moon-cleanup/world";
import type { MoonRoomSim } from "@moon-cleanup/sim";
import { TEST_CONTRACT, TEST_PLAYER, directSim, scriptedInputs } from "../test-support";
import { fixtureGround, fixtureWorld } from "./fixture-cube";

/**
 * packages/sim/test/golden/cases.ts GOLDEN_REPLAY: the script on the sim's stand-in ledger (recorded on Node 26.13.1,
 * M1-W3-T03; re-recorded for the M1-B1 Detailing cooldown fix and M1-W6-T02 Holster gating). A MoonRoomSim built
 * without a `ledger` option still runs the stand-in.
 */
const GOLDEN_REPLAY = { stateHash: 1076468633, strokeHash: 4164540033, strokes: 4023, gramsCollected: 55784 };

/**
 * packages/sim/test/golden/cases.ts GOLDEN_REPLAY_WORLD_LEDGER: the same script on the real dust ledger (recorded on
 * Node 26.13.1, M1-W3-T01b; that file explains every difference to GOLDEN_REPLAY).
 */
const GOLDEN_REPLAY_WORLD_LEDGER = {
  stateHash: 1838396500,
  strokeHash: 4164540033,
  strokes: 4023,
  gramsCollected: 66455,
  dustHash: 2469925789,
  ledgers: 24,
  polished: 0,
};

function dustHashOf(sim: MoonRoomSim): number {
  if (!(sim.ledger instanceof WorldDustLedger)) throw new Error("directSim must run the real dust ledger");
  return sim.ledger.worldHash();
}

function runGoldenInWorker(message: "go" | "go-world"): Promise<{ result: unknown; ms: number; inWorker: boolean }> {
  const w = new Worker(new URL("./golden.worker.ts", import.meta.url), { type: "module" });
  return new Promise<{ result: unknown; ms: number; inWorker: boolean }>((resolve, reject) => {
    w.onmessage = (e: MessageEvent) => resolve(e.data as { result: unknown; ms: number; inWorker: boolean });
    w.onerror = (e) => reject(new Error(e.message));
    w.postMessage(message);
  }).finally(() => w.terminate());
}

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

test("10,000-tick RoomSim golden replay inside a module Web Worker matches Node", async () => {
  const reply = await runGoldenInWorker("go");
  console.log(
    `[worker-golden] ${JSON.stringify(reply.result)} in ${reply.ms.toFixed(0)} ms (inWorker=${reply.inWorker})`,
  );
  expect(reply.inWorker).toBe(true);
  expect(reply.result).toEqual(GOLDEN_REPLAY);
});

test("10,000-tick RoomSim golden replay on the real dust ledger inside a module Web Worker matches Node", async () => {
  const reply = await runGoldenInWorker("go-world");
  console.log(
    `[worker-golden-world] ${JSON.stringify(reply.result)} in ${reply.ms.toFixed(0)} ms (inWorker=${reply.inWorker})`,
  );
  expect(reply.inWorker).toBe(true);
  expect(reply.result).toEqual(GOLDEN_REPLAY_WORLD_LEDGER);
});

test("production sim worker (fixture cube, IndexedDB) == direct MoonRoomSim over 2,000 ticks; checkpoint commits", async () => {
  const N = 2000;
  const host = new LocalRoomHostImpl({
    contractId: TEST_CONTRACT,
    player: TEST_PLAYER,
    world: fixtureWorld(),
    spawnWorker: spawnModuleWorker,
    clock: "manual",
    store: "indexeddb",
    dbName: `mc-sim-host-test-${Date.now()}`,
    restore: false,
    checkpointIntervalS: 0,
    statsIntervalMs: 0,
  });
  await waitState(host, "running");
  host.onFrame((f) => f.release());
  const ref = directSim(fixtureGround());
  for (const cmd of scriptedInputs(N, 0xbeef)) {
    host.sendInput(cmd);
    host.stepManual(1);
    if (cmd.seq % 2 === 0) await host.requestHash();
    ref.applyInput(0, cmd);
    ref.step(ref.config.dt);
  }
  const got = await host.requestHash();
  console.log(
    `[worker-parity] tick ${got.tick} hash ${got.hash} ref ${ref.stateHash()} dust ${got.dustHash} ref ${dustHashOf(ref)}`,
  );
  expect(got.tick).toBe(ref.tick);
  expect(got.hash).toBe(ref.stateHash());
  expect(got.dustHash).toBe(dustHashOf(ref));
  expect(got.dustHash).not.toBe(0);
  const meta = await host.checkpoint("timer");
  console.log(`[worker-ckpt] ${JSON.stringify(meta)} stats ${JSON.stringify(host.stats().worker)}`);
  expect(meta.generation).toBe(1);
  expect(meta.simTick).toBe(N);
  await host.close("clock_out");
  expect(host.state).toBe("closed");
});

test("IndexedDB reload: a new worker restores sim state and dust from the stored checkpoint and plays on in parity", async () => {
  const dbName = `mc-sim-host-reload-${Date.now()}`;
  const inputs = scriptedInputs(1500, 0xd057);
  const open = (restore: boolean, problems: string[]): LocalRoomHostImpl =>
    new LocalRoomHostImpl({
      contractId: TEST_CONTRACT,
      player: TEST_PLAYER,
      world: fixtureWorld(),
      spawnWorker: spawnModuleWorker,
      clock: "manual",
      store: "indexeddb",
      dbName,
      restore,
      checkpointIntervalS: 0,
      statsIntervalMs: 0,
      onRestoreProblem: (r) => problems.push(r),
    });
  const ref = directSim(fixtureGround());
  const play = async (host: LocalRoomHostImpl, from: number, to: number): Promise<void> => {
    for (let i = from; i < to; i++) {
      const cmd = inputs[i]!;
      host.sendInput(cmd);
      host.stepManual(1);
      if (cmd.seq % 2 === 0) await host.requestHash();
      ref.applyInput(0, cmd);
      ref.step(ref.config.dt);
    }
  };
  const want = (): { tick: number; hash: number; dustHash: number } => ({
    tick: ref.tick,
    hash: ref.stateHash(),
    dustHash: dustHashOf(ref),
  });

  // First session: a full dust save, then a checkpoint that writes only the changed chunks, then the tab closes.
  const first = open(false, []);
  await waitState(first, "running");
  first.onFrame((f) => f.release());
  await play(first, 0, 500);
  await first.checkpoint("timer");
  await play(first, 500, 1000);
  const meta = await first.checkpoint("hidden");
  expect(meta).toMatchObject({ generation: 2, simTick: 1000 });
  const saved = await first.requestHash();
  expect(saved).toEqual(want());
  expect(saved.dustHash).not.toBe(0);
  const s1 = first.stats().worker!;
  // The worker wrote to IndexedDB: the host got no in-memory copy.
  expect((first as unknown as { memoryCheckpoint: ArrayBuffer | null }).memoryCheckpoint).toBeNull();
  await first.close("error"); // no final checkpoint: the reload must come from the stored one

  // Second session (a page reload): same database, a new worker.
  const problems: string[] = [];
  const second = open(true, problems);
  await waitState(second, "running");
  second.onFrame((f) => f.release());
  expect(problems).toEqual([]);
  expect(second.generation).toBe(2);
  expect(await second.requestHash()).toEqual(saved);
  const s2 = second.stats().worker!;
  console.log(
    `[idb-reload] saved ${s1.dustChunksWritten} chunk rows (${s1.dustRawBytesWritten} B raw), capture last ` +
      `${s1.checkpointCaptureLastMs.toFixed(2)} ms, checkpoint p95 ${s1.checkpointP95Ms.toFixed(1)} ms; restored ` +
      `${s2.dustRestoreChunks} chunks / ${s2.dustRestoreLedgers} ledgers in ${s2.dustRestoreMs.toFixed(1)} ms, ` +
      `${s2.dustRestoreSlices} slices, max slice ${s2.dustRestoreSliceMaxMs.toFixed(2)} ms`,
  );
  expect(s2).toMatchObject({ dustRestoreRejected: 0, dustRestoreRepairs: 0 });
  expect(s2.dustRestoreChunks).toBeGreaterThan(0);
  await play(second, 1000, 1500);
  expect(await second.requestHash()).toEqual(want());
  // Checkpoints continue the lineage and write only what changed since the reload.
  expect((await second.checkpoint("timer")).generation).toBe(3);
  await second.close("clock_out");
});

test("realtime 20 Hz: input -> authoritative ack latency, host cost, worker tick time (E13 evidence)", async () => {
  const host = new LocalRoomHostImpl({
    contractId: TEST_CONTRACT,
    player: TEST_PLAYER,
    world: fixtureWorld(),
    spawnWorker: spawnModuleWorker,
    clock: "realtime",
    store: "memory",
    restore: false,
    statsIntervalMs: 250,
  });
  await waitState(host, "running");
  host.onFrame((f) => f.release());
  const inputs = scriptedInputs(200, 0xfeed);
  // Inputs at 60 Hz-frame cadence but one per sim tick (50 ms), off-phase with the worker clock.
  for (const cmd of inputs) {
    host.sendInput(cmd);
    await new Promise((r) => setTimeout(r, 50));
  }
  await host.requestHash();
  const s = host.stats();
  console.log(`[worker-latency] ${JSON.stringify(s)}`);
  expect(s.framesReceived).toBeGreaterThan(150);
  expect(s.ackLatencyP95Ms).toBeLessThan(100);
  expect(s.worker?.tickP95Ms ?? 99).toBeLessThan(10);
  await host.close("clock_out");
});
