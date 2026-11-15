// REST client of the solo checkpoint routes (system-overview 4.1, data-model 3.7c, ADR-0031 amendment 1):
//   POST /v1/contracts                       register a locally created Contract (`clientContractId`, idempotent)
//   POST /v1/contracts/:id/solo-checkpoints  upload: u16 LE metaLen | metadata JSON | MCCK package (octet-stream)
//   GET  /v1/contracts/:id/save/head         newest server copy's summary (404: none)
//   GET  /v1/contracts/:id/save?page=n       MCCK pages, `x-save-pages` carries the count
// Every failure is folded into one SyncFailure (never thrown): offline / server asleep, rate limit, hard rejection,
// version, size, server error. Tokens are used for the Authorization header only: never logged, never in a URL.
// `fetch` and the timers are injected so the client is testable without a network.

import {
  API_BINARY_CONTENT_TYPE,
  API_ROUTES,
  CheckpointRejectedBodySchema,
  CreateContractResponseSchema,
  SAVE_DOWNLOAD_PAGES_HEADER,
  SaveConflictBodySchema,
  SaveHeadResponseSchema,
  SoloCheckpointAcceptedSchema,
  type CheckpointRejectReason,
  type SaveUploadFailureKind,
  type SoloCheckpointAccepted,
  type SoloCheckpointSummary,
} from "@moon-cleanup/shared";
import { encodeCheckpointUploadBody } from "@moon-cleanup/protocol";
import { READ_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from "./limits";

/** Same shape as net/room-session `AccessTokenSource`; declared here so the sync module has no dependency on net. */
export interface TokenSource {
  /** The current access token; refreshed first when `forceRefresh` (after a 401). `null` = signed out. */
  getAccessToken(forceRefresh: boolean): Promise<string | null>;
}

export interface SyncFailure {
  readonly kind: SaveUploadFailureKind;
  /** Set when `kind` is `rejected` and the server named a reason. */
  readonly reason: CheckpointRejectReason | null;
  /** Server `retry-after` in ms; null when none. */
  readonly retryAfterMs: number | null;
  /** HTTP status; null for a network failure. */
  readonly status: number | null;
  /** The failure is about credentials (signed out, 401 after a refresh): the queue is held, not an error state. */
  readonly auth: boolean;
}

export type ApiOutcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: SyncFailure };

export type UploadResult =
  | { readonly kind: "accepted"; readonly accepted: SoloCheckpointAccepted }
  | { readonly kind: "conflict"; readonly server: SoloCheckpointSummary };

export type RegisterResult =
  | { readonly kind: "registered" }
  /** 409 QUOTA_EXCEEDED: the player already owns 3 Contracts. The Contract stays local-only. */
  | { readonly kind: "quota" }
  /** 400: id taken by someone else, blocked name or similar. The Contract stays local-only. */
  | { readonly kind: "refused" };

export interface SaveApiOptions {
  /** Base HTTP URL of the server (VITE_SERVER_HTTP_URL). */
  readonly baseUrl: string;
  readonly auth: TokenSource;
  readonly fetch?: typeof fetch;
  readonly uploadTimeoutMs?: number;
  readonly readTimeoutMs?: number;
}

export interface SaveApi {
  registerContract(contractId: string, name: string, seed: string): Promise<ApiOutcome<RegisterResult>>;
  /** `meta` is the already validated metadata object; the body is built here. */
  uploadCheckpoint(contractId: string, meta: object, pkg: Uint8Array): Promise<ApiOutcome<UploadResult>>;
  /** `null`: the server has no copy (404). */
  head(contractId: string): Promise<ApiOutcome<SoloCheckpointSummary | null>>;
  downloadPage(contractId: string, page: number): Promise<ApiOutcome<{ bytes: Uint8Array; pages: number }>>;
}

const MAX_RETRY_AFTER_MS = 3_600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

interface RawResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly bytes: Uint8Array;
}

function fail(kind: SaveUploadFailureKind, init: Partial<SyncFailure> = {}): { ok: false; failure: SyncFailure } {
  return { ok: false, failure: { kind, reason: null, retryAfterMs: null, status: null, auth: false, ...init } };
}

function retryAfterOf(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(MAX_RETRY_AFTER_MS, Math.round(seconds * 1000)) : null;
}

function jsonOf(bytes: Uint8Array): unknown {
  if (bytes.byteLength === 0 || bytes.byteLength > 64 * 1024) return undefined;
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return undefined;
  }
}

function errorCodeOf(body: unknown): string | null {
  if (typeof body === "object" && body !== null && "error" in body) {
    const code = (body as { error: unknown }).error;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/**
 * Maps a non-success answer to a failure. A 502/503/504 without our JSON error body is Render's waking or proxy page: the
 * server is asleep, which is "offline" (hold the queue, back off), not an error.
 */
export function classifyFailure(status: number, body: unknown, retryAfterMs: number | null): SyncFailure {
  const code = errorCodeOf(body);
  const base = { retryAfterMs, status, auth: false } as const;
  if (status === 401) return { kind: "offline", reason: null, ...base, auth: true };
  if (status === 413 || code === "PAYLOAD_TOO_LARGE") return { kind: "too_large", reason: null, ...base };
  if (status === 429) return { kind: "rate_limited", reason: null, ...base };
  if (status === 422) {
    const parsed = CheckpointRejectedBodySchema.safeParse(body);
    return { kind: "rejected", reason: parsed.success ? parsed.data.reason : null, ...base };
  }
  if (code === "SAVE_VERSION_UNSUPPORTED") return { kind: "version_unsupported", reason: null, ...base };
  if (code === "CONTRACT_BUSY" || code === "RETRY_LATER" || code === "AT_CAPACITY" || code === "STORAGE_FULL") {
    return { kind: "server_error", reason: null, ...base };
  }
  if (status === 502 || status === 503 || status === 504) {
    return code === null ? { kind: "offline", reason: null, ...base } : { kind: "server_error", reason: null, ...base };
  }
  if (status >= 500) return { kind: "server_error", reason: null, ...base };
  return { kind: "rejected", reason: null, ...base };
}

export function createSaveApi(options: SaveApiOptions): SaveApi {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.baseUrl.replace(/\/+$/, "");
  const uploadTimeout = options.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS;
  const readTimeout = options.readTimeoutMs ?? READ_TIMEOUT_MS;

  async function attempt(
    method: string,
    url: string,
    token: string,
    body: Uint8Array | undefined,
    timeoutMs: number,
    contentType: string,
  ): Promise<RawResponse | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (body !== undefined) headers["content-type"] = contentType;
      const response = await doFetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body: body as Uint8Array<ArrayBuffer> } : {}),
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
      });
      return {
        status: response.status,
        headers: response.headers,
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    } catch {
      // Network down, DNS, CORS failure (Render's waking page has none), abort on timeout: all "unreachable".
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** One request with one token refresh after a 401. */
  async function send(
    method: string,
    path: string,
    body: Uint8Array | undefined,
    timeoutMs: number,
    contentType: string = API_BINARY_CONTENT_TYPE,
  ): Promise<ApiOutcome<RawResponse>> {
    const url = `${base}${path}`;
    let token = await options.auth.getAccessToken(false);
    if (token === null) return fail("offline", { status: 401, auth: true });
    let response = await attempt(method, url, token, body, timeoutMs, contentType);
    if (response !== null && response.status === 401) {
      token = await options.auth.getAccessToken(true);
      if (token === null) return fail("offline", { status: 401, auth: true });
      response = await attempt(method, url, token, body, timeoutMs, contentType);
    }
    if (response === null) return fail("offline");
    return { ok: true, value: response };
  }

  const pathOf = (route: { path: string }, contractId: string): string => route.path.replace(":id", contractId);
  const failure = (r: RawResponse): { ok: false; failure: SyncFailure } => ({
    ok: false,
    failure: classifyFailure(r.status, jsonOf(r.bytes), retryAfterOf(r.headers)),
  });

  return {
    async registerContract(contractId, name, seed) {
      const payload = encoder.encode(JSON.stringify({ name, shiftType: "solo", clientContractId: contractId, seed }));
      const sent = await send(
        API_ROUTES.contractsCreate.method,
        API_ROUTES.contractsCreate.path,
        payload,
        readTimeout,
        "application/json",
      );
      if (!sent.ok) return sent;
      const r = sent.value;
      const json = jsonOf(r.bytes);
      if ((r.status === 200 || r.status === 201) && CreateContractResponseSchema.safeParse(json).success) {
        return { ok: true, value: { kind: "registered" } };
      }
      if (errorCodeOf(json) === "QUOTA_EXCEEDED") return { ok: true, value: { kind: "quota" } };
      if (r.status === 400 || r.status === 403) return { ok: true, value: { kind: "refused" } };
      return failure(r);
    },

    async uploadCheckpoint(contractId, meta, pkg) {
      const body = encodeCheckpointUploadBody(encoder.encode(JSON.stringify(meta)), pkg);
      const sent = await send("POST", pathOf(API_ROUTES.checkpointUpload, contractId), body, uploadTimeout);
      if (!sent.ok) return sent;
      const r = sent.value;
      const json = jsonOf(r.bytes);
      if (r.status === 200) {
        const parsed = SoloCheckpointAcceptedSchema.safeParse(json);
        return parsed.success
          ? { ok: true, value: { kind: "accepted", accepted: parsed.data } }
          : fail("server_error", { status: 200 });
      }
      if (r.status === 409 && errorCodeOf(json) === "SAVE_CONFLICT") {
        const parsed = SaveConflictBodySchema.safeParse(json);
        if (parsed.success) return { ok: true, value: { kind: "conflict", server: parsed.data.server } };
      }
      return failure(r);
    },

    async head(contractId) {
      const sent = await send("GET", pathOf(API_ROUTES.saveHead, contractId), undefined, readTimeout);
      if (!sent.ok) return sent;
      const r = sent.value;
      if (r.status === 404) return { ok: true, value: null };
      if (r.status === 200) {
        const parsed = SaveHeadResponseSchema.safeParse(jsonOf(r.bytes));
        return parsed.success ? { ok: true, value: parsed.data } : fail("server_error", { status: 200 });
      }
      return failure(r);
    },

    async downloadPage(contractId, page) {
      const sent = await send(
        "GET",
        `${pathOf(API_ROUTES.saveDownload, contractId)}?page=${page}`,
        undefined,
        readTimeout,
      );
      if (!sent.ok) return sent;
      const r = sent.value;
      if (r.status !== 200) return failure(r);
      const pages = Number(r.headers.get(SAVE_DOWNLOAD_PAGES_HEADER));
      if (!Number.isInteger(pages) || pages < 1) return fail("server_error", { status: 200 });
      return { ok: true, value: { bytes: r.bytes, pages } };
    },
  };
}
