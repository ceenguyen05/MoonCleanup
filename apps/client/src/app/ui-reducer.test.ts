import {
  INITIAL_UI_STATE,
  PlotIdSchema,
  UI_DOT_HISTORY_MAX,
  UI_DOT_QUEUE_MAX,
  UI_NOTICE_QUEUE_MAX,
  UI_NOTICE_VISIBLE_MAX,
  UI_WALLET_DELTA_RING,
  type NoticePriority,
  type UiAction,
  type UiNoticeInput,
  type UiState,
} from "@moon-cleanup/shared";
import { describe, expect, it } from "vitest";
import { applyUiAction } from "./ui-reducer";
import { createUiStore } from "./ui-store";

function run(actions: readonly UiAction[], from: UiState = INITIAL_UI_STATE, wallMs = 1_000_000): UiState {
  let seq = 0;
  const ctx = { wallMs, nextNoticeId: () => ++seq };
  return actions.reduce((s, a) => applyUiAction(s, a, ctx), from);
}

const notice = (priority: NoticePriority, textId: string, mergeKey: string | null = null): UiNoticeInput => ({
  priority,
  textId,
  params: {},
  mergeKey,
  actionId: null,
});

describe("<slice>.set", () => {
  it("shallow-merges and keeps identity when nothing changes", () => {
    const next = run([{ type: "shine.set", patch: { polished: 5, pct: 0.003 } }]);
    expect(next.shine).toMatchObject({ polished: 5, pct: 0.003, total: 163_842 });
    expect(next.session).toBe(INITIAL_UI_STATE.session);
    const same = run([{ type: "shine.set", patch: { polished: 5 } }], next);
    expect(same).toBe(next);
  });

  it("covers the saveSync slice", () => {
    const next = run([{ type: "saveSync.set", patch: { state: "synced", localGeneration: 4 } }]);
    expect(next.saveSync).toMatchObject({ state: "synced", localGeneration: 4, request: null });
  });
});

describe("wallet.delta", () => {
  const delta = (amountLm: number) =>
    ({ type: "wallet.delta", settle: false, delta: { amountLm, source: "stamp", actorSlot: 0, atMs: 1 } }) as const;
  it("adds Lumens unless settled and rings at the limit, newest last", () => {
    const many = Array.from({ length: UI_WALLET_DELTA_RING + 3 }, (_, i) => delta(i + 1));
    const s = run(many);
    expect(s.wallet.lastDeltas).toHaveLength(UI_WALLET_DELTA_RING);
    expect(s.wallet.lastDeltas.at(-1)?.amountLm).toBe(UI_WALLET_DELTA_RING + 3);
    expect(s.wallet.lm).toBe(((UI_WALLET_DELTA_RING + 3) * (UI_WALLET_DELTA_RING + 4)) / 2);
    const settled = run([{ ...delta(50), settle: true }]);
    expect(settled.wallet.lm).toBe(0);
    expect(settled.wallet.lastDeltas).toHaveLength(1);
  });
});

describe("notices", () => {
  it("assigns ids, keeps at most 3 visible newest first and merges by key", () => {
    let s = run([
      { type: "notices.push", notice: notice("progress", "a") },
      { type: "notices.push", notice: notice("progress", "b") },
      { type: "notices.push", notice: notice("progress", "c") },
      { type: "notices.push", notice: notice("progress", "d") },
    ]);
    expect(s.notices.queue.map((n) => n.textId)).toEqual(["a", "b", "c", "d"]);
    expect(s.notices.visible).toEqual([3, 2, 1]); // d waits; equal priority does not pre-empt
    s = run([{ type: "notices.dismiss", id: 3 }], s);
    expect(s.notices.visible).toEqual([4, 2, 1]); // d promoted to the top
  });

  it("merges the same key in place and bumps count", () => {
    const s = run([
      { type: "notices.push", notice: notice("ambient", "railshot", "railshot") },
      { type: "notices.push", notice: notice("ambient", "railshot", "railshot") },
    ]);
    expect(s.notices.queue).toHaveLength(1);
    expect(s.notices.queue[0]).toMatchObject({ id: 1, count: 2, ttlMs: 3500, createdAtMs: 1_000_000 });
  });

  it("lets a higher priority pre-empt the oldest lower-priority visible toast", () => {
    const s = run([
      { type: "notices.push", notice: notice("ambient", "x") },
      { type: "notices.push", notice: notice("ambient", "y") },
      { type: "notices.push", notice: notice("ambient", "z") },
      { type: "notices.push", notice: { ...notice("action", "roost", "roost-1"), actionId: "resite" } },
    ]);
    expect(s.notices.visible).toHaveLength(UI_NOTICE_VISIBLE_MAX);
    expect(s.notices.visible[0]).toBe(4);
    expect(s.notices.queue.map((n) => n.textId)).toEqual(["y", "z", "roost"]);
    expect(s.notices.queue.some((n) => n.textId === "x")).toBe(false);
    expect(s.notices.queue.find((n) => n.textId === "roost")?.ttlMs).toBe(8000);
  });

  it("caps the queue at 8 dropping ambient first, never the action toast", () => {
    const pushes: UiAction[] = [{ type: "notices.push", notice: notice("action", "keep", "keep") }];
    for (let i = 0; i < UI_NOTICE_QUEUE_MAX + 4; i++) {
      pushes.push({ type: "notices.push", notice: notice("ambient", `amb${i}`) });
    }
    const s = run(pushes);
    expect(s.notices.queue).toHaveLength(UI_NOTICE_QUEUE_MAX);
    expect(s.notices.queue.some((n) => n.textId === "keep")).toBe(true);
    expect(s.notices.visible.every((id) => s.notices.queue.some((n) => n.id === id))).toBe(true);
    expect(run([{ type: "notices.dismiss", id: 9999 }], s)).toBe(s);
  });
});

describe("dot lines", () => {
  const line = (textId: string) => ({ textId, params: {}, durationMs: 1500 });
  it("shows now, queues behind with keep, drops the oldest queued at the cap, advances with dot.next", () => {
    let s = run([{ type: "dot.say", line: line("l0"), keep: false }]);
    expect(s.dot.line?.textId).toBe("l0");
    const queued: UiAction[] = [];
    for (let i = 1; i <= UI_DOT_QUEUE_MAX + 1; i++) queued.push({ type: "dot.say", line: line(`l${i}`), keep: true });
    s = run(queued, s);
    expect(s.dot.queued.map((l) => l.textId)).toEqual(["l2", "l3", "l4"]);
    s = run([{ type: "dot.next" }], s);
    expect(s.dot.line?.textId).toBe("l2");
    expect(s.dot.history.slice(-2)).toEqual(["l0", "l2"]);
    s = run([{ type: "dot.say", line: line("now"), keep: false }], s);
    expect(s.dot.line?.textId).toBe("now");
    expect(s.dot.queued).toHaveLength(2);
    const empty = run([{ type: "dot.next" }, { type: "dot.next" }, { type: "dot.next" }, { type: "dot.next" }], s);
    expect(empty.dot.line).toBeNull();
  });

  it("keeps history at the limit", () => {
    const s = run(
      Array.from(
        { length: UI_DOT_HISTORY_MAX + 5 },
        (_, i) => ({ type: "dot.say", line: line(`h${i}`), keep: false }) as const,
      ),
    );
    expect(s.dot.history).toHaveLength(UI_DOT_HISTORY_MAX);
    expect(s.dot.history.at(-1)).toBe(`h${UI_DOT_HISTORY_MAX + 4}`);
  });
});

describe("menus", () => {
  it("stacks surfaces, goes back, and closes everything", () => {
    let s = run([
      { type: "menus.open", surface: "requisitions_desk", focusReturnId: "desk-btn" },
      { type: "menus.open", surface: "equipment_card", focusReturnId: "ignored" },
    ]);
    expect(s.menus).toMatchObject({ open: "equipment_card", stack: ["requisitions_desk"], focusReturnId: "desk-btn" });
    s = run([{ type: "menus.modal", modal: { id: "confirm", props: {} } }], s);
    expect(s.menus.modal?.id).toBe("confirm");
    s = run([{ type: "menus.back" }], s);
    expect(s.menus).toMatchObject({ open: "requisitions_desk", stack: [], modal: null });
    s = run([{ type: "menus.back" }], s);
    expect(s.menus.open).toBeNull();
    expect(run([{ type: "menus.back" }], s)).toBe(s);
    s = run(
      [
        { type: "menus.open", surface: "handbook" },
        { type: "menus.open", surface: "settings" },
        { type: "menus.closeAll" },
      ],
      s,
    );
    expect(s.menus).toMatchObject({ open: null, stack: [], modal: null });
  });
});

describe("compass.ping and checklist.complete", () => {
  it("replaces a ping by id and prunes expired ones", () => {
    const ping = (id: number, expiresAtMs: number) =>
      ({
        type: "compass.ping",
        ping: { id, slot: 0, kind: "over_here", plotId: PlotIdSchema.parse(7), expiresAtMs },
      }) as const;
    const s = run([ping(1, 1_000_100), ping(2, 999_000), ping(1, 1_000_200), ping(3, 1_000_300)]);
    expect(s.compass.pings.map((p) => p.id).sort()).toEqual([1, 3]);
  });

  it("marks an item done and advances stepIndex to the first open item", () => {
    const item = (id: string, done: boolean) => ({ id, labelId: `t.${id}`, progress: done ? 1 : 0, target: 1, done });
    const base = run([
      { type: "checklist.set", patch: { mode: "induction", items: [item("a", false), item("b", false)] } },
    ]);
    const s = run([{ type: "checklist.complete", itemId: "a" }], base);
    expect(s.checklist.stepIndex).toBe(1);
    expect(s.checklist.items[0]).toMatchObject({ done: true, progress: 1 });
    expect(run([{ type: "checklist.complete", itemId: "a" }], s)).toBe(s);
    expect(run([{ type: "checklist.complete", itemId: "b" }], s).checklist.stepIndex).toBe(2);
  });
});

describe("saveSync requests", () => {
  it("resolveConflict applies only while in conflict, with no default choice", () => {
    expect(run([{ type: "saveSync.resolveConflict", choice: "keep_local" }])).toBe(INITIAL_UI_STATE);
    const s = run([
      { type: "saveSync.set", patch: { state: "conflict" } },
      { type: "saveSync.resolveConflict", choice: "use_server" },
    ]);
    expect(s.saveSync.request).toEqual({ kind: "resolve_conflict", choice: "use_server" });
  });

  it("restoreBackup applies only while a backup exists", () => {
    expect(run([{ type: "saveSync.restoreBackup" }])).toBe(INITIAL_UI_STATE);
    const s = run([{ type: "saveSync.set", patch: { backupAvailable: true } }, { type: "saveSync.restoreBackup" }]);
    expect(s.saveSync.request).toEqual({ kind: "restore_backup" });
    const cleared = run([{ type: "saveSync.set", patch: { request: null } }], s);
    expect(cleared.saveSync.request).toBeNull();
  });
});

describe("store integration", () => {
  it("applies special actions through flush using the injected wall clock and a monotonic notice id", () => {
    const store = createUiStore(15, () => 5_000);
    store.dispatch({ type: "notices.push", notice: notice("progress", "approved") });
    store.dispatch({
      type: "wallet.delta",
      settle: false,
      delta: { amountLm: 12, source: "sale", actorSlot: null, atMs: 1 },
    });
    expect(store.flush(1000)).toBe(true);
    expect(store.getState().notices.queue[0]).toMatchObject({ id: 1, createdAtMs: 5_000 });
    expect(store.getState().wallet.lm).toBe(12);
    store.dispatch({ type: "notices.push", notice: notice("progress", "approved2") });
    store.flush(2000);
    expect(store.getState().notices.queue[1]?.id).toBe(2);
  });
});
