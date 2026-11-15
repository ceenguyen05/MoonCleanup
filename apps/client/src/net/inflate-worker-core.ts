// Message contract and pure core of the dust-snapshot inflate worker (online rooms only, never constructed in solo).
// The worker runs `inflateRaw` (./inflate-raw) off the main thread; `DustOffload` (./dust-offload) owns the main-thread
// side: hold-back queue, timeout, sync fallback. This file has no DOM / Worker references so tests can drive it.

import type { Inflate } from "@moon-cleanup/protocol";
import { inflateRaw } from "./inflate-raw";

/** Main thread -> worker. `data` is structured-cloned (the main thread keeps its copy for the sync fallback). */
export interface InflateJob {
  readonly id: number;
  readonly data: Uint8Array;
  readonly maxBytes: number;
}

/** Worker -> main thread. `out` is transferred; null for corrupt input or an output past `maxBytes`. */
export interface InflateResult {
  readonly id: number;
  readonly out: Uint8Array | null;
}

/** The slice of the Worker API the offload needs (tests substitute worker_threads or a manual port). */
export interface InflateWorkerPort {
  postMessage(job: InflateJob): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

/** True when `value` is a well-formed InflateResult (the main thread never trusts the worker's message shape). */
export function isInflateResult(value: unknown): value is InflateResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { id?: unknown; out?: unknown };
  return typeof v.id === "number" && (v.out === null || v.out instanceof Uint8Array);
}

/** Worker side of one job. Never throws. */
export function runInflateJob(job: InflateJob, inflate: Inflate = inflateRaw): InflateResult {
  const out = inflate(job.data, job.maxBytes);
  return { id: job.id, out };
}
