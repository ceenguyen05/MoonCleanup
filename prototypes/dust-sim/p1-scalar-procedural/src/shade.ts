// P1 client visuals, part 3 (CPU reference of the fragment function): how the dissolve (from L0) and the ring combine
// into dust opacity, and the local credit that stops the two from showing the same removal twice.
// Environment-agnostic, no imports at run time.

/** Dust counts as present until less than about 8 % of the layer is left (WDS 7.7: tau = 0.04 .. 0.12). */
const PRESENT_LOW = 0.04;
const PRESENT_HIGH = 0.12;

/** 1 while dust remains at a swept share, 0 once it is swept clean. */
export function presentAt(swept: number): number {
  let t = (1 - swept - PRESENT_LOW) / (PRESENT_HIGH - PRESENT_LOW);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** Opacity of present dust at a swept share: progressive thinning of WDS 7.7 (0.35 + 0.65 R). */
export function thicknessAt(swept: number): number {
  return 0.35 + 0.65 * (1 - swept);
}

/**
 * Dust opacity and presence mask of one fragment.
 *   dissolve: 0..1 dust presence from the L0 dissolve (anti-aliased by the caller);
 *   low, high, edge: the two ring plateaus and the blend weight from DetailRing.edgeAt.
 * Each side of a ring edge gets its own opacity and the edge weight blends the two, so an edge is one anti-aliased
 * step. (Blending the swept share first and shading afterwards is what made the 20 px thinning ramp.)
 *   out[0] = opacity (0 clean .. 1 full grime), out[1] = presence mask.
 */
export function composeDust(dissolve: number, low: number, high: number, edge: number, out: Float64Array): void {
  const pLow = presentAt(low);
  const pHigh = presentAt(high);
  out[0] = dissolve * ((1 - edge) * pLow * thicknessAt(low) + edge * pHigh * thicknessAt(high));
  out[1] = dissolve * ((1 - edge) * pLow + edge * pHigh);
}

/**
 * Local ring credit. A plot's L0 fraction drops when the viewer sweeps it, and the ring already shows that removal
 * exactly where it happened. Without a correction the dissolve would open random holes for the same dust a second
 * time. The client therefore remembers, per plot, the units its own in-ring strokes removed and adds them back to
 * the fraction it feeds the dissolve. Credit is dropped when the plot leaves the ring window (the trail is gone then
 * and the dissolve takes over). Bounded: at most 64 credited plots (a ring covers about 12).
 */
export class RingCredit {
  readonly units: Uint32Array;
  private readonly list = new Int32Array(64);
  count = 0;

  constructor(plotCount: number) {
    this.units = new Uint32Array(plotCount);
  }

  add(plot: number, units: number): void {
    if ((this.units[plot] ?? 0) === 0) {
      if (this.count === this.list.length) return;
      this.list[this.count] = plot;
      this.count++;
    }
    this.units[plot] = (this.units[plot] ?? 0) + units;
  }

  /** Plot at position k of the credited list (k < count). */
  plotAt(k: number): number {
    return this.list[k] ?? 0;
  }

  /** Drops the credit of the plot at position k (swap-remove). */
  dropAt(k: number): void {
    this.units[this.list[k] ?? 0] = 0;
    this.count--;
    this.list[k] = this.list[this.count] ?? 0;
  }

  clear(): void {
    while (this.count > 0) this.dropAt(this.count - 1);
  }

  /** Fraction 0..255 to feed the dissolve: the L0 fraction plus the share the ring already shows. */
  displayFrac(plot: number, frac: number, capacity: number): number {
    const c = this.units[plot] ?? 0;
    if (c === 0 || frac === 0) return frac;
    const d = frac + Math.round((255 * c) / capacity);
    // One step of rounding slack: a plot only the viewer touched must show no dissolve holes at all.
    return d >= 254 ? 255 : d;
  }
}
