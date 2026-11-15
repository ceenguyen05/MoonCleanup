import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EventBus, UiAction } from "@moon-cleanup/shared";
import { createUiStore } from "../../app/ui-store";
import { CompassStrip } from "../hud/CompassStrip";
import { PlotCard } from "../hud/PlotCard";
import { UiProvider } from "../ui-context";
import { pickNext, type NavRect } from "./focus-nav";
import { MenuHost } from "./MenuHost";
import {
  availableLm,
  compassShiftPx,
  deskRowStatus,
  groupBoard,
  groupDesk,
  nodeRowStatus,
  replacedToolName,
} from "./menu-model";

function render(actions: readonly UiAction[], node: "menus" | "compass" | "plot" = "menus"): string {
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
      {node === "menus" ? <MenuHost /> : node === "compass" ? <CompassStrip /> : <PlotCard />}
    </UiProvider>,
  );
}

const item = (itemId: string, category: "tool" | "gear", priceLm: number, over: object = {}) => ({
  itemId,
  category,
  tier: 1,
  levelOwned: 0,
  levelMax: 1,
  listPriceLm: priceLm,
  priceLm,
  standardIssue: false,
  requires: [] as string[],
  ...over,
});
const DESK: readonly UiAction[] = [
  { type: "wallet.set", patch: { lm: 2_000 } },
  {
    type: "desk.set",
    patch: {
      items: [
        item("tool.crescent_squeegee", "tool", 1_500),
        item("gear.holster_rig", "gear", 2_500),
        item("gear.crown_lamp", "gear", 900, { levelOwned: 1 }),
        item("tool.mystery_unknown", "tool", 5),
      ],
    },
  },
  {
    type: "holster.set",
    patch: {
      slots: [{ toolId: "tool.desk_duster", owned: true, cellKg: 1, cellCapKg: 4, cellLevel: 0 }],
      active: 0,
      slotCount: 1,
    },
  },
  { type: "menus.open", surface: "requisitions_desk" },
];

describe("desk model", () => {
  const holster = {
    slotCount: 1,
    active: 0,
    slots: [{ toolId: "tool.desk_duster", owned: true, cellKg: 0, cellCapKg: 4, cellLevel: 0 as const }],
  };
  it("classifies rows: buy, short, owned, locked, processing", () => {
    expect(deskRowStatus(item("tool.crescent_squeegee", "tool", 1_500), 2_000, false).kind).toBe("buy");
    const short = deskRowStatus(item("gear.holster_rig", "gear", 2_500), 2_000, false);
    expect(short).toMatchObject({ kind: "short", missingLm: 500, text: "Need 500 more LM" });
    expect(deskRowStatus(item("gear.crown_lamp", "gear", 900, { levelOwned: 1 }), 5_000, false).kind).toBe("owned");
    expect(
      deskRowStatus(item("tool.bristle_broom", "tool", 9, { requires: ["tool.crescent_squeegee"] }), 99, false),
    ).toMatchObject({
      kind: "locked",
      text: "Needs Crescent Squeegee",
    });
    expect(deskRowStatus(item("tool.crescent_squeegee", "tool", 1), 99, true).kind).toBe("processing");
  });
  it("subtracts pending spend from what can be spent", () => {
    expect(availableLm({ lm: 1_000, pendingSpendLm: 400 })).toBe(600);
    expect(availableLm({ lm: 100, pendingSpendLm: 400 })).toBe(0);
  });
  it("names the tool a purchase replaces only without a Rig", () => {
    const squeegee = item("tool.crescent_squeegee", "tool", 1_500);
    expect(replacedToolName(squeegee, holster)).toBe("Desk Duster");
    expect(replacedToolName(squeegee, { ...holster, slotCount: 2 })).toBeNull();
    expect(replacedToolName(item("gear.crown_lamp", "gear", 9), holster)).toBeNull();
  });
  it("drops unknown ids instead of showing them", () => {
    const groups = groupDesk([item("tool.mystery_unknown", "tool", 5), item("gear.crown_lamp", "gear", 9)]);
    expect(groups.map((g) => g.category)).toEqual(["gear"]);
    const board = groupBoard([
      {
        nodeId: "node.nope",
        departmentId: "department.storage",
        level: 0,
        max: 1,
        nextCostLm: 1,
        prereqMet: true,
        requires: [],
      },
    ]);
    expect(board).toEqual([]);
  });
  it("classifies board nodes", () => {
    const node = {
      nodeId: "node.scour",
      departmentId: "department.technique",
      level: 0,
      max: 3,
      nextCostLm: 500,
      prereqMet: true,
      requires: [],
    };
    expect(nodeRowStatus(node, 500).kind).toBe("buy");
    expect(nodeRowStatus(node, 100)).toMatchObject({ kind: "short", missingLm: 400 });
    expect(nodeRowStatus({ ...node, prereqMet: false, requires: ["node.broad_strokes"] }, 900)).toMatchObject({
      kind: "locked",
      text: "Needs Broad Strokes",
    });
    expect(nodeRowStatus({ ...node, level: 3, nextCostLm: null }, 900).kind).toBe("maxed");
  });
  it("wraps the compass heading to whole pixels", () => {
    expect(compassShiftPx(0)).toBe(-1080);
    expect(compassShiftPx(360)).toBe(-1080);
    expect(compassShiftPx(-90)).toBe(-(360 + 270) * 3);
    expect(Number.isInteger(compassShiftPx(12.345))).toBe(true);
  });
});

describe("spatial focus navigation", () => {
  // Two rows of two buttons: [0 1] / [2 3]
  const grid: NavRect[] = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 20, y: 0, w: 10, h: 10 },
    { x: 0, y: 20, w: 10, h: 10 },
    { x: 20, y: 20, w: 10, h: 10 },
  ];
  it("moves along rows and columns", () => {
    expect(pickNext(grid, 0, "right")).toBe(1);
    expect(pickNext(grid, 0, "down")).toBe(2);
    expect(pickNext(grid, 3, "left")).toBe(2);
    expect(pickNext(grid, 3, "up")).toBe(1);
  });
  it("stays put at an edge and wraps Tab-style moves", () => {
    expect(pickNext(grid, 0, "up")).toBe(0);
    expect(pickNext(grid, 3, "next")).toBe(0);
    expect(pickNext(grid, 0, "prev")).toBe(3);
  });
  it("starts at the first control when nothing is focused", () => {
    expect(pickNext(grid, -1, "down")).toBe(0);
    expect(pickNext([], -1, "down")).toBe(-1);
  });
});

describe("menus render from the store", () => {
  it("renders nothing while no surface is open", () => {
    expect(render([])).toBe("");
  });
  it("renders the Desk with prices, states and the 1-slot rule; hides unknown ids", () => {
    const html = render(DESK);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Requisitions Desk");
    expect(html).toContain("Holster Rig");
    expect(html).toContain("Crown Lamp");
    expect(html).toContain("Need 500 more LM");
    expect(html).toContain("Replaces Desk Duster in hand");
    expect(html).toContain('data-testid="desk-one-slot"');
    expect(html).not.toContain("mystery");
    expect(html).toContain("Owned");
    expect(html).toContain("Enter: choose");
  });
  it("hides the 1-slot note once the Rig is owned", () => {
    const html = render([...DESK, { type: "holster.set", patch: { slotCount: 2 } }]);
    expect(html).not.toContain('data-testid="desk-one-slot"');
    expect(html).not.toContain("Replaces Desk Duster in hand");
  });
  it("renders gamepad prompt text when the last device is a pad", () => {
    expect(render([...DESK, { type: "input.set", patch: { lastDevice: "xbox" } }])).toContain("A: choose");
  });
  it("renders the Ops Console with department groups and Roost caps", () => {
    const html = render([
      { type: "wallet.set", patch: { lm: 1_000 } },
      {
        type: "board.set",
        patch: {
          nodes: [
            {
              nodeId: "node.densifier",
              departmentId: "department.storage",
              level: 1,
              max: 3,
              nextCostLm: 600,
              prereqMet: true,
              requires: [],
            },
            {
              nodeId: "node.scour",
              departmentId: "department.technique",
              level: 0,
              max: 3,
              nextCostLm: 500,
              prereqMet: false,
              requires: ["node.broad_strokes"],
            },
          ],
          caps: { roost: { used: 1, cap: 3 } },
        },
      },
      { type: "menus.open", surface: "ops_console" },
    ]);
    expect(html).toContain("Ops Console");
    expect(html).toContain("Storage");
    expect(html).toContain("Densifier");
    expect(html).toContain("Needs Broad Strokes");
    expect(html).toContain("Roosts 1 / 3");
    expect(html).toContain("Level 1 of 3");
  });
  it("renders Settings with sliders, radios and the remap entry", () => {
    const html = render([{ type: "menus.open", surface: "settings" }]);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('type="range"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Remap controls");
    expect(html).toContain("Quality preset");
  });
  it("renders the compass strip with fence, outpost and objective cues", () => {
    const html = render(
      [
        {
          type: "compass.set",
          patch: {
            outposts: [{ id: "Boreal", visited: false, accent: "teal" }],
            fenceBearingDeg: 40,
            objectiveMarkerId: "assay_counter",
          },
        },
      ],
      "compass",
    );
    expect(html).toContain("Outpost Boreal");
    expect(html).toContain("Assay Counter");
    expect(html).toContain("data-mc-compass-track");
    expect(html).toContain("Pilot Fence");
  });
  it("renders the Plot Card only while open, state as a word", () => {
    expect(render([], "plot")).not.toContain("hud-plot-card");
    const html = render(
      [
        {
          type: "plotCard.set",
          patch: { open: true, label: "41-207", state: 2, remainingPct: 0.4, terrainId: "terrain.mare" },
        },
      ],
      "plot",
    );
    expect(html).toContain("Plot 41-207");
    expect(html).toContain("Polished");
    expect(html).toContain("Mare");
  });
});

describe("menu source rules", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const hudDir = fileURLToPath(new URL("../hud/", import.meta.url));
  const files = [
    ...readdirSync(dir)
      .filter((f) => /\.(tsx|ts)$/.test(f) && !f.endsWith(".test.tsx"))
      .map((f) => dir + f),
    hudDir + "CompassStrip.tsx",
    hudDir + "PlotCard.tsx",
  ];
  it("has no rAF, interval, window key listeners or three.js", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/requestAnimationFrame|setInterval|addEventListener\(\s*["']key|from "three"/);
    }
  });
  it("keeps player-facing text in strings.ts (no JSX string literals with sentences)", () => {
    for (const file of files.filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/>\s*[A-Z][a-z]+ [a-z]+[^<{]*</);
    }
  });
});
