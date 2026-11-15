// When the sync may touch the network (netcode.md section 10 and 19.3): only after the first user interaction, never from
// bots, crawlers or automated browsers (unless a test opts in), and not while the browser reports it is offline.
// Browser facts are read through small injectable ports so the controller is testable in Node.

import { shouldProbe } from "../net";

export type Unsubscribe = () => void;

export interface InteractionGate {
  hasInteracted(): boolean;
  /** Marks the first interaction explicitly (Clock In, a button) and notifies listeners once. */
  markInteracted(): void;
  /** Calls `cb` once, at the first interaction (immediately when it already happened). */
  onInteraction(cb: () => void): Unsubscribe;
  /** The browser looks automated (webdriver, bot user agent) and has not opted in: sync stays off. */
  automated(): boolean;
}

export interface Connectivity {
  isOnline(): boolean;
  /** Calls `cb` each time the browser reports it came back online. */
  onOnline(cb: () => void): Unsubscribe;
}

const INTERACTION_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

export interface InteractionGateOptions {
  /** Event target for the interaction listeners (default `window`). */
  readonly target?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /** E2E opt-in (see `shouldProbe`). */
  readonly allowAutomation?: boolean;
  /** Test seam for the user agent / webdriver facts. */
  readonly environment?: { readonly webdriver: boolean; readonly userAgent: string };
}

export function createInteractionGate(options: InteractionGateOptions = {}): InteractionGate {
  const target = options.target ?? (typeof window === "undefined" ? undefined : window);
  const listeners = new Set<() => void>();
  let interacted = false;

  const fire = (): void => {
    if (interacted) return;
    interacted = true;
    detach();
    for (const l of [...listeners]) l();
    listeners.clear();
  };
  const detach = (): void => {
    if (target !== undefined) for (const e of INTERACTION_EVENTS) target.removeEventListener(e, fire);
  };
  if (target !== undefined) for (const e of INTERACTION_EVENTS) target.addEventListener(e, fire, { passive: true });

  const env = options.environment ?? {
    webdriver: typeof navigator !== "undefined" && navigator.webdriver === true,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  };
  const allowed = shouldProbe({
    webdriver: env.webdriver,
    userAgent: env.userAgent,
    prerendering: false,
    hidden: false, // a hidden tab must still flush its last checkpoint
    allowAutomation: options.allowAutomation === true,
  });

  return {
    hasInteracted: () => interacted,
    markInteracted: fire,
    onInteraction(cb) {
      if (interacted) {
        cb();
        return () => {};
      }
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    automated: () => !allowed,
  };
}

export function createConnectivity(): Connectivity {
  return {
    isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
    onOnline(cb) {
      if (typeof window === "undefined") return () => {};
      window.addEventListener("online", cb);
      return () => window.removeEventListener("online", cb);
    },
  };
}
