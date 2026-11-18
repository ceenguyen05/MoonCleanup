// Landing Apron plot selection, shared by MoonRoomSim (server / Solo worker) and the online client read-outs so both pick
// the same plots from the same grid (pure, deterministic; construction time only).
import type { PlotGrid, PlotId, PlotLocalMm } from "@moon-cleanup/shared";
import { atan2Det } from "../math/trig";

/** toPlotLocal query direction: a class (own map, double fields) like the tool/intake `DirScratch`, never a frozen vec. */
class ApronDir {
  x = 0.5;
  y = 0.5;
  z = 0.5;
}
const apronDir = new ApronDir();

/**
 * Ring 2 around the pad plot at unit direction `home`, evenly spaced by angle (plot-local frame of the pad plot) so the
 * Apron wraps the outpost; `count` of them (fewer on a tiny grid). Allocates: call at construction only.
 */
export function landingApronPlots(
  grid: PlotGrid,
  home: { readonly x: number; readonly y: number; readonly z: number },
  count: number,
): readonly number[] {
  if (count <= 0) return Object.freeze([]);
  const centre = grid.plotAt({ x: home.x, y: home.y, z: home.z });
  const inner = new Set<number>([centre]);
  const cn = grid.neighbors(centre);
  for (let i = 0; i < cn.length; i++) inner.add(cn[i]!);
  const ring2 = new Set<number>();
  for (const p of [...inner]) {
    if (p === centre) continue;
    const pn = grid.neighbors(p as PlotId);
    for (let i = 0; i < pn.length; i++) if (!inner.has(pn[i]!)) ring2.add(pn[i]!);
  }
  const m: PlotLocalMm = { u: 0, v: 0 };
  const angled = [...ring2]
    .map((p) => {
      // Copy into the own-map scratch: passing the grid's frozen centre directions would make PlotGrid.toPlotLocal
      // polymorphic in `dir` for the whole process, and its hot callers (tool and intake strokes) then box a fresh
      // HeapNumber per call (~100-230 B/tick in alloc.test, M1-alloc-regression-fix).
      const d = grid.centerDirection(p as PlotId);
      apronDir.x = d.x;
      apronDir.y = d.y;
      apronDir.z = d.z;
      grid.toPlotLocal(centre, apronDir, m);
      return { p, a: atan2Det(m.v, m.u) };
    })
    .sort((x, y) => x.a - y.a || x.p - y.p);
  const picked: number[] = [];
  const n = Math.min(count, angled.length);
  for (let i = 0; i < n; i++) picked.push(angled[Math.floor((i * angled.length) / n)]!.p);
  return Object.freeze(picked);
}
