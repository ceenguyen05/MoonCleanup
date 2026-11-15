// pnpm smoke -- --server-url https://<service>.onrender.com --client-origin https://<project>.vercel.app
import { parseArgs } from "node:util";
import { runSmoke } from "./smoke-deploy";
import { overallPass } from "./analysis";

const { values } = parseArgs({
  options: {
    "server-url": { type: "string" },
    "client-origin": { type: "string" },
    bots: { type: "string", default: "3" },
    hold: { type: "string", default: "60" },
    "wake-max": { type: "string", default: "120" },
    "ready-max": { type: "string", default: "60" },
    "expect-env": { type: "string" },
    out: { type: "string", default: "results" },
    milestone: { type: "string", default: "smoke" },
    help: { type: "boolean", default: false },
  },
});

const serverUrl = values["server-url"];
const clientOrigin = values["client-origin"];
if (values.help || serverUrl === undefined || clientOrigin === undefined) {
  console.error(
    "usage: pnpm smoke -- --server-url <https://service.onrender.com> --client-origin <https://project.vercel.app>\n" +
      "  [--bots 3] [--hold 60] [--wake-max 120] [--ready-max 60] [--expect-env production] [--out results]",
  );
  process.exit(2);
}
for (const [name, v] of [
  ["--server-url", serverUrl],
  ["--client-origin", clientOrigin],
] as const) {
  try {
    new URL(v);
  } catch {
    console.error(`${name} must be a full URL including https://, got "${v}"`);
    process.exit(2);
  }
}
const bots = Number(values.bots);
if (!Number.isInteger(bots) || bots < 2 || bots > 6) {
  console.error("--bots must be 2..6 (needs at least 2 to prove two players share a room; room cap is 6)");
  process.exit(2);
}

try {
  const { results } = await runSmoke({
    serverUrl,
    clientOrigin,
    bots,
    holdS: Number(values.hold),
    wakeMaxS: Number(values["wake-max"]),
    readyMaxS: Number(values["ready-max"]),
    ...(values["expect-env"] !== undefined ? { expectEnv: values["expect-env"] } : {}),
    outDir: values.out ?? "results",
    milestone: values.milestone ?? "smoke",
  });
  process.exit(overallPass(results) ? 0 : 1);
} catch (e) {
  console.error(`smoke crashed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(3);
}
