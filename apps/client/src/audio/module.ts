// `audio` ClientModule. Composition: AudioEnv (browser seam) -> AudioContext created suspended at idle after boot (gesture only resumes) ->
// AudioGraph + BufferStore + VoiceManager + CuePlayer + MusicDirector + EventRouter. Audio is driven only by the typed
// event bus (and the UI store for volumes and open menus); it never mutates sim state and never reads it.
//
// Cost: `update` does arithmetic and a handful of parameter writes at 30 Hz at most, with no allocation. Buffer
// rendering is spread out by the env scheduler between frames, pad rendering by `MusicDirector.tick` in 1024-sample
// slices.

import {
  AUDIO_VOICE_CAP,
  type AudioCueId,
  type ClientModule,
  type DayPhase,
  type FrameInfo,
  type HardwareTier,
  type ModuleContext,
  type ServiceTypes,
  type Unsubscribe,
} from "@moon-cleanup/shared";
import { BufferStore, type CueRenderRemote, type RenderReply, type RenderRequest } from "./buffer-store";
import { Ducker } from "./ducking";
import { EventRouter, type AudioActions } from "./event-router";
import { AudioGraph, GROUND_MUFFLE_HZ, PANEL_MUFFLE_HZ, type VolumeSettings } from "./graph";
import { MusicDirector } from "./music";
import { CuePlayer, type CuePlayParams, type LoopHandle, type PlayOptions } from "./player";
import { VoiceManager } from "./voice-manager";
import type { AContext } from "./webaudio-types";

/** The browser seam. Real implementation: `browserEnv`; tests pass a fake. */
export interface AudioEnv {
  createContext(): AContext;
  /** Registers a one-shot-per-gesture listener (pointerdown, keydown, touchend). Returns the remover. */
  onGesture(listener: () => void): () => void;
  onVisibility(listener: (hidden: boolean) => void): () => void;
  isHidden(): boolean;
  later(fn: () => void, ms: number): void;
  /**
   * Runs `fn` once when the main thread is idle (after boot), never on the first-gesture path. Absent: the module
   * falls back to `later`. The context is created here, suspended, so the gesture only has to call `resume()`.
   */
  idle?(fn: () => void): void;
  nowMs(): number;
  /** Optional off-thread cue renderer (a Worker in the browser). Absent: cues render on the main thread in slices. */
  createRenderer?(): CueRenderRemote | null;
}

export interface AudioModuleOptions {
  readonly env: AudioEnv;
  /** Hardware tier until `render.backendSelected` reports one. */
  readonly tier?: HardwareTier;
  /** Called for cues a caption would describe (accessibility hook). */
  readonly onCaption?: (id: AudioCueId) => void;
}

/** Cues that get a caption when captions are on (audio-direction §9). */
export const CAPTION_CUES: ReadonlySet<AudioCueId> = new Set<AudioCueId>([
  "cell.near_full",
  "cell.full",
  "railshot.charge",
  "railshot.away",
  "robot.alert",
  "robot.plot_done",
  "plot.stamp",
  "dot.bloop",
  "ui.reject",
]);

const TICK_S = 1 / 30;
const HOLD_SURFACES: ReadonlySet<string> = new Set(["requisitions_desk", "ops_console"]);

export class AudioModule<S extends ServiceTypes = ServiceTypes> implements ClientModule<S> {
  readonly id = "audio" as const;

  private ctx: AContext | null = null;
  private graph: AudioGraph | null = null;
  private store: BufferStore | null = null;
  private manager: VoiceManager | null = null;
  private player: CuePlayer | null = null;
  private music: MusicDirector | null = null;
  private readonly router: EventRouter;
  private readonly ducker: Ducker;
  private unsubs: Unsubscribe[] = [];
  private removeGesture: (() => void) | null = null;
  private removeVisibility: (() => void) | null = null;
  private tier: HardwareTier;
  private timeS = 0;
  private acc = 0;
  private mySlot = 0;
  private volume: VolumeSettings | null = null;
  private mono = false;
  private pendingPhase: DayPhase | null = null;
  private starting = false;
  private disposed = false;
  private panelOpen = false;
  /** Diagnostics for the debug overlay and tests. */
  suspendedByVisibility = false;

  constructor(private readonly options: AudioModuleOptions) {
    this.tier = options.tier ?? "B";
    this.ducker = new Ducker((bus, db, attack, release) => this.graph?.setDuck(bus, db, attack, release));
    this.router = new EventRouter(this.actions);
  }

  // ---- ClientModule ----

  init(ctx: ModuleContext<S>): void {
    this.unsubs.push(
      ctx.events.on("render.backendSelected", (e) => {
        this.tier = e.tier;
        this.manager?.setCap(AUDIO_VOICE_CAP[e.tier]);
      }),
    );
    this.router.attach(ctx.events);

    const ui = ctx.services.has("uiStore") ? ctx.services.get("uiStore") : null;
    if (ui !== null) {
      let lastVolume: unknown = null;
      let lastOpen: string | null | undefined;
      const sync = (): void => {
        const state = ui.getState();
        this.mySlot = state.shift.mySlot;
        if (state.settings.volume !== lastVolume) {
          lastVolume = state.settings.volume;
          this.volume = state.settings.volume;
          this.graph?.setVolumes(state.settings.volume);
        }
        if (state.menus.open !== lastOpen) {
          lastOpen = state.menus.open;
          this.onMenuChanged(state.menus.open);
        }
      };
      sync();
      this.unsubs.push(ui.subscribe(sync));
    }

    this.removeGesture = this.options.env.onGesture(() => this.unlock());
    this.removeVisibility = this.options.env.onVisibility((hidden) => this.onVisibility(hidden));
    // Context, graph, worker and prewarm are built at idle (suspended) so the first gesture only resumes.
    const env = this.options.env;
    const prepare = (): void => this.prepare();
    if (env.idle !== undefined) env.idle(prepare);
    else env.later(prepare, 500);
  }

  update(frame: FrameInfo): void {
    this.timeS = frame.time;
    const player = this.player;
    if (player === null || this.suspendedByVisibility) return;
    this.acc += frame.dt;
    if (this.acc < TICK_S) return;
    const dt = this.acc;
    this.acc = 0;
    this.router.tick(this.timeS, dt);
    this.music?.tick(this.timeS);
    this.ducker.apply(this.timeS);
  }

  dispose(): void {
    this.disposed = true;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.router.dispose();
    this.removeGesture?.();
    this.removeVisibility?.();
    this.player?.stopAll(0.01);
    this.music?.dispose();
    this.graph?.dispose();
    this.store?.dispose();
    const ctx = this.ctx;
    this.ctx = null;
    this.player = null;
    this.music = null;
    this.graph = null;
    this.store = null;
    this.manager = null;
    if (ctx !== null) void ctx.close().catch(() => undefined);
  }

  // ---- Public surface (UI-driven cues, accessibility settings, debug) ----

  /** Plays a cue by id. Used for sounds no event describes (Clock In, UI clicks) until `audio.cue` events exist. */
  play(id: AudioCueId, params: CuePlayParams = {}, opts?: PlayOptions): boolean {
    return this.running ? (this.player?.play(id, params, opts) ?? false) : false;
  }

  setMono(mono: boolean): void {
    this.mono = mono;
    this.graph?.setMono(mono);
  }

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  get diagnostics(): {
    readonly started: boolean;
    readonly state: string;
    readonly voices: number;
    readonly bufferBytes: number;
    readonly musicBytes: number;
    readonly musicSet: string | null;
    readonly nodes: number;
  } {
    return {
      started: this.ctx !== null,
      state: this.ctx?.state ?? "none",
      voices: this.player?.activeVoices ?? 0,
      bufferBytes: this.store?.residentBytes ?? 0,
      musicBytes: this.music?.residentBytes ?? 0,
      musicSet: this.music?.currentSet ?? null,
      nodes: (this.graph?.nodeCount ?? 0) + (this.manager?.activeCount ?? 0) + (this.music?.liveSources ?? 0),
    };
  }

  /**
   * Builds the context in the suspended state (autoplay policy allows creation without a gesture; only start needs
   * one) and begins prewarming buffers. A no-op when already built or when Web Audio is unavailable; the gesture path
   * then retries.
   */
  prepare(): void {
    if (this.disposed || this.ctx !== null || this.starting) return;
    try {
      this.build(this.options.env.createContext());
    } catch {
      return; // gesture path will try again
    }
    this.scheduleWarm();
  }

  /** Resumes the context (building it first only if idle preparation has not run or failed). Safe to call repeatedly. */
  unlock(): void {
    if (this.disposed) return;
    const env = this.options.env;
    if (this.ctx === null) {
      if (this.starting) return;
      this.starting = true;
      try {
        this.build(env.createContext());
      } catch {
        this.starting = false;
        return; // no Web Audio: the game runs silent
      }
    }
    const ctx = this.ctx;
    if (ctx === null) return;
    if (ctx.state !== "running")
      void ctx.resume().then(
        () => this.afterRunning(),
        () => undefined,
      );
    else this.afterRunning();
  }

  // ---- internals ----

  private readonly actions: AudioActions = {
    play: (id, params, opts) => (this.running ? (this.player?.play(id, params, opts) ?? false) : false),
    startLoop: (id, params, opts) => (this.running ? (this.player?.startLoop(id, params, opts) ?? null) : null),
    updateLoop: (h: LoopHandle, id, params, opts) => this.player?.update(h, id, params, opts),
    stopLoop: (h, fade) => this.player?.stop(h, fade),
    isAlive: (h) => this.player?.isAlive(h) ?? false,
    setAirborne: (a) => this.graph?.setAirborne(a),
    setMusicPhase: (phase) => {
      const set = phase === "day" ? "day" : phase === "night" ? "night" : "bridge";
      this.pendingPhase = phase;
      this.music?.setSet(set);
    },
    musicActivity: (nowS) => this.music?.noteActivity(nowS),
    musicMelody: (on) => this.music?.setMelody(on),
    duckPulse: (reason, durationS) => this.ducker.pulse(reason, this.timeS, durationS),
    setDuckFlag: (reason, on) => this.ducker.setFlag(reason, on),
    mySlot: () => this.mySlot,
    nowS: () => this.timeS,
  };

  private build(ctx: AContext): void {
    this.ctx = ctx;
    const cap = AUDIO_VOICE_CAP[this.tier];
    const graph = new AudioGraph(ctx, cap);
    this.graph = graph;
    const store = new BufferStore(ctx, this.options.env.createRenderer?.() ?? null);
    store.onFallback = () => this.scheduleWarm();
    this.store = store;
    this.manager = new VoiceManager(cap);
    const player = new CuePlayer(ctx, graph, this.store, this.manager, () => this.options.env.nowMs());
    const onCaption = this.options.onCaption;
    if (onCaption !== undefined) {
      player.onStart = (id) => {
        if (CAPTION_CUES.has(id)) onCaption(id);
      };
    }
    this.player = player;
    const music = new MusicDirector(ctx, graph.input("music", "music"), (set, layer) => store.requestLayer(set, layer));
    store.onLayer = (set, layer, pcm) => music.acceptLayer(set, layer, pcm);
    this.music = music;
    graph.setMono(this.mono);
    if (this.volume !== null) graph.setVolumes(this.volume);
    ctx.onstatechange = () => {
      // Interrupted or suspended by the browser or a device change: the next gesture resumes it.
      if (ctx.state !== "running" && !this.suspendedByVisibility && !this.disposed) this.armGestureResume();
    };
  }

  private armGestureResume(): void {
    this.removeGesture?.();
    this.removeGesture = this.options.env.onGesture(() => this.unlock());
  }

  private afterRunning(): void {
    if (this.disposed || this.graph === null) return;
    this.starting = false;
    this.removeGesture?.();
    this.removeGesture = null;
    this.graph.fadeMaster(1, 0.05);
    this.router.startBeds();
    const phase = this.pendingPhase;
    this.music?.setSet(phase === "night" ? "night" : phase === "day" || phase === null ? "day" : "bridge");
    this.scheduleWarm();
  }

  private scheduleWarm(): void {
    const env = this.options.env;
    env.later(() => {
      if (this.disposed || this.store === null) return;
      if (env.isHidden()) return;
      if (this.store.prewarmStep()) this.scheduleWarm();
    }, 6);
  }

  private onMenuChanged(open: string | null): void {
    const hold = open !== null && HOLD_SURFACES.has(open);
    this.panelOpen = hold;
    this.ducker.setFlag("panel", hold);
    this.graph?.setMuffleHz(hold ? PANEL_MUFFLE_HZ : GROUND_MUFFLE_HZ);
    this.music?.setHold(hold);
  }

  private onVisibility(hidden: boolean): void {
    const ctx = this.ctx;
    const graph = this.graph;
    if (ctx === null || graph === null) return;
    if (hidden) {
      this.suspendedByVisibility = true;
      graph.fadeMaster(0, 0.06);
      this.options.env.later(() => {
        if (this.suspendedByVisibility && !this.disposed) void ctx.suspend().catch(() => undefined);
      }, 120);
    } else {
      this.suspendedByVisibility = false;
      void ctx.resume().then(
        () => graph.fadeMaster(1, 0.1),
        () => this.armGestureResume(),
      );
    }
  }
}

/** Real browser seam. Gesture listeners are removed by the returned function. */
export function browserEnv(win: Window): AudioEnv {
  const w = win as unknown as {
    AudioContext?: new (o?: object) => unknown;
    webkitAudioContext?: new (o?: object) => unknown;
  };
  const ctor = w.AudioContext ?? w.webkitAudioContext;
  return {
    createContext: () => {
      if (ctor === undefined) throw new Error("audio: Web Audio is not available");
      return new ctor({ latencyHint: "interactive" }) as unknown as AContext;
    },
    onGesture: (listener) => {
      const names = ["pointerdown", "keydown", "touchend"] as const;
      const fn = (): void => listener();
      for (const n of names) win.addEventListener(n, fn, { passive: true });
      return () => {
        for (const n of names) win.removeEventListener(n, fn);
      };
    },
    onVisibility: (listener) => {
      const fn = (): void => listener(win.document.visibilityState === "hidden");
      win.document.addEventListener("visibilitychange", fn);
      return () => win.document.removeEventListener("visibilitychange", fn);
    },
    isHidden: () => win.document.visibilityState === "hidden",
    later: (fn, ms) => {
      win.setTimeout(fn, ms);
    },
    idle: (fn) => {
      // Let boot settle, then wait for an idle slice; the timeout keeps it from starving on a busy main thread.
      const w2 = win as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      win.setTimeout(() => {
        if (typeof w2.requestIdleCallback === "function") w2.requestIdleCallback(fn, { timeout: 1500 });
        else fn();
      }, 800);
    },
    nowMs: () => win.performance.now(),
    createRenderer: () => createWorkerRenderer(win),
  };
}

/** Module Worker running the pure cue recipes (render-worker.ts); null when Workers are unavailable. */
function createWorkerRenderer(win: Window): CueRenderRemote | null {
  if (typeof (win as unknown as { Worker?: unknown }).Worker !== "function") return null;
  let worker: Worker | null = null;
  return {
    connect(onReply, onFailure) {
      try {
        const w = new Worker(new URL("./render-worker.ts", import.meta.url), { type: "module" });
        worker = w;
        w.onmessage = (e: MessageEvent<RenderReply>): void => {
          onReply(e.data);
        };
        w.onerror = (): void => onFailure();
        w.onmessageerror = (): void => onFailure();
      } catch {
        worker = null;
        onFailure();
      }
    },
    request(req: RenderRequest) {
      worker?.postMessage(req);
    },
    dispose() {
      worker?.terminate();
      worker = null;
    },
  };
}
