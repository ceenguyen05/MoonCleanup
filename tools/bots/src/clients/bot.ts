import { Client, type Room } from "@colyseus/sdk";
import { MESSAGE_CATALOG, PROTOCOL_VERSION } from "@moon-cleanup/shared";
import {
  PING_BODY_BYTES,
  SPIKE_BUTTON_TOOL_PRIMARY,
  SPIKE_DUST_ID,
  SPIKE_FRAME_ID,
  createSpikeFrameHeader,
  createSpikeInput,
  readPongBody,
  readSpikeFrameHeader,
  rttFromPong,
  writePingBody,
  writeSpikeInputBody,
  type SpikeInput,
} from "@moon-cleanup/protocol";
import { createRng } from "../rng";
import { capSessionReconnection } from "./retry";
import { steer, type SteerResult } from "./steering";

/** REST seat reservation route of the NET_SPIKE LoadTestRoom (apps/server/src/net/spike/spike-join-route.ts). */
export const SPIKE_JOIN_PATH = "/v0/spike/join";

/** Colyseus base protocol codes (first byte of every frame, low 5 bits). */
const CODE_ROOM_STATE = 14;
const CODE_ROOM_STATE_PATCH = 15;
const CODE_ROOM_DATA = 13;
const CODE_ROOM_DATA_BYTES = 17;

export interface BotOptions {
  readonly index: number;
  /** HTTP base URL of the server (or of the netsim proxy in front of it), e.g. http://127.0.0.1:2571. */
  readonly baseUrl: string;
  readonly origin: string;
  readonly tickHz: number;
  readonly snapshotHz: number;
  readonly seed: number;
}

export interface BotMetrics {
  /** Wire bytes received, by message type (body bytes for FRAME/DUST/PONG; whole frames for Colyseus state). */
  bytes: { frame: number; dust: number; pong: number; statePatch: number; stateFull: number; other: number };
  frames: number;
  frameGapsMs: number[];
  rttMs: number[];
  /** Inputs sent, including the second record of a two-input message. */
  inputsSent: number;
  inputMessages: number;
  skippedSends: number;
  resyncs: number;
  joins: number;
  disconnects: number;
  unexpectedDrops: number;
  /** Buffer depth seen in frames (server-side input ring after drain). */
  depthSamples: number[];
}

export function createBotMetrics(): BotMetrics {
  return {
    bytes: { frame: 0, dust: 0, pong: 0, statePatch: 0, stateFull: 0, other: 0 },
    frames: 0,
    frameGapsMs: [],
    rttMs: [],
    inputsSent: 0,
    inputMessages: 0,
    skippedSends: 0,
    resyncs: 0,
    joins: 0,
    disconnects: 0,
    unexpectedDrops: 0,
    depthSamples: [],
  };
}

type SdkRoom = Room<unknown, unknown>;

/**
 * A headless Custodian stand-in: joins the spike room as a guest over REST, walks and cleans by a seeded script, and
 * sends inputs with a steered lead so the server never has to drop them as late.
 */
export class Bot {
  readonly metrics = createBotMetrics();
  private room: SdkRoom | undefined;
  private leaving = false;
  private readonly rng: () => number;
  private readonly input: SpikeInput = createSpikeInput();
  private readonly pair: SpikeInput[] = [createSpikeInput(), createSpikeInput()];
  private readonly inputBuf = new Uint8Array(32);
  private readonly pingBuf = new Uint8Array(PING_BODY_BYTES);
  private readonly header = createSpikeFrameHeader();
  private readonly pong = { clientTimeMs: 0, serverTick: 0 };
  private readonly steerOut: SteerResult = { count: 1, resyncSeq: -1 };
  private lastFrameAt = 0;
  private seq = 0;
  private ack = -1;
  private rttMs = 100;
  private t = 0;
  // Script state.
  private heading = 0;
  private phaseLeft = 0;
  private cleaning = false;

  constructor(private readonly options: BotOptions) {
    this.rng = createRng(options.seed * 1000 + options.index);
    this.heading = this.rng() * 65536;
  }

  get connected(): boolean {
    return this.room !== undefined && !this.leaving;
  }

  /** True after the server closed the connection without this bot leaving (e.g. a server restart). */
  get dropped(): boolean {
    return this.room === undefined && !this.leaving && this.metrics.joins > 0;
  }

  async join(): Promise<void> {
    const { baseUrl, origin, tickHz, snapshotHz } = this.options;
    const res = await fetch(`${baseUrl}${SPIKE_JOIN_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "bot-v0", tickHz, snapshotHz }),
    });
    if (res.status !== 200) throw new Error(`join failed: ${res.status} ${await res.text()}`);
    const { reservation } = (await res.json()) as { reservation: Parameters<Client["consumeSeatReservation"]>[0] };
    const client = new Client(baseUrl);
    client.http.options.headers = { Origin: origin };
    const room = (await client.consumeSeatReservation(reservation)) as SdkRoom;
    this.attach(room);
    this.room = room;
    this.leaving = false;
    this.metrics.joins++;
    // A rejoin is a new seat: the server restarts sequencing for it.
    this.seq = 0;
    this.ack = -1;
    this.lastFrameAt = 0;
  }

  private attach(room: SdkRoom): void {
    const m = this.metrics;
    // A dead server ends this bot after ~10 s (SDK default would retry for about a minute).
    capSessionReconnection(room.reconnection);
    room.onMessage(SPIKE_FRAME_ID, (b: Uint8Array) => {
      const now = performance.now();
      if (this.lastFrameAt > 0) m.frameGapsMs.push(now - this.lastFrameAt);
      this.lastFrameAt = now;
      m.frames++;
      m.bytes.frame += b.byteLength;
      if (readSpikeFrameHeader(b, this.header)) {
        this.ack = this.header.ackInputSeq;
        m.depthSamples.push(this.header.inputBufferDepth);
      }
    });
    room.onMessage(SPIKE_DUST_ID, (b: Uint8Array) => (m.bytes.dust += b.byteLength));
    room.onMessage(MESSAGE_CATALOG.PONG.id, (b: Uint8Array) => {
      m.bytes.pong += b.byteLength;
      if (readPongBody(b, this.pong)) {
        const rtt = rttFromPong(Math.floor(performance.now()), this.pong.clientTimeMs);
        if (rtt >= 0) {
          m.rttMs.push(rtt);
          this.rttMs = this.rttMs * 0.7 + rtt * 0.3;
        }
      }
    });
    room.onMessage("*", () => undefined);
    // Count whole Colyseus frames by protocol code (Schema patches are not visible to onMessage).
    const conn = (room as unknown as { connection: { events: { onmessage?: (e: { data: ArrayBuffer }) => void } } })
      .connection;
    const original = conn.events.onmessage;
    conn.events.onmessage = (event) => {
      const data = event.data;
      const first = new Uint8Array(data, 0, 1)[0] ?? 0;
      const code = first & 0x1f;
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

  /** Advances the walk/clean script by one tick and fills `this.input` (seq excluded). */
  private script(): void {
    this.t++;
    if (this.phaseLeft-- <= 0) {
      this.phaseLeft = 40 + Math.floor(this.rng() * 160);
      this.cleaning = this.rng() < 0.6;
      this.heading = (this.heading + (this.rng() - 0.5) * 30000) & 0xffff;
    }
    const i = this.input;
    i.moveX = Math.round(Math.sin(this.t / 25 + this.options.index) * 50);
    i.moveY = this.cleaning ? 60 : 127;
    i.yaw = this.heading;
    i.pitch = Math.round(Math.sin(this.t / 90) * 20);
    i.buttons = this.cleaning ? SPIKE_BUTTON_TOOL_PRIMARY : 0;
    i.toolParam = 0;
  }

  /** Called once per client tick (tickHz). */
  tick(): void {
    const room = this.room;
    if (room === undefined || this.leaving) return;
    this.script();
    const result = steer(
      { seq: this.seq, ack: this.ack, rttMs: this.rttMs, tickMs: 1000 / this.options.tickHz },
      this.steerOut,
    );
    if (result.resyncSeq >= 0) {
      this.seq = (result.resyncSeq - 1) & 0xffff;
      this.metrics.resyncs++;
    }
    if (result.count === 0) {
      this.metrics.skippedSends++;
      return;
    }
    for (let k = 0; k < result.count; k++) {
      this.seq = (this.seq + 1) & 0xffff;
      const rec = this.pair[k] as SpikeInput;
      Object.assign(rec, this.input);
      rec.seq = this.seq;
    }
    const n = writeSpikeInputBody(this.pair, result.count, this.inputBuf);
    room.sendBytes(MESSAGE_CATALOG.SPIKE_INPUT.id, this.inputBuf.subarray(0, n));
    this.metrics.inputsSent += result.count;
    this.metrics.inputMessages++;
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
