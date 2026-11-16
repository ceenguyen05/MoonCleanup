import { describe, expect, it } from "vitest";
import {
  BINDINGS_REV,
  DEFAULT_BINDINGS,
  PAD_BUTTONS,
  ACTION_PLOT_CARD,
  compileBindings,
  migrateBindings,
  rebind,
  type BindingTable,
} from "./bindings";
import { DEFAULT_HOLD_THRESHOLD_S, InputState } from "./input-state";
import {
  DEFAULT_PLOT_CARD_MODE,
  INPUT_SETTINGS_KEYS,
  loadBindingsRev,
  loadPlotCardMode,
  saveBindingsRev,
  savePlotCardMode,
  type InputSettingsStore,
} from "./plot-card-mode";

const DPAD_UP = 1 << 12;
const FRAME = { dt: 1 / 60, nowMs: 0 };

/** The rev-1 (pre-revision) default pad layout a stored table carries. */
function rev1Table(): BindingTable {
  let t = rebind(DEFAULT_BINDINGS, "Pad8", "cameraMode");
  t = rebind(t, "Pad12", "lampCycle");
  return rebind(t, "Pad15", "seatSwitch");
}

function memoryStore(): InputSettingsStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe("default Plot Card pad binding", () => {
  it("binds D-pad Up (Pad12) to plotCard; Start (Pad9) stays free for Pause; lamp moves to D-pad Right", () => {
    expect(DEFAULT_BINDINGS.Pad12).toBe("plotCard");
    expect(DEFAULT_BINDINGS.Pad9).toBeUndefined();
    expect(DEFAULT_BINDINGS.Pad15).toBe("lampCycle");
    expect(DEFAULT_BINDINGS.Pad8).toBe("seatSwitch");
    expect(compileBindings(DEFAULT_BINDINGS).pad[12]).toBe(ACTION_PLOT_CARD);
    const pads = Object.keys(DEFAULT_BINDINGS).filter((d) => /^Pad\d+$/.test(d));
    expect(pads.every((d) => Number(d.slice(3)) < PAD_BUTTONS)).toBe(true);
    // Every on-foot action that had a pad default still has one.
    for (const a of ["lampCycle", "seatSwitch", "ballast", "pickupDrop", "plotCard"]) {
      expect(pads.some((d) => DEFAULT_BINDINGS[d] === a)).toBe(true);
    }
    expect(DEFAULT_BINDINGS.KeyC).toBe("plotCard");
    expect(DEFAULT_BINDINGS.KeyV).toBe("cameraMode");
  });

  it("D-pad Up tap toggles the Plot Card on release (default toggle mode)", () => {
    const s = new InputState();
    expect(s.plotCardActivation).toBe(DEFAULT_PLOT_CARD_MODE);
    expect(DEFAULT_PLOT_CARD_MODE).toBe("toggle");
    s.setGamepad(0, 0, 0, 0, DPAD_UP);
    s.advance(FRAME);
    expect(s.takePlotCardToggles()).toBe(0); // not resolved while down
    s.setGamepad(0, 0, 0, 0, 0);
    expect(s.takePlotCardToggles()).toBe(1);
    expect(s.takeCameraToggles()).toBe(0);
  });

  it("D-pad Up held past the 0.30 s threshold toggles the camera once, no Plot Card", () => {
    const s = new InputState();
    expect(DEFAULT_HOLD_THRESHOLD_S).toBe(0.3);
    s.setGamepad(0, 0, 0, 0, DPAD_UP);
    for (let i = 0; i < 17; i++) s.advance(FRAME); // 0.283 s
    expect(s.takeCameraToggles()).toBe(0);
    for (let i = 0; i < 2; i++) s.advance(FRAME); // 0.317 s
    expect(s.takeCameraToggles()).toBe(1);
    for (let i = 0; i < 60; i++) s.advance(FRAME);
    s.setGamepad(0, 0, 0, 0, 0);
    expect(s.takeCameraToggles()).toBe(0);
    expect(s.takePlotCardToggles()).toBe(0);
  });

  it("honours a changed hold threshold (Relaxed Timing 0.5 s)", () => {
    const s = new InputState();
    s.holdThresholdS = 0.5;
    s.setGamepad(0, 0, 0, 0, DPAD_UP);
    for (let i = 0; i < 24; i++) s.advance(FRAME); // 0.4 s
    s.setGamepad(0, 0, 0, 0, 0);
    expect(s.takeCameraToggles()).toBe(0);
    expect(s.takePlotCardToggles()).toBe(1);
  });

  it("menu, blur and presses inside a menu never leave a pending tap/hold", () => {
    const s = new InputState();
    s.setGamepad(0, 0, 0, 0, DPAD_UP);
    s.setSuspended(true);
    s.setGamepad(0, 0, 0, 0, 0);
    s.setSuspended(false);
    expect(s.takePlotCardToggles()).toBe(0);
    s.setSuspended(true);
    s.setGamepad(0, 0, 0, 0, DPAD_UP); // pressed inside the menu
    for (let i = 0; i < 30; i++) s.advance(FRAME);
    s.setSuspended(false);
    s.setGamepad(0, 0, 0, 0, 0);
    expect(s.takeCameraToggles()).toBe(0);
    expect(s.takePlotCardToggles()).toBe(0);
    s.setGamepad(0, 0, 0, 0, DPAD_UP);
    s.clear();
    for (let i = 0; i < 30; i++) s.advance(FRAME);
    expect(s.takeCameraToggles()).toBe(0);
  });
});

describe("migrateBindings", () => {
  it("moves an untouched rev-1 pad layout to the spec D-pad once", () => {
    const stored = rev1Table();
    const m = migrateBindings(stored, null);
    expect(m.changed).toBe(true);
    expect(m.rev).toBe(BINDINGS_REV);
    expect(m.table.Pad12).toBe("plotCard");
    expect(m.table.Pad15).toBe("lampCycle");
    expect(m.table.Pad8).toBe("seatSwitch");
    expect(m.table.Pad9).toBeUndefined();
    expect(m.table.KeyJ).toBe(stored.KeyJ); // everything else kept
    expect(stored.Pad12).toBe("lampCycle"); // input untouched
  });

  it("keeps other rebinds (keys, Pad9 Hop from the browser check) while migrating", () => {
    const stored = rebind(rebind(rev1Table(), "Pad9", "jump"), "KeyJ", "jump");
    const m = migrateBindings(stored, null);
    expect(m.changed).toBe(true);
    expect(m.table.Pad9).toBe("jump");
    expect(m.table.KeyJ).toBe("jump");
  });

  it("never overwrites a player's own D-pad layout", () => {
    const custom = migrateBindings(rebind(rev1Table(), "Pad12", "ballast"), null);
    expect(custom.changed).toBe(false);
    expect(custom.table.Pad12).toBe("ballast");
    const own = migrateBindings(rebind(rev1Table(), "Pad16", "plotCard"), null);
    expect(own.changed).toBe(false);
    expect(own.table.Pad12).toBe("lampCycle");
  });

  it("runs once: a current-revision table is left exactly as stored", () => {
    const mine: BindingTable = rebind(DEFAULT_BINDINGS, "Pad12", null);
    const m = migrateBindings(mine, BINDINGS_REV);
    expect(m.changed).toBe(false);
    expect(m.table).toBe(mine);
  });

  it("revision persists through the store", () => {
    const st = memoryStore();
    expect(loadBindingsRev(st)).toBeNull();
    saveBindingsRev(st, BINDINGS_REV);
    expect(loadBindingsRev(st)).toBe(BINDINGS_REV);
    st.map.set(INPUT_SETTINGS_KEYS.bindingsRev, "junk");
    expect(loadBindingsRev(st)).toBeNull();
  });
});

describe("Plot Card hold mode (keyboard C)", () => {
  it("hold: flips on press and again on release (card shows only while held)", () => {
    const s = new InputState();
    s.setPlotCardMode("hold");
    s.keyDown("KeyC");
    expect(s.takePlotCardToggles()).toBe(1); // open
    expect(s.takePlotCardToggles()).toBe(0); // held: no change
    s.keyUp("KeyC");
    expect(s.takePlotCardToggles()).toBe(1); // close
  });

  it("hold: a press and release inside one frame nets no change", () => {
    const s = new InputState();
    s.setPlotCardMode("hold");
    s.keyDown("KeyC");
    s.keyUp("KeyC");
    expect(s.takePlotCardToggles() % 2).toBe(0);
  });

  it("hold: blur (clear) closes a held card; a menu drops the latch with no stray flip on release", () => {
    const s = new InputState();
    s.setPlotCardMode("hold");
    s.keyDown("KeyC");
    s.takePlotCardToggles();
    s.clear();
    expect(s.takePlotCardToggles()).toBe(1);
    s.keyUp("KeyC"); // key-up after the blur: already released
    expect(s.takePlotCardToggles()).toBe(0);

    s.keyDown("KeyC");
    s.takePlotCardToggles();
    s.setSuspended(true); // the app closes the card when a menu opens
    s.keyUp("KeyC");
    s.setSuspended(false);
    expect(s.takePlotCardToggles()).toBe(0);
  });

  it("toggle mode: release adds nothing", () => {
    const s = new InputState();
    s.keyDown("KeyC");
    s.keyUp("KeyC");
    s.keyDown("KeyC");
    expect(s.takePlotCardToggles()).toBe(2);
    s.keyUp("KeyC");
    expect(s.takePlotCardToggles()).toBe(0);
  });

  it("mode persists through the settings store (unknown values reported and ignored)", () => {
    const st = memoryStore();
    expect(loadPlotCardMode(st)).toBeNull();
    expect(savePlotCardMode(st, "hold")).toBe(true);
    expect(st.map.get(INPUT_SETTINGS_KEYS.plotCardMode)).toBe("hold");
    expect(loadPlotCardMode(st)).toBe("hold");
    const problems: string[] = [];
    st.map.set(INPUT_SETTINGS_KEYS.plotCardMode, "sometimes");
    expect(loadPlotCardMode(st, (src) => problems.push(src))).toBeNull();
    expect(problems).toEqual(["settings load"]);
    expect(loadPlotCardMode(null)).toBeNull();
    expect(savePlotCardMode(null, "toggle")).toBe(false);
    const throwing: InputSettingsStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadPlotCardMode(throwing)).toBeNull();
    expect(savePlotCardMode(throwing, "hold")).toBe(false);
  });
});

describe("ParcelFeed clears near parcels when its source leaves", () => {
  it("calls clearNearParcels once on source loss, not while idle", async () => {
    const { ParcelFeed } = await import("../../app/parcel-feed");
    let clears = 0;
    let sets = 0;
    let on = true;
    const src = {
      nearParcelCount: 0,
      nearParcel: () => false,
      outpostCount: 0,
      outpost: () => false,
    };
    const feed = new ParcelFeed({
      ui: { setNearParcels: () => void sets++, setOutpostBearing: () => {}, clearNearParcels: () => void clears++ },
      source: () => (on ? src : null),
      samplePos: (out) => (Object.assign(out, { x: 0, y: 1, z: 0 }), true),
      bearing: () => 0,
    });
    feed.pump(0);
    expect(sets).toBe(1);
    on = false;
    feed.pump(500);
    feed.pump(1000);
    expect(clears).toBe(1);
    on = true;
    feed.pump(1500);
    expect(sets).toBe(2);
  });
});

describe("Plot Card review fixes (M1 batch review 1-4)", () => {
  it("blur while D-pad Up is held: no second camera toggle and no flip on release", () => {
    const s = new InputState();
    s.setGamepad(0, 0, 0, 0, DPAD_UP);
    for (let i = 0; i < 30; i++) s.advance(FRAME);
    expect(s.takeCameraToggles()).toBe(1);
    s.clear();
    s.setGamepad(0, 0, 0, 0, DPAD_UP); // still physically held after the blur
    for (let i = 0; i < 30; i++) s.advance(FRAME);
    expect(s.takeCameraToggles()).toBe(0);
    s.setGamepad(0, 0, 0, 0, 0);
    expect(s.takePlotCardToggles()).toBe(0);
    // The next real tap works again.
    s.setGamepad(0, 0, 0, 0, DPAD_UP);
    s.advance(FRAME);
    s.setGamepad(0, 0, 0, 0, 0);
    expect(s.takePlotCardToggles()).toBe(1);
  });

  it("one long frame does not turn a D-pad tap into a hold", () => {
    const s = new InputState();
    s.setGamepad(0, 0, 0, 0, DPAD_UP);
    s.advance({ dt: 2, nowMs: 0 });
    s.setGamepad(0, 0, 0, 0, 0);
    expect(s.takeCameraToggles()).toBe(0);
    expect(s.takePlotCardToggles()).toBe(1);
  });

  it("hold mode: holding C then tapping the pad closes the card and releasing C keeps it closed", () => {
    const s = new InputState();
    s.setPlotCardMode("hold");
    s.keyDown("KeyC");
    s.setGamepad(0, 0, 0, 0, DPAD_UP);
    s.advance(FRAME);
    s.setGamepad(0, 0, 0, 0, 0);
    s.keyUp("KeyC");
    expect(s.takePlotCardToggles() % 2).toBe(0); // open, close: card ends closed
  });

  it("hold mode: a wheel notch bound to plotCard toggles the card", () => {
    const s = new InputState(rebind(DEFAULT_BINDINGS, "WheelUp", "plotCard"));
    s.setPlotCardMode("hold");
    s.wheel(-1);
    expect(s.takePlotCardToggles()).toBe(1);
    s.wheel(-1);
    expect(s.takePlotCardToggles()).toBe(1);
  });
});
