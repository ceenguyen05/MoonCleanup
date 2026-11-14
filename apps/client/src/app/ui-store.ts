// UiStore implementation (contract ui/store v1.1): queued actions applied by `flush`, which the UI adapter module calls
// every frame; the flush itself publishes at most UI_FLUSH_MAX_HZ (module-boundaries.md section 4). The snapshot object
// is replaced only when a flush changed something, so React's `useSyncExternalStore` and the DOM overlay can compare
// by identity. What each action means lives in ./ui-reducer (pure, tested).

import {
  INITIAL_UI_STATE,
  UI_FLUSH_MAX_HZ,
  type UiAction,
  type UiState,
  type UiStore,
  type Unsubscribe,
} from "@moon-cleanup/shared";
import { applyUiAction } from "./ui-reducer";

export interface AppUiStore extends UiStore {
  /** Applies queued actions and notifies subscribers if the state changed, at most `UI_FLUSH_MAX_HZ` times a second. */
  flush(nowMs: number): boolean;
}

export function createUiStore(
  maxHz: number = UI_FLUSH_MAX_HZ,
  /** Wall clock for notice timestamps and ping expiry; injectable for tests. */
  wallClockMs: () => number = Date.now,
): AppUiStore {
  const minIntervalMs = 1000 / maxHz;
  let state: UiState = INITIAL_UI_STATE;
  let lastFlushMs = Number.NEGATIVE_INFINITY;
  let noticeSeq = 0;
  const queue: UiAction[] = [];
  const listeners = new Set<() => void>();
  const nextNoticeId = (): number => ++noticeSeq;

  return {
    getState: () => state,
    subscribe(listener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(action) {
      queue.push(action);
    },
    flush(nowMs) {
      if (queue.length === 0 || nowMs - lastFlushMs < minIntervalMs) return false;
      lastFlushMs = nowMs;
      const before = state;
      const ctx = { wallMs: wallClockMs(), nextNoticeId };
      let next = state;
      for (const action of queue) next = applyUiAction(next, action, ctx);
      queue.length = 0;
      if (next === before) return false;
      state = next;
      for (const listener of [...listeners]) listener();
      return true;
    },
  };
}
