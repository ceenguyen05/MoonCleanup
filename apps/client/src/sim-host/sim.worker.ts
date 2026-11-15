// Module Web Worker entry of the Solo LocalRoom (ADR-0031). Created by create-local-room-host.ts with
// `new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" })`.
import { SimWorkerCore } from "./worker-core";

interface WorkerScope {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
}

const scope = globalThis as unknown as WorkerScope;
const core = new SimWorkerCore(scope);
scope.addEventListener("message", (e) => core.handle(e.data));
