// Composition glue only: host notifications -> audio bus, cached Solo vehicle readouts -> presentation motion.
// No decoding, sim writes, network imports or allocations in pump(). Audio-disabled launches never create this.
import {
  AUDIO_EVENT_CUES,
  type EntityId,
  type EventBus,
  type EventMap,
  type RoomHost,
  type RoomHostService,
  type RoomSimEvent,
  type Tick,
  type Unsubscribe,
} from "@moon-cleanup/shared";

interface Motion {
  readonly tick: number;
  readonly vehicleId: number;
  readonly kindId: string;
  readonly speed01: number;
  readonly load01: number;
  readonly workIntensity01: number;
}

export class AudioBridge {
  private host: RoomHost | null = null;
  private offEvent: Unsubscribe | null = null;
  private offChange: Unsubscribe | null = null;
  private seat: EventMap["vehicle.entered"] | null = null;
  private lastMs = -Infinity;
  private moving = false;
  private lastSeatTick = -1;
  private exited = false;
  private readonly motion = {
    tick: 0,
    vehicleId: 0,
    kindId: "",
    actorSlot: 0,
    speed01: 0,
    load01: 0,
    workIntensity01: 0,
  } as {
    -readonly [K in keyof Omit<EventMap["vehicle.motion"], "placement">]: EventMap["vehicle.motion"][K];
  };

  constructor(
    private readonly bus: EventBus,
    private readonly mySlot: () => number,
  ) {}

  follow(service: RoomHostService): void {
    this.setHost(service.current);
    this.offChange = service.onChange((host) => this.setHost(host));
  }

  private setHost(host: RoomHost | null): void {
    if (host === this.host) return;
    this.offEvent?.();
    this.offEvent = null;
    this.endSeat();
    this.host = host;
    this.lastMs = -Infinity;
    this.lastSeatTick = -1;
    this.exited = false;
    if (host !== null) this.offEvent = host.onEvent((event) => this.forward(event));
  }

  private forward(event: RoomSimEvent): void {
    // Only the audio catalog: unrelated host notifications keep their existing owners and delivery semantics.
    if (!Object.hasOwn(AUDIO_EVENT_CUES, event.name)) return;
    if (event.name === "vehicle.entered" && event.payload.actorSlot === this.mySlot()) {
      this.seat = event.payload;
      this.lastSeatTick = event.payload.tick;
      this.exited = false;
    } else if (event.name === "vehicle.exited" && event.payload.actorSlot === this.mySlot()) {
      this.zero(event.payload.tick);
      this.seat = null;
      this.lastSeatTick = event.payload.tick;
      this.exited = true;
    }
    this.bus.emit(event.name, event.payload);
  }

  /** Called in the audio frame slot. Reads the existing worker cache at most 10 Hz. */
  pump(nowMs: number): void {
    if (nowMs - this.lastMs < 100) return;
    this.lastMs = nowMs;
    const host = this.host;
    if (host === null || host.state !== "running") {
      this.endSeat();
      return;
    }
    // Remote placement/motion has a separate owner. Solo's cache already contains the true speed, hopper and intake.
    if (host.kind !== "local" || !("readouts" in host)) return;
    const source = host as RoomHost & { readonly readouts: { readonly vehicleMotion?: Motion | null } };
    const v = source.readouts.vehicleMotion;
    if (v === undefined) return; // no first sample yet
    // A pre-enter sample can still be cached when vehicle.entered arrives. Reliable exit notifications close the
    // seat; an old null readout must not undo a newer enter notification.
    if (v === null) return;
    // Event and readout messages use separate deliveries. Never resurrect a seat from a pre-exit cache sample.
    if (v.tick < this.lastSeatTick || (this.exited && v.tick <= this.lastSeatTick)) return;
    if (this.seat?.vehicleId !== v.vehicleId) {
      this.endSeat();
      // A restored/already-running host can be subscribed after its seat notification. Seed from authoritative cache.
      this.seat = { tick: v.tick as Tick, actorSlot: 0, vehicleId: v.vehicleId as EntityId, kindId: v.kindId, seat: 0 };
      this.bus.emit("vehicle.entered", this.seat);
    }
    const p = this.motion;
    p.tick = v.tick as Tick;
    p.vehicleId = v.vehicleId as EntityId;
    p.kindId = v.kindId;
    p.actorSlot = 0;
    p.speed01 = v.speed01;
    p.load01 = v.load01;
    p.workIntensity01 = v.workIntensity01;
    const active = p.speed01 > 0 || p.workIntensity01 > 0;
    if (active) this.bus.emit("vehicle.motion", p);
    else if (this.moving) this.zero(p.tick);
    this.moving = active;
  }

  private zero(tick: EventMap["vehicle.motion"]["tick"]): void {
    if (!this.moving) return;
    this.motion.tick = tick;
    this.motion.speed01 = this.motion.load01 = this.motion.workIntensity01 = 0;
    this.bus.emit("vehicle.motion", this.motion);
    this.moving = false;
  }

  private endSeat(): void {
    if (this.seat === null) return;
    this.zero(this.seat.tick);
    this.bus.emit("vehicle.exited", this.seat);
    this.seat = null;
  }

  dispose(): void {
    this.offChange?.();
    this.offEvent?.();
    this.offChange = this.offEvent = null;
    this.endSeat();
    this.host = null;
  }
}
