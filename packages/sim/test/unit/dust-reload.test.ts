// A reload on the real dust ledger: the sim checkpoint (META + PLAYERS) plus the dust chunk payloads are everything a
// host stores. Restoring both into a fresh sim and a fresh ledger must continue exactly like the run that was never
// interrupted (state hash, stroke hash, grams and dust hash of the recorded golden).
import { describe, expect, test } from "vitest";
import { encodeDustChunks, restoreDustChunks, WorldDustLedger } from "@moon-cleanup/world";
import type { MoonRoomSim } from "../../src/index";
import { GOLDEN_REPLAY_WORLD_LEDGER } from "../golden/cases";
import { GOLDEN_TICKS, GoldenRun } from "../golden/replay";
import { makeSim, makeWorldLedger, PLAYER, testWorld } from "../support/world";

const BAKE_CHECK = 0x5a;
const POINTS = [1, 137, 399, 400, 421, 1500, 2500, 5003, 7777, GOLDEN_TICKS - 1];

function twoActorSim(ledger: WorldDustLedger): MoonRoomSim {
  const sim = makeSim(testWorld(), { ledger });
  sim.addActor(0, PLAYER);
  sim.addActor(1, { ...PLAYER, displayName: "Second" });
  return sim;
}

function ledgerOf(sim: MoonRoomSim): WorldDustLedger {
  if (!(sim.ledger instanceof WorldDustLedger)) throw new Error("expected the real ledger");
  return sim.ledger;
}

/** Runs the golden script and reloads at POINTS. `withDust` false leaves the dust out (the pre-T01b behaviour). */
function runWithReloads(withDust: boolean): { run: GoldenRun; reloads: number; chunkWrites: number } {
  const run = new GoldenRun(undefined, makeWorldLedger());
  const points = new Set(POINTS);
  /** The host's chunk rows: newest payload per chunk id. Only dirty chunks are written at each save. */
  const stored = new Map<number, Uint8Array>();
  let reloads = 0;
  let chunkWrites = 0;
  for (let t = 0; t < GOLDEN_TICKS; t++) {
    if (points.has(t)) {
      const old = run.sim;
      const oldLedger = ledgerOf(old);
      const ck = old.captureCheckpoint();
      const checkpoint = { ...ck, meta: ck.meta.slice(), players: ck.players.slice() };
      for (const c of encodeDustChunks(oldLedger, BAKE_CHECK, true)) {
        expect(c.oversize).toBe(false);
        stored.set(c.chunkId, c.payload);
        oldLedger.clearChunkDirty(c.chunkId);
        chunkWrites++;
      }
      expect(oldLedger.dirtyChunkCount).toBe(0);

      const ledger = makeWorldLedger();
      if (withDust) {
        const res = restoreDustChunks(ledger, [...stored.values()], BAKE_CHECK);
        expect(res).toMatchObject({
          ok: true,
          chunksRejected: 0,
          texelsRepaired: 0,
          headerMismatches: 0,
          stateMismatches: 0,
          logsDropped: 0,
          recordsSkipped: 0,
        });
        expect(res.chunksRestored).toBe(stored.size);
        expect(ledger.worldHash()).toBe(oldLedger.worldHash());
        expect(ledger.ledgerCount).toBe(oldLedger.ledgerCount);
        expect(ledger.polishedTotal).toBe(oldLedger.polishedTotal);
        // A restore replays no Stamp / Opened event and leaves nothing to save again.
        expect(ledger.polishedQueueCount).toBe(0);
        expect(ledger.openedQueueCount).toBe(0);
        expect(ledger.dirtyChunkCount).toBe(0);
      }
      const fresh = twoActorSim(ledger);
      expect(fresh.restoreCheckpoint(checkpoint).ok).toBe(true);
      expect(fresh.stateHash()).toBe(old.stateHash());
      run.attach(fresh);
      reloads++;
    }
    run.step();
  }
  return { run, reloads, chunkWrites };
}

describe("reload on the real dust ledger", { timeout: 120_000 }, () => {
  test("sim checkpoint + dust chunks at 10 points: the run ends on the recorded golden hashes", () => {
    const { run, reloads, chunkWrites } = runWithReloads(true);
    expect(reloads).toBe(POINTS.length);
    expect(chunkWrites).toBeGreaterThan(0);
    expect(run.result()).toEqual(GOLDEN_REPLAY_WORLD_LEDGER);
  });

  test("control: the same reloads without the dust chunks do not reproduce the golden (dust came back)", () => {
    const { run } = runWithReloads(false);
    const got = run.result() as typeof GOLDEN_REPLAY_WORLD_LEDGER;
    expect(got.stateHash).not.toBe(GOLDEN_REPLAY_WORLD_LEDGER.stateHash);
    expect(got.dustHash).not.toBe(GOLDEN_REPLAY_WORLD_LEDGER.dustHash);
  });
});
