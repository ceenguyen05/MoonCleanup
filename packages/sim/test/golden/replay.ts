// Golden replay of the RoomSim: a scripted, seeded 10,000-tick input log for two actors (walk, Lope, jumps, jump cuts,
// Desk Duster sweeping and Detailing, a Crescent Squeegee purchase, holster swaps, Cell drains) through the real
// Standard grid and fixture ground. Output: the FNV-1a state hash after the run plus a hash over every accepted stroke.
// The Node lane records; the browser lane must match exactly (a mismatch is a determinism defect, never a re-record).
//
// `GoldenRun` is the script as a stepper, so tests can swap the sim mid-run (`attach`): the checkpoint tests save,
// restore into a fresh sim and expect the same recorded hashes.
import { INPUT_BUTTON_MASK as M, type RequestId, type Unsubscribe } from "@moon-cleanup/shared";
import { mulberry32, WorldDustLedger } from "@moon-cleanup/world";
import type { GameData } from "@moon-cleanup/game-data";
import { Fnv1a32, type DustLedgerPort, type MoonRoomSim } from "../../src/index";
import { makeSim, makeWorldLedger, PLAYER, testWorld } from "../support/world";

export const GOLDEN_TICKS = 10_000;
export const GOLDEN_START_WALLET_LM = 500;

export interface ReplayResult {
  readonly stateHash: number;
  readonly strokeHash: number;
  readonly strokes: number;
  readonly gramsCollected: number;
}

/** Result of a run on the real ledger (packages/world): the dust state is part of what must match. */
export interface WorldLedgerReplayResult extends ReplayResult {
  /** `WorldDustLedger.worldHash()`: every ledger's texels and every Polished plot. */
  readonly dustHash: number;
  /** Plots with a ledger (touched, not Polished) and Polished plots at the end of the run. */
  readonly ledgers: number;
  readonly polished: number;
}

/** The golden script, one tick per `step()`. The script state (PRNG, held inputs) lives here, not in the sim. */
export class GoldenRun {
  sim: MoonRoomSim;
  /** Ticks run so far (the script tick of the next `step`). */
  ticks = 0;
  private readonly next = mulberry32(0x5eed1234);
  private readonly strokeHash = new Fnv1a32();
  private strokes = 0;
  private grams = 0;
  private unsubscribe: Unsubscribe | null = null;
  private readonly state = [0, 1].map(() => ({
    seq: 0,
    moveX: 0,
    moveY: 0,
    yaw: 0,
    yawRate: 0,
    buttons: 0,
    toolParam: 200,
    hold: 0,
  }));

  /** `ledger`: the dust ledger to run on; default the sim's ApproxDustLedger stand-in (the original golden). */
  constructor(data?: GameData, ledger?: DustLedgerPort) {
    const sim = makeSim(testWorld(), {
      walletLm: GOLDEN_START_WALLET_LM,
      ...(data ? { data } : {}),
      ...(ledger ? { ledger } : {}),
    });
    sim.addActor(0, PLAYER);
    sim.addActor(1, { ...PLAYER, displayName: "Second" });
    this.sim = sim;
    this.attach(sim);
  }

  /** Continues the script on `sim` (which must hold the state of the sim it replaces). */
  attach(sim: MoonRoomSim): void {
    this.unsubscribe?.();
    this.sim = sim;
    this.unsubscribe = sim.onEvent((e) => {
      if (e.name === "dust.collected") this.grams += e.payload.grams;
    });
  }

  private rnd(): number {
    return this.next() / 4294967296;
  }

  step(): void {
    const sim = this.sim;
    const t = this.ticks++;
    if (t === 400)
      sim.applyIntent(1, {
        kind: "purchase",
        requestId: "00000000-0000-4000-8000-0000000000f1" as RequestId,
        itemId: "tool.crescent_squeegee",
      });
    // Since Holster gating (M1-W6-T02) the purchase equips the Squeegee at once and one slot makes this a no-op; kept
    // so the script still covers an out-of-range select_tool.
    if (t === 420) sim.applyIntent(1, { kind: "select_tool", slot: 1 });
    for (let s = 0; s < 2; s++) {
      const st = this.state[s]!;
      if (st.hold-- <= 0) {
        st.hold = 10 + Math.floor(this.rnd() * 50);
        st.moveX = Math.floor(this.rnd() * 255) - 127;
        st.moveY = Math.floor(this.rnd() * 255) - 127;
        st.yawRate = Math.floor(this.rnd() * 1200) - 600;
        st.toolParam = Math.floor(this.rnd() * 256);
        const r = this.rnd();
        st.buttons = 0;
        if (r < 0.55) st.buttons |= M.toolPrimary;
        else if (r < 0.65) st.buttons |= M.toolSecondary;
        else if (r < 0.8) st.buttons |= M.lope;
        if (this.rnd() < 0.15) st.buttons |= M.jump;
        if (this.rnd() < 0.05) st.buttons |= M.descend;
        if (this.rnd() < 0.03) st.buttons |= M.holsterNext;
      } else if ((st.buttons & M.jump) !== 0 && this.rnd() < 0.2) {
        st.buttons &= ~M.jump; // jump cut / release
      }
      st.yaw = (st.yaw + st.yawRate + 65536) % 65536;
      st.seq = (st.seq + 1) & 0xffff;
      sim.applyInput(s, {
        seq: st.seq,
        moveX: st.moveX,
        moveY: st.moveY,
        yaw: st.yaw,
        pitch: -20,
        buttons: st.buttons,
        toolParam: st.toolParam,
      });
    }
    sim.step(sim.config.dt);
    const strokeHash = this.strokeHash;
    for (let k = 0; k < sim.strokeCount; k++) {
      const r = sim.strokeAt(k);
      this.strokes++;
      strokeHash.int(r.anchor);
      strokeHash.int(r.startUMm);
      strokeHash.int(r.startVMm);
      strokeHash.int(r.endUMm);
      strokeHash.int(r.endVMm);
      strokeHash.int(r.widthCm | (r.depth16 << 10) | (r.toolCode << 18) | (r.actorSlot << 24));
      strokeHash.int(r.tick);
      strokeHash.int(r.inputSeq);
    }
    for (let s = 0; s < 2; s++) {
      const ts = sim.toolState(s);
      if (ts.fullLatched) sim.drainCell(s);
    }
  }

  /** On the stand-in ledger: the four original fields. On the real ledger: plus the dust hash and plot counts. */
  result(): ReplayResult | WorldLedgerReplayResult {
    const base: ReplayResult = {
      stateHash: this.sim.stateHash(),
      strokeHash: this.strokeHash.value,
      strokes: this.strokes,
      gramsCollected: this.grams,
    };
    const ledger = this.sim.ledger;
    if (!(ledger instanceof WorldDustLedger)) return base;
    return { ...base, dustHash: ledger.worldHash(), ledgers: ledger.ledgerCount, polished: ledger.polishedTotal };
  }
}

export function runGoldenReplay(ticks = GOLDEN_TICKS, data?: GameData, ledger?: DustLedgerPort): ReplayResult {
  const run = new GoldenRun(data, ledger);
  for (let t = 0; t < ticks; t++) run.step();
  return run.result();
}

/** The same script on the real dust ledger (what the Solo worker and the server run). */
export function runWorldLedgerGoldenReplay(ticks = GOLDEN_TICKS): ReplayResult {
  return runGoldenReplay(ticks, undefined, makeWorldLedger());
}
