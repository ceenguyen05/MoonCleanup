# M1 sign-in / host / join UI (re-scope: already built, invite-link entry added) — ui-ux-motion-designer

Task: sign-in, create/join room, room-code menu screen / status: in-review (code done; DPR screenshots and live-browser keyboard test NOT run) / 2026-11-15 / Sonnet 5.5

## Finding: STATUS line 76 is stale
The sign-in and join UI already exists and is already wired. It is not the intents design in the brief:
- `apps/client/src/ui/online/**` (report `M1-online-lobby-ui-ui-ux-motion-designer.md`): "Play online" launcher, lazy panel (account status, Solo vs Private Shift, start with name, join by invite code or Contract id, one-time recovery code, created view with invite + Copy, on-shift view with Leave), connection chip, error mapping (409/503/401/429/404/offline/stalled), close-code reasons.
- `apps/client/src/app/boot.ts` (lines ~306-350, 424) already builds `onlinePort: OnlineEntryPort` (shared `loadGuestAuth`, `netModule.wakeForOnline()`, `onlineHooks.open/close`) and passes `online: onlinePort` to `UiModule`. `createOnlineDevHooks` is created for every build, so the panel works in production. The launcher only wakes the server on click, and solo makes no request.

I did not rebuild it as intents. A second sign-in path would duplicate working code. The existing `OnlineEntryPort` (`auth()`, `open(contractId, token)`, `close()`) carries the same four verbs (sign-in, host, join, leave), and the UI runs the REST calls (guest auth, `POST /v1/contracts`, join-code) itself in a lazy chunk. The app has to wire nothing more for sign-in, host, join and leave.

## Done this pass (spec gap FL-3, invite links, `ui-screens-and-flows.md` §3 "Invite links")
- `parseInviteLink(search, pathname)` in `ui/online/online-model.ts`. It reads `/join/<code>` or `?join=<code>`, canonicalises (case, spaces, dashes, I/L/O look-alikes) and returns `null` for missing, malformed or hostile input (bad percent-encoding, markup).
- `UiModule` parses the link once at init and only when `options.online` exists. It passes `invite` through `UiRoot` to `OnlineEntry`.
- With an invite pending and no room open, the launcher reads "Join shift" (`data-invite="pending"`, hint text) and the panel opens straight on the join form with the code pre-filled as `7QXK 2M9T`. Nothing is redeemed, signed in or woken until the player clicks Join, which matches FL-3. When a room opens the chip replaces the launcher and the invite is ignored.
- `initialPanelState(active, hasInvite)` and the `STRINGS.online.inviteLauncher` / `inviteHint` strings.
- Solo cost: none. One string parse at init, a null prop otherwise, and no new imports.

## Wiring brief for the app/** integrator
Nothing is required. Optional checks:
1. `vercel.json` rewrites `/join/<code>` to `/index.html` already. Confirm `index.html` asset URLs are absolute (`/assets/...`, `/_app/...`), or a deep link at `/join/CODE` will 404 its bundle. `?join=CODE` works regardless.
2. Copy link: the panel copies the bare code. If you want a link, tell me the game origin source. I can emit `${origin}/join/${code}` from `window.location.origin` with no wiring.
3. Dev sandbox: `src/ui/dev/preview.html?online=preview&join=7QXK2M9T`, with `&fail=busy|capacity|notfound` and `&guest=0` as before.
4. Still dropped online, per the netcode report: `RemoteRoomHost.sendIntent` (purchases and tool select do nothing online) and the mirror dust feed. These are not UI issues.

## Evidence (Node 26.13.1, apps/client)
- `vitest run src/ui`: 9 files, 100 passed (5 new in `online.test.tsx`: link parsing, hostile input, launcher relabel plus pre-filled join form with `port.opened` empty, chip wins once connected, initial view).
- `tsc --noEmit`: exit 0. `eslint src/ui`: clean. `prettier --write src/ui`, then the suite re-run: clean.
- Not run: DPR 1/1.25/1.5/2/3 screenshots, a real-browser keyboard / gamepad pass (the client has no jsdom or browser vitest project; the panel tests are SSR plus pure models), `pnpm verify`.

## Open
- Screenshots via the preview sandbox, and a browser keyboard test for the panel (Tab trap, Escape, focus restore). Needs a browser-mode vitest project (devops) or a manual run.
- Spec screens not built (post-MVP or other owners): SCR-04 Contract list, Roster/kick/ban (SCR-09), the title-screen join banner with the inviter's name (needs server lookup by code before sign-in).

Files: `apps/client/src/ui/online/{online-model.ts,panel-model.ts,OnlineEntry.tsx,OnlinePanel.tsx,online.test.tsx}`, `apps/client/src/ui/{UiRoot.tsx,module.tsx,strings.ts}`.

## Follow-up 2026-11-16: deep-link hosting check and "Copy invite link"

### (1) Deep link `/join/CODE` loads its bundle: verified, no change needed
- `apps/client/vite.config.ts` sets no `base`, so the default `/` applies. `apps/client/dist/index.html` references only absolute URLs (`/assets/index-*.js`, `/assets/*.js` modulepreloads, `/assets/index-*.css`, `/favicon.svg`), and the dev entry is `/src/main.ts`. A document at `/join/7QXK2M9T` therefore resolves every asset from the origin root.
- `vercel.json` rewrites `/((?!_app/|assets/|hub/|.*\..*).*)` to `/index.html`. `/join/7QXK2M9T` has no dot and is not under an excluded prefix, so it is served the SPA shell; `/assets/*` stays static. No change required. (Vite dev/preview serve the SPA fallback for `/join/*` by default.)
- CSP is unaffected (`connect-src` already allows the Render origin; clipboard needs no policy entry).

### (2) Copy invite link
- `ui/online/clipboard.ts` (new): `inviteUrl(origin, code)` returns `<origin>/join/<code>` (trailing slash trimmed); `copyText(text, env)` tries `navigator.clipboard.writeText`, falls back to a hidden textarea plus `execCommand("copy")` (restores focus), never rejects, resolves `false` if both fail. Environment is injectable for tests.
- `OnlinePanel.tsx`: new "Copy invite link" button (Link2 icon, `data-testid="copy-invite-link"`) beside the code and "Copy code" on the created view and the on-shift view. Uses `window.location.origin`. `copied` is now `"code" | "link" | null`, so each button shows its own "Copied" check, and a failed copy shows nothing false. The recovery-code Copy keeps the old behaviour via the same helper (now with the fallback).
- `strings.ts`: `online.created.copyLink = "Copy invite link"`.
- Tests (`online.test.tsx`, 4 new): link building plus round-trip through `parseInviteLink`; on-shift view renders both buttons with a store invite code; async clipboard path; legacy fallback on missing/denied clipboard and false when all paths fail.
- Solo cost: none (lazy online chunk only).
- Evidence (Node 26.13.1, apps/client): `vitest run src/ui` 9 files, 104 passed (4 new); `tsc --noEmit` exit 0; `eslint src/ui` exit 0; `prettier --check src/ui` clean.
- Not run: browser clipboard / keyboard pass and DPR screenshots (the button reuses the existing `.ghost` style, no new CSS). Files: `ui/online/{clipboard.ts,OnlinePanel.tsx,online.test.tsx}`, `ui/strings.ts`.
