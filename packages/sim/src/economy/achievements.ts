// Achievement triggers (scope-tiers section 1: MVP ships 3: First Light, Stamped, Shift Work). Each achievement in
// game-data names a `stat` and a `threshold`; the sim counts the stats it owns per actor and emits
// `achievement.unlocked` once per actor when a count reaches a threshold. Unlocks are profile facts (the profile layer
// stores them); the room saves only which ones it already announced per slot (`announcedMask`, META key list), so a
// restored room never announces one twice. Counts restart at 0 after a restore (MVP thresholds are 1 or presence).
//
// Stats the room sim feeds: `strokes` (accepted strokes), `plotsPolished` (Inspector's Stamps credited to the actor),
// `shiftPlayers` (members present in the shift). Achievements on other stats are ignored here until their systems
// exist. Allocation-free after construction.

import { MAX_PLAYERS_PER_ROOM } from "@moon-cleanup/shared";
import type { GameData } from "@moon-cleanup/game-data";

export const ACHIEVEMENT_STATS = ["strokes", "plotsPolished", "shiftPlayers"] as const;
export type AchievementStat = (typeof ACHIEVEMENT_STATS)[number];
/** Most achievements one room tracks (the announced mask is saved as one byte per slot). */
export const ACHIEVEMENT_TRACK_MAX = 8;
export const ACH_STAT_STROKES = 0;
export const ACH_STAT_PLOTS_POLISHED = 1;
export const ACH_STAT_SHIFT_PLAYERS = 2;

export class AchievementTracker {
  /** Tracked achievements (ids, stat index, threshold), in data order. */
  readonly ids: readonly string[];
  private readonly statOf: Uint8Array;
  private readonly threshold: Float64Array;
  /** Per actor and stat: current count. */
  private readonly counts = new Float64Array(MAX_PLAYERS_PER_ROOM * ACHIEVEMENT_STATS.length);
  /** Per actor: bitmask of announced achievements (index into `ids`). */
  private readonly announced = new Uint32Array(MAX_PLAYERS_PER_ROOM);

  /** `onUnlock(actor, achievementId)` is called once per actor and achievement. */
  constructor(
    data: GameData,
    trackedIds: readonly string[],
    private readonly onUnlock: (actor: number, achievementId: string) => void,
  ) {
    const wanted = new Set(trackedIds);
    const rows = data.achievements.achievements.filter(
      (a) => wanted.has(a.id) && (ACHIEVEMENT_STATS as readonly string[]).includes(a.stat),
    );
    this.ids = rows.slice(0, ACHIEVEMENT_TRACK_MAX).map((a) => a.id);
    this.statOf = Uint8Array.from(
      rows.slice(0, ACHIEVEMENT_TRACK_MAX).map((a) => ACHIEVEMENT_STATS.indexOf(a.stat as AchievementStat)),
    );
    this.threshold = Float64Array.from(rows.slice(0, ACHIEVEMENT_TRACK_MAX).map((a) => a.threshold));
  }

  /** Clears an actor slot (a new member joined it). */
  resetActor(actor: number): void {
    this.announced[actor] = 0;
    this.counts.fill(0, actor * ACHIEVEMENT_STATS.length, (actor + 1) * ACHIEVEMENT_STATS.length);
  }

  /** Bitmask of the achievements already announced for `actor` (index into `ids`). */
  announcedMask(actor: number): number {
    return this.announced[actor]!;
  }

  setAnnouncedMask(actor: number, mask: number): void {
    this.announced[actor] = mask & ((1 << this.ids.length) - 1);
  }

  add(actor: number, stat: number, delta: number): void {
    const k = actor * ACHIEVEMENT_STATS.length + stat;
    this.set(actor, stat, this.counts[k]! + delta);
  }

  set(actor: number, stat: number, value: number): void {
    this.counts[actor * ACHIEVEMENT_STATS.length + stat] = value;
    const done = this.announced[actor]!;
    for (let i = 0; i < this.ids.length; i++) {
      if (this.statOf[i] !== stat || (done >>> i) & 1 || value < this.threshold[i]!) continue;
      this.announced[actor] = this.announced[actor]! | (1 << i);
      this.onUnlock(actor, this.ids[i]!);
    }
  }
}
