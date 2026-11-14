// Run a conditioning TCP proxy:  tsx src/cli.ts --listen 2581 --target 2571 --profile typical [--seed 1]
import { parseArgs } from "node:util";
import { PROFILES, isProfileName } from "./conditioner/profiles";
import { startProxy } from "./conditioner/proxy";

const { values } = parseArgs({
  options: {
    listen: { type: "string" },
    target: { type: "string" },
    profile: { type: "string", default: "typical" },
    seed: { type: "string", default: "1" },
  },
});
const profileName = values.profile ?? "typical";
if (!isProfileName(profileName) || values.listen === undefined || values.target === undefined) {
  console.error(
    `usage: netsim --listen <port> --target <port> [--profile ${Object.keys(PROFILES).join("|")}] [--seed n]`,
  );
  process.exit(2);
}
const proxy = await startProxy({
  profile: PROFILES[profileName],
  listenPort: Number(values.listen),
  targetPort: Number(values.target),
  seed: Number(values.seed),
});
console.log(
  JSON.stringify({ kind: "netsim-ready", profile: profileName, listen: proxy.port, target: Number(values.target) }),
);
const stop = () => {
  console.log(JSON.stringify({ kind: "netsim-stats", ...proxy.stats }));
  void proxy.close().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
