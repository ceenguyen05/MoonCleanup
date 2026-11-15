// GPU memory ledger (docs/architecture/rendering-pipeline.md section 13). No browser API reports VRAM, so every owner
// of a GPU allocation records it here: one entry per texture, render target, shadow map, geometry or particle pool, with
// its owner, category and size in bytes. The ledger sums per category against the preset's budget; the debug HUD shows the
// totals and a perf run can assert "inside budget". Pure: no three, no DOM.
//
// Use (through the `renderer` service, `renderer.memory`):
//   const id = memory.add("terrain", "terrainDust", "height cube mips", bytes);   // when the resource is created
//   memory.resize(id, bytes);                                                      // when it is reallocated
//   memory.remove(id);                                                             // in the owner's dispose()
// Entries survive a device loss: the owner recreates the resource at the same size, or resizes / removes the entry.
// `add` and `remove` may allocate (they run at load and on dispose, not per frame); `resize` and the totals do not.

import type { QualityPresetId } from "@moon-cleanup/shared";

export const MEMORY_CATEGORIES = [
  "textures",
  "geometry",
  "renderTargets",
  "shadowMaps",
  "terrainDust",
  "envProbes",
  "particles",
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

const MB = 1024 * 1024;

/** Section 13 budget per category and preset, in mebibytes. `textures` is the material texture pool of section 14. */
export const MEMORY_BUDGET_MB: Readonly<Record<QualityPresetId, Readonly<Record<MemoryCategory, number>>>> = {
  low: { textures: 480, geometry: 100, renderTargets: 40, shadowMaps: 9, terrainDust: 55, envProbes: 1, particles: 1 },
  medium: {
    textures: 600,
    geometry: 120,
    renderTargets: 60,
    shadowMaps: 16,
    terrainDust: 67,
    envProbes: 2,
    particles: 1,
  },
  high: {
    textures: 1536,
    geometry: 200,
    renderTargets: 250,
    shadowMaps: 53,
    terrainDust: 105,
    envProbes: 2,
    particles: 3,
  },
  ultra: {
    textures: 3072,
    geometry: 250,
    renderTargets: 400,
    shadowMaps: 82,
    terrainDust: 129,
    envProbes: 2,
    particles: 6,
  },
};

/** Bytes of a 2D texture or render-target attachment: `layers` array layers or cube faces, a full mip chain adds a third. */
export function textureBytes(
  widthPx: number,
  heightPx: number,
  bytesPerPixel: number,
  options: { readonly mips?: boolean; readonly layers?: number } = {},
): number {
  const base = Math.max(0, Math.floor(widthPx)) * Math.max(0, Math.floor(heightPx)) * bytesPerPixel;
  return Math.ceil(base * (options.layers ?? 1) * (options.mips === true ? 4 / 3 : 1));
}

export interface MemoryEntry {
  readonly id: number;
  readonly owner: string;
  readonly category: MemoryCategory;
  readonly label: string;
  bytes: number;
}

/** Totals read-out. Updated in place by `GpuMemoryLedger.totals`: read it, do not keep it. */
export interface MemoryTotals {
  totalBytes: number;
  budgetBytes: number;
  entries: number;
  /** Categories over their budget (count), for a quick HUD flag. */
  overCategories: number;
  readonly bytes: Record<MemoryCategory, number>;
  readonly budget: Record<MemoryCategory, number>;
}

function zeroes(): Record<MemoryCategory, number> {
  return { textures: 0, geometry: 0, renderTargets: 0, shadowMaps: 0, terrainDust: 0, envProbes: 0, particles: 0 };
}

export class GpuMemoryLedger {
  private readonly entries = new Map<number, MemoryEntry>();
  private readonly sums = zeroes();
  private readonly out: MemoryTotals = {
    totalBytes: 0,
    budgetBytes: 0,
    entries: 0,
    overCategories: 0,
    bytes: zeroes(),
    budget: zeroes(),
  };
  private preset: QualityPresetId = "medium";
  private nextId = 1;

  /** The preset whose budget the totals are judged against. */
  setPreset(preset: QualityPresetId): void {
    this.preset = preset;
  }

  /** Records one allocation; returns its id for `resize` / `remove`. Negative or non-finite sizes count as 0. */
  add(owner: string, category: MemoryCategory, label: string, bytes: number): number {
    const id = this.nextId++;
    const size = bytes > 0 && Number.isFinite(bytes) ? Math.round(bytes) : 0;
    this.entries.set(id, { id, owner, category, label, bytes: size });
    this.sums[category] += size;
    return id;
  }

  /** The allocation was recreated at another size. Unknown ids are ignored. */
  resize(id: number, bytes: number): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    const size = bytes > 0 && Number.isFinite(bytes) ? Math.round(bytes) : 0;
    this.sums[entry.category] += size - entry.bytes;
    entry.bytes = size;
  }

  /** The allocation was released. Unknown ids are ignored (a double dispose is harmless). */
  remove(id: number): void {
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    this.sums[entry.category] -= entry.bytes;
    this.entries.delete(id);
  }

  /** Bytes recorded in `category`. */
  bytesIn(category: MemoryCategory): number {
    return this.sums[category];
  }

  /** `true` when `category` holds more than the preset's budget. */
  isOver(category: MemoryCategory): boolean {
    return this.sums[category] > MEMORY_BUDGET_MB[this.preset][category] * MB;
  }

  /** Per-category bytes and budgets of the current preset. Allocates nothing; the returned object is reused. */
  get totals(): Readonly<MemoryTotals> {
    const out = this.out;
    const budgets = MEMORY_BUDGET_MB[this.preset];
    out.totalBytes = 0;
    out.budgetBytes = 0;
    out.overCategories = 0;
    out.entries = this.entries.size;
    for (const category of MEMORY_CATEGORIES) {
      const bytes = this.sums[category];
      const budget = budgets[category] * MB;
      out.bytes[category] = bytes;
      out.budget[category] = budget;
      out.totalBytes += bytes;
      out.budgetBytes += budget;
      if (bytes > budget) out.overCategories += 1;
    }
    return out;
  }

  /** Every entry, largest first (tools and the debug overlay; allocates). */
  list(): MemoryEntry[] {
    return [...this.entries.values()].map((e) => ({ ...e })).sort((a, b) => b.bytes - a.bytes);
  }
}
