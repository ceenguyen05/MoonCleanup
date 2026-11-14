// LoadTestRoom (M0-W2-T03): the netcode spike room. A thin Colyseus adapter over SpikeEngine that reproduces the MVP's
// per-tick server work and bytes at MAX_PLAYERS_PER_ROOM (6) players so a 0.1-CPU budget can be measured locally.
// Registered only when the composition root enables it (NET_SPIKE=1, default 0); never in production (env.ts refuses
// NET_SPIKE=1 with ENV_NAME=production).
//
// - Own drift-compensated fixed-step loop (max 3 catch-up steps, then slip and count an overrun) because the
//   process-wide driver (apps/server/src/sim) does not exist yet. Each tick runs inside `batchMessages`, so a
//   client's SPIKE_FRAME, SPIKE_DUST and the Schema patch leave as ONE socket write (netcode.md section 3 step 6).
// - Schema `SpikeState` with one avatar record per seat, patched on frame ticks, encode-once (no StateView).
// - Metrics: tick duration and bytes out per message type go to RoomStats (ops), which prints a room-stats line every
//   10 s when NET_SPIKE=1. Bytes are counted at the transport boundary (`client.raw`): Colyseus framing + body + the
//   WebSocket frame header; TCP/IP/TLS overhead is not visible here (see `socketWrites`).

import { Room, type Client } from "@colyseus/core";
import { ArraySchema, schema, t } from "@colyseus/schema";
import {
  CloseCode,
  JoinOptionsSchema,
  MAX_PLAYERS_PER_ROOM,
  MESSAGE_CATALOG,
  PING_MAX_PER_SECOND,
  PROTOCOL_VERSION,
  type HelloPayload,
  type ProtocolMismatchInfo,
} from "@moon-cleanup/shared";
import { PONG_BODY_BYTES, SPIKE_DUST_ID, SPIKE_FRAME_ID, readPingBody, writePongBody } from "@moon-cleanup/protocol";
import { SpikeRoomOptionsSchema } from "./options";
import { InputVerdict, SpikeEngine, type SpikeSink } from "./spike-engine";

/** Room name registered with the matchmaker. */
export const LOAD_TEST_ROOM_NAME = "load_test";

/** Per-room stats handle (ops RoomStats satisfies it). */
export interface SpikeRoomStats {
  setClients(count: number): void;
  recordTick(durationMs: number): void;
  recordBytesOut(type: string, bytes: number): void;
  /** Late/duplicate inputs dropped (counted per window and logged rate-limited by ops). */
  recordLateInputs?(count: number): void;
}

/** Registry of room stats (ops StatsReporter satisfies it). */
export interface SpikeStatsSink {
  addRoom(roomId: string): SpikeRoomStats;
  removeRoom(roomId: string): void;
}

/** Dependencies bound into the registered room class. */
export interface LoadTestRoomDeps {
  readonly stats: SpikeStatsSink;
  readonly serverBuild: string;
}

/** Max catch-up steps per wake (netcode.md section 3). */
export const MAX_CATCHUP_STEPS = 3;

export const SpikeAvatar = schema(
  {
    connected: t.boolean(),
    slot: t.uint8(),
    dustGrams: t.uint16(),
    equippedTool: t.uint8(),
    toolsOwned: t.uint8(),
  },
  "SpikeAvatar",
);
export type SpikeAvatar = InstanceType<typeof SpikeAvatar>;

export const SpikeState = schema(
  {
    protocolVersion: t.uint16(),
    simTickHz: t.uint8(),
    snapshotHz: t.uint8(),
    walletLumens: t.float64(),
    shinePolished: t.uint32(),
    avatars: t.array(SpikeAvatar),
  },
  "SpikeState",
);
export type SpikeState = InstanceType<typeof SpikeState>;

/** Colyseus protocol codes of server -> client frames (first byte). */
const CODE_ROOM_DATA = 13;
const CODE_ROOM_STATE = 14;
const CODE_ROOM_STATE_PATCH = 15;
const CODE_ROOM_DATA_BYTES = 17;
const PONG_ID = MESSAGE_CATALOG.PONG.id;

/** Message-type labels used in RoomStats bytesOutByType. */
export const BYTES_TYPE = {
  frame: "SPIKE_FRAME",
  dust: "SPIKE_DUST",
  pong: "PONG",
  patch: "schema_patch",
  fullState: "schema_full",
  control: "control",
  other: "other",
} as const;

/** Timing ring capacity (60 s at 30 Hz). */
const TIMING_RING = 2048;

export interface LoopTimings {
  readonly ticks: number;
  readonly overruns: number;
  readonly catchUpSteps: number;
  /** How late each step started vs its scheduled time, ms. */
  readonly latenessP50Ms: number;
  readonly latenessP95Ms: number;
  readonly latenessMaxMs: number;
  /** Socket writes (per-client coalesced tick writes + out-of-tick sends) in the window. */
  readonly socketWrites: number;
}

interface PerClient {
  seat: number;
  pingWindowStart: number;
  pingsInWindow: number;
  lastWriteTick: number;
}

export class LoadTestRoom extends Room<{ state: SpikeState }> {
  /** Set by `createLoadTestRoomClass`. */
  protected deps!: LoadTestRoomDeps;
  engine!: SpikeEngine;
  stats!: SpikeRoomStats;
  /** Unknown/malformed/rate-limited messages dropped (tests, ops). */
  dropped = 0;

  private hello!: HelloPayload;
  private readonly perClient = new Map<string, PerClient>();
  private readonly clientsBySeat: (Client | undefined)[] = [];
  private readonly pongBody = new Uint8Array(PONG_BODY_BYTES);
  private readonly pong = { clientTimeMs: 0, serverTick: 0 };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dtMs = 50;
  private nextDueMs = 0;
  private inTick = false;
  private disposed = false;
  private readonly lateness = new Float64Array(TIMING_RING);
  private latenessCount = 0;
  private latenessMax = 0;
  private ticksInWindow = 0;
  private overruns = 0;
  private catchUps = 0;
  private socketWrites = 0;
  /** `engine.counters.inputsLate` already forwarded to `stats.recordLateInputs`. */
  private lateReported = 0;
  private readonly sink: SpikeSink = {
    frame: (seat, body) => this.clientsBySeat[seat]?.sendBytes(SPIKE_FRAME_ID, body),
    dust: (seat, body) => this.clientsBySeat[seat]?.sendBytes(SPIKE_DUST_ID, body),
  };
  private readonly runStep = (): void => this.stepOnce();
  private readonly onTimer = (): void => this.wake();

  override onCreate(rawOptions: unknown): void {
    const options = SpikeRoomOptionsSchema.parse(rawOptions ?? {});
    this.maxClients = MAX_PLAYERS_PER_ROOM;
    this.maxMessagesPerSecond = options.tickHz * 4;
    this.autoBatchMessages = true;
    this.patchRate = null;
    this.engine = new SpikeEngine(options, MAX_PLAYERS_PER_ROOM);
    this.stats = this.deps.stats.addRoom(this.roomId);
    this.hello = {
      serverProtocol: PROTOCOL_VERSION,
      serverBuild: this.deps.serverBuild,
      simTickHz: options.tickHz,
      snapshotHz: options.snapshotHz,
    };

    const state = new SpikeState();
    state.protocolVersion = PROTOCOL_VERSION;
    state.simTickHz = options.tickHz;
    state.snapshotHz = options.snapshotHz;
    state.walletLumens = 0;
    state.shinePolished = 0;
    const avatars = new ArraySchema<SpikeAvatar>();
    for (let seat = 0; seat < MAX_PLAYERS_PER_ROOM; seat++) {
      const avatar = new SpikeAvatar();
      avatar.connected = false;
      avatar.slot = seat;
      avatar.dustGrams = 0;
      avatar.equippedTool = 0;
      avatar.toolsOwned = 1;
      avatars.push(avatar);
    }
    state.avatars = avatars;
    this.state = state;

    this.onMessageBytes(MESSAGE_CATALOG.SPIKE_INPUT.id, (client: Client, body: Uint8Array) =>
      this.handleInput(client, body),
    );
    this.onMessageBytes(MESSAGE_CATALOG.PING.id, (client: Client, body: Uint8Array) => this.handlePing(client, body));
    this.onMessage("*", (client: Client) => this.violation(client));

    this.dtMs = 1000 / options.tickHz;
    this.nextDueMs = performance.now() + this.dtMs;
    this.timer = setTimeout(this.onTimer, this.dtMs);
  }

  override onJoin(client: Client, options: unknown): void {
    const parsed = JoinOptionsSchema.safeParse(options);
    if (!parsed.success || parsed.data.protocolVersion !== PROTOCOL_VERSION) {
      const info: ProtocolMismatchInfo = { serverProtocol: PROTOCOL_VERSION, serverBuild: this.deps.serverBuild };
      client.leave(CloseCode.PROTOCOL_MISMATCH, JSON.stringify(info));
      return;
    }
    const now = Date.now();
    const seat = this.engine.addSeat(now);
    if (seat < 0) {
      client.leave(CloseCode.ROOM_FULL);
      return;
    }
    this.countBytes(client);
    this.perClient.set(client.sessionId, { seat, pingWindowStart: now, pingsInWindow: 0, lastWriteTick: -1 });
    this.clientsBySeat[seat] = client;
    const avatar = this.state.avatars[seat];
    if (avatar !== undefined) avatar.connected = true;
    this.stats.setClients(this.engine.activeSeats);
    client.send(MESSAGE_CATALOG.HELLO.id, this.hello);
  }

  /** ROOM_REQUEST frames of unknown types bypass `onMessage("*")`: count them as violations (review N4). */
  override onUnhandledMessage(client: Client): void {
    this.violation(client);
  }

  override onLeave(client: Client): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    this.perClient.delete(client.sessionId);
    this.engine.removeSeat(entry.seat);
    this.clientsBySeat[entry.seat] = undefined;
    const avatar = this.state.avatars[entry.seat];
    if (avatar !== undefined) avatar.connected = false;
    this.stats.setClients(this.engine.activeSeats);
  }

  override onDispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.deps.stats.removeRoom(this.roomId);
  }

  /** Loop timings since the previous call (harness/tests); starts a new window. */
  loopTimingsAndReset(): LoopTimings {
    const n = Math.min(this.latenessCount, TIMING_RING);
    const sorted = this.lateness.subarray(0, n).slice().sort();
    const pick = (p: number): number => (n === 0 ? 0 : (sorted[Math.min(n - 1, Math.ceil(p * n) - 1)] ?? 0));
    const result: LoopTimings = {
      ticks: this.ticksInWindow,
      overruns: this.overruns,
      catchUpSteps: this.catchUps,
      latenessP50Ms: round3(pick(0.5)),
      latenessP95Ms: round3(pick(0.95)),
      latenessMaxMs: round3(this.latenessMax),
      socketWrites: this.socketWrites,
    };
    this.latenessCount = 0;
    this.latenessMax = 0;
    this.ticksInWindow = 0;
    this.overruns = 0;
    this.catchUps = 0;
    this.socketWrites = 0;
    return result;
  }

  /** Runs one step immediately (tests). */
  stepNow(): void {
    this.batchMessages(this.runStep);
  }

  private wake(): void {
    if (this.disposed) return;
    const now = performance.now();
    let steps = 0;
    while (now >= this.nextDueMs && steps < MAX_CATCHUP_STEPS) {
      const late = now - this.nextDueMs;
      this.lateness[this.latenessCount % TIMING_RING] = late;
      this.latenessCount++;
      if (late > this.latenessMax) this.latenessMax = late;
      this.batchMessages(this.runStep);
      this.nextDueMs += this.dtMs;
      steps++;
    }
    if (steps > 1) this.catchUps += steps - 1;
    if (now >= this.nextDueMs) {
      // Still behind after the catch-up budget: slip the clock (tick_overrun).
      this.overruns++;
      this.nextDueMs = now + this.dtMs;
    }
    this.timer = setTimeout(this.onTimer, Math.max(0, this.nextDueMs - performance.now()));
  }

  private stepOnce(): void {
    const start = performance.now();
    this.inTick = true;
    this.engine.step(this.sink);
    this.reportLateInputs();
    if (this.engine.frameTickJustRan()) {
      const avatars = this.state.avatars;
      for (let seat = 0; seat < MAX_PLAYERS_PER_ROOM; seat++) {
        const avatar = avatars[seat];
        if (avatar === undefined || !this.engine.isActive(seat)) continue;
        // Dust Cell grams in 0.1 kg steps change ~once a second, like the real roster (netcode.md section 4.4).
        const grams = this.engine.gramsOf(seat) & 0xff00;
        if (avatar.dustGrams !== grams) avatar.dustGrams = grams;
      }
      const wallet = Math.floor(this.engine.walletLumens);
      if (this.state.walletLumens !== wallet) this.state.walletLumens = wallet;
      this.broadcastPatch();
    }
    this.inTick = false;
    this.ticksInWindow++;
    this.stats.recordTick(performance.now() - start);
  }

  /** Wraps the client's transport write to count wire bytes per message type and socket writes. */
  private countBytes(client: Client): void {
    const raw = client.raw.bind(client);
    const stats = this.stats;
    client.raw = (data: Uint8Array, options?: unknown, cb?: (err?: Error) => void): void => {
      const length = data.byteLength;
      // WebSocket server frame header: 2 B (< 126), 4 B (< 65,536), else 10 B.
      const wire = length + (length < 126 ? 2 : length < 65_536 ? 4 : 10);
      const code = data[0] ?? 0;
      let type: string = BYTES_TYPE.other;
      if (code === CODE_ROOM_DATA_BYTES) {
        const id = data[1] ?? 0;
        type =
          id === SPIKE_FRAME_ID
            ? BYTES_TYPE.frame
            : id === SPIKE_DUST_ID
              ? BYTES_TYPE.dust
              : id === PONG_ID
                ? BYTES_TYPE.pong
                : BYTES_TYPE.other;
      } else if (code === CODE_ROOM_STATE_PATCH) type = BYTES_TYPE.patch;
      else if (code === CODE_ROOM_STATE) type = BYTES_TYPE.fullState;
      else if (code === CODE_ROOM_DATA) type = BYTES_TYPE.control;
      stats.recordBytesOut(type, wire);
      const entry = this.perClient.get(client.sessionId);
      if (this.inTick && entry !== undefined) {
        if (entry.lastWriteTick !== this.engine.tick) {
          entry.lastWriteTick = this.engine.tick;
          this.socketWrites++;
        }
      } else {
        this.socketWrites++;
      }
      raw(data, options as never, cb as never);
    };
  }

  private handleInput(client: Client, body: Uint8Array): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    const now = Date.now();
    // +3: Colyseus framing (code + msgpack type) of the bytes message.
    if (this.engine.noteInbound(entry.seat, body.byteLength + 3, now)) {
      client.leave(CloseCode.RATE_LIMITED);
      return;
    }
    const verdict = this.engine.receiveInput(entry.seat, body, now);
    this.reportLateInputs();
    if (verdict === InputVerdict.Malformed || verdict === InputVerdict.RateLimited) this.violation(client);
  }

  /** Forwards the engine's late-drop delta (receive-time and drain-time drops) to the room stats. */
  private reportLateInputs(): void {
    const total = this.engine.counters.inputsLate;
    if (total === this.lateReported) return;
    this.stats.recordLateInputs?.(total - this.lateReported);
    this.lateReported = total;
  }

  private handlePing(client: Client, body: Uint8Array): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    const now = Date.now();
    this.engine.noteInbound(entry.seat, body.byteLength + 3, now);
    if (now - entry.pingWindowStart >= 1000) {
      entry.pingWindowStart = now;
      entry.pingsInWindow = 0;
    }
    if (++entry.pingsInWindow > PING_MAX_PER_SECOND) {
      // Dropped AND counted (review N5).
      this.violation(client);
      return;
    }
    const clientTimeMs = readPingBody(body);
    if (clientTimeMs < 0) {
      this.violation(client);
      return;
    }
    this.pong.clientTimeMs = clientTimeMs;
    this.pong.serverTick = this.engine.tick;
    writePongBody(this.pong, this.pongBody);
    client.sendBytes(PONG_ID, this.pongBody);
  }

  private violation(client: Client): void {
    this.dropped++;
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    if (this.engine.violation(entry.seat, Date.now())) client.leave(CloseCode.RATE_LIMITED);
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Binds the dependencies into a room class for `define` (the matchmaker constructs rooms itself). */
export function createLoadTestRoomClass(deps: LoadTestRoomDeps): typeof LoadTestRoom {
  return class BoundLoadTestRoom extends LoadTestRoom {
    protected override deps = deps;
  };
}
