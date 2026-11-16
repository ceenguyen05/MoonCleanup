import { describe, expect, it, vi } from "vitest";
import { BINDINGS_REV, DEFAULT_BINDINGS, INPUT_SETTINGS_KEYS, type BindingTable, type PlotCardMode } from "../gameplay";
import { applyInputSettings, choosePlotCardMode } from "./input-settings";

function memory(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

function rig(storage: ReturnType<typeof memory> | null, storedBindings: Record<string, string> | null) {
  const setBindings = vi.fn<(t: BindingTable) => void>();
  const setPlotCardMode = vi.fn<(m: PlotCardMode) => void>();
  const saveBindings = vi.fn<(t: BindingTable) => void>();
  const report = vi.fn();
  const result = applyInputSettings({
    input: { setBindings, setPlotCardMode },
    storage,
    storedBindings,
    saveBindings,
    report,
  });
  return { result, setBindings, setPlotCardMode, saveBindings, report };
}

describe("applyInputSettings", () => {
  it("fresh install: defaults, toggle mode, rev stored, nothing saved", () => {
    const storage = memory();
    const r = rig(storage, null);
    expect(r.result.initial).toBeNull();
    expect(r.setBindings).not.toHaveBeenCalled();
    expect(r.setPlotCardMode).toHaveBeenCalledWith("toggle");
    expect(storage.map.get(INPUT_SETTINGS_KEYS.bindingsRev)).toBe(String(BINDINGS_REV));
  });

  it("migrates an untouched pre-revision table once and re-saves it", () => {
    const old: Record<string, string> = {
      ...DEFAULT_BINDINGS,
      Pad12: "lampCycle",
      Pad15: "seatSwitch",
      Pad8: "cameraMode",
    };
    delete old["Pad9"];
    const storage = memory();
    const r = rig(storage, old);
    expect(r.result.initial?.["Pad12"]).toBe("plotCard");
    expect(r.saveBindings).toHaveBeenCalledTimes(1);
    expect(r.setBindings).toHaveBeenCalledTimes(1);
    expect(storage.map.get(INPUT_SETTINGS_KEYS.bindingsRev)).toBe(String(BINDINGS_REV));
  });

  it("does not touch a table already at the current rev", () => {
    const table: Record<string, string> = { ...DEFAULT_BINDINGS };
    delete table["Pad12"];
    const storage = memory({ [INPUT_SETTINGS_KEYS.bindingsRev]: String(BINDINGS_REV) });
    const r = rig(storage, table);
    expect(r.result.initial).toEqual(table);
    expect(r.saveBindings).not.toHaveBeenCalled();
  });

  it("reports a corrupt stored table and keeps going", () => {
    const r = rig(memory(), { KeyW: "noSuchAction" });
    expect(r.report).toHaveBeenCalledWith("stored key bindings", expect.any(Error));
    expect(r.result.initial).toBeNull();
    expect(r.setPlotCardMode).toHaveBeenCalledWith("toggle");
  });

  it("restores a stored hold mode and reports an unknown one", () => {
    const hold = rig(memory({ [INPUT_SETTINGS_KEYS.plotCardMode]: "hold" }), null);
    expect(hold.setPlotCardMode).toHaveBeenCalledWith("hold");
    const bad = rig(memory({ [INPUT_SETTINGS_KEYS.plotCardMode]: "weird" }), null);
    expect(bad.setPlotCardMode).toHaveBeenCalledWith("toggle");
    expect(bad.report).toHaveBeenCalled();
  });

  it("works without storage (private mode)", () => {
    expect(rig(null, null).result.plotCardMode).toBe("toggle");
  });
});

describe("choosePlotCardMode", () => {
  it("applies to input and persists", () => {
    const storage = memory();
    const input = { setPlotCardMode: vi.fn() };
    expect(choosePlotCardMode(input, storage, "hold")).toBe(true);
    expect(input.setPlotCardMode).toHaveBeenCalledWith("hold");
    expect(storage.map.get(INPUT_SETTINGS_KEYS.plotCardMode)).toBe("hold");
    expect(choosePlotCardMode(input, null, "toggle")).toBe(false);
  });
});
