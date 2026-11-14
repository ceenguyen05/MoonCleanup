// GET /healthz and GET /readyz as transport-neutral HttpRouteDef[] (M0-W1-T03). No Colyseus, uWebSockets or Node imports;
// the composition root supplies the runtime facts through `HealthDeps`.
//
// /healthz: liveness only. Always 200 while the process runs, no I/O, no DB.
// /readyz: readiness. Probes the database (cached <= 10 s) and reports admission state. 200 when ready, else 503.
// Neither route leaks secrets, connection details or error text.

import {
  PROTOCOL_VERSION,
  type EnvName,
  type HealthResponse,
  type HttpRouteDef,
  type ReadyResponse,
  type StorageState,
} from "@moon-cleanup/shared";

export const SERVICE_NAME = "moon-cleanup-server";
export const READYZ_CACHE_MS = 10_000;

export type DbState = "up" | "powered-off" | "not-configured" | "error";

/** What the readiness probe needs from the database layer (structurally satisfied by `DbConnection`). */
export interface DbProbeSource {
  /** Active Postgres schema name, or null when no database is configured. */
  readonly schema: string | null;
  probe(): Promise<DbState>;
}

/** Live runtime facts owned by the room layer / composition root. */
export interface RuntimeState {
  /** SIGTERM received; no new joins. */
  draining(): boolean;
  rooms(): number;
  /** Admission control accepts a new room (netcode.md section 15). */
  admitting(): boolean;
  /** Storage state against the 1 GB cap; `ok` until the size job exists (M1). */
  storage(): StorageState;
}

export interface HealthDeps {
  readonly envName: EnvName;
  readonly buildVersion: string;
  readonly maxRooms: number;
  readonly db: DbProbeSource;
  /** `memory` (local only): readiness does not require a database. */
  readonly persistenceDriver: "postgres" | "memory";
  readonly runtime: RuntimeState;
  /** Epoch ms when the process started. */
  readonly startedAtMs: number;
  readonly now?: () => number;
}

/** `/readyz` body: the shared ReadyResponse plus the active schema (clients strip the extra fields). */
export type ReadyBody = ReadyResponse & { readonly schema: string | null; readonly dbState: DbState };

const NO_STORE = { "cache-control": "no-store" } as const;

export function createHealthRoutes(deps: HealthDeps): HttpRouteDef[] {
  const now = deps.now ?? Date.now;
  let cached: { at: number; db: DbState } | undefined;
  let inflight: Promise<DbState> | undefined;

  const dbState = (): Promise<DbState> => {
    if (cached !== undefined && now() - cached.at < READYZ_CACHE_MS) return Promise.resolve(cached.db);
    inflight ??= deps.db
      .probe()
      .catch((): DbState => "error")
      .then((value) => {
        cached = { at: now(), db: value };
        return value;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  };

  return [
    {
      method: "GET",
      path: "/healthz",
      handle() {
        const body: HealthResponse = {
          ok: true,
          service: SERVICE_NAME,
          env: deps.envName,
          build: deps.buildVersion,
          protocolVersion: PROTOCOL_VERSION,
          uptimeS: Math.max(0, Math.round((now() - deps.startedAtMs) / 1000)),
        };
        return { status: 200, body, headers: { ...NO_STORE, "access-control-allow-origin": "*" } };
      },
    },
    {
      method: "GET",
      path: "/readyz",
      async handle() {
        const state = await dbState();
        const draining = deps.runtime.draining();
        const admitting = deps.runtime.admitting();
        const memoryMode = deps.persistenceDriver === "memory" && state === "not-configured";
        const dbUp = state === "up";
        const ready = (dbUp || memoryMode) && !draining && admitting;
        const body: ReadyBody = {
          ready,
          db: dbUp ? "up" : "down",
          draining,
          rooms: deps.runtime.rooms(),
          maxRooms: deps.maxRooms,
          admitting,
          storage: deps.runtime.storage(),
          schema: deps.db.schema,
          dbState: state,
        };
        return { status: ready ? 200 : 503, body, headers: NO_STORE };
      },
    },
  ];
}
