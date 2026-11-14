// `?scene=verify&row=<n>`: one tiny scene per row of the r187 feature-verification matrix (M0-W2-T07).
// The driver (`run-matrix.mjs`) loads a row, steps frames in `?capture=1` mode, screenshots every variant and calls
// `window.__mcVerify.measure(dataUrl)`; `evaluate` turns the numbers into PASS / FAIL. No per-frame allocation here:
// the hook object is built once and rows animate with scratch values.

import type { FrameInfo } from "@moon-cleanup/shared";
import type { RenderRendererService } from "../module";
import type { RenderQualityService } from "../quality-service";
import type { SceneRoots } from "../scene-roots";
import { analyseRegions } from "./analysis";
import { findRow, VERIFY_ROWS } from "./rows";
import type { RowContext, RowDef, RowInstance, RowVerdict, VariantMeasure } from "./types";

export const VERIFY_SCENE_ID = "verify";

export interface VerifyHooks {
  readonly rows: readonly { id: number; name: string; feature: string; settleFrames: number }[];
  readonly row: number;
  readonly ready: boolean;
  readonly error: string | null;
  readonly variants: readonly string[];
  readonly settleFrames: number;
  readonly variant: string;
  setVariant(variant: string): void;
  measure(dataUrl: string | null): Promise<VariantMeasure>;
  evaluate(measures: readonly VariantMeasure[]): RowVerdict;
}

export interface VerifyHookTarget {
  __mcVerify?: VerifyHooks;
}

export interface VerifySceneOptions {
  readonly roots: SceneRoots;
  readonly renderer: RenderRendererService;
  readonly quality: RenderQualityService;
  readonly search: string;
  readonly log?: (line: string) => void;
  readonly target?: VerifyHookTarget;
}

/** Row number of `?row=` (default 1); `NaN` when it is not a number. */
export function parseRowId(search: string): number {
  const raw = new URLSearchParams(search).get("row");
  return raw === null ? 1 : Number(raw);
}

async function decode(dataUrl: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (g === null) throw new Error("verify: no 2d canvas");
  g.drawImage(image, 0, 0);
  const pixels = g.getImageData(0, 0, canvas.width, canvas.height);
  return { width: pixels.width, height: pixels.height, data: pixels.data };
}

interface HookAccess {
  isReady(): boolean;
  getError(): string | null;
  getVariant(): string;
  setVariant(variant: string): void;
}

class HookObject implements VerifyHooks {
  readonly rows = VERIFY_ROWS.map((r) => ({
    id: r.id,
    name: r.name,
    feature: r.feature,
    settleFrames: r.settleFrames,
  }));

  constructor(
    private readonly def: RowDef | null,
    private readonly instance: RowInstance | null,
    private readonly renderer: RenderRendererService,
    private readonly access: HookAccess,
  ) {}

  get row(): number {
    return this.def?.id ?? -1;
  }
  get ready(): boolean {
    return this.access.isReady();
  }
  get error(): string | null {
    return this.access.getError();
  }
  get variants(): readonly string[] {
    return this.instance?.variants ?? [];
  }
  get settleFrames(): number {
    return this.def?.settleFrames ?? 10;
  }
  get variant(): string {
    return this.access.getVariant();
  }
  setVariant(variant: string): void {
    this.access.setVariant(variant);
  }
  async measure(dataUrl: string | null): Promise<VariantMeasure> {
    const facts: Record<string, string | number | boolean | null> = {
      backend: this.renderer.backend,
      ...(this.instance?.facts() ?? {}),
    };
    const error = this.access.getError();
    if (error !== null) facts["buildError"] = error;
    const stats =
      dataUrl === null || this.instance === null ? {} : analyseRegions(await decode(dataUrl), this.instance.regions());
    return { variant: this.access.getVariant(), facts, stats, rects: this.instance?.regions() ?? {} };
  }
  evaluate(measures: readonly VariantMeasure[]): RowVerdict {
    if (this.def === null) return { verdict: "FAIL", notes: ["FAIL no such row"] };
    const failed = measures.find((m) => m.facts["buildError"] !== undefined);
    if (failed !== undefined) return { verdict: "FAIL", notes: [`FAIL ${String(failed.facts["buildError"])}`] };
    return this.def.evaluate(measures, this.renderer.backend);
  }
}

export class VerifyScene {
  readonly def: RowDef | null;

  private readonly instance: RowInstance | null;
  private readonly target: VerifyHookTarget;
  private readonly renderer: RenderRendererService;
  private ready = false;
  private error: string | null = null;
  private variant = "";
  private disposed = false;

  constructor(options: VerifySceneOptions) {
    const log = options.log ?? ((line) => console.info(line));
    this.target = options.target ?? (globalThis as unknown as VerifyHookTarget);
    this.renderer = options.renderer;
    const rowId = parseRowId(options.search);
    this.def = findRow(rowId);
    let instance: RowInstance | null = null;
    if (this.def === null) {
      this.error = `unknown row ${String(rowId)}`;
    } else {
      const ctx: RowContext = {
        roots: options.roots,
        renderer: options.renderer,
        quality: options.quality,
        backend: options.renderer.backend,
        params: new URLSearchParams(options.search),
        log,
      };
      try {
        instance = this.def.build(ctx);
        this.variant = instance.variants[0] ?? "";
        instance.setVariant(this.variant);
        instance.ready.then(
          () => {
            this.ready = true;
          },
          (e: unknown) => {
            this.error = `async setup failed: ${e instanceof Error ? e.message : String(e)}`;
            this.ready = true;
          },
        );
      } catch (e) {
        this.error = `build failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    this.instance = instance;
    if (this.error !== null) log(`[verify] ${this.error}`);
    else log(`[verify] row=${String(this.def?.id)} "${this.def?.name ?? ""}" backend=${options.renderer.backend}`);
    this.installHooks();
  }

  update(frame: FrameInfo): void {
    if (this.disposed) return;
    this.instance?.update(frame);
  }

  private installHooks(): void {
    this.target.__mcVerify = new HookObject(this.def, this.instance, this.renderer, {
      isReady: () => this.ready && this.error === null,
      getError: () => this.error,
      getVariant: () => this.variant,
      setVariant: (variant) => {
        this.variant = variant;
        this.instance?.setVariant(variant);
      },
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.target.__mcVerify !== undefined) delete this.target.__mcVerify;
    this.renderer.setPipelineStages(null);
    this.instance?.dispose();
  }
}
