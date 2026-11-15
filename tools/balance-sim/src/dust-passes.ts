/* eslint-disable no-restricted-imports, @typescript-eslint/no-explicit-any -- offline tool reusing the world package's test support (not exported); loose types are deliberate in this throwaway harness */
import { DustClass, PlotState } from "../../../packages/shared/src/index";
import { PlotAttributeTables } from "../../../packages/world/src/index";
import {
  makeLedger,
  Sink,
  SITE_PLOT,
  standardGrid,
  strokeAt,
  TOOLS,
  uniformAttributes,
} from "../../../packages/world/test/support/dust";
function lanePass(widthCm: number, depth16: number, laneMm: number, strokeMm: number, jitter: number) {
  const out: any[] = [];
  const edge = 14000;
  let row = 0;
  for (let v = -edge; v <= edge; v += laneMm, row++) {
    const vv = v + ((row * 37) % (2 * jitter + 1)) - jitter;
    for (let u = -edge; u < edge; u += strokeMm) {
      const a = row % 2 === 0 ? u : -u;
      const b = row % 2 === 0 ? u + strokeMm : -(u + strokeMm);
      out.push(strokeAt(SITE_PLOT, a, vv, b, vv, widthCm, depth16, 0));
    }
  }
  return out;
}
function run(attr: any, lanes: any[], max: number) {
  const l = makeLedger({ attributes: attr, strokeLog: false });
  const sink = new Sink();
  let n = 0;
  for (let p = 0; p < max; p++)
    for (const s of lanes) {
      l.applyStroke(s, sink);
      n++;
      if (l.state[SITE_PLOT] === PlotState.Polished) return n;
    }
  return -1;
}
function main() {
  const grid = standardGrid();
  const names = ["T1", "T2", "T3", "T4", "T5", "T6"];
  const cls: [string, number, number][] = [
    ["Highland", DustClass.Highland, 5],
    ["Mare", DustClass.Mare, 8],
    ["Crater", DustClass.CraterFloor, 13],
  ];
  const lines: string[] = [];
  for (const spacing of [0.75, 1.0])
    for (const [cn, c, lv] of cls) {
      const attr = new PlotAttributeTables(new Uint8Array(grid.count).fill(c), uniformAttributes().areas);
      for (let t = 0; t < 6; t++) {
        const [w, d0] = TOOLS[t]!;
        const d = Math.round(d0 * (process.env.DSCALE_T12 && t < 2 ? Number(process.env.DSCALE_T12) : 1));
        const lanes = lanePass(w, d, Math.round(w * 10 * spacing), 1000, 50);
        const single = run(
          attr,
          lanes.map((s) => ({ ...s, depth16: 255 })),
          1,
        );
        const n = run(attr, lanes, 12);
        const design = lv * 16 <= d ? 1 : Math.max(2, (0.75 * lv * 16) / d);
        // effective passes: full passes before + fraction of the last
        const per = lanes.length;
        const eff = n / per;
        lines.push(
          `spacing ${spacing} ${cn} ${names[t]} depth16=${d} design=${design} actual=${eff.toFixed(2)} (single geo=${(single / per).toFixed(2)}) ratio=${(eff / design).toFixed(2)}`,
        );
      }
    }
  console.log(lines.join("\n"));
}
main();
