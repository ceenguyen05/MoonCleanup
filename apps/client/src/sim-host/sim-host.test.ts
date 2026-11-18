import { describe, expect, test } from "vitest";
import {
  NO_NEIGHBOR,
  PLOT_NEIGHBOR_SLOTS,
  SAVE_HEADER_GOLDEN_VECTORS,
  INPUT_BUTTON_MASK,
  SAVE_SECTION_ID,
  STANDARD_GRID_PARAMS,
  type RoomHostState,
  type SimInputCommand,
} from "@moon-cleanup/shared";
import { FRAME_OK, FrameReader, FrameView, SlotTable, type MutableInput } from "@moon-cleanup/protocol";
import { SIM_CHECKPOINT_META_VERSION, SIM_CHECKPOINT_PLAYERS_VERSION, type MoonRoomSim } from "@moon-cleanup/sim";
import { WorldDustLedger, encodeDustChunks } from "@moon-cleanup/world";
import type { StoredDustChunk } from "./checkpoint-store";
import { FixedStepClock } from "./fixed-step";
import { InputQueue } from "./input-queue";
import { decodeSaveEnvelope, encodeSaveEnvelope, gunzip, gzip } from "./save-envelope";
import { LocalRoomHostImpl, type LocalRoomHostOptions } from "./local-room-host";
import {
  TEST_CONTRACT,
  TEST_PLAYER,
  FLAT_WORLD,
  channelWorker,
  directSim,
  encodeLegacyV0Save,
  scriptedInputs,
  soloLedger,
  testGrid,
} from "./test-support";
import { decodeSimCheckpoint, encodeSimCheckpoint } from "./sim-checkpoint";

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string): Uint8Array => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

/** The real ledger behind a reference sim (directSim builds it the way the worker does). */
function ledgerOf(sim: MoonRoomSim): WorldDustLedger {
  if (!(sim.ledger instanceof WorldDustLedger)) throw new Error("directSim must run the real dust ledger");
  return sim.ledger;
}

function newInput(): MutableInput {
  return { seq: 0, moveX: 0, moveY: 0, yaw: 0, pitch: 0, buttons: 0, toolParam: 0 };
}

describe("FixedStepClock", () => {
  test("absolute schedule: jittery wakes never drift", () => {
    const c = new FixedStepClock({ tickHz: 20 });
    c.start(1000);
    let ticks = 0;
    let now = 1000;
    for (let i = 0; i < 2000; i++) {
      now += c.delayMs(now) + ((i * 7919) % 13); // late by 0..12 ms
      ticks += c.due(now);
    }
    expect(ticks).toBe(Math.floor((now - 1000) / 50));
    expect(c.ticksDropped).toBe(0);
  });

  test("a long stall runs at most maxCatchUpTicks and drops the rest once", () => {
    const c = new FixedStepClock({ tickHz: 20, maxCatchUpTicks: 4 });
    c.start(0);
    expect(c.due(1000)).toBe(4);
    expect(c.ticksDropped).toBe(16);
    expect(c.due(1000)).toBe(0);
    expect(c.due(1050)).toBe(1);
  });
});

describe("InputQueue", () => {
  const push = (q: InputQueue, seq: number, buttons: number, moveY = 50): void =>
    q.push({ seq, moveX: 0, moveY, yaw: 0, pitch: 0, buttons, toolParam: 0 });

  test("repeats the last input maxSubstitutions times, then goes neutral", () => {
    const q = new InputQueue();
    const out = newInput();
    push(q, 1, 8);
    expect(q.nextForTick(out)).toBe(true);
    for (let i = 0; i < 3; i++) {
      q.nextForTick(out);
      expect(out.buttons).toBe(8);
    }
    q.nextForTick(out);
    expect(out.buttons).toBe(0);
    expect(out.moveY).toBe(0);
    expect(q.counters).toMatchObject({ consumed: 1, substituted: 3, starved: 1 });
  });

  test("backlog double-steps and keeps the skipped taps", () => {
    const q = new InputQueue();
    const out = newInput();
    push(q, 1, 1); // a jump tap in the skipped input
    for (let s = 2; s <= 6; s++) push(q, s, 0);
    q.nextForTick(out);
    expect(out.seq).toBe(2);
    expect(out.buttons & 1).toBe(1);
    expect(q.lastConsumedSeq).toBe(2);
    expect(q.counters.doubleStepped).toBe(1);
  });

  test("drops late seqs", () => {
    const q = new InputQueue();
    const out = newInput();
    push(q, 10, 0);
    q.nextForTick(out);
    push(q, 9, 0);
    expect(q.length).toBe(0);
    expect(q.counters.droppedLate).toBe(1);
  });
});

describe("save envelope v1", () => {
  test.each(SAVE_HEADER_GOLDEN_VECTORS.map((v) => [v.name, v] as const))("%s", (_name, v) => {
    const enc = encodeSaveEnvelope(v.header, v.bodiesHex.map(unhex));
    expect(hex(enc)).toBe(v.bytesHex);
    const dec = decodeSaveEnvelope(unhex(v.bytesHex));
    expect(dec.header).toEqual(v.header);
    expect(dec.bodies.map(hex)).toEqual(v.bodiesHex);
  });

  test("rejects a flipped byte (CRC)", () => {
    const v = SAVE_HEADER_GOLDEN_VECTORS[0]!;
    const b = unhex(v.bytesHex);
    b[20] = (b[20] ?? 0) ^ 1;
    expect(() => decodeSaveEnvelope(b)).toThrow(/crc/);
  });
});

// ---- host <-> worker core over a real MessageChannel ----------------------------------------------------------------

function waitState(host: LocalRoomHostImpl, want: RoomHostState): Promise<void> {
  if (host.state === want) return Promise.resolve();
  return new Promise((resolve) => {
    const off = host.onStateChange((s) => {
      if (s === want) {
        off();
        resolve();
      }
    });
  });
}

function manualHost(extra: Partial<LocalRoomHostOptions> = {}): LocalRoomHostImpl {
  return new LocalRoomHostImpl({
    contractId: TEST_CONTRACT,
    player: TEST_PLAYER,
    world: FLAT_WORLD,
    spawnWorker: channelWorker,
    clock: "manual",
    store: "memory",
    checkpointIntervalS: 0,
    statsIntervalMs: 0,
    ...extra,
  });
}

describe("PUCKS save section (id 8)", { timeout: 60_000 }, () => {
  const info = {
    grid: STANDARD_GRID_PARAMS,
    bakeHash: "0".repeat(64),
    originId: "0".repeat(32),
    generation: 1,
    parentGeneration: 0,
  };
  /** A reference sim with a full Cell that forms pucks and carries one (the sim's own PUCKS test script). */
  function withPucks(): MoonRoomSim {
    const sim = directSim();
    (sim.toolState(0).cellGrams as Int32Array)[sim.toolState(0).toolCode] = 3900;
    const M = INPUT_BUTTON_MASK;
    for (let k = 0; k < 67; k++) {
      const phase = k % 40;
      let buttons = 0;
      if (phase === 1 || (phase >= 5 && phase < 13)) buttons |= M.puckForm;
      if (phase === 16 || (phase >= 20 && phase < 36)) buttons |= M.pickupDrop;
      const cmd: SimInputCommand = {
        seq: k + 1,
        moveX: 0,
        moveY: phase < 20 ? 60 : 0,
        yaw: (k * 977) & 0xffff,
        pitch: 0,
        buttons,
        toolParam: 0,
      };
      sim.applyInput(0, cmd);
      sim.step(sim.config.dt);
    }
    return sim;
  }

  test("a save carries the sim's PUCKS body and restores the same pucks and hash", () => {
    const ref = withPucks();
    expect(ref.cargo.totalGrams()).toBeGreaterThan(0);
    const dec = decodeSimCheckpoint(encodeSimCheckpoint(ref, info));
    const want = ref.captureCheckpoint();
    const pucksSection = dec.header.sections.find((x) => x.id === SAVE_SECTION_ID.PUCKS);
    expect(pucksSection?.version).toBe(want.pucksVersion);
    expect(Array.from(dec.sim!.pucks!)).toEqual(Array.from(want.pucks!));
    const fresh = directSim();
    expect(fresh.restoreCheckpoint(dec.sim!).ok).toBe(true);
    expect(fresh.cargo.totalGrams()).toBe(ref.cargo.totalGrams());
    expect(fresh.stateHash()).toBe(ref.stateHash());
  });

  test("a save without PUCKS, or with the empty interim v2 body, restores with no pucks", () => {
    const ref = withPucks();
    const ck = ref.captureCheckpoint();
    const base = decodeSimCheckpoint(encodeSimCheckpoint(ref, info)).header;
    for (const extra of [[], [{ id: SAVE_SECTION_ID.PUCKS, version: 2, length: 0 }]]) {
      const header = { ...base, sections: [base.sections[0]!, base.sections[1]!, ...extra] };
      const bodies = extra.length > 0 ? [ck.meta, ck.players, new Uint8Array(0)] : [ck.meta, ck.players];
      const dec = decodeSimCheckpoint(encodeSaveEnvelope(header, bodies));
      expect(dec.sim!.pucks).toBeUndefined();
      const fresh = directSim();
      expect(fresh.restoreCheckpoint(dec.sim!).ok).toBe(true);
      expect(fresh.cargo.totalGrams()).toBe(0);
    }
  });
});

describe("LocalRoomHost + worker core (MessageChannel)", { timeout: 60_000 }, () => {
  test("worker-hosted sim matches a direct MoonRoomSim tick for tick; frames decode and ack", async () => {
    const N = 600;
    const inputs = scriptedInputs(N);
    const host = manualHost();
    await waitState(host, "running");
    const reader = new FrameReader();
    const view = new FrameView();
    const table = new SlotTable();
    let frames = 0;
    let lastAck = 0;
    let strokes = 0;
    let echoes = 0;
    host.onInputEcho(() => echoes++);
    host.onFrame((f) => {
      const rc = reader.decode(new Uint8Array(f.bytes, 0, f.byteLength), view, table, STANDARD_GRID_PARAMS.plotCount);
      expect(rc).toBe(FRAME_OK);
      expect(view.serverTick).toBe(f.tick);
      strokes += view.strokes.chainCount;
      lastAck = f.ackInputSeq;
      frames++;
      f.release();
    });
    const ref = directSim();
    let refStrokes = 0;
    for (const cmd of inputs) {
      host.sendInput(cmd);
      host.stepManual(1);
      // Pace like a real loop: the frame comes back (and is released) before the next tick.
      if (cmd.seq % 2 === 0) await host.requestHash();
      ref.applyInput(0, cmd);
      ref.step(ref.config.dt);
      refStrokes += ref.strokeCount;
    }
    const got = await host.requestHash();
    expect(got.tick).toBe(ref.tick);
    expect(got.hash).toBe(ref.stateHash());
    // The worker runs the real dust ledger: same texels as the reference, and the run did remove dust.
    expect(got.dustHash).toBe(ledgerOf(ref).worldHash());
    expect(ledgerOf(ref).ledgerCount).toBeGreaterThan(0);
    expect(host.stats().worker).toMatchObject({ ledgers: ledgerOf(ref).ledgerCount, ledgerPoolGrowths: 0 });
    expect(echoes).toBe(N);
    expect(frames).toBeGreaterThan(N - 10);
    expect(lastAck).toBe(N);
    expect(strokes).toBe(refStrokes);
    expect(view.self.px).toBeCloseTo(ref.avatar(0).px, 1);
    const st = host.stats();
    expect(st.inputPoolMisses).toBeLessThan(8);
    expect(st.worker?.framesSkippedNoBuffer ?? -1).toBeGreaterThanOrEqual(0);
    expect(st.worker?.strokesDropped).toBe(0);
    await host.close("clock_out");
    expect(host.state).toBe("closed");
  });

  test("checkpoint -> crash -> reboot restores tick, wallet, generation and position", async () => {
    const saved: string[] = [];
    const host = manualHost({ onSaveEvent: (name) => saved.push(name) });
    await waitState(host, "running");
    for (const cmd of scriptedInputs(200)) {
      host.sendInput(cmd);
      host.stepManual(1);
    }
    const meta = await host.checkpoint("timer");
    expect(meta).toMatchObject({ contractId: TEST_CONTRACT, generation: 1, parentGeneration: 0, simTick: 200 });
    expect(host.generation).toBe(1);
    expect(saved).toContain("save.checkpointed");
    const before = await host.requestHash();
    expect(before.tick).toBe(200);
    const states: RoomHostState[] = [];
    host.onStateChange((s) => states.push(s));
    host.crashWorkerForTest();
    await waitState(host, "booting");
    await waitState(host, "running");
    expect(host.stats().reboots).toBe(1);
    expect(host.generation).toBe(1);
    const after = await host.requestHash();
    expect(after.tick).toBe(200);
    expect(saved).toContain("save.restored");
    const meta2 = await host.checkpoint("pause");
    expect(meta2).toMatchObject({ generation: 2, parentGeneration: 1 });
    await host.close("clock_out");
  });

  test("checkpoint bytes are a gzip'd v1 envelope with the avatar pose", async () => {
    const host = manualHost();
    await waitState(host, "running");
    for (const cmd of scriptedInputs(100)) {
      host.sendInput(cmd);
      host.stepManual(1);
    }
    let bytes: ArrayBuffer | null = null;
    // memory store: the worker hands the stored bytes to the host with the reply
    const ref = directSim();
    for (const cmd of scriptedInputs(100)) {
      ref.applyInput(0, cmd);
      ref.step(ref.config.dt);
    }
    await host.checkpoint("timer");
    bytes = (host as unknown as { memoryCheckpoint: ArrayBuffer | null }).memoryCheckpoint;
    expect(bytes).not.toBeNull();
    const ck = decodeSimCheckpoint(await gunzip(new Uint8Array(bytes!)));
    expect(ck.header).toMatchObject({ simTick: 100, generation: 1, originKind: "solo", gridM: 128 });
    // Sections written by packages/sim (META v1 + PLAYERS v1), byte for byte what the reference sim captures.
    expect(ck.legacy).toBeNull();
    const want = ref.captureCheckpoint();
    expect(ck.sim?.metaVersion).toBe(SIM_CHECKPOINT_META_VERSION);
    expect(ck.sim?.playersVersion).toBe(SIM_CHECKPOINT_PLAYERS_VERSION);
    expect(Array.from(ck.sim!.meta)).toEqual(Array.from(want.meta));
    expect(Array.from(ck.sim!.players)).toEqual(Array.from(want.players));
    await host.close("clock_out");
  });

  /** Boots a host that restores `bytes` (gzip'd unless `raw`) the way a reload does: from the stored/memory checkpoint. */
  async function bootFromSave(
    bytes: Uint8Array | null,
    opts: { raw?: boolean } = {},
  ): Promise<{ host: LocalRoomHostImpl; problems: string[]; saved: string[] }> {
    const problems: string[] = [];
    const saved: string[] = [];
    const host = manualHost({ onRestoreProblem: (r) => problems.push(r), onSaveEvent: (n) => saved.push(n) });
    await waitState(host, "running");
    if (bytes) {
      const packed = opts.raw ? bytes : await gzip(bytes);
      (host as unknown as { memoryCheckpoint: ArrayBuffer }).memoryCheckpoint = packed.buffer.slice(
        packed.byteOffset,
        packed.byteOffset + packed.byteLength,
      ) as ArrayBuffer;
      host.crashWorkerForTest();
      await waitState(host, "booting");
      await waitState(host, "running");
    }
    return { host, problems, saved };
  }

  async function savedBytes(host: LocalRoomHostImpl): Promise<Uint8Array> {
    await host.checkpoint("timer");
    return gunzip(new Uint8Array((host as unknown as { memoryCheckpoint: ArrayBuffer }).memoryCheckpoint));
  }

  test("save -> reload restores tick, wallet, pose, tools, holster and Dust Cells exactly (v1)", async () => {
    const first = manualHost();
    await waitState(first, "running");
    const ref = directSim();
    const inputs = scriptedInputs(300);
    const select = { kind: "select_tool", slot: 2 } as const;
    for (let i = 0; i < inputs.length; i++) {
      const cmd = inputs[i]!;
      first.sendInput(cmd);
      ref.applyInput(0, cmd);
      if (i === 120) {
        first.sendIntent(select);
        ref.applyIntent(0, select);
      }
      first.stepManual(1);
      ref.step(ref.config.dt);
      if (cmd.seq % 2 === 0) await first.requestHash();
    }
    const wasHash = await first.requestHash();
    const bytes = await savedBytes(first);
    // What a reload reads back: the header envelope and the dust chunk rows of that checkpoint.
    const copies = {
      memoryCheckpoint: copiesOf(first).memoryCheckpoint!.slice(0),
      memoryDust: new Map(copiesOf(first).memoryDust),
    };
    await first.close("clock_out");

    // The state really has something to restore.
    expect(ref.tick).toBe(300);
    expect(ref.toolState(0).cellGrams.some((g) => g > 0)).toBe(true);

    const { host, problems, saved } = await reloadFrom(copies);
    expect(problems).toEqual([]);
    expect(saved).toContain("save.restored");
    const now = await host.requestHash();
    expect(now).toEqual(wasHash);
    expect(now.tick).toBe(300);
    // Capturing again gives the same section bytes: tick, wallet, pose, owned tools, holster and every Cell.
    const again = decodeSimCheckpoint(await savedBytes(host)).sim!;
    const before = decodeSimCheckpoint(bytes).sim!;
    const want = ref.captureCheckpoint();
    expect(Array.from(again.meta)).toEqual(Array.from(before.meta));
    expect(Array.from(again.players)).toEqual(Array.from(before.players));
    expect(Array.from(again.players)).toEqual(Array.from(want.players));
    expect(Array.from(again.meta)).toEqual(Array.from(want.meta));
    await host.close("clock_out");
  });

  test("a version 0 save (interim layout) still loads tick, wallet and pose", async () => {
    const ref = directSim();
    for (const cmd of scriptedInputs(200)) {
      ref.applyInput(0, cmd);
      ref.step(ref.config.dt);
    }
    const legacy = decodeSimCheckpoint(encodeLegacyV0Save(ref));
    expect(legacy.sim).toBeNull();
    expect(legacy.legacy?.walletLm).toBe(ref.wallet);

    const { host, problems, saved } = await bootFromSave(encodeLegacyV0Save(ref));
    expect(problems).toEqual([]);
    expect(saved).toContain("save.restored");
    expect((await host.requestHash()).tick).toBe(200);
    expect(host.generation).toBe(3);
    // Re-saving writes the current format (v1) and continues the generation lineage.
    const rewritten = decodeSimCheckpoint(await savedBytes(host));
    expect(rewritten.header.generation).toBe(4);
    expect(rewritten.sim?.metaVersion).toBe(SIM_CHECKPOINT_META_VERSION);
    const me = ref.avatar(0);
    // Pose lands within 0.5 m (spawn offset compensation): compare through a fresh sim restored from the new save.
    const check = directSim();
    expect(check.restoreCheckpoint(rewritten.sim!).ok).toBe(true);
    const a = check.avatar(0);
    expect(Math.hypot(a.px - me.px, a.py - me.py, a.pz - me.pz)).toBeLessThan(0.5);
    await host.close("clock_out");
  });

  describe("an unreadable save starts a fresh game and reports it", () => {
    async function expectFresh(
      host: LocalRoomHostImpl,
      problems: string[],
      saved: string[],
      re: RegExp,
    ): Promise<void> {
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(re);
      expect(saved).not.toContain("save.restored");
      const h = await host.requestHash();
      expect(h.tick).toBe(0);
      expect(h.hash).toBe(directSim().stateHash());
      // The game runs: ticking works and the next checkpoint replaces the bad save.
      host.stepManual(5);
      expect((await host.requestHash()).tick).toBe(5);
      expect((await host.checkpoint("pause")).simTick).toBe(5);
      await host.close("clock_out");
    }

    async function goodSave(): Promise<Uint8Array> {
      const ref = directSim();
      for (const cmd of scriptedInputs(60)) {
        ref.applyInput(0, cmd);
        ref.step(ref.config.dt);
      }
      return encodeSimCheckpoint(ref, {
        grid: STANDARD_GRID_PARAMS,
        bakeHash: "0".repeat(64),
        originId: "0".repeat(32),
        generation: 1,
        parentGeneration: 0,
      });
    }

    test("random bytes that are not a save", async () => {
      const junk = new Uint8Array(300).map((_, i) => (i * 37 + 11) & 0xff);
      const { host, problems, saved } = await bootFromSave(junk, { raw: true });
      await expectFresh(host, problems, saved, /unreadable/);
    });

    test("a truncated gzip stream", async () => {
      const good = await gzip(await goodSave());
      const cut = good.subarray(0, Math.floor(good.length / 2));
      const { host, problems, saved } = await bootFromSave(cut, { raw: true });
      await expectFresh(host, problems, saved, /unreadable/);
    });

    test("a flipped byte (envelope CRC)", async () => {
      const bytes = await goodSave();
      bytes[60] = (bytes[60] ?? 0) ^ 0xff;
      const { host, problems, saved } = await bootFromSave(bytes);
      await expectFresh(host, problems, saved, /unreadable.*crc/);
    });

    test("a valid envelope whose PLAYERS body the sim rejects (truncated)", async () => {
      const ref = directSim();
      const ck = ref.captureCheckpoint();
      const header = decodeSimCheckpoint(await goodSave()).header;
      const players = ck.players.slice(0, ck.players.length - 7);
      const bytes = encodeSaveEnvelope(
        {
          ...header,
          sections: [
            { id: SAVE_SECTION_ID.META, version: ck.metaVersion, length: ck.meta.length },
            { id: SAVE_SECTION_ID.PLAYERS, version: ck.playersVersion, length: players.length },
          ],
        },
        [ck.meta, players],
      );
      const { host, problems, saved } = await bootFromSave(bytes);
      await expectFresh(host, problems, saved, /rejected: malformed/);
    });

    test("an unsupported section version (a future build's save)", async () => {
      const ref = directSim();
      const ck = ref.captureCheckpoint();
      const header = decodeSimCheckpoint(await goodSave()).header;
      const bytes = encodeSaveEnvelope(
        {
          ...header,
          sections: [
            { id: SAVE_SECTION_ID.META, version: 9, length: ck.meta.length },
            { id: SAVE_SECTION_ID.PLAYERS, version: 9, length: ck.players.length },
          ],
        },
        [ck.meta, ck.players],
      );
      const { host, problems, saved } = await bootFromSave(bytes);
      await expectFresh(host, problems, saved, /unsupported_version/);
    });

    test("a save without the sim sections", async () => {
      const header = decodeSimCheckpoint(await goodSave()).header;
      const bytes = encodeSaveEnvelope({ ...header, sections: [] }, []);
      const { host, problems, saved } = await bootFromSave(bytes);
      await expectFresh(host, problems, saved, /no META or PLAYERS/);
    });
  });
});

// ---- pause / resume / suspend (review B1) ---------------------------------------------------------------------------

describe("LocalRoomHost pause, resume and suspend (realtime loop)", { timeout: 60_000 }, () => {
  const realtimeHost = (): LocalRoomHostImpl => manualHost({ clock: "realtime" });
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  /** Sim ticks the worker ran during `ms` of wall time. */
  async function ticksDuring(host: LocalRoomHostImpl, ms = 350): Promise<number> {
    const a = await host.requestHash();
    await sleep(ms);
    const b = await host.requestHash();
    return b.tick - a.tick;
  }

  test("pause freezes the sim after its checkpoint; resume restarts it", async () => {
    const host = realtimeHost();
    await waitState(host, "running");
    expect(await ticksDuring(host)).toBeGreaterThan(2);
    host.pause();
    await waitState(host, "paused");
    expect(await ticksDuring(host)).toBe(0);
    host.resume();
    await waitState(host, "running");
    expect(await ticksDuring(host)).toBeGreaterThan(2);
    await host.close("clock_out");
  });

  test("resume() right after pause() (before the checkpoint resolves) is honored: the game keeps running", async () => {
    const host = realtimeHost();
    await waitState(host, "running");
    const states: RoomHostState[] = [];
    host.onStateChange((s) => states.push(s));
    host.pause();
    host.resume();
    // The checkpoint chain is serial: this resolves after the pause checkpoint.
    await host.checkpoint("timer");
    expect(await ticksDuring(host)).toBeGreaterThan(2);
    expect(host.state).toBe("running");
    expect(states).not.toContain("paused");
    // The pause is a single event: a later pause + resume still works.
    host.pause();
    await waitState(host, "paused");
    host.resume();
    await waitState(host, "running");
    expect(await ticksDuring(host)).toBeGreaterThan(2);
    await host.close("clock_out");
  });

  test("a resume() with nothing to undo changes nothing", async () => {
    const host = realtimeHost();
    await waitState(host, "running");
    host.resume();
    expect(await ticksDuring(host)).toBeGreaterThan(2);
    host.pause();
    await waitState(host, "paused");
    // Not remembered for a later pause: that pause stays paused.
    host.resume();
    await waitState(host, "running");
    host.pause();
    await waitState(host, "paused");
    expect(await ticksDuring(host)).toBe(0);
    await host.close("clock_out");
  });

  test("suspend checkpoints (handoff), freezes the sim, and resume restarts it", async () => {
    const host = realtimeHost();
    await waitState(host, "running");
    const meta = await host.suspend();
    expect(meta).toMatchObject({ contractId: TEST_CONTRACT, generation: 1 });
    await waitState(host, "suspended");
    expect(await ticksDuring(host)).toBe(0);
    host.resume();
    await waitState(host, "running");
    expect(await ticksDuring(host)).toBeGreaterThan(2);
    await host.close("clock_out");
  });

  test("resume() while the suspend checkpoint is in flight is honored", async () => {
    const host = realtimeHost();
    await waitState(host, "running");
    const done = host.suspend();
    host.resume();
    await done;
    expect(await ticksDuring(host)).toBeGreaterThan(2);
    expect(host.state).toBe("running");
    await host.close("clock_out");
  });
});

// ---- dust ledger: checkpoint, reload, continue ----------------------------------------------------------------------

interface HostCopies {
  memoryCheckpoint: ArrayBuffer | null;
  readonly memoryDust: Map<number, StoredDustChunk>;
}
/** The copies a host keeps without IndexedDB (header envelope + dust chunk rows): what a reload restores from. */
const copiesOf = (host: LocalRoomHostImpl): HostCopies => host as unknown as HostCopies;

/** Sends inputs [from, to) one per tick to the host (and the reference sim, when given), paced like a real loop. */
async function play(
  host: LocalRoomHostImpl,
  ref: MoonRoomSim | null,
  inputs: readonly SimInputCommand[],
  from: number,
  to: number,
): Promise<void> {
  for (let i = from; i < to; i++) {
    const cmd = inputs[i]!;
    host.sendInput(cmd);
    host.stepManual(1);
    if (cmd.seq % 2 === 0) await host.requestHash();
    if (ref) {
      ref.applyInput(0, cmd);
      ref.step(ref.config.dt);
    }
  }
}

async function expectParity(host: LocalRoomHostImpl, ref: MoonRoomSim): Promise<void> {
  const got = await host.requestHash();
  expect(got).toEqual({ tick: ref.tick, hash: ref.stateHash(), dustHash: ledgerOf(ref).worldHash() });
}

/** A second host that boots from copies of a stored checkpoint, the way a page reload boots from IndexedDB. */
async function reloadFrom(
  from: HostCopies,
  extra: Partial<LocalRoomHostOptions> = {},
  tamper?: (rows: StoredDustChunk[]) => StoredDustChunk[],
): Promise<{ host: LocalRoomHostImpl; problems: string[]; saved: string[] }> {
  const problems: string[] = [];
  const saved: string[] = [];
  const host = manualHost({
    onRestoreProblem: (r) => problems.push(r),
    onSaveEvent: (n) => saved.push(n),
    ...extra,
  });
  await waitState(host, "running");
  const to = copiesOf(host);
  to.memoryCheckpoint = from.memoryCheckpoint!.slice(0);
  let rows = [...from.memoryDust.values()].map((c) => ({ ...c, bytes: c.bytes.slice(0) }));
  if (tamper) rows = tamper(rows);
  to.memoryDust.clear();
  for (const c of rows) to.memoryDust.set(c.chunkId, c);
  host.crashWorkerForTest();
  await waitState(host, "booting");
  await waitState(host, "running");
  return { host, problems, saved };
}

describe("dust ledger across checkpoints and reloads (MessageChannel)", { timeout: 120_000 }, () => {
  test("checkpoint -> crash -> reboot: state and dust hash are identical, play continues like a sim that never stopped", async () => {
    const inputs = scriptedInputs(900);
    const host = manualHost();
    await waitState(host, "running");
    const ref = directSim();
    await play(host, ref, inputs, 0, 400);
    await expectParity(host, ref);
    const before = await host.requestHash();
    expect(before.dustHash).not.toBe(0);
    await host.checkpoint("timer");
    await host.requestHash();
    expect(copiesOf(host).memoryDust.size).toBeGreaterThan(0);
    const st0 = host.stats().worker!;
    // The worker's sim drains the ledger's Opened / Polished queues like the reference sim does.
    expect(ref.counters.plotsOpened).toBeGreaterThan(0);
    expect(st0).toMatchObject({
      plotsOpened: ref.counters.plotsOpened,
      plotsPolished: ref.counters.plotsPolished,
    });

    // 60 more ticks that are never saved: the crash loses them, and their dust must come back with them.
    await play(host, null, inputs, 400, 460);
    expect((await host.requestHash()).dustHash).not.toBe(before.dustHash);
    host.crashWorkerForTest();
    await waitState(host, "booting");
    await waitState(host, "running");

    const after = await host.requestHash();
    expect(after).toEqual(before);
    const st = host.stats().worker!;
    expect(st).toMatchObject({
      dustRestoreChunks: copiesOf(host).memoryDust.size,
      dustRestoreRejected: 0,
      dustRestoreRepairs: 0,
      dustRestoreLedgers: ledgerOf(ref).ledgerCount,
      ledgers: ledgerOf(ref).ledgerCount,
    });
    expect(st.dustRestoreSlices).toBeGreaterThan(0);
    console.log(
      `[dust-reload] ckpt capture max ${st0.checkpointCaptureMaxMs.toFixed(3)} ms, ${st0.dustChunksWritten} chunks, ` +
        `${st0.dustRawBytesWritten} B raw; restore ${st.dustRestoreLedgers} ledgers in ${st.dustRestoreMs.toFixed(2)} ms, ` +
        `${st.dustRestoreSlices} slices, max slice ${st.dustRestoreSliceMaxMs.toFixed(3)} ms`,
    );

    // The reloaded worker and the reference that never reloaded stay identical, checked every 100 ticks.
    for (let from = 400; from < 900; from += 100) {
      await play(host, ref, inputs, from, from + 100);
      await expectParity(host, ref);
    }
    await host.close("clock_out");
  });

  test("later checkpoints write only changed chunks; a new host restores the merged rows exactly", async () => {
    const inputs = scriptedInputs(900, 0xd057);
    const first = manualHost();
    await waitState(first, "running");
    const ref = directSim();
    await play(first, ref, inputs, 0, 300);
    await first.checkpoint("timer");
    await first.requestHash();
    const written1 = first.stats().worker!.dustChunksWritten;
    expect(written1).toBeGreaterThan(0);

    // Nothing changed: the next checkpoint writes the header and no chunk row.
    await first.checkpoint("pause");
    await first.requestHash();
    expect(first.stats().worker!.dustChunksWritten).toBe(written1);

    await play(first, ref, inputs, 300, 600);
    await first.checkpoint("timer");
    const wasHash = await first.requestHash();
    const written3 = first.stats().worker!.dustChunksWritten;
    expect(written3).toBeGreaterThan(written1);
    expect(written3 - written1).toBeLessThanOrEqual(copiesOf(first).memoryDust.size);
    const copies: HostCopies = {
      memoryCheckpoint: copiesOf(first).memoryCheckpoint!.slice(0),
      memoryDust: new Map(copiesOf(first).memoryDust),
    };
    await first.close("clock_out");

    const { host, problems, saved } = await reloadFrom(copies);
    expect(problems).toEqual([]);
    expect(saved).toContain("save.restored");
    expect(await host.requestHash()).toEqual(wasHash);
    await expectParity(host, ref);
    await play(host, ref, inputs, 600, 900);
    await expectParity(host, ref);
    // The reloaded game checkpoints on: the generation lineage continues.
    expect((await host.checkpoint("timer")).generation).toBe(4);
    await host.close("clock_out");
  });

  async function savedGame(ticks = 300): Promise<{ copies: HostCopies; ref: MoonRoomSim; hash: number }> {
    const host = manualHost();
    await waitState(host, "running");
    const ref = directSim();
    await play(host, ref, scriptedInputs(ticks), 0, ticks);
    await host.checkpoint("timer");
    const hash = (await host.requestHash()).hash;
    const copies: HostCopies = {
      memoryCheckpoint: copiesOf(host).memoryCheckpoint!.slice(0),
      memoryDust: new Map(copiesOf(host).memoryDust),
    };
    await host.close("clock_out");
    return { copies, ref, hash };
  }

  test("an unreadable dust chunk: the save still loads, the problem is reported, the next checkpoint repairs the rows", async () => {
    const { copies, hash } = await savedGame();
    const total = copies.memoryDust.size;
    const { host, problems, saved } = await reloadFrom(copies, {}, (rows) => {
      const junk = new Uint8Array(64).map((_, i) => (i * 29 + 7) & 0xff);
      rows[0] = { ...rows[0]!, bytes: junk.buffer };
      return rows;
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^dust chunks: 1 of \d+ unreadable/);
    expect(saved).toContain("save.restored");
    const got = await host.requestHash();
    expect(got).toMatchObject({ tick: 300, hash });
    expect(host.stats().worker).toMatchObject({ dustRestoreRejected: 1, dustRestoreChunks: total - 1 });
    // The first checkpoint after a damaged restore rewrites the whole dust state: the bad row is gone.
    await host.checkpoint("timer");
    await host.requestHash();
    expect(copiesOf(host).memoryDust.size).toBe(total - 1);
    expect(host.stats().worker!.dustChunksWritten).toBe(total - 1);
    const again = await reloadFrom(copiesOf(host));
    expect(again.problems).toEqual([]);
    expect(await again.host.requestHash()).toEqual(got);
    await again.host.close("clock_out");
    await host.close("clock_out");
  });

  test("dust chunks of another terrain bake are refused (bakeCheck)", async () => {
    const { copies, hash } = await savedGame(200);
    const { host, problems } = await reloadFrom(copies, { bakeHash: "ab" + "0".repeat(62) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/dust chunks: .*bake_mismatch/);
    expect(await host.requestHash()).toEqual({ tick: 200, hash, dustHash: 0 });
    await host.close("clock_out");
  });

  test("a save the sim rejects starts a fresh game on a fresh moon (its dust is not kept)", async () => {
    const { copies } = await savedGame(200);
    const good = decodeSimCheckpoint(await gunzip(new Uint8Array(copies.memoryCheckpoint!)));
    const players = good.sim!.players.slice(0, good.sim!.players.length - 7);
    const bad = encodeSaveEnvelope(
      {
        ...good.header,
        sections: [
          { id: SAVE_SECTION_ID.META, version: good.sim!.metaVersion, length: good.sim!.meta.length },
          { id: SAVE_SECTION_ID.PLAYERS, version: good.sim!.playersVersion, length: players.length },
        ],
      },
      [good.sim!.meta, players],
    );
    const packed = await gzip(bad);
    copies.memoryCheckpoint = packed.buffer.slice(
      packed.byteOffset,
      packed.byteOffset + packed.byteLength,
    ) as ArrayBuffer;
    const { host, problems, saved } = await reloadFrom(copies);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/rejected: malformed/);
    expect(saved).not.toContain("save.restored");
    expect(await host.requestHash()).toEqual({ tick: 0, hash: directSim().stateHash(), dustHash: 0 });
    // Its first checkpoint replaces every stored row: nothing of the rejected save can come back later.
    await host.checkpoint("pause");
    expect(copiesOf(host).memoryDust.size).toBe(0);
    await host.close("clock_out");
  });

  test("a large dust state (3,000 ledgers) restores in slices and the game plays on it in parity", async () => {
    // A moon where the 3,000 plots around the spawn point are partly cleaned: one disc stroke in the middle of each.
    const PLOTS = 3000;
    const grid = testGrid();
    const ledger = soloLedger();
    const spawn = directSim().avatar(0);
    const site = grid.plotAt({ x: spawn.px, y: spawn.py, z: spawn.pz });
    const seen = new Set<number>([site]);
    const order: number[] = [site];
    for (let k = 0; k < order.length && order.length < PLOTS; k++) {
      for (let n = 0; n < PLOT_NEIGHBOR_SLOTS && order.length < PLOTS; n++) {
        const q = grid.neighborTable[order[k]! * PLOT_NEIGHBOR_SLOTS + n]!;
        if (q === NO_NEIGHBOR || seen.has(q)) continue;
        seen.add(q);
        order.push(q);
      }
    }
    const sink = { milligrams: 0, removedUnits: 0, grime01: 0, plotCount: 0, plotIds: new Int32Array(8) };
    order.forEach((plot, i) => {
      ledger.applyStroke(
        {
          anchor: plot as never,
          startUMm: 0,
          startVMm: 0,
          endUMm: 0,
          endVMm: 0,
          widthCm: 50,
          depth16: 24 + (i % 5) * 8,
          toolCode: 0,
          tick: 0 as never,
          actorSlot: 0,
          inputSeq: 0,
        },
        sink,
      );
    });
    // Apron plots only hold partial cover (initial-cover mask), so a centre stroke on an uncovered texel
    // removes nothing and allocates no ledger: a handful of the 3,000 stay clean.
    const ledgers = ledger.ledgerCount;
    expect(ledgers).toBeLessThanOrEqual(PLOTS);
    expect(ledgers).toBeGreaterThan(PLOTS - 50);
    const encoded = encodeDustChunks(ledger, 0, false);
    const rows = new Map<number, StoredDustChunk>();
    for (const c of encoded) {
      rows.set(c.chunkId, {
        chunkId: c.chunkId,
        generation: 1,
        codec: "raw",
        rawSize: c.payload.length,
        bytes: c.payload.buffer.slice(0) as ArrayBuffer,
      });
      ledger.clearChunkDirty(c.chunkId);
    }
    ledger.clearPolishedQueue();
    ledger.clearOpenedQueue();
    ledger.clearDirtyPlots();

    // The header of a game at tick 0 (generation 1) next to those rows, then a reload.
    const seed = manualHost();
    await waitState(seed, "running");
    await seed.checkpoint("pause");
    const header = copiesOf(seed).memoryCheckpoint!.slice(0);
    await seed.close("error");
    const { host, problems } = await reloadFrom({ memoryCheckpoint: header, memoryDust: rows });
    expect(problems).toEqual([]);
    const got = await host.requestHash();
    expect(got.dustHash).toBe(ledger.worldHash());
    const st = host.stats().worker!;
    expect(st).toMatchObject({
      dustRestoreChunks: rows.size,
      dustRestoreRejected: 0,
      dustRestoreRepairs: 0,
      dustRestoreLedgers: ledgers,
      ledgers,
    });
    // More than one slice: the restore yielded between slices instead of holding the worker for its whole length.
    expect(st.dustRestoreSlices).toBeGreaterThan(3);

    // Play on the restored moon: every stroke lands on restored ledgers, in parity with a sim on the source ledger.
    const ref = directSim(undefined, ledger);
    const inputs = scriptedInputs(500, 0x10ad);
    await play(host, ref, inputs, 0, 300);
    await expectParity(host, ref);
    // First checkpoint after a restore from the host copies: the whole dust state (every non-pristine chunk).
    await host.checkpoint("timer");
    await host.requestHash();
    const full = host.stats().worker!;
    expect(full.dustChunksWritten).toBe(rows.size);
    // Next one: only the chunks the player worked in.
    await play(host, ref, inputs, 300, 500);
    await host.checkpoint("timer");
    await expectParity(host, ref);
    const inc = host.stats().worker!;
    expect(inc.dustChunksWritten - full.dustChunksWritten).toBeGreaterThan(0);
    expect(inc.dustChunksWritten - full.dustChunksWritten).toBeLessThan(rows.size);
    expect(inc.ledgerPoolGrowths).toBe(0);
    console.log(
      `[dust-large] ${PLOTS} ledgers in ${rows.size} chunks: restore ${st.dustRestoreMs.toFixed(1)} ms total, ` +
        `${st.dustRestoreSlices} slices, max slice ${st.dustRestoreSliceMaxMs.toFixed(2)} ms; full checkpoint ` +
        `capture ${full.checkpointCaptureLastMs.toFixed(2)} ms (${full.dustRawBytesWritten} B raw); next checkpoint ` +
        `${inc.dustChunksWritten - full.dustChunksWritten} chunks, ${inc.dustRawBytesWritten - full.dustRawBytesWritten} B raw, ` +
        `capture ${inc.checkpointCaptureLastMs.toFixed(2)} ms; tick p95 ${inc.tickP95Ms.toFixed(3)} ms max ${inc.tickMaxMs.toFixed(3)} ms`,
    );
    // The merged rows (full save + changed chunks) reload to the same state.
    const again = await reloadFrom(copiesOf(host));
    expect(again.problems).toEqual([]);
    await expectParity(again.host, ref);
    await again.host.close("clock_out");
    await host.close("clock_out");
  });
});
