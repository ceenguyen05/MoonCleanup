// Event-to-cue wiring: subscribes to exactly the events of shared/audio/cues.ts AUDIO_EVENT_CUES and turns each payload
// into cue plays, loop updates, music state and ducking, through the small `AudioActions` interface (so tests can use a
// recording fake). Events are notifications: nothing here reads or mutates sim state; the only outside reads are the
// player's own slot and the clock, supplied by the module.

import {
  AUDIO_EVENT_CUES,
  AUDIO_OTHERS_TOOLS_INDIVIDUAL_MAX,
  AUDIO_STAMP_STREAK_WINDOW_S,
  type AudioCueId,
  type DayPhase,
  type DotContour,
  type EventBus,
  type EventMap,
  type Unsubscribe,
} from "@moon-cleanup/shared";
import type { CuePlayParams, LoopHandle, PlayOptions } from "./player";
import type { DuckReason } from "./ducking";
import { hashString } from "./dsp";

export interface AudioActions {
  play(id: AudioCueId, params: CuePlayParams, opts?: PlayOptions): boolean;
  startLoop(id: AudioCueId, params: CuePlayParams, opts?: PlayOptions): LoopHandle | null;
  updateLoop(h: LoopHandle, id: AudioCueId, params: CuePlayParams, opts?: PlayOptions): void;
  stopLoop(h: LoopHandle, fadeS?: number): void;
  isAlive(h: LoopHandle): boolean;
  setAirborne(airborne: boolean): void;
  setMusicPhase(phase: DayPhase): void;
  musicActivity(nowS: number): void;
  musicMelody(on: boolean): void;
  duckPulse(reason: DuckReason, durationS: number): void;
  setDuckFlag(reason: DuckReason, on: boolean): void;
  /** Slot of the local player (the audio listener). */
  mySlot(): number;
  nowS(): number;
}

/** A sale at or above this many Lumens plays the big ka-ching (tunable; the economy lives in game-data). */
export const BIG_SALE_LM = 250;
/** Fall speed (m/s) mapped to impact01 = 1. */
export const LAND_IMPACT_FULL_MPS = 6;
/** Seconds without a stroke / dust event before the matching loop fades out. */
export const SWEEP_IDLE_S = 0.2;
export const HISS_IDLE_S = 0.45;
export const POUR_MAX_S = 6;
const OTHERS_GAIN = 0.5;
const MAX_SLOTS = 8;
const STAMP_RING = 16;

type Handlers = { [E in keyof typeof AUDIO_EVENT_CUES]: (p: EventMap[E]) => void };

interface LoopState {
  handle: LoopHandle | null;
  lastS: number;
  value: number;
}

export class EventRouter {
  private readonly sweep: LoopState[] = [];
  private readonly lastFill = new Float32Array(MAX_SLOTS);
  private readonly hiss: LoopState = { handle: null, lastS: 0, value: 0 };
  private readonly pour: LoopState = { handle: null, lastS: 0, value: 0 };
  private readonly drive: LoopState = { handle: null, lastS: 0, value: 0 };
  private readonly breathing: LoopState = { handle: null, lastS: 0, value: 0 };
  private readonly stampTimes = new Float64Array(STAMP_RING).fill(-1e9);
  private stampHead = 0;
  private readonly saleTimes = new Float64Array(STAMP_RING).fill(-1e9);
  private saleHead = 0;
  private effort = 0;
  private nightApplied = 0;
  private nightness = 0;
  private suitBed: LoopHandle | null = null;
  private unsubs: Unsubscribe[] = [];
  private readonly sweepParams = { toolId: "", speed01: 0, grime01: 0, fill01: 0, dry: false };
  private readonly loopParams = {
    fill01: 0,
    rate01: 1,
    speed01: 0.4,
    load01: 0,
    effort01: 0,
    night01: 0,
    farSide01: 0,
  };

  constructor(private readonly a: AudioActions) {
    for (let i = 0; i < MAX_SLOTS; i++) this.sweep.push({ handle: null, lastS: 0, value: 0 });
  }

  private readonly handlers: Handlers = {
    "tool.stroke_contact": (p) => this.onStroke(p.actorSlot, p.speedMps, p.grime01, p.dry),
    "cell.near_full": (p) => {
      if (this.own(p.actorSlot)) this.a.play("cell.near_full", {});
    },
    "cell.full": (p) => {
      if (this.own(p.actorSlot)) this.a.play("cell.full", {});
    },
    "dust.collected": (p) => this.onDust(p.actorSlot, p.cellGrams, p.cellCapGrams),
    "lane.locked": (p) => {
      if (this.own(p.actorSlot)) this.a.play("tool.lane_lock", {});
    },
    "lane.unlocked": (p) => {
      if (this.own(p.actorSlot)) this.a.play("tool.lane_unlock", {});
    },
    "plot.opened": () => {
      this.a.play("plot.open_blip", {}, { gain: 0.7, other: true });
    },
    "plot.polished": (p) => this.onStamp(this.own(p.creditedSlot), p.charged),
    "shine.milestone": (p) => {
      if (p.pct === 100) this.a.play("music.stinger_fulfilled", {});
      else this.a.play("music.stinger_shine", { pct: p.pct });
      this.a.duckPulse("stamp", 2.5);
      if (p.pct >= 25) this.a.musicMelody(true);
    },
    "cargo.puck_formed": (p) => this.a.play("cargo.puck_press", {}, this.opts(p.actorSlot)),
    "cargo.stack_banded": (p) => this.a.play("cargo.stack_band", { pucks: p.pucks }, this.opts(p.actorSlot)),
    "cargo.picked_up": (p) => this.a.play("cargo.pick_up", {}, this.opts(p.actorSlot)),
    "cargo.thrown": (p) => this.a.play("cargo.throw", {}, this.opts(p.actorSlot)),
    "cargo.pour_started": (p) => this.onPourStart(p.actorSlot),
    "cargo.sold": (p) => this.onSold(p.source, p.actorSlot, p.lm),
    "railshot.fired": (p) => {
      void p;
      this.a.play("railshot.charge", {});
      this.a.play("railshot.thoom", { distance01: 0.2 }, { delayS: 2 });
      this.a.play("railshot.away", {}, { delayS: 2.6 });
      this.a.duckPulse("stamp", 3.4);
    },
    "purchase.completed": (p) => {
      if (this.own(p.actorSlot)) this.a.play("ui.purchase", {});
    },
    "purchase.rejected": (p) => {
      if (this.own(p.actorSlot)) this.a.play("ui.reject", {});
    },
    "unlock.granted": () => {
      this.a.play("music.stinger_unlock", {});
      this.a.play("ui.unlock", {}, { delayS: 0.1 });
    },
    "robot.deployed": (p) => {
      this.a.play("robot.deploy", { kindId: p.kindId }, { other: true });
    },
    "robot.state_changed": (p) => {
      if (p.alert) this.a.play("robot.alert", {});
      else if (p.state === "patch_picked_clean") this.a.play("robot.plot_done", {}, { other: true });
    },
    "vehicle.entered": (p) => this.onVehicle(p.actorSlot, p.kindId, true),
    "vehicle.exited": (p) => this.onVehicle(p.actorSlot, p.kindId, false),
    "avatar.jumped": (p) => {
      if (!this.own(p.actorSlot)) return;
      this.a.setAirborne(true);
      this.a.play("avatar.jump", {});
      this.effort = Math.min(1, this.effort + 0.5);
    },
    "avatar.landed": (p) => {
      if (!this.own(p.actorSlot)) return;
      this.a.setAirborne(false);
      this.a.play("avatar.land", {
        impact01: Math.min(1, Math.max(0, p.impactMps / LAND_IMPACT_FULL_MPS)),
        surface: p.onClean ? "clean" : "grime",
      });
      this.effort = Math.min(1, this.effort + 0.25);
    },
    "collectible.found": (p) => {
      if (this.own(p.actorSlot)) this.a.play("ui.find", {});
    },
    "onboarding.step_completed": () => {
      this.a.play("ui.check", {});
    },
    "achievement.unlocked": () => {
      this.a.play("ui.achievement", {});
    },
    "daynight.changed": (p) => {
      this.a.setMusicPhase(p.phase);
      this.nightness = p.phase === "night" ? 1 : p.phase === "dusk" || p.phase === "dawn" ? 0.5 : 0;
    },
    "dot.message": (p) => this.onDot(p.textId, p.priority),
  };

  /** Subscribes to every event of AUDIO_EVENT_CUES. */
  attach(bus: EventBus): void {
    this.detach();
    const on = bus.on as unknown as (name: string, listener: (payload: never) => void) => Unsubscribe;
    for (const name of Object.keys(AUDIO_EVENT_CUES) as (keyof Handlers)[]) {
      this.unsubs.push(on.call(bus, name, this.handlers[name] as (payload: never) => void));
    }
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  /** Event names this router handles (tests compare it to AUDIO_EVENT_CUES). */
  handledEvents(): readonly string[] {
    return Object.keys(this.handlers);
  }

  /** Starts the always-on beds (suit bed, breathing). Called once the context runs. */
  startBeds(): void {
    if (this.suitBed === null || !this.a.isAlive(this.suitBed)) {
      this.suitBed = this.a.startLoop("ambience.suit_bed", { night01: 0, farSide01: 0 });
    }
    if (this.breathing.handle === null || !this.a.isAlive(this.breathing.handle)) {
      this.breathing.handle = this.a.startLoop("ambience.breathing", { effort01: 0 });
    }
  }

  /** Per-frame (rate-limited by the module): ends idle loops, settles breathing, follows the day phase. */
  tick(nowS: number, dtS: number): void {
    for (let i = 0; i < this.sweep.length; i++) {
      const s = this.sweep[i];
      if (s?.handle != null && nowS - s.lastS > SWEEP_IDLE_S) {
        this.a.stopLoop(s.handle, 0.12);
        s.handle = null;
      }
    }
    if (this.hiss.handle !== null && nowS - this.hiss.lastS > HISS_IDLE_S) {
      this.a.stopLoop(this.hiss.handle, 0.15);
      this.hiss.handle = null;
    }
    if (this.pour.handle !== null && nowS - this.pour.lastS > POUR_MAX_S) {
      this.a.stopLoop(this.pour.handle, 0.2);
      this.pour.handle = null;
    }
    // Breathing settles over about 5 s (audio-direction §3).
    this.effort = Math.max(0, this.effort - dtS / 5);
    if (this.breathing.handle !== null && Math.abs(this.effort - this.breathing.value) > 0.02) {
      this.breathing.value = this.effort;
      this.loopParams.effort01 = this.effort;
      this.a.updateLoop(this.breathing.handle, "ambience.breathing", this.loopParams, { gain: 1 });
    }
    if (this.suitBed !== null && Math.abs(this.nightness - this.nightApplied) > 0.01) {
      this.nightApplied = this.nightness;
      this.loopParams.night01 = this.nightness;
      this.a.updateLoop(this.suitBed, "ambience.suit_bed", this.loopParams);
    }
  }

  dispose(): void {
    this.detach();
  }

  // ---- handlers ----

  private own(slot: number | null): boolean {
    return slot !== null && slot === this.a.mySlot();
  }

  private opts(slot: number | null): PlayOptions | undefined {
    return this.own(slot) ? undefined : { gain: OTHERS_GAIN, other: true };
  }

  private othersLoopCount(): number {
    let n = 0;
    for (let i = 0; i < this.sweep.length; i++) if (i !== this.a.mySlot() && this.sweep[i]?.handle != null) n++;
    return n;
  }

  private onStroke(slot: number, speedMps: number, grime01: number, dry: boolean): void {
    const state = this.sweep[slot];
    if (state === undefined) return;
    const now = this.a.nowS();
    state.lastS = now;
    const own = this.own(slot);
    if (own) this.a.musicActivity(now);
    const params = this.sweepParams;
    params.speed01 = Math.min(1, Math.max(0, speedMps / 4));
    params.grime01 = grime01;
    params.fill01 = this.lastFill[slot] ?? 0;
    params.dry = dry;
    const opts: PlayOptions | undefined = own ? undefined : { gain: OTHERS_GAIN, other: true };
    if (state.handle !== null && this.a.isAlive(state.handle)) {
      this.a.updateLoop(state.handle, "tool.sweep", params, opts);
      return;
    }
    if (!own && this.othersLoopCount() >= AUDIO_OTHERS_TOOLS_INDIVIDUAL_MAX) return;
    state.handle = this.a.startLoop("tool.sweep", params, opts);
  }

  private onDust(slot: number, cellGrams: number, capGrams: number): void {
    const fill = capGrams > 0 ? Math.min(1, cellGrams / capGrams) : 0;
    if (slot >= 0 && slot < MAX_SLOTS) this.lastFill[slot] = fill;
    if (!this.own(slot)) return;
    this.hiss.lastS = this.a.nowS();
    this.loopParams.fill01 = fill;
    if (this.hiss.handle !== null && this.a.isAlive(this.hiss.handle)) {
      this.a.updateLoop(this.hiss.handle, "cell.fill_hiss", this.loopParams);
    } else {
      this.hiss.handle = this.a.startLoop("cell.fill_hiss", this.loopParams);
    }
  }

  private onStamp(own: boolean, charged: boolean): void {
    const now = this.a.nowS();
    let streak = 1;
    if (own) {
      for (let i = 0; i < STAMP_RING; i++)
        if (now - (this.stampTimes[i] ?? -1e9) <= AUDIO_STAMP_STREAK_WINDOW_S) streak++;
      this.stampTimes[this.stampHead] = now;
      this.stampHead = (this.stampHead + 1) % STAMP_RING;
    }
    this.a.play("plot.stamp", { streak, charged, own }, own ? undefined : { gain: OTHERS_GAIN, other: true });
    this.a.duckPulse("stamp", 1.4);
    if (own) this.a.play("ui.lumen_tick", { streak01: Math.min(1, (streak - 1) / 7) }, { delayS: 0.12 });
  }

  private onPourStart(slot: number): void {
    const own = this.own(slot);
    if (this.pour.handle !== null) this.a.stopLoop(this.pour.handle, 0.05);
    this.pour.lastS = this.a.nowS();
    this.pour.handle = this.a.startLoop(
      "assay.pour",
      { rate01: 0.8 },
      own ? undefined : { gain: OTHERS_GAIN, other: true },
    );
  }

  private onSold(source: string, slot: number | null, lm: number): void {
    const own = this.own(slot);
    if (source === "assay_counter") {
      if (this.pour.handle !== null) {
        this.a.stopLoop(this.pour.handle, 0.12);
        this.pour.handle = null;
      }
      this.a.play("assay.ka_ching", { big: lm >= BIG_SALE_LM }, own ? undefined : { gain: OTHERS_GAIN, other: true });
    } else if (source === "receiving_gate") {
      this.a.play("gate.blip", {}, own ? undefined : { gain: OTHERS_GAIN, other: true });
    }
    if (own) {
      const now = this.a.nowS();
      let streak = 0;
      for (let i = 0; i < STAMP_RING; i++)
        if (now - (this.saleTimes[i] ?? -1e9) <= AUDIO_STAMP_STREAK_WINDOW_S) streak++;
      this.saleTimes[this.saleHead] = now;
      this.saleHead = (this.saleHead + 1) % STAMP_RING;
      this.a.play("ui.lumen_tick", { streak01: Math.min(1, streak / 8) }, { delayS: 0.14 });
    }
  }

  private onVehicle(slot: number, kindId: string, entered: boolean): void {
    if (!this.own(slot)) return;
    this.a.setDuckFlag("vehicle", entered);
    if (entered) {
      this.a.play("vehicle.enter", { kindId });
      this.loopParams.speed01 = 0.4;
      this.drive.handle = this.a.startLoop("vehicle.drive_loop", {
        kindId,
        speed01: 0.4,
        load01: 0,
      });
    } else {
      this.a.play("vehicle.exit", { kindId });
      if (this.drive.handle !== null) this.a.stopLoop(this.drive.handle, 0.3);
      this.drive.handle = null;
    }
  }

  private onDot(textId: string, priority: "action" | "progress" | "ambient"): void {
    const syllables = 3 + (hashString(textId) % 6);
    const contour: DotContour = priority === "action" ? "rise" : priority === "ambient" ? "fall" : "flat";
    this.a.play("dot.bloop", {});
    this.a.play("dot.chirp", { syllables, contour }, { delayS: 0.32 });
    this.a.duckPulse("dot", 0.32 + syllables * 0.1 + 0.25);
  }
}
