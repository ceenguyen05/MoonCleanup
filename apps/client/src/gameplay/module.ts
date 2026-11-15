// Gameplay client module (M1-W3-T05 client input, Solo prediction, camera rig, tool aim). Per rendered frame, in the
// frame loop's `gameplay` slot (before animation / visuals / render):
//   gamepad poll -> look integrate -> online-room check -> live input peek -> avatar pose (Solo predictor, host FRAME
//   or online predictor) -> camera rig + tool aim -> one input per sim tick to the sink (Solo: predicted at send) ->
//   camera + placeholder avatar / tool-head marker.
//
// SOLO FIRST: the default sink is `roomHost.current` (the LocalRoom worker host) and the own avatar is predicted on
// the render thread with the worker's own `stepAvatar` (avatar/solo-predictor.ts), so look AND walking reach the screen
// in the next rendered frame (E13). No network code is imported. An online room is picked up from the app's slot
// (filled after its own dynamic import): inputs go to `OnlineRoom.sendInput`, the pose comes from its predictor.

import {
  CapsuleGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  RingGeometry,
  Vector3,
  type PerspectiveCamera,
} from "three/webgpu";
import type { ClientModule, FrameInfo, ModuleContext, RoomHost, Unsubscribe } from "@moon-cleanup/shared";
import type { SimConfig, SimGround } from "@moon-cleanup/sim";
import type { RenderServices } from "../render";
import { DEFAULT_BINDINGS, type BindingTable } from "./input/bindings";
import { DomInput, type DomInputHost, type PointerLockTarget } from "./input/dom-input";
import { InputPump, type InputSink } from "./input/input-pump";
import { InputState } from "./input/input-state";
import {
  FrameAvatarSource,
  PredictorPoseSource,
  type AvatarPoseSource,
  type PredictorLike,
} from "./avatar/pose-source";
import { SoloPredictor } from "./avatar/solo-predictor";
import { CameraRig, TangentPlaneMapper, type RenderMapper } from "./camera/camera-rig";

/** What the module needs of an open online room (app/online-room.ts OnlineRoom satisfies it structurally). */
export interface OnlineRoomLike extends InputSink {
  readonly predictor: PredictorLike;
}

/** Flat ground (H = 0): the Solo worker's world until the terrain module hands it a height cube (app/solo-host.ts). */
export const FLAT_GROUND: SimGround = { heightAtXYZ: () => 0 };

export interface GameplayModuleOptions {
  /** Device events (default `window`); null = no DOM input (tests, capture lanes). */
  readonly win?: DomInputHost | null;
  /** Pointer-lock target (the canvas stage). */
  readonly lockTarget?: PointerLockTarget | null;
  /** Moon-centred metres -> render space. Default: a floating-origin tangent frame centred on the first pose. */
  readonly mapper?: RenderMapper;
  /** The rig drives `sceneRoots.camera` (false on look-dev / capture scenes that own their camera). */
  readonly cameraControl?: boolean;
  /** Placeholder capsule avatar (third person) and tool-head marker. */
  readonly placeholder?: boolean;
  readonly bindings?: BindingTable;
  /**
   * Ground of the Solo prediction. MUST be the Solo worker's ground (same world config), or every tick corrects;
   * default flat, like the worker today.
   */
  readonly ground?: SimGround;
  /** Sim config of the prediction; default built from game data (lazy chunk) for the host's tick rate. */
  readonly simConfig?: SimConfig;
  /** Solo prediction (default on). Off: the pose is the interpolated worker FRAME (one tick behind). */
  readonly prediction?: boolean;
  /** The app's online room slot (`app/online-launch.ts` OnlineRoomSlot); polled once per frame (one null check). */
  readonly online?: { readonly current: OnlineRoomLike | null };
  readonly now?: () => number;
  /**
   * Dev / `?perf=1` only: installs `__mcGameplay()` on this object (a snapshot built only when called). Null or absent
   * in production: nothing is installed and nothing extra runs per frame.
   */
  readonly debugHost?: GameplayDebugHost | null;
}

/** What `__mcGameplay()` returns (dev / perf readout for smoke tests). */
export interface GameplaySnapshot {
  readonly pose: { x: number; y: number; z: number; yawRad: number; pitchRad: number; mode: string } | null;
  readonly predicted: boolean;
  readonly input: { lastSeq: number; sent: number; toolInputs: number; buttons: number; toolParam: number };
  readonly worker: { tick: number; ackInputSeq: number; framesDecoded: number; decodeErrors: number };
  readonly strokes: { chainsAcked: number; framesWithStrokes: number; lastStrokeTick: number };
  readonly dust: { cellGrams: number };
  readonly prediction: Readonly<Record<string, number>> | null;
  readonly host: { kind: string; state: string } | null;
}

export interface GameplayDebugHost {
  __mcGameplay?: () => GameplaySnapshot;
  /** Dev / perf only: shift the avatar's presented position onto the moon-centred direction (x,y,z); returns false while unposed. */
  __mcGameplayTeleportDir?: (x: number, y: number, z: number) => boolean;
}

/** Re-centre the default floating origin once the avatar is this far from it (m). */
const RECENTER_M = 1000;

export class GameplayModule implements ClientModule<RenderServices> {
  readonly id = "gameplay" as const;
  readonly input: InputState;
  readonly pump: InputPump;
  readonly rig = new CameraRig();
  readonly framePose: FrameAvatarSource;
  /** Solo predictor (null until the sim config is ready, or with `prediction: false`). */
  predictor: SoloPredictor | null = null;
  private dom: DomInput | null = null;
  private pose: AvatarPoseSource;
  private onlineRoom: OnlineRoomLike | null = null;
  private host: RoomHost | null = null;
  private offShift: Unsubscribe | null = null;
  private camera: PerspectiveCamera | null = null;
  private readonly mapper: RenderMapper;
  private readonly ownMapper: TangentPlaneMapper | null;
  private readonly now: () => number;
  private readonly feet = new Float64Array(3);
  /** Reused frame clock (hot-path calls take objects, never double arguments). */
  private readonly clock = { dt: 0, nowMs: 0 };
  private readonly body3 = new Float64Array(3);
  private readonly r = new Float64Array(9);
  private readonly v = new Vector3();
  private body: Mesh | null = null;
  private marker: Mesh | null = null;
  private hasPose = false;
  /** Dev-only presented-position shift set by `__mcGameplayTeleportDir`; zero cost while unset (one boolean test). */
  private hasDebugShift = false;
  private readonly debugShift = new Float64Array(3);
  private disposed = false;
  private readonly disposers: (() => void)[] = [];
  readonly stats = { frames: 0, posedFrames: 0, intents: 0 };
  private readonly predictFn = (cmd: Parameters<SoloPredictor["predict"]>[0]): void => this.predictor?.predict(cmd);
  private readonly reconcileFn = (self: Parameters<SoloPredictor["reconcile"]>[0], ack: number): void =>
    this.predictor?.reconcile(self, ack);

  constructor(private readonly options: GameplayModuleOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.input = new InputState(options.bindings ?? DEFAULT_BINDINGS);
    this.pump = new InputPump(this.input);
    this.framePose = new FrameAvatarSource(this.now);
    this.pose = this.framePose;
    if (options.mapper !== undefined) {
      this.mapper = options.mapper;
      this.ownMapper = null;
    } else {
      this.ownMapper = new TangentPlaneMapper();
      this.mapper = this.ownMapper;
    }
    this.input.mirrored = this.mapper.mirrored === true;
    if (options.simConfig !== undefined && options.prediction !== false) this.createPredictor(options.simConfig);
  }

  init(ctx: ModuleContext<RenderServices>): void {
    const win = this.options.win === undefined ? (globalThis as unknown as DomInputHost) : this.options.win;
    const target =
      this.options.lockTarget ??
      ((globalThis as { document?: { body?: PointerLockTarget } }).document?.body as PointerLockTarget | undefined) ??
      null;
    if (win !== null && target !== null && typeof win.addEventListener === "function") {
      this.dom = new DomInput(win, target, this.input);
      this.dom.attach();
      this.disposers.push(() => this.dom?.detach());
    }
    const roots = ctx.services.get("sceneRoots");
    if (this.options.cameraControl !== false) this.camera = roots.camera;
    if (this.options.placeholder !== false) {
      const bodyMat = new MeshStandardNodeMaterial({ color: 0xe8e4da, roughness: 0.6, metalness: 0.05 });
      const body = new Mesh(new CapsuleGeometry(0.32, 1.0, 4, 12), bodyMat);
      body.name = "mc:gameplay-avatar";
      body.castShadow = true;
      body.visible = false;
      const markerMat = new MeshBasicNodeMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85 });
      const marker = new Mesh(new RingGeometry(0.06, 0.1, 24), markerMat);
      marker.name = "mc:gameplay-tool-aim";
      marker.rotation.x = -Math.PI / 2;
      marker.visible = false;
      roots.world.add(body, marker);
      this.body = body;
      this.marker = marker;
      this.disposers.push(() => {
        body.removeFromParent();
        marker.removeFromParent();
        body.geometry.dispose();
        bodyMat.dispose();
        marker.geometry.dispose();
        markerMat.dispose();
      });
    }
    const debug = this.options.debugHost;
    if (debug !== undefined && debug !== null) {
      debug.__mcGameplay = () => this.snapshot();
      debug.__mcGameplayTeleportDir = (x, y, z) => this.debugTeleportDir(x, y, z);
      this.disposers.push(() => {
        delete debug.__mcGameplay;
        delete debug.__mcGameplayTeleportDir;
      });
    }
    const service = ctx.services.get("roomHost");
    this.bindHost(service.current);
    this.disposers.push(service.onChange((host) => this.bindHost(host)));
  }

  /**
   * Online room: inputs go to `sink` (OnlineRoom.sendInput, which also predicts) and the pose comes from `pose` (its
   * predictor). `null` returns to the room host (Solo). Called by the per-frame slot check, or directly.
   */
  setOnline(sink: InputSink | null, pose: AvatarPoseSource | null): void {
    this.pose = pose ?? this.soloPose();
    this.pump.setSink(sink ?? this.host);
    this.pump.listener = sink === null ? this.predictFn : null;
    this.hasPose = false;
    this.rig.reset();
  }

  /** Rebind from settings. */
  setBindings(table: BindingTable): void {
    this.input.setBindings(table);
  }

  update(frame: FrameInfo): void {
    const clock = this.clock;
    clock.nowMs = this.now();
    clock.dt = frame.dt;
    this.stats.frames++;
    this.checkOnline();
    this.dom?.pollGamepads();
    const input = this.input;
    input.advance(clock);
    for (let n = input.takeCameraToggles(); n > 0; n--) this.rig.mode = this.rig.mode === "first" ? "third" : "first";
    const slot = input.takeSlot();
    if (slot >= 0) {
      if (this.onlineRoom === null) this.host?.sendIntent({ kind: "select_tool", slot });
      this.stats.intents++;
    }

    const pose = this.pose;
    const predictor = this.predictor;
    if (predictor !== null && pose === predictor) input.peek(predictor.live);
    input.airborne = pose.airborne;
    const posed = pose.sample(clock, this.feet);
    if (posed) {
      if (this.hasDebugShift) {
        this.feet[0]! += this.debugShift[0]!;
        this.feet[1]! += this.debugShift[1]!;
        this.feet[2]! += this.debugShift[2]!;
      }
      this.stats.posedFrames++;
      this.rig.update(this.feet, input, clock);
      input.toolParam = this.rig.toolParam;
      this.recenterIfFar(!this.hasPose);
      this.hasPose = true;
    }
    this.pump.update(clock);
    if (posed) this.present();
  }

  dispose(): void {
    this.disposed = true;
    this.offShift?.();
    this.offShift = null;
    this.framePose.dispose();
    for (const fn of this.disposers.splice(0).reverse()) fn();
    this.camera = null;
  }

  /** The dev readout (allocates; called from the console or a smoke script only). */
  snapshot(): GameplaySnapshot {
    const f = this.framePose;
    const p = this.pump;
    return {
      pose: this.hasPose
        ? {
            x: this.rig.feet[0]!,
            y: this.rig.feet[1]!,
            z: this.rig.feet[2]!,
            yawRad: this.input.yawRad,
            pitchRad: this.input.pitchRad,
            mode: this.rig.mode,
          }
        : null,
      predicted: this.predictor !== null && this.pose === this.predictor,
      input: {
        lastSeq: p.cmd.seq,
        sent: p.sent,
        toolInputs: p.toolInputs,
        buttons: p.cmd.buttons,
        toolParam: p.cmd.toolParam,
      },
      worker: {
        tick: f.tick,
        ackInputSeq: f.ackInputSeq,
        framesDecoded: f.framesDecoded,
        decodeErrors: f.decodeErrors,
      },
      strokes: { chainsAcked: f.strokeChains, framesWithStrokes: f.strokeFrames, lastStrokeTick: f.lastStrokeTick },
      dust: { cellGrams: f.cellGrams },
      prediction: this.predictor === null ? null : { ...this.predictor.stats },
      host: this.host === null ? null : { kind: this.host.kind, state: this.host.state },
    };
  }

  /** Dev only: presents the avatar at the same radius along direction (x,y,z); the sim avatar is not moved. */
  private debugTeleportDir(x: number, y: number, z: number): boolean {
    if (!this.hasPose) return false;
    const f = this.rig.feet;
    const cur = this.debugShift;
    const sx = f[0]! - cur[0]!;
    const sy = f[1]! - cur[1]!;
    const sz = f[2]! - cur[2]!;
    const r = Math.hypot(f[0]!, f[1]!, f[2]!);
    const l = Math.hypot(x, y, z);
    if (l === 0 || r === 0) return false;
    cur[0] = (x / l) * r - sx;
    cur[1] = (y / l) * r - sy;
    cur[2] = (z / l) * r - sz;
    this.hasDebugShift = true;
    return true;
  }

  private soloPose(): AvatarPoseSource {
    return this.predictor ?? this.framePose;
  }

  private checkOnline(): void {
    const slot = this.options.online;
    if (slot === undefined) return;
    const room = slot.current;
    if (room === this.onlineRoom) return;
    this.onlineRoom = room;
    if (room === null) this.setOnline(null, null);
    else this.setOnline(room, new PredictorPoseSource(room.predictor));
  }

  private createPredictor(cfg: SimConfig): void {
    if (this.disposed || this.predictor !== null) return;
    this.predictor = new SoloPredictor(cfg, this.options.ground ?? FLAT_GROUND, this.now);
    this.framePose.selfListener = this.reconcileFn;
    if (this.onlineRoom === null) {
      this.pose = this.predictor;
      this.pump.listener = this.predictFn;
    }
  }

  /** Builds the Solo sim config from game data in a lazy chunk (never on the first-frame path). */
  private loadPredictor(tickHz: number): void {
    if (this.options.prediction === false || this.predictor !== null) return;
    void Promise.all([import("@moon-cleanup/sim"), import("@moon-cleanup/game-data")])
      .then(([sim, data]) => this.createPredictor(sim.createSimConfig(data.loadGameData(), { tickHz })))
      .catch((error: unknown) => console.warn("[gameplay] Solo prediction unavailable:", error));
  }

  private bindHost(host: RoomHost | null): void {
    this.host = host;
    this.offShift?.();
    this.offShift = null;
    this.framePose.attach(host);
    this.predictor?.reset();
    if (this.onlineRoom === null) this.pump.setSink(host);
    this.pump.setTickHz(host?.simTickHz ?? 20);
    this.hasPose = false;
    this.rig.reset();
    if (host === null) return;
    this.loadPredictor(host.simTickHz);
    // Own equipped tool (Solo: actor slot 0): the predictor's speed multipliers follow it. Rare, may allocate.
    this.offShift = host.onShiftState((state) => {
      const me = host.kind === "local" ? state.players.find((p) => p.slot === 0) : undefined;
      if (me !== undefined) this.predictor?.setTool(me.equippedTool);
    });
  }

  private recenterIfFar(first: boolean): void {
    const m = this.ownMapper;
    if (m === null) return;
    const f = this.rig.feet;
    const o = m.origin;
    const dx = f[0]! - o[0]!;
    const dy = f[1]! - o[1]!;
    const dz = f[2]! - o[2]!;
    if (first || dx * dx + dy * dy + dz * dz > RECENTER_M * RECENTER_M) m.recenter(f[0]!, f[1]!, f[2]!);
  }

  /** Writes the rig into the camera and the placeholder meshes (render space). */
  private present(): void {
    const rig = this.rig;
    const m = this.mapper;
    const r = this.r;
    m.point(rig.eye, 0, r, 0);
    m.direction(rig.forward, 0, r, 3);
    m.direction(rig.up, 0, r, 6);
    const cam = this.camera;
    if (cam !== null) {
      cam.position.set(r[0]!, r[1]!, r[2]!);
      cam.up.set(r[6]!, r[7]!, r[8]!);
      cam.lookAt(this.v.set(r[0]! + r[3]!, r[1]! + r[4]!, r[2]! + r[5]!));
      cam.updateMatrixWorld();
    }
    const body = this.body;
    if (body !== null) {
      body.visible = rig.mode === "third";
      if (body.visible) {
        const half = 0.82; // capsule centre above the feet
        const c = this.body3;
        c[0] = rig.feet[0]! + rig.up[0]! * half;
        c[1] = rig.feet[1]! + rig.up[1]! * half;
        c[2] = rig.feet[2]! + rig.up[2]! * half;
        m.point(c, 0, r, 0);
        body.position.set(r[0]!, r[1]!, r[2]!);
      }
    }
    const marker = this.marker;
    if (marker !== null) {
      marker.visible = true;
      m.point(rig.aim, 0, r, 0);
      marker.position.set(r[0]!, r[1]! + 0.02, r[2]!);
    }
  }
}
