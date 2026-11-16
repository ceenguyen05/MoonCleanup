// H opens and closes the DOT Handbook (SCR-24, keyboard + mouse only; pads reach it through the Time Card). It is an app
// level key rather than an input-table action: the Handbook is a menu surface, the key must work while a menu is open
// (to close it) and it must never fire while the player types in a field or while another menu or modal owns the keyboard.
// No allocation outside the keypress.

import type { UiStore, Unsubscribe } from "@moon-cleanup/shared";

export interface HandbookKeyOptions {
  readonly win: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly store: Pick<UiStore, "dispatch" | "getState">;
}

/** True for a text field, select or contenteditable target (typing H there is just a letter). */
function isEditable(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return false;
  const t = target as { tagName?: unknown; isContentEditable?: unknown };
  if (t.isContentEditable === true) return true;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

export function installHandbookKey(options: HandbookKeyOptions): Unsubscribe {
  const { win, store } = options;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== "KeyH" || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
      return;
    if (event.defaultPrevented || isEditable(event.target)) return;
    const { open, modal } = store.getState().menus;
    if (open === "handbook" && modal === null) {
      store.dispatch({ type: "menus.back" });
    } else if (open === null && modal === null) {
      store.dispatch({ type: "menus.open", surface: "handbook" });
    } else {
      return; // another surface or a modal owns the keyboard
    }
    event.preventDefault();
  };
  win.addEventListener("keydown", onKeyDown);
  return () => win.removeEventListener("keydown", onKeyDown);
}
