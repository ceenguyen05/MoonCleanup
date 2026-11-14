// pnpm bots -- spike-16 --url http://localhost:2571 [--duration 600] [--bots 6] [--netsim typical|none|...]
//   [--tick 20] [--snap 10] [--seed 1] [--milestone M0] [--out tools/bots/results] [--server-log file]
//   [--reconnect-at 0.5] [--join-retry-max 60] [--allow-hosted]
import { parseArgs } from "node:util";
import { runSpike16 } from "./scenarios/spike16";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string", default: "http://localhost:2571" },
    duration: { type: "string", default: "600" },
    bots: { type: "string", default: "6" },
    netsim: { type: "string", default: "typical" },
    "netsim-port": { type: "string" },
    tick: { type: "string", default: "20" },
    snap: { type: "string", default: "10" },
    seed: { type: "string", default: "1" },
    milestone: { type: "string", default: "M0" },
    out: { type: "string", default: "results" },
    "server-log": { type: "string" },
    "reconnect-at": { type: "string", default: "0.5" },
    "allow-hosted": { type: "boolean", default: false },
    "join-retry-max": { type: "string", default: "60" },
    origin: { type: "string" },
    label: { type: "string" },
  },
});

const scenario = positionals[0];
if (scenario !== "spike-16") {
  console.error("usage: bots spike-16 --url <server url> [options]   (see tools/bots/README.md)");
  process.exit(2);
}
const { jsonPath, mdPath, report } = await runSpike16({
  url: values.url ?? "http://localhost:2571",
  bots: Number(values.bots),
  durationS: Number(values.duration),
  tickHz: Number(values.tick),
  snapshotHz: Number(values.snap),
  seed: Number(values.seed),
  netsim: values.netsim ?? "typical",
  ...(values["netsim-port"] !== undefined ? { netsimPort: Number(values["netsim-port"]) } : {}),
  milestone: values.milestone ?? "M0",
  outDir: values.out ?? "results",
  ...(values["server-log"] !== undefined ? { serverLog: values["server-log"] } : {}),
  reconnectAt: Number(values["reconnect-at"]),
  allowHosted: values["allow-hosted"] ?? false,
  joinRetryMaxS: Number(values["join-retry-max"]),
  ...(values.origin !== undefined ? { origin: values.origin } : {}),
  ...(values.label !== undefined ? { label: values.label } : {}),
});
console.log(
  JSON.stringify({ kind: "spike-16-done", jsonPath, mdPath, snapshotHz: report.bots.snapshotHzAchievedPerBot }),
);
process.exit(0);
