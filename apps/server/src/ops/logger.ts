// pino 10 logger factory. JSON lines in production (Render captures stdout), pretty output in development.
// Every record carries service/env/build/commit; secrets are scrubbed by the redaction hooks (redact.ts).

import { pino, type DestinationStream, type Logger } from "pino";
import { redactString, redactValue } from "./redact";

export type { Logger } from "pino";

export interface CreateLoggerOptions {
  readonly level: string;
  /** `production` -> JSON; anything else -> pino-pretty unless a destination is supplied. */
  readonly nodeEnv: string;
  /** ENV_NAME (local | production). */
  readonly envName: string;
  readonly buildVersion: string;
  /** RENDER_GIT_COMMIT when present. */
  readonly gitCommit?: string | undefined;
  /** Test seam: write JSON lines here instead of stdout (disables pretty output). */
  readonly destination?: DestinationStream;
}

const SERVICE = "moon-cleanup-server";

export function createLogger(options: CreateLoggerOptions): Logger {
  const base: Record<string, unknown> = {
    service: SERVICE,
    env: options.envName,
    build: options.buildVersion,
  };
  if (options.gitCommit !== undefined) base.commit = options.gitCommit;

  const pretty = options.destination === undefined && options.nodeEnv !== "production";
  const logger = pino(
    {
      level: options.level,
      base,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
        // Deep-redact the merge object (context fields, errors) before serialisation.
        log: (object) => redactValue(object) as Record<string, unknown>,
      },
      hooks: {
        // Scrub free-text messages and string format arguments.
        logMethod(args, method) {
          const scrubbed = args.map((arg) => (typeof arg === "string" ? redactString(arg) : arg));
          method.apply(this, scrubbed as unknown as Parameters<typeof method>);
        },
      },
      ...(pretty
        ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } }
        : {}),
    },
    options.destination,
  );
  return logger;
}
