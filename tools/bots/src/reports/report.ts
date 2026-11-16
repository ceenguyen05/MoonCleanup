import { percentiles, round, type Percentiles } from "../stats";
import type { BotMetrics } from "../clients/bot";

export interface ServerLogSummary {
  readonly lines: number;
  readonly roomStatsLines: number;
  readonly tickMs: { readonly p50Median: number; readonly p95Max: number; readonly maxMs: number } | null;
  readonly cpuPercentOfQuota: { readonly median: number; readonly max: number } | null;
  readonly eventLoopP99MaxMs: number | null;
  /** Server wire bytes per client per second, by message type, averaged over the room-stats windows. */
  readonly bytesOutPerClientPerS: Readonly<Record<string, number>> | null;
  readonly rssMB: { readonly first: number; readonly last: number; readonly growth: number } | null;
  readonly heapUsedMB: { readonly first: number; readonly last: number; readonly growth: number } | null;
  /** Last cumulative engine counters (inputsAccepted, inputsLate, inputsSubstituted, rateLimited, malformed, ...). */
  readonly counters: Readonly<Record<string, number>> | null;
  readonly lastSpikeLoop: Readonly<Record<string, unknown>> | null;
}

type Json = Record<string, unknown>;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const median = (xs: number[]): number => percentiles(xs).p50;

/**
 * Parses newline-delimited JSON server logs (local stdout, or a pasted Render log export). Non-JSON lines and lines of
 * other kinds are ignored. `skipWindows` drops the first N room-stats windows (join/warm-up).
 */
export function parseServerLog(text: string, skipWindows = 1): ServerLogSummary {
  const stats: Json[] = [];
  const loops: Json[] = [];
  let lines = 0;
  for (const raw of text.split(/\r?\n/)) {
    const start = raw.indexOf("{");
    if (start < 0) continue;
    let obj: Json;
    try {
      obj = JSON.parse(raw.slice(start)) as Json;
    } catch {
      continue;
    }
    lines++;
    if (obj.kind === "room-stats") stats.push(obj);
    else if (obj.kind === "spike-loop") loops.push(obj);
  }
  // Only windows with load (clients > 0); drop warm-up windows.
  const loaded = stats.filter((s) => (num(s.clients) ?? 0) > 0).slice(skipWindows);
  const tickP50: number[] = [];
  const tickP95: number[] = [];
  const tickMax: number[] = [];
  const cpu: number[] = [];
  const elp99: number[] = [];
  const bytes: Record<string, number> = {};
  let clientSeconds = 0;
  for (const s of loaded) {
    const tick = s.tick as Json | undefined;
    if (tick) {
      tickP50.push(num(tick.p50Ms) ?? 0);
      tickP95.push(num(tick.p95Ms) ?? 0);
      tickMax.push(num(tick.maxMs) ?? 0);
    }
    const c = num(s.cpuPercentOfQuota);
    // A near-empty final window reports absurd CPU (M0-W2-T03 blocker 2): ignore windows shorter than 5 s.
    if (c !== undefined && (num(s.windowS) ?? 0) >= 5) cpu.push(c);
    const e = num(s.eventLoopDelayP99Ms);
    if (e !== undefined) elp99.push(e);
    const cs = (num(s.clients) ?? 0) * (num(s.windowS) ?? 0);
    clientSeconds += cs;
    for (const [k, v] of Object.entries((s.bytesOutByType as Record<string, number> | undefined) ?? {})) {
      bytes[k] = (bytes[k] ?? 0) + v;
    }
  }
  const bytesPer: Record<string, number> = {};
  if (clientSeconds > 0) for (const [k, v] of Object.entries(bytes)) bytesPer[k] = Math.round(v / clientSeconds);
  const series = (key: string) => {
    const xs = loops.map((l) => num(l[key])).filter((v): v is number => v !== undefined);
    if (xs.length === 0) return null;
    const first = xs[0] as number;
    const last = xs.at(-1) as number;
    return { first, last, growth: round(last - first, 1) };
  };
  const lastLoop = loops.at(-1) ?? null;
  return {
    lines,
    roomStatsLines: stats.length,
    tickMs: loaded.length
      ? { p50Median: median(tickP50), p95Max: Math.max(...tickP95), maxMs: Math.max(...tickMax) }
      : null,
    cpuPercentOfQuota: cpu.length ? { median: median(cpu), max: Math.max(...cpu) } : null,
    eventLoopP99MaxMs: elp99.length ? Math.max(...elp99) : null,
    bytesOutPerClientPerS: clientSeconds > 0 ? bytesPer : null,
    rssMB: series("rssMB"),
    heapUsedMB: series("heapUsedMB"),
    counters: (lastLoop?.counters as Record<string, number> | undefined) ?? null,
    lastSpikeLoop: lastLoop,
  };
}

export interface BotSummary {
  readonly bots: number;
  readonly elapsedS: number;
  readonly snapshotHzTarget: number;
  readonly snapshotHzAchievedPerBot: number;
  readonly frameInterArrivalMs: Percentiles;
  readonly rttMs: Percentiles;
  readonly bytesInPerBotPerS: Readonly<Record<string, number>>;
  readonly bytesInPerBotPerSTotal: number;
  readonly inputsSent: number;
  readonly inputMessages: number;
  readonly skippedSends: number;
  readonly resyncs: number;
  readonly joins: number;
  readonly disconnects: number;
  readonly unexpectedDrops: number;
  readonly reconnects: number;
  readonly serverBufferDepth: Percentiles;
  readonly botProcessHeapGrowthMB: number;
}

export function summarizeBots(
  all: readonly BotMetrics[],
  elapsedS: number,
  snapshotHzTarget: number,
  reconnects: number,
  heapGrowthMB: number,
): BotSummary {
  const n = all.length;
  const sum = (f: (m: BotMetrics) => number) => all.reduce((a, m) => a + f(m), 0);
  const per = (v: number) => Math.round(v / n / elapsedS);
  const byType = {
    FRAME: per(sum((m) => m.bytes.frame)),
    DUST: per(sum((m) => m.bytes.dust)),
    PONG: per(sum((m) => m.bytes.pong)),
    statePatch: per(sum((m) => m.bytes.statePatch)),
    stateFull: per(sum((m) => m.bytes.stateFull)),
    other: per(sum((m) => m.bytes.other)),
  };
  return {
    bots: n,
    elapsedS: Math.round(elapsedS),
    snapshotHzTarget,
    snapshotHzAchievedPerBot: round(sum((m) => m.frames) / n / elapsedS, 2),
    frameInterArrivalMs: percentiles(all.flatMap((m) => m.frameGapsMs)),
    rttMs: percentiles(all.flatMap((m) => m.rttMs)),
    bytesInPerBotPerS: byType,
    bytesInPerBotPerSTotal: Object.values(byType).reduce((a, b) => a + b, 0),
    inputsSent: sum((m) => m.inputsSent),
    inputMessages: sum((m) => m.inputMessages),
    skippedSends: sum((m) => m.skippedSends),
    resyncs: sum((m) => m.resyncs),
    joins: sum((m) => m.joins),
    disconnects: sum((m) => m.disconnects),
    unexpectedDrops: sum((m) => m.unexpectedDrops),
    reconnects,
    serverBufferDepth: percentiles(all.flatMap((m) => m.depthSamples)),
    botProcessHeapGrowthMB: round(heapGrowthMB, 1),
  };
}

export interface ReportMeta {
  readonly scenario: string;
  readonly milestone: string;
  readonly url: string;
  readonly profile: string;
  readonly seed: number;
  readonly tickHz: number;
  readonly snapshotHz: number;
  readonly startedAt: string;
  readonly durationS: number;
  readonly node: string;
}

export interface BotReport {
  readonly meta: ReportMeta;
  readonly bots: BotSummary;
  readonly server: ServerLogSummary | null;
  readonly netsim: Record<string, number> | null;
  /** Spike clients carry no simulated world state, so desync is not measurable here (arrives with the real sim). */
  readonly desync: { readonly count: number | null; readonly note: string };
  readonly rejectedInputs: {
    readonly late: number | null;
    readonly rateLimited: number | null;
    readonly malformed: number | null;
    readonly substituted: number | null;
  };
}

export function buildReport(
  meta: ReportMeta,
  bots: BotSummary,
  server: ServerLogSummary | null,
  netsim: Record<string, number> | null,
): BotReport {
  const c = server?.counters ?? null;
  return {
    meta,
    bots,
    server,
    netsim,
    desync: {
      count: null,
      note: "n/a in spike: synthetic world has no client prediction to compare (arrives with M1 sim)",
    },
    rejectedInputs: {
      late: c?.inputsLate ?? null,
      rateLimited: c?.rateLimited ?? null,
      malformed: c?.malformed ?? null,
      substituted: c?.inputsSubstituted ?? null,
    },
  };
}

const kb = (b: number): string => `${(b / 1000).toFixed(2)} KB/s`;
const f = (v: number | null | undefined, unit = ""): string => (v === null || v === undefined ? "n/a" : `${v}${unit}`);

export function renderMarkdown(r: BotReport): string {
  const { meta: m, bots: b, server: s } = r;
  const out: string[] = [];
  out.push(`# ${m.scenario}: ${b.bots} bots, ${b.elapsedS} s, profile ${m.profile}`);
  out.push("");
  out.push(
    `Target ${m.url}, seed ${m.seed}, ${m.tickHz}/${m.snapshotHz} Hz, Node ${m.node}, started ${m.startedAt}. Milestone ${m.milestone}.`,
  );
  out.push("");
  out.push("| Metric | Value |");
  out.push("| --- | --- |");
  out.push(`| Snapshot rate achieved per bot | ${b.snapshotHzAchievedPerBot} Hz (target ${b.snapshotHzTarget}) |`);
  out.push(
    `| Frame inter-arrival p50 / p95 / max | ${b.frameInterArrivalMs.p50} / ${b.frameInterArrivalMs.p95} / ${b.frameInterArrivalMs.max} ms |`,
  );
  out.push(`| RTT p50 / p95 / max (bot ping) | ${b.rttMs.p50} / ${b.rttMs.p95} / ${b.rttMs.max} ms (n=${b.rttMs.n}) |`);
  out.push(
    `| Server tick p50 / p95 / max | ${s?.tickMs ? `${s.tickMs.p50Median} / ${s.tickMs.p95Max} / ${s.tickMs.maxMs} ms` : "n/a (no server log)"} |`,
  );
  out.push(
    `| CPU % of 0.1 quota median / max | ${s?.cpuPercentOfQuota ? `${s.cpuPercentOfQuota.median} / ${s.cpuPercentOfQuota.max}` : "n/a"} |`,
  );
  out.push(`| Event-loop p99 max | ${f(s?.eventLoopP99MaxMs, " ms")} |`);
  out.push(`| Bytes in per bot per s (client side) | ${kb(b.bytesInPerBotPerSTotal)} |`);
  for (const [k, v] of Object.entries(b.bytesInPerBotPerS)) out.push(`| - ${k} | ${kb(v)} |`);
  if (s?.bytesOutPerClientPerS) {
    out.push(
      `| Server bytes out per client per s by type | ${Object.entries(s.bytesOutPerClientPerS)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")} B/s |`,
    );
  }
  out.push(
    `| Inputs sent / messages / skipped sends / resyncs | ${b.inputsSent} / ${b.inputMessages} / ${b.skippedSends} / ${b.resyncs} |`,
  );
  out.push(
    `| Server input buffer depth p50 / p95 / max | ${b.serverBufferDepth.p50} / ${b.serverBufferDepth.p95} / ${b.serverBufferDepth.max} |`,
  );
  out.push(
    `| Rejected inputs (late / rate-limited / malformed); substituted | ${f(r.rejectedInputs.late)} / ${f(r.rejectedInputs.rateLimited)} / ${f(r.rejectedInputs.malformed)}; ${f(r.rejectedInputs.substituted)} |`,
  );
  out.push(
    `| Joins / disconnects / unexpected drops / scripted reconnects | ${b.joins} / ${b.disconnects} / ${b.unexpectedDrops} / ${b.reconnects} |`,
  );
  out.push(`| Desync count | ${r.desync.count === null ? "n/a" : r.desync.count} (${r.desync.note}) |`);
  out.push(
    `| Server RSS first to last | ${s?.rssMB ? `${s.rssMB.first} to ${s.rssMB.last} MB (growth ${s.rssMB.growth})` : "n/a"} |`,
  );
  out.push(
    `| Server heap first to last | ${s?.heapUsedMB ? `${s.heapUsedMB.first} to ${s.heapUsedMB.last} MB (growth ${s.heapUsedMB.growth})` : "n/a"} |`,
  );
  out.push(`| Bot process heap growth | ${b.botProcessHeapGrowthMB} MB |`);
  if (r.netsim)
    out.push(
      `| Netsim | ${Object.entries(r.netsim)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")} |`,
    );
  out.push("");
  return out.join("\n");
}
