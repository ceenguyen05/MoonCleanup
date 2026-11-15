// Post-deploy smoke (HOSTING_GUIDE section 5). One command against a deployed (or local) server: health, readiness,
// CORS, CSP, guest join over the production path (POST /v0/hello/join -> HelloRoom, the only room a NET_SPIKE=0 server
// has today), a hold period with live PING/PONG and Schema patches, then a forced leave + rejoin. Prints PASS/FAIL per
// check with next steps for Cee. No credentials, no internet beyond the two URLs given.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client, type Room } from "@colyseus/sdk";
import { MESSAGE_CATALOG, PROTOCOL_VERSION } from "@moon-cleanup/shared";
import { PING_BODY_BYTES, readPongBody, rttFromPong, writePingBody } from "@moon-cleanup/protocol";
import { capSessionReconnection } from "../clients/retry";
import {
  corsAllows,
  cspAllowsServer,
  overallPass,
  renderConsoleLine,
  renderMarkdown,
  type CheckResult,
  type CheckStatus,
} from "./analysis";

export interface SmokeOptions {
  readonly serverUrl: string;
  readonly clientOrigin: string;
  readonly bots: number;
  readonly holdS: number;
  /** Max seconds to wait for a cold server to answer /healthz. */
  readonly wakeMaxS: number;
  /** Max seconds to wait for /readyz to turn 200 after /healthz (free Postgres may also be waking). */
  readonly readyMaxS: number;
  readonly expectEnv?: string;
  readonly outDir: string;
  readonly milestone: string;
  readonly log?: (line: string) => void;
}

const HELLO_JOIN_PATH = "/v0/hello/join";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type SdkRoom = Room<unknown, unknown>;

interface SmokeBot {
  readonly index: number;
  room: SdkRoom | undefined;
  hello: { serverProtocol?: number; serverBuild?: string } | undefined;
  patches: number;
  pongs: number;
  rtt: number[];
  closedUnexpectedly: boolean;
  leaving: boolean;
}

function players(bot: SmokeBot): number {
  const s = bot.room?.state as { players?: number } | undefined;
  return typeof s?.players === "number" ? s.players : -1;
}

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(100);
  }
  return cond();
}

function explainFetchError(e: unknown): string {
  if (!(e instanceof Error)) {
    // The SDK rejects a refused WebSocket upgrade with a bare close event ({ code, reason }), not an Error.
    const o = e as { code?: number; reason?: string; message?: string } | null;
    if (o !== null && typeof o === "object" && (o.code !== undefined || o.message)) {
      return `WebSocket closed code ${o.code ?? "?"} ${o.reason ?? o.message ?? ""}`.trim();
    }
    return String(e);
  }
  if (e.message === "") {
    const code = (e as { code?: unknown }).code;
    return `WebSocket closed before the room opened (${e.name}, code ${String(code ?? "unknown")}; typical of a refused origin, 1006)`;
  }
  const cause = (e as { cause?: { code?: string; message?: string } }).cause;
  return `${e.message}${cause ? ` (${cause.code ?? cause.message})` : ""}`;
}

export async function runSmoke(o: SmokeOptions): Promise<{ results: CheckResult[]; jsonPath: string; mdPath: string }> {
  const log = o.log ?? ((l: string) => console.log(l));
  const serverUrl = o.serverUrl.replace(/\/+$/, "");
  const origin = new URL(o.clientOrigin).origin;
  const results: CheckResult[] = [];
  const startedAt = new Date();
  const record = async (
    name: string,
    fn: () => Promise<{ status: CheckStatus; detail: string; next?: string }>,
  ): Promise<CheckResult> => {
    const t0 = performance.now();
    let r: { status: CheckStatus; detail: string; next?: string };
    try {
      r = await fn();
    } catch (e) {
      r = { status: "FAIL", detail: `unexpected error: ${explainFetchError(e)}` };
    }
    const result: CheckResult = { name, ms: Math.round(performance.now() - t0), ...r };
    results.push(result);
    log(renderConsoleLine(result));
    return result;
  };

  // 1. /healthz, tolerating a Render cold start.
  const health = await record("healthz (liveness, cold start)", async () => {
    const t0 = Date.now();
    let lastErr = "";
    let announced = false;
    while (Date.now() - t0 < o.wakeMaxS * 1000) {
      try {
        const res = await fetch(`${serverUrl}/healthz`, { signal: AbortSignal.timeout(15_000) });
        if (res.status === 200) {
          const body = (await res.json()) as {
            ok?: boolean;
            env?: string;
            build?: string;
            protocolVersion?: number;
            uptimeS?: number;
          };
          const waited = Math.round((Date.now() - t0) / 1000);
          const detail = `200 env=${body.env} build=${body.build} protocol=${body.protocolVersion} uptime=${body.uptimeS}s answered after ${waited}s`;
          if (body.ok !== true) return { status: "FAIL", detail: `ok is not true: ${JSON.stringify(body)}` };
          if (body.protocolVersion !== PROTOCOL_VERSION) {
            return {
              status: "FAIL",
              detail: `${detail}; this tool speaks protocol ${PROTOCOL_VERSION}`,
              next: "The deployed server and this checkout are different versions. Redeploy Render from the same main commit you are testing (Manual Deploy), then rerun.",
            };
          }
          if (o.expectEnv !== undefined && body.env !== o.expectEnv) {
            return {
              status: "FAIL",
              detail: `${detail}; expected env=${o.expectEnv}`,
              next: `Render ENV_NAME is "${body.env}". For the real deploy it must be "production" (and NET_SPIKE=0, PERSISTENCE_DRIVER=postgres). Fix it in Render -> Environment and redeploy.`,
            };
          }
          return { status: "PASS", detail };
        }
        lastErr = `HTTP ${res.status}`;
      } catch (e) {
        lastErr = explainFetchError(e);
      }
      const elapsed = Math.round((Date.now() - t0) / 1000);
      if (!announced)
        log(
          "      ...server is waking (Render Free sleeps after 15 min idle; a cold start takes about 1 minute). Waiting.",
        );
      announced = true;
      log(`      ...still waking after ${elapsed}s (${lastErr})`);
      await sleep(5000);
    }
    return {
      status: "FAIL",
      detail: `no 200 from /healthz within ${o.wakeMaxS}s (${lastErr})`,
      next: "Check the URL (https://<service>.onrender.com, no trailing path). In Render open the service -> Logs: if the deploy failed, read the last error (usually an env var rejected at boot, such as JWT_SECRET, DATABASE_URL or ALLOWED_ORIGINS). If the deploy is still building, wait and rerun.",
    };
  });

  if (health.status === "FAIL" && /no 200|HTTP|fetch|ENOTFOUND|ECONN/.test(health.detail)) {
    return finish();
  }

  // 2. /readyz
  await record("readyz (database, admission)", async () => {
    const t0 = Date.now();
    let last = "";
    while (Date.now() - t0 < o.readyMaxS * 1000) {
      const res = await fetch(`${serverUrl}/readyz`, { signal: AbortSignal.timeout(20_000) });
      const body = (await res.json().catch(() => ({}))) as {
        ready?: boolean;
        dbState?: string;
        schema?: string | null;
        draining?: boolean;
        admitting?: boolean;
        rooms?: number;
      };
      last = `HTTP ${res.status} ready=${body.ready} dbState=${body.dbState} schema=${body.schema} admitting=${body.admitting} draining=${body.draining}`;
      if (res.status === 200 && body.ready === true) return { status: "PASS", detail: last };
      if (body.dbState === "not-configured" || body.dbState === "error" || body.draining === true) break;
      await sleep(3000); // powered-off Neon wakes in a few seconds; keep polling inside readyMaxS
    }
    const db = /dbState=(\S+)/.exec(last)?.[1];
    const next =
      db === "powered-off" || db === "up"
        ? "The Neon database is still waking or the server is full/draining. Wait 30 s and rerun; if it persists open the Render logs."
        : db === "not-configured"
          ? "The server has no database. In Render -> Environment set DATABASE_URL to the Neon DIRECT connection string (not the pooled one) and PERSISTENCE_DRIVER=postgres, then redeploy."
          : "The server cannot reach Neon. Check DATABASE_URL (direct connection string, includes ?sslmode=require), that the Neon project is not suspended or deleted, and the Render logs for the exact database error.";
    return { status: "FAIL", detail: last, next };
  });

  // 3. CORS: preflight for the join route from the client origin, and a foreign origin must not be echoed.
  await record("CORS (ALLOWED_ORIGINS)", async () => {
    const res = await fetch(`${serverUrl}${HELLO_JOIN_PATH}`, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!corsAllows(res.headers, origin)) {
      return {
        status: "FAIL",
        detail: `preflight from ${origin} got HTTP ${res.status}, allow-origin=${res.headers.get("access-control-allow-origin")}`,
        next: `The server does not allow ${origin}. In Render -> Environment set ALLOWED_ORIGINS to exactly ${origin} (scheme included, no trailing slash, comma-separated for several), also in render.yaml, then redeploy. Browsers and WebSockets are refused until this matches.`,
      };
    }
    const foreign = await fetch(`${serverUrl}${HELLO_JOIN_PATH}`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
      signal: AbortSignal.timeout(15_000),
    });
    if (corsAllows(foreign.headers, "https://evil.example")) {
      return {
        status: "FAIL",
        detail: "a foreign origin was also allowed (allow-origin echoed or *)",
        next: "ALLOWED_ORIGINS is too broad (wildcard?). Set it to only the Vercel production origin.",
      };
    }
    return { status: "PASS", detail: `preflight allows ${origin}; foreign origin refused` };
  });

  // 4. CSP of the deployed page lets the browser reach the server.
  await record("CSP (Vercel connect-src)", async () => {
    let res: Response;
    try {
      res = await fetch(`${origin}/`, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
    } catch (e) {
      return {
        status: "FAIL",
        detail: `cannot load ${origin}/: ${explainFetchError(e)}`,
        next: "Open the client origin in a browser. If Vercel shows an error, check the Vercel deployment status; if the origin is mistyped, rerun with the exact Production URL.",
      };
    }
    if (res.status >= 400) {
      return {
        status: "FAIL",
        detail: `${origin}/ answered HTTP ${res.status}`,
        next: "The Vercel site is not serving. Check the deployment in Vercel (build failed? Deployment Protection / password enabled?). Protection must be off for the public Production URL.",
      };
    }
    const csp = res.headers.get("content-security-policy");
    const v = cspAllowsServer(csp, serverUrl, origin);
    if (!v.hasCsp) return { status: "SKIP", detail: "page sends no Content-Security-Policy header (nothing to block)" };
    if (v.https && v.wss)
      return { status: "PASS", detail: `connect-src allows https and wss to ${new URL(serverUrl).host}` };
    return {
      status: "FAIL",
      detail: `connect-src "${v.connectSrc}" blocks ${v.https ? "" : "https "}${v.wss ? "" : "wss"} to ${new URL(serverUrl).host}`,
      next: "The browser would block calls to the server (console shows a CSP violation). Add the server host to connect-src in vercel.json (https://<service>.onrender.com and wss://<service>.onrender.com; the wildcard *.onrender.com covers the default name, a custom domain does not), then redeploy Vercel.",
    };
  });

  // 5. Join a room with N bots over the production REST path.
  const bots: SmokeBot[] = Array.from({ length: o.bots }, (_, index) => ({
    index,
    room: undefined,
    hello: undefined,
    patches: 0,
    pongs: 0,
    rtt: [],
    closedUnexpectedly: false,
    leaving: false,
  }));
  const pingBuf = new Uint8Array(PING_BODY_BYTES);

  const joinBot = async (bot: SmokeBot): Promise<void> => {
    const res = await fetch(`${serverUrl}${HELLO_JOIN_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "smoke-v0" }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status !== 200) throw new Error(`join route answered ${res.status} ${await res.text()}`);
    const { reservation } = (await res.json()) as { reservation: Parameters<Client["consumeSeatReservation"]>[0] };
    const client = new Client(serverUrl);
    client.http.options.headers = { Origin: origin };
    const room = (await client.consumeSeatReservation(reservation)) as SdkRoom;
    capSessionReconnection(room.reconnection);
    bot.room = room;
    bot.hello = undefined;
    bot.leaving = false;
    bot.closedUnexpectedly = false;
    room.onMessage(MESSAGE_CATALOG.HELLO.id, (h: { serverProtocol?: number; serverBuild?: string }) => {
      bot.hello = h;
    });
    room.onMessage(MESSAGE_CATALOG.PONG.id, (b: Uint8Array) => {
      bot.pongs++;
      const pong = { clientTimeMs: 0, serverTick: 0 };
      if (readPongBody(b, pong)) {
        const rtt = rttFromPong(Math.floor(performance.now()), pong.clientTimeMs);
        if (rtt >= 0) bot.rtt.push(rtt);
      }
    });
    room.onMessage("*", () => undefined);
    room.onStateChange(() => {
      bot.patches++;
    });
    room.onLeave((code: number) => {
      if (!bot.leaving) {
        bot.closedUnexpectedly = true;
        log(`      bot ${bot.index} connection closed by the server/network (code ${code})`);
      }
      bot.room = undefined;
    });
  };
  const ping = (bot: SmokeBot): void => {
    if (bot.room === undefined) return;
    writePingBody(Math.floor(performance.now()), pingBuf);
    bot.room.sendBytes(MESSAGE_CATALOG.PING.id, pingBuf);
  };

  const joined = await record(`join ${o.bots} guest bots (POST ${HELLO_JOIN_PATH}, wss, HELLO)`, async () => {
    for (const bot of bots) {
      try {
        await joinBot(bot);
      } catch (e) {
        const msg = explainFetchError(e);
        const next = /429|RATE_LIMITED/.test(msg)
          ? "The server rate-limited the join. Wait a minute and rerun; if it recurs every time check that CLIENT_IP_HEADER=true-client-ip is set on Render (a blank value puts every user in one shared bucket)."
          : /1006|403|origin|WebSocket/i.test(msg)
            ? `The WebSocket upgrade was refused. Most likely ALLOWED_ORIGINS on Render does not equal ${origin} exactly. Fix it and redeploy.`
            : /503|CAPACITY|FULL/i.test(msg)
              ? "The server is at capacity or draining (MAX_ROOMS / MAX_CLIENTS). Wait, or check Render logs for a restart in progress."
              : /404/.test(msg)
                ? `The join route ${HELLO_JOIN_PATH} does not exist on this server. Is the Render service running this repo's apps/server build? Check the build id in /healthz.`
                : "Open the Render logs while rerunning; the join error is logged there with the reason.";
        return { status: "FAIL", detail: `bot ${bot.index}: ${msg}`, next };
      }
    }
    const gotHello = await waitFor(() => bots.every((b) => b.hello !== undefined), 15_000);
    if (!gotHello) {
      return {
        status: "FAIL",
        detail: `HELLO not received by bots ${bots
          .filter((b) => b.hello === undefined)
          .map((b) => b.index)
          .join(",")} within 15 s`,
        next: "Sockets open but the room is not talking. Check Render logs for room errors; a protocol-version close (4100) means client and server builds differ.",
      };
    }
    const mismatch = bots.find((b) => b.hello?.serverProtocol !== PROTOCOL_VERSION);
    if (mismatch !== undefined) {
      return {
        status: "FAIL",
        detail: `HELLO protocol ${mismatch.hello?.serverProtocol} != ${PROTOCOL_VERSION}`,
        next: "Redeploy Render from the commit you are testing.",
      };
    }
    const sawAll = await waitFor(() => bots.every((b) => players(b) === o.bots), 10_000);
    const counts = bots.map(players).join(",");
    if (!sawAll) {
      return {
        status: "FAIL",
        detail: `bots did not all end up in one room seeing ${o.bots} players (state.players per bot: ${counts})`,
        next: "Bots landed in different rooms or Schema state is not reaching clients. Check Render logs (room-stats lines) and MAX_ROOMS.",
      };
    }
    return {
      status: "PASS",
      detail: `${o.bots} bots in one room, build ${bots[0]?.hello?.serverBuild}, state.players=${o.bots} on every bot`,
    };
  });

  if (joined.status === "FAIL") {
    await Promise.all(
      bots.map(async (b) => {
        b.leaving = true;
        await b.room?.leave().catch(() => undefined);
      }),
    );
    return finish();
  }

  // 6. Hold: pings every 2 s, watch patches and connections.
  await record(`hold ${o.holdS}s (stay connected, PONG replies, state patches)`, async () => {
    const t0 = Date.now();
    const baseline = bots.map((b) => b.patches);
    const basePongs = bots.map((b) => b.pongs);
    let nextReport = 10_000;
    let sent = 0;
    while (Date.now() - t0 < o.holdS * 1000) {
      for (const b of bots) ping(b);
      sent++;
      await sleep(2000);
      const el = Date.now() - t0;
      if (el >= nextReport) {
        nextReport += 10_000;
        log(
          `      ...${Math.round(el / 1000)}s / ${o.holdS}s, connected ${bots.filter((b) => b.room !== undefined).length}/${o.bots}`,
        );
      }
    }
    await sleep(500);
    const dropped = bots.filter((b) => b.closedUnexpectedly || b.room === undefined);
    const pongsGot = bots.map((b, i) => b.pongs - (basePongs[i] ?? 0));
    const minPongs = Math.min(...pongsGot);
    const rtts = bots.flatMap((b) => b.rtt).sort((a, b) => a - b);
    const p50 = rtts[Math.floor(rtts.length * 0.5)] ?? -1;
    const p95 = rtts[Math.floor(rtts.length * 0.95)] ?? -1;
    const detail = `connected ${bots.length - dropped.length}/${o.bots}, pongs ${minPongs}/${sent} min per bot, rtt p50 ${p50} ms p95 ${p95} ms`;
    if (dropped.length > 0) {
      return {
        status: "FAIL",
        detail: `${detail}; dropped bots ${dropped.map((b) => b.index).join(",")}`,
        next: "Connections were cut during the hold. On Render Free this can be a restart or redeploy (check Events/Logs for 'Instance failed' or out-of-memory). A cut after about 10 s of silence points at the idle watch; after 15 min at a platform timeout.",
      };
    }
    if (minPongs < sent * 0.8) {
      return {
        status: "FAIL",
        detail: `${detail}; PONG replies are being lost`,
        next: "The socket is up but replies are missing or very late. Check Render CPU/memory in Metrics and the logs for rate-limit lines.",
      };
    }
    const patchesGot = bots.map((b, i) => b.patches - (baseline[i] ?? 0));
    const sawPatches = patchesGot.some((n) => n > 0);
    // HelloRoom only patches when state changes (players count), so zero patches during a quiet hold is normal.
    return {
      status: "PASS",
      detail: `${detail}; state patches during hold ${patchesGot.join(",")}${sawPatches ? "" : " (none expected while nobody joins)"}`,
    };
  });

  // 7. Forced reconnect: bot 0 leaves and rejoins with a fresh seat; the room sees the count dip and recover.
  await record("reconnect (leave and rejoin, room recovers)", async () => {
    const victim = bots[0] as SmokeBot;
    const observer = bots[bots.length - 1] as SmokeBot;
    victim.leaving = true;
    await victim.room?.leave().catch(() => undefined);
    victim.room = undefined;
    const dipped = await waitFor(() => players(observer) === o.bots - 1, 10_000);
    const t0 = performance.now();
    await joinBot(victim);
    const gotHello = await waitFor(() => victim.hello !== undefined, 15_000);
    const recovered = await waitFor(() => bots.every((b) => players(b) === o.bots), 10_000);
    const ms = Math.round(performance.now() - t0);
    ping(victim);
    const ponged = await waitFor(() => victim.pongs > 0 && victim.rtt.length > 0, 5000);
    if (!gotHello || !recovered || !ponged) {
      return {
        status: "FAIL",
        detail: `rejoin took ${ms} ms: hello=${gotHello} count recovered=${recovered} pong=${ponged}; players seen by observer: ${players(observer)}`,
        next: "Rejoin did not fully resume. Check Render logs for the rejoin request (rate limit 429, capacity, or room closed). If you tested a single bot server restart, the room is gone and a fresh join is expected.",
      };
    }
    return {
      status: dipped ? "PASS" : "WARN",
      detail: `rejoined in ${ms} ms, count back to ${o.bots}, pong ok${dipped ? "" : " (observer did not see the dip)"}`,
    };
  });

  // Cleanup.
  await Promise.all(
    bots.map(async (b) => {
      b.leaving = true;
      await b.room?.leave().catch(() => undefined);
    }),
  );
  return finish();

  async function finish(): Promise<{ results: CheckResult[]; jsonPath: string; mdPath: string }> {
    const durationS = (Date.now() - startedAt.getTime()) / 1000;
    const dir = path.resolve(o.outDir, o.milestone);
    await mkdir(dir, { recursive: true });
    const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
    const jsonPath = path.join(dir, `smoke-deploy-${stamp}.json`);
    const mdPath = path.join(dir, `smoke-deploy-${stamp}.md`);
    const meta = { serverUrl, clientOrigin: origin, startedAt: startedAt.toISOString(), durationS };
    await writeFile(jsonPath, JSON.stringify({ ...meta, pass: overallPass(results), results }, null, 2));
    await writeFile(mdPath, renderMarkdown(meta, results));
    log("");
    log(
      `RESULT: ${overallPass(results) ? "PASS" : "FAIL"} (${results.filter((r) => r.status === "PASS").length} pass, ${results.filter((r) => r.status === "FAIL").length} fail, ${results.filter((r) => r.status === "SKIP" || r.status === "WARN").length} skip/warn) in ${durationS.toFixed(0)} s`,
    );
    log(`Report: ${mdPath}`);
    return { results, jsonPath, mdPath };
  }
}
