# M1 online-entry browser check (queue item 7)

Method: headless Chromium (Playwright, no headed browser) against the UI sandbox `src/ui/dev/preview.html?online=preview`
(real UI components, fake HTTP/auth/room port; no network, no Render/Neon, no secrets) on a local Vite dev server at port 5293
(started and stopped by me). For the path form, Playwright routed `/join/<code>?online=preview` to the sandbox HTML so
`location.pathname` was genuinely `/join/<code>`. Script (throwaway): scratchpad `check.mjs`.

| Item | Result | Evidence |
|---|---|---|
| (a) `/join/<code>` prefills invite | PASS | `/join/7qxk2m9t`: launcher reads "Join shift", `data-invite=pending`; opening goes straight to Private view with join field = `7QXK 2M9T`. `?join=ABCD-EFGH` also sets pending. Bad `/join/nope` correctly yields no invite. Shot: assets/online-join-prefill.png |
| (b) space/case tolerant code | PASS | Accepted and joined (view onShift): `7QXK 2M9T`, `  7qxk2m9t   `, `7qxk-2m9t`, trailing NBSP, `7qxk 2m9t \t`. Shot: assets/online-spaced-code-accepted.png |
| (c) reconnect indicator | PASS (sandbox) | `?conn=lost&next=connected&after=3`: chip appears `data-conn=lost`, label "Signal lost"; after 3 s `data-conn=connected`, "Connected". Shots: assets/online-reconnect-lost.png, assets/online-reconnect-recovered.png |

Caveats (honest):
- NOT RUN: the full game boot (`index.html`, WebGPU renderer, real Colyseus room via `net/room-session.ts`). Item (c) proves the UI reacts
  to the store's `conn` state, not that room-session emits `reconnecting` -> `lost` -> `connected` on a real socket drop; that mapping is
  covered only by unit tests (`room-session.test.ts`, `online-loop.integration.test.ts`), not re-verified here.
- Real app wiring of `parseInviteLink` in `ui/module.tsx` is shared code with the sandbox, but production Vercel SPA rewrite for `/join/*`
  was not checked (see vercel.json).
- No defects found; no source edits made. Screenshots are in `docs/agent-reports/assets/`.
- Static read of vercel.json: the catch-all rewrite sends `/join/<code>` to /index.html (looks correct; not tested live).
