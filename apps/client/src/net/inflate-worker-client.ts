// Spawns the dust-snapshot inflate worker. Dynamic-imported by room-session.ts for online rooms only, so the Worker
// constructor and the worker chunk never load in solo (ADR-0031).
import type { InflateJob, InflateResult, InflateWorkerPort } from "./inflate-worker-core";

export function createInflateWorker(): InflateWorkerPort {
  const worker = new Worker(new URL("./inflate.worker.ts", import.meta.url), { type: "module", name: "dust-inflate" });
  const port: InflateWorkerPort = {
    postMessage: (job: InflateJob) => worker.postMessage(job),
    onmessage: null,
    onerror: null,
    terminate: () => worker.terminate(),
  };
  worker.onmessage = (e: MessageEvent<InflateResult>) => port.onmessage?.({ data: e.data });
  worker.onerror = (e) => port.onerror?.(e);
  worker.onmessageerror = (e) => port.onerror?.(e);
  return port;
}
