/* eslint-disable no-restricted-imports, @typescript-eslint/no-explicit-any -- offline tool reusing the world package's test support (not exported); mirrors packages/world dust-ledger.test.ts "V3 reachability and design depth" to print the mix-weighted ratios that suite only asserts */
// V3 pacing bar, printed: mix-weighted measured passes / mix-weighted rule passes per hand tool (bar: 0.80 .. 1.20).
// Same lanes, classes, mixes and rule as the world suite. Run: `pnpm --filter @moon-cleanup/balance-sim exec tsx src/v3-mix.ts`.
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

const COVERAGE = 0.75;
// Rows are [widthCm, depth16, charge]; V3 uses the six hand tools.
const hand = TOOLS.slice(0, 6);
const classes = [
  ["Highland", DustClass.Highland, 5],
  ["Mare", DustClass.Mare, 8],
  ["Crater Floor", DustClass.CraterFloor, 13],
] as const;
const MIXES = [
  ["Moon mix", [0.55, 0.35, 0.1]],
  ["outpost mix", [0.9, 0.08, 0.02]],
] as const;

const rulePasses = (level: number, depth16: number): number => {
  const depth = depth16 / 16;
  return level <= depth ? 1 : Math.max(2, (COVERAGE * level) / depth);
};

function lanePass(widthCm: number, depth16: number, laneMm: number, strokeMm: number, jitter: number): any[] {
  const out: any[] = [];
  const edge = 14_000;
  let row = 0;
  for (let v = -edge; v <= edge; v += laneMm, row++) {
    const vv = v + (((row * 37) % (2 * jitter + 1)) - jitter);
    for (let u = -edge; u < edge; u += strokeMm) {
      const a = row % 2 === 0 ? u : -u;
      const b = row % 2 === 0 ? u + strokeMm : -(u + strokeMm);
      out.push(strokeAt(SITE_PLOT, a, vv, b, vv, widthCm, depth16, 0));
    }
  }
  return out;
}

function strokesToPolish(ledger: any, pass: readonly any[], maxPasses: number): number {
  const sink = new Sink();
  let strokes = 0;
  for (let p = 0; p < maxPasses; p++) {
    for (const s of pass) {
      ledger.applyStroke(s, sink);
      strokes++;
      if (ledger.state[SITE_PLOT] === PlotState.Polished) return strokes;
    }
  }
  return -1;
}

const grid = standardGrid();
const passes: number[][] = [];
for (const [, cls] of classes) {
  const attributes = new PlotAttributeTables(new Uint8Array(grid.count).fill(cls), uniformAttributes().areas);
  passes.push(
    hand.map(([widthCm, depth16]) => {
      const lanes = lanePass(widthCm, depth16, Math.round(widthCm * 10 * COVERAGE), 1000, 50);
      return strokesToPolish(makeLedger({ attributes, strokeLog: false }), lanes, 6) / lanes.length;
    }),
  );
}
let worst = Infinity;
for (const [name, mix] of MIXES) {
  hand.forEach(([widthCm, depth16], ti) => {
    let rule = 0;
    let got = 0;
    classes.forEach(([, , level], ci) => {
      rule += mix[ci]! * rulePasses(level, depth16);
      got += mix[ci]! * passes[ci]![ti]!;
    });
    const ratio = got / rule;
    worst = Math.min(worst, ratio);
    console.log(
      `${name} T${ti + 1} (width ${widthCm} cm): measured ${got.toFixed(3)} rule ${rule.toFixed(3)} ratio ${ratio.toFixed(3)}`,
    );
  });
}
console.log(`V3 worst mix-weighted ratio ${worst.toFixed(3)} (bar 0.80 .. 1.20)`);
