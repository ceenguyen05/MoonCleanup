// Streamed-ledger interest pass (ShiftDust.scanInterest, DustInterestScan): the throttled, cached pass must produce
// exactly the sets of the original per-call full scan, over random walks, jumps (teleports), radius changes, ledger
// allocations, stream-state transitions and full queues.
import { STANDARD_GRID_PARAMS, type ContractId, type PlayerId } from "@moon-cleanup/shared";
import { encodeInput, type MutableInput } from "@moon-cleanup/protocol";
import { loadGameData } from "@moon-cleanup/game-data";
import { createPlotGrid } from "@moon-cleanup/world";
import type { SimWorld } from "@moon-cleanup/sim";
import { describe, expect, it } from "vitest";
import { ShiftCore, type ShiftSink } from "./shift-core";
import { DustInterestScan, type ShiftDust } from "./shift-dust";

const CONTRACT = "00000000-0000-4000-8000-0000000000e5" as ContractId;
const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: { heightAtXYZ: () => 0 } };
const HZ = 20;
const SWEEP = 1 << 3;

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The original refreshDustInterest loop, verbatim in behaviour; returns the plots it queued (mark 0 -> 2). */
function oldScan(
  dust: ShiftDust,
  px: number,
  py: number,
  pz: number,
  cosIn: number,
  cosOut: number,
  sent: Uint8Array,
  queueRoom: number,
): number[] {
  const l = dust.ledger;
  const queued: number[] = [];
  const len = Math.sqrt(px * px + py * py + pz * pz) || 1;
  const ux = px / len;
  const uy = py / len;
  const uz = pz / len;
  for (let s = 0; s < l.slotHigh; s++) {
    const plot = l.plotOfSlot[s]!;
    if (plot < 0) continue;
    const mark = sent[plot]!;
    if (mark === 2) continue;
    const dot = dust.plotDot(plot, ux, uy, uz);
    if (mark === 0) {
      if (dot >= cosIn && queued.length < queueRoom) {
        queued.push(plot);
        sent[plot] = 2;
      }
    } else if (dot < cosOut) {
      sent[plot] = 0;
    }
  }
  return queued;
}

describe("dust interest pass: throttled == full scan", () => {
  it("matches the original pass over random walks, teleports, radius changes, new ledgers and stream transitions", () => {
    const core = new ShiftCore({ data, world, contractId: CONTRACT, shiftType: "private", simTickHz: HZ }, 0);
    const sink: ShiftSink = { frame() {}, events() {}, bytes() {} };
    const seats = 3;
    for (let s = 0; s < seats; s++) {
      core.addSeat(
        {
          playerId: `00000000-0000-4000-8000-0000000000${(0xd0 + s).toString(16)}` as PlayerId,
          displayName: `Bot${s}`,
          role: s === 0 ? "holder" : "staff",
        },
        0,
      );
    }
    const scratch = new Uint8Array(32);
    const input: MutableInput = { seq: 0, moveX: 0, moveY: 127, yaw: 0, pitch: 0, buttons: SWEEP, toolParam: 128 };
    const dust = core.dust;
    const ledger = core.ledger;
    const moonR = core.sim.config.moonRadiusM;
    const random = rng(0x5eed);
    const sentOld = new Uint8Array(ledger.plotCount);
    const sentNew = new Uint8Array(ledger.plotCount);
    const scan = new DustInterestScan();
    let inM = 40;
    let outM = 60;
    scan.setRadius(dust, inM, outM);
    let cosIn = dust.cosOf(inM);
    let cosOut = dust.cosOf(outM);
    let px = 0;
    let py = 0;
    let pz = 0;
    const stats = { calls: 0, skipped: 0, hits: 0, fullQueue: 0, allocsSeen: 0 };
    let tick = 0;
    let lastAlloc = ledger.counters.ledgersAllocated;

    for (let iter = 0; iter < 4000; iter++) {
      // Grow the ledger set now and then (new plots can enter the radius).
      if (iter % 7 === 0) {
        for (let k = 0; k < 6; k++, tick++) {
          for (let s = 0; s < seats; s++) {
            input.seq = tick + 1;
            input.yaw = (s * 21845 + tick * 90) & 0xffff;
            const n = encodeInput(scratch, input);
            core.receiveInput(s, scratch.subarray(1, n), tick * (1000 / HZ));
          }
          core.step(sink);
        }
        if (ledger.counters.ledgersAllocated !== lastAlloc) {
          stats.allocsSeen++;
          lastAlloc = ledger.counters.ledgersAllocated;
        }
      }
      // Position: tiny steps near the avatar, sometimes a jump (teleport) to another seat's spot or a random point.
      const r = random();
      if (iter === 0 || r < 0.03) {
        const a = core.sim.avatar(Math.floor(random() * seats));
        px = a.px;
        py = a.py;
        pz = a.pz;
      } else if (r < 0.05) {
        px = (random() - 0.5) * 2 * moonR;
        py = (random() - 0.5) * 2 * moonR;
        pz = (random() - 0.5) * 2 * moonR;
      } else {
        const step = random() < 0.7 ? 0.05 + random() * 0.5 : 0.5 + random() * 3;
        px += (random() - 0.5) * 2 * step;
        py += (random() - 0.5) * 2 * step;
        pz += (random() - 0.5) * 2 * step;
      }
      // Radius change (the seat's dust_interest message).
      if (random() < 0.01) {
        inM = 5 + random() * 70;
        outM = inM + 20;
        scan.setRadius(dust, inM, outM);
        cosIn = dust.cosOf(inM);
        cosOut = dust.cosOf(outM);
      }
      // Stream transitions the core performs outside the pass: queued ledgers get sent (2 -> 1), a few get forgotten.
      if (random() < 0.4) {
        for (let s = 0; s < ledger.slotHigh; s++) {
          const plot = ledger.plotOfSlot[s]!;
          if (plot < 0) continue;
          if (sentNew[plot] === 2 && random() < 0.7) {
            sentNew[plot] = 1;
            sentOld[plot] = 1;
            scan.invalidate();
          } else if (random() < 0.02) {
            sentNew[plot] = 0; // body === null / catch-up style reset
            sentOld[plot] = 0;
            scan.invalidate();
          }
        }
      }
      // A queue that is sometimes full: only the first `room` hits can be queued.
      const room = random() < 0.1 ? Math.floor(random() * 3) : 1 << 20;

      const expected = oldScan(dust, px, py, pz, cosIn, cosOut, sentOld, room);

      stats.calls++;
      const wasValid = scan.valid;
      const u0 = scan.u[0]!;
      const n = dust.scanInterest(scan, { px, py, pz }, sentNew);
      if (wasValid && scan.u[0] === u0) stats.skipped++;
      const got: number[] = [];
      for (let i = 0; i < n; i++) {
        if (got.length < room) {
          got.push(dust.hitPlots[i]!);
          sentNew[dust.hitPlots[i]!] = 2;
        } else {
          scan.invalidate(); // the core's enqueue on a full queue
          stats.fullQueue++;
        }
      }
      stats.hits += got.length;

      expect(got).toEqual(expected);
      // Identical marks after every call (this also covers forgets, which have no return value).
      let diff = -1;
      for (let p = 0; p < sentOld.length; p++) {
        if (sentOld[p] !== sentNew[p]) {
          diff = p;
          break;
        }
      }
      if (diff >= 0) expect.fail(`marks differ at plot ${diff} iter ${iter}: ${sentOld[diff]} vs ${sentNew[diff]}`);
    }
    expect(ledger.ledgerCount).toBeGreaterThan(10);
    expect(stats.hits).toBeGreaterThan(10);
    expect(stats.allocsSeen).toBeGreaterThan(3);
    expect(stats.fullQueue).toBeGreaterThan(0);
    // The throttle must actually skip (otherwise this table proves nothing about it).
    expect(stats.skipped).toBeGreaterThan(stats.calls * 0.1);
    console.info(`[dust interest] ${JSON.stringify(stats)}, ledgers ${ledger.ledgerCount}`);
  });
});
