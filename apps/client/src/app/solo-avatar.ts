// Lazy gameplay presentation: no network imports; tool work only from authoritative Solo telemetry (never speculated).
import type { ClientModule, FrameInfo, ModuleContext, RoomHost, ViewportSize } from "@moon-cleanup/shared";
import {
  AnimationModule,
  TOOL,
  strokeCurveIO,
  toolClassOf,
  type AnimGround,
  type AnimInputProvider,
  type AvatarAnimInput,
} from "../animation";
import type { GameplayModule, RenderMapper } from "../gameplay";

/** Structural view of LocalRoomHostImpl.toolAnim (sim-host/tool-telemetry.ts); the app never imports sim-host internals. */
export interface ToolAnimSnapshot {
  readonly valid: boolean;
  readonly sweeping: boolean;
  readonly detailing: boolean;
  readonly inContact: boolean;
  readonly headValid: boolean;
  readonly toolCode: number;
  readonly phase01: number;
  readonly periodMs: number;
  readonly headX: number;
  readonly headY: number;
  readonly headZ: number;
  readonly serial: number;
}
/** Per-tool sim stroke shape (packages/sim ToolTuning): push length (m) and contact fraction of the period. */
export interface ToolStrokeShape {
  readonly pushM: number;
  readonly contactMs: number;
  readonly periodMs: number;
}
interface ShiftSeed {
  readonly players: readonly { readonly slot: number; readonly equippedTool: number }[];
}
import { BlockoutCast, CustodianAvatarView } from "../visuals/characters/blockout";
import type { AnimationBinder } from "./online-launch";
import type { ClientServices } from "./services";

export const SOLO_AVATAR_SLOT = 15;
/** Render time without a new telemetry serial after which tool work is treated as stale (sim ticks at 20 Hz). */
export const STALE_TELEMETRY_S = 0.25;
export const FLAT_AVATAR_GROUND: AnimGround = {
  heightsAt(_dirs, out, n) {
    out.fill(0, 0, n);
  },
};

/** Actual presented Solo feet plus predicted physical state. Nothing is inferred from key presses. */
export class SoloAvatarFeed {
  private toolClass = 0;
  private prevJumped = false;
  private previousSeq = -1;
  private fresh = true;
  readonly provider: AnimInputProvider = (slot, frame, input) => {
    if (slot !== SOLO_AVATAR_SLOT) return false;
    const p = this.gameplay.predictor;
    if (this.host()?.kind !== "local" || p === null || !p.ready || this.gameplay.drive.isActive) {
      this.fresh = true;
      this.lastSerial = -1;
      this.sinceSerialS = 0;
      return false;
    }
    const st = p.state;
    input.pos.set(this.gameplay.rig.feet);
    input.vel[0] = st.vx;
    input.vel[1] = st.vy;
    input.vel[2] = st.vz;
    input.facing[0] = st.fx;
    input.facing[1] = st.fy;
    input.facing[2] = st.fz;
    input.grounded = st.moveState === 0;
    input.heightAboveGround = st.heightAboveGround;
    input.impactMps = st.lastImpactMps;
    const seq = this.gameplay.pump.cmd.seq;
    // A jump is consumed on a new predicted input (seq change) or a fresh rising edge of the flag, so a jump on a frame
    // where seq did not advance is not dropped, and a held flag is never replayed.
    input.jumped = st.jumped && (seq !== this.previousSeq || !this.prevJumped);
    this.prevJumped = st.jumped;
    this.previousSeq = seq;
    input.actionState = 0;
    input.teleport = this.fresh;
    this.fresh = false;
    // Tool work comes only from the authoritative telemetry of the concrete local host (never fabricated). Absent,
    // stale (other tool equipped) or inactive data shows the held tool only.
    const tele = (this.host() as unknown as { toolAnim?: ToolAnimSnapshot } | null)?.toolAnim;
    // A host can start emitting frames before a shift-state snapshot reaches this subscriber. Seed only an unknown
    // tool from a valid frame; once shift state selects a tool, mismatching older frames must still be rejected.
    if (this.toolCode < 0 && tele?.valid && Number.isInteger(tele.toolCode) && this.toolIds[tele.toolCode] !== undefined) {
      this.setTool(tele.toolCode);
    }
    input.toolClass = this.toolClass;
    this.applyTool(tele, frame.dt, input);
    return true;
  };

  private applyTool(tele: ToolAnimSnapshot | undefined, dt: number, input: AvatarAnimInput): void {
    const work =
      tele !== undefined &&
      tele.valid &&
      (tele.sweeping || tele.detailing) &&
      tele.toolCode === this.toolCode &&
      tele.periodMs > 0;
    if (!work) {
      this.stopWork(input);
      return;
    }
    if (tele.serial !== this.lastSerial) {
      this.lastSerial = tele.serial;
      this.sinceSerialS = 0;
    } else this.sinceSerialS += dt;
    // Telemetry arrives every sim tick; a stalled serial means the data is stale, so work stops instead of freezing.
    // lastSerial is kept so the same stale serial cannot restart work; only a new serial resumes it.
    if (this.sinceSerialS > STALE_TELEMETRY_S) {
      input.toolActive = false;
      input.toolInContact = false;
      input.headValid = false;
      input.toolPhase = 0;
      return;
    }
    const periodS = tele.periodMs / 1000;
    // Sim phase at the newest 20 Hz tick, advanced by the render time since it arrived (bounded to one tick).
    const ahead = Math.min(this.sinceSerialS, 0.05);
    // A phase of exactly 1 is the held end of a detailing stroke (not a wrap), so it stays clamped there.
    let phase = tele.phase01 >= 1 ? 1 : tele.phase01 + ahead / periodS;
    if (phase < 1) phase -= Math.floor(phase);
    const code = this.toolCode;
    const cf = this.contactFrac[code] ?? TOOL.defaultContactFrac;
    input.toolActive = true;
    input.toolPhase = phase;
    input.toolPeriodS = periodS;
    input.toolContactFrac = cf;
    input.toolInContact = tele.inContact;
    if (!tele.headValid) {
      input.headValid = false;
      return;
    }
    // The sim head (moon-centred, the frame of input.pos) at the newest tick, carried to render time along the sim's
    // own stroke curve (head = aim - L + L * curve(phase), along the body facing) plus the body's travel since the
    // tick, so the tool-head IK sees a continuous point instead of 20 Hz steps. Detailing holds still (no push).
    const st = this.gameplay.predictor!.state;
    const c = this.curve;
    const L = tele.detailing ? 0 : (this.pushM[code] ?? 0);
    c[0] = tele.phase01;
    c[1] = cf;
    strokeCurveIO(c);
    const sTick = c[2]!;
    c[0] = phase;
    strokeCurveIO(c);
    const dHead = tele.detailing ? 0 : L * (c[2]! - sTick);
    const dCentre = L * (0.5 - sTick);
    const travel = ahead;
    const h = input.headTarget;
    const m = input.headCentre;
    h[0] = tele.headX + st.vx * travel;
    h[1] = tele.headY + st.vy * travel;
    h[2] = tele.headZ + st.vz * travel;
    m[0] = h[0] + st.fx * dCentre;
    m[1] = h[1] + st.fy * dCentre;
    m[2] = h[2] + st.fz * dCentre;
    h[0] += st.fx * dHead;
    h[1] += st.fy * dHead;
    h[2] += st.fz * dHead;
    input.headValid = true;
  }

  private stopWork(input: AvatarAnimInput): void {
    input.toolActive = false;
    input.toolInContact = false;
    input.headValid = false;
    input.toolPhase = 0;
    this.lastSerial = -1;
    this.sinceSerialS = 0;
  }

  private toolCode = -1;
  private lastSerial = -1;
  private sinceSerialS = 0;
  /** strokeCurveIO scratch: [0] phase, [1] contact fraction -> [2] normalised reach. */
  private readonly curve = new Float64Array(3);
  /** Per tool code: sim push length (m; 0 until known) and contact fraction. */
  private pushM: Float64Array;
  private contactFrac: Float64Array;

  constructor(
    private readonly gameplay: GameplayModule,
    private readonly host: () => RoomHost | null,
    private readonly toolIds: readonly string[],
  ) {
    this.pushM = new Float64Array(toolIds.length);
    this.contactFrac = new Float64Array(toolIds.length).fill(TOOL.defaultContactFrac);
  }

  /** The sim's stroke shapes by tool code (cold; from the Solo sim config). Before this the head steps at 20 Hz. */
  setToolStrokes(tools: readonly ToolStrokeShape[]): void {
    const n = this.toolIds.length;
    const push = new Float64Array(n);
    const frac = new Float64Array(n).fill(TOOL.defaultContactFrac);
    for (let i = 0; i < n && i < tools.length; i++) {
      const t = tools[i]!;
      push[i] = t.pushM > 0 ? t.pushM : 0;
      if (t.periodMs > 0 && t.contactMs >= 0 && t.contactMs <= t.periodMs) frac[i] = t.contactMs / t.periodMs;
    }
    this.pushM = push;
    this.contactFrac = frac;
  }

  setTool(code: number): void {
    this.toolCode = code;
    this.toolClass = toolClassOf(this.toolIds[code] ?? "");
  }

  reset(): void {
    this.previousSeq = -1;
    this.prevJumped = false;
    this.fresh = true;
    this.toolClass = 0;
    this.toolCode = -1;
    this.lastSerial = -1;
    this.sinceSerialS = 0;
  }

  /** reset() then seed the held tool from the host's last shift state (onShiftState does not replay on subscribe). */
  resetFrom(host: RoomHost | null): void {
    this.reset();
    const last = (host as unknown as { shiftState?: ShiftSeed | null } | null)?.shiftState;
    const me = last?.players.find((p) => p.slot === 0);
    if (me !== undefined) this.setTool(me.equippedTool);
  }
}

/** Online's cold bind/unbind path restores Solo immediately on room close, without polling the network per frame. */
export function soloRestoringBinder(
  animation: AnimationModule,
  feed: SoloAvatarFeed,
  ground: AnimGround,
  radiusM: number,
  setLocal: (slot: number) => void,
): AnimationBinder {
  return {
    bind(provider, remoteGround, remoteRadius) {
      animation.bind(
        provider ?? feed.provider,
        provider === null ? ground : remoteGround,
        provider === null ? radiusM : remoteRadius,
      );
    },
    setLocalSlot(slot) {
      const own = slot < 0 ? SOLO_AVATAR_SLOT : slot;
      animation.setLocalSlot(own);
      setLocal(own);
    },
  };
}

/** Shares the animation frame slot: predict -> animate -> pose the view -> render. */
export class SoloAvatarModule implements ClientModule<ClientServices> {
  readonly id = "animation" as const;
  readonly feed: SoloAvatarFeed;
  readonly view: CustodianAvatarView;
  readonly binder: AnimationBinder;
  private camera: import("three/webgpu").PerspectiveCamera | null = null;
  private heightPx = 720;
  private offHost: (() => void) | null = null;
  private offShift: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly animation: AnimationModule,
    private readonly gameplay: GameplayModule,
    private readonly cast: BlockoutCast,
    mapper: RenderMapper,
    ground: AnimGround,
    radiusM: number,
    toolIds: readonly string[],
    host: () => RoomHost | null,
  ) {
    this.feed = new SoloAvatarFeed(gameplay, host, toolIds);
    this.view = new CustodianAvatarView(cast, animation, mapper);
    this.binder = soloRestoringBinder(animation, this.feed, ground, radiusM, (slot) => {
      this.view.localSlot = slot;
    });
    this.binder.bind(null, null, 0);
    this.binder.setLocalSlot(-1);
  }

  init(ctx: ModuleContext<ClientServices>): void {
    this.animation.init(ctx);
    // The sim's per-tool stroke shapes (push length, contact fraction) for the continuous tool-head target. Cold, lazy
    // (the sim and game data chunks are already loaded for Solo prediction); without them the head steps at 20 Hz.
    void Promise.all([import("@moon-cleanup/sim"), import("@moon-cleanup/game-data")])
      .then(([sim, data]) => {
        if (!this.disposed) this.feed.setToolStrokes(sim.createSimConfig(data.loadGameData()).tools);
      })
      .catch((error: unknown) => console.warn("[avatar] tool stroke shapes unavailable:", error));
    const roots = ctx.services.get("sceneRoots");
    this.camera = roots.camera;
    roots.world.add(this.view.root);
    const hosts = ctx.services.get("roomHost");
    this.bindHost(hosts.current);
    this.offHost = hosts.onChange((host) => this.bindHost(host));
  }

  private bindHost(host: RoomHost | null): void {
    this.offShift?.();
    this.offShift = null;
    this.feed.resetFrom(host);
    if (host?.kind === "local")
      this.offShift = host.onShiftState((state) => {
        const me = state.players.find((p) => p.slot === 0);
        if (me !== undefined) this.feed.setTool(me.equippedTool);
      });
  }

  update(frame: FrameInfo): void {
    this.animation.update(frame);
    this.view.hideLocal = this.gameplay.rig.mode === "first";
    this.view.update(frame.dt, this.camera, this.heightPx);
  }

  resize(size: ViewportSize): void {
    this.heightPx = size.heightCssPx;
  }

  dispose(): void {
    this.disposed = true;
    this.offHost?.();
    this.offShift?.();
    this.offHost = null;
    this.offShift = null;
    this.view.dispose();
    this.cast.dispose();
    this.animation.dispose();
    this.camera = null;
  }
}

export { BlockoutCast };
