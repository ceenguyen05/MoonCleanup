import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runS4 } from "../../../../tools/bots/src/scenarios/dust-contest/index";
import { generatePairs, tally } from "./ab-pairs";
import { createStubGrid } from "./geometry";
import { barMetric, readability, validateResult } from "./metrics";
import { runScenarios } from "./run";
import { ALL_PATHS, HARNESS_SEED, makeBookmarks, sceneSetupStrokes, sitePoint } from "./scene";
import { createStubAdapter } from "./stub-adapter";
import type { ScenarioId } from "./types";

const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), "dust-harness-"));

describe("scene", () => {
  it("bookmarks are fixed and unit-length poses", () => {
    const a = makeBookmarks();
    expect(a).toEqual(makeBookmarks());
    expect(a.length).toBe(9);
    for (const b of a) expect(Math.hypot(...b.pose.forward)).toBeCloseTo(1, 6);
  });

  it("camera paths are deterministic and have the specified length", () => {
    for (const [id, make] of Object.entries(ALL_PATHS)) {
      const p = make();
      const first = [...p.samples(2)];
      expect(first.length).toBe(Math.round(p.durationSec * 2));
      expect(first).toEqual([...make().samples(2)]);
      expect(p.scenario).toBe(id);
    }
  });

  it("S1 walker eye is 1.7 m above the reference sphere", () => {
    const s = ALL_PATHS.S1().samples(1).next().value;
    expect(s).toBeDefined();
    expect(Math.hypot(...(s?.pose.position ?? [0, 0, 0])) - 2000).toBeCloseTo(1.7, 3);
  });

  it("scene setup strokes land in range of the plot frame", () => {
    const grid = createStubGrid();
    const strokes = sceneSetupStrokes(grid);
    expect(strokes.length).toBe(160);
    for (const s of strokes) expect(Math.abs(s.endUMm)).toBeLessThan(12_800);
    expect(
      grid.plotAt({ x: sitePoint(0, 0)[0], y: sitePoint(0, 0)[1], z: sitePoint(0, 0)[2] } as never),
    ).toBeGreaterThan(0);
  });
});

describe("stub dry run", () => {
  it("S4 is reproducible: same seed gives the same server hash", async () => {
    const grid = createStubGrid();
    const hashes: number[] = [];
    for (let k = 0; k < 2; k++) {
      const a = createStubAdapter();
      await a.start({
        approach: "stub",
        seed: HARNESS_SEED,
        grid,
        simTickHz: 20,
        tier: "B",
        quality: "medium",
        backend: "webgpu",
        outDir: "",
      });
      const r = await runS4(a, { grid, seed: HARNESS_SEED, simSeconds: 6, clusterPlot: grid.plotAt(sitePointDir()) });
      expect(r.hash.matchPct).toBe(100);
      hashes.push(a.serverHash());
    }
    expect(hashes[0]).toBe(hashes[1]);
    expect(hashes[0]).not.toBe(0);
  });

  it("writes schema-valid result files for all scenarios plus a summary", async () => {
    const root = tmp();
    const all: ScenarioId[] = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];
    const out = await runScenarios({
      adapter: createStubAdapter(),
      grid: createStubGrid(),
      resultsRoot: root,
      scenarios: all,
      tier: "B",
      quality: "medium",
      backend: "webgpu",
      maxSimSeconds: 6,
      fps: 20,
    });
    expect(out.length).toBe(8);
    const dir = path.join(root, "stub");
    expect(readdirSync(dir).sort()).toEqual([...all.map((s) => `${s}.json`), "SUMMARY.md"].sort());
    for (const s of all) {
      const json: unknown = JSON.parse(readFileSync(path.join(dir, `${s}.json`), "utf8"));
      expect(validateResult(json)).toEqual([]);
    }
  });
});

describe("metrics", () => {
  it("an unmeasured bar metric is NOT_RUN, never PASS", () => {
    expect(barMetric("s4.eventLoopLagP99Ms", null, "ms").status).toBe("NOT_RUN");
    expect(barMetric("s4.eventLoopLagP99Ms", 25, "ms").status).toBe("FAIL");
    expect(barMetric("s4.eventLoopLagP99Ms", 20, "ms").status).toBe("PASS");
  });

  it("readability uses the 1.45 ratio and 50 code delta", () => {
    expect(readability(150, 90).pass).toBe(true);
    expect(readability(120, 90).pass).toBe(false);
  });
});

describe("blind A/B pairs", () => {
  it("is seeded, hides approach names and byte-copies the images", () => {
    const a = tmp();
    const b = tmp();
    for (const n of ["B01.png", "B02.png", "B03.png", "only-a.png"]) writeFileSync(path.join(a, n), `A-${n}`);
    for (const n of ["B01.png", "B02.png", "B03.png"]) writeFileSync(path.join(b, n), `B-${n}`);
    const o1 = tmp();
    const o2 = tmp();
    const r1 = generatePairs({ nameA: "P1", dirA: a, nameB: "P2", dirB: b, outDir: o1 });
    generatePairs({ nameA: "P1", dirA: a, nameB: "P2", dirB: b, outDir: o2 });
    expect(r1.pairs).toBe(3);
    expect(r1.skipped).toEqual(["only-a.png"]);
    expect(readFileSync(r1.keyPath, "utf8")).toBe(readFileSync(path.join(o2, "key.json"), "utf8"));
    const sheet = readFileSync(r1.sheetPath, "utf8");
    expect(sheet).not.toMatch(/P1|P2/);
    const key = (JSON.parse(readFileSync(r1.keyPath, "utf8")) as { pairs: { pair: string; left: string }[] }).pairs;
    for (const k of key) {
      const left = readFileSync(path.join(o1, "pairs", `${k.pair}-L.png`), "utf8");
      expect(left.startsWith(k.left === "P1" ? "A-" : "B-")).toBe(true);
    }
    const t = tally(
      key.map((k) => ({ pair: k.pair, bookmark: "x", left: k.left, right: k.left === "P1" ? "P2" : "P1" })),
      { [key[0]?.pair ?? "01"]: ["L", "L", "R", "same"] },
    );
    expect(t.same).toBe(1);
    expect(Object.values(t.wins).reduce((s, n) => s + n, 0)).toBe(3);
  });
});

function sitePointDir(): never {
  const p = sitePoint(0, 0);
  return { x: p[0], y: p[1], z: p[2] } as never;
}
