// Golden vectors of the P2 prototype. The same functions run in Node (ledger.test.ts, sim.test.ts) and in real
// browsers (golden.browser.test.ts); the numbers must be bit-identical everywhere. No Node or DOM imports.
//   computeGolden:    prototype form of WDS 4.5b V1: 1,000 seeded strokes over about 20 plots covering every tool of
//                     the table (hand tools, Detailing discs, Charge, vehicle intakes, robot lanes).
//   computeSimGolden: the whole model: 6 clustered cleaners at the frame cadence, wire chains, robot intents, a
//                     checkpoint round trip, a late join and the CPU reference tile atlas.
import { DurableStore, loadWorld, saveWorld } from "../src/core/persistence";
import { P2Server, type StrokeLike } from "../src/core/server";
import { TILE_PRESETS, TileAtlasRef } from "../src/core/tiles";
import { xform } from "../src/core/util";
import {
  applyAll,
  freshView,
  fullDigest,
  mulberry32,
  plotNear,
  realTables,
  seededStrokes,
  SEED,
  SITE_PLOT,
  TEST_OPTIONS,
} from "./support";

export interface GoldenResult {
  readonly ledgers: number;
  readonly polished: number;
  readonly remainingUnits: number;
  readonly worldHash: number;
  readonly digest: number;
}

export function computeGolden(): GoldenResult {
  const view = freshView();
  applyAll(view, seededStrokes(realTables(), 1000, SEED));
  let remaining = 0;
  for (let s = 0; s < view.slotHigh; s++) if (view.plotOfSlot[s]! >= 0) remaining += view.remaining[s]!;
  return {
    ledgers: view.ledgerCount,
    polished: view.polishedAllN,
    remainingUnits: remaining,
    worldHash: view.hashWhere(null),
    digest: fullDigest(view),
  };
}

/** Recorded on Node 26.13.1 (2026-11-14); see README "Golden vectors". */
export const GOLDEN_EXPECTED: GoldenResult = {
  ledgers: 18,
  polished: 0,
  remainingUnits: 902_306,
  worldHash: 692_792_533,
  digest: 2_761_559_337,
};

export interface SimGoldenResult {
  readonly serverHash: number;
  readonly digest: number;
  readonly ledgers: number;
  readonly unitsRemoved: number;
  readonly grams0: number;
  readonly headersSent: number;
  readonly continuationsSent: number;
  readonly bytesClient0: number;
  readonly robotChunks: number;
  /** Clients whose hash equals the server's at the end (of 7: six cleaners and the late joiner). */
  readonly clientsMatching: number;
  readonly lateJoinBlockingBytes: number;
  readonly lateJoinLedgers: number;
  readonly saveBytes: number;
  readonly restoredHash: number;
  /** FNV-1a 32 of the viewer's whole tile atlas (CPU reference, Medium preset). */
  readonly tileDigest: number;
  readonly tilesResident: number;
}

/** A cleaner walking boustrophedon lanes around the site: one canonical stroke record per tick. */
function cleaner(index: number): (tick: number) => StrokeLike {
  const t = realTables();
  const rng = mulberry32(SEED + index);
  let u = -8000 + Math.round(rng() * 16_000);
  let v = -3000 + index * 700;
  let dir = index % 2 === 0 ? 1 : -1;
  const xy = new Int32Array(2);
  return (tick) => {
    let nu = u + dir * 150;
    let nv = v + Math.round((rng() - 0.5) * 40);
    if (nu > 22_000 || nu < -18_000) {
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
      widthCm: index % 3 === 0 ? 120 : 60,
      depth16: index % 3 === 0 ? 32 : 16,
      toolCode: index % 3 === 0 ? 2 : 1,
      tick,
      actorSlot: index,
      inputSeq: tick & 0xffff,
    };
  };
}

export function computeSimGolden(): SimGoldenResult {
  const t = realTables();
  const s = new P2Server(t, { ...TEST_OPTIONS });
  const ids = [0, 1, 2, 3, 4, 5];
  const bots = ids.map((i) => cleaner(i));
  for (const id of ids) s.join(id, null);
  const viewer = s.linkOf(0)!;
  const tiles = new TileAtlasRef(t, viewer.client.view, viewer.client.log, viewer.client.set, {
    ...TILE_PRESETS.medium,
    now: () => 0,
  });
  viewer.client.tiles = tiles;
  const store = new DurableStore();
  let saveBytes = 0;
  let restoredHash = 0;
  for (let tick = 1; tick <= 800; tick++) {
    for (const id of ids) s.submit(id, bots[id]!(tick));
    if (tick === 100) {
      s.submitRobotIntent(0, SITE_PLOT, tick, 140, 32, 90, 0x00ff_00ff, 0);
      s.submitRobotIntent(1, t.neighbors[SITE_PLOT * 6]!, tick, 80, 16, 120, 0xffff_ffff, 0x3);
    }
    s.advance(1);
    if (viewer.hasPos) tiles.frame(viewer.pos);
    if (tick === 600) {
      saveWorld(s, store);
      saveBytes = store.lastSaveBytes;
      const b = new P2Server(t, { ...TEST_OPTIONS });
      loadWorld(b, store);
      restoredHash = b.serverHash() === s.serverHash() ? b.serverHash() : 0;
    }
  }
  const join = s.join(99, s.activity.slice());
  for (let tick = 801; tick <= 840; tick++) {
    for (const id of ids) s.submit(id, bots[id]!(tick));
    s.advance(1);
    tiles.frame(viewer.pos);
  }
  const want = s.serverHash();
  let matching = 0;
  for (const id of [...ids, 99]) if (s.clientHash(id) === want) matching++;
  let h = 0x811c9dc5;
  const d = tiles.data;
  for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i]!, 0x01000193);
  return {
    serverHash: want,
    digest: fullDigest(s.view),
    ledgers: s.view.ledgerCount,
    unitsRemoved: s.unitsRemoved,
    grams0: s.grams[0]!,
    headersSent: s.headersSent,
    continuationsSent: s.contsSent,
    bytesClient0: viewer.bytes,
    robotChunks: s.plans.chunksApplied,
    clientsMatching: matching,
    lateJoinBlockingBytes: join.blockingBytes,
    lateJoinLedgers: join.ledgersBlocking + join.ledgersStreamed,
    saveBytes,
    restoredHash,
    tileDigest: h >>> 0,
    tilesResident: tiles.tilesResident,
  };
}

/** Recorded on Node 26.13.1 (2026-11-14); see README "Golden vectors". */
export const SIM_GOLDEN_EXPECTED: SimGoldenResult = {
  serverHash: 3_789_283_214,
  digest: 86_578_388,
  ledgers: 6,
  unitsRemoved: 27_390,
  grams0: 19_817,
  headersSent: 42,
  continuationsSent: 15_168,
  bytesClient0: 56_361,
  robotChunks: 74,
  clientsMatching: 7,
  lateJoinBlockingBytes: 60_970,
  lateJoinLedgers: 6,
  saveBytes: 9372,
  restoredHash: 4_156_133_143,
  tileDigest: 1_679_613_840,
  tilesResident: 6,
};
