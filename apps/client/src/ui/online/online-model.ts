// Pure model of the online entry UI (no DOM, no React): the port the composition root implements, code parsing,
// error mapping and the connection indicator view. Nothing here imports online or net code; the UI reaches the online
// path only through `OnlineEntryPort`, which the app backs with the dynamic-import hook of app/online-launch.ts.

import { CloseCode, type NetConnectionState } from "@moon-cleanup/shared";

// ---- port ---------------------------------------------------------------------------------------------------------

/** The slice of net/guest-auth `GuestAuth` the entry UI uses (structurally satisfied by it). */
export interface OnlineAuthPort {
  readonly signedIn: boolean;
  /** Ensures an account (refresh a stored one or create a guest). False on a network failure. */
  signIn(displayName?: string): Promise<boolean>;
  getAccessToken(forceRefresh: boolean): Promise<string | null>;
  /** One-time recovery code of a guest created in this tab. */
  takeRecoveryCode?(): string | null;
}

/**
 * What the app gives the UI. `open` mirrors `__mcOnline.open(contractId, accessToken)` of app/online-launch.ts (closes
 * any open room first, loads the online chunk by dynamic import, never throws: failures go to the app's problem
 * reporter and show up as the connection state). `auth()` is lazy so solo never loads the auth module for this UI.
 */
export interface OnlineEntryPort {
  readonly httpUrl: string;
  auth(): Promise<OnlineAuthPort>;
  open(contractId: string, accessToken: string): Promise<void>;
  close(): void;
  readonly fetch?: typeof fetch;
}

// ---- codes --------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_ALPHABET = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export type EntryTarget =
  | { readonly kind: "code"; readonly code: string }
  | { readonly kind: "contract"; readonly id: string }
  | { readonly kind: "invalid"; readonly reason: "empty" | "malformed" };

/**
 * Parses what the player typed or pasted: an 8-character invite code (spaces and dashes ignored, any case, Crockford
 * look-alikes I/L to 1 and O to 0) or a Contract id (UUID).
 */
export function parseEntryTarget(raw: string): EntryTarget {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "invalid", reason: "empty" };
  if (UUID.test(trimmed)) return { kind: "contract", id: trimmed.toLowerCase() };
  const squeezed = trimmed
    .replace(/[\s-]+/g, "")
    .toUpperCase()
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  return CODE_ALPHABET.test(squeezed) ? { kind: "code", code: squeezed } : { kind: "invalid", reason: "malformed" };
}

/** `7QXK2M9T` read out as "7 Q X K 2 M 9 T" (screen readers spell codes character by character). */
export function spellCode(code: string): string {
  return code.split("").join(" ");
}

/** Display grouping `7QXK 2M9T`. */
export function groupCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

// ---- errors -------------------------------------------------------------------------------------------------------

export const ONLINE_ERROR_KEYS = [
  "signInFailed",
  "offline",
  "busy",
  "atCapacity",
  "waking",
  "rateLimited",
  "notFound",
  "notAllowed",
  "full",
  "quota",
  "badCode",
  "badContract",
  "unauthorized",
  "unknown",
  "stalled",
  "kicked",
  "banned",
  "idle",
  "duplicate",
  "unavailable",
  "updateRequired",
] as const;
export type OnlineErrorKey = (typeof ONLINE_ERROR_KEYS)[number];

export interface OnlineFailure {
  readonly key: OnlineErrorKey;
  /** Seconds to wait before retrying (`retry-after`), 0 when unknown. */
  readonly retryAfterS: number;
}

/** Maps a non-2xx answer of the accounts API (`API_ERROR_STATUS`) to a player-facing failure. */
export function failureOfResponse(
  status: number,
  error: string | null,
  retryAfterHeader: string | null,
): OnlineFailure {
  const seconds = Number(retryAfterHeader);
  const retryAfterS = Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : 0;
  const make = (key: OnlineErrorKey): OnlineFailure => ({ key, retryAfterS });
  switch (error) {
    case "CONTRACT_BUSY":
      return make("busy");
    case "ROOM_FULL":
      return make("full");
    case "AT_CAPACITY":
      return make("atCapacity");
    case "RETRY_LATER":
      return make("waking");
    case "QUOTA_EXCEEDED":
      return make("quota");
    case "RATE_LIMITED":
      return make("rateLimited");
    default:
      break;
  }
  switch (status) {
    case 400:
      return make("badCode");
    case 401:
      return make("unauthorized");
    case 403:
      return make("notAllowed");
    case 404:
      return make("notFound");
    case 409:
      return make("busy");
    case 429:
      return make("rateLimited");
    case 503:
      return make("atCapacity");
    default:
      return make(status >= 500 ? "waking" : "unknown");
  }
}

/** Why a connection ended, from the close code in `session.closeCode`; `null` for an unremarkable close. */
export function failureOfCloseCode(code: number | null): OnlineErrorKey | null {
  switch (code) {
    case CloseCode.PROTOCOL_MISMATCH:
      return "updateRequired";
    case CloseCode.AUTH_INVALID:
      return "unauthorized";
    case CloseCode.KICKED:
      return "kicked";
    case CloseCode.BANNED:
      return "banned";
    case CloseCode.RATE_LIMITED:
      return "rateLimited";
    case CloseCode.ROOM_FULL:
      return "full";
    case CloseCode.DUPLICATE_SESSION:
      return "duplicate";
    case CloseCode.IDLE_TIMEOUT:
      return "idle";
    case CloseCode.CONTRACT_UNAVAILABLE:
      return "unavailable";
    default:
      return null;
  }
}

// ---- connection indicator ------------------------------------------------------------------------------------------

export type ConnTone = "idle" | "pending" | "good" | "warn" | "bad";

export interface ConnView {
  readonly tone: ConnTone;
  /** `STRINGS.online.conn` key. */
  readonly label: "off" | "waking" | "connecting" | "connected" | "lost";
  /** Non-colour cue: a distinct shape per state (never colour alone). */
  readonly shape: "ring" | "dots" | "bars" | "check" | "cross";
}

/** Latency above this shows the "slow" tone while connected (the free Render tier is allowed to feel laggy). */
export const SLOW_RTT_MS = 180;

export function connView(conn: NetConnectionState, rttMs: number | null): ConnView {
  switch (conn) {
    case "asleep":
      return { tone: "idle", label: "off", shape: "ring" };
    case "waking":
      return { tone: "pending", label: "waking", shape: "dots" };
    case "connecting":
      return { tone: "pending", label: "connecting", shape: "dots" };
    case "connected":
      return rttMs !== null && rttMs >= SLOW_RTT_MS
        ? { tone: "warn", label: "connected", shape: "bars" }
        : { tone: "good", label: "connected", shape: "check" };
    case "lost":
      return { tone: "bad", label: "lost", shape: "cross" };
  }
}

/** True while an online room is open or opening (the indicator replaces the "Play online" launcher). */
export function isOnlineActive(conn: NetConnectionState): boolean {
  return conn !== "asleep";
}

/** How long an `open` may leave the store at `asleep` before the entry reports it as stalled (open never throws). */
export const OPEN_STALL_MS = 12_000;
