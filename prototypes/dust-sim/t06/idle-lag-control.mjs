// T06 control: event-loop lag of an idle Node process with the same probe the adapters use
// (monitorEventLoopDelay, 10 ms resolution, lag = p99 gap - 10 ms). Gives the floor of the machine + timer,
// with no dust code at all. An optional 50 ms setInterval mimics the harness's realtime tick wake-ups.
import { monitorEventLoopDelay } from "node:perf_hooks";

const seconds = Number(process.argv[2] ?? 60);
const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();
const tick = setInterval(() => {}, 50);
setTimeout(() => {
  clearInterval(tick);
  h.disable();
  const ms = (p) => Math.max(0, h.percentile(p) / 1e6 - 10);
  console.log(
    JSON.stringify({
      control: "idle",
      seconds,
      samples: h.count,
      lagP50Ms: +ms(50).toFixed(3),
      lagP99Ms: +ms(99).toFixed(3),
      lagMaxMs: +Math.max(0, h.max / 1e6 - 10).toFixed(3),
    }),
  );
}, seconds * 1000);
