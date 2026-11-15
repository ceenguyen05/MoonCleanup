// T06 allocation probe for the whole P2 tick (server + in-process clients), three windows per variant so the noise
// of the method is visible: v8 total_allocated_bytes advances in allocation-buffer steps (about 256 KB), so one step
// inside a window of N ticks reads as 262,144 / N bytes per tick. The "floor" row runs the same loop with no dust.
//   cd tools/bots && node --import tsx ../../prototypes/dust-sim/p2-stroke-atlas-ledger/bench/tick-alloc-t06.ts
import { getHeapStatistics } from "node:v8";
import { createGrid } from "../grid";
import { P2Server, type StrokeLike } from "../src/core/server";
import { buildTables, type GridLike } from "../src/core/tables";
import { IDENTITY_CODEC } from "../src/core/util";
import { SITE_PLOT } from "../test/support";

const t = buildTables(createGrid() as unknown as GridLike, 20261114);
const allocated = (): number => getHeapStatistics().total_allocated_bytes;
const WINDOWS = 3;

function strokesFor(clients: number, steps: number): StrokeLike[][] {
  const pre: StrokeLike[][] = [];
  for (let b = 0; b < clients; b++) {
    const list: StrokeLike[] = [];
    for (let k = 0; k < steps; k++) {
      const lane = ((Math.floor(k / 200) + b * 7) % 40) * 500 - 10_000;
      const dir = Math.floor(k / 200) % 2 === 0 ? 1 : -1;
      const along = (k % 200) * 150 - 15_000;
      list.push({
        anchor: SITE_PLOT,
        startUMm: dir * along,
        startVMm: lane,
        endUMm: dir * (along + 150),
        endVMm: lane,
        widthCm: 60,
        depth16: 16,
        toolCode: 1,
        tick: k + 1,
        actorSlot: b,
        inputSeq: (k + 1) & 0xffff,
      });
    }
    pre.push(list);
  }
  return pre;
}

function run(name: string, clients: number, cadence: "frame" | "tick", checkIntervalS: number, n: number): void {
  const s = new P2Server(t, {
    simTickHz: 20,
    cadence,
    residencyM: 120,
    dustCellCapacityG: 0,
    codec: IDENTITY_CODEC,
    now: () => 0,
    checkIntervalS,
  });
  for (let i = 0; i < clients; i++) s.join(i, null);
  const steps = 4000;
  const pre = strokesFor(clients, steps);
  let tick = 0;
  const one = (): void => {
    const k = tick % steps;
    for (let b = 0; b < clients; b++) s.submit(b, pre[b]![k]!);
    s.advance(1);
    tick++;
  };
  for (let i = 0; i < 12_000; i++) one();
  const parts: string[] = [];
  for (let w = 0; w < WINDOWS; w++) {
    const a0 = allocated();
    for (let i = 0; i < n; i++) one();
    parts.push(((allocated() - a0) / n).toFixed(2));
  }
  const ok = s.clientHash(0) === s.serverHash() ? "match" : "MISMATCH";
  console.log(`| ${name} | ${n} | ${parts.join(" / ")} | ${(262_144 / n).toFixed(2)} | ${ok} |`);
}

function floor(n: number): void {
  let sink = 0;
  const parts: string[] = [];
  for (let w = 0; w < WINDOWS; w++) {
    const a0 = allocated();
    for (let i = 0; i < n * 16; i++) sink += (i * 131) % 7;
    parts.push(((allocated() - a0) / n).toFixed(2));
  }
  console.log(
    `| floor: empty loop, no dust code | ${n} | ${parts.join(" / ")} | ${(262_144 / n).toFixed(2)} | ${sink > 0 ? "-" : "-"} |`,
  );
}

console.log("| variant | ticks per window | B/tick (3 windows) | one buffer step, B/tick | hash |");
console.log("| --- | ---: | --- | ---: | --- |");
floor(100_000);
run("1 client (solo shape), 10 Hz cadence, checks every 5 s", 1, "frame", 5, 100_000);
run("1 client (solo shape), 10 Hz cadence, no checks", 1, "frame", 1e9, 100_000);
run("6 clients (cap), 10 Hz cadence, checks every 5 s", 6, "frame", 5, 100_000);
run("6 clients (cap), 20 Hz cadence, checks every 5 s", 6, "tick", 5, 100_000);
run("16 clients, 10 Hz cadence, checks every 5 s", 16, "frame", 5, 40_000);
run("16 clients, 20 Hz cadence, checks every 5 s", 16, "tick", 5, 40_000);
