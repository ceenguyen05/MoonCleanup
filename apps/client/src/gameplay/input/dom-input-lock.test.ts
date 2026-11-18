import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS } from "./bindings";
import { DomInput, type DomInputHost, type PointerLockTarget } from "./dom-input";
import { InputState } from "./input-state";

type Listener = (event: Event) => void;

function fakes() {
  const winL = new Map<string, Listener>();
  const docL = new Map<string, Listener>();
  const tgtL = new Map<string, Listener>();
  const doc = {
    pointerLockElement: null as unknown,
    hidden: false,
    exits: 0,
    addEventListener: (t: string, l: Listener) => void docL.set(t, l),
    removeEventListener: (t: string) => void docL.delete(t),
    exitPointerLock() {
      doc.exits++;
      doc.pointerLockElement = null;
      docL.get("pointerlockchange")?.({} as Event);
    },
  };
  const host: DomInputHost = {
    addEventListener: (t, l) => void winL.set(t, l),
    removeEventListener: (t) => void winL.delete(t),
    document: doc,
  };
  const target: PointerLockTarget & { requests: number; rejectNext: boolean } = {
    requests: 0,
    rejectNext: false,
    addEventListener: (t, l) => void tgtL.set(t, l),
    removeEventListener: (t) => void tgtL.delete(t),
    requestPointerLock() {
      target.requests++;
      return target.rejectNext ? Promise.reject(new Error("SecurityError")) : undefined;
    },
  };
  const lock = () => {
    doc.pointerLockElement = target;
    docL.get("pointerlockchange")?.({} as Event);
  };
  return { winL, docL, tgtL, doc, host, target, lock };
}

function make() {
  const f = fakes();
  const state = new InputState(DEFAULT_BINDINGS);
  const dom = new DomInput(f.host, f.target, state);
  dom.attach();
  return { ...f, state, dom };
}

describe("DomInput pointer-lock hygiene", () => {
  it("releases the OS cursor when a menu opens while locked", () => {
    const t = make();
    t.lock();
    expect(t.dom.locked).toBe(true);
    t.dom.sync();
    expect(t.doc.exits).toBe(0);
    t.state.setSuspended(true);
    t.dom.sync();
    expect(t.doc.exits).toBe(1);
    expect(t.dom.locked).toBe(false);
  });

  it("does not capture the mouse while a menu is open or the tab is hidden", () => {
    const t = make();
    t.state.setSuspended(true);
    t.tgtL.get("mousedown")?.({ button: 0, preventDefault() {} } as unknown as Event);
    expect(t.target.requests).toBe(0);
    t.state.setSuspended(false);
    t.doc.hidden = true;
    t.tgtL.get("mousedown")?.({ button: 0, preventDefault() {} } as unknown as Event);
    expect(t.target.requests).toBe(0);
    t.doc.hidden = false;
    t.tgtL.get("mousedown")?.({ button: 0, preventDefault() {} } as unknown as Event);
    expect(t.target.requests).toBe(1);
  });

  it("swallows a rejected lock request", async () => {
    const t = make();
    t.target.rejectNext = true;
    t.tgtL.get("mousedown")?.({ button: 0, preventDefault() {} } as unknown as Event);
    await Promise.resolve();
    expect(t.target.requests).toBe(1);
  });

  it.each([
    ["win", "blur"],
    ["win", "pagehide"],
    ["win", "beforeunload"],
    ["doc", "freeze"],
  ] as const)("releases the lock on %s %s", (where, type) => {
    const t = make();
    t.lock();
    (where === "win" ? t.winL : t.docL).get(type)?.({} as Event);
    expect(t.doc.exits).toBe(1);
    expect(t.dom.locked).toBe(false);
  });

  it("releases the lock when the tab becomes hidden and on detach", () => {
    const t = make();
    t.lock();
    t.doc.hidden = true;
    t.docL.get("visibilitychange")?.({} as Event);
    expect(t.doc.exits).toBe(1);
    t.doc.hidden = false;
    t.lock();
    t.dom.detach();
    expect(t.doc.exits).toBe(2);
  });
});
