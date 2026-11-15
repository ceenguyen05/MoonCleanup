// HelloRoom: the M0 connectivity room (M0-W1-T04). Guest join, HELLO with the session parameters, PING/PONG RTT,
// protocol-version check (close 4100), a tiny Schema state to prove the client/server Schema handshake, and the
// manual patch cadence the real `shift` room uses (netcode.md section 3: automatic patching off, `broadcastPatch()`
// on frame ticks, frame sends and the patch coalesced into one write per client by `autoBatchMessages`).
//
// It owns its own fixed-step timer only because the process-wide driver (apps/server/src/sim) does not exist yet.

import { Room, type Client } from "@colyseus/core";
import { schema, t } from "@colyseus/schema";
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
import { PONG_BODY_BYTES, readPingBody, writePongBody } from "@moon-cleanup/protocol";
import { IdleWatch, type IdleLimits } from "./idle-watch";

/** Room name registered with the matchmaker. */
export const HELLO_ROOM_NAME = "hello";

/** Schema state of HelloRoom. Small on purpose: it exists to exercise the Schema encode/decode handshake. */
export const HelloState = schema(
  {
    protocolVersion: t.uint16(),
    simTickHz: t.uint8(),
    snapshotHz: t.uint8(),
    players: t.uint8(),
  },
  "HelloState",
);
export type HelloState = InstanceType<typeof HelloState>;

/** Rates and identity a HelloRoom runs with (from the validated server env; never hard-coded). */
export interface HelloRoomOptions {
  readonly simTickHz: number;
  readonly snapshotHz: number;
  readonly serverBuild: string;
  /** Handshake/silence limits of the idle watch (./idle-watch); defaults 10 s / 120 s. Tests shorten them. */
  readonly idle?: Partial<IdleLimits>;
}

/** Abuse thresholds of netcode.md section 11. */
export const VIOLATION_LIMIT = 50;
export const VIOLATION_WINDOW_MS = 10_000;

interface PerClient {
  pingWindowStart: number;
  pingsInWindow: number;
  violationWindowStart: number;
  violations: number;
}

/** Validates rates: positive integers, SNAPSHOT_HZ divides SIM_TICK_HZ (netcode.md N4). */
export function assertRates(simTickHz: number, snapshotHz: number): void {
  if (!Number.isInteger(simTickHz) || simTickHz < 1 || simTickHz > 255) throw new Error("simTickHz must be 1-255");
  if (!Number.isInteger(snapshotHz) || snapshotHz < 1 || snapshotHz > simTickHz) {
    throw new Error("snapshotHz must be 1..simTickHz");
  }
  if (simTickHz % snapshotHz !== 0) throw new Error("snapshotHz must divide simTickHz");
}

export class HelloRoom extends Room<{ state: HelloState }> {
  /** Simulation tick counter, reported in PONG. */
  tick = 0;
  /** Messages dropped (unknown type, malformed, rate-limited); exposed for tests and ops counters. */
  dropped = 0;

  /** Closes seats that never speak or fall silent (review NB1). Swept once a second from the fixed step. */
  idleWatch = new IdleWatch();

  private hello!: HelloPayload;
  private framesPerSnapshot = 1;
  private ticksPerSecond = 20;
  private readonly perClient = new Map<string, PerClient>();
  /** Reused PONG body buffer (no allocation per PING). */
  private readonly pongBody = new Uint8Array(PONG_BODY_BYTES);
  private readonly pong = { clientTimeMs: 0, serverTick: 0 };

  override onCreate(options: HelloRoomOptions): void {
    assertRates(options.simTickHz, options.snapshotHz);
    this.maxClients = MAX_PLAYERS_PER_ROOM;
    // Backstop above every per-type limit; the real limits are the per-type checks below.
    this.maxMessagesPerSecond = options.simTickHz * 4;
    this.autoBatchMessages = true;
    // Automatic patching off: the fixed-step loop below calls broadcastPatch() on frame ticks.
    this.patchRate = null;

    this.hello = {
      serverProtocol: PROTOCOL_VERSION,
      serverBuild: options.serverBuild,
      simTickHz: options.simTickHz,
      snapshotHz: options.snapshotHz,
    };
    this.framesPerSnapshot = options.simTickHz / options.snapshotHz;
    this.ticksPerSecond = options.simTickHz;
    this.idleWatch = new IdleWatch(options.idle);

    const state = new HelloState();
    state.protocolVersion = PROTOCOL_VERSION;
    state.simTickHz = options.simTickHz;
    state.snapshotHz = options.snapshotHz;
    state.players = 0;
    this.state = state;

    this.onMessageBytes(MESSAGE_CATALOG.PING.id, (client: Client, body: Uint8Array) => this.handlePing(client, body));
    // Unknown control or bytes types: drop and count, never disconnect on the first one (netcode.md section 2).
    this.onMessage("*", (client: Client) => this.violation(client));

    this.setSimulationInterval(() => this.step(), 1000 / options.simTickHz);
  }

  override onJoin(client: Client, options: unknown): void {
    const parsed = JoinOptionsSchema.safeParse(options);
    if (!parsed.success || parsed.data.protocolVersion !== PROTOCOL_VERSION) {
      const info: ProtocolMismatchInfo = { serverProtocol: PROTOCOL_VERSION, serverBuild: this.hello.serverBuild };
      client.leave(CloseCode.PROTOCOL_MISMATCH, JSON.stringify(info));
      return;
    }
    const now = Date.now();
    this.perClient.set(client.sessionId, {
      pingWindowStart: now,
      pingsInWindow: 0,
      violationWindowStart: now,
      violations: 0,
    });
    this.state.players = this.clients.length;
    this.idleWatch.add(client, now);
    client.send(MESSAGE_CATALOG.HELLO.id, this.hello);
  }

  /**
   * Colyseus calls this for ROOM_REQUEST frames whose type has no handler (they bypass `onMessage("*")` and get an
   * ERROR reply echoing the type): count them as violations so request spam closes with 4104 (review N4).
   */
  override onUnhandledMessage(client: Client): void {
    this.violation(client);
  }

  override onLeave(client: Client): void {
    this.perClient.delete(client.sessionId);
    this.idleWatch.remove(client.sessionId);
    this.state.players = this.clients.length;
  }

  /** One fixed step. Frame ticks (every SIM_TICK_HZ / SNAPSHOT_HZ steps) flush the Schema patch. */
  step(): void {
    this.tick = (this.tick + 1) >>> 0;
    if (this.tick % this.framesPerSnapshot === 0) this.broadcastPatch();
    if (this.tick % this.ticksPerSecond === 0) this.idleWatch.sweep(Date.now());
  }

  private handlePing(client: Client, body: Uint8Array): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    const now = Date.now();
    if (now - entry.pingWindowStart >= 1000) {
      entry.pingWindowStart = now;
      entry.pingsInWindow = 0;
    }
    if (++entry.pingsInWindow > PING_MAX_PER_SECOND) {
      // Dropped AND counted (review N5): sustained PING spam closes with 4104 like any other abuse.
      this.violation(client);
      return;
    }
    const clientTimeMs = readPingBody(body);
    if (clientTimeMs < 0) {
      this.violation(client);
      return;
    }
    this.idleWatch.touch(client.sessionId, now);
    this.pong.clientTimeMs = clientTimeMs;
    this.pong.serverTick = this.tick;
    writePongBody(this.pong, this.pongBody);
    client.sendBytes(MESSAGE_CATALOG.PONG.id, this.pongBody);
  }

  private violation(client: Client): void {
    this.dropped++;
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    const now = Date.now();
    if (now - entry.violationWindowStart >= VIOLATION_WINDOW_MS) {
      entry.violationWindowStart = now;
      entry.violations = 0;
    }
    if (++entry.violations > VIOLATION_LIMIT) client.leave(CloseCode.RATE_LIMITED);
  }
}
