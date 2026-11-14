import { checkHashes, makeBots } from "./common";
import type { ContestCommon } from "./common";
import type { DustContestTarget } from "./target";

export interface S6Options extends ContestCommon {
  readonly bots?: number;
  /** Simulated seconds of cleaning before the forced restart. */
  readonly beforeSeconds?: number;
  /** Simulated seconds of cleaning after the restore (proves the world is live and consistent). */
  readonly afterSeconds?: number;
  readonly persistEverySec?: number;
}

export interface S6Result {
  /** False when the target does not implement persist/crash/restore. */
  readonly supported: boolean;
  readonly crashTick: number;
  readonly restoredTick: number;
  readonly lostSeconds: number;
  readonly restoreMs: number;
  /** Restored hash equals the hash recorded when that tick was persisted. */
  readonly restoredHashConsistent: boolean;
  /** After rejoin and the after-phase, the share of client hashes equal to the server hash. */
  readonly postRestoreHashMatchPct: number;
}

/** S6: forced restart mid-session, restore from durable state (world-and-dust sections 10 and 11). */
export async function runS6(target: DustContestTarget, o: S6Options): Promise<S6Result> {
  const { persist, crash, restore } = target;
  if (!persist || !crash || !restore) {
    return {
      supported: false,
      crashTick: 0,
      restoredTick: 0,
      lostSeconds: 0,
      restoreMs: 0,
      restoredHashConsistent: false,
      postRestoreHashMatchPct: 0,
    };
  }
  const n = o.bots ?? 4;
  const hz = target.simTickHz;
  const bots = makeBots(o, n);
  for (const b of bots) await target.joinClient(b.id);
  const persisted = new Map<number, number>();
  const persistEvery = Math.max(1, Math.round((o.persistEverySec ?? 10) * hz));
  const before = Math.round((o.beforeSeconds ?? 60) * hz);
  let t = 0;
  while (t < before) {
    t++;
    for (const b of bots) target.submitStroke(b.id, b.next(t));
    await target.advance(1);
    if (t % persistEvery === 0) {
      const p = await persist.call(target);
      persisted.set(p.tick, p.hash);
    }
  }
  const crashTick = t;
  await crash.call(target);
  const r = await restore.call(target);
  for (const b of bots) {
    await target.leaveClient(b.id);
    await target.joinClient(b.id);
  }
  const after = Math.round((o.afterSeconds ?? 20) * hz);
  t = r.tick;
  for (let k = 0; k < after; k++) {
    t++;
    for (const b of bots) target.submitStroke(b.id, b.next(t));
    await target.advance(1);
  }
  const c = checkHashes(
    target,
    bots.map((b) => b.id),
  );
  return {
    supported: true,
    crashTick,
    restoredTick: r.tick,
    lostSeconds: (crashTick - r.tick) / hz,
    restoreMs: r.restoreMs,
    restoredHashConsistent: persisted.get(r.tick) === r.hash,
    postRestoreHashMatchPct: c.total === 0 ? 0 : (100 * c.match) / c.total,
  };
}
