// React context of the ui module: the store, the event bus, the host element and the accessibility modes
// (reduced motion, glass). Components read the game only through the typed store (`useUiSelector`) and never import
// three.js or touch sim state.

import type { Transition } from "motion/react";
import { MotionConfig } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import type { EventBus, UiState, UiStore } from "@moon-cleanup/shared";
import { resolveSpring, type SpringName } from "./motion/presets";
import type { GlassMode, MotionMode } from "./ui-options";

export interface UiContextValue {
  readonly store: UiStore;
  readonly events: EventBus;
  readonly host: HTMLElement;
  readonly reducedMotion: boolean;
  readonly glass: GlassMode;
  readonly setGlass: (mode: GlassMode) => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function useUi(): UiContextValue {
  const value = useContext(UiContext);
  if (value === null) throw new Error("ui: component rendered outside <UiProvider>");
  return value;
}

/** Subscribes to one slice of the store. `selector` must return a stable value (a primitive or a state slice). */
export function useUiSelector<T>(selector: (state: UiState) => T): T {
  const { store } = useUi();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

export function useReducedMotion(): boolean {
  return useUi().reducedMotion;
}

/** Spring (or the 120 ms reduced-motion fade) by preset name. */
export function useSpring(name: SpringName): Transition {
  const reduced = useReducedMotion();
  return useMemo(() => resolveSpring(name, reduced), [name, reduced]);
}

function subscribeReducedMotion(win: Window, onChange: () => void): () => void {
  const mql = win.matchMedia("(prefers-reduced-motion: reduce)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export interface UiProviderProps {
  readonly store: UiStore;
  readonly events: EventBus;
  readonly host: HTMLElement;
  readonly win: Window;
  readonly motion: MotionMode;
  readonly glass: GlassMode;
  readonly children: ReactNode;
}

export function UiProvider(props: UiProviderProps): ReactElement {
  const { store, events, host, win, motion } = props;
  const systemReduced = useSyncExternalStore(
    useCallback((onChange: () => void) => subscribeReducedMotion(win, onChange), [win]),
    () => win.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const reducedMotion = motion === "reduced" || (motion === "system" && systemReduced);
  const [glass, setGlass] = useState<GlassMode>(props.glass);

  useEffect(() => {
    host.dataset["motion"] = reducedMotion ? "reduced" : "full";
    host.dataset["glass"] = glass;
  }, [host, reducedMotion, glass]);

  const value = useMemo<UiContextValue>(
    () => ({ store, events, host, reducedMotion, glass, setGlass }),
    [store, events, host, reducedMotion, glass],
  );
  return (
    <UiContext.Provider value={value}>
      <MotionConfig reducedMotion={motion === "system" ? "user" : reducedMotion ? "always" : "never"}>
        {props.children}
      </MotionConfig>
    </UiContext.Provider>
  );
}
