// Allocation probe for the whole server tick (server + in-process clients), with variants that switch parts off.
//   node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs prototypes/dust-sim/p2-stroke-atlas-ledger/bench/tick-probe.ts
import { getHeapStatistics } from "node:v8";
import { createGrid } from "../grid";
import { P2Server, type StrokeLike } from "../src/core/server";
import { buildTables, type GridLike } from "../src/core/tables";
import { IDENTITY_CODEC } from "../src/core/util";
import { SITE_PLOT } from "../test/support";

const t = buildTables(createGrid() as unknown as GridLike, 20261114);
const allocated = (): number => getHeapStatistics().total_allocated_bytes;

function run(name: string, clients: number, cadence: "frame" | "tick", checkIntervalS: number, span: number): void {
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
  const pre: StrokeLike[][] = [];
  for (let b = 0; b < clients; b++) {
    const list: StrokeLike[] = [];
    for (let k = 0; k < steps; k++) {
      const lane = ((Math.floor(k / 200) + b * 7) % 40) * 500 - span;
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
  let tick = 0;
  const one = (): void => {
    const k = tick % steps;
    for (let b = 0; b < clients; b++) s.submit(b, pre[b]![k]!);
    s.advance(1);
    tick++;
  };
  for (let i = 0; i < 8000; i++) one();
  const N = 40_000;
  const a0 = allocated();
  for (let i = 0; i < N; i++) one();
  const bytes = (allocated() - a0) / N;
  console.log(
    `| ${name} | ${bytes.toFixed(1)} | ${(bytes / clients).toFixed(2)} | ${s.ledgersSent} | ${s.view.ledgerCount} / ${s.view.polishedAllN} | ${s.clientHash(0) === s.serverHash() ? "match" : "MISMATCH"} |`,
  );
}

console.log("| variant | B/tick | B per submitted stroke | ledgers sent | ledgers / polished | hash |");
console.log("| --- | ---: | ---: | ---: | --- | --- |");
run("16 clients, frame cadence, checks every 5 s", 16, "frame", 5, 10_000);
run("16 clients, frame cadence, no checks", 16, "frame", 1e9, 10_000);
run("16 clients, tick cadence, no checks", 16, "tick", 1e9, 10_000);
run("1 client, frame cadence, no checks", 1, "frame", 1e9, 10_000);
run("6 clients, frame cadence, checks every 5 s", 6, "frame", 5, 10_000);
