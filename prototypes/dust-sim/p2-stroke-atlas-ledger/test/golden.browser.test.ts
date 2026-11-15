// Browser determinism lane: the same golden vectors as Node, bit for bit (ledger rasterisation and the whole
// server + clients simulation with wire chains, robots, late join and a checkpoint round trip).
import { expect, test } from "vitest";
import { computeGolden, computeSimGolden, GOLDEN_EXPECTED, SIM_GOLDEN_EXPECTED } from "./golden-cases";

test("P2 ledger golden vectors match the Node recording in this engine", () => {
  expect(computeGolden()).toEqual(GOLDEN_EXPECTED);
});

test("P2 server + clients golden scenario matches the Node recording in this engine", () => {
  expect(computeSimGolden()).toEqual(SIM_GOLDEN_EXPECTED);
});
