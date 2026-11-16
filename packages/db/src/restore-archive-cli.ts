// Entry point of `pnpm --filter @moon-cleanup/db run restore-archive -- <command>`: lists and restores room save
// archives (migration 0004). Operator tool, never run by the build or the server. Dry run by default; `--apply` needs a
// matching `--confirm`. Connection settings come from the same environment as the migrate CLI (DATABASE_URL direct
// string, DB_SCHEMA, TLS rules) and are never printed. Runs under Node type stripping (sibling .ts imports only).

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { retryWithBackoff } from "./backoff.ts";
import { planMigrationFromEnv } from "./config.ts";
import { buildClientOptions } from "./connection.ts";
import { errorCodeForLog, isUnreachableError } from "./errors.ts";
import { createRoomArchiveAdmin } from "./repositories/room-archive-admin.ts";
import type { PgDb } from "./repositories/postgres.ts";
import { RESTORE_CLI_USAGE, parseRestoreArgs } from "./restore-archive-args.ts";
import * as schema from "./schema/index.ts";

const out = (line: string): void => console.log(line);
const command = parseRestoreArgs(process.argv.slice(2));

if (command.kind === "help") {
  out(RESTORE_CLI_USAGE);
} else if (command.kind === "invalid") {
  console.error(`[db:restore] ${command.problems.join("\n[db:restore] ")}\n${RESTORE_CLI_USAGE}`);
  process.exitCode = 2;
} else {
  const plan = planMigrationFromEnv(process.env);
  if (plan.kind !== "run") {
    console.error(
      `[db:restore] ${plan.kind === "skip" ? plan.reason : `invalid environment:\n - ${plan.problems.join("\n - ")}`}`,
    );
    process.exitCode = 1;
  } else {
    try {
      await retryWithBackoff(
        async () => {
          const sql = postgres(
            plan.config.url,
            buildClientOptions({ ...plan.config, poolMax: 1 }, { lock_timeout: "5s", statement_timeout: "60s" }),
          );
          try {
            const admin = createRoomArchiveAdmin(drizzle(sql, { schema }) as unknown as PgDb);
            if (command.kind === "list") {
              const rows = await admin.listArchives(command.contractId);
              if (rows.length === 0) out("no archives for this contract");
              for (const r of rows) {
                out(
                  `${r.archiveId}  archived ${r.archivedAt.toISOString()}  reason=${r.archiveReason}  generation=${r.generation}  headers=${r.headerSlots}  chunks=${r.chunkRows}  bytes=${r.blobBytes}`,
                );
              }
              return;
            }
            const result = await admin.restoreArchive(command);
            if (result.kind === "refused") {
              out(`refused: ${result.reason}${result.plan ? ` (live rows now: ${result.plan.liveRows})` : ""}`);
              process.exitCode = 1;
              return;
            }
            const p = result.plan;
            out(
              `${result.kind === "dry_run" ? "DRY RUN (nothing written; add --apply --confirm <archive id>)" : "RESTORED"}: ` +
                `${p.headerSlots} header slot(s), ${p.chunkRows} chunk row(s), ${p.blobBytes} bytes; live rows ${p.liveRows}${p.replaceLive ? " archived as pre_restore first" : ""}`,
            );
          } finally {
            await sql.end({ timeout: 5 });
          }
        },
        {
          maxAttempts: 12,
          isRetryable: isUnreachableError,
          onRetry: ({ attempt, delayMs, error }) =>
            out(`[db:restore] waking database (${errorCodeForLog(error)}); retry ${attempt} in ${delayMs} ms`),
        },
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "ERROR";
      console.error(`[db:restore] failed (${code}); see the database logs. Connection details are not printed.`);
      process.exitCode = 1;
    }
  }
}
