// ShiftRoom: the authoritative multiplayer room (`shift`, one per Contract, 1-6 players; netcode.md sections 3, 9, 11,
// 12). A thin Colyseus adapter over ShiftCore. Solo Shifts never reach this file (ADR-0031: LocalRoom in the browser).
//
// - Join: seats are reserved only by the REST join route (public matchmake disabled). The reserved options carry the
//   server-verified playerId/role/displayName; `onAuth` redeems the single-use join ticket the REST route granted
//   server-side for this sessionId, bound to that playerId and this roomId. Nothing secret travels in the WebSocket
//   URL (no `_authToken`); the JWT itself is verified at the REST route (security.md section 3). Protocol mismatch closes 4100; a second seat of the same playerId closes the older one with 4106.
// - Channels: INPUT/PING bytes in; FRAME/PONG bytes out (encode per client from one reused writer); Schema ShiftState
//   encode-once, no StateView, patched only on frame ticks; control messages zod-validated at the edge.
// - Limits: per-type token buckets, violations > 50 / 10 s and inbound > 8 KB/s for 5 s close 4104; unknown types are
//   dropped and counted; handshake/silence watch (4107) plus the AFK rule (10 min flag, 30 min close 4107).
// - Seat hold: a non-consented drop keeps the avatar frozen for SEAT_HOLD_S (`allowReconnection`); reconnect gets a
//   keyframe.
// - Own drift-compensated fixed-step loop (max 3 catch-up steps) until the process-wide driver (apps/server/src/sim,
//   W4-T03) exists. Each tick runs inside `batchMessages` so FRAME + patch leave as one socket write per client.

import { Room, ServerError, type Client } from "@colyseus/core";
import {
  AFK_AFTER_S,
  BEACON_COUNT,
  CloseCode,
  ContractRoleSchema,
  ControlIntentSchema,
  DustInterestPayloadSchema,
  IDLE_CLOSE_AFTER_S,
  INBOUND_BYTES_LIMIT,
  JoinOptionsSchema,
  KickPayloadSchema,
  MAX_PLAYERS_PER_ROOM,
  MESSAGE_CATALOG,
  PING_MAX_PER_SECOND,
  PROTOCOL_VERSION,
  PurchasePayloadSchema,
  RATE_LIMITS,
  SEAT_HOLD_S,
  SelectToolPayloadSchema,
  SetShiftTypePayloadSchema,
  ShiftTypeSchema,
  VIOLATION_LIMIT,
  VisibilityPayloadSchema,
  type ContractId,
  type ContractRole,
  type HelloPayload,
  type IntentResult,
  type PlayerId,
  type ProtocolMismatchInfo,
  type PurchaseResultPayload,
  type WireSimEvent,
} from "@moon-cleanup/shared";
import { FRAME_TYPE_ID } from "@moon-cleanup/shared";
import { PONG_BODY_BYTES, readPingBody, writePongBody } from "@moon-cleanup/protocol";
import type { GameData } from "@moon-cleanup/game-data";
import { SIM_CHECKPOINT_META_VERSION, type SimWorld } from "@moon-cleanup/sim";
import type { WorldDustLedger } from "@moon-cleanup/world";
import { z } from "zod";
import { IdleWatch, type IdleLimits } from "../idle-watch";
import type { SpikeRoomStats, SpikeStatsSink } from "../spike";
import { socketBufferedBytes } from "../socket-buffer";
import type { JoinTickets } from "./join-ticket";
import { InputVerdict, ShiftCore, type ShiftSink } from "./shift-core";
import { createShiftLedger } from "./shift-ledger";
import { ShiftDustPersistence, type ShiftDustPersistenceLogger, type ShiftDustStore } from "./shift-persistence";
import {
  ArraySchema,
  BeaconState,
  PermissionsState,
  PlayerInfoState,
  ShiftStateSchemaClass,
  nearParcelsMask,
} from "./shift-state";
import { TokenBucket } from "./token-bucket";

export const SHIFT_ROOM_NAME = "shift";
/** Max catch-up steps per wake (netcode.md section 3). */
export const SHIFT_MAX_CATCHUP_STEPS = 3;
const TIMING_RING = 4096;

/** Options the REST join route reserves with (server-trusted: public matchmake is disabled). */
export const ShiftReservedOptionsSchema = JoinOptionsSchema.extend({
  contractId: z.string().min(1).max(64),
  shiftType: ShiftTypeSchema,
  playerId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(20),
  role: ContractRoleSchema,
});
export type ShiftReservedOptions = z.infer<typeof ShiftReservedOptionsSchema>;

/** Dependencies bound into the registered class by `createShiftRoomClass`. */
export interface ShiftRoomDeps {
  readonly data: GameData;
  readonly world: SimWorld;
  readonly simTickHz: number;
  readonly snapshotHz: number;
  readonly serverBuild: string;
  readonly tickets: JoinTickets;
  readonly stats?: SpikeStatsSink;
  readonly idle?: Partial<IdleLimits>;
  /** Seat hold seconds (default SEAT_HOLD_S); tests shorten it. */
  readonly seatHoldS?: number;
  /** Dust persistence (restore on create, save every 30 s when dirty and on dispose). Absent: dust is not kept. */
  readonly dustStore?: ShiftDustStore;
  /** `bakeCheck` byte of the stored chunks (first byte of the world bakeHash; 0 until the server world is baked). */
  readonly bakeCheck?: number;
  readonly logger?: ShiftDustPersistenceLogger;
}

interface PerClient {
  readonly seat: number;
  readonly playerId: string;
  readonly role: ContractRole;
  readonly ping: TokenBucket;
  readonly control: TokenBucket;
  readonly purchase: TokenBucket;
  readonly visibility: TokenBucket;
  readonly dustRequest: TokenBucket;
  violationWindowStart: number;
  violations: number;
  inboundWindowStart: number;
  inboundBytes: number;
  inboundOverSeconds: number;
}

export class ShiftRoom extends Room<{ state: ShiftStateSchemaClass }> {
  protected deps!: ShiftRoomDeps;
  core!: ShiftCore;
  /** Dropped messages (unknown, malformed, rate-limited); tests and ops. */
  dropped = 0;
  idleWatch = new IdleWatch();
  private stats: SpikeRoomStats | undefined;
  private hello!: HelloPayload;
  private readonly perClient = new Map<string, PerClient>();
  private readonly clientsBySeat: (Client | undefined)[] = [];
  private readonly sessionBySeat: (string | undefined)[] = [];
  private readonly pongBody = new Uint8Array(PONG_BODY_BYTES);
  private readonly pong = { clientTimeMs: 0, serverTick: 0 };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dtMs = 50;
  private nextDueMs = 0;
  private disposed = false;
  private lateReported = 0;
  /** Tick durations (ms) ring for p95 reporting. */
  readonly tickMs = new Float64Array(TIMING_RING);
  tickCount = 0;
  overruns = 0;
  /** Dust persistence of this room (when the deps carry a store). */
  persistence: ShiftDustPersistence | undefined;
  private readonly sink: ShiftSink = {
    frame: (seat, body) => this.clientsBySeat[seat]?.sendBytes(FRAME_TYPE_ID, body),
    events: (events) => this.sendEvents(events),
    bytes: (seat, typeId, body) => this.clientsBySeat[seat]?.sendBytes(typeId, body),
    buffered: (seat) => socketBufferedBytes(this.clientsBySeat[seat]),
  };
  private readonly runStep = (): void => this.stepOnce();
  private readonly onTimer = (): void => this.wake();

  override async onCreate(rawOptions: unknown): Promise<void> {
    const options = ShiftReservedOptionsSchema.pick({ contractId: true, shiftType: true }).parse(rawOptions);
    const deps = this.deps;
    // The ledger is restored BEFORE the sim exists: the sim then starts from the stored Shine (no milestone or Stamp
    // replays) and the restore never races a tick.
    const ledger: WorldDustLedger = createShiftLedger(deps.data, deps.world, deps.simTickHz);
    if (deps.dustStore !== undefined) {
      this.persistence = new ShiftDustPersistence(
        deps.dustStore,
        ledger,
        options.contractId,
        deps.bakeCheck ?? 0,
        Date.now(),
        deps.logger,
      );
      try {
        await this.persistence.restore();
      } catch (error) {
        // A durable store refused (database down, save does not decode, lease lost): the room never starts, nothing is
        // written, the lease goes back. The join answers 503 RETRY_LATER.
        await this.persistence.abort();
        this.persistence = undefined;
        this.disposed = true;
        throw error;
      }
      // netcode.md 9.3: a Contract lease found gone stops the checkpoints and closes the room with 4108.
      this.persistence.watchLease(() => void this.disconnect(CloseCode.CONTRACT_UNAVAILABLE));
    }
    // One spare Colyseus seat: a player re-joining from a second tab must reach THIS room (one room per Contract) so
    // onJoin can close the older connection with 4106. The core still seats at most MAX_PLAYERS_PER_ROOM; a 7th
    // distinct player is closed with 4105 ROOM_FULL.
    this.maxClients = MAX_PLAYERS_PER_ROOM + 1;
    this.maxMessagesPerSecond = deps.simTickHz * 4;
    this.autoBatchMessages = true;
    this.patchRate = null;
    this.idleWatch = new IdleWatch(deps.idle);
    const restored = this.persistence?.restoredState;
    this.core = new ShiftCore(
      {
        data: deps.data,
        world: deps.world,
        contractId: options.contractId as ContractId,
        shiftType: options.shiftType,
        simTickHz: deps.simTickHz,
        snapshotHz: deps.snapshotHz,
        ledger,
        // The wallet and collected Near Parcels stored in the room header (interim room-v3), always together: a wallet
        // without the mask would re-pay the parcels on every restart (review B1). Absent = the sim's default start.
        ...(restored == null
          ? {}
          : { walletLm: restored.walletLm, nearParcelsCollected: restored.nearParcelsMask ?? 0 }),
      },
      Date.now(),
    ); // one wall clock (Date.now) for every seat bucket: receiveInput below also passes Date.now()
    // Review N1: what was bought (Standard Issue tools, suit gear, board levels, Roosts) comes back from the sim META
    // section. A section this build refuses (balance edit, other tool table) leaves the sim as built above (wallet and
    // parcels from the header), logged: nothing bought is re-paid, at worst it is lost.
    if (restored?.simMeta !== undefined) {
      const r = this.core.restoreSharedMeta(restored.simMeta);
      if (!r.ok) {
        deps.logger?.warn({ code: r.code, detail: r.detail }, "shift room sim META refused; gear not restored");
        // Review N6: a META version bump refuses EVERY stored section, so all purchased gear of this Contract is gone
        // (the header wallet stays). No migration exists; a bump needs a reader for the old layout first.
        if (r.code === "unsupported_version") {
          deps.logger?.warn(
            { storedMetaVersion: restored.simMeta.version, buildMetaVersion: SIM_CHECKPOINT_META_VERSION },
            "shift room sim META version changed: purchased gear of this Contract was lost (no META migration, review N6)",
          );
        }
      }
    }
    this.persistence?.setStateProvider(
      () => ({ walletLm: this.core.sim.wallet, nearParcelsMask: nearParcelsMask(this.core.sim) }),
      () => this.core.captureSharedMeta(),
    );
    this.stats = deps.stats?.addRoom(this.roomId);
    this.hello = {
      serverProtocol: PROTOCOL_VERSION,
      serverBuild: deps.serverBuild,
      simTickHz: deps.simTickHz,
      snapshotHz: deps.snapshotHz,
    };
    this.state = this.buildState(options.contractId, options.shiftType);

    this.onMessageBytes(MESSAGE_CATALOG.INPUT.id, (c: Client, b: Uint8Array) => this.handleInput(c, b));
    this.onMessageBytes(MESSAGE_CATALOG.PING.id, (c: Client, b: Uint8Array) => this.handlePing(c, b));
    this.onMessageBytes(MESSAGE_CATALOG.DUST_REQUEST.id, (c: Client, b: Uint8Array) => this.handleDustRequest(c, b));
    this.onMessage(MESSAGE_CATALOG.READY.id, (c: Client) => this.control(c, () => true));
    this.onMessage(MESSAGE_CATALOG.VISIBILITY.id, (c: Client, m: unknown) => this.handleVisibility(c, m));
    this.onMessage(MESSAGE_CATALOG.DUST_INTEREST.id, (c: Client, m: unknown) =>
      this.control(c, (e) => {
        const p = DustInterestPayloadSchema.safeParse(m);
        if (!p.success) return false;
        this.core.setDustRadius(e.seat, p.data.residencyRadiusM);
        return true;
      }),
    );
    this.onMessage(MESSAGE_CATALOG.SELECT_TOOL.id, (c: Client, m: unknown) =>
      this.control(c, (e) => {
        const p = SelectToolPayloadSchema.safeParse(m);
        if (!p.success) return false;
        this.core.queueIntent(e.seat, { kind: "select_tool", slot: p.data.slot });
        return true;
      }),
    );
    this.onMessage(MESSAGE_CATALOG.PURCHASE.id, (c: Client, m: unknown) => this.handlePurchase(c, m));
    this.onMessage(MESSAGE_CATALOG.SET_SHIFT_TYPE.id, (c: Client, m: unknown) =>
      this.control(c, (e) => {
        const p = SetShiftTypePayloadSchema.safeParse(m);
        if (!p.success) return false;
        if (e.role !== "holder" || (p.data.shiftType === "solo" && this.core.activeSeats > 1)) {
          c.send(MESSAGE_CATALOG.ERROR.id, { code: "FORBIDDEN", ref: MESSAGE_CATALOG.SET_SHIFT_TYPE.id });
          return true;
        }
        if (this.state.shiftType !== p.data.shiftType) {
          this.state.shiftType = p.data.shiftType;
          this.broadcast(MESSAGE_CATALOG.SHIFT_TYPE_CHANGED.id, { shiftType: p.data.shiftType });
        }
        return true;
      }),
    );
    this.onMessage(MESSAGE_CATALOG.KICK.id, (c: Client, m: unknown) =>
      this.control(c, (e) => {
        const p = KickPayloadSchema.safeParse(m);
        if (!p.success) return false;
        const target = this.findByPlayer(p.data.playerId);
        if (e.role !== "holder" || target === undefined || target.sessionId === c.sessionId) {
          c.send(MESSAGE_CATALOG.ERROR.id, { code: "FORBIDDEN", ref: MESSAGE_CATALOG.KICK.id });
          return true;
        }
        target.send(MESSAGE_CATALOG.KICK_NOTICE.id, { by: "holder", reasonCode: p.data.reasonCode });
        target.leave(CloseCode.KICKED);
        return true;
      }),
    );
    // Unknown control or bytes types: drop and count (netcode.md section 2).
    this.onMessage("*", (c: Client) => this.violation(c));

    this.dtMs = 1000 / deps.simTickHz;
    this.nextDueMs = performance.now() + this.dtMs;
    this.timer = setTimeout(this.onTimer, this.dtMs);
  }

  // The AuthContext (its `token` is the `_authToken` URL query) is deliberately not read and never logged: the ticket
  // is redeemed from the server-side grant of this reserved sessionId (./join-ticket, security.md section 3).
  override onAuth(client: Client, options: unknown): unknown {
    const parsed = ShiftReservedOptionsSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(CloseCode.AUTH_INVALID, "invalid reservation");
    const ok = this.deps.tickets.redeemSession({
      playerId: parsed.data.playerId,
      roomId: this.roomId,
      sessionId: client.sessionId,
    });
    if (!ok) throw new ServerError(CloseCode.AUTH_INVALID, "invalid join ticket");
    return { playerId: parsed.data.playerId };
  }

  override onJoin(client: Client, options: unknown): void {
    const parsed = ShiftReservedOptionsSchema.safeParse(options);
    if (!parsed.success || parsed.data.protocolVersion !== PROTOCOL_VERSION) {
      const info: ProtocolMismatchInfo = { serverProtocol: PROTOCOL_VERSION, serverBuild: this.deps.serverBuild };
      client.leave(CloseCode.PROTOCOL_MISMATCH, JSON.stringify(info));
      return;
    }
    const o = parsed.data;
    // Duplicate session: the newer connection wins, the older one closes with 4106 (netcode.md section 9.2).
    const older = this.findByPlayer(o.playerId);
    if (older !== undefined) {
      const entry = this.perClient.get(older.sessionId);
      older.leave(CloseCode.DUPLICATE_SESSION);
      if (entry !== undefined) this.releaseSeat(older.sessionId, entry);
    } else {
      this.releaseHeldSeatOf(o.playerId);
    }
    const seat = this.core.addSeat(
      { playerId: o.playerId as PlayerId, displayName: o.displayName, role: o.role },
      Date.now(),
    );
    if (seat < 0) {
      client.leave(CloseCode.ROOM_FULL);
      return;
    }
    const now = Date.now();
    this.perClient.set(client.sessionId, {
      seat,
      playerId: o.playerId,
      role: o.role,
      ping: new TokenBucket(PING_MAX_PER_SECOND, PING_MAX_PER_SECOND, now),
      control: TokenBucket.of(RATE_LIMITS.control, now),
      purchase: TokenBucket.of(RATE_LIMITS.purchase, now),
      visibility: TokenBucket.of(RATE_LIMITS.visibility, now),
      dustRequest: TokenBucket.of(RATE_LIMITS.dustRequest, now),
      violationWindowStart: now,
      violations: 0,
      inboundWindowStart: now,
      inboundBytes: 0,
      inboundOverSeconds: 0,
    });
    this.clientsBySeat[seat] = client;
    this.sessionBySeat[seat] = client.sessionId;
    const info = new PlayerInfoState();
    info.playerId = o.playerId;
    info.displayName = o.displayName;
    info.slot = seat;
    info.role = o.role;
    info.tenureLevel = 0;
    info.connected = true;
    info.afk = false;
    info.hidden = false;
    this.state.players.set(client.sessionId, info);
    this.syncPlayer(seat, info);
    this.idleWatch.add(client, now);
    this.stats?.setClients(this.core.activeSeats);
    client.send(MESSAGE_CATALOG.HELLO.id, this.hello);
  }

  override onUnhandledMessage(client: Client): void {
    this.violation(client);
  }

  override onDrop(client: Client): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    this.core.holdSeat(entry.seat);
    this.clientsBySeat[entry.seat] = undefined;
    this.idleWatch.remove(client.sessionId);
    const info = this.state.players.get(client.sessionId);
    if (info !== undefined) info.connected = false;
    this.allowReconnection(client, this.deps.seatHoldS ?? SEAT_HOLD_S).catch(() => undefined);
  }

  override onReconnect(client: Client): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    this.core.resumeSeat(entry.seat, Date.now());
    this.clientsBySeat[entry.seat] = client;
    this.idleWatch.add(client, Date.now());
    const info = this.state.players.get(client.sessionId);
    if (info !== undefined) info.connected = true;
    client.send(MESSAGE_CATALOG.HELLO.id, this.hello);
  }

  override onLeave(client: Client): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    this.releaseSeat(client.sessionId, entry);
  }

  override async onDispose(): Promise<void> {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.deps.stats?.removeRoom(this.roomId);
    // Room empty or shutdown: write the dirty dust chunks (WDS section 6).
    // The lease is released after the final checkpoint (data-model 3.5 "Dispose").
    if (this.persistence !== undefined && this.core !== undefined) {
      await this.persistence.close(Date.now(), this.core.sim.tick);
    } else if (this.persistence !== undefined) {
      await this.persistence.abort();
    }
  }

  /** Runs one step now (tests). */
  stepNow(): void {
    this.batchMessages(this.runStep);
  }

  /** p50/p95/max tick duration over the recorded ring (tests, report). */
  tickStats(): { readonly n: number; readonly p50: number; readonly p95: number; readonly max: number } {
    return percentiles(this.tickMs, Math.min(this.tickCount, TIMING_RING));
  }

  seatOf(sessionId: string): number {
    return this.perClient.get(sessionId)?.seat ?? -1;
  }

  // ---- loop ---------------------------------------------------------------------------------------------------------

  private wake(): void {
    if (this.disposed) return;
    const now = performance.now();
    let steps = 0;
    while (now >= this.nextDueMs && steps < SHIFT_MAX_CATCHUP_STEPS) {
      this.batchMessages(this.runStep);
      this.nextDueMs += this.dtMs;
      steps++;
    }
    if (now >= this.nextDueMs) {
      this.overruns++;
      this.nextDueMs = now + this.dtMs;
    }
    this.timer = setTimeout(this.onTimer, Math.max(0, this.nextDueMs - performance.now()));
  }

  private stepOnce(): void {
    const start = performance.now();
    const core = this.core;
    core.step(this.sink);
    const late = core.counters.inputsLate;
    if (late !== this.lateReported) {
      this.stats?.recordLateInputs?.(late - this.lateReported);
      this.lateReported = late;
    }
    if (core.lastWasFrameTick) {
      const wallet = core.sim.wallet;
      if (this.state.walletLumens !== wallet) this.state.walletLumens = wallet;
      const shine = core.sim.shinePolished;
      if (this.state.shinePolished !== shine) this.state.shinePolished = shine;
      const parcels = nearParcelsMask(core.sim);
      if (this.state.nearParcelsCollected !== parcels) this.state.nearParcelsCollected = parcels;
      for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
        const sid = this.sessionBySeat[s];
        if (sid === undefined) continue;
        const info = this.state.players.get(sid);
        if (info !== undefined) this.syncPlayer(s, info);
      }
      this.broadcastPatch();
    }
    const tick = core.sim.tick;
    if (tick % this.deps.simTickHz === 0) {
      this.sweepIdle(tick);
      this.persistence?.maybeSave(Date.now(), tick);
    }
    const ms = performance.now() - start;
    this.tickMs[this.tickCount % TIMING_RING] = ms;
    this.tickCount++;
    this.stats?.recordTick(ms);
  }

  /** Once a second: handshake/silence watch and the AFK rule. */
  private sweepIdle(tick: number): void {
    this.idleWatch.sweep(Date.now());
    const hz = this.deps.simTickHz;
    for (let s = 0; s < MAX_PLAYERS_PER_ROOM; s++) {
      const sid = this.sessionBySeat[s];
      if (sid === undefined || this.core.isHeld(s)) continue;
      const idle = this.core.idleTicks(s);
      const info = this.state.players.get(sid);
      const afk = idle >= AFK_AFTER_S * hz;
      if (info !== undefined && info.afk !== afk) info.afk = afk;
      if (idle >= IDLE_CLOSE_AFTER_S * hz) this.clientsBySeat[s]?.leave(CloseCode.IDLE_TIMEOUT);
    }
    void tick;
  }

  // ---- handlers -----------------------------------------------------------------------------------------------------

  private handleInput(client: Client, body: Uint8Array): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    if (!this.inbound(client, body.byteLength + 3)) return;
    const verdict = this.core.receiveInput(entry.seat, body, Date.now());
    if (verdict === InputVerdict.Ok) {
      this.idleWatch.touch(client.sessionId, Date.now());
    } else if (verdict === InputVerdict.Malformed || verdict === InputVerdict.RateLimited) {
      this.violation(client);
    }
  }

  /** DUST_REQUEST (<= 1 per 2 s): answered after the next frame tick. Over the rate or malformed is a violation. */
  private handleDustRequest(client: Client, body: Uint8Array): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    if (!this.inbound(client, body.byteLength + 3)) return;
    if (!entry.dustRequest.take(Date.now()) || !this.core.receiveDustRequest(entry.seat, body)) {
      this.violation(client);
      return;
    }
    this.idleWatch.touch(client.sessionId, Date.now());
  }

  private handlePing(client: Client, body: Uint8Array): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    if (!this.inbound(client, body.byteLength + 3)) return;
    const now = Date.now();
    if (!entry.ping.take(now)) {
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
    this.pong.serverTick = this.core.sim.tick;
    writePongBody(this.pong, this.pongBody);
    client.sendBytes(MESSAGE_CATALOG.PONG.id, this.pongBody);
  }

  private handleVisibility(client: Client, message: unknown): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    if (!entry.visibility.take(Date.now())) {
      this.dropped++;
      return;
    }
    this.control(client, (e) => {
      const p = VisibilityPayloadSchema.safeParse(message);
      if (!p.success) return false;
      this.core.setHidden(e.seat, p.data.hidden);
      const info = this.state.players.get(client.sessionId);
      if (info !== undefined) info.hidden = p.data.hidden;
      return true;
    });
  }

  private handlePurchase(client: Client, message: unknown): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    const parsed = PurchasePayloadSchema.safeParse(message);
    if (!entry.purchase.take(Date.now())) {
      if (parsed.success) {
        // PurchaseResultPayload: `code` is a PURCHASE_REJECT_REASONS value (lower case), not the wire `error` code.
        const refused: PurchaseResultPayload = { requestId: parsed.data.requestId, ok: false, code: "rate_limited" };
        client.send(MESSAGE_CATALOG.PURCHASE_RESULT.id, refused);
      }
      this.dropped++;
      return;
    }
    this.control(client, (e) => {
      if (!parsed.success) return false;
      const intent = ControlIntentSchema.safeParse({ kind: "purchase", ...parsed.data });
      if (!intent.success) return false;
      this.core.queueIntent(e.seat, intent.data, (r: IntentResult) => {
        if (r !== null) this.clientsBySeat[e.seat]?.send(MESSAGE_CATALOG.PURCHASE_RESULT.id, r);
      });
      return true;
    });
  }

  /** Shared control-message gate: control bucket, zod handler (false = invalid -> `error` + violation), idle touch. */
  private control(client: Client, handle: (entry: PerClient) => boolean): void {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    const now = Date.now();
    if (!entry.control.take(now)) {
      this.dropped++;
      client.send(MESSAGE_CATALOG.ERROR.id, { code: "RATE_LIMITED" });
      return;
    }
    let ok = false;
    try {
      ok = handle(entry);
    } catch {
      ok = false;
    }
    if (!ok) {
      client.send(MESSAGE_CATALOG.ERROR.id, { code: "INVALID" });
      this.violation(client);
      return;
    }
    this.idleWatch.touch(client.sessionId, now);
  }

  /** Inbound bytes limit (> 8 KB/s sustained 5 s closes 4104). Returns false when the client was closed. */
  private inbound(client: Client, bytes: number): boolean {
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return false;
    const now = Date.now();
    if (now - entry.inboundWindowStart >= 1000) {
      const over = entry.inboundBytes > INBOUND_BYTES_LIMIT.bytesPerSecond;
      entry.inboundOverSeconds = over ? entry.inboundOverSeconds + 1 : 0;
      entry.inboundWindowStart = now;
      entry.inboundBytes = 0;
      if (entry.inboundOverSeconds >= INBOUND_BYTES_LIMIT.sustainedS) {
        client.leave(CloseCode.RATE_LIMITED);
        return false;
      }
    }
    entry.inboundBytes += bytes;
    return true;
  }

  private violation(client: Client): void {
    this.dropped++;
    const entry = this.perClient.get(client.sessionId);
    if (entry === undefined) return;
    const now = Date.now();
    if (now - entry.violationWindowStart >= VIOLATION_LIMIT.windowS * 1000) {
      entry.violationWindowStart = now;
      entry.violations = 0;
    }
    if (++entry.violations > VIOLATION_LIMIT.count) client.leave(CloseCode.RATE_LIMITED);
  }

  private sendEvents(events: readonly WireSimEvent[]): void {
    // Rare (purchases, day/night, Cell near-full): one msgpack broadcast, encoded once by Colyseus.
    this.broadcast(MESSAGE_CATALOG.SIM_EVENTS.id, { events: events.slice() });
  }

  // ---- state helpers ------------------------------------------------------------------------------------------------

  private buildState(contractId: string, shiftType: string): ShiftStateSchemaClass {
    const state = new ShiftStateSchemaClass();
    state.contractId = contractId;
    state.shiftType = shiftType;
    state.protocolVersion = PROTOCOL_VERSION;
    state.simTickHz = this.deps.simTickHz;
    state.snapshotHz = this.deps.snapshotHz;
    state.walletLumens = this.core.sim.wallet;
    state.shinePolished = 0;
    state.plotCount = this.core.sim.world.grid.count;
    state.visitedOutposts = 0;
    const beacons = new ArraySchema<BeaconState>();
    for (let i = 0; i < BEACON_COUNT; i++) {
      const b = new BeaconState();
      b.plotId = 0;
      b.active = false;
      beacons.push(b);
    }
    state.beacons = beacons;
    const perms = new PermissionsState();
    perms.tempCanBuild = false;
    perms.tempCanSpendShared = false;
    perms.tempCanDriveShared = false;
    state.permissions = perms;
    state.fulfilled = false;
    state.nearParcelsCollected = nearParcelsMask(this.core.sim);
    return state;
  }

  private syncPlayer(seat: number, info: PlayerInfoState): void {
    const t = this.core.sim.toolState(seat);
    const owned = t.owned & 0xff;
    if (info.toolsOwned !== owned) info.toolsOwned = owned;
    if (info.equippedTool !== t.toolCode) info.equippedTool = t.toolCode;
  }

  private findByPlayer(playerId: string): Client | undefined {
    for (const [sid, entry] of this.perClient) {
      if (entry.playerId !== playerId) continue;
      const c = this.clientsBySeat[entry.seat];
      if (c !== undefined && c.sessionId === sid) return c;
    }
    return undefined;
  }

  /** A held (dropped) seat of `playerId` is released when the same player joins fresh. */
  private releaseHeldSeatOf(playerId: string): void {
    for (const [sid, entry] of this.perClient) {
      if (entry.playerId === playerId && this.core.isHeld(entry.seat)) this.releaseSeat(sid, entry);
    }
  }

  private releaseSeat(sessionId: string, entry: PerClient): void {
    if (this.perClient.get(sessionId) !== entry) return;
    this.perClient.delete(sessionId);
    this.core.removeSeat(entry.seat);
    if (this.sessionBySeat[entry.seat] === sessionId) {
      this.clientsBySeat[entry.seat] = undefined;
      this.sessionBySeat[entry.seat] = undefined;
    }
    this.idleWatch.remove(sessionId);
    this.state.players.delete(sessionId);
    this.stats?.setClients(this.core.activeSeats);
  }
}

/** Binds dependencies into a room class for `define` (the matchmaker constructs rooms itself). */
export function createShiftRoomClass(deps: ShiftRoomDeps): typeof ShiftRoom {
  return class BoundShiftRoom extends ShiftRoom {
    protected override deps = deps;
  };
}

export function percentiles(
  ring: Float64Array,
  n: number,
): { readonly n: number; readonly p50: number; readonly p95: number; readonly max: number } {
  if (n === 0) return { n: 0, p50: 0, p95: 0, max: 0 };
  const sorted = ring.slice(0, n).sort();
  const pick = (p: number): number => sorted[Math.min(n - 1, Math.ceil(p * n) - 1)] ?? 0;
  return { n, p50: pick(0.5), p95: pick(0.95), max: sorted[n - 1] ?? 0 };
}
