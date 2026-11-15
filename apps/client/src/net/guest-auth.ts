// Guest sign-in token source (M1-W4-T04b) over the server accounts API (security.md section 3, shared API_ROUTES):
//   POST /v1/auth/guest    -> player + token pair + one-time recovery code
//   POST /v1/auth/refresh  -> rotated token pair (409 TOKEN_SUPERSEDED when another tab won the rotation race)
// Storage (security.md "Client storage"): the refresh token lives in localStorage (for a guest it IS the account); the
// access token stays in memory only. Tokens are never logged and never put in a URL.
//
// SOLO FIRST: nothing runs at import; the app loads this module in the background sync chunk after the host starts.
// `getAccessToken` never creates an account: only `signIn()` does (the app calls it once, then `notifyAuthChanged`).

import { API_ROUTES, GuestCreateResponseSchema, RefreshResponseSchema, type TokenPair } from "@moon-cleanup/shared";
import type { AccessTokenSource } from "./room-session";

/** localStorage key of the refresh token (stable: renaming it signs every guest out). */
export const REFRESH_TOKEN_KEY = "moon-cleanup.auth.refresh";
/** An access token is refreshed this long before it expires (clock skew, request latency). */
export const ACCESS_EXPIRY_MARGIN_MS = 30_000;
/** Request timeout: a Render cold start answers within about a minute; the caller retries later on null. */
export const AUTH_TIMEOUT_MS = 70_000;

/** The part of `Storage` used here (localStorage; null when unavailable, e.g. blocked storage). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GuestAuthOptions {
  readonly httpUrl: string;
  readonly storage: KeyValueStore | null;
  readonly fetch?: typeof fetch;
  /** Wall clock in ms (default Date.now). */
  readonly now?: () => number;
  /** Signed-in state changed (signed in, or the stored refresh token was refused and dropped). */
  readonly onChange?: (signedIn: boolean) => void;
}

export interface GuestAuthStats {
  guestCreated: number;
  refreshed: number;
  refreshRefused: number;
  superseded: number;
  networkFailures: number;
}

function safeGet(s: KeyValueStore | null, key: string): string | null {
  try {
    return s?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function safeSet(s: KeyValueStore | null, key: string, value: string | null): void {
  try {
    if (value === null) s?.removeItem(key);
    else s?.setItem(key, value);
  } catch {
    // Storage full or blocked: the session still works in memory for this tab.
  }
}

/** Guest account token source: implements the room and save-sync `getAccessToken(forceRefresh)` port. */
export class GuestAuth implements AccessTokenSource {
  readonly stats: GuestAuthStats = {
    guestCreated: 0,
    refreshed: 0,
    refreshRefused: 0,
    superseded: 0,
    networkFailures: 0,
  };
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private access: string | null = null;
  private accessExpiresAt = 0;
  /** Refresh token held in memory too (storage may be unavailable). */
  private refresh: string | null;
  private inflight: Promise<string | null> | null = null;
  private recovery: string | null = null;

  constructor(private readonly options: GuestAuthOptions) {
    this.base = options.httpUrl.replace(/\/+$/, "");
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
    this.refresh = safeGet(options.storage, REFRESH_TOKEN_KEY);
  }

  /** True when a refresh token is held (the account exists on this device). */
  get signedIn(): boolean {
    return this.refresh !== null;
  }

  /** The one-time recovery code of a guest created in this tab (the UI shows it once), then null. */
  takeRecoveryCode(): string | null {
    const c = this.recovery;
    this.recovery = null;
    return c;
  }

  async getAccessToken(forceRefresh: boolean): Promise<string | null> {
    if (!forceRefresh && this.access !== null && this.now() < this.accessExpiresAt) return this.access;
    if (this.refresh === null && safeGet(this.options.storage, REFRESH_TOKEN_KEY) === null) return null;
    return this.single(() => this.rotate());
  }

  /**
   * Ensures an account: refreshes a stored one, or creates a guest when none exists. True when signed in. A network
   * failure (server asleep, offline) returns false and keeps any stored token for a later attempt.
   */
  async signIn(displayName?: string): Promise<boolean> {
    const token = await this.single(() => (this.refresh !== null ? this.rotate() : this.createGuest(displayName)));
    return token !== null;
  }

  /** Forgets the tokens on this device (no server call; logout/revoke belongs to the account UI). */
  forget(): void {
    const was = this.signedIn;
    this.access = null;
    this.refresh = null;
    safeSet(this.options.storage, REFRESH_TOKEN_KEY, null);
    if (was) this.options.onChange?.(false);
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  /** One auth request at a time per tab (a second caller awaits the same answer: no double rotation). */
  private single(run: () => Promise<string | null>): Promise<string | null> {
    this.inflight ??= run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private adopt(pair: TokenPair): string {
    const wasSignedIn = this.signedIn;
    this.access = pair.accessToken;
    this.accessExpiresAt = this.now() + pair.accessExpiresInS * 1000 - ACCESS_EXPIRY_MARGIN_MS;
    this.refresh = pair.refreshToken;
    safeSet(this.options.storage, REFRESH_TOKEN_KEY, pair.refreshToken);
    if (!wasSignedIn) this.options.onChange?.(true);
    return pair.accessToken;
  }

  private async post(path: string, body: unknown): Promise<Response | null> {
    try {
      return await this.doFetch(`${this.base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      });
    } catch {
      this.stats.networkFailures++;
      return null;
    }
  }

  private async json(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return null; // Render waking page or an empty body
    }
  }

  private async createGuest(displayName: string | undefined): Promise<string | null> {
    const res = await this.post(API_ROUTES.guestCreate.path, displayName === undefined ? {} : { displayName });
    if (res === null || !res.ok) return null;
    const parsed = GuestCreateResponseSchema.safeParse(await this.json(res));
    if (!parsed.success) return null;
    this.stats.guestCreated++;
    this.recovery = parsed.data.recoveryCode;
    return this.adopt(parsed.data);
  }

  /** Rotates the refresh token; one retry after 409 TOKEN_SUPERSEDED with the token another tab stored. */
  private async rotate(): Promise<string | null> {
    for (let pass = 0; pass < 2; pass++) {
      const stored = safeGet(this.options.storage, REFRESH_TOKEN_KEY);
      if (stored !== null) this.refresh = stored; // another tab may have rotated it
      const token = this.refresh;
      if (token === null) return null;
      const res = await this.post(API_ROUTES.authRefresh.path, { refreshToken: token });
      if (res === null) return null;
      if (res.ok) {
        const parsed = RefreshResponseSchema.safeParse(await this.json(res));
        if (!parsed.success) return null;
        this.stats.refreshed++;
        return this.adopt(parsed.data);
      }
      if (res.status === 409) {
        this.stats.superseded++;
        continue;
      }
      if (res.status === 401) {
        // Revoked or expired family: the account cannot be used from here any more (recovery code flow restores it).
        this.stats.refreshRefused++;
        this.forget();
        return null;
      }
      return null; // 429 / 5xx / waking: keep the token, the caller retries later
    }
    return null;
  }
}

export function createGuestAuth(options: GuestAuthOptions): GuestAuth {
  return new GuestAuth(options);
}
