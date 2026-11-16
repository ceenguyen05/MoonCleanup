import net from "node:net";
import { describe, expect, it } from "vitest";
import { DirectionConditioner } from "./conditioner";
import { PROFILES } from "./profiles";
import { startProxy } from "./proxy";

describe("DirectionConditioner", () => {
  it("is deterministic for a seed and monotone (ordered delivery)", () => {
    const run = (seed: number) => {
      const c = new DirectionConditioner(PROFILES.typical, seed, 0);
      return Array.from({ length: 2000 }, (_, i) => c.deliveryTime(i * 50));
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
    const a = run(5);
    for (let i = 1; i < a.length; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i - 1] as number);
  });

  it("typical: one-way mean ~60 ms and about 1 % stalls", () => {
    const c = new DirectionConditioner(PROFILES.typical, 3, 0);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += c.deliveryTime(i * 1000) - i * 1000;
    expect(c.stalls / n).toBeGreaterThan(0.005);
    expect(c.stalls / n).toBeLessThan(0.02);
    // 60 ms one-way plus ~1 % of a 240 ms stall.
    expect(sum / n).toBeGreaterThan(60);
    expect(sum / n).toBeLessThan(65);
  });

  it("clean adds nothing; outage holds traffic until the window ends", () => {
    expect(new DirectionConditioner(PROFILES.clean, 1, 0).deliveryTime(100)).toBe(100);
    const o = new DirectionConditioner({ ...PROFILES.outage, loss: 0, jitterMs: 0 }, 1, 0);
    expect(o.deliveryTime(31_000)).toBe(35_000);
    expect(o.deliveryTime(36_000)).toBe(36_060);
  });
});

describe("startProxy", () => {
  it("relays bytes in order with added latency", async () => {
    const echo = net.createServer((s) => s.pipe(s));
    await new Promise<void>((r) => echo.listen(0, "127.0.0.1", () => r()));
    const targetPort = (echo.address() as net.AddressInfo).port;
    const p = await startProxy({
      profile: { name: "t", latencyMs: 100, jitterMs: 0, loss: 0 },
      listenPort: 0,
      targetPort,
    });
    const got = await new Promise<{ data: string; ms: number }>((resolve) => {
      const c = net.connect(p.port, "127.0.0.1");
      const t0 = performance.now();
      let data = "";
      c.on("data", (d) => {
        data += d.toString();
        if (data.length >= 6) resolve({ data, ms: performance.now() - t0 });
      });
      c.write("abc");
      c.write("def");
    });
    expect(got.data).toBe("abcdef");
    expect(got.ms).toBeGreaterThan(90);
    await p.close();
    await new Promise<void>((r) => echo.close(() => r()));
  });

  // Regression (M1 netsim desync): chunks clamped to the same delivery time used to get separate setTimeouts with
  // different durations; Node's cached integer-ms timer clock let a later chunk fire first, reordering the TCP stream
  // (WebSocket messages swapped -> bots saw serverTick/ack regressions and FRAME decode failures).
  it("never reorders chunks under heavy jitter (one FIFO drain per direction)", async () => {
    const echo = net.createServer((s) => s.pipe(s));
    await new Promise<void>((r) => echo.listen(0, "127.0.0.1", () => r()));
    const targetPort = (echo.address() as net.AddressInfo).port;
    const p = await startProxy({
      profile: { name: "t", latencyMs: 20, jitterMs: 40, loss: 0.05 },
      listenPort: 0,
      targetPort,
      seed: 9,
    });
    const n = 400;
    const got = await new Promise<number[]>((resolve) => {
      const c = net.connect(p.port, "127.0.0.1");
      c.setNoDelay(true);
      let buf = Buffer.alloc(0);
      c.on("data", (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        if (buf.length >= n * 4) {
          const out: number[] = [];
          for (let i = 0; i < n; i++) out.push(buf.readUInt32LE(i * 4));
          c.destroy();
          resolve(out);
        }
      });
      let i = 0;
      const send = () => {
        if (i >= n) return;
        const b = Buffer.alloc(4);
        b.writeUInt32LE(i++);
        c.write(b);
        // Alternate same-tick and next-tick writes so chunks land both within one loop turn and across turns.
        if (i % 3 === 0) setTimeout(send, 0);
        else setImmediate(send);
      };
      c.on("connect", send);
    });
    expect(got).toEqual(Array.from({ length: n }, (_, k) => k));
    await p.close();
    await new Promise<void>((r) => echo.close(() => r()));
  }, 20_000);
});
