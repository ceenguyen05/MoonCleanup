import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { installShutdown, type ShutdownProcess } from "./shutdown";

function fakes(shutdown: () => Promise<void>) {
  const handlers = new Map<string, (signal: string) => void>();
  const proc: ShutdownProcess = {
    on: (event, listener) => handlers.set(event, listener),
    exit: vi.fn(),
  };
  const base = pino({ level: "silent" });
  const logger = { info: vi.spyOn(base, "info"), error: vi.spyOn(base, "error") };
  const beginDrain = vi.fn();
  const target = { logger: base, beginDrain, shutdown };
  return { handlers, proc, logger, beginDrain, target };
}

describe("installShutdown", () => {
  it("SIGTERM: drains once, then exits 0", async () => {
    const shutdown = vi.fn(() => Promise.resolve());
    const f = fakes(shutdown);
    installShutdown(f.target, { proc: f.proc });
    f.handlers.get("SIGTERM")?.("SIGTERM");
    f.handlers.get("SIGINT")?.("SIGINT");
    await vi.waitFor(() => expect(f.proc.exit).toHaveBeenCalledWith(0));
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(f.beginDrain).toHaveBeenCalledTimes(1);
    expect(f.proc.exit).toHaveBeenCalledTimes(1);
  });

  it("exits 1 when the drain exceeds the budget", async () => {
    const f = fakes(() => new Promise<void>(() => undefined));
    const run = installShutdown(f.target, { proc: f.proc, budgetMs: 20 });
    await run("test");
    expect(f.proc.exit).toHaveBeenCalledWith(1);
    expect(f.logger.error).toHaveBeenCalled();
  });

  it("exits 1 and logs when shutdown throws", async () => {
    const f = fakes(() => Promise.reject(new Error("close failed")));
    await installShutdown(f.target, { proc: f.proc })("test");
    expect(f.proc.exit).toHaveBeenCalledWith(1);
    expect(f.logger.error).toHaveBeenCalled();
  });
});
