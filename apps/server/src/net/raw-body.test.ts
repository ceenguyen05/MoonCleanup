// Binary REST seam (api/rest v0.4.0, M1-W5-T07b adapter brief) on BOTH transports: a uWS App with mountHttpRoutes and
// a Node http.Server with createNodeRequestHandler, same routes, same assertions. Covers: exact-limit raw body accepted
// and echoed byte-for-byte (0x00 / 0xff / CRLF), limit + 1 -> 413 (declared and chunked), missing Bearer -> 401 and
// bad content-type -> 400 WITHOUT reading the body (the client never sends it), the in-flight cap (1 per IP, 4 per
// process) -> 503 + retry-after 5, a slow body closed at the read deadline (and its slot released), JSON routes still
// capped at 16 KB, one content-type header, expose-headers on CORS answers.
import "./testing/uws-esm-fix";

import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { API_BINARY_CONTENT_TYPE, CHECKPOINT_UPLOAD_BODY_MAX_BYTES, type HttpRouteDef } from "@moon-cleanup/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOriginPolicy } from "./cors";
import { Admission } from "./admission";
import {
  BODY_READ_TIMEOUT_MS,
  MAX_HTTP_BODY_BYTES,
  RawBodyGate,
  ipSlotKey,
  mountHttpRoutes,
  type NetLogger,
  type RawBodyAuth,
} from "./http-routes";
import { createNodeRequestHandler } from "./node-http";
import { HTTP_REQUEST_TIMEOUT_MS, createWsTransport } from "./ws-transport";

const ORIGIN = "http://localhost:5179";
const LIMIT = CHECKPOINT_UPLOAD_BODY_MAX_BYTES;
const READ_TIMEOUT_MS = 400;
const silent: NetLogger = { info() {}, warn() {}, error() {}, debug() {} };

interface Harness {
  readonly name: string;
  port: number;
  calls: number;
  gate: RawBodyGate;
  close(): Promise<void>;
}

function makeRoutes(h: { calls: number }): HttpRouteDef[] {
  return [
    {
      method: "POST",
      path: "/v1/up/:id",
      rawBodyMaxBytes: LIMIT,
      handle: (req) => {
        h.calls++;
        const raw = req.rawBody ?? new Uint8Array(0);
        // Copy: the handler must not keep the adapter's buffer (it answers with its own bytes).
        return {
          status: 200,
          binary: raw.slice(),
          headers: { "content-type": API_BINARY_CONTENT_TYPE, "x-save-pages": "3" },
          body: { ignored: true },
        };
      },
    },
    {
      method: "POST",
      path: "/v1/json",
      handle: (req) => ({ status: 200, body: { ok: true, hasRaw: req.rawBody !== undefined, body: req.body } }),
    },
  ];
}

const policy = createOriginPolicy([ORIGIN]);
const harnesses: Harness[] = [];

/** Test verifier: `ok-<account>` tokens are valid (the account key is the token), anything else is refused. */
const verifyCalls = { n: 0, lastAddress: "" };
const rawBodyAuth: RawBodyAuth = (token, remoteAddress) => {
  verifyCalls.n++;
  verifyCalls.lastAddress = remoteAddress;
  // `limited-*`: a valid token whose slot-attempt allowance is spent (api admitRawUpload refusal, review R2).
  if (token.startsWith("limited-")) return Promise.resolve({ rateLimited: true as const, retryAfterS: 7.2 });
  return Promise.resolve(token.startsWith("ok-") ? token : null);
};

interface HarnessOptions {
  readonly suffix: string;
  readonly deadlineMs: number;
  readonly minRate: { readonly bytesPerS: number; readonly graceMs: number };
}
/** Main harnesses: the deadline (400 ms) fires before the minimum-rate grace. */
const MAIN: HarnessOptions = {
  suffix: "",
  deadlineMs: READ_TIMEOUT_MS,
  minRate: { bytesPerS: 32 * 1024, graceMs: 2000 },
};
/** Rate harnesses: long deadline, short grace (the trickle rule fires first). */
const RATE_GRACE_MS = 300;
const RATE: HarnessOptions = {
  suffix: "-rate",
  deadlineMs: 10_000,
  minRate: { bytesPerS: 32 * 1024, graceMs: RATE_GRACE_MS },
};

function mountOptions(h: Harness, o: HarnessOptions) {
  return {
    policy,
    clientIpHeader: "true-client-ip",
    logger: silent,
    rawBodyGate: h.gate,
    bodyReadTimeoutMs: o.deadlineMs,
    rawBodyAuth,
    rawBodyMinRate: o.minRate,
  };
}

async function nodeHarness(o: HarnessOptions = MAIN): Promise<Harness> {
  const h = { name: `node${o.suffix}`, port: 0, calls: 0, gate: new RawBodyGate() } as Harness;
  const server: Server = createServer(createNodeRequestHandler(makeRoutes(h), mountOptions(h, o)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  h.port = typeof address === "object" && address !== null ? address.port : 0;
  h.close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return h;
}

async function uwsHarness(o: HarnessOptions = MAIN): Promise<Harness> {
  const uws = await import("uWebSockets.js");
  const h = { name: `uws${o.suffix}`, port: 0, calls: 0, gate: new RawBodyGate() } as Harness;
  const app = uws.App();
  mountHttpRoutes(app, makeRoutes(h), mountOptions(h, o));
  const token = await new Promise<unknown>((resolve) => app.listen("127.0.0.1", 0, resolve));
  const listen = token as Parameters<typeof uws.us_socket_local_port>[0];
  h.port = uws.us_socket_local_port(listen);
  h.close = () => {
    uws.us_listen_socket_close(listen);
    app.close();
    return Promise.resolve();
  };
  return h;
}

beforeAll(async () => {
  harnesses.push(await uwsHarness(), await nodeHarness(), await uwsHarness(RATE), await nodeHarness(RATE));
}, 30_000);

afterAll(async () => {
  for (const h of harnesses) await h.close();
});

interface RawResponse {
  status: number;
  rawHeaders: string[];
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface RawRequestOptions {
  readonly path: string;
  readonly ip: string;
  readonly headers?: Record<string, string>;
  /** Body bytes; with `chunked` they are streamed without content-length. */
  readonly body?: Uint8Array;
  readonly chunked?: boolean;
  /** Send only headers (+ `partial` bytes) and keep the request open. */
  readonly hold?: boolean;
  readonly declared?: number;
  readonly partial?: number;
}

/** One request on a fresh connection. Resolves the response, or `{ status: 0 }` when the server closed without one. */
function rawRequest(port: number, o: RawRequestOptions): { done: Promise<RawResponse>; abort: () => void } {
  let abort = (): void => undefined;
  const done = new Promise<RawResponse>((resolve) => {
    const headers: Record<string, string | number> = {
      origin: ORIGIN,
      "true-client-ip": o.ip,
      connection: "close",
      ...o.headers,
    };
    if (o.chunked === true) headers["transfer-encoding"] = "chunked";
    else headers["content-length"] = o.declared ?? o.body?.byteLength ?? 0;
    const req = httpRequest({ host: "127.0.0.1", port, path: o.path, method: "POST", headers, agent: false });
    abort = () => req.destroy();
    let settled = false;
    const finish = (r: RawResponse): void => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        finish({
          status: res.statusCode ?? 0,
          rawHeaders: res.rawHeaders,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
      res.on("error", () =>
        finish({
          status: res.statusCode ?? 0,
          rawHeaders: res.rawHeaders,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    // A server that answers early and closes may reset our upload: that is expected, not a test failure.
    req.on("error", () => finish({ status: 0, rawHeaders: [], headers: {}, body: Buffer.alloc(0) }));
    req.on("close", () => finish({ status: 0, rawHeaders: [], headers: {}, body: Buffer.alloc(0) }));
    if (o.hold === true) {
      req.flushHeaders();
      if (o.partial !== undefined) req.write(Buffer.alloc(o.partial, 0x55));
      return;
    }
    const body = o.body ?? new Uint8Array(0);
    if (o.chunked === true) {
      for (let off = 0; off < body.byteLength; off += 65_536) req.write(body.subarray(off, off + 65_536));
      req.end();
    } else {
      req.end(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
    }
  });
  return { done, abort };
}

let accountSeq = 0;
/** Valid Bearer headers of a fresh account (`account` pins one, for the per-account cap). */
const bearer = (account?: string): Record<string, string> => ({
  authorization: `Bearer ok-${account ?? `acct${accountSeq++}`}`,
  "content-type": API_BINARY_CONTENT_TYPE,
});

/** Bytes that would break any text path: 0x00, 0xff, CR, LF, high bytes. */
function binaryPattern(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const motif = [0x00, 0xff, 0x0d, 0x0a, 0x80, 0x7f, 0xc3, 0x28];
  for (let i = 0; i < n; i++) out[i] = motif[i % motif.length]! ^ ((i >>> 13) & 0xff);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ipSeq = 0;
const freshIp = (): string => `198.51.100.${(ipSeq++ % 250) + 1}`;

describe.each(["uws", "node"])("raw binary body on %s", (name) => {
  const h = (): Harness => harnesses.find((x) => x.name === name)!;

  it("accepts a body of exactly the limit and echoes it byte-for-byte as one binary response", async () => {
    const bytes = binaryPattern(LIMIT);
    const res = await rawRequest(h().port, { path: "/v1/up/a", ip: freshIp(), headers: bearer(), body: bytes }).done;
    expect(res.status).toBe(200);
    expect(res.body.byteLength).toBe(LIMIT);
    expect(Buffer.compare(res.body, Buffer.from(bytes))).toBe(0);
    const names = res.rawHeaders.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase());
    expect(names.filter((n) => n === "content-type")).toHaveLength(1);
    expect(res.headers["content-type"]).toBe(API_BINARY_CONTENT_TYPE);
    expect(res.headers["content-length"]).toBe(String(LIMIT));
    expect(res.headers["x-save-pages"]).toBe("3");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["access-control-expose-headers"]).toBe("x-save-pages, retry-after");
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
  }, 30_000);

  it("does not stall a 20 Hz tick while 4 max-size uploads stream in (client and server share this process)", async () => {
    const bytes = binaryPattern(LIMIT);
    const lateness: number[] = [];
    let expected = performance.now() + 50;
    const timer = setInterval(() => {
      const now = performance.now();
      lateness.push(now - expected);
      expected = now + 50;
    }, 50);
    try {
      const uploads = [0, 1, 2, 3].map(
        () => rawRequest(h().port, { path: "/v1/up/a", ip: freshIp(), headers: bearer(), body: bytes }).done,
      );
      const results = await Promise.all(uploads);
      for (const r of results) expect(r.status).toBe(200);
      await sleep(120);
    } finally {
      clearInterval(timer);
    }
    const max = Math.max(...lateness);
    console.info(
      `[raw-body ${name}] 4 x ${LIMIT} B uploads: ${lateness.length} ticks, max tick lateness ${max.toFixed(1)} ms`,
    );
    // Loose bound: the client's 4 x 1 MB sends run on this same event loop and the machine is shared with other
    // work (172 ms uWS / 107 ms Node seen on a busy laptop). It guards against a multi-second stall, not a budget;
    // the logged number is the evidence.
    expect(max).toBeLessThan(250);
  }, 30_000);

  it("round-trips an empty raw body and a chunked raw body", async () => {
    const empty = await rawRequest(h().port, { path: "/v1/up/a", ip: freshIp(), headers: bearer() }).done;
    expect(empty.status).toBe(200);
    expect(empty.body.byteLength).toBe(0);
    const bytes = binaryPattern(200_000);
    const chunked = await rawRequest(h().port, {
      path: "/v1/up/a",
      ip: freshIp(),
      headers: bearer(),
      body: bytes,
      chunked: true,
    }).done;
    expect(chunked.status).toBe(200);
    expect(Buffer.compare(chunked.body, Buffer.from(bytes))).toBe(0);
  });

  it("answers limit + 1 with 413 JSON, declared and chunked", async () => {
    const declared = await rawRequest(h().port, {
      path: "/v1/up/a",
      ip: freshIp(),
      headers: bearer(),
      hold: true,
      declared: LIMIT + 1,
    });
    const r1 = await declared.done;
    declared.abort();
    expect(r1.status).toBe(413);
    expect(JSON.parse(r1.body.toString("utf8"))).toEqual({ error: "PAYLOAD_TOO_LARGE", message: "body too large" });
    expect(r1.headers["content-type"]).toBe("application/json; charset=utf-8");
    const before = h().calls;
    const r2 = await rawRequest(h().port, {
      path: "/v1/up/a",
      ip: freshIp(),
      headers: bearer(),
      body: new Uint8Array(LIMIT + 1),
      chunked: true,
    }).done;
    // The server answers 413 and closes; on a fast reset the client may see the close first (status 0).
    expect([413, 0]).toContain(r2.status);
    expect(h().calls).toBe(before);
  });

  it("refuses a missing Bearer (401) and a wrong content-type (400) without reading the body", async () => {
    const before = h().calls;
    // `hold`: headers only, the declared body is never sent, so an answer proves nothing was waited for.
    const noAuth = rawRequest(h().port, {
      path: "/v1/up/a",
      ip: freshIp(),
      headers: { "content-type": API_BINARY_CONTENT_TYPE },
      hold: true,
      declared: 500_000,
    });
    const r1 = await noAuth.done;
    noAuth.abort();
    expect(r1.status).toBe(401);
    expect(JSON.parse(r1.body.toString("utf8"))).toEqual({ error: "UNAUTHORIZED" });
    const badType = rawRequest(h().port, {
      path: "/v1/up/a",
      ip: freshIp(),
      headers: { authorization: "Bearer x", "content-type": "application/json" },
      hold: true,
      declared: 500_000,
    });
    const r2 = await badType.done;
    badType.abort();
    expect(r2.status).toBe(400);
    expect(JSON.parse(r2.body.toString("utf8"))).toMatchObject({ error: "BAD_REQUEST" });
    // charset parameters are ignored
    const withParam = await rawRequest(h().port, {
      path: "/v1/up/a",
      ip: freshIp(),
      headers: {
        authorization: `Bearer ok-param${accountSeq++}`,
        "content-type": "Application/Octet-Stream; charset=binary",
      },
      body: Uint8Array.of(1),
    }).done;
    expect(withParam.status).toBe(200);
    expect(h().calls).toBe(before + 1);
  });

  it("caps raw reads in flight (1 per IP, 4 per process) with 503 + retry-after 5", async () => {
    const ip = freshIp();
    const held = rawRequest(h().port, {
      path: "/v1/up/a",
      ip,
      headers: bearer(),
      hold: true,
      declared: 1000,
      partial: 10,
    });
    await sleep(100);
    const second = await rawRequest(h().port, { path: "/v1/up/a", ip, headers: bearer(), body: Uint8Array.of(1) }).done;
    expect(second.status).toBe(503);
    expect(second.headers["retry-after"]).toBe("5");
    expect(JSON.parse(second.body.toString("utf8"))).toEqual({ error: "RETRY_LATER" });
    const others = [1, 2, 3].map(() =>
      rawRequest(h().port, {
        path: "/v1/up/a",
        ip: freshIp(),
        headers: bearer(),
        hold: true,
        declared: 1000,
        partial: 10,
      }),
    );
    await sleep(150);
    expect(h().gate.inFlight).toBe(4);
    const fifth = await rawRequest(h().port, {
      path: "/v1/up/a",
      ip: freshIp(),
      headers: bearer(),
      body: Uint8Array.of(1),
    }).done;
    expect(fifth.status).toBe(503);
    // JSON routes are not gated.
    const json = await rawRequest(h().port, { path: "/v1/json", ip, body: Buffer.from("{}") }).done;
    expect(json.status).toBe(200);
    held.abort();
    for (const o of others) o.abort();
    await expect.poll(() => h().gate.inFlight, { timeout: 3000 }).toBe(0);
  });

  it("closes a slow body at the read deadline and releases its slot", async () => {
    const ip = freshIp();
    const slow = rawRequest(h().port, {
      path: "/v1/up/a",
      ip,
      headers: bearer(),
      hold: true,
      declared: 4096,
      partial: 100,
    });
    const started = performance.now();
    const r = await slow.done;
    const waited = performance.now() - started;
    expect(r.status).toBe(0); // closed without an answer
    expect(waited).toBeGreaterThanOrEqual(READ_TIMEOUT_MS - 50);
    expect(waited).toBeLessThan(READ_TIMEOUT_MS + 2000);
    await expect.poll(() => h().gate.inFlight, { timeout: 3000 }).toBe(0);
    const again = await rawRequest(h().port, { path: "/v1/up/a", ip, headers: bearer(), body: Uint8Array.of(7) }).done;
    expect(again.status).toBe(200);
    expect([...again.body]).toEqual([7]);
  });

  it("keeps JSON routes on the 16 KB limit and never hands them rawBody", async () => {
    const ok = await rawRequest(h().port, { path: "/v1/json", ip: freshIp(), body: Buffer.from('{"a":1}') }).done;
    expect(JSON.parse(ok.body.toString("utf8"))).toEqual({ ok: true, hasRaw: false, body: { a: 1 } });
    const big = await rawRequest(h().port, {
      path: "/v1/json",
      ip: freshIp(),
      body: Buffer.alloc(MAX_HTTP_BODY_BYTES + 1, 0x20),
    }).done;
    expect([413, 0]).toContain(big.status);
    const exact = await rawRequest(h().port, {
      path: "/v1/json",
      ip: freshIp(),
      body: Buffer.concat([Buffer.from("{}"), Buffer.alloc(MAX_HTTP_BODY_BYTES - 2, 0x20)]),
    }).done;
    expect(exact.status).toBe(200);
  });
});

describe.each(["uws", "node"])("upload slot hardening on %s (security review M1)", (name) => {
  const h = (): Harness => harnesses.find((x) => x.name === name)!;
  const rate = (): Harness => harnesses.find((x) => x.name === `${name}-rate`)!;

  it("verifies the token BEFORE taking a slot: a forged Bearer gets 401 and never holds one", async () => {
    const before = h().calls;
    const verified = verifyCalls.n;
    // Held request with a large declared body that is never sent: the 401 cannot have waited for it.
    const forged = rawRequest(h().port, {
      path: "/v1/up/a",
      ip: freshIp(),
      headers: { authorization: "Bearer x", "content-type": API_BINARY_CONTENT_TYPE },
      hold: true,
      declared: LIMIT,
      partial: 10,
    });
    const r = await forged.done;
    forged.abort();
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body.toString("utf8"))).toEqual({ error: "UNAUTHORIZED" });
    expect(verifyCalls.n).toBe(verified + 1);
    expect(h().gate.inFlight).toBe(0);
    // Four forged clients from four addresses cannot block a real upload.
    const forgers = [0, 1, 2, 3].map(() =>
      rawRequest(h().port, {
        path: "/v1/up/a",
        ip: freshIp(),
        headers: { authorization: "Bearer forged", "content-type": API_BINARY_CONTENT_TYPE },
        hold: true,
        declared: LIMIT,
        partial: 10,
      }),
    );
    for (const f of forgers) expect((await f.done).status).toBe(401);
    for (const f of forgers) f.abort();
    const real = await rawRequest(h().port, {
      path: "/v1/up/a",
      ip: freshIp(),
      headers: bearer(),
      body: Uint8Array.of(9),
    }).done;
    expect(real.status).toBe(200);
    expect(h().calls).toBe(before + 1);
  });

  it("answers an admission refusal (slot-attempt churn, review R2) with 429 + retry-after, takes no slot", async () => {
    const before = h().calls;
    const ip = freshIp();
    const limited = rawRequest(h().port, {
      path: "/v1/up/a",
      ip,
      headers: { authorization: "Bearer limited-a", "content-type": API_BINARY_CONTENT_TYPE },
      hold: true,
      declared: LIMIT,
      partial: 10,
    });
    const r = await limited.done;
    limited.abort();
    expect(r.status).toBe(429);
    expect(r.headers["retry-after"]).toBe("8");
    expect(JSON.parse(r.body.toString("utf8"))).toEqual({
      error: "RATE_LIMITED",
      message: "too many upload attempts",
    });
    // The admission sees the resolved client address (trusted edge header), for its per-/64 rule.
    expect(verifyCalls.lastAddress).toBe(ip);
    expect(h().gate.inFlight).toBe(0);
    expect(h().calls).toBe(before);
    // The same address with an admitted account still uploads.
    const ok = await rawRequest(h().port, { path: "/v1/up/a", ip, headers: bearer(), body: Uint8Array.of(5) }).done;
    expect(ok.status).toBe(200);
    expect(h().calls).toBe(before + 1);
  });

  it("keys slots per account and per IPv6 /64", async () => {
    const held = rawRequest(h().port, {
      path: "/v1/up/a",
      ip: freshIp(),
      headers: bearer("same"),
      hold: true,
      declared: 1000,
      partial: 10,
    });
    await expect.poll(() => h().gate.inFlight, { timeout: 2000 }).toBe(1);
    // Same account, another address: refused.
    const sameAccount = await rawRequest(h().port, {
      path: "/v1/up/a",
      ip: freshIp(),
      headers: bearer("same"),
      body: Uint8Array.of(1),
    }).done;
    expect(sameAccount.status).toBe(503);
    held.abort();
    await expect.poll(() => h().gate.inFlight, { timeout: 3000 }).toBe(0);

    const v6held = rawRequest(h().port, {
      path: "/v1/up/a",
      ip: "2001:db8:1:2::1",
      headers: bearer(),
      hold: true,
      declared: 1000,
      partial: 10,
    });
    await expect.poll(() => h().gate.inFlight, { timeout: 2000 }).toBe(1);
    const sameSlash64 = await rawRequest(h().port, {
      path: "/v1/up/a",
      ip: "2001:db8:1:2:ffff:ffff:ffff:fffe",
      headers: bearer(),
      body: Uint8Array.of(1),
    }).done;
    expect(sameSlash64.status).toBe(503);
    const otherSlash64 = await rawRequest(h().port, {
      path: "/v1/up/a",
      ip: "2001:db8:1:3::1",
      headers: bearer(),
      body: Uint8Array.of(1),
    }).done;
    expect(otherSlash64.status).toBe(200);
    v6held.abort();
    await expect.poll(() => h().gate.inFlight, { timeout: 3000 }).toBe(0);
  });

  it("drops a trickling body at the minimum-rate grace, long before the deadline, and frees its slot", async () => {
    const ip = freshIp();
    const started = performance.now();
    const trickle = rawRequest(rate().port, {
      path: "/v1/up/a",
      ip,
      headers: bearer(),
      hold: true,
      declared: 100_000,
      partial: 100,
    });
    const r = await trickle.done;
    const waited = performance.now() - started;
    expect(r.status).toBe(0);
    expect(waited).toBeGreaterThanOrEqual(RATE_GRACE_MS - 50);
    expect(waited).toBeLessThan(3000); // the deadline is 10 s
    await expect.poll(() => rate().gate.inFlight, { timeout: 3000 }).toBe(0);
    // A fast upload on the same harness is unaffected.
    const fast = await rawRequest(rate().port, {
      path: "/v1/up/a",
      ip,
      headers: bearer(),
      body: binaryPattern(500_000),
    }).done;
    expect(fast.status).toBe(200);
  });
});

describe("slot keys and the Node request timeout (review M1 / L2)", () => {
  it("groups IPv6 by /64 and leaves IPv4 alone", () => {
    expect(ipSlotKey("203.0.113.5")).toBe("203.0.113.5");
    expect(ipSlotKey("unknown")).toBe("unknown");
    expect(ipSlotKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(ipSlotKey("2001:0DB8:0001:0002:ffff:0:0:1")).toBe("2001:db8:1:2::/64");
    expect(ipSlotKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipSlotKey("::1")).toBe("0:0:0:0::/64");
    expect(ipSlotKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipSlotKey("::ffff:198.51.100.7")).toBe("198.51.100.7");
  });

  it("gives the Node http server a request timeout above the shared 30 s body deadline (uWS and Node cut alike)", () => {
    expect(HTTP_REQUEST_TIMEOUT_MS).toBeGreaterThan(BODY_READ_TIMEOUT_MS);
    const bound = createWsTransport({
      routes: [],
      policy,
      clientIpHeader: "true-client-ip",
      logger: silent,
      admission: new Admission({ maxRooms: 1, maxClients: 1 }, silent),
      beforeUpgrade: () => undefined,
    });
    try {
      const server = Reflect.get(bound.transport, "server") as Server;
      expect(server.requestTimeout).toBe(HTTP_REQUEST_TIMEOUT_MS);
      expect(server.requestTimeout).toBeGreaterThan(BODY_READ_TIMEOUT_MS);
    } finally {
      bound.transport.shutdown();
    }
  });
});

describe("uWS and Node answer the same binary response", () => {
  it("has identical bytes and the same header set (ignoring transport-specific date/connection)", async () => {
    const bytes = binaryPattern(70_001);
    const answers = await Promise.all(
      harnesses
        .slice(0, 2)
        .map((x) => rawRequest(x.port, { path: "/v1/up/b", ip: freshIp(), headers: bearer(), body: bytes }).done),
    );
    const [a, b] = answers as [RawResponse, RawResponse];
    expect(Buffer.compare(a.body, b.body)).toBe(0);
    const ours = (r: RawResponse): string[] =>
      Object.entries(r.headers)
        .filter(([k]) => !["date", "connection", "uwebsockets", "keep-alive", "transfer-encoding"].includes(k))
        .map(([k, v]) => `${k}: ${String(v)}`)
        .sort();
    expect(ours(a)).toEqual(ours(b));
  });
});
