// Module Web Worker entry: raw-DEFLATE inflate for DUST_SNAPSHOT (online rooms only). Created by
// inflate-worker-client.ts with `new Worker(new URL("./inflate.worker.ts", import.meta.url), { type: "module" })`.
import { runInflateJob, type InflateJob } from "./inflate-worker-core";

interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
}

const scope = globalThis as unknown as WorkerScope;
scope.addEventListener("message", (e) => {
  const job = e.data as InflateJob;
  if (typeof job !== "object" || job === null || !(job.data instanceof Uint8Array)) return;
  const result = runInflateJob(job);
  scope.postMessage(result, result.out === null ? [] : [result.out.buffer]);
});
