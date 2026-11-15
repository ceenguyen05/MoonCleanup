// Test-only helpers of the sync module: an in-memory server that honours the checkpoint REST contract (fast-forward,
// SAVE_CONFLICT, rate limit, paging, registration quota), and a "device" harness with a virtual clock and timers.
// Not exported from the barrel.

import {
  CreateContractRequestSchema,
  SAVE_SECTION_ID,
  SoloCheckpointBeginRequestSchema,
  type ContractId,
  type SaveHeader,
  type SoloCheckpointSummary,
  type UiSaveSyncState,
} from "@moon-cleanup/shared";
import { splitCheckpointUploadBody } from "@moon-cleanup/protocol";
import { createEventBus } from "../app/event-bus";
import { MemoryCheckpointStore } from "../sim-host/checkpoint-store";
import { deflate, encodeSaveEnvelope, gzip } from "../sim-host/save-envelope";
import type { StoredCheckpointLike } from "./copy";
import { decodeMcck, mcckTrailerCrc, packPages, type McckChunk } from "./mcck";
import { MemorySyncMetaStore } from "./meta-store";
import { createSaveApi } from "./save-api";
import { createSaveSync, type LocalInstallPort, type SaveSync, type SaveSyncOptions } from "./save-sync";
import type { Connectivity, InteractionGate } from "./gate";

export const CONTRACT = "0190a5b4-1111-4222-8333-444455556666";
const BAKE = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("");

// ---- local checkpoints ---------------------------------------------------------------------------------------------

export interface TestChunk {
  readonly id: number;
  readonly fill: number;
  /** Raw payload bytes (default 2000). `random` makes it incompressible. */
  readonly size?: number;
  readonly random?: boolean;
}

function payloadOf(c: TestChunk): Uint8Array {
  const out = new Uint8Array(c.size ?? 2000);
  if (c.random === true) {
    let x = (c.fill * 2654435761) >>> 0 || 1;
    for (let i = 0; i < out.length; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      out[i] = x >>> 24;
    }
  } else out.fill(c.fill);
  return out;
}

export async function writeCheckpoint(
  store: MemoryCheckpointStore,
  info: {
    generation: number;
    parent: number;
    simTick: number;
    chunks?: readonly TestChunk[];
    replaceAll?: boolean;
    contractId?: string;
  },
): Promise<void> {
  const header: SaveHeader = {
    saveFormatVersion: 1,
    gridM: 128,
    radiusM: 2000,
    plotCount: 163_842,
    bakeHash: BAKE,
    dustModelVersion: 1,
    simTick: info.simTick,
    generation: info.generation,
    parentGeneration: info.parent,
    originKind: "solo",
    originId: "00".repeat(16),
    sections: [
      { id: SAVE_SECTION_ID.META, version: 1, length: 3 },
      { id: SAVE_SECTION_ID.PLAYERS, version: 1, length: 2 },
    ],
  };
  const raw = encodeSaveEnvelope(header, [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
  const gz = await gzip(raw);
  const rows = [];
  for (const c of info.chunks ?? []) {
    const payload = payloadOf(c);
    rows.push({
      chunkId: c.id,
      generation: info.generation,
      codec: "deflate" as const,
      rawSize: payload.length,
      bytes: (await deflate(payload)).slice().buffer,
    });
  }
  await store.save(
    {
      contractId: (info.contractId ?? CONTRACT) as ContractId,
      generation: info.generation,
      parentGeneration: info.parent,
      simTick: info.simTick,
      savedAtMs: 1_700_000_000_000 + info.generation,
      codec: "gzip",
      bytes: gz.slice().buffer,
    },
    { replaceAll: info.replaceAll === true, chunks: rows },
  );
}

// ---- fake server -----------------------------------------------------------------------------------------------------

interface ServerSave {
  generation: number;
  summary: SoloCheckpointSummary;
  header: Uint8Array;
  chunks: Map<number, McckChunk>;
}

export interface UploadRecord {
  readonly generation: number;
  readonly baseGeneration: number;
  readonly chunkIds: number[];
  readonly overwrite: boolean;
  readonly bytes: number;
}

export class FakeServer {
  mode: "ok" | "offline" | "asleep" | "error500" = "ok";
  /** One virtual clock for the server and every device of a test. */
  readonly clock = { now: 2_000_000_000_000 };
  nowMs: () => number = () => this.clock.now;
  minIntervalMs = 20_000;
  quota = 3;
  readonly contracts = new Map<string, { save: ServerSave | null }>();
  readonly uploads: UploadRecord[] = [];
  readonly requests: string[] = [];
  private readonly lastUpload = new Map<string, number>();

  /** A server-side Contract (created through the API). */
  addContract(id = CONTRACT): void {
    this.contracts.set(id, { save: null });
  }
  saveOf(id = CONTRACT): ServerSave | null {
    return this.contracts.get(id)?.save ?? null;
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    this.requests.push(`${method} ${url.pathname}`);
    if (this.mode === "offline") throw new TypeError("network down");
    if (this.mode === "asleep") {
      return new Response("<html>waking</html>", { status: 503, headers: { "content-type": "text/html" } });
    }
    if (this.mode === "error500") return json(500, { error: "INTERNAL" });
    const auth = (init?.headers as Record<string, string> | undefined)?.["authorization"];
    if (auth !== "Bearer tok") return json(401, { error: "UNAUTHORIZED" });

    if (method === "POST" && url.pathname === "/v1/contracts") return this.register(init?.body as Uint8Array);
    const m = /^\/v1\/contracts\/([^/]+)\/(solo-checkpoints|save\/head|save)$/.exec(url.pathname);
    if (m === null) return json(404, { error: "NOT_FOUND" });
    const id = m[1] as string;
    const contract = this.contracts.get(id);
    if (contract === undefined) return json(404, { error: "NOT_FOUND" });
    if (m[2] === "solo-checkpoints") return this.upload(id, contract, init?.body as Uint8Array);
    if (m[2] === "save/head")
      return contract.save === null ? json(404, { error: "NOT_FOUND" }) : json(200, contract.save.summary);
    return this.download(id, contract, Number(url.searchParams.get("page") ?? 0));
  };

  private register(body: Uint8Array): Response {
    const req = CreateContractRequestSchema.parse(JSON.parse(new TextDecoder().decode(body)));
    const id = req.clientContractId as string;
    const summary = {
      id,
      name: req.name,
      shiftType: "solo",
      role: "holder",
      maxPlayers: 1,
      status: "active",
      gridM: 128,
      plotCount: 163_842,
      shinePolished: 0,
      walletLumens: 0,
      playtimeS: 0,
      lastPlayedAt: null,
      online: 0,
    };
    if (this.contracts.has(id)) return json(200, { contract: summary, inviteCode: null });
    if (this.contracts.size >= this.quota) return json(409, { error: "QUOTA_EXCEEDED" });
    this.contracts.set(id, { save: null });
    return json(201, { contract: summary, inviteCode: null });
  }

  private upload(id: string, contract: { save: ServerSave | null }, body: Uint8Array): Response {
    const split = splitCheckpointUploadBody(body);
    if (!split.ok) return json(400, { error: "BAD_REQUEST" });
    const meta = SoloCheckpointBeginRequestSchema.parse(JSON.parse(new TextDecoder().decode(split.meta)));
    const decoded = decodeMcck(split.pkg);
    const reject = (reason: string): Response => json(422, { error: "CHECKPOINT_REJECTED", reason });
    if (!decoded.ok) return reject("bad_envelope");
    const pkg = decoded.value;
    if (meta.totalBytes !== split.pkg.byteLength || meta.packageCrc32 !== mcckTrailerCrc(split.pkg))
      return reject("bad_crc");
    if (pkg.contractId !== id || pkg.generation !== meta.generation || pkg.baseGeneration !== meta.baseGeneration) {
      return reject("bad_envelope");
    }
    if (meta.generation <= meta.parentGeneration) return reject("generation_not_increasing");
    const now = this.nowMs();
    const last = this.lastUpload.get(id);
    if (last !== undefined && now - last < this.minIntervalMs) {
      return json(
        429,
        { error: "RATE_LIMITED" },
        { "retry-after": String(Math.ceil((this.minIntervalMs - (now - last)) / 1000)) },
      );
    }
    const head = contract.save;
    const newest = head?.generation ?? 0;
    if (!meta.overwrite && meta.baseGeneration !== newest) {
      return json(409, { error: "SAVE_CONFLICT", server: (head as ServerSave).summary });
    }
    if (meta.generation <= newest) return reject("generation_not_increasing");
    const chunks = new Map(head?.chunks ?? []);
    for (const c of pkg.chunks) chunks.set(c.chunkId, { ...c, bytes: c.bytes.slice() });
    contract.save = { generation: meta.generation, summary: meta.summary, header: pkg.header.slice(), chunks };
    this.lastUpload.set(id, now);
    this.uploads.push({
      generation: meta.generation,
      baseGeneration: meta.baseGeneration,
      chunkIds: pkg.chunks.map((c) => c.chunkId),
      overwrite: meta.overwrite,
      bytes: body.byteLength,
    });
    return json(200, { acceptedGeneration: meta.generation, savedAt: new Date(now).toISOString(), flags: [] });
  }

  private download(id: string, contract: { save: ServerSave | null }, page: number): Response {
    const save = contract.save;
    if (save === null) return json(404, { error: "NOT_FOUND" });
    const pages = packPages(
      id,
      save.generation,
      save.generation,
      save.header,
      [...save.chunks.values()].sort((a, b) => a.chunkId - b.chunkId),
    );
    const bytes = pages[page];
    if (bytes === undefined) return json(404, { error: "NOT_FOUND" });
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: { "content-type": "application/octet-stream", "x-save-pages": String(pages.length) },
    });
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

// ---- device harness ----------------------------------------------------------------------------------------------------

export interface Device {
  readonly sync: SaveSync;
  readonly store: MemoryCheckpointStore;
  readonly meta: MemorySyncMetaStore;
  readonly events: ReturnType<typeof createEventBus>;
  readonly ui: Partial<UiSaveSyncState> & { state: UiSaveSyncState["state"] };
  readonly log: { name: string; payload: unknown }[];
  readonly installs: { source: string; generation: number; dust: boolean }[];
  readonly summary: { playtimeS: number; shinePolished: number; walletLumens: number };
  readonly clock: { now: number };
  online: boolean;
  interacted: boolean;
  gate: InteractionGate;
  /** Writes a local checkpoint into the store and emits `save.checkpointed`, like the sim-host worker. */
  checkpoint(info: {
    generation: number;
    parent: number;
    simTick?: number;
    chunks?: readonly TestChunk[];
    reason?: "timer" | "hidden" | "pause" | "clock_out" | "handoff";
  }): Promise<void>;
  /** Moves the virtual clock, running due timers and letting real async work (streams) finish. */
  advance(ms: number): Promise<void>;
  settle(): Promise<void>;
  names(): string[];
}

export function makeDevice(server: FakeServer, overrides: Partial<SaveSyncOptions> = {}): Device {
  const store = new MemoryCheckpointStore();
  const meta = new MemorySyncMetaStore();
  const log: { name: string; payload: unknown }[] = [];
  const events = createEventBus({
    onListenerError: (n, e) => {
      throw new Error(`${n}: ${String(e)}`);
    },
  });
  for (const name of [
    "save.queued",
    "save.synced",
    "save.upload_failed",
    "save.conflict",
    "save.resolved",
    "save.restored",
    "save.backup_stored",
  ] as const) {
    events.on(name, (payload) => log.push({ name, payload }));
  }
  const ui = { state: "local_only" } as Device["ui"];
  const clock = server.clock;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const dev = { interacted: false, online: true };
  const gate: InteractionGate = {
    hasInteracted: () => dev.interacted,
    markInteracted: () => {
      if (dev.interacted) return;
      dev.interacted = true;
      for (const l of [...listeners]) l();
      listeners.clear();
    },
    onInteraction: (cb) => {
      if (dev.interacted) cb();
      else listeners.add(cb);
      return () => listeners.delete(cb);
    },
    automated: () => false,
  };
  const onlineListeners = new Set<() => void>();
  const connectivity: Connectivity = {
    isOnline: () => dev.online,
    onOnline: (cb) => {
      onlineListeners.add(cb);
      return () => onlineListeners.delete(cb);
    },
  };
  const installs: Device["installs"] = [];
  const install: LocalInstallPort = {
    async install({ contractId, record, dust, source }) {
      installs.push({ source, generation: record.generation, dust: dust !== null });
      await store.save(record as StoredCheckpointLike as never, dust === null ? undefined : (dust as never));
      void contractId;
    },
  };
  let busy = 0; // requests in flight
  const summary = { playtimeS: 100, shinePolished: 5, walletLumens: 1234 };
  const sync = createSaveSync({
    api: createSaveApi({
      baseUrl: "http://server.test",
      auth: { getAccessToken: () => Promise.resolve("tok") },
      fetch: (input, init) => {
        busy += 1;
        return server.fetch(input, init).finally(() => {
          busy -= 1;
        });
      },
    }),
    store,
    install,
    meta,
    events,
    sink: (patch) => Object.assign(ui, patch),
    summary: {
      snapshot: ({ simTick }) => ({
        ...summary,
        playtimeS: summary.playtimeS + Math.floor(simTick / 20),
        deviceLabel: "test device",
      }),
    },
    gameDataVersion: "gd-test",
    gate,
    connectivity,
    now: () => clock.now,
    random: () => 0.5,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: clock.now + ms, fn, id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    ...overrides,
  });
  // Real-time settling: at least 8 ticks, then keep waiting while an upload or a request is in flight (gzip streams of
  // large chunks can take longer than the fixed wait under CPU load, which made multi-page tests flaky).
  const settle = async (): Promise<void> => {
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 4));
    for (let i = 0; i < 8; i++) await tick();
    const deadline = Date.now() + 20_000;
    let quiet = 0;
    while (quiet < 3 && Date.now() < deadline) {
      await tick();
      quiet = ui.state === "uploading" || busy > 0 ? 0 : quiet + 1;
    }
  };
  const device: Device = {
    sync,
    store,
    meta,
    events,
    ui,
    log,
    installs,
    summary,
    clock,
    get online() {
      return dev.online;
    },
    set online(v: boolean) {
      dev.online = v;
      if (v) for (const l of [...onlineListeners]) l();
    },
    get interacted() {
      return dev.interacted;
    },
    set interacted(v: boolean) {
      if (v) gate.markInteracted();
    },
    gate,
    async checkpoint(info) {
      const simTick = info.simTick ?? info.generation * 200;
      await writeCheckpoint(store, {
        generation: info.generation,
        parent: info.parent,
        simTick,
        ...(info.chunks !== undefined ? { chunks: info.chunks } : {}),
      });
      events.emit("save.checkpointed", {
        contractId: CONTRACT as ContractId,
        atMs: clock.now,
        generation: info.generation,
        parentGeneration: info.parent,
        simTick,
        reason: info.reason ?? "timer",
        bytes: 100,
      });
    },
    async advance(ms) {
      const end = clock.now + ms;
      await settle();
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (next === undefined || next.at > end) break;
        timers.shift();
        clock.now = Math.max(clock.now, next.at);
        next.fn();
        await settle();
      }
      clock.now = end;
    },
    settle,
    names: () => log.map((l) => l.name),
  };
  return device;
}
