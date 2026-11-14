// Local measurement harness for the netcode spike (M0-W2-T03). Dev tool only; not part of the server bundle.
// Run each role in its own process so client CPU never counts against the server's process CPU:
//
//   tsx src/net/spike/run-spike.ts server  --port 2570 --duration 130
//   tsx src/net/spike/run-spike.ts clients --port 2570 --duration 120 --clients 6 --tick 20 --snap 10
//   node --expose-gc --import tsx src/net/spike/run-spike.ts bench --tick 20 --snap 10 --ticks 20000
//
// server : createGameServer with LoadTestRoom (as NET_SPIKE=1 would), the ops StatsReporter printing room-stats lines
//          every 10 s, plus a `spike-loop` line per room (tick lateness, overruns, socket writes) and GC pauses.
// clients: N SDK clients join one room over REST, send SPIKE_INPUT at tickHz (moving, cleaning), PING every 2 s,
//          poll /healthz every 1 s; prints a JSON summary (frame inter-arrival, RTT, /healthz latency, bytes).
// bench  : SpikeEngine alone with 6 busy seats: us/tick and GC/heap growth over N ticks (allocation check).
//
// For the bots, netsim and the 10-minute spike-16 scenario see M0-W2-T04 (tools/bots); this harness only proves
// the room locally.

import { PerformanceObserver, constants as perfConstants } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { matchMaker } from "@colyseus/core";
import { MESSAGE_CATALOG, PROTOCOL_VERSION } from "@moon-cleanup/shared";
import {
  PING_BODY_BYTES,
  SPIKE_BUTTON_TOOL_PRIMARY,
  SPIKE_DUST_ID,
  SPIKE_FRAME_ID,
  createSpikeFrameHeader,
  createSpikeInput,
  readPongBody,
  readSpikeFrameHeader,
  rttFromPong,
  writePingBody,
  writeSpikeInputBody,
} from "@moon-cleanup/protocol";
import { StatsReporter, createLogger, createNodeProcessProbe } from "../../ops";
import { createGameServer } from "../game-server";
import { LOAD_TEST_ROOM_NAME, type LoadTestRoom } from "./load-test-room";
import { SpikeRoomOptionsSchema } from "./options";
import { SpikeEngine } from "./spike-engine";
import { SPIKE_JOIN_PATH, type SpikeJoinResponse } from "./spike-join-route";

const ORIGIN = "http://localhost:5177";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", default: "2570" },
    duration: { type: "string", default: "60" },
    clients: { type: "string", default: "6" },
    tick: { type: "string", default: "20" },
    snap: { type: "string", default: "10" },
    ticks: { type: "string", default: "20000" },
  },
});
const role = positionals[0] ?? "server";
const port = Number(values.port);
const durationS = Number(values.duration);

function percentiles(samples: number[]): { n: number; p50: number; p95: number; p99: number; max: number } {
  const s = [...samples].sort((a, b) => a - b);
  const at = (p: number) => (s.length === 0 ? 0 : (s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] ?? 0));
  const r = (v: number) => Math.round(v * 100) / 100;
  return { n: s.length, p50: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), max: r(s.at(-1) ?? 0) };
}

function observeGc(): { pauses: number[]; reset(): number[] } {
  const pauses: number[] = [];
  const obs = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const kind = (entry as unknown as { detail?: { kind?: number } }).detail?.kind;
      if (kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR) pauses.push(-entry.duration);
      else pauses.push(entry.duration);
    }
  });
  obs.observe({ entryTypes: ["gc"] });
  return {
    pauses,
    reset() {
      return pauses.splice(0, pauses.length);
    },
  };
}

async function runServer(): Promise<void> {
  // nodeEnv production = JSON lines (no pino-pretty), so the numbers are machine-readable.
  const logger = createLogger({ level: "info", nodeEnv: "production", envName: "local", buildVersion: "spike" });
  const probe = createNodeProcessProbe();
  const stats = new StatsReporter({ logger, probe, netSpike: true });
  const roomIds = new Set<string>();
  const statsSink = {
    addRoom(roomId: string) {
      roomIds.add(roomId);
      return stats.addRoom(roomId);
    },
    removeRoom(roomId: string) {
      roomIds.delete(roomId);
      stats.removeRoom(roomId);
    },
  };
  const gc = observeGc();
  const server = await createGameServer({
    port,
    routes: [{ method: "GET", path: "/healthz", handle: () => ({ status: 200, body: { ok: true } }) }],
    allowedOrigins: [ORIGIN],
    logger,
    rates: { simTickHz: 20, snapshotHz: 10 },
    serverBuild: "spike",
    helloRoom: false,
    loadTest: { enabled: true, stats: statsSink },
  });
  await server.listen();
  stats.start();
  const loop = setInterval(() => {
    for (const roomId of roomIds) {
      const room = matchMaker.getLocalRoomById(roomId) as unknown as LoadTestRoom | undefined;
      if (room?.roomName !== LOAD_TEST_ROOM_NAME) continue;
      const gcPauses = gc.reset();
      const minor = gcPauses.filter((p) => p >= 0);
      const major = gcPauses.filter((p) => p < 0).map((p) => -p);
      logger.info(
        {
          kind: "spike-loop",
          roomId: room.roomId,
          clients: room.engine.activeSeats,
          heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1e5) / 10,
          rssMB: Math.round(process.memoryUsage().rss / 1e5) / 10,
          gcMinor: { count: minor.length, maxMs: Math.round(Math.max(0, ...minor) * 100) / 100 },
          gcMajor: { count: major.length, maxMs: Math.round(Math.max(0, ...major) * 100) / 100 },
          counters: room.engine.counters,
          ...room.loopTimingsAndReset(),
        },
        "spike loop",
      );
    }
  }, 10_000);
  loop.unref();
  setTimeout(() => {
    clearInterval(loop);
    stats.emitRooms();
    stats.stop();
    void server.gracefullyShutdown().then(() => {
      probe.dispose();
      process.exit(0);
    });
  }, durationS * 1000);
}

async function runClients(): Promise<void> {
  const { ColyseusTestServer } = await import("@colyseus/testing");
  const tickHz = Number(values.tick);
  const snapshotHz = Number(values.snap);
  const count = Number(values.clients);
  const base = `http://127.0.0.1:${port}`;
  const sdkHost = new ColyseusTestServer({ port } as never);
  sdkHost.sdk.http.options.headers = { Origin: ORIGIN };

  const frameGaps: number[] = [];
  const rtts: number[] = [];
  const health: number[] = [];
  const bytes = { frame: 0, dust: 0, pong: 0 };
  let frames = 0;
  let disconnects = 0;
  type SdkRoom = Awaited<ReturnType<typeof sdkHost.sdk.consumeSeatReservation>>;
  const rooms: SdkRoom[] = [];
  for (let i = 0; i < count; i++) {
    const res = await fetch(`${base}${SPIKE_JOIN_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, clientBuild: "spike-bot", tickHz, snapshotHz }),
    });
    if (res.status !== 200) throw new Error(`join failed: ${res.status} ${await res.text()}`);
    const { reservation } = (await res.json()) as SpikeJoinResponse;
    const room = await sdkHost.sdk.consumeSeatReservation(reservation);
    let lastFrameAt = 0;
    const header = createSpikeFrameHeader();
    const pong = { clientTimeMs: 0, serverTick: 0 };
    room.onMessage(SPIKE_FRAME_ID, (b: Uint8Array) => {
      const now = performance.now();
      if (lastFrameAt > 0 && i === 0) frameGaps.push(now - lastFrameAt);
      lastFrameAt = now;
      frames++;
      bytes.frame += b.byteLength;
      readSpikeFrameHeader(b, header);
    });
    room.onMessage(SPIKE_DUST_ID, (b: Uint8Array) => (bytes.dust += b.byteLength));
    room.onMessage(MESSAGE_CATALOG.PONG.id, (b: Uint8Array) => {
      bytes.pong += b.byteLength;
      if (readPongBody(b, pong)) {
        const rtt = rttFromPong(Math.floor(performance.now()), pong.clientTimeMs);
        if (rtt >= 0) rtts.push(rtt);
      }
    });
    room.onMessage("*", () => undefined);
    room.onLeave(() => disconnects++);
    rooms.push(room);
  }

  const input = createSpikeInput();
  const inputBuf = new Uint8Array(32);
  const pingBuf = new Uint8Array(PING_BODY_BYTES);
  let seq = 0;
  let t = 0;
  const sendInputs = setInterval(() => {
    seq = (seq + 1) & 0xffff;
    t++;
    rooms.forEach((room, i) => {
      input.seq = seq;
      input.moveX = Math.round(Math.sin(t / 40 + i) * 60);
      input.moveY = 127;
      input.yaw = (t * 200 + i * 10_000) & 0xffff;
      input.buttons = SPIKE_BUTTON_TOOL_PRIMARY;
      const n = writeSpikeInputBody([input], 1, inputBuf);
      room.sendBytes(MESSAGE_CATALOG.SPIKE_INPUT.id, inputBuf.subarray(0, n));
    });
  }, 1000 / tickHz);
  const sendPings = setInterval(() => {
    for (const room of rooms) {
      writePingBody(Math.floor(performance.now()), pingBuf);
      room.sendBytes(MESSAGE_CATALOG.PING.id, pingBuf);
    }
  }, 2000);
  const pollHealth = setInterval(() => {
    const start = performance.now();
    void fetch(`${base}/healthz`).then(async (r) => {
      await r.arrayBuffer();
      if (r.status === 200) health.push(performance.now() - start);
    });
  }, 1000);

  const startedAt = performance.now();
  await new Promise((r) => setTimeout(r, durationS * 1000));
  clearInterval(sendInputs);
  clearInterval(sendPings);
  clearInterval(pollHealth);
  const elapsedS = (performance.now() - startedAt) / 1000;
  await Promise.all(rooms.map((room) => room.leave()));
  const perClient = (n: number) => Math.round(n / count / elapsedS);
  console.log(
    JSON.stringify({
      kind: "spike-clients",
      tickHz,
      snapshotHz,
      clients: count,
      elapsedS: Math.round(elapsedS),
      framesPerClientPerS: Math.round((frames / count / elapsedS) * 10) / 10,
      frameInterArrivalMs: percentiles(frameGaps),
      rttMs: percentiles(rtts),
      healthzMs: percentiles(health),
      bodyBytesPerClientPerS: {
        frame: perClient(bytes.frame),
        dust: perClient(bytes.dust),
        pong: perClient(bytes.pong),
      },
      disconnects: disconnects - count,
    }),
  );
  process.exit(0);
}

function runBench(): void {
  const options = SpikeRoomOptionsSchema.parse({ tickHz: Number(values.tick), snapshotHz: Number(values.snap) });
  const engine = new SpikeEngine(options, 6);
  for (let s = 0; s < 6; s++) engine.addSeat(0);
  const input = createSpikeInput();
  const buf = new Uint8Array(32);
  const bodies: Uint8Array[] = [];
  for (let k = 0; k < 4096; k++) {
    input.seq = (k + 1) & 0xffff;
    input.moveY = 127;
    input.moveX = (k % 50) - 25;
    input.yaw = (k * 211) & 0xffff;
    input.buttons = SPIKE_BUTTON_TOOL_PRIMARY;
    const n = writeSpikeInputBody([input], 1, buf);
    bodies.push(buf.slice(0, n));
  }
  let sent = 0;
  const sink = {
    frame: (_seat: number, body: Uint8Array) => (sent += body.byteLength),
    dust: (_seat: number, body: Uint8Array) => (sent += body.byteLength),
  };
  const ticks = Number(values.ticks);
  const tickOnce = (i: number) => {
    const b = bodies[i % 4096] as Uint8Array;
    for (let s = 0; s < 6; s++) engine.receiveInput(s, b, i * 50);
    engine.step(sink);
  };
  for (let i = 0; i < 2000; i++) tickOnce(i); // warm-up (JIT, view caches)
  const gcFn = (globalThis as { gc?: () => void }).gc;
  gcFn?.();
  const gc = observeGc();
  const heapBefore = process.memoryUsage().heapUsed;
  sent = 0;
  const start = performance.now();
  for (let i = 2000; i < 2000 + ticks; i++) tickOnce(i);
  const elapsed = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed;
  setTimeout(() => {
    console.log(
      JSON.stringify({
        kind: "spike-bench",
        tickHz: options.tickHz,
        snapshotHz: options.snapshotHz,
        seats: 6,
        ticks,
        usPerTick: Math.round((elapsed / ticks) * 1000 * 10) / 10,
        bodyBytesPerClientPerS: Math.round((sent / 6 / ticks) * options.tickHz),
        heapGrowthBytes: heapAfter - heapBefore,
        heapGrowthBytesPerTick: Math.round(((heapAfter - heapBefore) / ticks) * 100) / 100,
        gcDuringRun: gc.pauses.length,
        gcExposed: gcFn !== undefined,
      }),
    );
  }, 50);
}

if (role === "server") await runServer();
else if (role === "clients") await runClients();
else if (role === "bench") runBench();
else throw new Error(`unknown role ${role}`);
