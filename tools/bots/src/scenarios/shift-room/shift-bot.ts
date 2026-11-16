import { Client, type Room } from "@colyseus/sdk";
import { MESSAGE_CATALOG, PROTOCOL_VERSION } from "@moon-cleanup/shared";
import {
  FRAME_OK,
  FrameReader,
  FrameView,
  PING_BODY_BYTES,
  SlotTable,
  encodeInput,
  readPongBody,
  rttFromPong,
  writePingBody,
  type MutableInput,
} from "@moon-cleanup/protocol";
import { createBotMetrics, type BotMetrics } from "../../clients/bot";
import { capSessionReconnection } from "../../clients/retry";
import { signed16, steer, type SteerResult } from "../../clients/steering";
import { createRng } from "../../rng";

/** REST seat reservation of ShiftRoom: `POST /v1/contracts/:id/join` (Bearer token, never in a URL). */
export const SHIFT_JOIN_PATH = "/v1/contracts/:id/join";
/** Tool-primary level bit in INPUT `buttons` (matches apps/server shift-room tests and the perf profiler). */
export const BUTTON_TOOL_PRIMARY = 1 << 3;
/** Plot count of the STANDARD grid; used for FRAME dust-section bounds until the Schema state reports its own. */
export const DEFAULT_PLOT_COUNT = 163841;
/** A self position step larger than this between two frames (10 Hz) counts as a teleport desync (metres). */
export const MAX_SELF_STEP_M = 6;

const CODE_ROOM_STATE = 14;
const CODE_ROOM_STATE_PATCH = 15;
const CODE_ROOM_DATA = 13;
const CODE_ROOM_DATA_BYTES = 17;

/** Player ids are server-trusted in the stub harness: `tok-<id>` is the Bearer token (test-only, no real credential). */
export function botPlayerId(index: number): string {
  return `00000000-0000-4000-8000-0000000002${index.toString(16).padStart(2, "0")}`;
}
export function botToken(index: number): string {
  return `tok-${botPlayerId(index)}`;
}

export interface ShiftBotMetrics extends BotMetrics {
  /** Frames the FrameReader rejected (truncated, wrong type, capacity, bad dust ids ...). */
  frameDecodeFailures: number;
  /** serverTick did not strictly increase between frames of one connection. */
  tickRegressions: number;
  /** ackInputSeq moved backwards (u16 signed distance < 0). */
  ackRegressions: number;
  /** Own position moved more than MAX_SELF_STEP_M between two frames. */
  positionJumps: number;
  maxSelfStepM: number;
  /** Total distance the server says this bot travelled (sum of frame-to-frame steps), metres. */
  distanceM: number;
  /** Last server-acked input seq (real or substituted); proves the sim consumed our inputs. */
  lastAck: number;
}

export function createShiftBotMetrics(): ShiftBotMetrics {
  return {
    ...createBotMetrics(),
    frameDecodeFailures: 0,
    tickRegressions: 0,
    ackRegressions: 0,
    positionJumps: 0,
    maxSelfStepM: 0,
    distanceM: 0,
    lastAck: -1,
  };
}

export const desyncCount = (m: ShiftBotMetrics): number =>
  m.frameDecodeFailures + m.tickRegressions + m.ackRegressions + m.positionJumps;

function newInput(): MutableInput {
  return { seq: 0, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 0 };
}

/**
 * Transport-free bot brain: seeded walk/clean script -> real INPUT messages (protocol codec), and FRAME ingestion with
 * the real FrameReader plus the desync checks. `ShiftBot` wires it to a Colyseus room; tests drive it directly.
 */
export class ShiftBotCore {
  readonly metrics = createShiftBotMetrics();
  plotCount = DEFAULT_PLOT_COUNT;
  rttMs = 100;
  private readonly rng: () => number;
  private readonly reader = new FrameReader();
  private readonly view = new FrameView();
  private table = new SlotTable();
  private readonly rec: [MutableInput, MutableInput] = [newInput(), newInput()];
  private readonly out = new Uint8Array(32);
  private readonly steerOut: SteerResult = { count: 1, resyncSeq: -1 };
  private frameBuf = new Uint8Array(4096);
  private seq = 0;
  private ack = -1;
  private lastTick = -1;
  private haveSelf = false;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private lastFrameAt = 0;
  private t = 0;
  private heading: number;
  private phaseLeft = 0;
  private cleaning = false;

  constructor(
    readonly index: number,
    seed: number,
    private readonly tickHz: number,
  ) {
    this.rng = createRng(seed * 1000 + index);
    this.heading = this.rng() * 65536;
  }

  /** New connection (a rejoin is a new seat: sequencing restarts). */
  onJoined(): void {
    this.seq = 0;
    this.ack = -1;
    this.lastTick = -1;
    this.haveSelf = false;
    this.lastFrameAt = 0;
    this.table = new SlotTable();
  }

  private script(into: MutableInput): void {
    this.t++;
    if (this.phaseLeft-- <= 0) {
      this.phaseLeft = 40 + Math.floor(this.rng() * 160);
      this.cleaning = this.rng() < 0.6;
      this.heading = (this.heading + (this.rng() - 0.5) * 30000) & 0xffff;
    }
    into.moveX = Math.round(Math.sin(this.t / 25 + this.index) * 50);
    into.moveY = this.cleaning ? 60 : 127;
    into.yaw = this.heading;
    into.pitch = Math.round(Math.sin(this.t / 90) * 20);
    into.buttons = this.cleaning ? BUTTON_TOOL_PRIMARY : 0;
    into.toolParam = 128;
  }

  /**
   * One client tick. Calls `send(body)` 0 or 1 times with the INPUT message BODY (id byte stripped, as
   * `Room.sendBytes` wants); the body views an internal buffer valid until `send` returns. Returns inputs carried.
   */
  tick(send: (body: Uint8Array) => void): number {
    const r = steer({ seq: this.seq, ack: this.ack, rttMs: this.rttMs, tickMs: 1000 / this.tickHz }, this.steerOut);
    const first = this.rec[0];
    const second = this.rec[1];
    this.script(first);
    if (r.resyncSeq >= 0) {
      this.seq = (r.resyncSeq - 1) & 0xffff;
      this.metrics.resyncs++;
    }
    if (r.count === 0) {
      this.metrics.skippedSends++;
      return 0;
    }
    Object.assign(second, first);
    this.seq = (this.seq + 1) & 0xffff;
    first.seq = this.seq;
    let n: number;
    if (r.count === 2) {
      this.seq = (this.seq + 1) & 0xffff;
      second.seq = this.seq;
      n = encodeInput(this.out, first, second);
    } else {
      n = encodeInput(this.out, first);
    }
    send(this.out.subarray(1, n));
    this.metrics.inputsSent += r.count;
    this.metrics.inputMessages++;
    return r.count;
  }

  /** FRAME message body (the SDK strips the id byte). */
  onFrame(body: Uint8Array, nowMs: number): void {
    const m = this.metrics;
    if (this.lastFrameAt > 0) m.frameGapsMs.push(nowMs - this.lastFrameAt);
    this.lastFrameAt = nowMs;
    m.frames++;
    m.bytes.frame += body.byteLength;
    if (this.frameBuf.byteLength < body.byteLength + 1) this.frameBuf = new Uint8Array((body.byteLength + 1) * 2);
    const msg = this.frameBuf.subarray(0, body.byteLength + 1);
    msg[0] = MESSAGE_CATALOG.FRAME.id as number;
    msg.set(body, 1);
    const v = this.view;
    if (this.reader.decode(msg, v, this.table, this.plotCount) !== FRAME_OK) {
      m.frameDecodeFailures++;
      return;
    }
    if (this.lastTick >= 0 && v.serverTick <= this.lastTick) m.tickRegressions++;
    this.lastTick = v.serverTick;
    if (this.ack >= 0 && signed16(v.ackInputSeq - this.ack) < 0) m.ackRegressions++;
    this.ack = v.ackInputSeq;
    m.lastAck = this.ack;
    m.depthSamples.push(v.inputBufferDepth);
    const s = v.self;
    if (this.haveSelf) {
      const step = Math.hypot(s.px - this.lastX, s.py - this.lastY, s.pz - this.lastZ);
      m.distanceM += step;
      if (step > m.maxSelfStepM) m.maxSelfStepM = step;
      if (step > MAX_SELF_STEP_M) m.positionJumps++;
    }
    this.haveSelf = true;
    this.lastX = s.px;
    this.lastY = s.py;
    this.lastZ = s.pz;
  }

  onPong(body: Uint8Array, nowMs: number): void {
    this.metrics.bytes.pong += body.byteLength;
    const pong = { clientTimeMs: 0, serverTick: 0 };
    if (readPongBody(body, pong)) {
      const rtt = rttFromPong(Math.floor(nowMs), pong.clientTimeMs);
      if (rtt >= 0) {
        this.metrics.rttMs.push(rtt);
        this.rttMs = this.rttMs * 0.7 + rtt * 0.3;
      }
    }
  }
}

type SdkRoom = Room<unknown, unknown>;

export interface ShiftBotOptions {
  readonly index: number;
  readonly baseUrl: string;
  readonly origin: string;
  readonly contractId: string;
  readonly tickHz: number;
  readonly seed: number;
}

/** Joins ShiftRoom through the REST route and the Colyseus SDK, then plays `ShiftBotCore`. */
export class ShiftBot {
  readonly core: ShiftBotCore;
  private room: SdkRoom | undefined;
  private leaving = false;
  private readonly pingBuf = new Uint8Array(PING_BODY_BYTES);

  constructor(private readonly options: ShiftBotOptions) {
    this.core = new ShiftBotCore(options.index, options.seed, options.tickHz);
  }

  get metrics(): ShiftBotMetrics {
    return this.core.metrics;
  }
  get connected(): boolean {
    return this.room !== undefined && !this.leaving;
  }
  get dropped(): boolean {
    return this.room === undefined && !this.leaving && this.core.metrics.joins > 0;
  }

  async join(): Promise<void> {
    const { baseUrl, origin, contractId, index } = this.options;
    const res = await fetch(`${baseUrl}${SHIFT_JOIN_PATH.replace(":id", contractId)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "true-client-ip": `203.0.113.${10 + index}`,
        authorization: `Bearer ${botToken(index)}`,
      },
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "bot-shift-v0" }),
    });
    if (res.status !== 200) throw new Error(`join failed: ${res.status} ${await res.text()}`);
    const { reservation } = (await res.json()) as { reservation: Parameters<Client["consumeSeatReservation"]>[0] };
    const client = new Client(baseUrl);
    client.http.options.headers = { Origin: origin };
    const room = (await client.consumeSeatReservation(reservation)) as SdkRoom;
    this.attach(room);
    this.room = room;
    this.leaving = false;
    this.core.metrics.joins++;
    this.core.onJoined();
  }

  private attach(room: SdkRoom): void {
    const core = this.core;
    const m = core.metrics;
    capSessionReconnection(room.reconnection);
    room.onMessage(MESSAGE_CATALOG.FRAME.id, (b: Uint8Array) => core.onFrame(b, performance.now()));
    room.onMessage(MESSAGE_CATALOG.PONG.id, (b: Uint8Array) => core.onPong(b, performance.now()));
    for (const id of [MESSAGE_CATALOG.DUST_SNAPSHOT.id, MESSAGE_CATALOG.DUST_LEDGER.id] as number[]) {
      room.onMessage(id, (b: Uint8Array) => (m.bytes.dust += b.byteLength));
    }
    room.onMessage("*", () => undefined);
    room.onStateChange(() => {
      const pc = (room.state as { plotCount?: number } | undefined)?.plotCount;
      if (typeof pc === "number" && pc > 0) core.plotCount = pc;
    });
    const conn = (room as unknown as { connection: { events: { onmessage?: (e: { data: ArrayBuffer }) => void } } })
      .connection;
    const original = conn.events.onmessage;
    conn.events.onmessage = (event) => {
      const data = event.data;
      const code = (new Uint8Array(data, 0, 1)[0] ?? 0) & 0x1f;
      if (code === CODE_ROOM_STATE_PATCH) m.bytes.statePatch += data.byteLength;
      else if (code === CODE_ROOM_STATE) m.bytes.stateFull += data.byteLength;
      else if (code !== CODE_ROOM_DATA && code !== CODE_ROOM_DATA_BYTES) m.bytes.other += data.byteLength;
      original?.(event);
    };
    room.onLeave(() => {
      m.disconnects++;
      if (!this.leaving) m.unexpectedDrops++;
      this.room = undefined;
    });
  }

  tick(): void {
    const room = this.room;
    if (room === undefined || this.leaving) return;
    this.core.tick((body) => room.sendBytes(MESSAGE_CATALOG.INPUT.id, body));
  }

  ping(): void {
    if (this.room === undefined || this.leaving) return;
    writePingBody(Math.floor(performance.now()), this.pingBuf);
    this.room.sendBytes(MESSAGE_CATALOG.PING.id, this.pingBuf);
  }

  async leave(): Promise<void> {
    const room = this.room;
    if (room === undefined) return;
    this.leaving = true;
    await room.leave().catch(() => undefined);
    this.room = undefined;
  }
}
