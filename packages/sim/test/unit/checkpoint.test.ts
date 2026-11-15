import { describe, expect, test } from "vitest";
import {
  INPUT_BUTTON_MASK as M,
  MAX_PLAYERS_PER_ROOM,
  type RequestId,
  type RoomSimEvent,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { loadGameData } from "@moon-cleanup/game-data";
import { mulberry32 } from "@moon-cleanup/world";
import {
  AvatarState,
  cellCapGrams,
  createSimConfig,
  dayPhaseAt,
  SIM_CHECKPOINT_META_MAX_BYTES,
  SIM_CHECKPOINT_META_VERSION,
  SIM_CHECKPOINT_PLAYERS_MAX_BYTES,
  SIM_CHECKPOINT_PLAYERS_VERSION,
  simCheckpointPlayerRecordBytes,
  simCheckpointPlayersBytes,
  toolCodeOf,
  ToolState,
  type MoonRoomSim,
  type MoonRoomSimOptions,
  type SimCheckpoint,
  type SimRestoreRejectCode,
} from "../../src/index";
import { GOLDEN_REPLAY } from "../golden/cases";
import { GOLDEN_TICKS, GoldenRun } from "../golden/replay";
import { flatWorld, makeSim, PLAYER, testWorld } from "../support/world";

const cfg = createSimConfig(loadGameData());
const TOOLS = cfg.tools.length;
const REC = simCheckpointPlayerRecordBytes(TOOLS);
const SECOND = { ...PLAYER, displayName: "Second" };

// Byte offsets of the v1 layouts (see src/room/checkpoint.ts). A layout change must bump the section version.
const META = {
  tickHz: 0,
  toolCount: 2,
  dayPhase: 3,
  toolTableHash: 4,
  tickLo: 8,
  tickHi: 12,
  wallet: 16,
  std: 24,
  copies: 28,
};
const P = {
  slot: 0,
  avatarFlags: 1,
  moveState: 2,
  px: 4,
  vx: 28,
  fx: 52,
  coyoteTicks: 108,
  plotHint: 144,
  toolCode: 148,
  holsterSlot: 149,
  toolFlags: 150,
  owned: 156,
  mgAccum: 162,
  aim01: 172,
  headX: 188,
  cellGrams: 260,
  moveX: 260 + 4 * TOOLS + 8,
  actorFlags: 260 + 4 * TOOLS + 12,
};

/** Offset of a field of record `i` in a PLAYERS body. */
function rec(i: number, field: number): number {
  return 2 + i * REC + field;
}

function copyOf(ck: SimCheckpoint): {
  metaVersion: number;
  meta: Uint8Array;
  playersVersion: number;
  players: Uint8Array;
} {
  return { ...ck, meta: ck.meta.slice(), players: ck.players.slice() };
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function twoActorSim(extra: Partial<MoonRoomSimOptions> = {}): MoonRoomSim {
  const sim = makeSim(testWorld(), extra);
  sim.addActor(0, PLAYER);
  sim.addActor(1, SECOND);
  return sim;
}

/** A busy two-actor state: the golden script after `ticks` ticks (purchase and holster swap included from 421). */
function busyRun(ticks = 1500): GoldenRun {
  const run = new GoldenRun();
  for (let t = 0; t < ticks; t++) run.step();
  return run;
}

/** Restores `ck` into `target` and expects a rejection that changes nothing. */
function expectRejected(target: MoonRoomSim, ck: SimCheckpoint, code: SimRestoreRejectCode, detail?: string): void {
  const hash = target.stateHash();
  const wallet = target.wallet;
  const rejected = target.counters.restoresRejected;
  const res = target.restoreCheckpoint(ck);
  expect(res.ok).toBe(false);
  expect(res.code).toBe(code);
  if (detail !== undefined) expect(res.detail).toBe(detail);
  expect(res.restoredActors).toBe(0);
  expect(target.stateHash()).toBe(hash);
  expect(target.wallet).toBe(wallet);
  expect(res.tick).toBe(target.tick);
  expect(target.counters.restoresRejected).toBe(rejected + 1);
}

function scripted(t: number): SimInputCommand {
  const phase = Math.floor(t / 40) % 6;
  return {
    seq: t & 0xffff,
    moveX: phase === 3 ? 90 : 0,
    moveY: phase === 5 ? 0 : 127,
    yaw: (t * 211) & 0xffff,
    pitch: -10,
    buttons:
      (phase === 0 || phase === 4 ? M.toolPrimary : 0) |
      (phase === 1 ? M.toolSecondary : 0) |
      (phase === 2 ? M.lope : 0) |
      (t % 53 < 6 ? M.jump : 0) |
      (t % 200 === 7 ? M.lampCycle : 0),
    toolParam: 120 + (t % 100),
  };
}

describe("checkpoint: save -> restore -> continue", () => {
  test("restoring into fresh sims at ten points of the golden script reproduces the recorded golden hashes", () => {
    const run = new GoldenRun();
    const points = new Set([1, 137, 399, 400, 421, 1500, 2500, 5003, 7777, GOLDEN_TICKS - 1]);
    let restores = 0;
    for (let t = 0; t < GOLDEN_TICKS; t++) {
      if (points.has(t)) {
        const old = run.sim;
        const ck = copyOf(old.captureCheckpoint());
        // A fresh sim: default wallet (0, not the script's 500), tick 0, spawn poses, only the Desk Duster. The dust
        // ledger is the host's (DustLedgerPort) and carries over, as it does for a host that reloads its dust chunks.
        const fresh = twoActorSim({ ledger: old.ledger });
        const res = fresh.restoreCheckpoint(ck);
        expect(res).toEqual({
          ok: true,
          code: "ok",
          detail: "",
          tick: t,
          restoredActors: 2,
          skippedRecords: 0,
          clampedValues: 0,
          ignoredGearKeys: 0,
        });
        expect(fresh.tick).toBe(old.tick);
        expect(fresh.wallet).toBe(old.wallet);
        expect(fresh.stateHash()).toBe(old.stateHash());
        for (let s = 0; s < 2; s++) {
          expect(fresh.avatar(s)).toEqual(old.avatar(s));
          expect(fresh.toolState(s)).toEqual(old.toolState(s));
        }
        // Canonical bytes: capturing the restored sim gives the same sections.
        expect(fresh.captureCheckpoint()).toEqual(ck);
        run.attach(fresh);
        restores++;
      }
      run.step();
    }
    expect(restores).toBe(points.size);
    expect(run.result()).toEqual(GOLDEN_REPLAY);
    expect(run.result().stateHash).toBe(GOLDEN_REPLAY.stateHash);
  });

  test("tools, Holster, Dust Cell contents, wallet, pose and tick come back", () => {
    const run = busyRun(1500);
    const old = run.sim;
    const squeegee = toolCodeOf(cfg, "tool.crescent_squeegee");
    expect((old.toolState(1).owned >> squeegee) & 1).toBe(1);
    expect(old.wallet).toBe(425); // 500 - 75
    const fresh = twoActorSim({ ledger: old.ledger });
    expect((fresh.toolState(1).owned >> squeegee) & 1).toBe(0);
    expect(fresh.restoreCheckpoint(old.captureCheckpoint()).ok).toBe(true);
    expect(fresh.tick).toBe(1500);
    expect(fresh.wallet).toBe(425);
    const a = old.snapshot();
    const b = fresh.snapshot();
    expect(b).toEqual(a);
    for (let s = 0; s < 2; s++) {
      expect(b.actors[s]!.tool.cellGrams).toBe(old.toolState(s).cellGrams[old.toolState(s).toolCode]);
      expect([...fresh.toolState(s).cellGrams]).toEqual([...old.toolState(s).cellGrams]);
      expect(fresh.toolState(s).holsterSlot).toBe(old.toolState(s).holsterSlot);
    }
    // Standard Issue and Repeat Requisition bookkeeping: everyone owns the Squeegee, also an actor who joins after the
    // restore. Actor 1 carries it (already owned); actor 0 owns it but carries one tool, so the Desk hands it over free.
    fresh.addActor(2, { ...PLAYER, displayName: "Third" });
    expect((fresh.toolState(2).owned >> squeegee) & 1).toBe(1);
    const again = fresh.applyIntent(1, {
      kind: "purchase",
      requestId: "00000000-0000-4000-8000-0000000000f2" as RequestId,
      itemId: "tool.crescent_squeegee",
    });
    expect(again).toMatchObject({ ok: false, code: "already_owned" });
    const handOver = fresh.applyIntent(0, {
      kind: "purchase",
      requestId: "00000000-0000-4000-8000-0000000000f3" as RequestId,
      itemId: "tool.crescent_squeegee",
    });
    expect(handOver).toMatchObject({ ok: true, walletAfter: 425 });
    expect(fresh.toolState(0).toolCode).toBe(squeegee);
  });

  test("events and per-tick hashes after a restore equal the uninterrupted run (one actor, flat world)", () => {
    const SAVE_AT = 300;
    const END = 900;
    const drive = (sim: MoonRoomSim, from: number, to: number, hashes: number[]): void => {
      for (let t = from; t < to; t++) {
        sim.applyInput(0, scripted(t));
        sim.step(sim.config.dt);
        if (t >= SAVE_AT) hashes.push(sim.stateHash());
      }
    };
    // Uninterrupted.
    const a = makeSim(flatWorld());
    a.addActor(0, PLAYER);
    const eventsA: RoomSimEvent[] = [];
    const hashesA: number[] = [];
    a.onEvent((e) => {
      if (a.tick >= SAVE_AT) eventsA.push(e); // `tick` is the tick being stepped while listeners run
    });
    drive(a, 0, END, hashesA);
    // Saved at SAVE_AT, restored into a fresh sim, continued.
    const first = makeSim(flatWorld());
    first.addActor(0, PLAYER);
    drive(first, 0, SAVE_AT, []);
    const ck = copyOf(first.captureCheckpoint());
    const b = makeSim(flatWorld(), { ledger: first.ledger });
    b.addActor(0, PLAYER);
    const eventsB: RoomSimEvent[] = [];
    const hashesB: number[] = [];
    b.onEvent((e) => eventsB.push(e));
    expect(b.restoreCheckpoint(ck).ok).toBe(true);
    drive(b, SAVE_AT, END, hashesB);
    expect(hashesB).toEqual(hashesA);
    expect(eventsB).toEqual(eventsA);
    expect(eventsA.some((e) => e.name === "dust.collected")).toBe(true);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  test("a restore on a day-phase boundary announces the phase exactly once, like the saved sim", () => {
    let boundary = 1;
    while (dayPhaseAt(cfg, boundary) === dayPhaseAt(cfg, boundary - 1)) boundary++;
    const a = makeSim(flatWorld(), { startTick: boundary - 2 });
    a.addActor(0, PLAYER);
    a.step(cfg.dt);
    a.step(cfg.dt);
    expect(a.tick).toBe(boundary);
    const b = makeSim(flatWorld());
    b.addActor(0, PLAYER);
    expect(b.restoreCheckpoint(a.captureCheckpoint()).ok).toBe(true);
    const seen: RoomSimEvent[][] = [[], []];
    a.onEvent((e) => seen[0]!.push(e));
    b.onEvent((e) => seen[1]!.push(e));
    for (let k = 0; k < 3; k++) {
      a.step(cfg.dt);
      b.step(cfg.dt);
    }
    expect(seen[0]!.filter((e) => e.name === "daynight.changed")).toHaveLength(1);
    expect(seen[1]).toEqual(seen[0]);
  });

  test("suit gear is restored and its derived values recomputed (Hop Pack charges, Dust Cell levels)", () => {
    const gear = { "gear.hop_pack": 2, "cellLevel.tool.desk_duster": 2, "gear.crown_lamp": 1 };
    const a = makeSim(flatWorld(), { suitGear: gear });
    a.addActor(0, PLAYER);
    const b = makeSim(flatWorld());
    b.addActor(0, PLAYER);
    expect(b.avatar(0).hopMaxCharges).toBe(0);
    const res = b.restoreCheckpoint(a.captureCheckpoint());
    expect(res.ok).toBe(true);
    expect(b.snapshot().shift.suitGear).toEqual(gear);
    expect(b.avatar(0).hopMaxCharges).toBe(a.avatar(0).hopMaxCharges);
    expect(b.avatar(0).hopMaxCharges).toBeGreaterThan(0);
    expect(b.toolState(0).cellLevel[toolCodeOf(cfg, "tool.desk_duster")]).toBe(2);
    expect(b.snapshot().actors[0]!.tool.cellCapGrams).toBe(a.snapshot().actors[0]!.tool.cellCapGrams);
    expect(b.stateHash()).toBe(a.stateHash());
  });

  test("records of slots nobody joined are skipped and counted; a joined actor without a record keeps its state", () => {
    const old = busyRun(600).sim;
    const ck = old.captureCheckpoint();
    const onlyFirst = makeSim(testWorld());
    onlyFirst.addActor(0, PLAYER);
    const res = onlyFirst.restoreCheckpoint(ck);
    expect(res).toMatchObject({ ok: true, restoredActors: 1, skippedRecords: 1 });
    expect(onlyFirst.avatar(0)).toEqual(old.avatar(0));
    expect(onlyFirst.avatar(1).active).toBe(false);

    const three = twoActorSim();
    three.addActor(4, { ...PLAYER, displayName: "Fifth" });
    const before = { ...three.avatar(4) };
    expect(three.restoreCheckpoint(ck)).toMatchObject({ ok: true, restoredActors: 2, skippedRecords: 0 });
    expect({ ...three.avatar(4) }).toEqual(before);
  });

  test("the codec covers every AvatarState and ToolState field (update src/room/checkpoint.ts when one is added)", () => {
    expect(Object.keys(new AvatarState())).toHaveLength(31);
    // 33 = 32 saved fields + cellCapacityBonus (derived from the board's Densifier level, re-applied on restore).
    expect(Object.keys(new ToolState(TOOLS))).toHaveLength(33);
    const ck = busyRun(50).sim.captureCheckpoint();
    expect(ck.metaVersion).toBe(SIM_CHECKPOINT_META_VERSION);
    expect(ck.playersVersion).toBe(SIM_CHECKPOINT_PLAYERS_VERSION);
    expect(ck.players).toHaveLength(simCheckpointPlayersBytes(2, TOOLS));
    expect(ck.players.length).toBeLessThan(SIM_CHECKPOINT_PLAYERS_MAX_BYTES);
    expect(simCheckpointPlayersBytes(MAX_PLAYERS_PER_ROOM, 31)).toBeLessThanOrEqual(SIM_CHECKPOINT_PLAYERS_MAX_BYTES);
    expect(ck.meta.length).toBeLessThan(SIM_CHECKPOINT_META_MAX_BYTES);
  });
});

describe("checkpoint: untrusted input is rejected and changes nothing", () => {
  const source = busyRun(1500).sim;
  const good = source.captureCheckpoint();
  const target = (): MoonRoomSim => twoActorSim();

  test("the unmodified checkpoint is accepted (control)", () => {
    expect(target().restoreCheckpoint(copyOf(good)).ok).toBe(true);
  });

  test("unsupported section versions, including the interim version 0", () => {
    const t = target();
    expectRejected(t, { ...good, metaVersion: 0 }, "unsupported_version", "metaVersion");
    expectRejected(t, { ...good, metaVersion: 2 }, "unsupported_version", "metaVersion");
    expectRejected(t, { ...good, playersVersion: 0 }, "unsupported_version", "playersVersion");
    expectRejected(t, { ...good, playersVersion: 99 }, "unsupported_version", "playersVersion");
  });

  test("oversize bodies are rejected before parsing", () => {
    const t = target();
    expectRejected(t, { ...good, meta: new Uint8Array(SIM_CHECKPOINT_META_MAX_BYTES + 1) }, "oversize", "meta");
    expectRejected(
      t,
      { ...good, players: new Uint8Array(SIM_CHECKPOINT_PLAYERS_MAX_BYTES + 1) },
      "oversize",
      "players",
    );
    expectRejected(t, { ...good, players: new Uint8Array(4 * 1024 * 1024) }, "oversize", "players");
  });

  test("values that are not byte arrays", () => {
    const t = target();
    const bad: readonly unknown[] = [
      null,
      undefined,
      {},
      42,
      "MCSV",
      { ...good, meta: [...good.meta] },
      { ...good, players: "x" },
      { ...good, meta: good.meta.buffer },
      { ...good, players: new Float64Array(8) },
    ];
    for (const value of bad) expectRejected(t, value as SimCheckpoint, "malformed", "checkpoint");
    // Bytes without versions are not a checkpoint of this codec either.
    expectRejected(t, { meta: good.meta, players: good.players } as SimCheckpoint, "unsupported_version");
  });

  test("every truncation and any trailing byte", () => {
    const t = target();
    for (let n = 0; n < good.meta.length; n++) expectRejected(t, { ...good, meta: good.meta.slice(0, n) }, "malformed");
    for (let n = 0; n < good.players.length; n += 3) {
      expectRejected(t, { ...good, players: good.players.slice(0, n) }, "malformed");
    }
    const longer = (b: Uint8Array): Uint8Array => {
      const out = new Uint8Array(b.length + 1);
      out.set(b);
      return out;
    };
    expectRejected(t, { ...good, meta: longer(good.meta) }, "malformed", "meta.length");
    expectRejected(t, { ...good, players: longer(good.players) }, "malformed", "players.length");
  });

  test("a checkpoint written for another tick rate or tool table", () => {
    const fast = makeSim(testWorld(), { tickHz: 40 });
    fast.addActor(0, PLAYER);
    expectRejected(target(), fast.captureCheckpoint(), "config_mismatch", "meta.tickHz");
    const ck = copyOf(good);
    view(ck.meta).setUint32(META.toolTableHash, 0x12345678, true);
    expectRejected(target(), ck, "config_mismatch", "meta.toolTableHash");
    const ck2 = copyOf(good);
    ck2.players[1] = TOOLS - 1;
    expectRejected(target(), ck2, "config_mismatch", "players.toolCount");
    const ck3 = copyOf(good);
    ck3.meta[META.toolCount] = TOOLS + 1;
    expect(target().restoreCheckpoint(ck3).ok).toBe(false);
  });

  type Patch = (meta: DataView, players: DataView) => void;
  const cases: readonly (readonly [string, SimRestoreRejectCode, string, Patch])[] = [
    ["NaN position", "out_of_range", "avatar.position", (_m, p) => p.setFloat64(rec(0, P.px), NaN, true)],
    ["infinite position", "out_of_range", "avatar.position", (_m, p) => p.setFloat64(rec(1, P.px + 8), Infinity, true)],
    [
      "position at the moon centre",
      "out_of_range",
      "avatar.position",
      (_m, p) => {
        for (let k = 0; k < 3; k++) p.setFloat64(rec(0, P.px + 8 * k), 0, true);
      },
    ],
    ["position far outside", "out_of_range", "avatar.position", (_m, p) => p.setFloat64(rec(0, P.px), 1e7, true)],
    ["absurd velocity", "out_of_range", "avatar.velocity", (_m, p) => p.setFloat64(rec(0, P.vx), 1e9, true)],
    ["NaN velocity", "out_of_range", "avatar.velocity", (_m, p) => p.setFloat64(rec(0, P.vx + 16), NaN, true)],
    [
      "zero facing",
      "out_of_range",
      "avatar.facing",
      (_m, p) => {
        for (let k = 0; k < 3; k++) p.setFloat64(rec(0, P.fx + 8 * k), 0, true);
      },
    ],
    ["unknown move state", "out_of_range", "avatar.moveState", (_m, p) => p.setUint8(rec(0, P.moveState), 3)],
    ["unknown avatar flag bit", "malformed", "avatar.flags", (_m, p) => p.setUint8(rec(0, P.avatarFlags), 0x80)],
    [
      "plot hint outside the grid",
      "out_of_range",
      "avatar.plotHint",
      (_m, p) => p.setUint32(rec(0, P.plotHint), 163_842, true),
    ],
    ["tool code outside the table", "out_of_range", "tool.toolCode", (_m, p) => p.setUint8(rec(0, P.toolCode), 200)],
    [
      "non-cleaning tool equipped",
      "out_of_range",
      "tool.toolCode",
      (_m, p) => p.setUint8(rec(0, P.toolCode), toolCodeOf(cfg, "tool.assembly_gun")),
    ],
    [
      "equipped tool that is not owned",
      "out_of_range",
      "tool.toolCode",
      (_m, p) => p.setUint8(rec(0, P.toolCode), toolCodeOf(cfg, "tool.ion_curtain")),
    ],
    [
      "holster slot outside the Holster",
      "out_of_range",
      "tool.holsterSlot",
      (_m, p) => p.setUint8(rec(0, P.holsterSlot), 6),
    ],
    [
      "owned bit outside the tool table",
      "out_of_range",
      "tool.owned",
      (_m, p) => p.setUint32(rec(0, P.owned), 0x00100003, true),
    ],
    [
      "owned without the Standard Issue tools",
      "out_of_range",
      "tool.owned",
      (_m, p) => p.setUint32(rec(0, P.owned), 0, true),
    ],
    ["unknown tool flag bit", "malformed", "tool.flags", (_m, p) => p.setUint16(rec(0, P.toolFlags), 0x8000, true)],
    [
      "milligram remainder of a gram or more",
      "out_of_range",
      "tool.mgAccum",
      (_m, p) => p.setUint16(rec(0, P.mgAccum), 1000, true),
    ],
    ["aim outside 0..1", "out_of_range", "tool.aim01", (_m, p) => p.setFloat64(rec(0, P.aim01), 1.5, true)],
    ["NaN tool head", "out_of_range", "tool.head", (_m, p) => p.setFloat64(rec(0, P.headX), NaN, true)],
    [
      "negative Dust Cell grams",
      "out_of_range",
      "tool.cellGrams",
      (_m, p) => p.setInt32(rec(0, P.cellGrams), -5, true),
    ],
    ["stick outside the input range", "out_of_range", "input.move", (_m, p) => p.setInt8(rec(0, P.moveX), -128)],
    ["unknown actor flag bit", "malformed", "actor.flags", (_m, p) => p.setUint8(rec(0, P.actorFlags), 2)],
    [
      "slot outside the room",
      "out_of_range",
      "player.slot",
      (_m, p) => p.setUint8(rec(1, P.slot), MAX_PLAYERS_PER_ROOM),
    ],
    ["two records for one slot", "malformed", "player.slot", (_m, p) => p.setUint8(rec(1, P.slot), 0)],
    ["more records than slots", "malformed", "players.count", (_m, p) => p.setUint8(0, MAX_PLAYERS_PER_ROOM + 1)],
    ["record count that does not match the length", "malformed", "players.length", (_m, p) => p.setUint8(0, 1)],
    ["negative wallet", "out_of_range", "meta.walletLm", (m) => m.setFloat64(META.wallet, -1, true)],
    ["NaN wallet", "out_of_range", "meta.walletLm", (m) => m.setFloat64(META.wallet, NaN, true)],
    ["infinite wallet", "out_of_range", "meta.walletLm", (m) => m.setFloat64(META.wallet, Infinity, true)],
    ["tick beyond 2^53", "out_of_range", "meta.tick", (m) => m.setUint32(META.tickHi, 0x200000, true)],
    ["unknown day phase", "out_of_range", "meta.dayPhase", (m) => m.setUint8(META.dayPhase, 4)],
    [
      "Standard Issue bit for a non-cleaning tool",
      "out_of_range",
      "meta.standardIssueOwned",
      (m) => m.setUint32(META.std, 1 << toolCodeOf(cfg, "tool.assembly_gun"), true),
    ],
    ["negative copies bought", "out_of_range", "meta.copiesBought", (m) => m.setInt32(META.copies + 4, -1, true)],
  ];

  test.each(cases)("%s -> %s (%s)", (_name, code, detail, patch) => {
    const ck = copyOf(good);
    patch(view(ck.meta), view(ck.players));
    expectRejected(target(), ck, code, detail);
  });

  test("suit-gear keys: control characters and duplicates are malformed; unknown keys are ignored", () => {
    const src = makeSim(flatWorld(), { suitGear: { "gear.hop_pack": 1, "gear.not_in_this_build": 3 } });
    src.addActor(0, PLAYER);
    const ck = copyOf(src.captureCheckpoint());
    const t = makeSim(flatWorld());
    t.addActor(0, PLAYER);
    const ok = t.restoreCheckpoint(copyOf(ck));
    expect(ok).toMatchObject({ ok: true, ignoredGearKeys: 1 });
    expect(t.snapshot().shift.suitGear).toEqual({ "gear.hop_pack": 1 });

    const gearAt = META.copies + 4 * TOOLS; // u8 count, then entries (sorted keys: gear.hop_pack first)
    expect(ck.meta[gearAt]).toBe(2);
    const control = copyOf(ck);
    control.meta[gearAt + 2] = 0x07;
    expectRejected(t, control, "malformed", "meta.gearKey");
    const count = copyOf(ck);
    count.meta[gearAt] = 200;
    expectRejected(t, count, "malformed", "meta.gearCount");
    // Duplicate: rewrite the second key so that both entries read "gear.hop_pack" is not possible without resizing;
    // build the body by hand instead.
    const key = "gear.hop_pack";
    const head = ck.meta.slice(0, gearAt);
    const dup = new Uint8Array(head.length + 1 + 2 * (1 + key.length + 1));
    dup.set(head);
    let at = gearAt;
    dup[at++] = 2;
    for (let n = 0; n < 2; n++) {
      dup[at++] = key.length;
      for (let k = 0; k < key.length; k++) dup[at++] = key.charCodeAt(k);
      dup[at++] = 1;
    }
    expectRejected(t, { ...ck, meta: dup }, "malformed", "meta.gearKey");
  });
});

describe("checkpoint: tunable bounds are clamped, not trusted", () => {
  const source = busyRun(1500).sim;
  const good = source.captureCheckpoint();

  test("Dust Cell grams above capacity are clamped to capacity and the Cell reads full", () => {
    const ck = copyOf(good);
    const code = source.toolState(0).toolCode;
    view(ck.players).setInt32(rec(0, P.cellGrams + 4 * code), 2_000_000_000, true);
    const t = twoActorSim();
    const res = t.restoreCheckpoint(ck);
    expect(res).toMatchObject({ ok: true, clampedValues: 1 });
    const cap = cellCapGrams(cfg, cfg.tools[code]!, 0);
    expect(t.toolState(0).cellGrams[code]).toBe(cap);
    expect(t.toolState(0).fullLatched).toBe(true);
    expect(t.snapshot().actors[0]!.tool.cellGrams).toBe(cap);
  });

  test("grams in the Cell of a tool that has no Cell are dropped", () => {
    const ck = copyOf(good);
    const gun = toolCodeOf(cfg, "tool.assembly_gun");
    view(ck.players).setInt32(rec(0, P.cellGrams + 4 * gun), 123, true);
    const t = twoActorSim();
    expect(t.restoreCheckpoint(ck)).toMatchObject({ ok: true, clampedValues: 1 });
    expect(t.toolState(0).cellGrams[gun]).toBe(0);
  });

  test("timers beyond their configured length are clamped", () => {
    const ck = copyOf(good);
    view(ck.players).setUint32(rec(0, P.coyoteTicks), 0xffffffff, true);
    const t = twoActorSim();
    expect(t.restoreCheckpoint(ck)).toMatchObject({ ok: true, clampedValues: 1 });
    expect(t.avatar(0).coyoteTicks).toBe(cfg.coyoteTicks);
  });

  test("suit-gear levels above the top level are clamped", () => {
    const src = makeSim(flatWorld(), { suitGear: { "gear.hop_pack": 200, "cellLevel.tool.desk_duster": 9 } });
    src.addActor(0, PLAYER);
    const t = makeSim(flatWorld());
    t.addActor(0, PLAYER);
    expect(t.restoreCheckpoint(src.captureCheckpoint())).toMatchObject({ ok: true, clampedValues: 2 });
    const gear = t.snapshot().shift.suitGear;
    expect(gear["cellLevel.tool.desk_duster"]).toBe(cfg.cellLevelMult.length);
    expect(gear["gear.hop_pack"]).toBe(cfg.hopBurstsByLevel.length - 1);
  });
});

describe("checkpoint: fuzz (property)", () => {
  test("random byte damage never throws; a rejection changes nothing; an accepted state keeps the sim invariants", () => {
    const source = busyRun(1500).sim;
    const good = source.captureCheckpoint();
    const next = mulberry32(0xc0ffee11);
    const rnd = (n: number): number => Math.floor((next() / 4294967296) * n);
    const world = testWorld();
    const t = twoActorSim();
    let accepted = 0;
    let rejected = 0;
    const lim = cfg.moonRadiusM * 2;
    for (let it = 0; it < 4000; it++) {
      const ck = copyOf(good);
      const hits = 1 + rnd(4);
      for (let h = 0; h < hits; h++) {
        const body = rnd(4) === 0 ? ck.meta : ck.players;
        body[rnd(body.length)] = rnd(256);
      }
      const hash = t.stateHash();
      const res = t.restoreCheckpoint(ck);
      if (!res.ok) {
        rejected++;
        expect(t.stateHash()).toBe(hash);
        continue;
      }
      accepted++;
      expect(t.wallet).toBeGreaterThanOrEqual(0);
      expect(Number.isSafeInteger(t.tick)).toBe(true);
      for (let k = 0; k < 3; k++) {
        for (let s = 0; s < 2; s++) t.applyInput(s, scripted(it + k));
        t.step(cfg.dt);
      }
      for (let s = 0; s < 2; s++) {
        const a = t.avatar(s);
        const ts = t.toolState(s);
        for (const v of [a.px, a.py, a.pz, a.vx, a.vy, a.vz, a.fx, a.fy, a.fz, ts.headX, ts.headY, ts.headZ]) {
          expect(Number.isFinite(v) && Math.abs(v) <= lim + 1000).toBe(true);
        }
        expect(ts.toolCode).toBeLessThan(TOOLS);
        expect(cfg.tools[ts.toolCode]!.cleans).toBe(true);
        expect((ts.owned >> ts.toolCode) & 1).toBe(1);
        for (let c = 0; c < TOOLS; c++) {
          expect(ts.cellGrams[c]).toBeGreaterThanOrEqual(0);
          expect(ts.cellGrams[c]).toBeLessThanOrEqual(cellCapGrams(cfg, cfg.tools[c]!, ts.cellLevel[c]!));
        }
        const l = Math.hypot(a.px, a.py, a.pz);
        expect(world.ground.heightAtXYZ(a.px / l, a.py / l, a.pz / l)).not.toBeNaN();
      }
      expect(t.snapshot().shift.walletLumens).toBe(t.wallet);
    }
    expect(accepted).toBeGreaterThan(100);
    expect(rejected).toBeGreaterThan(100);
  });
});
