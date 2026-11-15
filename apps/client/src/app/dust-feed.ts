// `?scene=dust` with the Solo host (M1-W3-T02b), composition-root side: the host's main-thread dust ledger view
// (sim-host `SoloDustView`) adapted to the visuals `DustFeedPort`, the host options of the scene (its own Contract
// identity, memory store, spawn on the scene's site plot) and a scripted sweeper that drives the host's input like a
// player would until the gameplay/input module exists. Nothing here runs per rendered frame: the view works in the
// host's frame message handler and in `pump()` (called by the dust scene), the sweeper on a 50 ms timer.

import { INPUT_BUTTON_MASK, type PlotId, type SimInputCommand } from "@moon-cleanup/shared";
import type { DustFeedPort } from "../visuals";
import type { CreateLocalRoomHostOptions, SoloDustView } from "../sim-host";
import type { KeyValueStore } from "./solo-host";

/** Storage key prefix of the dust scene's own Solo Contract identity (never the player's real Contract). */
export const DUST_SCENE_STORAGE_PREFIX = "mc.dustScene.";

/** A key-value store whose keys carry `prefix` (a second identity next to the game's). */
export function prefixedStore(storage: KeyValueStore | null, prefix: string): KeyValueStore | null {
  if (storage === null) return null;
  return {
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
  };
}

/** The visuals port over the ledger view; `info()` feeds `__mcLook.info().dustFeed`. */
export function createDustFeedPort(
  view: SoloDustView,
  sitePlot: number,
  extra: () => Readonly<Record<string, number>> = () => ({}),
): DustFeedPort {
  return {
    grid: view.grid,
    ledger: view.ledger,
    sitePlot,
    bind: (target) => view.bind(target),
    pump: () => view.pump(),
    info: () => ({
      synced: view.isSynced,
      restoring: view.restoring,
      selfTick: view.selfTick,
      ...view.stats,
      ...extra(),
    }),
  };
}

/**
 * Host options of the dust scene: memory store (every page load starts on a fresh moon with an empty Dust Cell; a
 * worker crash still reboots from the in-memory checkpoint copies) and the spawn on the scene's site plot, so the
 * strokes land on the scene's ground patch.
 */
export function dustSceneHostOptions(view: SoloDustView, sitePlot: number): Partial<CreateLocalRoomHostOptions> {
  const dir = { x: 0, y: 0, z: 1 };
  view.grid.fromPlotLocal(sitePlot as PlotId, 0, 0, dir);
  return {
    store: "memory",
    dbName: "moon-cleanup-dust-scene",
    fresh: { walletLm: undefined, spawnDirection: dir },
  };
}

/** Segments of the sweeper path: [ticks, yaw codes per tick, forward stick]. Full turns, then a side of a square. */
const SWEEP_PATH: readonly (readonly [number, number, number])[] = [
  [256, 512, 127], // two turns, radius about 1 m per m/s of walking speed
  [192, 1024, 127], // three tighter turns
  [40, 0, 127], // a straight side
  [16, 1024, 127], // a quarter turn: four cycles close the square, so the path stays near the site
];

type MutableInput = { -readonly [K in keyof SimInputCommand]: SimInputCommand[K] };

export interface InputSink {
  readonly state: string;
  sendInput(cmd: SimInputCommand): void;
}

/**
 * Scripted sweeper for the dust scene: one input per 50 ms (the 20 Hz sim step) with the primary tool held, walking
 * the closed SWEEP_PATH. One reused command object (the host encodes it synchronously). Dev scene only.
 */
export class DustSceneSweeper {
  private readonly cmd: MutableInput = {
    seq: 0,
    moveX: 0,
    moveY: 0,
    yaw: 0,
    pitch: -20,
    buttons: INPUT_BUTTON_MASK.toolPrimary,
    toolParam: 180,
  };
  private segment = 0;
  private left = SWEEP_PATH[0]![0];
  private timer: ReturnType<typeof setInterval> | null = null;
  sent = 0;

  constructor(private readonly host: InputSink) {}

  /** One input (exposed for tests); nothing before the host runs. */
  step(): void {
    if (this.host.state !== "running") return;
    const seg = SWEEP_PATH[this.segment]!;
    const c = this.cmd;
    c.seq = (c.seq + 1) & 0xffff;
    c.yaw = (c.yaw + seg[1]) & 0xffff;
    c.moveY = seg[2];
    this.host.sendInput(c);
    this.sent++;
    if (--this.left === 0) {
      this.segment = (this.segment + 1) % SWEEP_PATH.length;
      this.left = SWEEP_PATH[this.segment]![0];
    }
  }

  start(): void {
    if (this.timer === null) this.timer = setInterval(() => this.step(), 50);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
