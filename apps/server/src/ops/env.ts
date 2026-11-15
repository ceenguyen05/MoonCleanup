// Server environment: one zod schema for the canonical server env list (environments.md section 9).
// Boot calls `loadServerEnv()`; an invalid environment fails fast with a readable, secret-free message.
//
// Rules: values are never echoed in errors or logs. Secret keys are listed in SECRET_ENV_KEYS and replaced by
// "[set]" / "[unset]" in `describeEnvForLog`. Empty strings (as in a copied .env.example) count as "not provided",
// except CLIENT_IP_HEADER where an empty value deliberately means "use the TCP socket address and trust no header"
// (socket mode). Socket mode is refused unless ENV_NAME=local: behind the hosting edge the socket address is the
// proxy. Absent CLIENT_IP_HEADER = `true-client-ip` (requests without it share the tighter `unknown` bucket).
//
// SIM_TICK_HZ / SNAPSHOT_HZ: SNAPSHOT_HZ must divide SIM_TICK_HZ (even frame cadence: every Nth tick is a frame tick,
// so snapshot spacing, acks and interpolation timing are uniform). Profiles: 20/10 (free-tier default) and 30/15
// (high-rate). 30/20 is refused: it alternates 33/67 ms frame gaps and measured over the 5 KB/s per-client ceiling.

import { POOLER_URL_PROBLEM, isPoolerUrl, urlRequestsTls } from "@moon-cleanup/db";
import { EnvNameSchema, type EnvName } from "@moon-cleanup/shared";
import { z } from "zod";
// Constants only (transport.ts has type-only imports otherwise), so ops -> net adds no runtime cycle.
import { DEFAULT_TRANSPORT_MODE, TRANSPORT_MODES, type TransportMode } from "../net/transport";

/** Keys whose values must never be logged, echoed or sent to Sentry. */
export const SECRET_ENV_KEYS = ["DATABASE_URL", "JWT_SECRET", "JWT_SECRET_PREVIOUS", "REFRESH_TOKEN_PEPPER"] as const;

/** Values of `DB_SCHEMA` (ADR-0029: production uses `prod`; `staging` stays valid but unused). */
export const DB_SCHEMA_NAMES = ["prod", "staging"] as const;
export type DbSchemaName = (typeof DB_SCHEMA_NAMES)[number];

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Treats "" (and whitespace only) as not provided so a half-filled .env behaves like an unset variable. */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const text = () => z.preprocess(blankToUndefined, z.string().optional());
const int = (min: number, max: number, fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).default(fallback));
const num = (min: number, max: number, fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().min(min).max(max).default(fallback));
const secret = () => z.preprocess(blankToUndefined, z.string().min(32, "must be at least 32 characters"));
const optionalSecret = () =>
  z.preprocess(blankToUndefined, z.string().min(32, "must be at least 32 characters").optional());

/**
 * Marker text of the `.env.example` placeholder secrets (and common copies of it). The example values are long enough to
 * pass the 32-character check, so ENV_NAME=production refuses them explicitly (review N11).
 */
const PLACEHOLDER_SECRET_RE = /replace[-_ ]?me|change[-_ ]?me|placeholder|your[-_ ]?(secret|pepper|key)|<[^>]*>/i;

/** Env keys holding signing / hashing secrets that must never be a template placeholder in production. */
const PLACEHOLDER_CHECKED_KEYS = ["JWT_SECRET", "JWT_SECRET_PREVIOUS", "REFRESH_TOKEN_PEPPER"] as const;

/** TRANSPORT: blank -> `auto`; trimmed and case-insensitive (same rules as net/transport `parseTransportMode`). */
const transportMode = () =>
  z.preprocess(
    (value) => {
      const v = typeof value === "string" ? value.trim().toLowerCase() : value;
      return v === "" ? undefined : v;
    },
    z.enum(TRANSPORT_MODES, { error: `expected one of ${TRANSPORT_MODES.join(", ")}` }).default(DEFAULT_TRANSPORT_MODE),
  );

const rawSchema = z.object({
  NODE_ENV: z.preprocess(blankToUndefined, z.enum(["development", "test", "production"]).default("development")),
  PORT: int(1, 65535, 2567),
  ENV_NAME: EnvNameSchema,
  DATABASE_URL: text(),
  DATABASE_CA_CERT: text(),
  DB_SCHEMA: z.preprocess(blankToUndefined, z.enum(DB_SCHEMA_NAMES).default("prod")),
  PERSISTENCE_DRIVER: z.enum(["postgres", "memory"]),
  DB_POOL_MAX: int(1, 20, 4),
  JWT_SECRET: secret(),
  JWT_SECRET_PREVIOUS: optionalSecret(),
  REFRESH_TOKEN_PEPPER: secret(),
  ALLOWED_ORIGINS: z.string().min(1, "must list at least one origin"),
  SENTRY_DSN: text(),
  SENTRY_TRACES_SAMPLE_RATE: num(0, 1, 0.01),
  LOG_LEVEL: z.preprocess(blankToUndefined, z.enum(LOG_LEVELS).default("info")),
  SIM_TICK_HZ: int(1, 60, 20),
  SNAPSHOT_HZ: int(1, 60, 10),
  MAX_ROOMS: int(1, 16, 3),
  TICK_BUDGET_MS: num(0.1, 50, 3.5),
  // Not blank-normalised: absent -> default header, present-but-empty -> null (socket mode, ENV_NAME=local only).
  CLIENT_IP_HEADER: z.string().optional(),
  // Default 12: owner cap is 6 players per room (MAX_PLAYERS_PER_ROOM), so 12 clients = two full rooms or
  // three smaller ones on the 0.1-CPU free tier; MAX_ROOMS stays the hard room ceiling.
  MAX_CLIENTS: int(1, 256, 12),
  // Per-IP live seats (joined + reserved). Default 6 = one full room (net/admission MAX_SEATS_PER_IP); raise it for
  // demos where several players share one NAT address.
  MAX_SEATS_PER_IP: int(1, 64, 6),
  CHECKPOINT_INTERVAL_S: int(1, 30, 30),
  // Process-wide budget for decompressing solo checkpoint uploads/downloads (api/checkpoints/inflate-budget). Defaults are
  // sized for the 512 MB / 0.1 CPU Render Free instance: one maximum (32 MiB) upload's worth of inflate per minute, one
  // verification at a time, three waiting. The per-upload 32 MiB cap is a code constant, not configurable here.
  CHECKPOINT_INFLATE_MIB_PER_MIN: int(1, 1024, 32),
  CHECKPOINT_INFLATE_CONCURRENCY: int(1, 4, 1),
  CHECKPOINT_INFLATE_QUEUE: int(0, 16, 3),
  SEAT_HOLD_S: int(1, 600, 60),
  BUILD_VERSION: text(),
  RENDER_GIT_COMMIT: text(),
  NET_SPIKE: z.preprocess(blankToUndefined, z.enum(["0", "1"]).default("0")),
  TRANSPORT: transportMode(),
});

/** Validated, typed server configuration (camelCase). Contains secrets: never log it, use `describeEnvForLog`. */
export interface ServerEnv {
  readonly nodeEnv: "development" | "test" | "production";
  readonly port: number;
  readonly envName: EnvName;
  readonly databaseUrl: string | undefined;
  readonly databaseCaCert: string | undefined;
  readonly dbSchema: DbSchemaName;
  readonly persistenceDriver: "postgres" | "memory";
  readonly dbPoolMax: number;
  readonly jwtSecret: string;
  readonly jwtSecretPrevious: string | undefined;
  readonly refreshTokenPepper: string;
  readonly allowedOrigins: readonly string[];
  readonly sentryDsn: string | undefined;
  readonly sentryTracesSampleRate: number;
  readonly logLevel: LogLevel;
  readonly simTickHz: number;
  readonly snapshotHz: number;
  /** Hard ceiling on live rooms (admission is decided by the tick budget below it). */
  readonly maxRooms: number;
  readonly tickBudgetMs: number;
  /** Lower-case header name carrying the client IP, or null for socket mode (TCP peer address; ENV_NAME=local only). */
  readonly clientIpHeader: string | null;
  readonly maxClients: number;
  /** Live seats (joined + reserved) one client IP may hold. */
  readonly maxSeatsPerIp: number;
  readonly checkpointIntervalS: number;
  /** Inflated MiB per minute the whole process may spend decompressing checkpoints. */
  readonly checkpointInflateMibPerMin: number;
  /** Checkpoint verifications that may inflate at once. */
  readonly checkpointInflateConcurrency: number;
  /** Verifications that may wait for a free slot before further ones are shed (503). */
  readonly checkpointInflateQueue: number;
  readonly seatHoldS: number;
  /** BUILD_VERSION, else the first 12 characters of RENDER_GIT_COMMIT, else `dev`. Matches BuildIdSchema. */
  readonly buildVersion: string;
  /** RENDER_GIT_COMMIT (full SHA) when present, for log fields. */
  readonly gitCommit: string | undefined;
  readonly netSpike: boolean;
  /** TRANSPORT: `auto` (uWebSockets.js, falling back to `ws`), `uws` (fatal if unavailable) or `ws`. */
  readonly transport: TransportMode;
}

/** Thrown for an invalid environment. `issues` lists "KEY: problem" lines and never contains values. */
export class EnvValidationError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(
      `Invalid server environment (${issues.length} problem${issues.length === 1 ? "" : "s"}):\n - ${issues.join("\n - ")}`,
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

const BUILD_ID_RE = /^[A-Za-z0-9._+-]{1,64}$/;

/** Parses an origin list: comma separated, trimmed, no empty entries, no trailing slash. */
function parseOrigins(raw: string): { origins: string[]; problems: string[] } {
  const origins: string[] = [];
  const problems: string[] = [];
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (entry === "") continue;
    let url: URL | undefined;
    try {
      url = new URL(entry);
    } catch {
      url = undefined;
    }
    if (url === undefined || (url.protocol !== "http:" && url.protocol !== "https:")) {
      problems.push("ALLOWED_ORIGINS: every entry must be an http(s) origin such as https://example.com");
      continue;
    }
    if (entry !== url.origin) {
      problems.push("ALLOWED_ORIGINS: entries must be exact origins (no path, no trailing slash)");
      continue;
    }
    origins.push(url.origin);
  }
  if (origins.length === 0 && problems.length === 0) problems.push("ALLOWED_ORIGINS: must list at least one origin");
  return { origins, problems: [...new Set(problems)] };
}

/**
 * Validates an environment record (normally `process.env`). Throws `EnvValidationError` listing every problem;
 * the thrown message never contains a value.
 */
export function parseServerEnv(source: Readonly<Record<string, string | undefined>>): ServerEnv {
  const parsed = rawSchema.safeParse(source);
  const issues: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.length > 0 ? issue.path.join(".") : "(env)";
      issues.push(`${key}: ${issue.message}`);
    }
    throw new EnvValidationError(issues);
  }
  const raw = parsed.data;

  if (raw.SIM_TICK_HZ % raw.SNAPSHOT_HZ !== 0) {
    issues.push("SNAPSHOT_HZ: must divide SIM_TICK_HZ evenly");
  }
  if (raw.PERSISTENCE_DRIVER === "memory" && raw.ENV_NAME !== "local") {
    issues.push("PERSISTENCE_DRIVER: memory is only allowed when ENV_NAME is local");
  }
  if (raw.PERSISTENCE_DRIVER === "postgres") {
    if (raw.DATABASE_URL === undefined) issues.push("DATABASE_URL: required when PERSISTENCE_DRIVER is postgres");
  }
  if (raw.DATABASE_URL !== undefined) {
    if (!/^postgres(ql)?:\/\//i.test(raw.DATABASE_URL)) {
      issues.push("DATABASE_URL: must be a postgres:// or postgresql:// URL");
    } else {
      if (isPoolerUrl(raw.DATABASE_URL)) issues.push(POOLER_URL_PROBLEM);
      // TLS is mandatory off local. DATABASE_CA_CERT is optional: without it the server certificate is verified
      // against the system CA store (Neon); with it, against that CA. Verification is never disabled.
      if (raw.ENV_NAME !== "local" && !urlRequestsTls(raw.DATABASE_URL)) {
        issues.push("DATABASE_URL: must include sslmode=require (TLS is mandatory when ENV_NAME is not local)");
      }
    }
  }
  if (raw.CLIENT_IP_HEADER !== undefined && raw.CLIENT_IP_HEADER.trim() === "" && raw.ENV_NAME !== "local") {
    // Behind the Render edge the socket address is the proxy (one bucket for everyone): require the edge header.
    issues.push("CLIENT_IP_HEADER: may be blank (socket address) only when ENV_NAME is local");
  }
  if (raw.ENV_NAME === "production" && raw.NET_SPIKE === "1") {
    issues.push("NET_SPIKE: must be 0 when ENV_NAME is production (ADR-0029)");
  }
  if (raw.ENV_NAME === "production") {
    for (const key of PLACEHOLDER_CHECKED_KEYS) {
      const value = raw[key];
      if (value !== undefined && PLACEHOLDER_SECRET_RE.test(value)) {
        issues.push(`${key}: looks like a template placeholder; generate a real random value (ENV_NAME=production)`);
      }
    }
  }
  const { origins, problems } = parseOrigins(raw.ALLOWED_ORIGINS);
  issues.push(...problems);

  const commit = raw.RENDER_GIT_COMMIT?.trim();
  const buildCandidate = raw.BUILD_VERSION?.trim() ?? (commit ? commit.slice(0, 12) : "dev");
  if (!BUILD_ID_RE.test(buildCandidate)) {
    issues.push("BUILD_VERSION: must be 1-64 characters of letters, digits and . _ + -");
  }

  if (issues.length > 0) throw new EnvValidationError(issues);

  const header = raw.CLIENT_IP_HEADER === undefined ? "true-client-ip" : raw.CLIENT_IP_HEADER.trim().toLowerCase();

  return {
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    envName: raw.ENV_NAME,
    databaseUrl: raw.DATABASE_URL,
    databaseCaCert: raw.DATABASE_CA_CERT,
    dbSchema: raw.DB_SCHEMA,
    persistenceDriver: raw.PERSISTENCE_DRIVER,
    dbPoolMax: raw.DB_POOL_MAX,
    jwtSecret: raw.JWT_SECRET,
    jwtSecretPrevious: raw.JWT_SECRET_PREVIOUS,
    refreshTokenPepper: raw.REFRESH_TOKEN_PEPPER,
    allowedOrigins: origins,
    sentryDsn: raw.SENTRY_DSN,
    sentryTracesSampleRate: raw.SENTRY_TRACES_SAMPLE_RATE,
    logLevel: raw.LOG_LEVEL,
    simTickHz: raw.SIM_TICK_HZ,
    snapshotHz: raw.SNAPSHOT_HZ,
    maxRooms: raw.MAX_ROOMS,
    tickBudgetMs: raw.TICK_BUDGET_MS,
    clientIpHeader: header === "" ? null : header,
    maxClients: raw.MAX_CLIENTS,
    maxSeatsPerIp: raw.MAX_SEATS_PER_IP,
    checkpointIntervalS: raw.CHECKPOINT_INTERVAL_S,
    checkpointInflateMibPerMin: raw.CHECKPOINT_INFLATE_MIB_PER_MIN,
    checkpointInflateConcurrency: raw.CHECKPOINT_INFLATE_CONCURRENCY,
    checkpointInflateQueue: raw.CHECKPOINT_INFLATE_QUEUE,
    seatHoldS: raw.SEAT_HOLD_S,
    buildVersion: buildCandidate,
    gitCommit: commit === "" ? undefined : commit,
    netSpike: raw.NET_SPIKE === "1",
    transport: raw.TRANSPORT,
  };
}

/**
 * Boot helper: parses `process.env`-like input and, on failure, throws the readable `EnvValidationError`.
 * The caller (composition root) prints `error.message` and exits non-zero.
 */
export function loadServerEnv(source: Readonly<Record<string, string | undefined>> = process.env): ServerEnv {
  return parseServerEnv(source);
}

/** A log-safe summary of the configuration: secrets and the CA cert body become presence flags. */
export function describeEnvForLog(env: ServerEnv): Record<string, unknown> {
  return {
    nodeEnv: env.nodeEnv,
    port: env.port,
    envName: env.envName,
    persistenceDriver: env.persistenceDriver,
    dbSchema: env.dbSchema,
    dbPoolMax: env.dbPoolMax,
    databaseUrl: env.databaseUrl === undefined ? "[unset]" : "[set]",
    databaseCaCert: env.databaseCaCert === undefined ? "[unset]" : "[set]",
    jwtSecret: "[set]",
    jwtSecretPrevious: env.jwtSecretPrevious === undefined ? "[unset]" : "[set]",
    refreshTokenPepper: "[set]",
    sentryDsn: env.sentryDsn === undefined ? "[unset]" : "[set]",
    allowedOrigins: env.allowedOrigins,
    logLevel: env.logLevel,
    simTickHz: env.simTickHz,
    snapshotHz: env.snapshotHz,
    maxRooms: env.maxRooms,
    tickBudgetMs: env.tickBudgetMs,
    clientIpHeader: env.clientIpHeader,
    maxClients: env.maxClients,
    maxSeatsPerIp: env.maxSeatsPerIp,
    checkpointIntervalS: env.checkpointIntervalS,
    checkpointInflateMibPerMin: env.checkpointInflateMibPerMin,
    checkpointInflateConcurrency: env.checkpointInflateConcurrency,
    checkpointInflateQueue: env.checkpointInflateQueue,
    seatHoldS: env.seatHoldS,
    buildVersion: env.buildVersion,
    gitCommit: env.gitCommit,
    netSpike: env.netSpike,
    transport: env.transport,
  };
}
