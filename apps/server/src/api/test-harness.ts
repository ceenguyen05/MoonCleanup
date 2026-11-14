// Test harness for the account API: builds the routes over a repository, dispatches requests in-process (no transport) and
// keeps one controllable clock shared by the repository, the JWT service and the handlers. Used by *.test.ts only.

import { createMemoryRepository, type MoonRepository } from "@moon-cleanup/db";
import type { HttpMethod, HttpRequest, HttpResponse, HttpRouteDef } from "@moon-cleanup/shared";
import { createAccountApi, type AccountApi, type AccountApiDeps } from "./service";

export const TEST_JWT_SECRET = "test-jwt-secret-0123456789abcdef-0123456789abcdef";
export const TEST_PEPPER = "test-pepper-0123456789abcdef-0123456789abcdef-aa";

export interface Harness {
  readonly api: AccountApi;
  readonly repo: MoonRepository;
  readonly logs: string[];
  readonly audits: string[];
  /** Epoch ms of the shared clock. */
  now(): number;
  advance(ms: number): void;
  call(
    method: HttpMethod,
    path: string,
    options?: { body?: unknown; token?: string; ip?: string; headers?: Record<string, string> },
  ): Promise<HttpResponse>;
}

function matchRoute(routes: readonly HttpRouteDef[], method: HttpMethod, path: string) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const want = route.path.split("/");
    const have = path.split("/");
    if (want.length !== have.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < want.length; i += 1) {
      if (want[i]!.startsWith(":")) params[want[i]!.slice(1)] = have[i]!;
      else if (want[i] !== have[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return undefined;
}

export function createHarness(overrides: Partial<AccountApiDeps> = {}): Harness {
  let clock = Date.parse("2026-11-14T12:00:00.000Z");
  const logs: string[] = [];
  const audits: string[] = [];
  const repo = overrides.repo ?? createMemoryRepository({ clock: () => new Date(clock) });
  const api = createAccountApi({
    repo,
    envName: "local",
    jwtSecret: TEST_JWT_SECRET,
    refreshTokenPepper: TEST_PEPPER,
    logger: {
      warn: (obj, msg) => logs.push(JSON.stringify({ obj, msg })),
      error: (obj, msg) => logs.push(JSON.stringify({ obj, msg })),
    },
    now: () => clock,
    audit: (event) => audits.push(event.kind),
    ...overrides,
  });
  return {
    api,
    repo,
    logs,
    audits,
    now: () => clock,
    advance(ms) {
      clock += ms;
    },
    async call(method, path, options = {}) {
      const [pathname = "", queryString = ""] = path.split("?");
      const matched = matchRoute(api.routes, method, pathname);
      if (matched === undefined) return { status: 404, body: { error: "NOT_FOUND" } };
      const headers: Record<string, string> = { ...options.headers };
      if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
      const request: HttpRequest = {
        method,
        path: pathname,
        params: matched.params,
        query: Object.fromEntries(new URLSearchParams(queryString)),
        headers,
        body: options.body,
        remoteAddress: options.ip ?? "203.0.113.7",
      };
      return matched.route.handle(request);
    },
  };
}
