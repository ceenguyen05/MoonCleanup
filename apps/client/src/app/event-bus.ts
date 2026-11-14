// Typed event bus (contract events/catalog v0, "the implementation lives in apps/client/src/app").
// Synchronous, in subscription order. A listener that throws is reported through `onListenerError` and does not stop
// the remaining listeners or the emitter (events are notifications; the error is surfaced, not swallowed).

import type { EventBus, EventBusListener, EventMap, Unsubscribe } from "@moon-cleanup/shared";

export interface EventBusOptions {
  /** Called with the event name and the thrown value when a listener throws. */
  readonly onListenerError: (eventName: string, error: unknown) => void;
}

export function createEventBus(options: EventBusOptions): EventBus {
  // Copy-on-write listener arrays: emit iterates a stable array without allocating, and a listener may
  // subscribe or unsubscribe during dispatch.
  const listeners = new Map<string, readonly EventBusListener<never>[]>();

  const emit: EventBus["emit"] = <K extends keyof EventMap & string>(name: K, payload: EventMap[K]): void => {
    const current = listeners.get(name) as readonly EventBusListener<EventMap[K]>[] | undefined;
    if (current === undefined) return;
    for (const listener of current) {
      try {
        listener(payload);
      } catch (error) {
        options.onListenerError(name, error);
      }
    }
  };

  const on: EventBus["on"] = <K extends keyof EventMap & string>(
    name: K,
    listener: EventBusListener<EventMap[K]>,
  ): Unsubscribe => {
    const stored = listener as EventBusListener<never>;
    listeners.set(name, [...(listeners.get(name) ?? []), stored]);
    return () => {
      const current = listeners.get(name);
      if (current === undefined) return;
      const next = current.filter((candidate) => candidate !== stored);
      if (next.length === 0) listeners.delete(name);
      else listeners.set(name, next);
    };
  };

  return { emit, on };
}
