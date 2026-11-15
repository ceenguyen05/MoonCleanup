// Server + in-process clients: wire chains, interest sets, robots as intents, drift checks, checkpoint round trip,
// late join and the CPU reference tile atlas. V5 of WDS 4.5b: client copy == server ledger after all echoes.
import { describe, expect, it } from "vitest";
import { DurableStore, loadWorld, saveWorld } from "../src/core/persistence";
import { P2Server, SUBMIT_MALFORMED, SUBMIT_OK, SUBMIT_TOO_LONG, type StrokeLike } from "../src/core/server";
import { TILE_PRESETS, TileAtlasRef } from "../src/core/tiles";
import { dirOf, xform } from "../src/core/util";
import { computeSimGolden, SIM_GOLDEN_EXPECTED } from "./golden-cases";
import { fullDigest, mulberry32, plotNear, realTables, SITE_PLOT, TEST_OPTIONS } from "./support";

const t = realTables();

/** A walker in the site frame: boustrophedon lanes, one stroke per tick, canonical records. */
function walker(
  index: number,
  opts: { width: number; depth: number; speedMm: number; originU: number; originV: number },
) {
  const rng = mulberry32(1000 + index);
  let u = opts.originU + Math.round(rng() * 20_000);
  let v = opts.originV + index * 700;
  let dir = 1;
  const xy = new Int32Array(2);
  return (tick: number): StrokeLike => {
    let nu = u + dir * opts.speedMm;
    let nv = v + Math.round((rng() - 0.5) * 40);
    if (nu > opts.originU + 30_000 || nu < opts.originU - 10_000) {
      dir = -dir;
      nu = u;
      nv = v + 500;
    }
    const anchor = plotNear(t, SITE_PLOT, nu, nv);
    xform(t, SITE_PLOT, u, v, anchor, xy);
    const startUMm = xy[0]!;
    const startVMm = xy[1]!;
    xform(t, SITE_PLOT, nu, nv, anchor, xy);
    u = nu;
    v = nv;
    return {
      anchor,
      startUMm,
      startVMm,
      endUMm: xy[0]!,
      endVMm: xy[1]!,
      widthCm: opts.width,
      depth16: opts.depth,
      toolCode: 1,
      tick,
      actorSlot: index,
      inputSeq: tick & 0xffff,
    };
  };
}

function expectClean(s: P2Server): void {
  expect(s.scanMismatch).toBe(0);
  for (const link of s.links) {
    if (!link) continue;
    expect(link.client.driftChunks).toBe(0);
    expect(link.client.strayLedgers).toBe(0);
    expect(link.client.badContinuations).toBe(0);
    expect(link.client.l0Mismatch).toBe(0);
  }
}

function expectHashes(s: P2Server, ids: readonly number[]): void {
  const want = s.serverHash();
  for (const id of ids) expect(s.clientHash(id)).toBe(want);
}

describe.each(["frame", "tick"] as const)("server and clients (%s cadence)", (cadence) => {
  it("V5: 6 clustered cleaners stay byte-identical with the server; chains are 4 B per stroke", () => {
    const s = new P2Server(t, { ...TEST_OPTIONS, cadence });
    const ids = [0, 1, 2, 3, 4, 5];
    const bots = ids.map((i) => walker(i, { width: 60, depth: 16, speedMm: 150, originU: -8000, originV: -3000 }));
    for (const id of ids) s.join(id, null);
    for (let tick = 1; tick <= 1200; tick++) {
      for (const id of ids) {
        expect(s.submit(id, bots[id]!(tick))).toBe(SUBMIT_OK);
        s.linkOf(id)!.client.ownActor = id;
        s.linkOf(id)!.client.predict(tick & 0xffff, s.tick);
      }
      s.advance(1);
      if (tick % 100 === 0) expectHashes(s, ids);
    }
    expectHashes(s, ids);
    expectClean(s);
    expect(s.view.ledgerCount).toBeGreaterThanOrEqual(3);
    // Every client actually holds the ledgers (the comparison is not vacuous).
    for (const id of ids) {
      const c = s.linkOf(id)!.client;
      expect(c.view.ledgerCount).toBe(s.view.ledgerCount);
      expect(c.hash()).toBe(s.view.hashWhere(null));
      expect(c.predN).toBeLessThanOrEqual(1);
      expect(c.mispredicts).toBe(0);
      expect(c.echoes).toBeGreaterThan(500);
    }
    expect(s.contsSent).toBeGreaterThan(s.headersSent * 10);
    if (cadence === "frame") expect(s.strokesMerged).toBeGreaterThan(3000);
    expect(s.grams[0]).toBeGreaterThan(0);
  }, 120_000);

  it("interest: a client that walks away and back, and one far away, stay consistent inside their radius", () => {
    const s = new P2Server(t, { ...TEST_OPTIONS, cadence, residencyM: 80 });
    s.join(0, null);
    s.join(1, null);
    s.join(2, null);
    const near = walker(0, { width: 120, depth: 48, speedMm: 200, originU: -5000, originV: 0 });
    // Client 1 sweeps a long line: 600 m out and back (leaves and re-enters client 0's radius).
    const d = new Float64Array(3);
    const xy = new Int32Array(2);
    let pu = 0;
    let anchorPrev = SITE_PLOT;
    let endU = 0;
    let endV = 3000;
    const far = (tick: number): StrokeLike => {
      const phase = tick % 600;
      pu = phase < 300 ? phase * 2000 : (600 - phase) * 2000;
      // Walk plot to plot: express the new end in the previous anchor frame, then re-anchor.
      const stepU = phase < 300 ? 2000 : -2000;
      dirOf(t, anchorPrev, endU + stepU, endV, d);
      const anchor = plotNear(t, anchorPrev, endU + stepU, endV);
      xform(t, anchorPrev, endU, endV, anchor, xy);
      const sU = xy[0]!;
      const sV = xy[1]!;
      xform(t, anchorPrev, endU + stepU, endV, anchor, xy);
      anchorPrev = anchor;
      endU = xy[0]!;
      endV = xy[1]!;
      return {
        anchor,
        startUMm: sU,
        startVMm: sV,
        endUMm: endU,
        endVMm: endV,
        widthCm: 300,
        depth16: 255,
        toolCode: 9,
        tick,
        actorSlot: 1,
        inputSeq: tick & 0xffff,
      };
    };
    for (let tick = 1; tick <= 1400; tick++) {
      s.submit(0, near(tick));
      s.submit(1, far(tick));
      s.advance(1);
      if (tick % 50 === 0) expectHashes(s, [0, 1, 2]);
    }
    expect(pu).toBeGreaterThanOrEqual(0);
    expectClean(s);
    // Client 0 does not hold the far end of client 1's line; the server does.
    expect(s.linkOf(0)!.client.view.ledgerCount).toBeLessThan(s.view.ledgerCount);
    expect(s.linkOf(0)!.client.view.ledgerCount).toBeGreaterThan(0);
    // Client 2 never got a position: empty interest, still "equal" (nothing to compare) and it received no strokes.
    expect(s.linkOf(2)!.client.view.ledgerCount).toBe(0);
    expect(s.linkOf(2)!.client.strokesApplied).toBe(0);
    expect(s.ledgersSent).toBeGreaterThan(0);
  }, 120_000);

  it("robots as intents: clients replay the same chunks by server tick", () => {
    const s = new P2Server(t, { ...TEST_OPTIONS, cadence });
    s.join(0, null);
    s.join(1, null);
    const a = walker(0, { width: 60, depth: 16, speedMm: 150, originU: 0, originV: 0 });
    const b = walker(1, { width: 60, depth: 16, speedMm: 150, originU: 5000, originV: 9000 });
    const nb = t.neighbors;
    let intents = 0;
    for (let tick = 1; tick <= 1600; tick++) {
      s.submit(0, a(tick));
      s.submit(1, b(tick));
      if (tick === 40) {
        // Robots on the site plot, on its neighbours and on plots two rings out (some outside nothing at all).
        const plots = [SITE_PLOT, nb[SITE_PLOT * 6]!, nb[SITE_PLOT * 6 + 3]!, nb[nb[SITE_PLOT * 6 + 1]! * 6 + 1]!];
        plots.forEach((plot, id) => {
          s.submitRobotIntent(id, plot, tick, 80 + id * 60, 16 + id * 16, 120 - id * 20, 0xffffffff, 0);
          intents++;
        });
        s.submitRobotIntent(9, SITE_PLOT + 4000, tick, 200, 48, 60, 0x0000ffff, 0);
      }
      s.advance(1);
      if (tick % 20 === 0) expectHashes(s, [0, 1]);
    }
    expect(intents).toBe(4);
    expect(s.plans.chunksApplied).toBeGreaterThan(300);
    expect(s.linkOf(0)!.client.plans.chunksApplied).toBeGreaterThan(200);
    // The robot far away (plot + 4000) was never sent to the clustered clients.
    expect(s.linkOf(0)!.client.plans.active[9] ?? 0).toBe(0);
    expectClean(s);
  }, 120_000);

  it("a robot re-assigned out of reach stops on the clients too (no stale plan, no chunk applied by one side only)", () => {
    // No drift checks: a resync must not be able to hide a divergence.
    const s = new P2Server(t, { ...TEST_OPTIONS, cadence, checkIntervalS: 1e9 });
    s.join(0, null);
    s.join(1, null);
    const a = walker(0, { width: 60, depth: 16, speedMm: 150, originU: 0, originV: 0 });
    const b = walker(1, { width: 60, depth: 16, speedMm: 150, originU: 5000, originV: 9000 });
    const far = SITE_PLOT + 4000;
    for (let tick = 1; tick <= 900; tick++) {
      s.submit(0, a(tick));
      s.submit(1, b(tick));
      if (tick === 40) {
        for (let id = 0; id < 4; id++) s.submitRobotIntent(id, SITE_PLOT, tick, 140, 32, 90, 0xffffffff, 0);
      }
      // Old chunks are due at 40 + 20 k. Re-assign on a chunk tick, one tick before and one tick after.
      if (tick === 400) s.submitRobotIntent(0, far, tick, 140, 32, 90, 0xffffffff, 0);
      if (tick === 419) s.submitRobotIntent(1, far, tick, 140, 32, 90, 0xffffffff, 0);
      if (tick === 441) s.submitRobotIntent(2, t.neighbors[SITE_PLOT * 6 + 2]!, tick, 80, 16, 120, 0xffff, 0);
      s.advance(1);
      if (tick % 2 === 0) expectHashes(s, [0, 1]);
    }
    const c = s.linkOf(0)!.client;
    expect(s.robotStops).toBe(4); // robots 0 and 1, two clients each
    expect(c.plans.active[0]).toBe(0);
    expect(c.plans.active[1]).toBe(0);
    expect(c.plans.plot[2]).toBe(t.neighbors[SITE_PLOT * 6 + 2]);
    expect(s.plans.active[0]).toBe(1); // the server still runs it, far away
    expect(c.plans.chunksApplied).toBeGreaterThan(100);
    expectClean(s);
  }, 120_000);
});

describe("persistence and join", () => {
  function busyServer(): { s: P2Server; step: (n: number) => void; ids: number[] } {
    const s = new P2Server(t, { ...TEST_OPTIONS });
    const ids = [0, 1, 2, 3];
    const bots = ids.map((i) => walker(i, { width: 120, depth: 64, speedMm: 180, originU: -6000, originV: -2000 }));
    for (const id of ids) s.join(id, null);
    let tick = 0;
    const step = (n: number): void => {
      for (let k = 0; k < n; k++) {
        tick++;
        for (const id of ids) s.submit(id, bots[id]!(tick));
        s.advance(1);
      }
    };
    return { s, step, ids };
  }

  it("checkpoint round trip restores the same world; the two-version rule survives a torn newest header", () => {
    const { s, step } = busyServer();
    const store = new DurableStore();
    step(400);
    s.submitRobotIntent(3, SITE_PLOT, s.tick, 140, 32, 90, 0xff, 0);
    step(200);
    saveWorld(s, store);
    const hash1 = s.serverHash();
    const digest1 = fullDigest(s.view);
    const tick1 = s.tick;
    const grams1 = Array.from(s.grams);
    step(300);
    saveWorld(s, store);
    const hash2 = s.serverHash();
    expect(hash2).not.toBe(hash1);
    expect(store.saves).toBe(2);

    const b = new P2Server(t, { ...TEST_OPTIONS });
    expect(loadWorld(b, store)).toBe(true);
    expect(b.serverHash()).toBe(hash2);
    expect(fullDigest(b.view)).toBe(fullDigest(s.view));
    expect(b.tick).toBe(s.tick);
    expect(Array.from(b.grams)).toEqual(Array.from(s.grams));
    expect(Array.from(b.mgAcc)).toEqual(Array.from(s.mgAcc));
    expect(b.plans.activeCount).toBe(s.plans.activeCount);
    for (let slot = 0; slot < s.view.slotHigh; slot++) {
      const plot = s.view.plotOfSlot[slot]!;
      if (plot < 0) continue;
      const bs = b.view.slotOf[plot]!;
      expect(b.view.version[bs]).toBe(s.view.version[slot]);
      expect(b.view.remaining[bs]).toBe(s.view.remaining[slot]);
      expect(b.view.frac[plot]).toBe(s.view.frac[plot]);
      expect(b.view.state[plot]).toBe(s.view.state[plot]);
      expect(b.log.count(plot)).toBe(Math.min(32, s.log.count(plot)));
    }

    // Tear the newest header: the load falls back to the older header and the chunk versions it wrote.
    const newest = store.headers[1]!;
    newest[newest.length - 1] = newest[newest.length - 1]! ^ 0xff;
    const c = new P2Server(t, { ...TEST_OPTIONS });
    expect(loadWorld(c, store)).toBe(true);
    expect(c.tick).toBe(tick1);
    expect(c.serverHash()).toBe(hash1);
    expect(fullDigest(c.view)).toBe(digest1);
    expect(Array.from(c.grams)).toEqual(grams1);
    expect(loadWorld(new P2Server(t, { ...TEST_OPTIONS }), new DurableStore())).toBe(false);
  }, 120_000);

  it("late join: snapshot + ledgers give the server's bytes, and the client keeps up afterwards", () => {
    const { s, step, ids } = busyServer();
    step(900);
    const pos = s.activity.slice();
    const r = s.join(99, pos);
    expect(r.ledgersBlocking).toBeGreaterThan(0);
    expect(r.blockingBytes).toBeGreaterThan(40_000); // identity codec: the raw 2-bit state map alone is 40,961 B
    expect(s.clientHash(99)).toBe(s.serverHash());
    const c = s.linkOf(99)!.client;
    expect(c.view.ledgerCount).toBe(r.ledgersBlocking + r.ledgersStreamed);
    expect(c.hash()).toBe(s.view.hashWhere(s.linkOf(99)!.mirror.member));
    step(300);
    expectHashes(s, [...ids, 99]);
    expectClean(s);
    // A re-join of an existing client replaces it.
    s.join(0, s.linkOf(0)!.pos.slice());
    step(100);
    expectHashes(s, [...ids, 99]);
  }, 120_000);

  it("submit never throws on malformed strokes", () => {
    const s = new P2Server(t, { ...TEST_OPTIONS });
    s.join(0, null);
    const good: StrokeLike = {
      anchor: SITE_PLOT,
      startUMm: 0,
      startVMm: 0,
      endUMm: 100,
      endVMm: 0,
      widthCm: 60,
      depth16: 16,
      toolCode: 1,
      tick: 1,
      actorSlot: 0,
      inputSeq: 1,
    };
    expect(s.submit(0, good)).toBe(SUBMIT_OK);
    expect(s.submit(0, { ...good, widthCm: 0 })).toBe(SUBMIT_MALFORMED);
    expect(s.submit(0, { ...good, anchor: -1 })).toBe(SUBMIT_MALFORMED);
    expect(s.submit(0, { ...good, anchor: 1e9 })).toBe(SUBMIT_MALFORMED);
    expect(s.submit(0, { ...good, endUMm: Number.NaN })).toBe(SUBMIT_MALFORMED);
    expect(s.submit(0, { ...good, endUMm: 0.5 })).toBe(SUBMIT_MALFORMED);
    expect(s.submit(0, { ...good, actorSlot: 64 })).toBe(SUBMIT_MALFORMED);
    expect(s.submit(0, { ...good, endUMm: 5000 })).toBe(SUBMIT_TOO_LONG);
    expect(s.submit(77, good)).toBe(SUBMIT_OK); // unknown client: still a server-side stroke
    s.advance(2);
    expect(s.strokesApplied).toBeGreaterThan(0);
  });

  it("Dust Cell capacity stops pickup and the echo (WDS 4.6)", () => {
    const s = new P2Server(t, { ...TEST_OPTIONS, dustCellCapacityG: 50 });
    s.join(0, null);
    const bot = walker(0, { width: 200, depth: 80, speedMm: 200, originU: 0, originV: 0 });
    let full = 0;
    for (let tick = 1; tick <= 400; tick++) {
      if (s.submit(0, bot(tick)) !== SUBMIT_OK) full++;
      s.advance(1);
    }
    expect(s.grams[0]).toBe(50);
    expect(full).toBeGreaterThan(100);
    expect(s.clientHash(0)).toBe(s.serverHash());
  });
});

describe("CPU reference tile atlas", () => {
  it("replay touches only overlapped tiles; a rebuild from ledger + logs reproduces the replayed tile", () => {
    const s = new P2Server(t, { ...TEST_OPTIONS });
    s.join(0, null);
    const c = s.linkOf(0)!.client;
    const tiles = new TileAtlasRef(t, c.view, c.log, c.set, { ...TILE_PRESETS.medium, now: () => 0 });
    c.tiles = tiles;
    // depth16 16: no ledger texel reaches 0, so the comparison isolates replay vs rebuild (no ledger-zero clears).
    const bot = walker(0, { width: 120, depth: 16, speedMm: 150, originU: -4000, originV: -1000 });
    const d = new Float64Array(3);
    dirOf(t, SITE_PLOT, 0, 0, d);
    for (let tick = 1; tick <= 240; tick++) {
      s.submit(0, bot(tick));
      s.advance(1);
      tiles.frame(d);
    }
    expect(tiles.tilesResident).toBeGreaterThan(0);
    expect(tiles.strokesReplayed).toBeGreaterThan(50);
    const slot = tiles.slotOfPlot[SITE_PLOT]!;
    expect(slot).toBeGreaterThanOrEqual(0);
    const n = tiles.px * tiles.px * 4;
    const replayed = tiles.data.slice(slot * n, slot * n + n);
    let cleaned = 0;
    for (let i = 0; i < n; i += 4) if (replayed[i]! < 255) cleaned++;
    expect(cleaned).toBeGreaterThan(20);
    // Force a rebuild of the same tile and compare the dust channel.
    tiles.onLedger(SITE_PLOT);
    tiles.frame(d);
    const rebuilt = tiles.data.subarray(slot * n, slot * n + n);
    let sum = 0;
    let max = 0;
    for (let i = 0; i < n; i += 4) {
      const diff = Math.abs(rebuilt[i]! - replayed[i]!);
      sum += diff;
      if (diff > max) max = diff;
    }
    const mean = sum / (n / 4);
    expect(mean).toBeLessThan(4);
    expect(max).toBeLessThanOrEqual(48);
    expect(tiles.ledgerZeroClears).toBe(0);
    expect(s.clientHash(0)).toBe(s.serverHash());
  }, 60_000);
});

describe("CPU reference tile atlas: chains", () => {
  it("a slow straight chain removes exactly one pass in the tile, like the ledger (no double count at joints)", () => {
    const s = new P2Server(t, { ...TEST_OPTIONS, cadence: "tick" });
    s.join(0, null);
    const c = s.linkOf(0)!.client;
    const tiles = new TileAtlasRef(t, c.view, c.log, c.set, { ...TILE_PRESETS.medium, now: () => 0 });
    c.tiles = tiles;
    const d = new Float64Array(3);
    dirOf(t, SITE_PLOT, 0, 0, d);
    // 120 cm wide, 5 cm per stroke (24 x slower than the width), depth16 16: one pass removes 16 units of u0.
    for (let k = 0; k < 120; k++) {
      s.submit(0, {
        anchor: SITE_PLOT,
        startUMm: -3000 + k * 50,
        startVMm: 400,
        endUMm: -3000 + (k + 1) * 50,
        endVMm: 400,
        widthCm: 120,
        depth16: 16,
        toolCode: 2,
        tick: k + 1,
        actorSlot: 0,
        inputSeq: (k + 1) & 0xffff,
      });
      s.advance(1);
      tiles.frame(d);
    }
    const slot = tiles.slotOfPlot[SITE_PLOT]!;
    expect(slot).toBeGreaterThanOrEqual(0);
    const level = [5, 8, 13][t.classOf[SITE_PLOT]!]!;
    const onePass = Math.round((255 * 16) / (16 * level));
    // Tile texel at plot-local (0, 400) mm: well inside the swept band (u in -3000 .. 3000, v in -200 .. 1000).
    const px = tiles.px;
    const x = Math.floor(12_800 / tiles.texelMm);
    const y = Math.floor((400 + 12_800) / tiles.texelMm);
    const r = tiles.data[(slot * px * px + y * px + x) * 4]!;
    // One rounding step per stroke that partly covers the texel (a 400 mm texel meets 8 or 9 strokes of 50 mm).
    expect(Math.abs(255 - r - onePass)).toBeLessThanOrEqual(5);
    // The ledger cell under it lost exactly depth16 units.
    const ls = c.view.slotOf[SITE_PLOT]!;
    expect(c.view.texels[ls * 1024 + 16 * 32 + 16]).toBe(16 * level - 16);
  });
});

describe("golden scenario", () => {
  it("server + clients + robots + checkpoint + late join + tiles give the recorded numbers", () => {
    const got = computeSimGolden();
    expect(got.clientsMatching).toBe(7);
    expect(got.restoredHash).not.toBe(0);
    expect(got).toEqual(SIM_GOLDEN_EXPECTED);
  }, 120_000);
});

describe("Polished plots", () => {
  it("clients in range compute the stamp themselves; far and late clients learn it from L0", () => {
    const s = new P2Server(t, { ...TEST_OPTIONS });
    s.join(0, null);
    s.join(1, null); // never gets a position: whole-moon L0 only
    let tick = 0;
    let seq = 0;
    // Charge-depth lanes over the whole site plot frame, one 3.2 m stroke per tick.
    for (let lane = -12_000; lane <= 12_000; lane += 900) {
      for (let u = -12_800; u < 12_800; u += 3200) {
        tick++;
        seq += 2;
        s.submit(0, {
          anchor: SITE_PLOT,
          startUMm: u,
          startVMm: lane,
          endUMm: u + 3200,
          endVMm: lane,
          widthCm: 100,
          depth16: 255,
          toolCode: 6,
          tick,
          actorSlot: 0,
          inputSeq: seq & 0xffff,
        });
        s.advance(2);
      }
    }
    s.advance(20);
    expect(s.view.state[SITE_PLOT]).toBe(2);
    expect(s.view.slotOf[SITE_PLOT]).toBe(-1);
    expect(s.log.count(SITE_PLOT)).toBe(0);
    const c0 = s.linkOf(0)!.client;
    expect(c0.view.state[SITE_PLOT]).toBe(2);
    expect(c0.view.slotOf[SITE_PLOT]).toBe(-1);
    expect(s.clientHash(0)).toBe(s.serverHash());
    expect(s.linkOf(1)!.client.view.state[SITE_PLOT]).toBe(2);
    expect(s.linkOf(1)!.client.view.ledgerCount).toBe(0);
    // A late joiner standing on the plot.
    s.join(2, s.linkOf(0)!.pos.slice());
    expect(s.linkOf(2)!.client.view.state[SITE_PLOT]).toBe(2);
    expect(s.clientHash(2)).toBe(s.serverHash());
    expect(s.linkOf(2)!.client.hash()).not.toBe(0);
    expectClean(s);
  }, 60_000);
});
