import { describe, expect, test } from "vitest";
import { installHandbookKey } from "./handbook-key";
import { createUiStore } from "./ui-store";

function rig() {
  const store = createUiStore(1000);
  let clock = 0;
  const flush = (): boolean => store.flush((clock += 1000));
  let handler: ((e: KeyboardEvent) => void) | null = null;
  const win = {
    addEventListener: (_t: string, h: (e: KeyboardEvent) => void) => void (handler = h),
    removeEventListener: () => void (handler = null),
  } as unknown as Pick<Window, "addEventListener" | "removeEventListener">;
  const off = installHandbookKey({ win, store });
  const press = (
    init: { code?: string; repeat?: boolean; ctrlKey?: boolean; target?: object } = {},
  ): { prevented: boolean } => {
    const out = { prevented: false };
    const event = {
      code: "KeyH",
      repeat: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      target: null,
      preventDefault: () => void (out.prevented = true),
      ...init,
    } as unknown as KeyboardEvent;
    handler?.(event);
    flush();
    return out;
  };
  return { store, flush, press, off, attached: () => handler !== null };
}

describe("H opens the DOT Handbook", () => {
  test("opens from play, closes on a second press", () => {
    const { store, press } = rig();
    expect(press().prevented).toBe(true);
    expect(store.getState().menus.open).toBe("handbook");
    press();
    expect(store.getState().menus.open).toBeNull();
  });

  test("ignores other keys, repeats, modifiers and text fields", () => {
    const { store, press } = rig();
    press({ code: "KeyG" });
    press({ repeat: true });
    press({ ctrlKey: true });
    press({ target: { tagName: "INPUT" } });
    press({ target: { isContentEditable: true } });
    expect(store.getState().menus.open).toBeNull();
  });

  test("does not fire over another surface or a modal", () => {
    const { store, flush, press } = rig();
    store.dispatch({ type: "menus.open", surface: "requisitions_desk" });
    flush();
    expect(press().prevented).toBe(false);
    expect(store.getState().menus.open).toBe("requisitions_desk");
  });

  test("a Handbook opened from the Time Card goes back to it", () => {
    const { store, flush, press } = rig();
    store.dispatch({ type: "menus.open", surface: "time_card" });
    store.dispatch({ type: "menus.open", surface: "handbook" });
    flush();
    press();
    expect(store.getState().menus.open).toBe("time_card");
  });

  test("unsubscribe removes the listener", () => {
    const { off, attached } = rig();
    off();
    expect(attached()).toBe(false);
  });
});
