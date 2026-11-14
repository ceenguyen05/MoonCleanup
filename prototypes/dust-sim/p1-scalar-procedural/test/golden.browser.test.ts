// Browser determinism lane: the same golden scenario as Node, bit for bit.
import { expect, test } from "vitest";
import { GOLDEN, runGolden } from "./golden";

test("P1 golden scenario matches the Node recording in this engine", () => {
  expect(runGolden()).toEqual(GOLDEN);
});
