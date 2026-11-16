// Worker-side cost of the solo HUD read-out sampler (QA profiling, Node, no browser). Real MoonRoomSim + the real
// ReadoutSampler driven by the scripted input workload at 30 Hz sim time; reports ns per due sample, ns per not-due early
// out, message rate and approximate bytes allocated per call. Numbers are printed (console) for the QA report; the
// assertions are loose guards only (rate <= 10 Hz, no alloc growth beyond a generous bound).
import { describe, expect, it } from "vitest";
import { ReadoutSampler } from "../src/sim-host/readouts";
import { directSim, scriptedInputs } from "../src/sim-host/test-support";

const ITEMS = ["holster_rig_l1", "crown_lamp_l1", "dust_cell_l2", "boost_l1"]; // quote ids as the Desk asks them

function gcNow(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (g) g();
}

describe("readout sampler profile", () => {
  it("prints cost, rate and allocation of ReadoutSampler.sample", () => {
    const sim = directSim();
    const s = new ReadoutSampler();
    s.request(1, true, ITEMS);
    const hz = Math.round(1 / sim.config.dt);
    const ticks = hz * 120; // two minutes of sim time
    const inputs = scriptedInputs(ticks);
    let now = 0;
    let posts = 0;
    let dueCalls = 0;
    let dueNs = 0;
    let earlyNs = 0;
    let earlyCalls = 0;
    let bytes = 0;
    gcNow();
    const heap0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < ticks; i++) {
      sim.applyInput(0, inputs[i]!);
      sim.step(sim.config.dt);
      now += 1000 / hz;
      const t0 = process.hrtime.bigint();
      const m = s.sample(sim, 0, now);
      const dt = Number(process.hrtime.bigint() - t0);
      if (m !== null) {
        posts++;
        bytes += JSON.stringify(m).length;
        dueCalls++;
        dueNs += dt;
      } else if (dt > 5000) {
        dueCalls++; // due but unchanged (full sample cost, no post)
        dueNs += dt;
      } else {
        earlyCalls++;
        earlyNs += dt;
      }
    }
    const heap1 = process.memoryUsage().heapUsed;
    const seconds = ticks / hz;
    const result: Record<string, unknown> = {
      simSeconds: seconds,
      tickHz: hz,
      posts,
      postsPerSec: +(posts / seconds).toFixed(3),
      jsonBytesPerPost: posts ? Math.round(bytes / posts) : 0,
      jsonBytesPerSec: Math.round(bytes / seconds),
      fullSampleCalls: dueCalls,
      fullSampleMeanUs: dueCalls ? +(dueNs / dueCalls / 1000).toFixed(2) : 0,
      earlyOutCalls: earlyCalls,
      earlyOutMeanNs: earlyCalls ? Math.round(earlyNs / earlyCalls) : 0,
      cpuPctOfOneCoreAt10Hz: dueCalls ? +(((dueNs / dueCalls) * 10) / 1e9 * 100).toFixed(4) : 0,
      heapDeltaKB: Math.round((heap1 - heap0) / 1024),
      gcExposed: typeof (globalThis as { gc?: unknown }).gc === "function",
    };
    // Sampler alone (sim frozen, state unchanged): bytes allocated per due call.
    gcNow();
    const a0 = process.memoryUsage().heapUsed;
    const N = 20000;
    for (let i = 0; i < N; i++) s.sample(sim, 0, now + 100 * (i + 1));
    const a1 = process.memoryUsage().heapUsed;
    result["unchangedSampleBytesPerCall"] = Math.round((a1 - a0) / N);
    console.log("READOUT_BENCH " + JSON.stringify(result));
    expect(result["postsPerSec"] as number).toBeLessThanOrEqual(10.01);
  });
});
