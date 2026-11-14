import net from "node:net";
import { DirectionConditioner } from "./conditioner";
import type { NetProfile } from "./profiles";

export interface ProxyOptions {
  readonly profile: NetProfile;
  readonly listenPort: number;
  readonly targetHost?: string;
  readonly targetPort: number;
  readonly seed?: number;
  readonly host?: string;
}

export interface ProxyStats {
  connections: number;
  chunksUp: number;
  chunksDown: number;
  stallsUp: number;
  stallsDown: number;
}

export interface NetProxy {
  readonly port: number;
  readonly stats: ProxyStats;
  close(): Promise<void>;
}

/**
 * Local TCP proxy that applies a {@link NetProfile} to every connection (both directions). Point a client at
 * `listenPort` instead of the server. Each connection derives its own random streams from seed + connection index, so
 * the injected delays are reproducible; actual timing still follows the host clock.
 */
export function startProxy(options: ProxyOptions): Promise<NetProxy> {
  const { profile, targetPort } = options;
  const targetHost = options.targetHost ?? "127.0.0.1";
  const seed = options.seed ?? 1;
  const startedAt = performance.now();
  const stats: ProxyStats = { connections: 0, chunksUp: 0, chunksDown: 0, stallsUp: 0, stallsDown: 0 };
  const sockets = new Set<net.Socket>();
  const timers = new Set<NodeJS.Timeout>();
  let index = 0;

  const later = (at: number, fn: () => void) => {
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        fn();
      },
      Math.max(0, at - performance.now()),
    );
    timers.add(timer);
  };

  const pipe = (from: net.Socket, to: net.Socket, cond: DirectionConditioner, up: boolean, holdFirstMs: number) => {
    let first = holdFirstMs > 0;
    from.on("data", (chunk: Buffer) => {
      const now = performance.now();
      let at = cond.deliveryTime(now);
      if (first) {
        first = false;
        at = Math.max(at, now + holdFirstMs);
      }
      if (up) stats.chunksUp++;
      else stats.chunksDown++;
      later(at, () => {
        if (!to.destroyed) to.write(chunk);
      });
    });
    from.on("end", () => {
      later(cond.deliveryTime(performance.now()), () => {
        if (!to.destroyed) to.end();
      });
    });
  };

  const server = net.createServer((client) => {
    const n = index++;
    stats.connections++;
    sockets.add(client);
    client.setNoDelay(true);
    const upstream = net.connect(targetPort, targetHost);
    upstream.setNoDelay(true);
    sockets.add(upstream);
    const up = new DirectionConditioner(profile, seed * 7919 + n * 2, startedAt);
    const down = new DirectionConditioner(profile, seed * 7919 + n * 2 + 1, startedAt);
    pipe(client, upstream, up, true, profile.connectDelayMs ?? 0);
    pipe(upstream, client, down, false, 0);
    let closed = false;
    const closeOnce = () => {
      if (closed) return;
      closed = true;
      stats.stallsUp += up.stalls;
      stats.stallsDown += down.stalls;
      sockets.delete(client);
      sockets.delete(upstream);
      client.destroy();
      upstream.destroy();
    };
    client.on("close", closeOnce);
    upstream.on("close", closeOnce);
    client.on("error", closeOnce);
    upstream.on("error", closeOnce);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.listenPort, options.host ?? "127.0.0.1", () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        stats,
        close() {
          for (const t of timers) clearTimeout(t);
          timers.clear();
          for (const s of sockets) s.destroy();
          return new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}
