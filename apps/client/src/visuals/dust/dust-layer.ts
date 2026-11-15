// The client dust layer (M1-W3-T02): one tile atlas (CPU bookkeeping), its per-frame batch and the GPU replay pass,
// driven in the order the visuals module needs: `bind()` at boot, then per rendered frame `update()` BEFORE the main
// render (atlas.frame() fills the batch, flush() draws it), so the ground samples this frame's strokes.
//
// The host feeds it: after its ledger applied a stroke it calls `atlas.onStroke(...)`, and it forwards the ledger's
// zero-cell and Polished queues (`atlas.onLedgerZero`, `atlas.onPolished`). See tile-atlas.ts for the contract.

import type { WebGPURenderer } from "three/webgpu";
import type { IcoPlotGrid } from "@moon-cleanup/world";
import { DustReplayBatch } from "./replay-batch";
import { DustReplayPass } from "./replay-pass";
import { DustTileAtlas, type DustLedgerView, type DustTileAtlasOptions } from "./tile-atlas";

export class DustLayer {
  readonly pass: DustReplayPass;
  private prepared = false;

  constructor(
    readonly atlas: DustTileAtlas,
    readonly batch: DustReplayBatch,
  ) {
    this.pass = new DustReplayPass(atlas.layout, batch);
  }

  static create(grid: IcoPlotGrid, ledger: DustLedgerView, options: DustTileAtlasOptions): DustLayer {
    return new DustLayer(new DustTileAtlas(grid, ledger, options), new DustReplayBatch());
  }

  /**
   * Binds the layer to a renderer: creates the replay pipelines outside the first frame. On a renderer that replaces
   * an earlier one (device loss) the GPU atlas is empty, so every resident tile is rebuilt from ledger and logs.
   * Call between frames (never between `atlas.frame()` and the flush of its batch).
   */
  bind(renderer: WebGPURenderer): void {
    if (this.prepared) this.atlas.rebuildAll();
    this.prepared = true;
    this.pass.prepare(renderer);
  }

  /** One rendered frame with the camera above unit direction (x, y, z). Call before the main render. */
  update(x: number, y: number, z: number, renderer: WebGPURenderer): void {
    this.atlas.frame(x, y, z, this.batch);
    this.pass.flush(renderer);
  }

  dispose(): void {
    this.pass.dispose();
  }
}
