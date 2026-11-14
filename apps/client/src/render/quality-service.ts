// The `quality` service: active quality settings, backend limits and the capability flags recorded at boot
// (docs/architecture/rendering-pipeline.md section 2.1 step 7, sections 2.2 and 14). Announces every change with
// the `quality.changed` event. Pure logic over the event bus; no DOM, no three.js.

import type {
  EventBus,
  HardwareTier,
  QualityChangeSource,
  QualityPresetId,
  QualityService,
  QualitySettings,
  RenderBackend,
} from "@moon-cleanup/shared";
import { clampPresetToBackend, maxPresetFor, presetBelow, resolveQuality, type GpuClass } from "./tier";

/** Capability flags of the running renderer (section 2.1 table). Never required: features degrade without them. */
export interface RenderCapabilities {
  readonly backend: RenderBackend;
  readonly tier: HardwareTier;
  readonly gpuClass: GpuClass;
  /** Best available description of the GPU (adapter info, else the WebGL renderer string); may be empty. */
  readonly gpuDescription: string;
  /** GPU timing: `timestamp-query` (WebGPU) or the disjoint timer query extension (WebGL2). */
  readonly gpuTiming: boolean;
  /** Linear filtering of 32-bit float textures. We only sample 16F, so this is informational. */
  readonly float32Filterable: boolean;
  /** BC (S3TC / RGTC / BPTC) compressed textures. */
  readonly textureCompressionBc: boolean;
  /** Reversed-Z is active. `false` selects the near/far fallback of section 4. */
  readonly reversedDepth: boolean;
}

/** The `quality` service as the render module implements it. */
export interface RenderQualityService extends QualityService {
  /** Settings in effect. The object is frozen and replaced (never mutated) on a change. */
  readonly current: QualitySettings;
  /** Highest preset the running backend offers (section 2.2). */
  readonly maxPreset: QualityPresetId;
  /** The preset detection recommends for this device ("Restore recommended"). */
  readonly recommendedPreset: QualityPresetId;
  readonly capabilities: RenderCapabilities;
  /**
   * Switches to `preset` (clamped to `maxPreset`) and emits `quality.changed` when the settings actually change.
   * Returns the settings now in effect.
   */
  setPreset(preset: QualityPresetId, source: QualityChangeSource): QualitySettings;
  /** Drops one preset (benchmark, repeated device loss). Returns `false` at Low. */
  stepDown(source: QualityChangeSource): boolean;
}

export interface QualityControllerInit {
  readonly events: Pick<EventBus, "emit">;
  readonly capabilities: RenderCapabilities;
  readonly recommendedPreset: QualityPresetId;
  readonly initialPreset: QualityPresetId;
  readonly initialSource: QualityChangeSource;
}

export class QualityController implements RenderQualityService {
  current: QualitySettings;
  maxPreset: QualityPresetId;
  recommendedPreset: QualityPresetId;
  capabilities: RenderCapabilities;

  private readonly events: Pick<EventBus, "emit">;

  constructor(init: QualityControllerInit) {
    this.events = init.events;
    this.capabilities = init.capabilities;
    this.maxPreset = maxPresetFor(init.capabilities.backend);
    this.recommendedPreset = clampPresetToBackend(init.recommendedPreset, init.capabilities.backend);
    this.current = resolveQuality(init.initialPreset, init.capabilities.backend);
    // The first choice is a change too (events/catalog: "including the first choice").
    this.events.emit("quality.changed", { settings: this.current, previous: null, source: init.initialSource });
  }

  setPreset(preset: QualityPresetId, source: QualityChangeSource): QualitySettings {
    const next = resolveQuality(preset, this.capabilities.backend);
    const previous = this.current;
    if (next === previous) return previous;
    this.current = next;
    this.events.emit("quality.changed", { settings: next, previous, source });
    return next;
  }

  stepDown(source: QualityChangeSource): boolean {
    const lower = presetBelow(this.current.preset);
    if (lower === null) return false;
    this.setPreset(lower, source);
    return true;
  }

  /**
   * The renderer was recreated (device loss) and may run on another backend: adopt the new capabilities and
   * re-resolve the active preset against the new backend's limits. Called by the render module only.
   */
  rebind(capabilities: RenderCapabilities, recommendedPreset: QualityPresetId): void {
    this.capabilities = capabilities;
    this.maxPreset = maxPresetFor(capabilities.backend);
    this.recommendedPreset = clampPresetToBackend(recommendedPreset, capabilities.backend);
    this.setPreset(this.current.preset, "detect");
  }
}
