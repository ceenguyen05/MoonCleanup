// Canvas size and device pixel ratio: docs/architecture/rendering-pipeline.md section 9 ("Output = CSS x min(DPR,
// cap)") and section 14 (DPR cap per preset). The cap applies to the canvas only; the DOM UI stays at native DPR.
//
// ViewportTracker is polled once per frame by the frame loop, so a resize is applied at a frame boundary and a
// window drag does not resize GPU targets more than once per frame. `poll()` allocates nothing.

import type { ViewportSize } from "@moon-cleanup/shared";

/** Canvas device pixel ratio: the device value limited by the preset cap, never below a sane minimum. */
export function effectiveDpr(deviceDpr: number, dprCap: number): number {
  const device = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  return Math.min(device, dprCap);
}

/** Drawing-buffer size in physical pixels for a CSS size and DPR (matches three's `setSize` rounding: floor). */
export function drawingBufferSize(cssPx: number, dpr: number): number {
  return Math.max(1, Math.floor(cssPx * dpr));
}

interface MutableViewport {
  widthCssPx: number;
  heightCssPx: number;
  dpr: number;
}

/** The element whose box the canvas fills. */
export interface ViewportElementLike {
  readonly clientWidth: number;
  readonly clientHeight: number;
}

/** What the tracker keeps of a ResizeObserver that is already observing the element (injectable for tests). */
export interface ResizeObserverLike {
  disconnect(): void;
}

export interface ViewportTrackerOptions {
  readonly element: ViewportElementLike;
  /** Device pixel ratio source (`window.devicePixelRatio`, or the `?dpr=` override). Read on every poll. */
  readonly getDeviceDpr: () => number;
  /** DPR cap of the active quality settings. Read on every poll, so a preset change is picked up by itself. */
  readonly getDprCap: () => number;
  /**
   * Starts an observer that calls `onResize` when the element's box changes. Omitted: the element's client size
   * is read on every poll instead (fine for tests; in the browser a ResizeObserver avoids a layout read per frame).
   */
  readonly observe?: (onResize: () => void) => ResizeObserverLike;
}

export class ViewportTracker {
  /** The viewport in effect. The same object is updated in place by `poll()`: read it, do not keep a copy. */
  readonly current: ViewportSize;

  private readonly state: MutableViewport;
  private readonly options: ViewportTrackerOptions;
  private readonly observer: ResizeObserverLike | null;
  private sizeDirty = true;

  constructor(options: ViewportTrackerOptions) {
    this.options = options;
    this.state = { widthCssPx: 0, heightCssPx: 0, dpr: 1 };
    this.current = this.state;
    this.observer =
      options.observe?.(() => {
        this.sizeDirty = true;
      }) ?? null;
  }

  /**
   * Refreshes `current`. Returns `true` when width, height or DPR changed since the previous poll (always `true`
   * on the first poll with a non-empty element). An empty (0 x 0, hidden) element changes nothing.
   */
  poll(): boolean {
    const state = this.state;
    let changed = false;

    if (this.sizeDirty || this.observer === null) {
      const width = this.options.element.clientWidth;
      const height = this.options.element.clientHeight;
      if (width > 0 && height > 0) {
        this.sizeDirty = false;
        if (width !== state.widthCssPx || height !== state.heightCssPx) {
          state.widthCssPx = width;
          state.heightCssPx = height;
          changed = true;
        }
      }
    }

    const dpr = effectiveDpr(this.options.getDeviceDpr(), this.options.getDprCap());
    if (dpr !== state.dpr) {
      state.dpr = dpr;
      changed = state.widthCssPx > 0 && state.heightCssPx > 0;
    }

    return changed;
  }

  /** Forces the next poll to re-read the element size (after the canvas was replaced). */
  invalidate(): void {
    this.sizeDirty = true;
  }

  dispose(): void {
    this.observer?.disconnect();
  }
}
