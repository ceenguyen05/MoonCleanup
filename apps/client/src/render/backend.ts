// Backend detection at boot: docs/architecture/rendering-pipeline.md section 2.1, steps 1-5 and 8.
// Steps 6-7 (create the renderer, read back what started, record capabilities) are renderer-host.ts / module.ts.
//
// Pure logic over injected inputs (no `navigator`, no DOM, no three.js) so it is unit-tested with mocked adapters.
//
// three r187 fact checked in node_modules/three/src/renderers/webgpu/WebGPUBackend.js: the WebGPU backend ALWAYS
// requests its adapter with `featureLevel: "compatibility"` and afterwards sets `backend.compatibilityMode` when the
// device lacks `core-features-and-limits`. So there is no renderer option to pass for step 3: a core-capable adapter
// starts as `webgpu`, a compatibility-only adapter as `webgpu-compat`, and renderer-host reads back which one it was.

import type { RenderBackend } from "@moon-cleanup/shared";
import type { BackendOverride } from "./url-options";

// ---- Injected environment (structural subsets of the WebGPU API) --------------------------------------------------

export interface GpuAdapterInfoLike {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
  readonly isFallbackAdapter?: boolean;
}

export interface GpuAdapterLike {
  readonly info?: GpuAdapterInfoLike;
  /** Older Chromium exposed the flag on the adapter itself. */
  readonly isFallbackAdapter?: boolean;
}

export interface GpuRequestAdapterOptionsLike {
  powerPreference?: "low-power" | "high-performance";
  featureLevel?: string;
}

/** The part of `navigator.gpu` detection uses. */
export interface GpuLike {
  requestAdapter(options?: GpuRequestAdapterOptionsLike): Promise<GpuAdapterLike | null>;
}

export interface BlocklistEntry {
  /** Case-insensitive regular expression tested against the adapter description. */
  readonly pattern: string;
  readonly reason: string;
}

export interface BackendDetectionInput {
  /** `?backend=` or a settings override; `null` runs detection. */
  readonly override: BackendOverride | null;
  /** `navigator.gpu`, or `null` / `undefined` when the browser has no WebGPU. */
  readonly gpu: GpuLike | null | undefined;
  /** Whether a WebGL2 context can be created (probed on a throwaway canvas). */
  readonly webgl2Supported: boolean;
  /** Driver blocklist (`blocklist.json` entries). */
  readonly blocklist: readonly BlocklistEntry[];
}

// ---- Result -------------------------------------------------------------------------------------------------------

export const BACKEND_DECISION_REASONS = [
  "override",
  "no-webgpu",
  "no-adapter",
  "adapter-error",
  "fallback-adapter",
  "blocklisted",
  "core-adapter",
  "compat-adapter",
  "unsupported",
] as const;
export type BackendDecisionReason = (typeof BACKEND_DECISION_REASONS)[number];

export interface BackendDecision {
  /**
   * What to ask the renderer for: `webgpu` (the WebGPU backend; it may start as `webgpu-compat`, or fall back to
   * WebGL2 by itself), `webgl2` (`forceWebGL: true`), or `unsupported` (section 2.1 step 8: show the static page).
   */
  readonly request: "webgpu" | "webgl2" | "unsupported";
  /** The backend detection expects to start; the renderer read-back is the truth. `null` when unsupported. */
  readonly expected: RenderBackend | null;
  /** `true` when the override chose the backend instead of detection. */
  readonly forced: boolean;
  readonly reason: BackendDecisionReason;
  /** `vendor architecture device description` of the adapter that was inspected; empty when none was. */
  readonly adapterDescription: string;
  /** Lower-case adapter vendor; empty when unknown. */
  readonly adapterVendor: string;
  /** The blocklist reason when `reason` is `blocklisted`. */
  readonly detail: string;
}

/** `vendor architecture device description`, single-spaced, without empty parts. */
export function describeAdapter(info: GpuAdapterInfoLike | undefined): string {
  if (info === undefined) return "";
  return [info.vendor, info.architecture, info.device, info.description]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .map((part) => part.trim())
    .join(" ");
}

/** The first blocklist entry matching `description`, or `null`. An invalid pattern never matches. */
export function matchBlocklist(description: string, blocklist: readonly BlocklistEntry[]): BlocklistEntry | null {
  if (description === "") return null;
  for (const entry of blocklist) {
    let expression: RegExp;
    try {
      expression = new RegExp(entry.pattern, "i");
    } catch {
      continue;
    }
    if (expression.test(description)) return entry;
  }
  return null;
}

function isFallbackAdapter(adapter: GpuAdapterLike): boolean {
  return adapter.info?.isFallbackAdapter === true || adapter.isFallbackAdapter === true;
}

async function requestAdapter(
  gpu: GpuLike,
  options: GpuRequestAdapterOptionsLike,
): Promise<{ adapter: GpuAdapterLike | null; failed: boolean }> {
  try {
    return { adapter: await gpu.requestAdapter(options), failed: false };
  } catch {
    return { adapter: null, failed: true };
  }
}

function decision(
  request: BackendDecision["request"],
  expected: RenderBackend | null,
  reason: BackendDecisionReason,
  adapter: GpuAdapterLike | null,
  forced = false,
  detail = "",
): BackendDecision {
  return {
    request,
    expected,
    forced,
    reason,
    adapterDescription: describeAdapter(adapter?.info),
    adapterVendor: (adapter?.info?.vendor ?? "").trim().toLowerCase(),
    detail,
  };
}

/** WebGL2 when it exists, else the "browser not supported" outcome (step 8). */
function webgl2OrUnsupported(
  input: BackendDetectionInput,
  reason: BackendDecisionReason,
  adapter: GpuAdapterLike | null,
  detail = "",
): BackendDecision {
  if (!input.webgl2Supported) return decision("unsupported", null, "unsupported", adapter);
  return decision("webgl2", "webgl2", reason, adapter, false, detail);
}

/**
 * Runs rendering-pipeline.md section 2.1 steps 1-5 and 8.
 *
 * An override skips the software-adapter and blocklist checks on purpose (QA must be able to force a backend); the
 * adapter is still requested so the tier classifier has its description.
 */
export async function detectBackend(input: BackendDetectionInput): Promise<BackendDecision> {
  const gpu = input.gpu ?? null;

  // Step 1: the override wins.
  if (input.override === "webgl2") {
    if (!input.webgl2Supported) return decision("unsupported", null, "unsupported", null, true);
    return decision("webgl2", "webgl2", "override", null, true);
  }
  if (input.override === "webgpu") {
    if (gpu === null) {
      // Nothing to force: the renderer would fall back to WebGL2 by itself; say so instead of pretending.
      if (!input.webgl2Supported) return decision("unsupported", null, "unsupported", null, true);
      return decision("webgl2", "webgl2", "no-webgpu", null, true);
    }
    const core = await requestAdapter(gpu, { powerPreference: "high-performance" });
    if (core.adapter !== null) return decision("webgpu", "webgpu", "override", core.adapter, true);
    const compat = await requestAdapter(gpu, { powerPreference: "high-performance", featureLevel: "compatibility" });
    if (compat.adapter !== null) return decision("webgpu", "webgpu-compat", "override", compat.adapter, true);
    if (!input.webgl2Supported) return decision("unsupported", null, "unsupported", null, true);
    return decision("webgl2", "webgl2", core.failed || compat.failed ? "adapter-error" : "no-adapter", null, true);
  }

  // Step 2: no navigator.gpu.
  if (gpu === null) return webgl2OrUnsupported(input, "no-webgpu", null);

  // Step 3: core adapter, else a compatibility-feature-level adapter.
  let expected: RenderBackend = "webgpu";
  let reason: BackendDecisionReason = "core-adapter";
  const core = await requestAdapter(gpu, { powerPreference: "high-performance" });
  let adapter = core.adapter;
  if (adapter === null) {
    const compat = await requestAdapter(gpu, { powerPreference: "high-performance", featureLevel: "compatibility" });
    adapter = compat.adapter;
    if (adapter === null) {
      return webgl2OrUnsupported(input, core.failed || compat.failed ? "adapter-error" : "no-adapter", null);
    }
    expected = "webgpu-compat";
    reason = "compat-adapter";
  }

  // Step 4: hardware WebGL2 beats software WebGPU.
  if (isFallbackAdapter(adapter)) {
    // Without WebGL2 a software WebGPU adapter is still better than the "not supported" page.
    if (!input.webgl2Supported) return decision("webgpu", expected, "fallback-adapter", adapter);
    return decision("webgl2", "webgl2", "fallback-adapter", adapter);
  }

  // Step 5: driver blocklist.
  const blocked = matchBlocklist(describeAdapter(adapter.info), input.blocklist);
  if (blocked !== null) return webgl2OrUnsupported(input, "blocklisted", adapter, blocked.reason);

  return decision("webgpu", expected, reason, adapter);
}

// ---- Step 6 read-back ---------------------------------------------------------------------------------------------

/**
 * Which backend an initialised renderer actually runs on (section 2.1 step 6, "read back"). `backend` is
 * `renderer.backend`; three r187 sets `isWebGPUBackend` on its WebGPU backend and `compatibilityMode` once the
 * device exists (`true` without `core-features-and-limits`). Neither flag is in the published typings, hence the
 * `in` checks.
 */
export function readStartedBackend(backend: object): RenderBackend {
  if (!("isWebGPUBackend" in backend) || backend.isWebGPUBackend !== true) return "webgl2";
  return "compatibilityMode" in backend && backend.compatibilityMode === true ? "webgpu-compat" : "webgpu";
}
