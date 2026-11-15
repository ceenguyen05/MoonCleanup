// P3 core tests on the real GP(128,0) grid. Run: node_modules/.bin/vitest run --root prototypes/dust-sim/p3-client-paint-minmerge
import { describe, expect, it } from "vitest";
import type { PlotId, RobotPlotIntent, StrokeRecord } from "../../../../packages/shared/src/index";
import { createStrokeSource, DEFAULT_STROKE_SOURCE } from "../../../../tools/bots/src/scenarios/dust-contest/index";
import { createGrid } from "../grid";
import { ByteReader, ByteWriter } from "../src/core/bytes";
import { P3Client, PAINT_OK, PAINT_SEGMENT_TOO_LONG } from "../src/core/client";
import { decodeFull, encodeFull, getNib, setNib } from "../src/core/codec";
import {
  LEVEL_MAX,
  MG_PER_LEVEL_TEXEL,
  STATE_OPENED,
  STATE_POLISHED,
  TILE_PACKED_BYTES,
  TILE_TEXELS,
} from "../src/core/constants";
import { GeomCache, Vec3, localToDir } from "../src/core/geom";
import { BRUSH_FLAT, BRUSH_SOFT } from "../src/core/painter";
import { P3Server } from "../src/core/server";

const grid = createGrid();
const geom = new GeomCache(grid);
const unit = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z);
  const v = new Vec3();
  v.x = x / l;
  v.y = y / l;
  v.z = z / l;
  return v;
};
const SITE = grid.plotAt(unit(0.9046, 0.1392, -0.4028)) as number;
const texel = (uMm: number, vMm: number): number =>
  Math.floor((vMm + 12_800) / 400) * 64 + Math.floor((uMm + 12_800) / 400);

function seg(
  plot: number,
  su: number,
  sv: number,
  eu: number,
  ev: number,
  widthCm = 60,
  depth16 = 16,
  toolCode = 1,
): StrokeRecord {
  return {
    anchor: plot as PlotId,
    startUMm: su,
    startVMm: sv,
    endUMm: eu,
    endVMm: ev,
    widthCm,
    depth16,
    toolCode,
    tick: 0 as StrokeRecord["tick"],
    actorSlot: 0,
    inputSeq: 0,
  };
}

interface World {
  server: P3Server;
  clients: P3Client[];
  slots: number[];
  bytes: number[];
  stroke(i: number, s: StrokeRecord, brush?: number): number;
  pose(i: number, plot: number, uMm: number, vMm: number): void;
  step(n?: number): void;
  upload(i: number): Uint8Array;
  deliver(): void;
  addClient(plot?: number): number;
}

function world(n: number, flushTicks = 1, at = SITE): World {
  const server = new P3Server({ geom, simTickHz: 20, flushTicks, l0Ticks: 10, streamBytesPerFlush: 800 });
  const clients: P3Client[] = [];
  const slots: number[] = [];
  const bytes: number[] = [];
  const up = new ByteWriter(4096);
  const d = new Vec3();
  const w: World = {
    server,
    clients,
    slots,
    bytes,
    addClient(plot = at) {
      const c = grid.centerDirection(plot as PlotId);
      const i = clients.length;
      clients.push(new P3Client(geom));
      slots.push(server.join(i, c.x, c.y, c.z));
      bytes.push(0);
      w.deliver();
      return i;
    },
    pose(i, plot, uMm, vMm) {
      localToDir(geom.get(plot), uMm, vMm, 2000, d);
      server.setPose(slots[i] as number, d.x, d.y, d.z);
    },
    stroke(i, s, brush = BRUSH_FLAT) {
      w.pose(i, s.anchor, s.endUMm, s.endVMm);
      server.setTool(slots[i] as number, s.widthCm, s.depth16, s.toolCode);
      return (clients[i] as P3Client).paint(s, brush);
    },
    upload(i) {
      up.reset();
      const len = (clients[i] as P3Client).encodeUpload(up);
      return up.buf.slice(0, len);
    },
    deliver() {
      for (let i = 0; i < clients.length; i++) {
        const o = server.outOf(slots[i] as number);
        if (o.pos > 0) (clients[i] as P3Client).receive(o.buf, 0, o.pos);
        bytes[i] = (bytes[i] ?? 0) + o.pos;
        o.reset();
      }
    },
    step(k = 1) {
      for (let j = 0; j < k; j++) {
        if ((server.tick + 1) % flushTicks === 0) {
          for (let i = 0; i < clients.length; i++) {
            const m = w.upload(i);
            if (m.length > 0) server.receive(slots[i] as number, m, 0, m.length);
          }
        }
        server.step();
        w.deliver();
      }
    },
  };
  for (let i = 0; i < n; i++) w.addClient();
  return w;
}

const inSync = (w: World): boolean =>
  w.clients.every((c, i) => c.viewHash() === w.server.expectedHash(w.slots[i] as number));

describe("geometry", () => {
  it("ownership mask equals point-to-plot for hexagon, pentagon, pole and a diamond seam plot", () => {
    const d = new Vec3();
    for (const plot of [SITE, 0, grid.params.northPolePlotId, 127, 128 * 128 * 3 + 5]) {
      const g = new GeomCache(grid).get(plot);
      let owned = 0;
      let diff = 0;
      for (let i = 0; i < TILE_TEXELS; i++) {
        localToDir(g, -12_800 + (i & 63) * 400 + 200, -12_800 + (i >> 6) * 400 + 200, 2000, d);
        const exact = grid.plotAt(d) === plot;
        const mine = ((g.owned[i >>> 5] ?? 0) & (1 << (i & 31))) !== 0;
        if (exact) owned++;
        if (exact !== mine) diff++;
      }
      expect(diff).toBe(0);
      expect(g.ownedCount).toBe(owned);
      expect(g.neighborCount).toBe(grid.isPentagon(plot as PlotId) ? 5 : 6);
      // The owned area is the plot area: about 306.8 m^2 = 1,917 texels for a hexagon.
      expect(owned * 0.16).toBeGreaterThan(grid.isPentagon(plot as PlotId) ? 200 : 280);
      expect(owned * 0.16).toBeLessThan(400);
    }
  });
});

describe("codec", () => {
  it("full tile round trips as RLE and falls back to raw for noisy tiles", () => {
    const w = new ByteWriter(64);
    const r = new ByteReader();
    const out = new Uint8Array(TILE_TEXELS);
    const cases: Uint8Array[] = [];
    const blank = new Uint8Array(TILE_PACKED_BYTES).fill(0xff);
    cases.push(blank);
    const patch = blank.slice();
    for (let i = 1000; i < 1400; i++) setNib(patch, i, i % 7);
    cases.push(patch);
    const noise = blank.slice();
    let x = 12345;
    for (let i = 0; i < TILE_TEXELS; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      setNib(noise, i, x >>> 28);
    }
    cases.push(noise);
    const sizes: number[] = [];
    for (const c of cases) {
      w.reset();
      encodeFull(w, c);
      sizes.push(w.pos);
      r.load(w.buf, 0, w.pos);
      expect(decodeFull(r, out)).toBe(true);
      expect(r.remaining).toBe(0);
      for (let i = 0; i < TILE_TEXELS; i++) expect(out[i]).toBe(getNib(c, i));
    }
    expect(sizes[0]).toBe(4);
    expect(sizes[1]).toBeLessThan(500);
    expect(sizes[2]).toBe(TILE_PACKED_BYTES + 1);
  });

  it("truncated and garbage messages never throw on either side", () => {
    const w = world(1);
    w.stroke(0, seg(SITE, -3000, 0, -2000, 0));
    const m = w.upload(0);
    for (let cut = 0; cut < m.length; cut++) w.server.receive(w.slots[0] as number, m, 0, cut);
    const junk = new Uint8Array(200);
    for (let k = 0; k < 50; k++) {
      for (let i = 0; i < junk.length; i++) junk[i] = (Math.imul(i + k * 977, 2654435761) >>> 24) & 0xff;
      junk[0] = 1;
      w.server.receive(w.slots[0] as number, junk, 0, junk.length);
      (w.clients[0] as P3Client).receive(junk, 0, junk.length);
    }
    expect(w.server.rejects[2]).toBeGreaterThan(0);
  });
});

describe("min merge", () => {
  it("is commutative, associative and idempotent: any order and any duplication gives the same bytes", () => {
    // Three clients paint overlapping lanes without hearing each other; their uploads are then merged in every order.
    const src = world(3);
    const msgs: Uint8Array[] = [];
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 40; k++) {
        const u = -6000 + k * 300;
        src.stroke(i, seg(SITE, u, i * 250 - 200, u + 300, i * 250 - 200, 60, 16 * (i + 1)));
        if (k % 8 === 7) msgs.push(src.upload(i));
      }
    }
    const orders = [
      msgs,
      [...msgs].reverse(),
      [...msgs.slice(7), ...msgs.slice(0, 7)],
      [...msgs, ...msgs],
      msgs.flatMap((m) => [m, m, m]),
      [...msgs].sort((a, b) => a.length - b.length || (a[5] ?? 0) - (b[5] ?? 0)),
    ];
    const hashes = new Set<number>();
    const levels: string[] = [];
    for (const order of orders) {
      const w = world(1);
      for (const m of order) {
        w.server.trustNextUpload(0);
        w.server.receive(0, m, 0, m.length);
      }
      hashes.add(w.server.worldHash());
      let s = "";
      for (let i = 0; i < TILE_TEXELS; i++) s += w.server.levelAt(SITE, i).toString(16);
      levels.push(s);
    }
    expect(hashes.size).toBe(1);
    expect(new Set(levels).size).toBe(1);
    expect([...hashes][0]).not.toBe(0);
  });

  it("converges: 6 clustered clients, 10 Hz coalescing, every client byte-identical to the server", () => {
    const w = world(6, 2);
    const srcs = w.clients.map((_, i) =>
      createStrokeSource(grid, {
        ...DEFAULT_STROKE_SOURCE,
        seed: 99,
        botIndex: i,
        clusterPlot: SITE,
        actorSlot: i,
        radiusM: 12,
      }),
    );
    for (let t = 1; t <= 1200; t++) {
      for (let i = 0; i < 6; i++) w.stroke(i, (srcs[i] as (t: number) => StrokeRecord)(t));
      w.step();
      if (t % 100 === 0) expect(inSync(w)).toBe(true);
    }
    expect(w.clients.every((c) => c.viewHash() === w.server.worldHash())).toBe(true);
    for (const c of w.clients) {
      expect(c.drift).toBe(0);
      for (let i = 0; i < TILE_TEXELS; i += 7) expect(c.levelAt(SITE, i)).toBe(w.server.levelAt(SITE, i));
    }
    expect(w.server.texelsMerged).toBeGreaterThan(1000);
    // Overlapping work in the same window is wasted, not summed.
    expect(w.server.texelsStale).toBeGreaterThan(0);
  });

  it("is not additive: two cleaners on one lane inside one latency window remove less than one after the other", () => {
    const lane = (w: World, i: number): void => {
      for (let k = 0; k < 20; k++) w.stroke(i, seg(SITE, -3000 + k * 300, 0, -2700 + k * 300, 0));
    };
    const concurrent = world(2, 1);
    lane(concurrent, 0);
    lane(concurrent, 1);
    concurrent.server.trustNextUpload(0);
    concurrent.server.trustNextUpload(1);
    concurrent.step();
    const sequential = world(2, 1);
    lane(sequential, 0);
    sequential.server.trustNextUpload(0);
    sequential.step();
    lane(sequential, 1);
    sequential.server.trustNextUpload(1);
    sequential.step();
    expect(inSync(concurrent)).toBe(true);
    expect(inSync(sequential)).toBe(true);
    expect(concurrent.server.levelsMerged).toBeLessThan(sequential.server.levelsMerged);
    expect(sequential.server.levelsMerged).toBeGreaterThanOrEqual(concurrent.server.levelsMerged * 1.8);
  });

  it("brush freedom: a soft brush and disc stamps merge with no server change", () => {
    const w = world(2, 1);
    for (let k = 0; k < 30; k++)
      w.stroke(0, seg(SITE, -4000 + k * 200, 2000, -3800 + k * 200, 2000, 160, 48), BRUSH_SOFT);
    w.server.trustNextUpload(0);
    w.step();
    for (let k = 0; k < 6; k++) {
      w.stroke(1, seg(SITE, k * 900, -3000, k * 900, -3000, 80, 255));
      w.step(4);
    }
    expect(inSync(w)).toBe(true);
    const c = w.clients[0] as P3Client;
    // Soft brush (Depth 3 of 5): the core loses 9 of 15 levels, the rim texel next to it loses fewer.
    const core = w.server.levelAt(SITE, texel(-2000, 2200));
    const rim = w.server.levelAt(SITE, texel(-2000, 2600));
    expect(core).toBe(6);
    expect(rim).toBeGreaterThan(core);
    expect(rim).toBeLessThan(LEVEL_MAX);
    expect(c.levelAt(SITE, texel(900, -3000))).toBe(0);
    expect(w.server.rejects.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("server bounds (the only authority over player paint)", () => {
  it("client-side sanity: a segment longer than 4 m is not painted", () => {
    const c = new P3Client(geom);
    expect(c.paint(seg(SITE, 0, 0, 4001, 0))).toBe(PAINT_SEGMENT_TOO_LONG);
    expect(c.paint(seg(SITE, 0, 0, 4000, 0))).toBe(PAINT_OK);
  });

  it("reach: paint far from the server-side pose is refused and the client is snapped back", () => {
    const w = world(2, 1);
    w.pose(0, SITE, 0, 0);
    const c = w.clients[0] as P3Client;
    c.paint(seg(SITE, 7400, 0, 8000, 0, 60, 255)); // 7.4 m from the pose, reach bound 5.7 m
    expect(c.levelAt(SITE, texel(7700, 0))).toBe(0);
    w.step();
    expect(w.server.rejects[0]).toBeGreaterThan(0);
    expect(w.server.texelsMerged).toBe(0);
    expect(c.resyncs).toBe(1);
    expect(c.levelAt(SITE, texel(7700, 0))).toBe(LEVEL_MAX);
    expect(inSync(w)).toBe(true);
    // A plot the pose is nowhere near: nothing is created on the server.
    const far = grid.plotAt(unit(0, 1, 0.2)) as number;
    c.forgeForTest(far, texel(0, 0), 0);
    w.step();
    expect(w.server.tileCount).toBe(1);
    expect(c.levelAt(far, texel(0, 0))).toBe(LEVEL_MAX);
  });

  it("rate: clearing more than the tool can remove is cut off at the bucket and resynced", () => {
    const w = world(1, 1);
    w.pose(0, SITE, 0, 0);
    const c = w.clients[0] as P3Client;
    const g = geom.get(SITE);
    let forged = 0;
    for (let i = 0; i < TILE_TEXELS; i++) {
      const u = -12_800 + (i & 63) * 400 + 200;
      const v = -12_800 + (i >> 6) * 400 + 200;
      if (u * u + v * v < 5000 * 5000 && ((g.owned[i >>> 5] ?? 0) & (1 << (i & 31))) !== 0) {
        c.forgeForTest(SITE, i, 0);
        forged++;
      }
    }
    w.step();
    // Desk Duster bucket: 2 s of 6 m/s x 0.6 m x 3 levels x 1.25 = 168.75 levels, i.e. 11 texels from 15 to 0.
    expect(forged).toBeGreaterThan(400);
    expect(w.server.levelsMerged).toBeLessThanOrEqual(169);
    expect(w.server.levelsMerged).toBeGreaterThan(150);
    expect(w.server.rejects[1]).toBeGreaterThan(forged - 20);
    expect(c.resyncs).toBe(1);
    expect(inSync(w)).toBe(true);
  });

  it("ownership and range: texels of a neighbour's ground and re-dirtying are ignored", () => {
    const w = world(1, 1);
    w.pose(0, SITE, 0, 0);
    const c = w.clients[0] as P3Client;
    c.forgeForTest(SITE, 0, 3); // frame corner: owned by a neighbour
    w.step();
    expect(w.server.rejects[2]).toBe(1);
    expect(w.server.levelAt(SITE, 0)).toBe(LEVEL_MAX);
    w.stroke(0, seg(SITE, -200, 0, 200, 0, 60, 255));
    w.step();
    const t = texel(0, 0);
    expect(w.server.levelAt(SITE, t)).toBe(0);
    c.forgeForTest(SITE, t, 15); // min merge: dust cannot be put back
    w.step();
    expect(w.server.levelAt(SITE, t)).toBe(0);
  });

  it("CHEATING SURFACE: paint inside the bounds is accepted without any sweep; a standing forger out-earns an honest sweeper", () => {
    const seconds = 30;
    const honest = world(1, 2);
    const src = createStrokeSource(grid, {
      ...DEFAULT_STROKE_SOURCE,
      seed: 5,
      botIndex: 0,
      clusterPlot: SITE,
      actorSlot: 0,
    });
    for (let t = 1; t <= seconds * 20; t++) {
      honest.stroke(0, src(t));
      honest.step();
    }
    const cheat = world(1, 2);
    cheat.pose(0, SITE, 0, 0);
    const c = cheat.clients[0] as P3Client;
    const g = geom.get(SITE);
    const reach: number[] = [];
    for (let i = 0; i < TILE_TEXELS; i++) {
      const u = -12_800 + (i & 63) * 400 + 200;
      const v = -12_800 + (i >> 6) * 400 + 200;
      if (u * u + v * v < 5500 * 5500 && ((g.owned[i >>> 5] ?? 0) & (1 << (i & 31))) !== 0) reach.push(i);
    }
    let next = 0;
    for (let t = 1; t <= seconds * 20; t++) {
      // Never moves, never sweeps: every flush it claims as many cleared texels as the rate bound lets through.
      // 5 texels x 15 levels = 75 levels/s, under the 84 levels/s bound of the Desk Duster.
      if (t % 4 === 0 && next < reach.length) c.forgeForTest(SITE, reach[next++] as number, 0);
      cheat.step();
    }
    const honestGrams = honest.server.grams[0] ?? 0;
    const cheatGrams = cheat.server.grams[0] ?? 0;
    expect(cheat.server.rejects.reduce((a, b) => a + b, 0)).toBe(0);
    expect(cheat.server.levelsMerged).toBe(next * LEVEL_MAX);
    expect(cheatGrams).toBeGreaterThan(honestGrams * 1.8);
    expect(Math.abs(cheatGrams - Math.floor((next * LEVEL_MAX * MG_PER_LEVEL_TEXEL) / 1000))).toBeLessThanOrEqual(1);
    console.log(
      `cheating surface: honest 3 m/s Desk Duster ${honestGrams} g in ${seconds} s; standing forger ${cheatGrams} g ` +
        `(${(cheatGrams / honestGrams).toFixed(2)}x), 0 rejects, ${next} texels claimed`,
    );
  });
});

describe("plot states, persistence, join", () => {
  it("Opened at 0.1 % removed, Polished at 1 % left; the tile is freed on both sides and L0 reaches a far client", () => {
    const w = world(1, 1);
    const farPlot = grid.plotAt(unit(0, 1, 0.2)) as number;
    const far = w.addClient(farPlot);
    w.stroke(0, seg(SITE, 0, 0, 0, 0, 100, 255));
    w.server.trustNextUpload(0);
    w.step();
    expect(w.server.state[SITE]).toBe(STATE_OPENED);
    for (let v = -12_800; v < 12_800; v += 600) {
      for (let u = -12_800; u < 12_800; u += 3200) w.stroke(0, seg(SITE, u, v, u + 3200, v, 100, 255));
      w.server.trustNextUpload(0);
      w.step();
    }
    expect(w.server.state[SITE]).toBe(STATE_POLISHED);
    expect(w.server.tileCount).toBeLessThanOrEqual(6); // only the partly swept neighbours remain
    expect((w.clients[0] as P3Client).state[SITE]).toBe(STATE_POLISHED);
    expect((w.clients[far] as P3Client).state[SITE]).toBe(STATE_POLISHED);
    expect((w.clients[far] as P3Client).tileCount).toBe(0);
    expect(inSync(w)).toBe(true);
    expect((w.clients[0] as P3Client).viewHash()).toBe(w.server.worldHash());
    // Painting a Polished plot is a no-op everywhere.
    const before = w.server.worldHash();
    w.stroke(0, seg(SITE, 0, 0, 500, 0, 100, 255));
    w.step();
    expect(w.server.worldHash()).toBe(before);
  });

  it("checkpoint round trip restores tiles, states and credit; a corrupt blob is refused", () => {
    const w = world(4, 2);
    const srcs = w.clients.map((_, i) =>
      createStrokeSource(grid, { ...DEFAULT_STROKE_SOURCE, seed: 21, botIndex: i, clusterPlot: SITE, actorSlot: i }),
    );
    for (let t = 1; t <= 600; t++) {
      for (let i = 0; i < 4; i++) w.stroke(i, (srcs[i] as (t: number) => StrokeRecord)(t));
      w.step();
    }
    expect(w.server.isDirty).toBe(true);
    const ck = new ByteWriter(1024);
    const len = w.server.serialize(ck);
    expect(w.server.isDirty).toBe(false);
    const blob = ck.buf.slice(0, len);
    const back = new P3Server({ geom, simTickHz: 20, flushTicks: 2, l0Ticks: 10, streamBytesPerFlush: 800 });
    expect(back.restore(blob, 0, blob.length)).toBe(true);
    expect(back.worldHash()).toBe(w.server.worldHash());
    expect(back.tick).toBe(w.server.tick);
    expect(back.tileCount).toBe(w.server.tileCount);
    expect([...back.grams.slice(0, 4)]).toEqual([...w.server.grams.slice(0, 4)]);
    expect([...back.state]).toEqual([...w.server.state]);
    expect([...back.remFrac]).toEqual([...w.server.remFrac]);
    const again = new ByteWriter(1024);
    back.serialize(again);
    expect(again.pos).toBe(len);
    const bad = blob.slice();
    bad[40] = (bad[40] ?? 0) ^ 1;
    expect(back.restore(bad, 0, bad.length)).toBe(false);
    expect(back.restore(blob, 0, 10)).toBe(false);
    console.log(
      `checkpoint: ${len} B for ${w.server.tileCount} tiles (${(len / w.server.tileCount).toFixed(0)} B per tile)`,
    );
  });

  it("late join gets blocking tiles then streamed tiles; moving away drops them; a corrupt tile is found and repaired", () => {
    const w = world(4, 2);
    const srcs = w.clients.map((_, i) =>
      createStrokeSource(grid, {
        ...DEFAULT_STROKE_SOURCE,
        seed: 31,
        botIndex: i,
        clusterPlot: SITE,
        actorSlot: i,
        radiusM: 100,
      }),
    );
    let worked = SITE;
    for (let t = 1; t <= 2000; t++) {
      for (let i = 0; i < 4; i++) {
        const s = (srcs[i] as (t: number) => StrokeRecord)(t);
        if (t === 2000 && i === 0) worked = s.anchor;
        w.stroke(i, s);
      }
      w.step();
    }
    const tiles = w.server.tileCount;
    const j = w.addClient();
    const joiner = w.clients[j] as P3Client;
    const blocking = joiner.tileCount;
    expect(blocking).toBeGreaterThan(0);
    expect(blocking).toBeLessThan(tiles);
    expect(joiner.viewHash()).toBe(w.server.expectedHash(w.slots[j] as number));
    w.step(400);
    expect(w.server.hasStream(w.slots[j] as number)).toBe(false);
    expect(joiner.tileCount).toBeGreaterThan(blocking);
    expect(inSync(w)).toBe(true);
    // Drift check: flip a texel locally; the next dust.check (every 5 s) flags it and a resync repairs it.
    let victim = 0;
    while (w.server.levelAt(worked, victim) === LEVEL_MAX) victim++;
    joiner.corruptForTest(worked, victim, w.server.levelAt(worked, victim) + 1);
    w.step(100);
    expect(joiner.drift).toBeGreaterThan(0);
    w.server.resyncAll(w.slots[j] as number);
    w.step(2);
    expect(joiner.viewHash()).toBe(w.server.expectedHash(w.slots[j] as number));
    // Walk 400 m away: every tile is dropped.
    const away = geom.get(SITE);
    const d = new Vec3();
    localToDir(away, 400_000, 0, 2000, d);
    w.server.setPose(w.slots[j] as number, d.x, d.y, d.z);
    w.step(2);
    expect(joiner.tileCount).toBe(0);
    expect(joiner.viewHash()).toBe(w.server.expectedHash(w.slots[j] as number));
  });

  it("robots: the server paints lanes itself, near clients get tile deltas, far clients only L0, chunks are capped", () => {
    const w = world(1, 2);
    const far = w.addClient(grid.plotAt(unit(0, 1, 0.2)) as number);
    const intent = (robotId: number, plotId: number): RobotPlotIntent => ({
      robotId,
      plotId: plotId as PlotId,
      startTick: 1 as RobotPlotIntent["startTick"],
      widthCm: 140,
      depth16: 32,
      speedCmPerS: 90,
      laneMask: [0xffff_ffff, 0],
    });
    expect(w.server.robotIntent(intent(1, SITE))).toBe(21); // one client in range
    w.step(20 * 60);
    expect(w.server.robotChunks).toBeGreaterThan(50);
    expect(w.server.state[SITE]).toBe(STATE_OPENED);
    expect((w.clients[0] as P3Client).robotIntents).toBe(1);
    expect((w.clients[far] as P3Client).robotIntents).toBe(0);
    expect((w.clients[far] as P3Client).tileCount).toBe(0);
    expect((w.clients[far] as P3Client).state[SITE]).toBe(STATE_OPENED);
    expect(inSync(w)).toBe(true);
    expect(w.server.grams[63]).toBeGreaterThan(0);
    // 400 robots want 400 chunks per second; the process cap is 150.
    const before = w.server.robotChunks;
    for (let r = 0; r < 400; r++) w.server.robotIntent(intent(r, SITE + 1 + (r % 200)));
    w.step(200);
    expect(w.server.robotChunks - before).toBeLessThanOrEqual(150 * 10 + 150);
    expect(w.server.robotChunks - before).toBeGreaterThan(150 * 9);
  });
});

describe("golden", () => {
  it("fixed scenario reproduces recorded numbers", () => {
    const run = (): number[] => {
      const w = world(3, 2);
      const srcs = w.clients.map((_, i) =>
        createStrokeSource(grid, {
          ...DEFAULT_STROKE_SOURCE,
          seed: 20261114,
          botIndex: i,
          clusterPlot: SITE,
          actorSlot: i,
        }),
      );
      for (let t = 1; t <= 800; t++) {
        for (let i = 0; i < 3; i++) w.stroke(i, (srcs[i] as (t: number) => StrokeRecord)(t));
        w.step();
      }
      const ck = new ByteWriter(1024);
      return [
        w.server.worldHash(),
        w.server.tileCount,
        w.server.texelsMerged,
        w.server.levelsMerged,
        w.server.grams[0] ?? 0,
        w.bytes[0] ?? 0,
        w.server.serialize(ck),
        (w.clients[2] as P3Client).viewHash(),
      ];
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(a[7]).toBe(a[0]);
    console.log(`golden: ${JSON.stringify(a)}`);
    expect(a).toEqual(GOLDEN);
  });
});

const GOLDEN: number[] = [1331561363, 14, 2487, 3299, 3682, 9830, 955, 1331561363];
