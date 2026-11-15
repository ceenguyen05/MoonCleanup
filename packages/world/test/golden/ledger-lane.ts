// Ledger golden vectors V1 (WDS section 4.5b): 1,000 seeded strokes over more than 20 plots with every tool of the
// table (T1 .. T6, Detailing discs, Charge, vehicle intakes, robot lanes), three dust classes and Empty plots.
// Expected values live in ../vectors/ledger-v1.json (per-plot texel SHA-256, remainingUnits, per-actor removed units,
// plus the SHA-256 of the saved chunk payloads). The same function runs in the Node lane and the browser lane; a
// mismatch in any engine is a determinism defect, never a reason to re-record.
//
// Re-record (only with a DUST_MODEL_VERSION change), from the repo root with Node 26:
//   node node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/cli.mjs packages/world/bench/print-ledger-vectors.ts
//     > packages/world/test/vectors/ledger-v1.json
import { DUST_MODEL_VERSION, PlotState } from "@moon-cleanup/shared";
import { encodeDustChunks, restoreDustChunks, sha256Hex } from "../../src/index";
import { makeLedger, mixedAttributes, seededStrokes, SEED, Sink, SITE_PLOT, strokeAt } from "../support/dust";

export interface LedgerVectorPlot {
  readonly plotId: number;
  readonly state: number;
  readonly level: number;
  readonly ownedTexels: number;
  readonly initialUnits: number;
  readonly remainingUnits: number;
  readonly version: number;
  readonly mgPerUnit: number;
  /** FNV-1a 32 drift hash of the texels (0 when Polished). */
  readonly hash: number;
  /** SHA-256 of the 1,024 texel bytes; "" when the plot is Polished (ledger freed). */
  readonly texelsSha256: string;
}

export interface LedgerVectors {
  readonly dustModelVersion: number;
  readonly grid: string;
  readonly seed: number;
  readonly site: number;
  readonly strokeCount: number;
  /** SHA-256 of the stroke records (11 int32 LE each), pinning the generator. */
  readonly strokesSha256: string;
  readonly plots: readonly LedgerVectorPlot[];
  /** Units and milligrams removed per actor slot, in slot order. */
  readonly actors: readonly {
    readonly actorSlot: number;
    readonly removedUnits: number;
    readonly milligrams: number;
  }[];
  readonly totalRemovedUnits: number;
  readonly polishedPlots: number;
  readonly worldHash: number;
  /** SHA-256 over every saved chunk payload (chunk id order), and their total size. */
  readonly chunksSha256: string;
  readonly chunkBytes: number;
  /** worldHash of a fresh ledger restored from those payloads (must equal worldHash). */
  readonly restoredWorldHash: number;
}

export function computeLedgerVectors(): LedgerVectors {
  // 952 seeded strokes of every tool within about 34 m of the site, then 48 Behemoth-intake lane strokes (actor 17,
  // a vehicle: the shift) that take the site plot to Polished.
  const strokes = seededStrokes(952, SEED, 48_000);
  for (let lane = 0; lane < 6; lane++) {
    for (let k = 0; k < 8; k++) {
      const v = -12_500 + lane * 5000;
      const u = -14_000 + k * 3500;
      strokes.push(strokeAt(SITE_PLOT, u, v, u + 3500, v, 560, 208, 17, 11, 953 + lane * 8 + k));
    }
  }
  const packed = new Int32Array(strokes.length * 11);
  strokes.forEach((s, k) => {
    packed.set(
      [
        s.anchor,
        s.startUMm,
        s.startVMm,
        s.endUMm,
        s.endVMm,
        s.widthCm,
        s.depth16,
        s.toolCode,
        s.tick,
        s.actorSlot,
        s.inputSeq,
      ],
      k * 11,
    );
  });
  const strokeBytes = new Uint8Array(packed.length * 4);
  const view = new DataView(strokeBytes.buffer);
  for (let k = 0; k < packed.length; k++) view.setInt32(k * 4, packed[k]!, true);

  const ledger = makeLedger({ attributes: mixedAttributes() });
  const sink = new Sink();
  const units = new Map<number, number>();
  const mg = new Map<number, number>();
  let total = 0;
  for (const s of strokes) {
    ledger.applyStroke(s, sink);
    units.set(s.actorSlot, (units.get(s.actorSlot) ?? 0) + sink.removedUnits);
    mg.set(s.actorSlot, (mg.get(s.actorSlot) ?? 0) + sink.milligrams);
    total += sink.removedUnits;
  }

  const plots: LedgerVectorPlot[] = [];
  for (let p = 0; p < ledger.plotCount; p++) {
    const slot = ledger.slotOf[p]!;
    if (slot < 0 && ledger.state[p] !== PlotState.Polished) continue;
    plots.push({
      plotId: p,
      state: ledger.state[p]!,
      level: ledger.levelOf[p]!,
      ownedTexels: slot < 0 ? 0 : ledger.owned[slot]!,
      initialUnits: slot < 0 ? 0 : ledger.initial[slot]!,
      remainingUnits: slot < 0 ? 0 : ledger.remaining[slot]!,
      version: slot < 0 ? 0 : ledger.version[slot]!,
      mgPerUnit: slot < 0 ? 0 : ledger.mgPerUnit[slot]!,
      hash: ledger.ledgerHash(p),
      texelsSha256: slot < 0 ? "" : sha256Hex(ledger.texels.slice(slot * 1024, slot * 1024 + 1024)),
    });
  }

  const chunks = encodeDustChunks(ledger, 0, false);
  let chunkBytes = 0;
  for (const c of chunks) chunkBytes += c.payload.length;
  const all = new Uint8Array(chunkBytes);
  let at = 0;
  for (const c of chunks) {
    all.set(c.payload, at);
    at += c.payload.length;
  }
  const restored = makeLedger({ attributes: mixedAttributes() });
  restoreDustChunks(
    restored,
    chunks.map((c) => c.payload),
  );

  return {
    dustModelVersion: DUST_MODEL_VERSION,
    grid: "GP(128,0) R=2000",
    seed: SEED,
    site: SITE_PLOT,
    strokeCount: strokes.length,
    strokesSha256: sha256Hex(strokeBytes),
    plots,
    actors: [...units.keys()]
      .sort((a, b) => a - b)
      .map((actorSlot) => ({ actorSlot, removedUnits: units.get(actorSlot) ?? 0, milligrams: mg.get(actorSlot) ?? 0 })),
    totalRemovedUnits: total,
    polishedPlots: ledger.polishedTotal,
    worldHash: ledger.worldHash(),
    chunksSha256: sha256Hex(all),
    chunkBytes,
    restoredWorldHash: restored.worldHash(),
  };
}
