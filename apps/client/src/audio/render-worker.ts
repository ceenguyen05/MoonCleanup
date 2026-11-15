// Dedicated worker: renders procedural cue PCM off the main thread (first-play render freeze fix). Pure DSP only; no DOM.
// Protocol: main posts {id, variant}; worker replies {id, variant, pcm, loop, sampleRate} with pcm transferred.

import { renderCuePcm, type RenderReply, type RenderRequest } from "./buffer-store";
import { renderLayer } from "./music-recipes";

interface WorkerScope {
  onmessage: ((e: { data: RenderRequest }) => void) | null;
  postMessage(message: RenderReply, transfer: Transferable[]): void;
}

/** Handles one request; exported so the protocol is testable in Node. */
export function handleRenderRequest(req: RenderRequest): RenderReply {
  if (req.kind === "layer") {
    const pcm = (renderLayer(req.set, req.layer) ?? new Float32Array(0)).slice();
    return { kind: "layer", set: req.set, layer: req.layer, pcm };
  }
  const r = renderCuePcm(req.id, req.variant);
  const pcm = r.pcm.slice(); // exact-length owned buffer (loop recipes return a subarray view)
  return { kind: "cue", id: req.id, variant: req.variant, pcm, loop: r.loop, sampleRate: r.sampleRate };
}

if (typeof window === "undefined" && typeof self !== "undefined" && "postMessage" in self) {
  const scope = self as unknown as WorkerScope;
  scope.onmessage = (e): void => {
    const reply = handleRenderRequest(e.data);
    scope.postMessage(reply, [reply.pcm.buffer]);
  };
}
