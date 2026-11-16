import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bot } from "../clients/bot";
import { DEFAULT_RETRY, withJoinRetry } from "../clients/retry";
import { createRng } from "../rng";
import { buildReport, parseServerLog, renderMarkdown, summarizeBots, type BotReport } from "../reports/report";

export interface Spike16Options {
  readonly url: string;
  /** Bots in the room (the spike room caps at 6 seats). */
  readonly bots: number;
  readonly durationS: number;
  readonly tickHz: number;
  readonly snapshotHz: number;
  readonly seed: number;
  /** netsim profile name (clean|good|typical|bad|outage|coldstart) or "none" to connect directly. */
  readonly netsim: string;
  readonly netsimPort?: number;
  readonly milestone: string;
  readonly outDir: string;
  readonly serverLog?: string;
  /** Scripted reconnect of bot 0 at this fraction of the run (0 disables). */
  readonly reconnectAt: number;
  readonly allowHosted: boolean;
  /** Max total backoff wait per join/rejoin in seconds (default 60; 0 = single attempt). */
  readonly joinRetryMaxS?: number;
  /** Origin header the bots send; must be listed in the server's ALLOWED_ORIGINS. */
  readonly origin?: string;
  readonly label?: string;
}

/** Matches ALLOWED_ORIGINS in apps/server/.env.example; override with --origin when the server allows another. */
const DEFAULT_ORIGIN = "http://localhost:5173";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const NETSIM_DIR = path.resolve(HERE, "../../../netsim");

export function isLocalUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export async function startNetsim(
  profile: string,
  listen: number,
  target: number,
  seed: number,
): Promise<ChildProcess> {
  // netsim is its own tool package; the bots run it as a child process rather than importing it.
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/cli.ts",
      "--listen",
      String(listen),
      "--target",
      String(target),
      "--profile",
      profile,
      "--seed",
      String(seed),
    ],
    { cwd: NETSIM_DIR, stdio: ["ignore", "pipe", "inherit"] },
  );
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`netsim exited early (${code})`)));
    child.stdout?.on("data", (d: Buffer) => {
      if (d.toString().includes("netsim-ready")) resolve();
    });
  });
  child.removeAllListeners("exit");
  return child;
}

export async function stopNetsim(child: ChildProcess): Promise<Record<string, number> | null> {
  let stats: Record<string, number> | null = null;
  child.stdout?.on("data", (d: Buffer) => {
    for (const line of d.toString().split("\n")) {
      if (line.includes("netsim-stats")) {
        const rest = JSON.parse(line) as Record<string, number | string>;
        delete rest.kind;
        stats = rest as Record<string, number>;
      }
    }
  });
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  child.kill("SIGINT");
  // On Windows SIGINT may terminate without the stats line; the exit is awaited either way.
  await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 3000))]);
  return stats;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runSpike16(o: Spike16Options): Promise<{ report: BotReport; jsonPath: string; mdPath: string }> {
  if (!o.allowHosted && !isLocalUrl(o.url)) {
    throw new Error(`refusing non-local target ${o.url}: hosted runs need an approved test window and --allow-hosted`);
  }
  const target = new URL(o.url);
  let baseUrl = o.url.replace(/\/$/, "");
  let proxy: ChildProcess | undefined;
  if (o.netsim !== "none") {
    const listen = o.netsimPort ?? Number(target.port) + 10;
    proxy = await startNetsim(o.netsim, listen, Number(target.port), o.seed);
    baseUrl = `${target.protocol}//${target.hostname}:${listen}`;
  }
  const startedAt = new Date().toISOString();
  const origin = o.origin ?? DEFAULT_ORIGIN;
  const bots: Bot[] = [];
  for (let i = 0; i < o.bots; i++) {
    bots.push(new Bot({ index: i, baseUrl, origin, tickHz: o.tickHz, snapshotHz: o.snapshotHz, seed: o.seed }));
  }
  const retry = {
    baseMs: DEFAULT_RETRY.baseMs,
    capMs: DEFAULT_RETRY.capMs,
    maxTotalMs: (o.joinRetryMaxS ?? DEFAULT_RETRY.maxTotalMs / 1000) * 1000,
  };
  const retryRng = createRng(o.seed * 7919 + 13);
  const joinWithRetry = (bot: Bot, i: number): Promise<void> =>
    withJoinRetry(() => bot.join(), { ...retry, label: `bot ${i}` }, { sleep, rng: retryRng, log: console.error });
  try {
    for (const [i, bot] of bots.entries()) await joinWithRetry(bot, i);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `bot join failed (${reason}). If the server rejected the connection (close code 1006), check that its ` +
        `ALLOWED_ORIGINS contains the bot origin ${origin}; pass --origin <origin> to change it.`,
      { cause: error },
    );
  }

  const heapStart = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const tickMs = 1000 / o.tickHz;
  let n = 0;
  let reconnects = 0;
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      n++;
      for (const b of bots) b.tick();
      const wait = t0 + n * tickMs - performance.now();
      await sleep(Math.max(0, wait));
    }
  })();
  const pings = setInterval(() => {
    for (const b of bots) b.ping();
  }, 2000);
  const progress = setInterval(() => {
    const s = Math.round((performance.now() - t0) / 1000);
    console.error(
      `[spike-16] ${s}/${o.durationS} s, connected ${bots.filter((b) => b.connected).length}/${bots.length}`,
    );
  }, 30_000);

  // Bots dropped by the server (restart, kick) rejoin with the same backoff; counted as reconnects.
  const rejoining = new Set<number>();
  const supervisor = setInterval(() => {
    for (const [i, b] of bots.entries()) {
      if (!b.dropped || rejoining.has(i)) continue;
      rejoining.add(i);
      console.error(`[spike-16] bot ${i} dropped by server; rejoining`);
      joinWithRetry(b, i)
        .then(() => void reconnects++)
        .catch((e: unknown) => console.error(`[spike-16] bot ${i} rejoin abandoned: ${String(e)}`))
        .finally(() => void rejoining.delete(i));
    }
  }, 1000);

  if (o.reconnectAt > 0 && bots[0]) {
    await sleep(o.durationS * 1000 * o.reconnectAt);
    const bot = bots[0];
    await bot.leave();
    await joinWithRetry(bot, 0);
    reconnects++;
    await sleep(Math.max(0, o.durationS * 1000 * (1 - o.reconnectAt)));
  } else {
    await sleep(o.durationS * 1000);
  }
  stop = true;
  clearInterval(pings);
  clearInterval(progress);
  clearInterval(supervisor);
  await loop;
  const elapsedS = (performance.now() - t0) / 1000;
  const heapGrowthMB = (process.memoryUsage().heapUsed - heapStart) / 1e6;
  await Promise.all(bots.map((b) => b.leave()));

  const netsimStats = proxy ? await stopNetsim(proxy) : null;
  const server = o.serverLog ? parseServerLog(await readFile(o.serverLog, "utf8")) : null;
  const summary = summarizeBots(
    bots.map((b) => b.metrics),
    elapsedS,
    o.snapshotHz,
    reconnects,
    heapGrowthMB,
  );
  const report = buildReport(
    {
      scenario: "spike-16",
      milestone: o.milestone,
      url: o.url,
      profile: o.netsim,
      seed: o.seed,
      tickHz: o.tickHz,
      snapshotHz: o.snapshotHz,
      startedAt,
      durationS: o.durationS,
      node: process.version,
    },
    summary,
    server,
    netsimStats,
  );
  const dir = path.resolve(o.outDir, o.milestone);
  await mkdir(dir, { recursive: true });
  const base = o.label ?? `spike-16-${o.netsim}-${o.tickHz}-${o.snapshotHz}-${startedAt.replace(/[:.]/g, "-")}`;
  const jsonPath = path.join(dir, `${base}.json`);
  const mdPath = path.join(dir, `${base}.md`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(mdPath, renderMarkdown(report));
  return { report, jsonPath, mdPath };
}
