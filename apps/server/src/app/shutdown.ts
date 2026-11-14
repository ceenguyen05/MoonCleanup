// Graceful shutdown wiring (netcode.md section 9.3). SIGTERM/SIGINT start one drain: mark draining (readiness turns
// 503), close rooms and sockets, close the database pool, exit 0. A drain that exceeds the budget exits 1 so the
// platform's 30 s SIGKILL window is never needed. Nothing here is silent: every step is logged.

import type { Logger } from "../ops";

/** Drain budget in ms: Render sends SIGKILL 30 s after SIGTERM (ADR-0029); keep a 5 s margin. */
export const SHUTDOWN_BUDGET_MS = 25_000;

export interface ShutdownTarget {
  readonly logger: Logger;
  beginDrain(): void;
  shutdown(): Promise<void>;
}

export interface ShutdownProcess {
  on(event: "SIGTERM" | "SIGINT", listener: (signal: string) => void): unknown;
  exit(code: number): void;
}

export interface ShutdownOptions {
  readonly budgetMs?: number;
  readonly proc?: ShutdownProcess;
}

/** Installs the signal handlers; returns the function they call (also used by tests). */
export function installShutdown(
  target: ShutdownTarget,
  options: ShutdownOptions = {},
): (reason: string) => Promise<void> {
  const proc: ShutdownProcess = options.proc ?? process;
  const budgetMs = options.budgetMs ?? SHUTDOWN_BUDGET_MS;
  let started: Promise<void> | undefined;

  const run = (reason: string): Promise<void> => {
    started ??= (async () => {
      const startedAt = performance.now();
      target.logger.info({ reason, budgetMs }, "shutdown: draining");
      target.beginDrain();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), budgetMs);
      });
      try {
        const outcome = await Promise.race([target.shutdown().then(() => "done" as const), timeout]);
        const tookMs = Math.round(performance.now() - startedAt);
        if (outcome === "timeout") {
          target.logger.error({ tookMs, budgetMs }, "shutdown: drain exceeded budget, exiting");
          proc.exit(1);
          return;
        }
        target.logger.info({ tookMs }, "shutdown: complete");
        proc.exit(0);
      } catch (error) {
        target.logger.error({ err: error }, "shutdown: failed");
        proc.exit(1);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    })();
    return started;
  };

  proc.on("SIGTERM", () => void run("SIGTERM"));
  proc.on("SIGINT", () => void run("SIGINT"));
  return run;
}
