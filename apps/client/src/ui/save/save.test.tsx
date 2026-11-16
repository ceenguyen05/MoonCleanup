import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EventBus, SoloCheckpointSummary, UiAction, UiSaveSyncRequest } from "@moon-cleanup/shared";
import { createUiStore } from "../../app/ui-store";
import { SettingsPanel } from "../menus/SettingsPanel";
import { createUiPrefsStore, UiPrefsContext } from "../menus/ui-local";
import { UiProvider } from "../ui-context";
import {
  errorText,
  formatAge,
  formatPlaytime,
  hasConflict,
  hasMoreBelow,
  indicatorView,
  newerSide,
  promptVisible,
  shineText,
  summaryRows,
  wrapTab,
} from "./save-sync-model";
import { SaveConflictPrompt } from "./SaveConflictPrompt";
import { SyncIndicator } from "./SyncIndicator";

const NOW = Date.parse("2026-11-16T15:00:00.000Z");
const summary = (over: Partial<SoloCheckpointSummary> = {}): SoloCheckpointSummary => ({
  generation: 7,
  parentGeneration: 6,
  originKind: "checkpoint" as SoloCheckpointSummary["originKind"],
  savedAt: new Date(NOW - 4 * 60_000).toISOString(),
  simTick: 0,
  playtimeS: 11_460,
  shinePolished: 7_000,
  walletLumens: 12_480,
  saveFormatVersion: 1,
  gameDataVersion: "t",
  deviceLabel: "Windows PC",
  ...over,
});
const LOCAL = summary();
const SERVER = summary({
  savedAt: new Date(NOW - 190 * 60_000).toISOString(),
  playtimeS: 9_240,
  shinePolished: 5_300,
  walletLumens: 9_870,
  deviceLabel: "Android",
});

const CONFLICT: readonly UiAction[] = [
  { type: "shine.set", patch: { total: 163_842 } },
  { type: "saveSync.set", patch: { state: "conflict", conflict: { local: LOCAL, server: SERVER } } },
];

function render(
  actions: readonly UiAction[],
  node: "prompt" | "indicator" | "settings",
  prefs = createUiPrefsStore(),
): string {
  const store = createUiStore();
  for (const action of actions) store.dispatch(action);
  store.flush(1000);
  const win = {
    matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  };
  const body: ReactElement =
    node === "prompt" ? <SaveConflictPrompt /> : node === "indicator" ? <SyncIndicator /> : <SettingsPanel />;
  return renderToStaticMarkup(
    <UiProvider
      store={store}
      events={{} as EventBus}
      host={{} as HTMLElement}
      win={win as unknown as Window}
      motion="full"
      glass="auto"
    >
      <UiPrefsContext.Provider value={prefs}>{body}</UiPrefsContext.Provider>
    </UiProvider>,
  );
}

describe("sync indicator model", () => {
  it("gives every state its own glyph and only conflict / error ask for attention", () => {
    const states = ["local_only", "synced", "pending", "uploading", "offline", "conflict", "error"] as const;
    const views = states.map((state) => indicatorView(state));
    // pending and uploading deliberately share the upload arrow; every other state has a distinct shape.
    expect(new Set(views.map((v) => v.glyph)).size).toBe(states.length - 1);
    expect(views.filter((v) => v.tone === "attention").map((v) => v.state)).toEqual(["conflict", "error"]);
    expect(indicatorView("offline").tone).toBe("quiet");
    expect(indicatorView("offline").text).toMatch(/safe on this device/);
  });
  it("reads ages and playtime in whole units", () => {
    expect(formatAge(NOW - 20_000, NOW)).toBe("just now");
    expect(formatAge(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
    expect(formatAge(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
    expect(formatAge(NOW - 5 * 86_400_000, NOW)).toBe("5 d ago");
    expect(formatAge(NOW + 60_000, NOW)).toBe("just now");
    expect(formatPlaytime(11_460)).toBe("3 h 11 min");
    expect(formatPlaytime(90)).toBe("1 min");
    expect(formatPlaytime(12)).toBe("12 s");
  });
  it("shows Shine as a percent when the plot total is known, else as a plot count", () => {
    expect(shineText(7_000, 163_842)).toBe("4.27%");
    expect(shineText(7_000, 0)).toBe("7,000 plots polished");
  });
  it("lists the five rows and tags the newer copy as information only", () => {
    const rows = summaryRows(LOCAL, NOW, 163_842);
    expect(rows.map((r) => r.id)).toEqual(["savedAt", "device", "playtime", "shine", "wallet"]);
    expect(rows.find((r) => r.id === "device")?.value).toBe("Windows PC");
    expect(rows.find((r) => r.id === "wallet")?.value).toBe("12,480 LM");
    expect(rows[0]?.value).toContain("4 min ago");
    expect(summaryRows(summary({ deviceLabel: undefined }), NOW, 0)[1]?.value).toBe("Unknown device");
    expect(newerSide(LOCAL, SERVER)).toBe("local");
    expect(newerSide(SERVER, LOCAL)).toBe("server");
    expect(newerSide(LOCAL, summary())).toBeNull();
  });
  it("shows the prompt only for a real conflict that was not postponed", () => {
    const store = createUiStore();
    for (const a of CONFLICT) store.dispatch(a);
    store.flush(1);
    const save = store.getState().saveSync;
    expect(hasConflict(save)).toBe(true);
    expect(promptVisible(save, false)).toBe(true);
    expect(promptVisible(save, true)).toBe(false);
    expect(promptVisible({ ...save, state: "offline" }, false)).toBe(false);
    expect(promptVisible({ ...save, conflict: null }, false)).toBe(false);
    expect(errorText({ ...save, error: { kind: "offline", reason: null } })).toBe("The server could not be reached.");
  });
  it("wraps Tab inside the dialog and leaves in-between moves to the browser", () => {
    expect(wrapTab(3, 2, false)).toBe(0);
    expect(wrapTab(3, 0, true)).toBe(2);
    expect(wrapTab(3, -1, true)).toBe(2); // from the heading, Shift+Tab goes to the last control
    expect(wrapTab(3, 1, false)).toBeNull();
    expect(wrapTab(3, 1, true)).toBeNull();
    expect(wrapTab(0, -1, false)).toBeNull();
  });
});

describe('"Which copy?" prompt render', () => {
  it("is a labelled modal dialog with both copies and the five facts of each", () => {
    const html = render(CONFLICT, "prompt");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Which copy?");
    expect(html).toContain('data-testid="save-copy-local"');
    expect(html).toContain('data-testid="save-copy-server"');
    for (const fact of [
      "Windows PC",
      "Android",
      "3 h 11 min",
      "2 h 34 min",
      "12,480 LM",
      "9,870 LM",
      "4.27%",
      "3.23%",
    ]) {
      expect(html).toContain(fact);
    }
    expect(html).toContain("Keep this device");
    expect(html).toContain("Use the server copy");
  });
  it("has no default choice: heading first, then the two choices, then Decide later; nothing preselected", () => {
    const html = render(CONFLICT, "prompt");
    const order = [
      "<h2",
      'data-testid="save-choose-keep_local"',
      'data-testid="save-choose-use_server"',
      'data-testid="save-decide-later"',
    ];
    const at = order.map((needle) => html.indexOf(needle));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).not.toMatch(/autofocus|data-chosen|aria-pressed|aria-checked|recommended/i);
    expect(html).toContain("kept as a backup for 7 days");
  });
  it("carries a decorative, hidden-until-needed scroll cue", () => {
    const html = render(CONFLICT, "prompt");
    expect(html).toMatch(/data-testid="save-prompt-more"/);
    expect(html).toContain("Scroll for more");
    expect(html).not.toMatch(/data-visible/); // nothing to scroll on first render
    expect(html).toMatch(/aria-hidden="true"[^>]*data-testid="save-prompt-more"/);
  });
  it("renders nothing without a conflict, after Decide later, or while offline", () => {
    expect(render([], "prompt")).toBe("");
    expect(render(CONFLICT, "prompt", createUiPrefsStore({ savePromptDismissed: true }))).toBe("");
    expect(render([{ type: "saveSync.set", patch: { state: "offline" } }], "prompt")).toBe("");
  });
});

describe("sync indicator render", () => {
  it("shows a quiet, non-live chip while offline and a live attention chip on a conflict", () => {
    const offline = render([{ type: "saveSync.set", patch: { state: "offline" } }], "indicator");
    expect(offline).toContain("Offline, saved here");
    expect(offline).toContain('aria-live="off"');
    expect(offline).not.toContain("attention");
    const conflict = render(CONFLICT, "indicator");
    expect(conflict).toContain("Choose a copy");
    expect(conflict).toContain('aria-live="polite"');
  });
  it("points at Settings once the prompt was postponed", () => {
    const html = render(CONFLICT, "indicator", createUiPrefsStore({ savePromptDismissed: true }));
    expect(html).toContain("Choose a copy in Settings");
  });
  it("is display only: no button, no tab stop", () => {
    expect(render(CONFLICT, "indicator")).not.toMatch(/<button|tabindex/);
  });
});

describe("Settings save section", () => {
  it("shows status, last sync age and the empty backup note without a Restore button", () => {
    const html = render(
      [{ type: "saveSync.set", patch: { state: "synced", lastSyncedAtMs: Date.now() - 120_000 } }],
      "settings",
    );
    expect(html).toContain('data-testid="settings-save"');
    expect(html).toContain("Saved on this device and in the cloud.");
    expect(html).toMatch(/Last synced (2 min ago|just now|1 min ago)/);
    expect(html).toContain("No backup right now");
    expect(html).not.toContain('data-testid="settings-save-restore"');
    expect(html).not.toContain('data-testid="settings-save-reopen"');
  });
  it("offers Restore backup (two-step) only while a backup exists, with its expiry", () => {
    const html = render(
      [{ type: "saveSync.set", patch: { backupAvailable: true, backupExpiresAtMs: Date.now() + 6 * 86_400_000 } }],
      "settings",
    );
    expect(html).toContain('data-testid="settings-save-restore"');
    expect(html).toContain("is kept until");
    expect(html).not.toContain('data-testid="settings-save-confirm"'); // the confirmation opens on click
  });
  it("lets the player reopen a postponed prompt and explains a paused cloud copy", () => {
    const html = render(
      [
        ...CONFLICT,
        { type: "saveSync.set", patch: { error: { kind: "server_error", reason: null }, storageWarning: "quota" } },
      ],
      "settings",
    );
    expect(html).toContain('data-testid="settings-save-reopen"');
    expect(html).toContain("The server had a problem.");
    expect(html).toContain("Browser storage is nearly full");
  });
});

describe("conflict flow through the store", () => {
  /** A stand-in for the net module: handles each request once and clears it (the app's bindSaveSyncRequests does the same). */
  function withConsumer(handled: UiSaveSyncRequest[]) {
    const store = createUiStore();
    store.subscribe(() => {
      const request = store.getState().saveSync.request;
      if (request === null) return;
      handled.push(request);
      store.dispatch({ type: "saveSync.set", patch: { request: null } });
    });
    return store;
  }
  it("rendering the prompt never sends a choice (no default, no timeout)", () => {
    const handled: UiSaveSyncRequest[] = [];
    const store = withConsumer(handled);
    for (const a of CONFLICT) store.dispatch(a);
    store.flush(1000);
    renderToStaticMarkup(
      <UiProvider
        store={store}
        events={{} as EventBus}
        host={{} as HTMLElement}
        win={
          {
            matchMedia: () => ({
              matches: false,
              addEventListener: () => undefined,
              removeEventListener: () => undefined,
            }),
          } as unknown as Window
        }
        motion="full"
        glass="auto"
      >
        <SaveConflictPrompt />
      </UiProvider>,
    );
    store.flush(60_000);
    expect(handled).toEqual([]);
    expect(store.getState().saveSync.state).toBe("conflict");
  });
  it("each explicit choice becomes one request; the resolved state then hides the prompt", () => {
    for (const choice of ["keep_local", "use_server"] as const) {
      const handled: UiSaveSyncRequest[] = [];
      const store = withConsumer(handled);
      for (const a of CONFLICT) store.dispatch(a);
      store.dispatch({ type: "saveSync.resolveConflict", choice });
      store.flush(1000);
      expect(handled).toEqual([{ kind: "resolve_conflict", choice }]);
      store.dispatch({ type: "saveSync.set", patch: { state: "synced", conflict: null, backupAvailable: true } });
      store.flush(2000);
      expect(promptVisible(store.getState().saveSync, false)).toBe(false);
    }
  });
  it("a choice with no conflict, and a restore with no backup, are ignored by the store", () => {
    const handled: UiSaveSyncRequest[] = [];
    const store = withConsumer(handled);
    store.dispatch({ type: "saveSync.resolveConflict", choice: "keep_local" });
    store.dispatch({ type: "saveSync.restoreBackup" });
    store.flush(1000);
    expect(handled).toEqual([]);
    store.dispatch({ type: "saveSync.set", patch: { backupAvailable: true } });
    store.dispatch({ type: "saveSync.restoreBackup" });
    store.flush(2000);
    expect(handled).toEqual([{ kind: "restore_backup" }]);
  });
  it("Decide later is UI-local: the prefs flag flips and nothing reaches the store", () => {
    const prefs = createUiPrefsStore();
    let notified = 0;
    prefs.subscribe(() => (notified += 1));
    prefs.setSavePromptDismissed(true);
    prefs.setSavePromptDismissed(true);
    prefs.setSavePromptDismissed(false);
    expect(notified).toBe(2);
  });
});

describe("scroll cue model", () => {
  it("shows only when scrollable and not at the end", () => {
    expect(hasMoreBelow(0, 300, 300)).toBe(false);
    expect(hasMoreBelow(0, 300, 301)).toBe(false);
    expect(hasMoreBelow(0, 300, 480)).toBe(true);
    expect(hasMoreBelow(100, 300, 480)).toBe(true);
    expect(hasMoreBelow(180, 300, 480)).toBe(false);
    expect(hasMoreBelow(179.5, 300, 480)).toBe(false);
  });
});

describe("press feedback token", () => {
  it("every :active button rule uses the shared 0.97 press token, and the token is 0 ms in reduced motion", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const tokens = readFileSync(`${root}tokens/tokens.css`, "utf8");
    expect(tokens).toMatch(/--mc-press-transform:\s*scale\(0\.97\)/);
    expect(tokens).toMatch(/data-motion="reduced"\][^}]*--mc-dur-press:\s*0ms/);
    for (const rel of [
      "save/SaveConflictPrompt.module.css",
      "online/OnlinePanel.module.css",
      "online/OnlineEntry.module.css",
      "screens/WakingOverlay.module.css",
    ]) {
      const css = readFileSync(`${root}${rel}`, "utf8");
      expect(css, rel).toMatch(/:active[^{]*\{[^}]*transform:\s*var\(--mc-press-transform\)/);
      expect(css, rel).not.toMatch(/translateY\(var\(--mc-px\)\)/);
    }
  });
});

describe("save screens source rules", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const files = readdirSync(dir).filter((name) => /\.(tsx?|css)$/.test(name) && !name.endsWith(".test.tsx"));
  it("import neither three.js nor the sim, draw no transform-scale and add no global listeners", () => {
    expect(files.length).toBeGreaterThan(5);
    for (const name of files) {
      const text = readFileSync(`${dir}${name}`, "utf8");
      expect(text, name).not.toMatch(/from "three|@moon-cleanup\/sim/);
      expect(text, name).not.toMatch(/scale\(/);
      expect(text, name).not.toMatch(/window\.addEventListener|document\.addEventListener/);
    }
  });
});
