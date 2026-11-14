// Notice queue behind the toast stack (HUD-08 "DOT Notice"): at most 3 stacked, newest first, each held for 3.5 s.
// Plain external store (subscribe / getSnapshot) with injectable timers so it is unit-testable without a DOM.

export const TOAST_MAX_VISIBLE = 3;
export const TOAST_HOLD_MS = 3500;

export type ToastTone = "ok" | "info" | "warn";

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly tone: ToastTone;
}

export interface TimerApi {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface ToastQueue {
  push(text: string, tone?: ToastTone): number;
  dismiss(id: number): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly Toast[];
  dispose(): void;
}

export function createToastQueue(timers: TimerApi, holdMs: number = TOAST_HOLD_MS): ToastQueue {
  let toasts: readonly Toast[] = [];
  let nextId = 1;
  const timeouts = new Map<number, number>();
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const dismiss = (id: number): void => {
    const timer = timeouts.get(id);
    if (timer !== undefined) {
      timers.clearTimeout(timer);
      timeouts.delete(id);
    }
    if (!toasts.some((toast) => toast.id === id)) return;
    toasts = toasts.filter((toast) => toast.id !== id);
    emit();
  };

  return {
    push(text, tone = "ok") {
      const id = nextId++;
      toasts = [{ id, text, tone }, ...toasts];
      timeouts.set(
        id,
        timers.setTimeout(() => dismiss(id), holdMs),
      );
      // Over the cap: the oldest notice leaves immediately.
      for (const overflow of toasts.slice(TOAST_MAX_VISIBLE)) dismiss(overflow.id);
      emit();
      return id;
    },
    dismiss,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => toasts,
    dispose() {
      for (const timer of timeouts.values()) timers.clearTimeout(timer);
      timeouts.clear();
      listeners.clear();
      toasts = [];
    },
  };
}
