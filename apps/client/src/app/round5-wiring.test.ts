import { describe, expect, test } from "vitest";
import { AvatarState, headingBasis } from "@moon-cleanup/sim";
import { InputState } from "../gameplay";
import { sphereBearingDeg } from "../ui";
import { ParcelFeed } from "./parcel-feed";
import type { ParcelReadoutSource } from "./parcel-feed";
import { LocalRoomHostImpl } from "../sim-host/local-room-host";
import { FLAT_WORLD, TEST_CONTRACT, TEST_PLAYER, channelWorker } from "../sim-host/test-support";
import { createControlsPort, toBindingTable } from "./controls-port";
import { UiFrameBridge } from "./menu-writer";
import { ReadoutLink } from "./readout-link";
import type { SimReadoutSource } from "./readout-writer";
import { createSettingsStorage } from "./settings-storage";
import { createUiStore } from "./ui-store";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("Solo worker read-outs (Job A)", () => {
  test("worker samples hop / lamp / quotes / plot card and the host cache answers them", async () => {
    const host = new LocalRoomHostImpl({
      contractId: TEST_CONTRACT,
      player: TEST_PLAYER,
      world: FLAT_WORLD,
      spawnWorker: channelWorker,
      clock: "manual",
      store: "memory",
      checkpointIntervalS: 0,
      statsIntervalMs: 0,
      fresh: { walletLm: 500, spawnDirection: undefined },
    });
    while (host.state !== "running") await wait(5);
    let attached: SimReadoutSource | null = null;
    const link = new ReadoutLink((s) => void (attached = s));
    link.setItemIds(["gear.holster_rig"]);
    link.setHost(host);
    expect(attached).toBe(host.readouts);
    host.stepManual(3);
    await wait(60);
    const src = attached as SimReadoutSource | null;
    expect(src).not.toBeNull();
    const hop = { bursts: -1, max: -1, recharge01: -1 };
    expect(src!.hopReadout(0, hop)).toBe(true);
    expect(hop.bursts).toBeGreaterThanOrEqual(0);
    expect(src!.quotePriceLm(0, "gear.holster_rig")).toBe(100);
    expect(src!.quotePriceLm(0, "unknown")).toBe(-1);
    const card = {
      plotId: 0 as never,
      state: 0 as never,
      remainingPct: 0,
      terrainId: null,
      creditedSlot: null,
      countsTowardShine: false,
      shinePctPerPlot: 0,
    };
    expect(src!.pickPlot(0, card)).toBe(false); // not inspecting
    link.setInspecting(true);
    host.stepManual(3);
    await wait(60);
    // Outposts and Near Parcels come through the same message.
    const ps = src as unknown as ParcelReadoutSource;
    expect(ps.outpostCount).toBeGreaterThanOrEqual(1);
    const o = { id: "", x: 0, y: 0, z: 0 };
    expect(ps.outpost(0, o)).toBe(true);
    expect(o.id).toBe("Boreal");
    expect(Math.hypot(o.x, o.y, o.z)).toBeCloseTo(1, 6);
    link.setHost(null);
    expect(attached).toBeNull();
    await host.close("clock_out");
  }, 30_000);
});

describe("Controls wiring (Job B)", () => {
  test("controls port validates, applies to InputState and persists", () => {
    const input = new InputState();
    const saved: unknown[] = [];
    const port = createControlsPort({ input, initial: null, save: (t) => saved.push(t) });
    let notified = 0;
    port.subscribe(() => notified++);
    expect(() => port.apply({ KeyZ: "nonsense" })).toThrow(/unknown action/);
    expect(saved.length).toBe(0);
    port.apply({ ...port.table(), KeyJ: "jump" });
    expect(saved.length).toBe(1);
    expect(notified).toBe(1);
    expect(input.keyDown("KeyJ")).toBe(true);
    port.reset();
    expect(input.keyDown("KeyJ")).toBe(false);
    expect(toBindingTable({ KeyC: "plotCard" }).KeyC).toBe("plotCard");
  });

  test("settings storage round-trips and rejects corrupt values", () => {
    const mem = new Map<string, string>();
    const problems: string[] = [];
    const st = createSettingsStorage(
      { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) },
      (s) => problems.push(s),
    );
    st.saveHudScalePct(130);
    st.saveQuality("high");
    expect(st.loadHudScalePct()).toBe(130);
    expect(st.loadQuality()).toBe("high");
    mem.set("mc.settings.quality", "bogus");
    mem.set("mc.controls.bindings", "{oops");
    expect(st.loadQuality()).toBeNull();
    expect(st.loadBindings()).toBeNull();
    expect(problems.length).toBe(2);
  });

  test("pad capture routes presses to offerInput; C toggles the Plot Card", () => {
    const store = createUiStore();
    const input = new InputState();
    const offered: string[] = [];
    let capture: "pad" | null = "pad";
    const inspect: boolean[] = [];
    const bridge = new UiFrameBridge({
      store,
      ui: {
        navigate: () => true,
        setCompassHeading: () => undefined,
        capturing: () => capture,
        offerInput: (c) => (offered.push(c), true),
      },
      input,
      station: () => null,
      onInspect: (on) => inspect.push(on),
    });
    input.setGamepad(0, 0, 0, 0, 1 << 1); // B
    bridge.pump();
    expect(offered).toEqual(["Pad1"]);
    capture = null;
    input.keyDown("KeyC");
    input.keyUp("KeyC");
    bridge.pump();
    input.keyDown("KeyC");
    input.keyUp("KeyC");
    bridge.pump();
    expect(inspect).toEqual([true, false]);
  });
});

describe("Near Parcels feed", () => {
  test("bearing: heading-frame north is 0 deg and east is 90 deg (world north = +Y)", () => {
    const R = 1737400;
    const a = new AvatarState();
    a.px = 0.3 * R;
    a.py = 0.2 * R;
    a.pz = Math.sqrt(1 - 0.13) * R;
    const b = new Float64Array(9);
    headingBasis(a, b);
    const p = { x: a.px / R, y: a.py / R, z: a.pz / R };
    const at = (i: number): { x: number; y: number; z: number } => ({
      x: p.x + 0.01 * b[i]!,
      y: p.y + 0.01 * b[i + 1]!,
      z: p.z + 0.01 * b[i + 2]!,
    });
    expect(sphereBearingDeg(p, at(3))).toBe(0);
    expect(sphereBearingDeg(p, at(6))).toBe(90);
  });

  test("feeds count, mask and bearings at <= 10 Hz and outposts", () => {
    const calls: string[] = [];
    const dirs = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ];
    const src: ParcelReadoutSource = {
      nearParcelCount: 2,
      nearParcel: (k, out) => (Object.assign(out, dirs[k]), k === 1),
      outpostCount: 1,
      outpost: (_k, out) => (Object.assign(out, { id: "Boreal", x: 0, y: 1, z: 0 }), true),
    };
    const feed = new ParcelFeed({
      ui: {
        setNearParcels: (s, bearing) => {
          const d = { x: 0, y: 0, z: 0 };
          for (let k = 0; k < s.nearParcelCount; k++) {
            const done = s.nearParcel(k, d);
            calls.push(`p${k}:${done}:${String(bearing?.(d))}`);
          }
        },
        setOutpostBearing: (id, deg) => void calls.push(`o:${id}:${String(deg)}`),
      },
      source: () => src,
      samplePos: (out) => (Object.assign(out, { x: 0, y: 0, z: 1737400 }), true),
      bearing: sphereBearingDeg,
    });
    feed.pump(1000);
    expect(calls.length).toBe(3);
    feed.pump(1010); // inside the 100 ms window: nothing
    expect(calls.length).toBe(3);
    expect(calls).toEqual(["p0:false:90", "p1:true:null", "o:Boreal:0"]);
  });
});
