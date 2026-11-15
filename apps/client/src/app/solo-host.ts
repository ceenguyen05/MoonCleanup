// Solo LocalRoom wiring owned by the composition root (ADR-0031): the `roomHost` service facade, the persistent device
// identity of the Solo Contract, and the factory call that starts the sim worker. Nothing here runs per frame: the host
// lives in a Web Worker and the main thread only handles its messages.

import type {
  ActorJoinInfo,
  ContractId,
  LocalRoomHost,
  PlayerId,
  RoomHost,
  RoomHostCloseReason,
  RoomHostService,
  Unsubscribe,
} from "@moon-cleanup/shared";
import type { CreateLocalRoomHostOptions } from "../sim-host";

/** UUIDv7 (RFC 9562): 48-bit millisecond timestamp, version 7, variant 10, 74 random bits. */
export function uuidv7(nowMs: number, random: (bytes: Uint8Array<ArrayBuffer>) => void): string {
  const b = new Uint8Array(16);
  random(b);
  const t = Math.floor(nowMs);
  b[0] = Math.floor(t / 2 ** 40) & 0xff;
  b[1] = Math.floor(t / 2 ** 32) & 0xff;
  b[2] = (t >>> 24) & 0xff;
  b[3] = (t >>> 16) & 0xff;
  b[4] = (t >>> 8) & 0xff;
  b[5] = t & 0xff;
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX32_RE = /^[0-9a-f]{32}$/;

export interface SoloIdentity {
  readonly contractId: ContractId;
  readonly playerId: PlayerId;
  /** 32 lower-case hex chars: device id written into the save header. */
  readonly originId: string;
  /** Whether the ids are stored (false: ephemeral because storage is unavailable). */
  readonly persisted: boolean;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SOLO_STORAGE_KEYS = {
  contractId: "mc.solo.contractId",
  playerId: "mc.solo.playerId",
  originId: "mc.solo.originId",
} as const;

/**
 * Reads (or creates and stores) the device's Solo Contract identity. One Contract per device until the Contract picker
 * exists. Storage failures (private mode, quota) fall back to ephemeral ids; the sim host still reports its own storage
 * warnings through `save.storage_warning`.
 */
export function loadSoloIdentity(
  storage: KeyValueStore | null,
  nowMs: number,
  random: (bytes: Uint8Array<ArrayBuffer>) => void,
): SoloIdentity {
  const read = (key: string, ok: RegExp): string | null => {
    try {
      const value = storage?.getItem(key) ?? null;
      return value !== null && ok.test(value) ? value : null;
    } catch {
      return null;
    }
  };
  const contract = read(SOLO_STORAGE_KEYS.contractId, UUID_RE);
  const player = read(SOLO_STORAGE_KEYS.playerId, UUID_RE);
  const origin = read(SOLO_STORAGE_KEYS.originId, HEX32_RE);
  if (contract !== null && player !== null && origin !== null) {
    return { contractId: contract as ContractId, playerId: player as PlayerId, originId: origin, persisted: true };
  }
  const fresh = {
    contractId: (contract ?? uuidv7(nowMs, random)) as ContractId,
    playerId: (player ?? uuidv7(nowMs, random)) as PlayerId,
    originId: origin ?? uuidv7(nowMs, random).replaceAll("-", ""),
  };
  let persisted = false;
  try {
    if (storage !== null) {
      storage.setItem(SOLO_STORAGE_KEYS.contractId, fresh.contractId);
      storage.setItem(SOLO_STORAGE_KEYS.playerId, fresh.playerId);
      storage.setItem(SOLO_STORAGE_KEYS.originId, fresh.originId);
      persisted = true;
    }
  } catch {
    persisted = false;
  }
  return { ...fresh, persisted };
}

/** The `roomHost` service: a stable facade the app publishes hosts through (room-host.ts, `RoomHostService`). */
export interface RoomHostPublisher extends RoomHostService {
  publish(host: RoomHost | null): void;
}

export function createRoomHostService(): RoomHostPublisher {
  let current: RoomHost | null = null;
  const listeners: ((host: RoomHost | null, previous: RoomHost | null) => void)[] = [];
  return {
    get current() {
      return current;
    },
    onChange(listener): Unsubscribe {
      listeners.push(listener);
      return () => {
        const k = listeners.indexOf(listener);
        if (k >= 0) listeners.splice(k, 1);
      };
    },
    publish(host) {
      const previous = current;
      if (previous === host) return;
      current = host;
      for (const listener of [...listeners]) listener(host, previous);
    },
  };
}

export interface SoloHostOptions<H extends LocalRoomHost = LocalRoomHost> {
  readonly publisher: RoomHostPublisher;
  readonly identity: SoloIdentity;
  /** Called when the host cannot run (locked by another tab, worker failed twice). */
  readonly onProblem: (source: string, error: unknown) => void;
  /** Loads the sim-host barrel; dynamic so the main chunk stays free of it until after the first frame. */
  readonly load: () => Promise<{
    createLocalRoomHost: (options: CreateLocalRoomHostOptions) => Promise<H>;
  }>;
  readonly hostOverrides?: Partial<CreateLocalRoomHostOptions>;
  /** Called with the created host right before it is published (app-side consumers such as the dust ledger view). */
  readonly onHost?: (host: H) => void;
}

export interface SoloHostHandle {
  /**
   * Closes the host (default `clock_out`: final checkpoint, then dispose; `conflict_resolved` skips the checkpoint) and
   * cancels a start still in flight. Resolves once the host is closed (and its Web Lock released).
   */
  stop(reason?: RoomHostCloseReason): Promise<void>;
}

/**
 * Starts the Solo LocalRoom host and publishes it through the `roomHost` service. Fire and forget: the handle is
 * returned immediately and startup problems go to `onProblem`. The flat world is used until the terrain module can hand
 * the sim its height cube (see the integration report).
 */
export function startSoloHost<H extends LocalRoomHost = LocalRoomHost>(options: SoloHostOptions<H>): SoloHostHandle {
  let stopped = false;
  let stopReason: RoomHostCloseReason = "clock_out";
  let host: H | null = null;
  let offState: Unsubscribe | null = null;
  let closing: Promise<void> | null = null;

  const player: ActorJoinInfo = { playerId: options.identity.playerId, displayName: "Custodian", role: "holder" };
  // Resolves when the boot attempt has finished, including closing a host that finished creating after `stop()`.
  const booted = (async (): Promise<void> => {
    try {
      const { createLocalRoomHost } = await options.load();
      if (stopped) return;
      const created = await createLocalRoomHost({
        contractId: options.identity.contractId,
        shiftType: "solo",
        player,
        world: { kind: "flat" },
        originId: options.identity.originId,
        // A save that cannot be restored starts a fresh game; the player is told through the boundary banner.
        onRestoreProblem: (reason) => options.onProblem("solo save restore", new Error(reason)),
        ...options.hostOverrides,
      });
      if (stopped) {
        // stop() was called while the host was booting: close it with the reason stop() asked for (a final checkpoint
        // after `conflict_resolved` would overwrite the installed copy) and release its Web Lock before stop() resolves.
        await created.close(stopReason);
        return;
      }
      host = created;
      options.onHost?.(created);
      offState = created.onStateChange((state) => {
        if (state === "failed") options.onProblem("solo room host", new Error("the simulation worker failed twice"));
      });
      options.publisher.publish(created);
    } catch (error) {
      options.onProblem("solo room host start", error);
    }
  })();

  return {
    stop(reason = "clock_out") {
      if (closing !== null) return closing;
      stopped = true;
      stopReason = reason;
      offState?.();
      options.publisher.publish(null);
      const current = host;
      host = null;
      // A host still booting is closed by the boot task (it sees `stopped`); waiting for it keeps the Web Lock and the
      // store free of the old host before the caller installs a save and starts a new one.
      closing = current === null ? booted : current.close(reason);
      return closing;
    },
  };
}
