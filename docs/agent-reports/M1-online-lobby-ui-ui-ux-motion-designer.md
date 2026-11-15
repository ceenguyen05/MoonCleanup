# M1 online entry UI (lobby / join) — ui-ux-motion-designer

Task: minimal client online entry UI / status: in-review (code done; screenshots NOT captured) / 2026-11-15 / Sonnet 5.5

## Done
- Launcher "Play online" (top-right) while `session.conn === "asleep"`; connection chip (shape + label + rtt, non-colour cue, "slow link" above 180 ms) while a room is opening/open; lost-reason line from close code (full, kicked, banned, idle, duplicate, unavailable, update required).
- Lazy panel (separate chunk, fetched on first open): account status, Solo vs Private Shift, start a Private Shift (name), join by invite code OR Contract id (paste-normalising, Crockford look-alikes), one-time recovery code view, created view with spelled/grouped invite code + Copy, on-shift view (conn, invite from store, Leave).
- Errors: 409 CONTRACT_BUSY, ROOM_FULL, QUOTA_EXCEEDED, 503 AT_CAPACITY / RETRY_LATER (with `retry-after` seconds), 429, 404, 401 (one forced-refresh retry), offline, sign-in failed, stalled open (12 s with store still `asleep`, since `open` never throws).
- A11y: dialog `aria-modal`, Tab trap, Escape closes, focus moved to view heading and restored to opener, `role="alert"` errors, busy via `aria-disabled` (focus never dropped), keydown/keyup stopped so gameplay never sees panel keys. Strings in `ui/strings.ts` (`STRINGS.online`, `formatString`).
- Solo cost: only the launcher button + 3 store selectors in main chunk; no per-frame work; no net/online-room/three imports (test enforced); panel, flow and HTTP client are lazy.

## Wiring (lead, one place in boot.ts; I did not edit app/)
`new UiModule({ store, win, search, online: port })` where `port: OnlineEntryPort` (`ui/online/online-model.ts`):
`{ httpUrl: config.httpUrl, auth: () => import("../net/guest-auth").then(m => m.createGuestAuth({ httpUrl, storage })), open: hooks.open, close: hooks.close }`. `open`/`close` are exactly `createOnlineDevHooks(...)` (mirrors `__mcOnline.open(contractId, accessToken)`); today those hooks are installed only when `perfEnabled`, so boot must create them unconditionally (lazy, no cost) for production. Share one GuestAuth instance with checkpoint sync if possible. Omit `online` to disable the UI. Dev sandbox: `src/ui/dev/preview.html?online=preview[&fail=busy|capacity|notfound][&guest=0]` (fake port).

## Evidence
- `vitest run src/ui` (apps/client): 3 files, 35 tests pass (new `ui/online/online.test.tsx`: codes, error mapping, indicator, reducer, flow incl. 409/503/401/offline, SSR store-driven render, solo-cost source checks; hairline rule test passes).
- `tsc --noEmit` apps/client: clean for ui/; only pre-existing error in `src/animation/avatar-animator.ts` (not mine). `eslint apps/client/src/ui`: clean. Prettier applied.
- No DPR screenshots and no browser keyboard test (client has no jsdom/browser vitest project); vite dev server on 5197 was started for capture then stopped.

## Open
- Screenshots at DPR 1/1.25/1.5/2/3 via the preview sandbox; gamepad focus navigation not specially handled (native buttons, DOM order); panel exit fade omitted (lazy child).
- Launcher position (top-right) may collide with the future HUD; adjust with the HUD owner.

Files: `apps/client/src/ui/online/{online-model,contracts-api,online-flow,panel-model}.ts`, `{OnlineEntry,OnlinePanel,ConnGlyph}.tsx`, `OnlineEntry.module.css`, `OnlinePanel.module.css`, `online.test.tsx`; edited `ui/{UiRoot.tsx,module.tsx,index.ts,strings.ts,dev/preview.ts}`.

Commit suggestion: feat(ui): online entry launcher, Private Shift panel and connection chip
