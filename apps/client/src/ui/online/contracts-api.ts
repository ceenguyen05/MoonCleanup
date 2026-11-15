// Minimal accounts-API client of the online entry (create a Private Shift, join by invite code). Lives in the lazy panel
// chunk, so solo never loads it. Tokens go only in the Authorization header (never a URL, never logged). A 401 retries
// once with a force-refreshed token.

import {
  API_ROUTES,
  ApiErrorBodySchema,
  CreateContractResponseSchema,
  JoinCodeResponseSchema,
  type CreateContractRequest,
} from "@moon-cleanup/shared";
import { failureOfResponse, type OnlineAuthPort, type OnlineFailure } from "./online-model";

/** A Render cold start answers within about a minute (same bound as guest auth). */
export const CONTRACTS_TIMEOUT_MS = 70_000;

export type ApiResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: OnlineFailure };

export interface ContractsApi {
  createPrivateShift(
    name: string,
  ): Promise<ApiResult<{ readonly contractId: string; readonly inviteCode: string | null }>>;
  joinByCode(code: string): Promise<ApiResult<{ readonly contractId: string }>>;
}

export interface ContractsApiOptions {
  readonly httpUrl: string;
  readonly auth: OnlineAuthPort;
  readonly fetch?: typeof fetch;
}

const OFFLINE: OnlineFailure = { key: "offline", retryAfterS: 0 };
const UNKNOWN: OnlineFailure = { key: "unknown", retryAfterS: 0 };

export function createContractsApi(options: ContractsApiOptions): ContractsApi {
  const base = options.httpUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function call(path: string, body: unknown, forceRefresh: boolean): Promise<ApiResult<unknown>> {
    const token = await options.auth.getAccessToken(forceRefresh);
    if (token === null) return { ok: false, failure: { key: "unauthorized", retryAfterS: 0 } };
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CONTRACTS_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, failure: OFFLINE };
    }
    if (res.status === 401 && !forceRefresh) return call(path, body, true);
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null; // waking page or empty body
    }
    if (res.ok) return { ok: true, value: json };
    const parsed = ApiErrorBodySchema.safeParse(json);
    return {
      ok: false,
      failure: failureOfResponse(res.status, parsed.success ? parsed.data.error : null, res.headers.get("retry-after")),
    };
  }

  return {
    async createPrivateShift(name) {
      const body: CreateContractRequest = { name, shiftType: "private" };
      const result = await call(API_ROUTES.contractsCreate.path, body, false);
      if (!result.ok) return result;
      const parsed = CreateContractResponseSchema.safeParse(result.value);
      if (!parsed.success) return { ok: false, failure: UNKNOWN };
      return { ok: true, value: { contractId: parsed.data.contract.id, inviteCode: parsed.data.inviteCode } };
    },
    async joinByCode(code) {
      const result = await call(API_ROUTES.contractJoinByCode.path, { code }, false);
      if (!result.ok) return result;
      const parsed = JoinCodeResponseSchema.safeParse(result.value);
      if (!parsed.success) return { ok: false, failure: UNKNOWN };
      return { ok: true, value: { contractId: parsed.data.contract.id } };
    },
  };
}
