// Property tests of the GP(m,0) plot grid (WDS sections 2.1 to 2.7): every plot, both contract sizes.
import { beforeAll, describe, expect, it } from "vitest";
import {
  MOONLET_GRID_PARAMS,
  NO_NEIGHBOR,
  PLOT_DISPLAY_ID_PATTERN,
  STANDARD_GRID_PARAMS,
  STANDARD_NEIGHBOR_ENTRIES,
  type PlotGridParams,
  type PlotId,
} from "@moon-cleanup/shared";
import {
  canonicalPlotId,
  createPlotGrid,
  formatPlotDisplayId,
  goldenPoints,
  mulberry32,
  parsePlotDisplayId,
  plotIdFromDisplayId,
  type IcoPlotGrid,
} from "../../src/index";

const SLOW = 120_000;

function bruteNearest(g: IcoPlotGrid, x: number, y: number, z: number): number {
  let best = -1;
  let bestDot = -Infinity;
  const c = g.centers;
  for (let id = 0; id < g.count; id++) {
    const d = (c[id * 3] ?? 0) * x + (c[id * 3 + 1] ?? 0) * y + (c[id * 3 + 2] ?? 0) * z;
    if (d > bestDot) {
      bestDot = d;
      best = id;
    }
  }
  return best;
}

function dotC(g: IcoPlotGrid, id: number, x: number, y: number, z: number): number {
  return (g.centers[id * 3] ?? 0) * x + (g.centers[id * 3 + 1] ?? 0) * y + (g.centers[id * 3 + 2] ?? 0) * z;
}

/** True when `id` beats every plot within two rings (ties to the lower id): the WDS 2.6 answer, checked locally. */
function isLocalBest(g: IcoPlotGrid, id: number, x: number, y: number, z: number): boolean {
  const nb = g.neighborTable;
  const best = dotC(g, id, x, y, z);
  for (let k = 0; k < 6; k++) {
    const q = nb[id * 6 + k] ?? NO_NEIGHBOR;
    if (q === NO_NEIGHBOR) continue;
    for (const r of [q, ...Array.from({ length: 6 }, (_, s) => nb[q * 6 + s] ?? NO_NEIGHBOR)]) {
      if (r === NO_NEIGHBOR || r === id) continue;
      const d = dotC(g, r, x, y, z);
      if (d > best || (d === best && r < id)) return false;
    }
  }
  return true;
}

function suite(name: string, params: PlotGridParams): void {
  describe(name, () => {
    let g: IcoPlotGrid;
    beforeAll(() => {
      g = createPlotGrid(params);
    }, SLOW);

    it("counts match WDS 2.1", () => {
      const m = params.gridM;
      expect(g.count).toBe(10 * m * m + 2);
      expect(g.params).toBe(params);
      let pent = 0;
      let entries = 0;
      for (let id = 0; id < g.count; id++) {
        const n = g.neighborCount(id as PlotId);
        entries += n;
        if (n === 5) {
          pent++;
          expect(g.isPentagon(id as PlotId)).toBe(true);
        } else expect(g.isPentagon(id as PlotId)).toBe(false);
      }
      expect(pent).toBe(12);
      expect(entries).toBe((g.count - 12) * 6 + 60);
      if (m === 128) expect(entries).toBe(STANDARD_NEIGHBOR_ENTRIES);
      // Euler: V - E + F = 2 with F = 20 m^2, E = entries / 2.
      expect(g.count - entries / 2 + 20 * m * m).toBe(2);
      expect(g.buildTriangleIndices().length).toBe(20 * m * m * 3);
    });

    it("pentagons are the poles and the diamond origins", () => {
      const m2 = params.gridM * params.gridM;
      const expected = [
        ...Array.from({ length: 10 }, (_, d) => d * m2),
        params.northPolePlotId,
        params.southPolePlotId,
      ];
      const found: number[] = [];
      for (let id = 0; id < g.count; id++) if (g.isPentagon(id as PlotId)) found.push(id);
      expect(found).toEqual(expected);
    });

    it("neighbour table is symmetric, unit centres, neighbours are close", () => {
      const nb = g.neighborTable;
      let maxChord = 0;
      let minChord = Infinity;
      for (let id = 0; id < g.count; id++) {
        const c = g.centerDirection(id as PlotId);
        expect(Math.abs(c.x * c.x + c.y * c.y + c.z * c.z - 1)).toBeLessThan(1e-15);
        for (let k = 0; k < 6; k++) {
          const q = nb[id * 6 + k] ?? NO_NEIGHBOR;
          if (q === NO_NEIGHBOR) {
            expect(k).toBe(5);
            continue;
          }
          let back = false;
          for (let r = 0; r < 6; r++) if (nb[q * 6 + r] === id) back = true;
          if (!back) throw new Error(`asymmetric ${id} -> ${q}`);
          const chord = Math.sqrt(2 - 2 * dotC(g, q, c.x, c.y, c.z)) * params.radiusM;
          maxChord = Math.max(maxChord, chord);
          minChord = Math.min(minChord, chord);
        }
      }
      // WDS 2.8: mean centre spacing 18.9 m, edge length max/min about 1.195 (R scales with m, so same for Moonlet).
      expect(minChord).toBeGreaterThan(15);
      expect(maxChord).toBeLessThan(23);
      expect(maxChord / minChord).toBeLessThan(1.3);
    });

    it("neighbour order: counter-clockwise from the one closest to local east", () => {
      for (let id = 0; id < g.count; id++) {
        const f = g.frame(id as PlotId);
        const view = g.neighbors(id as PlotId);
        const n = view.length;
        const angles: number[] = [];
        const cosines: number[] = [];
        for (let k = 0; k < n; k++) {
          const q = g.centerDirection(view[k] as PlotId);
          const dx = q.x - f.normal.x;
          const dy = q.y - f.normal.y;
          const dz = q.z - f.normal.z;
          const du = dx * f.east.x + dy * f.east.y + dz * f.east.z;
          const dv = dx * f.north.x + dy * f.north.y + dz * f.north.z;
          angles.push(Math.atan2(dv, du));
          cosines.push(du / Math.hypot(du, dv));
        }
        expect(Math.max(...cosines)).toBe(cosines[0]);
        for (let k = 1; k < n; k++) {
          let step = (angles[k] ?? 0) - (angles[k - 1] ?? 0);
          if (step < 0) step += 2 * Math.PI;
          if (!(step > 0.6 && step < 2 * Math.PI * 0.5)) throw new Error(`plot ${id}: slot ${k} not CCW (${step})`);
        }
      }
    });

    it("every plot centre maps to itself, with and without hint", () => {
      for (let id = 0; id < g.count; id++) {
        const c = g.centerDirection(id as PlotId);
        if (g.plotAt(c) !== id) throw new Error(`plotAt(centre(${id})) = ${g.plotAt(c)}`);
        if (g.plotAt(c, id as PlotId) !== id) throw new Error(`hinted plotAt(centre(${id}))`);
      }
    });

    it(
      "random points agree with brute force",
      () => {
        const pts = goldenPoints(150, 0x12345);
        const dir = { x: 0, y: 0, z: 0 };
        for (let k = 0; k < 150; k++) {
          dir.x = pts[k * 3] ?? 0;
          dir.y = pts[k * 3 + 1] ?? 0;
          dir.z = pts[k * 3 + 2] ?? 0;
          expect(g.plotAt(dir)).toBe(bruteNearest(g, dir.x, dir.y, dir.z));
        }
      },
      SLOW,
    );

    it(
      "points near pentagons, seams and cell borders are locally nearest; hint never changes the answer",
      () => {
        const rnd = mulberry32(99);
        const dir = { x: 0, y: 0, z: 0 };
        const probe = (x: number, y: number, z: number, hint: number): void => {
          const len = Math.hypot(x, y, z);
          dir.x = x / len;
          dir.y = y / len;
          dir.z = z / len;
          const full = g.plotAt(dir);
          if (!isLocalBest(g, full, dir.x, dir.y, dir.z)) throw new Error(`not nearest at ${dir.x},${dir.y},${dir.z}`);
          expect(g.plotAt(dir, hint as PlotId)).toBe(full);
        };
        const m = params.gridM;
        const spacing = 0.0095 / (m / 128); // about half a plot spacing in radians
        for (let id = 0; id < g.count; id++) {
          const c = g.centerDirection(id as PlotId);
          const onSeam = id >= 10 * m * m || id % m === 0 || Math.floor(id / m) % m === 0 || id % m === m - 1;
          const tries = g.isPentagon(id as PlotId) ? 200 : onSeam ? 3 : id % 97 === 0 ? 2 : 0;
          for (let t = 0; t < tries; t++) {
            const ex = (rnd() / 2147483648 - 1) * spacing;
            const ey = (rnd() / 2147483648 - 1) * spacing;
            const ez = (rnd() / 2147483648 - 1) * spacing;
            probe(c.x + ex, c.y + ey, c.z + ez, id);
          }
          // midpoint of each edge: a Voronoi border point, exercises ties/rounding
          if (onSeam || g.isPentagon(id as PlotId)) {
            const view = g.neighbors(id as PlotId);
            for (let k = 0; k < view.length; k++) {
              const q = g.centerDirection(view[k] as PlotId);
              probe(c.x + q.x, c.y + q.y, c.z + q.z, view[k] ?? 0);
            }
          }
        }
      },
      SLOW,
    );

    it("hinted path follows a moving point and survives far hints", () => {
      const rnd = mulberry32(7);
      const dir = { x: 1, y: 0.2, z: 0.1 };
      let hint = g.plotAt(dir);
      for (let step = 0; step < 20_000; step++) {
        dir.x += (rnd() / 2147483648 - 1) * 0.004;
        dir.y += (rnd() / 2147483648 - 1) * 0.004;
        dir.z += (rnd() / 2147483648 - 1) * 0.004;
        const len = Math.hypot(dir.x, dir.y, dir.z);
        dir.x /= len;
        dir.y /= len;
        dir.z /= len;
        const full = g.plotAt(dir);
        const hinted = g.plotAt(dir, hint);
        if (hinted !== full) throw new Error(`hint ${hint} gave ${hinted}, full ${full}`);
        hint = hinted;
      }
      // far / bogus hints fall back to the full path
      const p = { x: 0, y: 0, z: 1 };
      const truth = g.plotAt(p);
      for (const h of [0, params.northPolePlotId, g.count - 1, -1, g.count, 1.5, Number.NaN]) {
        expect(g.plotAt(p, h as PlotId)).toBe(truth);
      }
    });

    it("chunks and display ids round-trip for every plot", () => {
      const perChunk = new Int32Array(params.chunkCount);
      for (let id = 0; id < g.count; id++) {
        const c = g.chunkOf(id as PlotId);
        const l = g.localIndexOf(id as PlotId);
        perChunk[c] = (perChunk[c] ?? 0) + 1;
        if (g.plotAtChunkLocal(c, l) !== id) throw new Error(`chunk round trip ${id}`);
      }
      for (let c = 0; c < params.poleChunkId; c++) expect(perChunk[c]).toBe(256);
      expect(perChunk[params.poleChunkId]).toBe(2);
      expect(g.chunkOf(params.northPolePlotId as PlotId)).toBe(params.poleChunkId);
      expect(g.localIndexOf(params.northPolePlotId as PlotId)).toBe(0);
      expect(g.localIndexOf(params.southPolePlotId as PlotId)).toBe(1);
      for (const id of [0, 1234, g.count - 3, params.northPolePlotId, params.southPolePlotId]) {
        const text = formatPlotDisplayId(g, id as PlotId);
        expect(text).toMatch(PLOT_DISPLAY_ID_PATTERN);
        expect(plotIdFromDisplayId(g, text)).toBe(id);
      }
      expect(parsePlotDisplayId("Plot 41-207")).toEqual({ chunkId: 41, localIndex: 207 });
      expect(parsePlotDisplayId("plot 41-207")).toBeNull();
      expect(plotIdFromDisplayId(g, `Plot ${params.poleChunkId}-2`)).toBeNull();
      expect(plotIdFromDisplayId(g, "Plot 999-1")).toBeNull();
    });

    it("lattice remaps: far diamond edges resolve to the owning diamond (WDS 2.3)", () => {
      const m = params.gridM;
      for (let d = 0; d < 5; d++) {
        expect(g.plotAtLattice(d, m, 0)).toBe(params.northPolePlotId);
        expect(g.plotAtLattice(5 + d, 0, m)).toBe(params.southPolePlotId);
        for (let t = 0; t <= m; t += 7) {
          expect(g.plotAtLattice(d, m, t)).toBe(canonicalPlotId(m, (d + 1) % 5, m - t, 0));
          expect(g.plotAtLattice(d, t, m)).toBe(canonicalPlotId(m, 5 + d, t, 0));
          expect(g.plotAtLattice(5 + d, m, t)).toBe(canonicalPlotId(m, (d + 1) % 5, 0, t));
          expect(g.plotAtLattice(5 + d, t, m)).toBe(canonicalPlotId(m, 5 + ((d + 1) % 5), 0, m - t));
        }
      }
      expect(() => g.plotAtLattice(10, 0, 0)).toThrow(RangeError);
    });

    it("orbit triangles are counter-clockwise seen from outside", () => {
      const tri = g.buildTriangleIndices();
      const c = g.centers;
      for (let t = 0; t < tri.length; t += 3) {
        const a = (tri[t] ?? 0) * 3;
        const b = (tri[t + 1] ?? 0) * 3;
        const e = (tri[t + 2] ?? 0) * 3;
        const abx = (c[b] ?? 0) - (c[a] ?? 0);
        const aby = (c[b + 1] ?? 0) - (c[a + 1] ?? 0);
        const abz = (c[b + 2] ?? 0) - (c[a + 2] ?? 0);
        const aex = (c[e] ?? 0) - (c[a] ?? 0);
        const aey = (c[e + 1] ?? 0) - (c[a + 1] ?? 0);
        const aez = (c[e + 2] ?? 0) - (c[a + 2] ?? 0);
        const nx = aby * aez - abz * aey;
        const ny = abz * aex - abx * aez;
        const nz = abx * aey - aby * aex;
        if (nx * (c[a] ?? 0) + ny * (c[a + 1] ?? 0) + nz * (c[a + 2] ?? 0) <= 0) throw new Error(`triangle ${t / 3}`);
      }
    });

    it("tangent frames are orthonormal, right-handed and north-pointing (WDS 2.7)", () => {
      let worst = 0;
      for (let id = 0; id < g.count; id++) {
        const { normal: n, east: e, north: t } = g.frame(id as PlotId);
        const dot = (a: typeof n, b: typeof n) => a.x * b.x + a.y * b.y + a.z * b.z;
        worst = Math.max(
          worst,
          Math.abs(dot(e, e) - 1),
          Math.abs(dot(t, t) - 1),
          Math.abs(dot(e, n)),
          Math.abs(dot(t, n)),
          Math.abs(dot(e, t)),
          // e x t = n
          Math.abs(e.y * t.z - e.z * t.y - n.x),
          Math.abs(e.z * t.x - e.x * t.z - n.y),
          Math.abs(e.x * t.y - e.y * t.x - n.z),
        );
        if (e.y !== 0) throw new Error(`east of ${id} not horizontal`);
        if (id < 10 * params.gridM * params.gridM && !(t.y > 0)) throw new Error(`north of ${id} not northward`);
      }
      expect(worst).toBeLessThan(1e-14);
      const N = g.frame(params.northPolePlotId as PlotId);
      expect([N.east.x, N.east.y, N.east.z, N.north.x, N.north.y, N.north.z]).toEqual([1, 0, 0, 0, 0, -1]);
      const S = g.frame(params.southPolePlotId as PlotId);
      expect([S.east.x, S.east.z, S.north.z]).toEqual([1, 0, 1]);
      // +X (lat 0, lon 0): east = -Z (90 E), north = +Y
      const f0 = g.frame(g.plotAt({ x: 1, y: 0, z: 0 }));
      expect(f0.east.z).toBeLessThan(-0.99);
      expect(f0.north.y).toBeGreaterThan(0.99);
    });

    it("plot-local coordinates round-trip within 1 mm over the 25.6 m frame", () => {
      const out = { u: 0, v: 0 };
      const dir = { x: 0, y: 0, z: 0 };
      const rnd = mulberry32(5);
      for (let id = 0; id < g.count; id += 37) {
        g.toPlotLocal(id as PlotId, g.centerDirection(id as PlotId), out);
        expect([out.u, out.v]).toEqual([0, 0]);
        const u = Math.round((rnd() / 4294967296 - 0.5) * 25_600);
        const v = Math.round((rnd() / 4294967296 - 0.5) * 25_600);
        g.fromPlotLocal(id as PlotId, u, v, dir);
        expect(Math.abs(Math.hypot(dir.x, dir.y, dir.z) - 1)).toBeLessThan(1e-15);
        g.toPlotLocal(id as PlotId, dir, out);
        expect(Math.abs(out.u - u)).toBeLessThanOrEqual(1);
        expect(Math.abs(out.v - v)).toBeLessThanOrEqual(1);
      }
      // +u is east, +v is north
      const id = g.plotAt({ x: 1, y: 0, z: 0 });
      g.fromPlotLocal(id, 10_000, 0, dir);
      expect(dir.z).toBeLessThan(g.centerDirection(id).z);
      g.fromPlotLocal(id, 0, 10_000, dir);
      expect(dir.y).toBeGreaterThan(g.centerDirection(id).y);
    });

    it("plot area stays inside the 25.6 m frame (WDS 2.8 corner radius <= 12.3 m)", () => {
      // corner radius bound: distance from centre to the circumcentre of each adjacent triangle (Voronoi vertex)
      const tri = g.buildTriangleIndices();
      const c = g.centers;
      let worst = 0;
      for (let t = 0; t < tri.length; t += 3) {
        const ids = [tri[t] ?? 0, tri[t + 1] ?? 0, tri[t + 2] ?? 0];
        const [a, b, e] = ids.map((i) => [c[i * 3] ?? 0, c[i * 3 + 1] ?? 0, c[i * 3 + 2] ?? 0]) as [
          number[],
          number[],
          number[],
        ];
        const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
        const ae = [e[0]! - a[0]!, e[1]! - a[1]!, e[2]! - a[2]!];
        const n = [
          ab[1]! * ae[2]! - ab[2]! * ae[1]!,
          ab[2]! * ae[0]! - ab[0]! * ae[2]!,
          ab[0]! * ae[1]! - ab[1]! * ae[0]!,
        ];
        const len = Math.hypot(n[0]!, n[1]!, n[2]!);
        const cc = [n[0]! / len, n[1]! / len, n[2]! / len]; // circumcentre direction on the sphere
        for (const v of [a, b, e]) {
          const chord = Math.hypot(cc[0]! - v[0]!, cc[1]! - v[1]!, cc[2]! - v[2]!) * params.radiusM;
          worst = Math.max(worst, chord);
        }
      }
      expect(worst).toBeLessThanOrEqual(12.3);
    });

    it("rejects invalid ids", () => {
      expect(() => g.neighbors(-1 as PlotId)).toThrow(RangeError);
      expect(() => g.center(g.count as PlotId)).toThrow(RangeError);
      expect(() => g.chunkOf(1.5 as PlotId)).toThrow(RangeError);
      expect(() => g.plotAtChunkLocal(0, 256)).toThrow(RangeError);
      expect(() => g.plotAtChunkLocal(params.chunkCount, 0)).toThrow(RangeError);
    });

    it("cached objects are immutable and stable", () => {
      const a = g.center(5 as PlotId);
      expect(g.center(5 as PlotId)).toBe(a);
      expect(Object.isFrozen(a)).toBe(true);
      expect(a.x).toBeCloseTo(params.radiusM * g.centerDirection(5 as PlotId).x, 9);
      expect(Object.isFrozen(g.frame(5 as PlotId).east)).toBe(true);
    });
  });
}

suite("GP(64,0) Moonlet", MOONLET_GRID_PARAMS);
suite("GP(128,0) Standard", STANDARD_GRID_PARAMS);
