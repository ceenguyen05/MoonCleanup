import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EventBus, UiAction } from "@moon-cleanup/shared";
import { createUiStore } from "../../app/ui-store";
import { Hud } from "../hud/Hud";
import { UiProvider } from "../ui-context";
import { Handbook } from "./Handbook";
import {
  CHAPTER_IDS,
  dotHoldMs,
  dotLogText,
  dotText,
  inductionView,
  scanUnlocks,
  stepProgressText,
  stepText,
} from "./onboarding-model";

function render(actions: readonly UiAction[], withHud = true): string {
  const store = createUiStore();
  for (const action of actions) store.dispatch(action);
  store.flush(1000);
  const win = {
    matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  };
  return renderToStaticMarkup(
    <UiProvider
      store={store}
      events={{} as EventBus}
      host={{} as HTMLElement}
      win={win as unknown as Window}
      motion="full"
      glass="auto"
    >
      {withHud ? <Hud /> : <Handbook />}
    </UiProvider>,
  );
}

const ids = [
  "first_stroke",
  "fill_cell",
  "pour_at_counter",
  "open_plot_card",
  "polish_apron_plot",
  "buy_crescent_squeegee",
  "buy_dust_cell",
  "find_near_parcel",
];
const item = (id: string, done: boolean, progress = 0, target = 1) => ({
  id: `onboarding.${id}`,
  labelId: `onboarding.${id}`,
  progress,
  target,
  done,
});
const induction = (doneCount: number, hidden = false): UiAction => ({
  type: "checklist.set",
  patch: {
    mode: "induction",
    hidden,
    stepIndex: doneCount,
    items: ids.map((id, k) => item(id, k < doneCount)),
  },
});

describe("onboarding model", () => {
  it("covers all 8 Induction steps with catalog text and refuses unknown ids", () => {
    for (const id of ids) expect(stepText({ id: `onboarding.${id}`, labelId: `onboarding.${id}` })).not.toBeNull();
    expect(stepText({ id: "onboarding.nope", labelId: "onboarding.nope" })).toBeNull();
  });
  it("derives current / next / complete", () => {
    const view = inductionView({ items: ids.map((id, k) => item(id, k < 2)), stepIndex: 2 });
    expect(view).toMatchObject({ total: 8, done: 2, complete: false });
    expect(view.current?.id).toBe("onboarding.pour_at_counter");
    expect(view.next?.id).toBe("onboarding.open_plot_card");
    expect(inductionView({ items: ids.map((id) => item(id, true)), stepIndex: 8 }).complete).toBe(true);
    expect(stepProgressText({ progress: 2, target: 5 })).toBe("2 of 5");
    expect(stepProgressText({ progress: 0, target: 1 })).toBeNull();
  });
  it("resolves DOT text, skips lines with missing params and clamps hold time", () => {
    expect(dotText("dot.tip_handbook", {})).toContain("Handbook");
    expect(dotText("dot.joined", {})).toBeNull();
    expect(dotText("dot.joined", { name: "Ana" })).toContain("Ana");
    expect(dotText("dot.unknown", {})).toBeNull();
    expect(dotLogText("dot.joined")).toContain("…");
    expect(dotHoldMs(10)).toBe(1500);
    expect(dotHoldMs(99_999)).toBe(12_000);
  });
  it("does not replay earlier unlocks and reports only new ones", () => {
    const a = { id: "achievement.first_light", unlockedAtMs: 5, progress01: 1 };
    const b = { id: "achievement.stamped", unlockedAtMs: null, progress01: 0 };
    const first = scanUnlocks(null, [a, b]);
    expect(first.fresh).toEqual([]);
    const second = scanUnlocks(first.known, [a, { ...b, unlockedAtMs: 9 }]);
    expect(second.fresh).toEqual(["achievement.stamped"]);
  });
});

describe("store-driven onboarding UI", () => {
  it("renders the Induction block with the current step and n/8", () => {
    const html = render([induction(2)]);
    expect(html).toContain('data-testid="hud-induction"');
    expect(html).toContain("Pour at the Assay Counter");
    expect(html).toContain("2 of 8 Induction steps done");
    expect(html).toContain("Open the Plot Card");
    expect(html).not.toContain("onboarding.pour_at_counter");
  });
  it("hides the block when hidden or mode is none", () => {
    expect(render([induction(2, true)])).not.toContain("hud-induction");
    expect(render([])).not.toContain("hud-induction");
  });
  it("shows a DOT line as text and nothing for unknown ids", () => {
    const say = (textId: string): UiAction => ({
      type: "dot.say",
      line: { textId, params: {}, durationMs: 4000 },
      keep: true,
    });
    const html = render([say("dot.tip_handbook")]);
    expect(html).toContain("The DOT Handbook is always open");
    expect(render([say("dot.nope")])).not.toContain("dot.nope");
  });
  it("renders the Handbook chapters, the device control line and the toggle", () => {
    const html = render([induction(1)], false);
    for (const id of CHAPTER_IDS) expect(html).toContain(`handbook-chapter-${id}`);
    expect(html).toContain("Getting started");
    expect(html).toContain("Handbook: H");
    expect(html).toContain('role="tablist"');
    expect(html).toContain("handbook-induction-toggle");
    const pad = render([{ type: "input.set", patch: { lastDevice: "xbox" } }], false);
    expect(pad).toContain("left stick");
  });
});
