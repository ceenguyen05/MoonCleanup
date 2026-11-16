// Persistence hardening (M1 persist v3 re-review N7, N8): META-only changes make the room dirty, and an encode / capture
// throw is caught, logged and retried instead of becoming an unhandled rejection.
import { STANDARD_GRID_PARAMS, type ContractId, type PlayerId, type RequestId } from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { createPlotGrid } from "@moon-cleanup/world";
import type { SimWorld } from "@moon-cleanup/sim";
import { describe, expect, it, vi } from "vitest";
import { ShiftCore } from "./shift-core";
import { createShiftLedger } from "./shift-ledger";
import {
  MemoryShiftDustStore,
  SHIFT_META_PROBE_INTERVAL_MS,
  ShiftDustPersistence,
  metaSignature,
  type ShiftSimMeta,
} from "./shift-persistence";
import { nearParcelsMask } from "./shift-state";

const CONTRACT = "00000000-0000-4000-8000-0000000000c8" as ContractId;
const data = loadGameData();
const grid = createPlotGrid(STANDARD_GRID_PARAMS);
const world: SimWorld = { grid, ground: { heightAtXYZ: () => 0 } };

/** A META v1-shaped section: bytes 3 (day phase) and 8..15 (tick) move by themselves, byte 20 is "gear". */
function fakeMeta(opts: { tick?: number; phase?: number; gear?: number }): ShiftSimMeta {
  const bytes = new Uint8Array(24);
  bytes[3] = opts.phase ?? 0;
  bytes[8] = (opts.tick ?? 0) & 0xff;
  bytes[9] = ((opts.tick ?? 0) >> 8) & 0xff;
  bytes[20] = opts.gear ?? 0;
  return { version: 1, bytes };
}

function harness(store = new MemoryShiftDustStore()) {
  const warnings: Array<{ obj: object; msg: string }> = [];
  const logger = { warn: (obj: object, msg: string) => void warnings.push({ obj, msg }) };
  const ledger = createShiftLedger(data, world, 20);
  const p = new ShiftDustPersistence(store, ledger, CONTRACT, 0, 0, logger);
  const live = { wallet: 100, meta: fakeMeta({}), metaThrows: false };
  return { store, ledger, p, live, warnings };
}

async function started(h: ReturnType<typeof harness>): Promise<void> {
  await h.p.restore();
  h.p.setStateProvider(
    () => ({ walletLm: h.live.wallet, nearParcelsMask: 0 }),
    () => {
      if (h.live.metaThrows) throw new Error("capture boom");
      return h.live.meta;
    },
  );
}

describe("metaSignature", () => {
  it("ignores the tick and day phase, sees gear, and is null for an unknown layout version", () => {
    const a = metaSignature(fakeMeta({ tick: 5, phase: 1, gear: 2 }))!;
    const b = metaSignature(fakeMeta({ tick: 9000, phase: 3, gear: 2 }))!;
    const c = metaSignature(fakeMeta({ tick: 5, phase: 1, gear: 3 }))!;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    expect(metaSignature({ version: 2, bytes: new Uint8Array(24) })).toBeNull();
    expect(metaSignature({ version: 1, bytes: new Uint8Array(4) })).toBeNull();
    expect(metaSignature(undefined)).toBeNull();
  });

  it("matches the real sim META: ticks and day phase do not change it, a purchase does (pins the v1 offsets)", () => {
    const core = new ShiftCore(
      { data, world, contractId: CONTRACT, shiftType: "private", simTickHz: 20, walletLm: 100_000 },
      0,
    );
    core.addSeat({ playerId: "00000000-0000-4000-8000-0000000000a0" as PlayerId, displayName: "B", role: "holder" }, 0);
    const before = core.captureSharedMeta();
    expect(before.version).toBe(1);
    for (let t = 0; t < 40; t++) core.step({ frame() {}, events() {} });
    const later = core.captureSharedMeta();
    expect(Array.from(metaSignature(later)!)).toEqual(Array.from(metaSignature(before)!));
    expect(Array.from(later.bytes)).not.toEqual(Array.from(before.bytes)); // the raw bytes did move (tick)
    const r = core.sim.applyIntent(0, {
      kind: "purchase",
      requestId: "h-1" as RequestId,
      itemId: "gear.holster_rig",
    });
    expect(r?.ok).toBe(true);
    expect(Array.from(metaSignature(core.captureSharedMeta())!)).not.toEqual(Array.from(metaSignature(later)!));
    expect(nearParcelsMask(core.sim)).toBe(0);
  });
});

describe("review N7: a META-only change checkpoints", () => {
  it("writes a header-only checkpoint when only the gear changed; tick / day phase changes alone write nothing", async () => {
    const h = harness();
    await started(h);
    h.p.maybeSave(31_000, 10);
    expect(h.store.saves).toBe(0); // pristine room: no header
    h.live.meta = fakeMeta({ tick: 700, phase: 2 }); // the clock moved, nothing was bought
    h.p.maybeSave(31_000 + SHIFT_META_PROBE_INTERVAL_MS, 11);
    await h.p.save(40_000, 12);
    expect(h.store.saves).toBe(0);

    h.live.meta = fakeMeta({ tick: 800, gear: 1 }); // wallet unchanged (free item): META only
    h.p.maybeSave(31_000 + 2 * SHIFT_META_PROBE_INTERVAL_MS, 13);
    await h.p.save(50_000, 14);
    expect(h.store.saves).toBe(1);
    expect((await h.store.loadState(CONTRACT))?.simMeta?.bytes[20]).toBe(1);
    expect(h.p.counters.chunksWritten).toBe(0);

    await h.p.save(60_000, 15); // nothing new
    expect(h.store.saves).toBe(1);
  });

  it("the final save sees a META change made inside the probe throttle window", async () => {
    const h = harness();
    await started(h);
    h.p.maybeSave(31_000, 10); // probes now
    h.live.meta = fakeMeta({ gear: 4 });
    h.p.maybeSave(32_000, 11); // inside the 5 s throttle: not probed
    expect(h.store.saves).toBe(0);
    await h.p.close(33_000, 12);
    expect(h.store.saves).toBe(1);
    expect((await h.store.loadState(CONTRACT))?.simMeta?.bytes[20]).toBe(4);
  });

  it("a failed META write stays dirty and is retried", async () => {
    const h = harness();
    await started(h);
    h.live.meta = fakeMeta({ gear: 1 });
    const failing = vi.spyOn(h.store, "save").mockRejectedValueOnce(new Error("db down"));
    await h.p.save(31_000, 10);
    expect(h.p.counters.saveFailures).toBe(1);
    failing.mockRestore();
    await h.p.save(40_000, 11);
    expect(h.store.saves).toBe(1);
  });
});

describe("review N8: an encode / capture throw is caught, logged and retried", () => {
  it("a throwing META capture does not reject; the next checkpoint retries and writes", async () => {
    const h = harness();
    await started(h);
    h.ledger.setChunkDirty(0);
    h.live.wallet = 150;
    h.live.metaThrows = true;
    h.p.maybeSave(31_000, 10); // the void path: a rejection here would be unhandled
    await h.p.save(31_000, 10);
    expect(h.p.counters.saveFailures).toBeGreaterThanOrEqual(1);
    expect(h.warnings.some((w) => w.msg.includes("encode failed") || w.msg.includes("META capture failed"))).toBe(true);
    expect(h.store.saves).toBe(0);
    expect(h.ledger.isChunkDirty(0)).toBe(true);

    h.live.metaThrows = false;
    await h.p.save(100_000, 20);
    expect(h.store.saves).toBe(1);
    expect(h.p.counters.chunksWritten).toBe(1);
  });

  it("a throwing chunk encoder re-marks the chunks it already encoded, then the next checkpoint writes all", async () => {
    const h = harness();
    await started(h);
    for (const c of [0, 1, 2]) h.ledger.setChunkDirty(c);
    const encoder = (h.p as unknown as { encoder: { encode: (...a: unknown[]) => Uint8Array } }).encoder;
    const real = encoder.encode.bind(encoder);
    let calls = 0;
    const spy = vi.spyOn(encoder, "encode").mockImplementation((...a: unknown[]) => {
      if (++calls === 2) throw new Error("encode boom");
      return real(...a);
    });
    await h.p.save(31_000, 10);
    expect(h.p.counters.saveFailures).toBe(1);
    expect(h.warnings.some((w) => w.msg.includes("encode failed"))).toBe(true);
    expect(h.store.saves).toBe(0);
    expect(h.ledger.isChunkDirty(0)).toBe(true); // encoded before the throw: dirty again
    expect(h.ledger.isChunkDirty(1)).toBe(true);
    expect(h.ledger.isChunkDirty(2)).toBe(true);

    spy.mockRestore();
    h.p.maybeSave(33_000, 11); // past the 1 s backoff
    await h.p.save(33_000, 11);
    expect(h.store.saves).toBe(1);
    expect(h.p.counters.chunksWritten).toBe(3);
  });

  it("a store that throws synchronously is a failed write, not a crash", async () => {
    const h = harness();
    await started(h);
    h.ledger.setChunkDirty(5);
    vi.spyOn(h.store, "save").mockImplementationOnce(() => {
      throw new Error("sync boom");
    });
    await h.p.save(31_000, 10);
    expect(h.p.counters.saveFailures).toBe(1);
    expect(h.ledger.isChunkDirty(5)).toBe(true);
  });
});
