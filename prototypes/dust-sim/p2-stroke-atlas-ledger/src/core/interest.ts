// P2 prototype: a client's dust interest set (WDS 5.2), as a pure function of the positions it is scanned with.
// The server keeps one mirror per client and the client keeps its own; both run this code on the same
// server-acknowledged position at the same tick, so they agree on membership without any message:
//   enter when the plot centre is within `enterM` of the position, leave beyond `leaveM` (hysteresis).
// No trigonometry (determinism rule): distances are compared through dot >= 1 - (d / R)^2 / 2.
// Environment-agnostic. scan() allocates nothing (lists are preallocated and grow by doubling).

import type { PlotTables } from "./tables";

/** Scratch shared by every InterestSet of one process (BFS stamps); holds no state between calls. */
export class InterestScratch {
  readonly stamp: Int32Array;
  readonly queue: Int32Array;
  gen = 0;
  constructor(plotCount: number) {
    this.stamp = new Int32Array(plotCount);
    this.queue = new Int32Array(plotCount);
  }
}

export class InterestSet {
  readonly member: Uint8Array;
  list = new Int32Array(256);
  n = 0;
  /** Plots that entered / left in the last scan. */
  entered = new Int32Array(256);
  enteredN = 0;
  left = new Int32Array(256);
  leftN = 0;
  private home = -1;
  private readonly cosEnter: number;
  private readonly cosLeave: number;

  constructor(
    private readonly t: PlotTables,
    private readonly scratch: InterestScratch,
    enterM: number,
    leaveM: number,
  ) {
    this.member = new Uint8Array(t.count);
    const a = enterM / t.radiusM;
    const b = leaveM / t.radiusM;
    this.cosEnter = 1 - (a * a) / 2;
    this.cosLeave = 1 - (b * b) / 2;
  }

  private static grown(a: Int32Array): Int32Array<ArrayBuffer> {
    const g = new Int32Array(a.length * 2);
    g.set(a);
    return g;
  }

  clear(): void {
    for (let i = 0; i < this.n; i++) this.member[this.list[i]!] = 0;
    this.n = 0;
    this.enteredN = 0;
    this.leftN = 0;
    this.home = -1;
  }

  /**
   * Re-evaluates the set around the unit direction pos[0 .. 2]. Results in entered / left. The position comes in a
   * Float64Array on purpose: double arguments of a call that is not inlined are boxed (16 B each).
   */
  scan(pos: Float64Array): void {
    const px = pos[0]!;
    const py = pos[1]!;
    const pz = pos[2]!;
    const t = this.t;
    const c = t.centers;
    const nbr = t.neighbors;
    this.enteredN = 0;
    this.leftN = 0;

    // Leave: members beyond the outer radius.
    let i = 0;
    while (i < this.n) {
      const p = this.list[i]!;
      const o = p * 3;
      if (px * c[o]! + py * c[o + 1]! + pz * c[o + 2]! < this.cosLeave) {
        this.member[p] = 0;
        this.list[i] = this.list[--this.n]!;
        if (this.leftN === this.left.length) this.left = InterestSet.grown(this.left);
        this.left[this.leftN++] = p;
      } else i++;
    }

    // Home plot: greedy walk from the previous home (or, without neighbours, a linear search).
    let home = this.home < 0 ? 0 : this.home;
    let best = px * c[home * 3]! + py * c[home * 3 + 1]! + pz * c[home * 3 + 2]!;
    if (t.hasNeighbors) {
      for (;;) {
        let next = home;
        for (let k = 0; k < 6; k++) {
          const q = nbr[home * 6 + k]!;
          if (q < 0) continue;
          const d = px * c[q * 3]! + py * c[q * 3 + 1]! + pz * c[q * 3 + 2]!;
          if (d > best || (d === best && q < next)) {
            best = d;
            next = q;
          }
        }
        if (next === home) break;
        home = next;
      }
    } else {
      for (let q = 0; q < t.count; q++) {
        const d = px * c[q * 3]! + py * c[q * 3 + 1]! + pz * c[q * 3 + 2]!;
        if (d > best) {
          best = d;
          home = q;
        }
      }
    }
    this.home = home;

    // Enter: breadth-first over neighbours inside the inner radius.
    const s = this.scratch;
    const gen = ++s.gen;
    const queue = s.queue;
    let head = 0;
    let tail = 0;
    queue[tail++] = home;
    s.stamp[home] = gen;
    while (head < tail) {
      const p = queue[head++]!;
      const o = p * 3;
      if (px * c[o]! + py * c[o + 1]! + pz * c[o + 2]! < this.cosEnter) continue;
      if (this.member[p] === 0) {
        this.member[p] = 1;
        if (this.n === this.list.length) this.list = InterestSet.grown(this.list);
        this.list[this.n++] = p;
        if (this.enteredN === this.entered.length) this.entered = InterestSet.grown(this.entered);
        this.entered[this.enteredN++] = p;
      }
      for (let k = 0; k < 6; k++) {
        const q = nbr[p * 6 + k]!;
        if (q < 0 || s.stamp[q] === gen) continue;
        s.stamp[q] = gen;
        queue[tail++] = q;
      }
    }
  }
}
