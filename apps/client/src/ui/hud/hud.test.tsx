import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EventBus, UiAction } from "@moon-cleanup/shared";
import { createUiStore } from "../../app/ui-store";
import { STRINGS } from "../strings";
import { UiProvider } from "../ui-context";
import {
  cellFraction,
  dayText,
  floaterOf,
  formatShinePct,
  noticeText,
  percent,
  promptText,
  slotLabel,
  toolName,
} from "./hud-model";
import { Hud } from "./Hud";

function render(actions: readonly UiAction[]): string {
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
      <Hud />
    </UiProvider>,
  );
}

const SEED: readonly UiAction[] = [
  { type: "wallet.set", patch: { lm: 12_480 } },
  { type: "shine.set", patch: { polished: 7_000, total: 163_842, pct: 4.2723 } },
  {
    type: "holster.set",
    patch: {
      slots: [
        { toolId: "tool.desk_duster", owned: true, cellKg: 2, cellCapKg: 4, cellLevel: 0 },
        { toolId: null, owned: false, cellKg: 0, cellCapKg: 0, cellLevel: 0 },
      ],
      active: 0,
      slotCount: 2,
    },
  },
  { type: "nextReq.set", patch: { itemId: "tool.crescent_squeegee", priceLm: 1_500, fundedPct: 40 } },
  {
    type: "suit.set",
    patch: { lampLevel: 1, lampMode: "lamp", hop: { bursts: 1, max: 3, rechargePct: 25 } },
  },
];

describe("hud model", () => {
  it("formats Shine with 4 decimals and clamps", () => {
    expect(formatShinePct(4.2723)).toBe("4.2723%");
    expect(formatShinePct(120)).toBe("100.0000%");
    expect(formatShinePct(Number.NaN)).toBe("0.0000%");
  });
  it("computes Cell fractions safely", () => {
    expect(cellFraction({ cellKg: 1, cellCapKg: 4 })).toBe(0.25);
    expect(cellFraction({ cellKg: 5, cellCapKg: 4 })).toBe(1);
    expect(cellFraction({ cellKg: 1, cellCapKg: 0 })).toBe(0);
    expect(percent(0.456)).toBe(46);
  });
  it("resolves catalog text and refuses raw ids", () => {
    expect(toolName("tool.desk_duster")).toBe("Desk Duster");
    expect(toolName("tool.unknown")).toBeNull();
    expect(promptText("prompt.nope")).toBeNull();
    expect(noticeText({ textId: "notice.plot_polished", params: { plot: "A4" }, count: 2 })).toBe(
      "Plot Polished: A4 x2",
    );
    expect(noticeText({ textId: "notice.nope", params: {}, count: 1 })).toBeNull();
  });
  it("builds wallet floaters and slot labels", () => {
    expect(floaterOf(undefined)).toBeNull();
    expect(floaterOf({ amountLm: 0, source: "sale", actorSlot: null, atMs: 1 })).toBeNull();
    expect(floaterOf({ amountLm: 1250, source: "sale", actorSlot: null, atMs: 1 })).toMatchObject({
      text: "+1,250 LM",
      gain: true,
    });
    expect(floaterOf({ amountLm: -300, source: "purchase", actorSlot: null, atMs: 2 })).toMatchObject({
      text: "-300 LM",
      gain: false,
    });
    const slot = { toolId: "tool.desk_duster", owned: true, cellKg: 2, cellCapKg: 4, cellLevel: 0 as const };
    expect(slotLabel(slot, 0, true)).toBe("Desk Duster, slot 1, 50% of the Cell, in hand");
    expect(slotLabel({ ...slot, toolId: null, owned: false }, 1, false)).toBe("Empty slot, slot 2");
    expect(dayText(true, 12)).toBe("12 min to dusk");
    expect(dayText(false, 3)).toBe("3 min to dawn");
  });
});

describe("store-driven HUD", () => {
  it("renders Lumens, Shine, Holster, suit and Next Requisition from the store", () => {
    const html = render(SEED);
    expect(html).toContain('data-testid="hud"');
    expect(html).toContain("Lumens: 12,480 LM");
    expect(html).toContain("4.2723% Shine, 7,000 of 163,842 plots");
    expect(html).toContain("Desk Duster, slot 1, 50% of the Cell, in hand");
    expect(html).toContain("Empty slot, slot 2");
    expect(html).toContain("Crown Lamp on");
    expect(html).toContain("1 of 3 Hop bursts, recharging 25%");
    expect(html).toContain("Crescent Squeegee");
    expect(html).toContain("40% · 1,500 LM");
  });
  it("hides blocks that have no data and never prints raw catalog ids", () => {
    const html = render([
      {
        type: "interaction.set",
        patch: { prompt: { actionId: "x", labelId: "prompt.unknown", hold: false, holdMs: 0, blockedReasonId: null } },
      },
      {
        type: "notices.push",
        notice: { priority: "progress", textId: "notice.unknown", params: {}, mergeKey: null, actionId: null },
      },
    ]);
    expect(html).not.toContain("hud-next");
    expect(html).not.toContain("hud-holster");
    expect(html).not.toContain("hud-prompt");
    expect(html).not.toContain("prompt.unknown");
    expect(html).not.toContain("notice.unknown");
  });
  it("shows a known prompt and notice", () => {
    const html = render([
      {
        type: "interaction.set",
        patch: { prompt: { actionId: "pour", labelId: "prompt.pour", hold: true, holdMs: 600, blockedReasonId: null } },
      },
      {
        type: "notices.push",
        notice: {
          priority: "progress",
          textId: "notice.requisition_approved",
          params: {},
          mergeKey: null,
          actionId: null,
        },
      },
    ]);
    expect(html).toContain(STRINGS.prompts["prompt.pour"]);
    expect(html).toContain(STRINGS.notices["notice.requisition_approved"]);
  });
});

describe("hud solo cost (source rules)", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const sources = readdirSync(dir)
    .filter((f) => /\.(tsx?|css)$/.test(f) && !f.includes(".test."))
    .map((f) => [f, readFileSync(dir + f, "utf8")] as const);
  it("has no per-frame loop, no three.js, no game or net imports, no global key listeners", () => {
    for (const [name, text] of sources) {
      expect(text, name).not.toMatch(/requestAnimationFrame|setInterval/);
      expect(text, name).not.toMatch(/from ["'](three|@moon-cleanup\/(sim|world))/);
      expect(text, name).not.toMatch(/\.\.\/\.\.\/(net|sim-host|gameplay|render|visuals)/);
      expect(text, name).not.toMatch(/addEventListener\(["']key/);
    }
  });
  it("animates transform and opacity only (no width/height transitions)", () => {
    const css = readFileSync(dir + "Hud.module.css", "utf8");
    expect(css).not.toMatch(/transition:[^;]*\b(width|height|top|left)\b/);
  });
});
