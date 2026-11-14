// CLI: `tsx src/cli.ts capture ...` and `tsx src/cli.ts budgets <result.json> ...`. Flags are documented in README.md.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compareClient, compareDownload, compareServer, formatBudgetRows, type BudgetRow } from "./budgets";
import { DEFAULT_CAMERA_PATH, runCapture, type AdapterFlag } from "./capture/runner";
import { measureDist } from "./download";
import { computeVerdict, formatVerdict } from "./device/verdict";
import { renderDeviceMarkdown, validateReport, type DeviceReport } from "./device/report";
import { DEFAULT_REPORT_DIR, runDeviceReport, type Channel } from "./device/run";
import type { CaptureResult, HardwareTierLetter, ServerReport } from "./schema";

export function parseFlags(argv: readonly string[]): { positional: string[]; flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith("--")) positional.push(a);
    else if (a.includes("=")) flags[a.slice(2, a.indexOf("="))] = a.slice(a.indexOf("=") + 1);
    else if (argv[i + 1] !== undefined && !(argv[i + 1] as string).startsWith("--"))
      flags[a.slice(2)] = argv[++i] as string;
    else flags[a.slice(2)] = "true";
  }
  return { positional, flags };
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T, name: string): T {
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value))
    throw new Error(`--${name} must be one of ${allowed.join(", ")}`);
  return value as T;
}

async function main(): Promise<void> {
  const { positional, flags } = parseFlags(process.argv.slice(2));
  const command = positional[0];
  if (command === "capture") {
    const offset = Number(flags["port-offset"] ?? process.env["MC_PORT_OFFSET"] ?? 0);
    const cameraFile = flags["camera-path"];
    const out = await runCapture({
      url: flags["url"] ?? `http://localhost:${5173 + offset}/`,
      milestone: flags["milestone"] ?? "m0",
      scene: flags["scene"] ?? "smoke",
      seed: flags["seed"] ?? "perf-1",
      tier: oneOf<HardwareTierLetter>(flags["tier"], ["A", "B", "C"], "B", "tier"),
      preset: oneOf(flags["preset"], ["low", "medium", "high", "ultra"], "medium", "preset"),
      backend: oneOf(flags["backend"], ["auto", "webgpu", "webgl2"], "auto", "backend"),
      adapter: oneOf<AdapterFlag>(flags["adapter"], ["high-performance", "low-power", "default"], "default", "adapter"),
      runs: Number(flags["runs"] ?? 3),
      warmupS: Number(flags["warmup"] ?? 10),
      captureS: Number(flags["duration"] ?? 60),
      outDir: flags["out"] ?? "tools/perf/results",
      cameraPath: cameraFile === undefined ? DEFAULT_CAMERA_PATH.spec : JSON.parse(readFileSync(cameraFile, "utf8")),
      cameraPathId: cameraFile === undefined ? DEFAULT_CAMERA_PATH.id : path.basename(cameraFile),
      realDevice: flags["real-device"] === "true",
      headless: flags["headless"] === "true",
      ...(flags["query"] === undefined ? {} : { extraQuery: flags["query"] }),
      ...(flags["viewport"] === undefined
        ? {}
        : {
            viewport: {
              width: Number(flags["viewport"].split("x")[0]),
              height: Number(flags["viewport"].split("x")[1]),
            },
          }),
    });
    console.log(out.jsonPath);
    console.log(out.mdPath);
  } else if (command === "budgets") {
    const file = positional[1];
    if (file === undefined)
      throw new Error("usage: budgets <capture.json> [--dist <dir>] [--server-report <json>] [--out <md>]");
    const result = JSON.parse(readFileSync(file, "utf8")) as CaptureResult;
    const rows: BudgetRow[] = compareClient(result);
    if (flags["dist"] !== undefined) rows.push(...compareDownload(await measureDist(flags["dist"])));
    const serverFile = flags["server-report"];
    rows.push(
      ...compareServer(
        serverFile === undefined ? null : (JSON.parse(readFileSync(serverFile, "utf8")) as ServerReport),
      ),
    );
    const md = `${formatBudgetRows(rows)}\n\nReport only; performance-reviewer issues the verdict.${result.provisional ? " Capture hardware is provisional." : ""}\n`;
    if (flags["out"] !== undefined) writeFileSync(flags["out"], md);
    console.log(md);
    const failed = rows.filter((r) => r.status === "FAIL").length;
    console.log(
      `${rows.filter((r) => r.status === "PASS").length} pass, ${failed} fail, ${rows.filter((r) => r.status === "UNVERIFIED").length} unverified`,
    );
  } else if (command === "device-report") {
    const channel = oneOf<Channel>(flags["channel"], ["chrome", "msedge", "chromium"], "chrome", "channel");
    const out = await runDeviceReport({
      channel,
      headless: flags["headless"] === "true",
      warmupS: Number(flags["warmup"] ?? 4),
      captureS: Number(flags["duration"] ?? 10),
      includeLook: flags["no-look"] !== "true",
      outDir: flags["out"] ?? DEFAULT_REPORT_DIR,
      verdict: flags["verdict"] === "true",
      seed: flags["seed"] ?? "device-1",
      ...(flags["scale"] === undefined ? {} : { scale: Number(flags["scale"]) }),
      ...(flags["only"] === undefined ? {} : { only: flags["only"].split(",") }),
    });
    if (flags["verdict"] === "true")
      console.log(`
${formatVerdict(computeVerdict(out.report))}`);
    console.log(`
Wrote (send either file; no personal data inside):
${out.jsonPath}
${out.mdPath}`);
  } else if (command === "verdict") {
    const file = positional[1];
    if (file === undefined) throw new Error("usage: verdict <device-report.json>");
    const report = JSON.parse(readFileSync(file, "utf8")) as DeviceReport;
    const problems = validateReport(report);
    if (problems.length > 0) throw new Error(`invalid device report: ${problems.join("; ")}`);
    console.log(renderDeviceMarkdown(report));
    console.log(`## Provisional tier comparison

${formatVerdict(computeVerdict(report))}`);
  } else {
    console.log(
      "usage: capture [flags] | budgets <capture.json> [flags] | device-report [flags] | verdict <report.json>  (see tools/perf/README.md)",
    );
    process.exitCode = command === undefined ? 0 : 1;
  }
}

if (
  import.meta.url === new URL(process.argv[1] ?? "", "file://").href ||
  process.argv[1]?.endsWith("cli.ts") === true
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
