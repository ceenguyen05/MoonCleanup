// Blind A/B screenshot pair generator for the visual judgement (WDS section 10, 10 testers).
// Input: two folders of native-resolution PNGs named <bookmarkId>.png. Output: pairs/<NN>-L.png and <NN>-R.png with
// neutral names (files are byte-copied, never re-encoded or resized), sheet.json for testers (no approach names) and
// key.json (which approach is on which side) that the organiser keeps away from testers.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRng } from "../../../../tools/bots/src/rng";
import { HARNESS_SEED } from "./scene";

export interface PairInput {
  readonly nameA: string;
  readonly dirA: string;
  readonly nameB: string;
  readonly dirB: string;
  readonly outDir: string;
  readonly seed?: number;
}

export interface PairKeyEntry {
  readonly pair: string;
  readonly bookmark: string;
  readonly left: string;
  readonly right: string;
}

export interface PairSheetEntry {
  readonly pair: string;
  readonly bookmark: string;
  readonly left: string;
  readonly right: string;
  readonly question: string;
}

export interface PairResult {
  readonly pairs: number;
  readonly skipped: readonly string[];
  readonly sheetPath: string;
  readonly keyPath: string;
}

export function generatePairs(i: PairInput): PairResult {
  const rng = createRng((i.seed ?? HARNESS_SEED) ^ 0xab1ab);
  const png = (d: string): Set<string> =>
    new Set(existsSync(d) ? readdirSync(d).filter((f) => f.toLowerCase().endsWith(".png")) : []);
  const a = png(i.dirA);
  const b = png(i.dirB);
  const common = [...a].filter((f) => b.has(f)).sort();
  const skipped = [...new Set([...a, ...b])].filter((f) => !(a.has(f) && b.has(f))).sort();
  // Fisher-Yates with the seeded rng: same inputs and seed give the same order and sides.
  const order = [...common];
  for (let k = order.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [order[k], order[j]] = [order[j] as string, order[k] as string];
  }
  const pairsDir = path.join(i.outDir, "pairs");
  mkdirSync(pairsDir, { recursive: true });
  const key: PairKeyEntry[] = [];
  const sheet: PairSheetEntry[] = [];
  order.forEach((file, idx) => {
    const n = String(idx + 1).padStart(2, "0");
    const flip = rng() < 0.5;
    const [left, right] = flip ? [i.nameB, i.nameA] : [i.nameA, i.nameB];
    const [leftDir, rightDir] = flip ? [i.dirB, i.dirA] : [i.dirA, i.dirB];
    const bookmark = file.replace(/\.png$/i, "");
    copyFileSync(path.join(leftDir, file), path.join(pairsDir, `${n}-L.png`));
    copyFileSync(path.join(rightDir, file), path.join(pairsDir, `${n}-R.png`));
    key.push({ pair: n, bookmark, left, right });
    sheet.push({
      pair: n,
      bookmark,
      left: `pairs/${n}-L.png`,
      right: `pairs/${n}-R.png`,
      question: "Which image shows the cleaned trail more clearly and convincingly (L, R, or same)?",
    });
  });
  const sheetPath = path.join(i.outDir, "sheet.json");
  const keyPath = path.join(i.outDir, "key.json");
  writeFileSync(sheetPath, `${JSON.stringify({ seed: i.seed ?? HARNESS_SEED, pairs: sheet }, null, 2)}\n`);
  writeFileSync(keyPath, `${JSON.stringify({ seed: i.seed ?? HARNESS_SEED, pairs: key }, null, 2)}\n`);
  return { pairs: order.length, skipped, sheetPath, keyPath };
}

export type Vote = "L" | "R" | "same";

export interface Tally {
  readonly [approach: string]: number;
}

/**
 * Tallies tester votes ({ pair -> votes[] }) against the key. "same" counts for neither approach. Returns wins and the
 * decisive share, so the lead can apply the decision rule (P3 must beat P2 by more than 60/40 to count).
 */
export function tally(
  key: readonly PairKeyEntry[],
  votes: Readonly<Record<string, readonly Vote[]>>,
): { wins: Tally; same: number; shareOfDecisive: Tally } {
  const wins: Record<string, number> = {};
  let same = 0;
  for (const k of key) {
    for (const v of votes[k.pair] ?? []) {
      if (v === "same") same++;
      else {
        const who = v === "L" ? k.left : k.right;
        wins[who] = (wins[who] ?? 0) + 1;
      }
    }
  }
  const total = Object.values(wins).reduce((s, n) => s + n, 0);
  const share: Record<string, number> = {};
  for (const [k, n] of Object.entries(wins)) share[k] = total === 0 ? 0 : n / total;
  return { wins, same, shareOfDecisive: share };
}
