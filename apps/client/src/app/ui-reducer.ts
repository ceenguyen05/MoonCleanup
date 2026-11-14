// Pure UI-store reducer (contract ui/store v1.1): applies one `UiAction` to a `UiState`. No timers, no DOM, no network.
// `ui-store.ts` owns queueing, the 15 Hz flush and notification; this file owns what each action means.
//
// Identity rule: when an action changes nothing the SAME state object is returned, so the store can tell whether to
// notify (`useSyncExternalStore` compares snapshots by identity). `<slice>.set` merges shallowly; array/object values
// are compared by reference, and writers send whole arrays, so a fresh array always counts as a change.
//
// Limits come from the contract (shared/ui/slices): UI_WALLET_DELTA_RING, UI_NOTICE_*, UI_DOT_*.

import {
  UI_DOT_HISTORY_MAX,
  UI_DOT_QUEUE_MAX,
  UI_NOTICE_QUEUE_MAX,
  UI_NOTICE_TTL_MS,
  UI_NOTICE_VISIBLE_MAX,
  UI_WALLET_DELTA_RING,
  type NoticePriority,
  type UiAction,
  type UiChecklistItem,
  type UiCompassPing,
  type UiDotLine,
  type UiNotice,
  type UiNoticeInput,
  type UiSetAction,
  type UiState,
} from "@moon-cleanup/shared";

/** Environment the reducer needs; the store supplies it so the reducer stays pure and testable. */
export interface UiReduceContext {
  /** Wall-clock milliseconds (`Date.now()` scale): notice creation time, ping expiry comparison. */
  readonly wallMs: number;
  /** Returns the next notice id (monotonic per store). Called only when a notice is actually added. */
  readonly nextNoticeId: () => number;
}

const PRIORITY_RANK: Readonly<Record<NoticePriority, number>> = { action: 0, progress: 1, ambient: 2 };

/** True when merging `patch` into `slice` would change at least one value. */
function patchChanges<S extends object>(slice: S, patch: Partial<S>): boolean {
  for (const key of Object.keys(patch) as (keyof S)[]) {
    if (!Object.is(slice[key], patch[key])) return true;
  }
  return false;
}

/** Applies a `<slice>.set` merge; the switch keeps every slice name statically checked (no casts). */
function applySet(state: UiState, action: UiSetAction): UiState {
  switch (action.type) {
    case "session.set":
      return patchChanges(state.session, action.patch)
        ? { ...state, session: { ...state.session, ...action.patch } }
        : state;
    case "profile.set":
      return patchChanges(state.profile, action.patch)
        ? { ...state, profile: { ...state.profile, ...action.patch } }
        : state;
    case "shift.set":
      return patchChanges(state.shift, action.patch) ? { ...state, shift: { ...state.shift, ...action.patch } } : state;
    case "wallet.set":
      return patchChanges(state.wallet, action.patch)
        ? { ...state, wallet: { ...state.wallet, ...action.patch } }
        : state;
    case "shine.set":
      return patchChanges(state.shine, action.patch) ? { ...state, shine: { ...state.shine, ...action.patch } } : state;
    case "compass.set":
      return patchChanges(state.compass, action.patch)
        ? { ...state, compass: { ...state.compass, ...action.patch } }
        : state;
    case "holster.set":
      return patchChanges(state.holster, action.patch)
        ? { ...state, holster: { ...state.holster, ...action.patch } }
        : state;
    case "suit.set":
      return patchChanges(state.suit, action.patch) ? { ...state, suit: { ...state.suit, ...action.patch } } : state;
    case "vehicle.set":
      return patchChanges(state.vehicle, action.patch)
        ? { ...state, vehicle: { ...state.vehicle, ...action.patch } }
        : state;
    case "checklist.set":
      return patchChanges(state.checklist, action.patch)
        ? { ...state, checklist: { ...state.checklist, ...action.patch } }
        : state;
    case "nextReq.set":
      return patchChanges(state.nextReq, action.patch)
        ? { ...state, nextReq: { ...state.nextReq, ...action.patch } }
        : state;
    case "interaction.set":
      return patchChanges(state.interaction, action.patch)
        ? { ...state, interaction: { ...state.interaction, ...action.patch } }
        : state;
    case "roster.set":
      return patchChanges(state.roster, action.patch)
        ? { ...state, roster: { ...state.roster, ...action.patch } }
        : state;
    case "plotCard.set":
      return patchChanges(state.plotCard, action.patch)
        ? { ...state, plotCard: { ...state.plotCard, ...action.patch } }
        : state;
    case "assay.set":
      return patchChanges(state.assay, action.patch) ? { ...state, assay: { ...state.assay, ...action.patch } } : state;
    case "achievements.set":
      return patchChanges(state.achievements, action.patch)
        ? { ...state, achievements: { ...state.achievements, ...action.patch } }
        : state;
    case "desk.set":
      return patchChanges(state.desk, action.patch) ? { ...state, desk: { ...state.desk, ...action.patch } } : state;
    case "board.set":
      return patchChanges(state.board, action.patch) ? { ...state, board: { ...state.board, ...action.patch } } : state;
    case "motorPool.set":
      return patchChanges(state.motorPool, action.patch)
        ? { ...state, motorPool: { ...state.motorPool, ...action.patch } }
        : state;
    case "equipment.set":
      return patchChanges(state.equipment, action.patch)
        ? { ...state, equipment: { ...state.equipment, ...action.patch } }
        : state;
    case "dot.set":
      return patchChanges(state.dot, action.patch) ? { ...state, dot: { ...state.dot, ...action.patch } } : state;
    case "notices.set":
      return patchChanges(state.notices, action.patch)
        ? { ...state, notices: { ...state.notices, ...action.patch } }
        : state;
    case "menus.set":
      return patchChanges(state.menus, action.patch) ? { ...state, menus: { ...state.menus, ...action.patch } } : state;
    case "settings.set":
      return patchChanges(state.settings, action.patch)
        ? { ...state, settings: { ...state.settings, ...action.patch } }
        : state;
    case "input.set":
      return patchChanges(state.input, action.patch) ? { ...state, input: { ...state.input, ...action.patch } } : state;
    case "saveSync.set":
      return patchChanges(state.saveSync, action.patch)
        ? { ...state, saveSync: { ...state.saveSync, ...action.patch } }
        : state;
  }
}

// ---- notices -------------------------------------------------------------------------------------------------------

/** Drop order on overflow: lowest priority first, waiting before visible, oldest first. P1 goes last (never in practice). */
function dropCandidate(queue: readonly UiNotice[], visible: readonly number[]): number {
  let best = -1;
  let bestKey = -1;
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    if (n === undefined) continue;
    // Higher key = drop sooner. Rank dominates; waiting beats visible; earlier index (older) beats later.
    const key = PRIORITY_RANK[n.priority] * 2 + (visible.includes(n.id) ? 0 : 1);
    if (key > bestKey) {
      bestKey = key;
      best = i;
    }
  }
  return best;
}

/** Fills free visible slots from the waiting notices: highest priority first, oldest first; newest ends on top. */
function promoteWaiting(queue: readonly UiNotice[], visible: readonly number[]): readonly number[] {
  let next = visible;
  while (next.length < UI_NOTICE_VISIBLE_MAX) {
    let pick: UiNotice | undefined;
    for (const n of queue) {
      if (next.includes(n.id)) continue;
      if (pick === undefined || PRIORITY_RANK[n.priority] < PRIORITY_RANK[pick.priority]) pick = n;
    }
    if (pick === undefined) break;
    next = [pick.id, ...next];
  }
  return next;
}

function pushNotice(state: UiState, input: UiNoticeInput, ctx: UiReduceContext): UiState {
  const { queue, visible } = state.notices;
  const ttlMs = input.ttlMs ?? UI_NOTICE_TTL_MS[input.priority];

  if (input.mergeKey !== null) {
    const at = queue.findIndex((n) => n.mergeKey === input.mergeKey);
    const existing = queue[at];
    if (existing !== undefined) {
      const merged: UiNotice = {
        ...existing,
        priority: input.priority,
        textId: input.textId,
        params: input.params,
        actionId: input.actionId,
        count: existing.count + 1,
        createdAtMs: ctx.wallMs,
        ttlMs,
      };
      const nextQueue = queue.map((n, i) => (i === at ? merged : n));
      return { ...state, notices: { queue: nextQueue, visible } };
    }
  }

  const notice: UiNotice = {
    id: ctx.nextNoticeId(),
    priority: input.priority,
    textId: input.textId,
    params: input.params,
    mergeKey: input.mergeKey,
    count: 1,
    actionId: input.actionId,
    createdAtMs: ctx.wallMs,
    ttlMs,
  };
  let nextQueue: readonly UiNotice[] = [...queue, notice];
  let nextVisible: readonly number[] = visible;

  // Visibility (rule 1): free slot -> on top; full -> pre-empt the oldest strictly-lower-priority visible toast.
  if (nextVisible.length < UI_NOTICE_VISIBLE_MAX) {
    nextVisible = [notice.id, ...nextVisible];
  } else {
    let victim: UiNotice | undefined;
    for (const n of queue) {
      if (!visible.includes(n.id)) continue;
      if (victim === undefined || PRIORITY_RANK[n.priority] > PRIORITY_RANK[victim.priority]) victim = n;
    }
    if (victim !== undefined && PRIORITY_RANK[victim.priority] > PRIORITY_RANK[notice.priority]) {
      const gone = victim.id;
      nextQueue = nextQueue.filter((n) => n.id !== gone);
      nextVisible = [notice.id, ...visible.filter((id) => id !== gone)];
    }
  }

  // Queue cap (rule 2).
  while (nextQueue.length > UI_NOTICE_QUEUE_MAX) {
    const drop = dropCandidate(nextQueue, nextVisible);
    const dropped = nextQueue[drop];
    if (dropped === undefined) break;
    nextQueue = nextQueue.filter((n) => n.id !== dropped.id);
    nextVisible = nextVisible.filter((id) => id !== dropped.id);
  }
  return { ...state, notices: { queue: nextQueue, visible: promoteWaiting(nextQueue, nextVisible) } };
}

function dismissNotice(state: UiState, id: number): UiState {
  const { queue, visible } = state.notices;
  if (!queue.some((n) => n.id === id)) return state;
  const nextQueue = queue.filter((n) => n.id !== id);
  const nextVisible = promoteWaiting(
    nextQueue,
    visible.filter((v) => v !== id),
  );
  return { ...state, notices: { queue: nextQueue, visible: nextVisible } };
}

// ---- DOT subtitle lines ---------------------------------------------------------------------------------------------

function withHistory(history: readonly string[], textId: string): readonly string[] {
  const next = [...history, textId];
  return next.length > UI_DOT_HISTORY_MAX ? next.slice(next.length - UI_DOT_HISTORY_MAX) : next;
}

function sayDot(state: UiState, line: UiDotLine, keep: boolean): UiState {
  const dot = state.dot;
  if (dot.line !== null && keep) {
    // Queue behind the current line; at the cap the oldest queued line is dropped (ui-screens 5.2 rule 7).
    const queued = [...dot.queued, line];
    return {
      ...state,
      dot: {
        ...dot,
        queued: queued.length > UI_DOT_QUEUE_MAX ? queued.slice(queued.length - UI_DOT_QUEUE_MAX) : queued,
      },
    };
  }
  return { ...state, dot: { ...dot, line, history: withHistory(dot.history, line.textId) } };
}

function nextDot(state: UiState): UiState {
  const dot = state.dot;
  const [head, ...rest] = dot.queued;
  if (head === undefined) return dot.line === null ? state : { ...state, dot: { ...dot, line: null } };
  return { ...state, dot: { ...dot, line: head, queued: rest, history: withHistory(dot.history, head.textId) } };
}

// ---- the reducer ----------------------------------------------------------------------------------------------------

export function applyUiAction(state: UiState, action: UiAction, ctx: UiReduceContext): UiState {
  switch (action.type) {
    case "wallet.delta": {
      const wallet = state.wallet;
      const lastDeltas = [...wallet.lastDeltas, action.delta];
      return {
        ...state,
        wallet: {
          ...wallet,
          lm: action.settle ? wallet.lm : wallet.lm + action.delta.amountLm,
          lastDeltas:
            lastDeltas.length > UI_WALLET_DELTA_RING
              ? lastDeltas.slice(lastDeltas.length - UI_WALLET_DELTA_RING)
              : lastDeltas,
        },
      };
    }
    case "notices.push":
      return pushNotice(state, action.notice, ctx);
    case "notices.dismiss":
      return dismissNotice(state, action.id);
    case "dot.say":
      return sayDot(state, action.line, action.keep);
    case "dot.next":
      return nextDot(state);
    case "menus.open": {
      const menus = state.menus;
      if (menus.open === action.surface) return state;
      const fromPlay = menus.open === null;
      return {
        ...state,
        menus: {
          open: action.surface,
          stack: fromPlay ? [] : [...menus.stack, menus.open],
          // Focus returns to whatever opened the FIRST surface; deeper opens keep it.
          focusReturnId: fromPlay
            ? (action.focusReturnId ?? null)
            : (menus.focusReturnId ?? action.focusReturnId ?? null),
          modal: null,
        },
      };
    }
    case "menus.back": {
      const menus = state.menus;
      if (menus.open === null) return state;
      const below = menus.stack[menus.stack.length - 1];
      return {
        ...state,
        menus: {
          ...menus,
          open: below ?? null,
          stack: below === undefined ? menus.stack : menus.stack.slice(0, -1),
          modal: null,
        },
      };
    }
    case "menus.closeAll": {
      const menus = state.menus;
      if (menus.open === null && menus.stack.length === 0 && menus.modal === null) return state;
      return { ...state, menus: { ...menus, open: null, stack: [], modal: null } };
    }
    case "menus.modal":
      return Object.is(state.menus.modal, action.modal)
        ? state
        : { ...state, menus: { ...state.menus, modal: action.modal } };
    case "compass.ping": {
      const live = state.compass.pings.filter(
        (p: UiCompassPing) => p.id !== action.ping.id && p.expiresAtMs > ctx.wallMs,
      );
      return { ...state, compass: { ...state.compass, pings: [...live, action.ping] } };
    }
    case "checklist.complete": {
      const checklist = state.checklist;
      if (!checklist.items.some((i) => i.id === action.itemId && !i.done)) return state;
      const items = checklist.items.map((i: UiChecklistItem): UiChecklistItem =>
        i.id === action.itemId ? { ...i, progress: i.target, done: true } : i,
      );
      const firstOpen = items.findIndex((i) => !i.done);
      return { ...state, checklist: { ...checklist, items, stepIndex: firstOpen === -1 ? items.length : firstOpen } };
    }
    case "saveSync.resolveConflict":
      // Rule 4 (save/sync-rules): only valid while the player is actually being asked; otherwise ignored.
      if (state.saveSync.state !== "conflict") return state;
      return {
        ...state,
        saveSync: { ...state.saveSync, request: { kind: "resolve_conflict", choice: action.choice } },
      };
    case "saveSync.restoreBackup":
      if (!state.saveSync.backupAvailable) return state;
      return { ...state, saveSync: { ...state.saveSync, request: { kind: "restore_backup" } } };
    default:
      return applySet(state, action);
  }
}
