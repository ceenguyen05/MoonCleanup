// Runs headless Blender exactly as `"<blender>" --background --python <script> -- <args>` (never installs,
// updates or configures it). The Blender path comes from BLENDER_PATH or the owner-provided default.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { DEFAULT_BLENDER_PATH } from "../paths.js";

export interface BlenderRun {
  readonly ok: boolean;
  readonly seconds: number;
  /** Lines the scripts print with the `[ctm]` prefix, plus errors and warnings. */
  readonly log: readonly string[];
}

export function blenderPath(): string {
  return process.env["BLENDER_PATH"] ?? DEFAULT_BLENDER_PATH;
}

export function blenderVersion(): string | null {
  const path = blenderPath();
  if (!existsSync(path)) return null;
  const result = spawnSync(path, ["--background", "--version"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).find((line) => line.startsWith("Blender ")) ?? null;
}

export function runBlender(script: string, args: readonly string[], timeoutMs = 60 * 60 * 1000): BlenderRun {
  const started = performance.now();
  const result = spawnSync(blenderPath(), ["--background", "--python", script, "--", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const log = output
    .split(/\r?\n/)
    .filter((line) => /^\[ctm\]|Traceback|Error|WARNING|^\s+File "/.test(line))
    .map((line) => line.trimEnd());
  // Blender exits 0 even when the Python script raised, so a traceback also counts as failure.
  const ok = result.status === 0 && !output.includes("Traceback (most recent call last)");
  return { ok, seconds: (performance.now() - started) / 1000, log };
}
