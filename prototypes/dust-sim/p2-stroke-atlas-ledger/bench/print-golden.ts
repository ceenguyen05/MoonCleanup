// Prints the golden numbers of test/golden-cases.ts (to record them after an intended model change).
//   cd tools/bots && node --import tsx ../../prototypes/dust-sim/p2-stroke-atlas-ledger/bench/print-golden.ts
import { computeGolden, computeSimGolden } from "../test/golden-cases";

console.log(JSON.stringify({ ledger: computeGolden(), sim: computeSimGolden() }, null, 2));
