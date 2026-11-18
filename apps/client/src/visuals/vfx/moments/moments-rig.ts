// Event wiring of the juicy moments (M1-W6-T03), three-free: game events -> `MomentFx` triggers. Own-player events only
// (plot.polished credited to us, our pours and sales), plus every Railshot (drawn at our avatar: the launcher's render
// position is not known here). Everything is event-driven: while nothing fires `update` is a clock add and `active` is
// false, so the host skips the grain and quad layers entirely (no solo cost, no allocation per frame).
//
// Positions: the Stamp wraps the plot (centre from the port), the pour and Railshot use the own avatar (pour: in front of
// the feet toward the heading; Railshot: at the feet, the Gate sits on the worksite). Visual placement is NOT verified (no
// GPU); a capture agent tunes `STAMP_RADIUS_M`, `POUR_REACH_M`.

import type { EventBus, EventMap, PlotId, Unsubscribe } from "@moon-cleanup/shared";
import { MOMENT_POUR, MOMENT_RAILSHOT, MOMENT_STAMP, type MomentFx } from "./moments";

/** Hex radius of the Stamp outline (m): a cleaned plot is outlined, its frame is 25.6 m across. */
export const STAMP_RADIUS_M = 6.4;
/** The pour lands this far in front of the feet (m). */
export const POUR_REACH_M = 1.4;
/** How long a pour emits ticks after `cargo.pour_started` (s; the audio loop stops after 6 s at most). */
export const POUR_SECONDS = 1.6;
/** Pour tick period (s). */
export const POUR_TICK_S = 0.12;
/** Longest grain flight (Railshot, 80 degrees at 5 m/s is 6.1 s) plus margin: layers stay on this long after a burst. */
export const GRAIN_BUSY_S = 7;

/** What the rig needs from the composition root. */
export interface MomentsPort {
  /** Slot of the local player (the one whose events draw). */
  ownSlot(): number;
  /** Own avatar feet (render space, +Y up) and heading (horizontal) into `out`; false before the first pose. No allocation. */
  avatar(out: AvatarSample): boolean;
  /** Plot centre in render space into `out`; false if the plot is not mapped. No allocation. */
  plotCentre(plot: PlotId, out: { x: number; y: number; z: number }): boolean;
}

export interface AvatarSample {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
}

export class MomentsRig {
  private clock = 0;
  private busyUntil = -1;
  private pourUntil = -1;
  private nextPour = 0;
  private readonly sample: AvatarSample = { x: 0, y: 0, z: 0, dirX: 0, dirZ: 1 };
  private readonly point = { x: 0, y: 0, z: 0 };
  private readonly offs: Unsubscribe[] = [];
  constructor(
    readonly fx: MomentFx,
    private readonly port: MomentsPort,
    events: Pick<EventBus, "on">,
  ) {
    this.offs.push(
      events.on("plot.polished", (p) => this.onStamp(p)),
      events.on("cargo.pour_started", (p) => this.onPourStart(p)),
      events.on("cargo.sold", (p) => this.onSold(p)),
      events.on("railshot.fired", () => this.onRailshot()),
    );
  }

  /** Something is animating or in the air: the layers must update and draw. */
  get active(): boolean {
    return this.fx.liveCount() > 0 || this.clock < this.busyUntil || this.clock < this.pourUntil;
  }

  /** Per frame (cheap while idle). Returns `active`. */
  update(dt: number): boolean {
    this.clock += dt;
    if (this.clock < this.pourUntil && this.clock >= this.nextPour) {
      this.nextPour = this.clock + POUR_TICK_S;
      this.pourTick();
    }
    if (this.fx.liveCount() > 0) this.fx.update(dt);
    return this.active;
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
  }

  private own(slot: number | null): boolean {
    return slot !== null && slot === this.port.ownSlot();
  }

  private busy(seconds: number): void {
    const until = this.clock + seconds;
    if (until > this.busyUntil) this.busyUntil = until;
  }

  private onStamp(p: EventMap["plot.polished"]): void {
    if (!this.own(p.creditedSlot)) return;
    const c = this.point;
    if (!this.port.plotCentre(p.plotId, c)) return;
    this.fx.trigger(MOMENT_STAMP, c.x, c.y, c.z, STAMP_RADIUS_M, c.y);
    this.busy(GRAIN_BUSY_S + 1.5); // the burst fires at emblem impact (0.8 s in)
  }

  private onPourStart(p: EventMap["cargo.pour_started"]): void {
    if (!this.own(p.actorSlot)) return;
    this.pourUntil = this.clock + POUR_SECONDS;
    this.nextPour = this.clock;
    this.busy(POUR_SECONDS + 3);
  }

  private onSold(p: EventMap["cargo.sold"]): void {
    if (p.source !== "assay_counter" || !this.own(p.actorSlot)) return;
    const a = this.sample;
    if (!this.port.avatar(a)) return;
    this.fx.trigger(MOMENT_POUR, a.x + a.dirX * POUR_REACH_M, a.y + 0.05, a.z + a.dirZ * POUR_REACH_M, 1, a.y);
  }

  private onRailshot(): void {
    const a = this.sample;
    if (!this.port.avatar(a)) return;
    this.fx.trigger(MOMENT_RAILSHOT, a.x, a.y, a.z, 1, a.y);
    this.busy(GRAIN_BUSY_S);
  }

  private pourTick(): void {
    const a = this.sample;
    if (!this.port.avatar(a)) return;
    // Thin arc from the lip (at the feet, 0.9 m up is not modelled: ground-based) toward the deck.
    this.fx.pourTick(a.x, a.y + 0.9, a.z, a.dirX, a.dirZ, a.y);
  }
}
