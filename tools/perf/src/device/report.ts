// Device-report schema, anonymiser and Markdown summary (pure: no I/O, no browser). The report is written to disk
// for the owner to paste or send; nothing here touches the network and nothing identifying may survive `scrub`.

import { randomBytes } from "node:crypto";

export const DEVICE_REPORT_SCHEMA = 1 as const;

export interface AdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
}

export interface WebGpuProbe {
  readonly available: boolean;
  readonly adapter: AdapterInfo | null;
  /** Numeric adapter limits. */
  readonly limits: Readonly<Record<string, number>>;
  readonly features: readonly string[];
  /** `timestamp-query` feature present on the adapter: GPU ms can be a measurement, not an estimate. */
  readonly timestampQuery: boolean;
  readonly error: string | null;
}

export interface DeviceCell {
  readonly scene: string;
  readonly backendRequested: "webgpu" | "webgl2";
  readonly backendActual: string | null;
  readonly presetRequested: "low" | "medium" | "high";
  readonly presetActual: string | null;
  readonly renderScale: number | null;
  readonly dpr: number | null;
  readonly status: "ok" | "failed" | "skipped";
  readonly note: string | null;
  /** `real` / `standin-fallback` for bench cells, null otherwise. */
  readonly terrainSource: string | null;
  readonly frameMs: { readonly p50: number; readonly p95: number; readonly p99: number } | null;
  readonly fps: number | null;
  /** null unless a WebGPU timestamp query measured it. */
  readonly gpuMs: { readonly p50: number; readonly p95: number } | null;
  readonly gpuTimingSource: string | null;
  readonly cpuTotalMsP95: number | null;
  readonly draws: number | null;
  readonly tris: number | null;
}

export interface DeviceReport {
  readonly kind: "device-report";
  readonly schema: typeof DEVICE_REPORT_SCHEMA;
  /** Random, not derived from the machine. */
  readonly id: string;
  readonly createdAt: string;
  readonly system: {
    readonly os: string;
    readonly cpu: string;
    readonly cores: number;
    readonly ramGb: number;
  };
  readonly browser: {
    readonly name: string;
    readonly version: string;
    readonly channel: string;
    readonly headless: boolean;
  };
  readonly display: {
    readonly screen: readonly [number, number];
    readonly viewport: readonly [number, number];
    readonly dpr: number;
  };
  readonly gpu: {
    /** Renderer string the game saw (WebGL/WebGPU description). */
    readonly rendererString: string;
    readonly softwareRenderer: boolean;
    readonly webgpu: WebGpuProbe;
  };
  /** What the game's own tier detector chose with no `?preset=` / `?backend=` override. */
  readonly detector: {
    readonly backend: string;
    readonly tier: string;
    readonly preset: string;
  } | null;
  readonly capture: {
    readonly warmupS: number;
    readonly captureS: number;
    readonly scaleMode: string;
    readonly seed: string;
  };
  readonly cells: readonly DeviceCell[];
  readonly warnings: readonly string[];
}

/** Renderer strings of CPU rasterisers: a capture on one of these measures nothing about a real GPU. */
export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render|software/i.test(renderer);
}

export function newAnonymousId(): string {
  return randomBytes(6).toString("hex");
}

// ---------------------------------------------------------------- anonymiser

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Whole-token match, so a user name such as "ben" does not shred "bench". */
const tokenRe = (secret: string, flags: string): RegExp =>
  new RegExp(`(?<![A-Za-z0-9])${escapeRe(secret)}(?![A-Za-z0-9])`, flags);

/** Values that identify the person or machine; replaced by a placeholder wherever they appear. */
export function collectSecrets(input: {
  readonly username?: string;
  readonly hostname?: string;
  readonly homedir?: string;
  readonly cwd?: string;
  readonly tmpdir?: string;
}): string[] {
  const raw = [input.homedir, input.cwd, input.tmpdir, input.hostname, input.username];
  const out: string[] = [];
  for (const v of raw) {
    const t = v?.trim();
    // Very short names ("a", "pc") would shred ordinary words; paths/hostnames of 3+ chars are replaced.
    if (t !== undefined && t.length >= 3 && !out.includes(t)) out.push(t);
  }
  // Longest first so a path is replaced before the user name inside it.
  return out.sort((a, b) => b.length - a.length);
}

const PATH_RE = /(?:[A-Za-z]:[\\/][^\s"',;)]*|\/(?:Users|home|root|var|tmp|private)\/[^\s"',;)]*|\\\\[^\s"',;)]+)/g;

export function scrubString(value: string, secrets: readonly string[]): string {
  let s = value;
  for (const secret of secrets) s = s.replace(tokenRe(secret, "gi"), "<redacted>");
  return s.replace(PATH_RE, "<path>");
}

/** Deep copy with every string scrubbed (keys are fixed by the schema and left alone). */
export function scrubDeep<T>(value: T, secrets: readonly string[]): T {
  if (typeof value === "string") return scrubString(value, secrets) as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, secrets)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubDeep(v, secrets);
    return out as T;
  }
  return value;
}

/** The secrets (and path shapes) that still appear in serialised output; the writer refuses to write when non-empty. */
export function findLeaks(serialised: string, secrets: readonly string[]): string[] {
  const hits: string[] = [];
  for (const s of secrets) if (tokenRe(s, "i").test(serialised)) hits.push("secret value");
  // JSON escapes backslashes, so check both a Windows drive path and a Unix home path shape.
  if (/[A-Za-z]:\\\\|[A-Za-z]:\//.test(serialised)) hits.push("drive path");
  if (/\/(?:Users|home)\/[^\s"/]+/.test(serialised)) hits.push("home path");
  return hits;
}

// ---------------------------------------------------------------- validation

/** Minimal structural check of a parsed report (used by `verdict <file>`). Returns problems, empty when valid. */
export function validateReport(value: unknown): string[] {
  const problems: string[] = [];
  const r = value as Partial<DeviceReport> | null;
  if (r === null || typeof r !== "object") return ["not an object"];
  if (r.kind !== "device-report") problems.push("kind must be device-report");
  if (r.schema !== DEVICE_REPORT_SCHEMA) problems.push(`schema must be ${DEVICE_REPORT_SCHEMA}`);
  if (typeof r.id !== "string" || !/^[0-9a-f]{12}$/.test(r.id)) problems.push("id must be 12 hex chars");
  if (!Array.isArray(r.cells)) problems.push("cells must be an array");
  else {
    r.cells.forEach((c, i) => {
      if (c.status === "ok" && (c.frameMs === null || c.fps === null)) problems.push(`cells[${i}] ok without numbers`);
      if (!["webgpu", "webgl2"].includes(c.backendRequested)) problems.push(`cells[${i}] bad backendRequested`);
    });
  }
  if (r.gpu === undefined || typeof r.gpu.softwareRenderer !== "boolean") problems.push("gpu.softwareRenderer missing");
  if (r.system === undefined || typeof r.system.os !== "string") problems.push("system.os missing");
  return problems;
}

// ---------------------------------------------------------------- markdown

const f = (n: number | null | undefined, digits = 1): string => (n == null ? "n/a" : n.toFixed(digits));

export function renderDeviceMarkdown(r: DeviceReport): string {
  const a = r.gpu.webgpu.adapter;
  const lines: string[] = [];
  lines.push(
    `# Device report ${r.id}`,
    "",
    `Created ${r.createdAt}. Schema ${r.schema}. Contains no personal data; nothing was uploaded.`,
    "",
  );
  if (r.warnings.length > 0) {
    lines.push("## Warnings", "", ...r.warnings.map((w) => `- ${w}`), "");
  }
  lines.push(
    "## Machine",
    "",
    `- OS: ${r.system.os}`,
    `- CPU: ${r.system.cpu} (${r.system.cores} threads, ${r.system.ramGb} GB RAM)`,
    `- Browser: ${r.browser.name} ${r.browser.version} (channel ${r.browser.channel}, ${r.browser.headless ? "headless" : "headed"})`,
    `- Screen ${r.display.screen[0]}x${r.display.screen[1]}, capture viewport ${r.display.viewport[0]}x${r.display.viewport[1]}, DPR ${r.display.dpr}`,
    `- GPU renderer string: ${r.gpu.rendererString || "unknown"}${r.gpu.softwareRenderer ? " (SOFTWARE RASTERISER)" : ""}`,
    `- WebGPU: ${r.gpu.webgpu.available ? "available" : `not available${r.gpu.webgpu.error === null ? "" : ` (${r.gpu.webgpu.error})`}`}`,
  );
  if (a !== null) {
    lines.push(
      `- Adapter: vendor "${a.vendor}", architecture "${a.architecture}", device "${a.device}", description "${a.description}"`,
      `- Timestamp queries: ${r.gpu.webgpu.timestampQuery ? "available (GPU ms are measured on WebGPU)" : "NOT available (GPU ms n/a)"}`,
      `- Key limits: ${[
        "maxTextureDimension2D",
        "maxBufferSize",
        "maxStorageBufferBindingSize",
        "maxComputeInvocationsPerWorkgroup",
      ]
        .map((k) => `${k}=${String(r.gpu.webgpu.limits[k] ?? "n/a")}`)
        .join(", ")}`,
    );
  }
  lines.push(
    `- Game tier detector chose: ${r.detector === null ? "n/a (detection run failed)" : `backend ${r.detector.backend}, tier ${r.detector.tier}, preset ${r.detector.preset}`}`,
    "",
    `## Results (warm-up ${r.capture.warmupS} s discarded, ${r.capture.captureS} s captured per cell, scale mode ${r.capture.scaleMode}, seed ${r.capture.seed})`,
    "",
    "| Scene | Backend | Preset | Scale | FPS | Frame p50 | p95 | p99 | GPU p50 / p95 | CPU p95 | Draws | Tris | Status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const c of r.cells) {
    const gpu = c.gpuMs === null ? "n/a" : `${f(c.gpuMs.p50)} / ${f(c.gpuMs.p95)}`;
    const status = c.status === "ok" ? "ok" : `${c.status}${c.note === null ? "" : `: ${c.note}`}`;
    lines.push(
      `| ${c.scene} | ${c.backendActual ?? c.backendRequested} | ${c.presetActual ?? c.presetRequested} | ${f(c.renderScale, 2)} | ${f(c.fps)} | ${f(c.frameMs?.p50)} | ${f(c.frameMs?.p95)} | ${f(c.frameMs?.p99)} | ${gpu} | ${f(c.cpuTotalMsP95)} | ${c.draws ?? "n/a"} | ${c.tris ?? "n/a"} | ${status} |`,
    );
  }
  lines.push(
    "",
    "Frame ms are requestAnimationFrame intervals (display refresh can floor them). GPU ms exist only where a WebGPU timestamp query measured them; webgl2 is CPU-only and never shown as GPU time.",
    "",
  );
  return lines.join("\n");
}
