// Ducking rules (audio-direction §5.3). Reasons are either timed (a DOT line, a Stamp) or flags (a panel is open, the
// player rides a vehicle). `apply` sums the active reasons per bus and only touches Web Audio when a bus value
// changes. Fixed-size tables, no allocation per call.

import type { AudioBus } from "@moon-cleanup/shared";

export const DUCK_REASONS = ["dot", "stamp", "panel", "vehicle"] as const;
export type DuckReason = (typeof DUCK_REASONS)[number];

interface Rule {
  readonly buses: readonly AudioBus[];
  readonly db: number;
  readonly attackS: number;
  readonly releaseS: number;
}

export const DUCK_RULES: Readonly<Record<DuckReason, readonly Rule[]>> = {
  dot: [
    { buses: ["music"], db: -6, attackS: 0.08, releaseS: 0.4 },
    { buses: ["ambience"], db: -4, attackS: 0.08, releaseS: 0.4 },
    { buses: ["world"], db: -3, attackS: 0.08, releaseS: 0.4 },
  ],
  stamp: [{ buses: ["music"], db: -4, attackS: 0.03, releaseS: 0.6 }],
  panel: [{ buses: ["world", "tools"], db: -6, attackS: 0.1, releaseS: 0.3 }],
  vehicle: [{ buses: ["ambience"], db: -4, attackS: 0.2, releaseS: 0.4 }],
};

const DUCKED_BUSES: readonly AudioBus[] = ["music", "ambience", "world", "tools"];

export type DuckSink = (bus: AudioBus, db: number, attackS: number, releaseS: number) => void;

export class Ducker {
  private readonly until: Record<DuckReason, number> = { dot: 0, stamp: 0, panel: 0, vehicle: 0 };
  private readonly flag: Record<DuckReason, boolean> = { dot: false, stamp: false, panel: false, vehicle: false };
  private readonly applied: Record<string, number> = {};

  constructor(private readonly sink: DuckSink) {}

  /** Ducks for `durationS` from `nowS` (extends an active duck). */
  pulse(reason: DuckReason, nowS: number, durationS: number): void {
    this.until[reason] = Math.max(this.until[reason], nowS + durationS);
  }

  setFlag(reason: DuckReason, on: boolean): void {
    this.flag[reason] = on;
  }

  isActive(reason: DuckReason, nowS: number): boolean {
    return this.flag[reason] || nowS < this.until[reason];
  }

  apply(nowS: number): void {
    for (const bus of DUCKED_BUSES) {
      let db = 0;
      let attack = 0.1;
      let release = 0.4;
      for (const reason of DUCK_REASONS) {
        if (!this.isActive(reason, nowS)) continue;
        for (const rule of DUCK_RULES[reason]) {
          if (!rule.buses.includes(bus)) continue;
          db += rule.db;
          attack = Math.min(attack, rule.attackS);
          release = Math.max(release, rule.releaseS);
        }
      }
      if (this.applied[bus] !== db) {
        this.applied[bus] = db;
        this.sink(bus, db, attack, release);
      }
    }
  }
}
