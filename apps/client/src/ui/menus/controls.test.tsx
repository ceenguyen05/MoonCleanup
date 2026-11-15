import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EventBus } from "@moon-cleanup/shared";
import { createUiStore } from "../../app/ui-store";
import { STRINGS } from "../strings";
import { installDisplayMetrics, userScaleFromSetting } from "../tokens/display-metrics";
import { UiProvider } from "../ui-context";
import {
  assignInput,
  CONTROL_GROUPS,
  createMemoryControlsPort,
  deviceClass,
  inputLabel,
  inputsFor,
  inputsText,
  type BindingTable,
} from "./controls-model";
import { ControlsScreen, remapNoteText } from "./ControlsScreen";
import { MenuHost } from "./MenuHost";
import { commitCapture, createUiPrefsStore, UiControlsContext, UiPrefsContext } from "./ui-local";

const TABLE: BindingTable = {
  KeyW: "moveForward",
  ArrowUp: "moveForward",
  KeyE: "interact",
  Space: "jump",
  Mouse0: "toolPrimary",
  WheelUp: "holsterPrev",
  KeyQ: "holsterPrev",
  Pad0: "jump",
  Pad2: "interact",
  KeyC: "plotCard",
};

describe("rebinding model", () => {
  it("classifies device codes and lists inputs per action and class", () => {
    expect(deviceClass("KeyW")).toBe("key");
    expect(deviceClass("Mouse2")).toBe("pointer");
    expect(deviceClass("WheelDown")).toBe("pointer");
    expect(deviceClass("Pad12")).toBe("pad");
    expect(inputsFor(TABLE, "moveForward", "key")).toEqual(["KeyW", "ArrowUp"]);
    expect(inputsFor(TABLE, "holsterPrev", "pointer")).toEqual(["WheelUp"]);
    expect(inputsFor(TABLE, "jump", "pad")).toEqual(["Pad0"]);
  });
  it("names inputs for players, never raw codes for the common ones", () => {
    expect(inputLabel("KeyW")).toBe("W");
    expect(inputLabel("Digit3")).toBe("3");
    expect(inputLabel("ShiftLeft")).toBe("Left Shift");
    expect(inputLabel("Mouse0")).toBe("Left click");
    expect(inputLabel("Pad3")).toBe("Y");
    expect(inputLabel("Pad12")).toBe("D-pad up");
    expect(inputsText([])).toBe(STRINGS.menus.remap.unbound);
    expect(inputsText(["KeyW", "ArrowUp"])).toBe("W / Up arrow");
  });
  it("replaces the action's own keys, keeps mouse and wheel, and moves a taken key", () => {
    const own = assignInput(TABLE, "moveForward", "key", "KeyI");
    expect(inputsFor(own.table, "moveForward", "key")).toEqual(["KeyI"]);
    expect(own.stolenFrom).toBeNull();
    const kept = assignInput(TABLE, "holsterPrev", "key", "KeyZ");
    expect(inputsFor(kept.table, "holsterPrev", "pointer")).toEqual(["WheelUp"]);
    expect(inputsFor(kept.table, "holsterPrev", "key")).toEqual(["KeyZ"]);
    const steal = assignInput(TABLE, "jump", "key", "KeyE");
    expect(steal.stolenFrom).toBe("interact");
    expect(steal.leftUnbound).toBe(true);
    expect(steal.table["KeyE"]).toBe("jump");
    expect(inputsFor(steal.table, "interact", "key")).toEqual([]);
    // The input table never has two actions on one input, and the source table is untouched.
    expect(TABLE["KeyE"]).toBe("interact");
    const cleared = assignInput(TABLE, "moveForward", "key", null);
    expect(inputsFor(cleared.table, "moveForward", "key")).toEqual([]);
    expect(cleared.table["Pad0"]).toBe("jump");
  });
  it("rebinds a gamepad button on its own kind only", () => {
    const next = assignInput(TABLE, "interact", "pad", "Pad3");
    expect(inputsFor(next.table, "interact", "pad")).toEqual(["Pad3"]);
    expect(inputsFor(next.table, "interact", "key")).toEqual(["KeyE"]);
  });
});

describe("capture through the UI-local store", () => {
  it("applies a key, moves a taken key with a note, and refuses reserved keys", () => {
    const port = createMemoryControlsPort(TABLE);
    const prefs = createUiPrefsStore();
    expect(commitCapture(prefs, port, "KeyK")).toBe(false); // nothing waiting
    prefs.setCapture({ action: "interact", kind: "key" });
    expect(commitCapture(prefs, port, "Escape")).toBe(true);
    expect(prefs.getState().note).toEqual({ kind: "reserved", code: "Escape" });
    expect(prefs.getState().capture).not.toBeNull(); // still waiting
    expect(commitCapture(prefs, port, "Pad1")).toBe(false); // a pad button is not for a key capture
    expect(commitCapture(prefs, port, "Space")).toBe(true);
    expect(port.table()["Space"]).toBe("interact");
    expect(prefs.getState().note).toMatchObject({ kind: "moved", from: "jump" });
    expect(prefs.getState().capture).toBeNull();
    expect(remapNoteText(prefs.getState().note as never)).toContain("Hop");
  });
  it("takes gamepad buttons only when a pad capture waits, and clears with Backspace", () => {
    const port = createMemoryControlsPort(TABLE);
    const prefs = createUiPrefsStore();
    prefs.setCapture({ action: "jump", kind: "pad" });
    expect(commitCapture(prefs, port, "KeyA")).toBe(false);
    expect(commitCapture(prefs, port, "Pad5")).toBe(true);
    expect(inputsFor(port.table(), "jump", "pad")).toEqual(["Pad5"]);
    prefs.setCapture({ action: "moveForward", kind: "key" });
    commitCapture(prefs, port, "Backspace");
    expect(inputsFor(port.table(), "moveForward", "key")).toEqual([]);
    expect(prefs.getState().note).toEqual({ kind: "cleared", action: "moveForward" });
  });
  it("reports a rejected apply and leaves the table alone", () => {
    const port = {
      ...createMemoryControlsPort(TABLE),
      apply: () => {
        throw new Error("bad");
      },
    };
    const prefs = createUiPrefsStore();
    prefs.setCapture({ action: "interact", kind: "key" });
    expect(commitCapture(prefs, port, "KeyK")).toBe(true);
    expect(prefs.getState().note).toEqual({ kind: "failed" });
    expect(port.table()).toBe(TABLE);
  });
  it("mirrors the quality preset and ignores no-op updates", () => {
    const prefs = createUiPrefsStore();
    const listener = vi.fn();
    prefs.subscribe(listener);
    prefs.setQuality({ preset: "high", maxPreset: "high" });
    prefs.setQuality({ preset: "high" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(prefs.getState().quality).toEqual({ preset: "high", maxPreset: "high" });
  });
});

function renderScreen(
  node: "controls" | "settings",
  opts: { port?: boolean; open?: boolean; maxPreset?: string } = {},
) {
  const store = createUiStore();
  store.dispatch({ type: "menus.open", surface: "settings" });
  store.flush(1000);
  const prefs = createUiPrefsStore();
  if (opts.open === true) prefs.setControlsOpen(true);
  if (opts.maxPreset !== undefined) prefs.setQuality({ maxPreset: opts.maxPreset as never, preset: "medium" });
  const port = opts.port === false ? null : createMemoryControlsPort(TABLE);
  const win = {
    matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  };
  return renderToStaticMarkup(
    <UiProvider
      store={store}
      events={{} as EventBus}
      host={{} as HTMLElement}
      win={win as unknown as Window}
      motion="full"
      glass="auto"
    >
      <UiPrefsContext.Provider value={prefs}>
        <UiControlsContext.Provider value={port}>
          {node === "controls" ? <ControlsScreen /> : <MenuHost />}
        </UiControlsContext.Provider>
      </UiPrefsContext.Provider>
    </UiProvider>,
  );
}

describe("rebinding screen render", () => {
  it("lists every action with player names, current keys and fixed mouse bindings", () => {
    const html = renderScreen("controls");
    expect(html).toContain("Move forward");
    expect(html).toContain("W / Up arrow");
    expect(html).toContain("Left click"); // toolPrimary pointer binding, shown but fixed
    expect(html).toContain("Wheel up");
    expect(html).toContain(STRINGS.menus.remap.unbound);
    expect(html).toContain('data-testid="bind-interact-pad"');
    expect(html).not.toMatch(/>moveForward</); // never raw action ids
  });
  it("shows the Plot Card row (default C), keyboard and gamepad cells, and every group action has a name", () => {
    const html = renderScreen("controls");
    expect(html).toContain("Plot Card");
    expect(html).toContain('data-testid="bind-plotCard-key"');
    expect(html).toContain('data-testid="bind-plotCard-pad"');
    expect(CONTROL_GROUPS.flatMap((g) => g.actions)).toContain("plotCard");
    const names = STRINGS.menus.remap.actions as Readonly<Record<string, string>>;
    for (const group of CONTROL_GROUPS) for (const action of group.actions) expect(names[action], action).toBeTruthy();
    expect(inputsFor(TABLE, "plotCard", "key")).toEqual(["KeyC"]);
  });
  it("rebinding Plot Card steals the key from its owner and reports it", () => {
    const stolen = assignInput(TABLE, "plotCard", "key", "KeyE");
    expect(stolen.stolenFrom).toBe("interact");
    expect(stolen.table["KeyC"]).toBeUndefined();
    expect(stolen.table["KeyE"]).toBe("plotCard");
  });
  it("says remapping is unavailable without a port", () => {
    const html = renderScreen("controls", { port: false });
    expect(html).toContain(STRINGS.menus.remap.noPort);
    expect(html).not.toContain("bind-interact-key");
  });
  it("Settings shows the quality preset from the store, marks capped presets, and swaps to the screen", () => {
    const list = renderScreen("settings");
    expect(list).toContain('data-testid="settings-quality"');
    expect(list).toContain('aria-checked="true"');
    expect(renderScreen("settings", { maxPreset: "medium" })).toMatch(/aria-disabled="true"[^>]*>High|>High<\/button>/);
    expect(renderScreen("settings", { maxPreset: "medium" })).toContain("High is not offered on this device.");
    const remap = renderScreen("settings", { open: true });
    expect(remap).toContain('data-testid="controls-screen"');
    expect(remap).not.toContain('data-testid="settings-hud-scale"');
  });
});

describe("UI size wiring", () => {
  it("clamps the setting to the supported range and honours the debug override", () => {
    expect(userScaleFromSetting(100)).toBe(1);
    expect(userScaleFromSetting(125)).toBe(1.25);
    expect(userScaleFromSetting(50)).toBe(0.8);
    expect(userScaleFromSetting(400)).toBe(1.5);
    expect(userScaleFromSetting(Number.NaN)).toBe(1);
    expect(userScaleFromSetting(100, 1.2)).toBe(1.2);
  });
  it("re-applies --mc-hud-scale (whole-device-pixel tokens follow) when the user scale changes", () => {
    const props = new Map<string, string>();
    const root = {
      style: {
        getPropertyValue: (name: string) => props.get(name) ?? "",
        setProperty: (name: string, value: string) => void props.set(name, value),
      },
    } as unknown as HTMLElement;
    const mql = { addEventListener: () => undefined, removeEventListener: () => undefined };
    const win = {
      devicePixelRatio: 1.25,
      innerHeight: 1080,
      matchMedia: () => mql,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as Window;
    const handle = installDisplayMetrics(win, root, { userScale: userScaleFromSetting(100) });
    expect(props.get("--mc-hud-scale")).toBe("1");
    expect(props.get("--mc-px")).toBe("0.8px");
    handle.setUserScale(userScaleFromSetting(130));
    expect(props.get("--mc-hud-scale")).toBe("1.3");
    expect(props.get("--mc-dpr")).toBe("1.25");
    handle.setUserScale(userScaleFromSetting(80));
    expect(props.get("--mc-hud-scale")).toBe("0.8");
  });
});

describe("source rules", () => {
  it("rebinding screen has no window / document listeners, timers or rAF and no transform-scale", () => {
    for (const file of ["ControlsScreen.tsx", "ui-local.tsx", "controls-model.ts"]) {
      const source = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
      expect(source, file).not.toMatch(/addEventListener|requestAnimationFrame|setInterval|setTimeout/);
      expect(source, file).not.toMatch(/from "three"|sim-host|gameplay\//);
    }
    const css = readFileSync(fileURLToPath(new URL("./Menus.module.css", import.meta.url)), "utf8");
    expect(css).not.toMatch(/transform:\s*scale|filter:\s*blur/);
  });
});
