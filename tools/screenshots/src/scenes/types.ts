import type { Preset, Tier, Tod } from "../naming";

/**
 * Scene registry entry. The actual scene list (S01..S18, CMP, camera paths) is owned by visual-qa-reviewer
 * (visual-target 6.2); the harness works with any scene id the client understands via `?scene=`.
 */
export interface SceneDef {
  readonly id: string;
  readonly tods: readonly Tod[];
  readonly tiers: readonly Tier[];
  readonly presets: readonly Preset[];
}
