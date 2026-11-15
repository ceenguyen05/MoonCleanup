// Test worker: runs packages/sim's 10,000-tick golden replay (the exact script the Node and main-thread browser lanes
// run) inside a dedicated module Web Worker and posts the result. Message "go": the sim's stand-in ledger (the
// original golden); "go-world": the real dust ledger of packages/world (what the Solo worker runs).
import { runGoldenReplay, runWorldLedgerGoldenReplay } from "../../../../../packages/sim/test/golden/replay";

const scope = globalThis as unknown as {
  postMessage(m: unknown): void;
  addEventListener(t: "message", l: (e: { data: unknown }) => void): void;
};
scope.addEventListener("message", (e) => {
  const t0 = performance.now();
  const result = e.data === "go-world" ? runWorldLedgerGoldenReplay() : runGoldenReplay();
  scope.postMessage({
    result,
    ms: performance.now() - t0,
    inWorker: typeof (globalThis as { document?: unknown }).document === "undefined",
  });
});
