// Shape of one row of the r187 feature-verification matrix (rendering-pipeline.md section 21, M0-W2-T07).
// A row is a tiny scene reachable as `?scene=verify&row=<n>`; the driver steps frames, screenshots every variant and
// asks the page to measure named screen regions. The row's `evaluate` turns the numbers into PASS / FAIL.

import type { FrameInfo, RenderBackend } from "@moon-cleanup/shared";
import type { RenderRendererService } from "../module";
import type { RenderQualityService } from "../quality-service";
import type { SceneRoots } from "../scene-roots";
import type { Rect, RegionStats } from "./analysis";

export type VerifyVerdict = "PASS" | "FAIL" | "N/A";

export interface RowVerdict {
  readonly verdict: VerifyVerdict;
  /** One line per check: what was measured and the threshold. */
  readonly notes: readonly string[];
}

/** What one variant of a row measured. */
export interface VariantMeasure {
  readonly variant: string;
  readonly facts: Readonly<Record<string, string | number | boolean | null>>;
  readonly stats: Readonly<Record<string, RegionStats>>;
  /** The rectangles that were measured (image fractions), for debugging region placement. */
  readonly rects?: Readonly<Record<string, Rect>>;
}

export interface RowContext {
  readonly roots: SceneRoots;
  readonly renderer: RenderRendererService;
  readonly quality: RenderQualityService;
  readonly backend: RenderBackend;
  readonly params: URLSearchParams;
  readonly log: (line: string) => void;
}

/** A built row: owns its objects and releases them in `dispose`. */
export interface RowInstance {
  /** Variant ids, in the order the driver measures them. */
  readonly variants: readonly string[];
  /** Resolves when the row's asynchronous set-up (PMREM, compute, adapter probe) is done. */
  readonly ready: Promise<void>;
  setVariant(variant: string): void;
  /** Called once per frame right before the pipeline renders. Must not allocate. */
  update(frame: FrameInfo): void;
  /** Non-pixel measurements of the current variant (sizes, counts, flags, caught errors). */
  facts(): Record<string, string | number | boolean | null>;
  /** Screen rectangles to measure for the current variant. */
  regions(): Record<string, Rect>;
  dispose(): void;
}

export interface RowDef {
  readonly id: number;
  readonly name: string;
  /** rendering-pipeline.md section 21 feature text, for the report. */
  readonly feature: string;
  /** Frames the driver steps after a variant change before it screenshots. */
  readonly settleFrames: number;
  build(ctx: RowContext): RowInstance;
  evaluate(measures: readonly VariantMeasure[], backend: RenderBackend): RowVerdict;
}

export type { FrameInfo };
