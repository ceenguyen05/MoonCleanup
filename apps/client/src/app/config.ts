// Client configuration from Vite's VITE_* variables and the page URL. Fails with a readable message, never a stack of
// "undefined is not a function" later. Only public values live here (secrets never use the VITE_ prefix).

/** The Vite env bag, as `import.meta.env` provides it. */
export type RawClientEnv = Readonly<Record<string, unknown>>;

export interface ClientConfig {
  /** VITE_SERVER_HTTP_URL: base URL of the game server REST API. */
  readonly httpUrl: string;
  /** VITE_SERVER_WS_URL: WebSocket URL of the Colyseus server. */
  readonly wsUrl: string;
  /** VITE_BUILD_VERSION (`dev` when unset). */
  readonly buildVersion: string;
  /** VITE_ENV: local | preview | production (`local` when unset). */
  readonly envLabel: string;
  /** `?wake=1`: start the server probe at boot instead of at the first interaction (automation, e2e). */
  readonly wakeAtBoot: boolean;
  /** `?hud=0|1|dbg`: `false` hides the DOM overlay. Default: shown, except in `?capture=1` mode. */
  readonly showOverlay: boolean;
}

export class ClientConfigError extends Error {
  override readonly name = "ClientConfigError";
}

function str(env: RawClientEnv, key: string, fallback: string): string {
  const value = env[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function url(env: RawClientEnv, key: string, protocols: readonly string[], fallback: string): string {
  const value = str(env, key, fallback);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ClientConfigError(`${key} is not a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new ClientConfigError(`${key} must use ${protocols.join(" or ")} (got ${parsed.protocol})`);
  }
  return value;
}

export function readClientConfig(env: RawClientEnv, search: string): ClientConfig {
  const params = new URLSearchParams(search);
  const hud = params.get("hud");
  const capture = params.get("capture") === "1";
  return {
    httpUrl: url(env, "VITE_SERVER_HTTP_URL", ["http:", "https:"], "http://localhost:2567"),
    wsUrl: url(env, "VITE_SERVER_WS_URL", ["ws:", "wss:"], "ws://localhost:2567"),
    buildVersion: str(env, "VITE_BUILD_VERSION", "dev"),
    envLabel: str(env, "VITE_ENV", "local"),
    wakeAtBoot: params.get("wake") === "1",
    showOverlay: hud === null ? !capture : hud !== "0",
  };
}
