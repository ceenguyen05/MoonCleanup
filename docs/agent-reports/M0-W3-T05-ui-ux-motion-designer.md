# M0-W3-T05 ui-ux-motion-designer

Task: M0-W3-T05 / status: in-review (implemented; sandbox-verified, not yet wired into boot) / 2026-11-12 / Sonnet 5.5

## Done
- Tokens v0: `ui/tokens/{tokens.css,fonts.css,display-metrics.ts}` (colour, type >= 14 px, 4-pt spacing, radii, elevation, motion tokens; JS-written `--mc-dpr`, `--mc-px` = 1 device px, `--mc-hud-scale`). Deviation: HUD scale floor 1.0 (spec 0.85 would put the 14 px caption at 11.9 px).
- UI root: `ui/module.tsx` `UiModule` (id `ui`, React 19 root over canvas, flush via store, font preload, DPR/zoom watcher, tab-hidden flag), `ui-context.tsx` (`useUiSelector` via `useSyncExternalStore`, reduced-motion + glass modes), `UiRoot.tsx`, barrel `ui/index.ts`, `strings.ts`.
- Components: GlassPanel/DotLight, TickNumber (local count-up, gold flash), ToastStack + queue (max 3), Icon + custom glyphs, motion presets (springs, eases).
- `?scene=hud-test` bench (`ui/hud-test/`): wallet, Shine, Holster (roving arrows, keys 1-2), gear, compass, toast, native-res text 14/16/18/22, 1-device-px hairlines, icons 16-32, live DPR/hairline/canvas-scale readout, glass blur/solid toggle + frame-interval probe. Run with `&preset=low&scale=floor` for the 0.5 canvas.
- Waking overlay (`ui/screens/`): bound to `session.conn` (waking/connecting/lost; hides on connected), 6 s SVG wipe loop (transform/opacity only), m:ss timer, 12 rotating DOT tips, slow headline at 120 s, Reload on lost; reduced motion = static half-clean moon + 120 ms fades.
- Fonts (Inter, Space Grotesk, JetBrains Mono, OFL, ~110 KB) in `assets/ui/fonts/` + OFL texts; 5 ledger rows added to `docs/ASSET_LICENSES.md`.
- Dev sandbox `ui/dev/preview.html` (real UiModule + app store/bus over a 0.5-scale 2D canvas).

## Evidence (sandbox, headless Chromium, 1280x720)
- `tsc` clean for `src/ui` (other errors are in `src/visuals/lighting/sun-rig.ts`, not mine); `eslint src/ui` 0 findings; `prettier --check` clean; `vitest run src/ui`: 11/11 pass.
- Captures in `C:\Users\caseyn\AppData\Local\Temp\claude\430d3d07c3d5e4f4\5a7524bb-e0d6-4adc-a1f7-8310425628b1\scratchpad\shots\` (viewed): hud-dpr1/1.25/1.5/2, waking-dpr2, waking-slow-reduced, lost, connecting, hud-reduced, kbd-focus. Canvas 640x360 at 1280x720 (0.5), `--mc-px` = 1, 0.8, 0.667, 0.5 css px; readout shows hairline = 1 device px; fonts loaded; no console errors; panels at rest `transform: none`.
- Store binding: `conn=waking` shows overlay, `next=connected` removes it. Keyboard: Tab order sane, arrows move Holster/glass radios.
- Glass probe ran: blur 16.94 ms vs solid 16.67 ms (rAF, vsync-bound proxy, software headless: not GPU cost).

## NOT RUN
- Real-renderer capture (`?scene=hud-test` through app boot): needs wiring below. DPR 3 and browser zoom 100-200%. 400% crops. GPU glass cost on Tier A/B (use `?perf=1` GPU timestamps). Screen-reader pass. Gamepad nav. Motion dev console warning appears under OS reduced motion even with `reducedMotion="user"` (dev only, to be checked).

## Wiring handoff (integrator; app/** and render/** untouched)
In `app/boot.ts`: `import { UiModule } from "../ui"` and replace `new AppUiFlushModule(store)` with `new UiModule({ store, win, search: win.location.search })` (store is `AppUiStore`, satisfies `FlushableUiStore`). `modules.ts` `AppUiFlushModule` can then go. `?scene=hud-test` is already ignored by render (smoke mesh stays); the app overlay `#mc-overlay` (z-index 10, top-left) overlaps the wallet: use `&hud=0` for captures. Fonts/CSS are bundled via Vite imports from `assets/ui/fonts`; check `size:check` budget.

## Blockers
none

Commit suggestion: feat(ui): design tokens, UI root, HUD crispness page, waking overlay
