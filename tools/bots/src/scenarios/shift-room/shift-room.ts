import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RETRY, withJoinRetry } from "../../clients/retry";
import { createRng } from "../../rng";
import {
  buildReport,
  parseServerLog,
  renderMarkdown,
  summarizeBots,
  type BotReport,
  type ServerLogSummary,
} from "../../reports/report";
import { round } from "../../stats";
import { startNetsim, stopNetsim } from "../spike16";
import { ShiftBot, desyncCount, type ShiftBotMetrics } from "./shift-bot";

export const SHIFT_CONTRACT_ID = "00000000-0000-4000-8000-0000000000c7";
const DEFAULT_ORIGIN = "http://localhost:5173";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOTS_DIR = path.resolve(HERE, "../../..");

export interface ShiftRoomOptions {
  /** Port the harness server listens on (2567 + port offset N). */
  readonly port: number;
  readonly bots: number;
  readonly durationS: number;
  readonly tickHz: number;
  readonly snapshotHz: number;
  readonly seed: number;
  /** netsim profile name or "none". */
  readonly netsim: string;
  readonly milestone: string;
  readonly outDir: string;
  readonly label?: string;
  readonly joinRetryMaxS?: number;
}

export interface ShiftExtras {
  readonly desync: {
    readonly total: number;
    readonly frameDecodeFailures: number;
    readonly tickRegressions: number;
    readonly ackRegressions: number;
    readonly positionJumps: number;
    readonly maxSelfStepM: number;
    readonly distanceMPerBot: number;
  };
  readonly serverTickRing: { n: number; p50: number; p95: number; max: number } | null;
  readonly serverOverruns: number | null;
}

export type ShiftRoomReport = BotReport & { readonly shift: ShiftExtras };

/** Sums the desync counters of all bots and picks the final server tick ring out of the `spike-loop` lines. */
export function summarizeShift(all: readonly ShiftBotMetrics[], serverLog: string): ShiftExtras {
  const sum = (f: (m: ShiftBotMetrics) => number): number => all.reduce((a, m) => a + f(m), 0);
  let ring: ShiftExtras["serverTickRing"] = null;
  let overruns: number | null = null;
  for (const raw of serverLog.split(/\r?\n/)) {
    const i = raw.indexOf("{");
    if (i < 0) continue;
    try {
      const o = JSON.parse(raw.slice(i)) as { kind?: string; tick?: ShiftExtras["serverTickRing"]; overruns?: number };
      if (o.kind === "spike-loop" && o.tick && (o.tick.n ?? 0) > 0) {
        ring = o.tick;
        overruns = o.overruns ?? null;
      }
    } catch {
      /* not JSON */
    }
  }
  return {
    desync: {
      total: sum(desyncCount),
      frameDecodeFailures: sum((m) => m.frameDecodeFailures),
      tickRegressions: sum((m) => m.tickRegressions),
      ackRegressions: sum((m) => m.ackRegressions),
      positionJumps: sum((m) => m.positionJumps),
      maxSelfStepM: round(Math.max(0, ...all.map((m) => m.maxSelfStepM)), 2),
      distanceMPerBot: round(sum((m) => m.distanceM) / Math.max(1, all.length), 1),
    },
    serverTickRing: ring,
    serverOverruns: overruns,
  };
}

export function renderShiftMarkdown(r: ShiftRoomReport): string {
  const s = r.shift;
  const t = s.serverTickRing;
  return [
    renderMarkdown(r),
    "## ShiftRoom specifics",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Room tick ring p50 / p95 / max (ShiftRoom.tickStats, last 4096 ticks) | ${t ? `${t.p50} / ${t.p95} / ${t.max} ms (n=${t.n})` : "n/a"} |`,
    `| Room loop overruns | ${s.serverOverruns ?? "n/a"} |`,
    `| Desync total (heuristic) | ${s.desync.total} = decode ${s.desync.frameDecodeFailures} + tick regress ${s.desync.tickRegressions} + ack regress ${s.desync.ackRegressions} + position jumps ${s.desync.positionJumps} |`,
    `| Max self step between frames / distance walked per bot | ${s.desync.maxSelfStepM} m / ${s.desync.distanceMPerBot} m |`,
    "",
    "Desync here means: FRAME decode failure, serverTick or ack going backwards, or own position jumping more than 6 m between",
    "frames. It does not replay client prediction against the server sim (no predicted-vs-authoritative compare yet).",
    "",
  ].join("\n");
}

async function startHarness(o: ShiftRoomOptions): Promise<{ child: ChildProcess; log: () => string }> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "harness/shift-server.mts",
      "--port",
      String(o.port),
      "--tick",
      String(o.tickHz),
      "--snap",
      String(o.snapshotHz),
      "--duration",
      String(o.durationS + 300),
      "--origin",
      DEFAULT_ORIGIN,
    ],
    { cwd: BOTS_DIR, stdio: ["pipe", "pipe", "inherit"] },
  );
  let buf = "";
  child.stdout?.on("data", (d: Buffer) => (buf += d.toString()));
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`shift harness exited early (${code})`)));
    child.stdout?.on("data", () => {
      if (buf.includes("shift-ready")) resolve();
    });
    setTimeout(() => reject(new Error("shift harness not ready after 90 s")), 90_000).unref();
  });
  child.removeAllListeners("exit");
  return { child, log: () => buf };
}

async function stopHarness(child: ChildProcess): Promise<void> {
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  child.stdin?.write("stop\n");
  await Promise.race([
    exited,
    new Promise<void>((r) =>
      setTimeout(() => {
        child.kill();
        r();
      }, 15_000),
    ),
  ]);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runShiftRoom(
  o: ShiftRoomOptions,
): Promise<{ report: ShiftRoomReport; jsonPath: string; mdPath: string }> {
  const harness = await startHarness(o);
  let proxy: ChildProcess | undefined;
  let baseUrl = `http://127.0.0.1:${o.port}`;
  const bots: ShiftBot[] = [];
  const startedAt = new Date().toISOString();
  try {
    if (o.netsim !== "none") {
      const listen = o.port + 10;
      proxy = await startNetsim(o.netsim, listen, o.port, o.seed);
      baseUrl = `http://127.0.0.1:${listen}`;
    }
    for (let i = 0; i < o.bots; i++) {
      bots.push(
        new ShiftBot({
          index: i,
          baseUrl,
          origin: DEFAULT_ORIGIN,
          contractId: i < 0 ? SHIFT_CONTRACT_ID : `${SHIFT_CONTRACT_ID.slice(0, -2)}${(Math.floor(i / 6) + 0xc7).toString(16).padStart(2, "0")}`, // 6 seats per room: bots 0-5 room c7, 6-11 c8, ...
          tickHz: o.tickHz,
          seed: o.seed,
        }),
      );
    }
    const retry = {
      baseMs: DEFAULT_RETRY.baseMs,
      capMs: DEFAULT_RETRY.capMs,
      maxTotalMs: (o.joinRetryMaxS ?? 60) * 1000,
    };
    const retryRng = createRng(o.seed * 7919 + 13);
    const join = (b: ShiftBot, i: number): Promise<void> =>
      withJoinRetry(() => b.join(), { ...retry, label: `bot ${i}` }, { sleep, rng: retryRng, log: console.error });
    for (const [i, b] of bots.entries()) await join(b, i);

    const heapStart = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const tickMs = 1000 / o.tickHz;
    let n = 0;
    let stop = false;
    const loop = (async () => {
      while (!stop) {
        n++;
        for (const b of bots) b.tick();
        await sleep(Math.max(0, t0 + n * tickMs - performance.now()));
      }
    })();
    const pings = setInterval(() => bots.forEach((b) => b.ping()), 2000);
    const progress = setInterval(() => {
      console.error(
        `[shift-room] ${Math.round((performance.now() - t0) / 1000)}/${o.durationS} s, connected ${bots.filter((b) => b.connected).length}/${bots.length}`,
      );
    }, 10_000);
    await sleep(o.durationS * 1000);
    stop = true;
    clearInterval(pings);
    clearInterval(progress);
    await loop;
    const elapsedS = (performance.now() - t0) / 1000;
    const heapGrowthMB = (process.memoryUsage().heapUsed - heapStart) / 1e6;
    await Promise.all(bots.map((b) => b.leave()));
    const netsimStats = proxy ? await stopNetsim(proxy) : null;
    proxy = undefined;
    await stopHarness(harness.child);
    const text = harness.log();
    await mkdir(path.resolve(o.outDir, o.milestone), { recursive: true });
    await writeFile(path.resolve(o.outDir, o.milestone, `${o.label ?? "shift-room"}.server.log`), text);
    const server: ServerLogSummary = parseServerLog(text);
    const metrics = bots.map((b) => b.metrics);
    const base = buildReport(
      {
        scenario: "shift-room",
        milestone: o.milestone,
        url: `http://127.0.0.1:${o.port} (harness)`,
        profile: o.netsim,
        seed: o.seed,
        tickHz: o.tickHz,
        snapshotHz: o.snapshotHz,
        startedAt,
        durationS: o.durationS,
        node: process.version,
      },
      summarizeBots(metrics, elapsedS, o.snapshotHz, 0, heapGrowthMB),
      server,
      netsimStats,
    );
    const shift = summarizeShift(metrics, text);
    const report: ShiftRoomReport = {
      ...base,
      desync: { count: shift.desync.total, note: "heuristic: decode, tick/ack regression, position jump" },
      shift,
    };
    const dir = path.resolve(o.outDir, o.milestone);
    await mkdir(dir, { recursive: true });
    const name = o.label ?? `shift-room-${o.bots}b-${o.netsim}-${startedAt.replace(/[:.]/g, "-")}`;
    const jsonPath = path.join(dir, `${name}.json`);
    const mdPath = path.join(dir, `${name}.md`);
    await writeFile(jsonPath, JSON.stringify(report, null, 2));
    await writeFile(mdPath, renderShiftMarkdown(report));
    return { report, jsonPath, mdPath };
  } finally {
    if (proxy) await stopNetsim(proxy).catch(() => undefined);
    if (harness.child.exitCode === null) harness.child.kill();
  }
}
