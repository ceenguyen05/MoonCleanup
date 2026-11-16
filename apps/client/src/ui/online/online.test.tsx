import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EventBus } from "@moon-cleanup/shared";
import { createUiStore } from "../../app/ui-store";
import { UiProvider } from "../ui-context";
import { createContractsApi } from "./contracts-api";
import { runOnlineEntry } from "./online-flow";
import {
  connView,
  failureOfCloseCode,
  failureOfResponse,
  groupCode,
  isOnlineActive,
  parseEntryTarget,
  parseInviteLink,
  spellCode,
  type OnlineAuthPort,
  type OnlineEntryPort,
} from "./online-model";
import { copyText, inviteUrl } from "./clipboard";
import OnlinePanel from "./OnlinePanel";
import { OnlineEntry } from "./OnlineEntry";
import { initialPanelState, panelReducer } from "./panel-model";

const CONTRACT_ID = "01930000-aaaa-7bbb-8ccc-000000000001";

function fakeAuth(over: Partial<OnlineAuthPort> & { signedIn?: boolean } = {}): OnlineAuthPort & { calls: string[] } {
  const calls: string[] = [];
  let signedIn = over.signedIn ?? true;
  return {
    calls,
    get signedIn() {
      return signedIn;
    },
    signIn:
      over.signIn ??
      (() => {
        calls.push("signIn");
        signedIn = true;
        return Promise.resolve(true);
      }),
    getAccessToken:
      over.getAccessToken ??
      ((force) => {
        calls.push(force ? "token!" : "token");
        return Promise.resolve("tok-1");
      }),
    takeRecoveryCode: over.takeRecoveryCode ?? (() => null),
  };
}

function fakePort(
  auth: OnlineAuthPort,
  fetchImpl?: typeof fetch,
): OnlineEntryPort & { opened: [string, string][]; closed: number } {
  const port = {
    httpUrl: "https://api.test",
    auth: () => Promise.resolve(auth),
    open: vi.fn((id: string, token: string) => {
      port.opened.push([id, token]);
      return Promise.resolve();
    }),
    close: vi.fn(() => {
      port.closed += 1;
    }),
    opened: [] as [string, string][],
    closed: 0,
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  };
  return port;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const contractBody = {
  id: CONTRACT_ID,
  name: "Brightside Crew",
  shiftType: "private",
  role: "holder",
  maxPlayers: 6,
  status: "active",
  gridM: 64,
  plotCount: 10,
  shinePolished: 0,
  walletLumens: 0,
  playtimeS: 0,
  lastPlayedAt: null,
  online: 0,
};

describe("entry codes", () => {
  it("accepts invite codes in any case with spaces, dashes and Crockford look-alikes", () => {
    expect(parseEntryTarget("7qxk 2m9t")).toEqual({ kind: "code", code: "7QXK2M9T" });
    expect(parseEntryTarget(" 7QXK-2M9T ")).toEqual({ kind: "code", code: "7QXK2M9T" });
    expect(parseEntryTarget("OILQXK2M")).toEqual({ kind: "code", code: "011QXK2M" });
  });
  it("accepts a Contract id and rejects the rest", () => {
    expect(parseEntryTarget(CONTRACT_ID.toUpperCase())).toEqual({ kind: "contract", id: CONTRACT_ID });
    expect(parseEntryTarget("   ")).toEqual({ kind: "invalid", reason: "empty" });
    expect(parseEntryTarget("7QXK2M9")).toEqual({ kind: "invalid", reason: "malformed" });
    expect(parseEntryTarget("7QXK2M9U")).toEqual({ kind: "invalid", reason: "malformed" });
  });
  it("spells and groups codes", () => {
    expect(spellCode("7QXK2M9T")).toBe("7 Q X K 2 M 9 T");
    expect(groupCode("7QXK2M9T")).toBe("7QXK 2M9T");
  });
});

describe("error mapping", () => {
  it("names 409 CONTRACT_BUSY and 503 distinctly", () => {
    expect(failureOfResponse(409, "CONTRACT_BUSY", null)).toEqual({ key: "busy", retryAfterS: 0 });
    expect(failureOfResponse(409, "ROOM_FULL", null).key).toBe("full");
    expect(failureOfResponse(409, "QUOTA_EXCEEDED", null).key).toBe("quota");
    expect(failureOfResponse(503, "AT_CAPACITY", "12")).toEqual({ key: "atCapacity", retryAfterS: 12 });
    expect(failureOfResponse(503, "RETRY_LATER", null).key).toBe("waking");
    expect(failureOfResponse(503, null, null).key).toBe("atCapacity");
    expect(failureOfResponse(429, null, "7.2").retryAfterS).toBe(8);
    expect(failureOfResponse(404, "NOT_FOUND", null).key).toBe("notFound");
    expect(failureOfResponse(418, null, "junk").key).toBe("unknown");
  });
  it("maps close codes of a lost connection", () => {
    expect(failureOfCloseCode(4105)).toBe("full");
    expect(failureOfCloseCode(4102)).toBe("kicked");
    expect(failureOfCloseCode(1006)).toBeNull();
    expect(failureOfCloseCode(null)).toBeNull();
  });
});

describe("connection indicator", () => {
  it("pairs every state with a distinct shape and a label", () => {
    const shapes = (["asleep", "waking", "connecting", "connected", "lost"] as const).map((c) => connView(c, 40).shape);
    expect(new Set(shapes).size).toBe(4); // waking and connecting share the "dots" shape and read differently by label
    expect(connView("connected", 40).tone).toBe("good");
    expect(connView("connected", 400)).toMatchObject({ tone: "warn", shape: "bars" });
    expect(connView("lost", null).tone).toBe("bad");
    expect(isOnlineActive("asleep")).toBe(false);
    expect(isOnlineActive("lost")).toBe(true);
  });
});

describe("panel reducer", () => {
  it("shows the invite code of a created shift, after the recovery code of a new guest", () => {
    let s = initialPanelState(false);
    expect(s.view).toBe("choose");
    s = panelReducer(s, { type: "go", view: "private" });
    s = panelReducer(s, { type: "busy", stage: "request" });
    expect(s.busy).toBe("request");
    s = panelReducer(s, {
      type: "result",
      result: { ok: true, contractId: CONTRACT_ID, inviteCode: "7QXK2M9T", recoveryCode: "AAAA-BBBB-CCCC-DDDD" },
    });
    expect(s).toMatchObject({ view: "recovery", busy: null, inviteCode: "7QXK2M9T" });
    s = panelReducer(s, { type: "recoveryConfirmed" });
    expect(s).toMatchObject({ view: "created", recoveryCode: null });
  });
  it("keeps the view on failure and returns to the form when the open stalls", () => {
    let s = panelReducer(initialPanelState(false), { type: "go", view: "private" });
    s = panelReducer(s, { type: "result", result: { ok: false, failure: { key: "busy", retryAfterS: 0 } } });
    expect(s).toMatchObject({ view: "private", error: { key: "busy" } });
    s = panelReducer(s, { type: "stalled" });
    expect(s.error?.key).toBe("stalled");
    expect(initialPanelState(true).view).toBe("onShift");
  });
});

describe("online flow", () => {
  it("creates a Private Shift, opens it with the access token and surfaces the recovery code of a new guest", async () => {
    const auth = fakeAuth({ signedIn: false, takeRecoveryCode: () => "AAAA-BBBB-CCCC-DDDD" });
    const fetchMock = vi.fn(() => Promise.resolve(json(200, { contract: contractBody, inviteCode: "7QXK2M9T" })));
    const port = fakePort(auth, fetchMock as unknown as typeof fetch);
    const stages: string[] = [];
    const result = await runOnlineEntry(
      { kind: "create", name: "Brightside Crew" },
      { port, onStage: (s) => stages.push(s) },
    );
    expect(result).toEqual({
      ok: true,
      contractId: CONTRACT_ID,
      inviteCode: "7QXK2M9T",
      recoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    expect(port.opened).toEqual([[CONTRACT_ID, "tok-1"]]);
    expect(stages).toEqual(["signin", "request", "opening"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/contracts");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Brightside Crew", shiftType: "private" });
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer tok-1");
  });

  it("joins by invite code, normalising what was pasted", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(200, { contract: contractBody })));
    const port = fakePort(fakeAuth(), fetchMock as unknown as typeof fetch);
    const result = await runOnlineEntry({ kind: "join", raw: " 7qxk-2m9t " }, { port });
    expect(result).toMatchObject({ ok: true, contractId: CONTRACT_ID, inviteCode: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/contracts/join-code");
    expect(JSON.parse(init.body as string)).toEqual({ code: "7QXK2M9T" });
  });

  it("opens a Contract id directly, with no accounts call", async () => {
    const fetchMock = vi.fn();
    const port = fakePort(fakeAuth(), fetchMock as unknown as typeof fetch);
    const result = await runOnlineEntry({ kind: "join", raw: CONTRACT_ID }, { port });
    expect(result.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(port.opened).toEqual([[CONTRACT_ID, "tok-1"]]);
  });

  it("reports 409 CONTRACT_BUSY and 503 with retry-after without opening a room", async () => {
    for (const [res, key, retry] of [
      [json(409, { error: "CONTRACT_BUSY" }), "busy", 0],
      [json(503, { error: "AT_CAPACITY" }, { "retry-after": "20" }), "atCapacity", 20],
      [json(404, { error: "NOT_FOUND" }), "notFound", 0],
    ] as const) {
      const port = fakePort(fakeAuth(), (() => Promise.resolve(res.clone())) as typeof fetch);
      const result = await runOnlineEntry({ kind: "join", raw: "7QXK2M9T" }, { port });
      expect(result).toEqual({ ok: false, failure: { key, retryAfterS: retry } });
      expect(port.opened).toHaveLength(0);
    }
  });

  it("retries once with a refreshed token on 401, then reports unauthorized", async () => {
    const auth = fakeAuth();
    const fetchMock = vi.fn(() => Promise.resolve(json(401, { error: "UNAUTHORIZED" })));
    const result = await createContractsApi({
      httpUrl: "https://api.test/",
      auth,
      fetch: fetchMock as unknown as typeof fetch,
    }).joinByCode("7QXK2M9T");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.calls).toEqual(["token", "token!"]);
    expect(result).toEqual({ ok: false, failure: { key: "unauthorized", retryAfterS: 0 } });
  });

  it("reports an unreachable server, a failed sign-in and malformed input", async () => {
    const offline = fakePort(fakeAuth(), (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch);
    expect(await runOnlineEntry({ kind: "join", raw: "7QXK2M9T" }, { port: offline })).toMatchObject({
      ok: false,
      failure: { key: "offline" },
    });
    const signIn = fakePort(fakeAuth({ signedIn: false, signIn: () => Promise.resolve(false) }));
    expect(await runOnlineEntry({ kind: "create", name: "Brightside Crew" }, { port: signIn })).toMatchObject({
      ok: false,
      failure: { key: "signInFailed" },
    });
    const bad = fakePort(fakeAuth());
    expect(await runOnlineEntry({ kind: "join", raw: "nope" }, { port: bad })).toMatchObject({
      failure: { key: "badCode" },
    });
    expect(bad.opened).toHaveLength(0);
  });
});

function renderWith(node: React.ReactElement, prepare?: (store: ReturnType<typeof createUiStore>) => void): string {
  const store = createUiStore();
  prepare?.(store);
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
      {node}
    </UiProvider>,
  );
}

describe("store-driven rendering", () => {
  const port = fakePort(fakeAuth());
  it("offers the launcher while no online room is open", () => {
    const html = renderWith(<OnlineEntry port={port} />);
    expect(html).toContain('data-testid="online-launcher"');
    expect(html).not.toContain("online-chip");
  });
  it("shows the connection chip with a label, rtt and a non-colour shape once a room is opening or open", () => {
    const connected = renderWith(<OnlineEntry port={port} />, (s) =>
      s.dispatch({ type: "session.set", patch: { conn: "connected", rttMs: 42, closeCode: null } }),
    );
    expect(connected).toContain('data-conn="connected"');
    expect(connected).toContain("Connected");
    expect(connected).toContain("42 ms");
    expect(connected).toContain("<svg");
    const lost = renderWith(<OnlineEntry port={port} />, (s) =>
      s.dispatch({ type: "session.set", patch: { conn: "lost", rttMs: null, closeCode: 4105 } }),
    );
    expect(lost).toContain("Signal lost");
    expect(lost).toContain("That Private Shift is full");
  });
  it("opens on the Solo / Private Shift choice with the account status", () => {
    const html = renderWith(<OnlinePanel port={port} onClose={() => undefined} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Solo Shift");
    expect(html).toContain("Private Shift");
    expect(html).toContain('data-testid="online-account"');
  });
  it("opens an already-connected shift on the on-shift view with Leave", () => {
    const html = renderWith(<OnlinePanel port={port} onClose={() => undefined} />, (s) =>
      s.dispatch({ type: "session.set", patch: { conn: "connected", rttMs: 30, closeCode: null } }),
    );
    expect(html).toContain('data-view="onShift"');
    expect(html).toContain("Leave shift");
  });
});

describe("invite links", () => {
  it("reads /join/<code> and ?join=<code>, normalising look-alikes and separators", () => {
    expect(parseInviteLink("", "/join/7qxk2m9t")).toBe("7QXK2M9T");
    expect(parseInviteLink("", "/join/7QXK-2M9T/")).toBe("7QXK2M9T");
    expect(parseInviteLink("?join=7QXK%202M9T", "/")).toBe("7QXK2M9T");
    expect(parseInviteLink("?play=1&join=7QXK2M9T", "/index.html")).toBe("7QXK2M9T");
  });
  it("falls back to ?join= when the /join/<x> path code is invalid", () => {
    expect(parseInviteLink("?join=7QXK2M9T", "/join/nope")).toBe("7QXK2M9T");
    expect(parseInviteLink("?join=7QXK2M9T", "/join/%E0%A4%A")).toBe("7QXK2M9T");
    // A valid path code wins over the query.
    expect(parseInviteLink("?join=AAAAAAAA", "/join/7QXK2M9T")).toBe("7QXK2M9T");
    expect(parseInviteLink("?join=nope", "/join/nope")).toBeNull();
  });
  it("ignores missing, malformed and hostile values", () => {
    expect(parseInviteLink("", "/")).toBeNull();
    expect(parseInviteLink("?join=", "/")).toBeNull();
    expect(parseInviteLink("?join=nope", "/")).toBeNull();
    expect(parseInviteLink("", "/join/%E0%A4%A")).toBeNull();
    expect(parseInviteLink("", "/join/<script>")).toBeNull();
  });
  it("relabels the launcher and opens the join form pre-filled, without redeeming anything", () => {
    const port = fakePort(fakeAuth());
    const entry = renderWith(<OnlineEntry port={port} invite="7QXK2M9T" />);
    expect(entry).toContain('data-invite="pending"');
    expect(entry).toContain("Join shift");
    const panel = renderWith(<OnlinePanel port={port} onClose={() => undefined} initialInvite="7QXK2M9T" />);
    expect(panel).toContain('data-view="private"');
    expect(panel).toContain('value="7QXK 2M9T"');
    expect(port.opened).toHaveLength(0);
  });
  it("shows the connection chip, not the invite launcher, once a room is open", () => {
    const port = fakePort(fakeAuth());
    const html = renderWith(<OnlineEntry port={port} invite="7QXK2M9T" />, (s) =>
      s.dispatch({ type: "session.set", patch: { conn: "connected", rttMs: 30, closeCode: null } }),
    );
    expect(html).toContain("online-chip");
    expect(html).not.toContain("data-invite");
  });
  it("starts on the Solo / Private choice with no invite", () => {
    expect(initialPanelState(false).view).toBe("choose");
    expect(initialPanelState(false, true).view).toBe("private");
    expect(initialPanelState(true, true).view).toBe("onShift");
  });
});

describe("solo cost", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const read = (name: string): string => readFileSync(`${dir}${name}`, "utf8");
  const sources = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.tsx"));

  it("keeps the panel, flow and HTTP client out of the main chunk (lazy import only)", () => {
    const entry = read("OnlineEntry.tsx");
    expect(entry).toContain('import("./OnlinePanel")');
    expect(entry).not.toMatch(/^import .*["']\.\/(OnlinePanel|online-flow|contracts-api)["']/m);
    expect(read("online-model.ts")).not.toMatch(/from "\.\/(OnlinePanel|online-flow|contracts-api)"/);
  });
  it("never imports net, online-room, three.js or the sim", () => {
    for (const file of sources) {
      expect(read(file), file).not.toMatch(
        /from ["'][^"']*(\/net|online-room|three|sim-host|\/gameplay|\/visuals)["']/,
      );
    }
  });
});

describe("copy invite link", () => {
  it("builds the full link from the origin and the canonical code", () => {
    expect(inviteUrl("https://play.example.com", "7QXK2M9T")).toBe("https://play.example.com/join/7QXK2M9T");
    expect(inviteUrl("http://localhost:5173/", "7QXK2M9T")).toBe("http://localhost:5173/join/7QXK2M9T");
    // the link parses back to the same code
    expect(parseInviteLink("", new URL(inviteUrl("https://x.test", "7QXK2M9T")).pathname)).toBe("7QXK2M9T");
  });
  it("offers Copy invite link beside the code on the on-shift view", () => {
    const html = renderWith(<OnlinePanel port={fakePort(fakeAuth())} onClose={() => undefined} />, (s) => {
      s.dispatch({ type: "session.set", patch: { conn: "connected", rttMs: 30, closeCode: null } });
      s.dispatch({ type: "shift.set", patch: { inviteCode: "7QXK2M9T" } });
    });
    expect(html).toContain("7QXK 2M9T");
    expect(html).toContain('data-testid="copy-invite-link"');
    expect(html).toContain("Copy invite link");
    expect(html).toContain("Copy code");
  });
  it("uses the async clipboard when it works", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const legacyCopy = vi.fn(() => true);
    expect(await copyText("hello", { clipboard: { writeText }, legacyCopy })).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(legacyCopy).not.toHaveBeenCalled();
  });
  it("falls back to the legacy copy when the clipboard is missing or denied, and reports failure otherwise", async () => {
    const legacyCopy = vi.fn(() => true);
    expect(await copyText("a", { legacyCopy })).toBe(true);
    const denied = { writeText: () => Promise.reject(new Error("denied")) };
    expect(await copyText("b", { clipboard: denied, legacyCopy })).toBe(true);
    expect(legacyCopy).toHaveBeenCalledTimes(2);
    expect(await copyText("c", { clipboard: denied, legacyCopy: () => false })).toBe(false);
    const throwing = (): boolean => {
      throw new Error("x");
    };
    expect(await copyText("d", { legacyCopy: throwing })).toBe(false);
    expect(await copyText("e", {})).toBe(false);
  });
});
