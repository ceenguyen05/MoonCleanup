Task: VT-M0-10 HUD pixel snap / status: done (code + capture); gate re-read is the reviewer's / date: 2026-11-13 / agent: ui-ux-motion-designer / Sonnet 5.5
Done: panels and hairlines on whole device pixels at DPR 1, 1.5, 2 in the HUD bench; test-page readout fixes; dev overlay no longer covers the Lumens caption.

Root causes (found by probing, not guessed)
1. Float noise: `devicePixelRatio` is 1.0000000298 / 2.0000000596 under Playwright, so `--mc-px` = 0.99999997 px and every `round(x, var(--mc-px))` came out a hair under a device pixel (bench top 129.333). Fixed in `ui/tokens/display-metrics.ts` (`normalizeDpr`, `formatDpr`).
2. Borders: the capture machine is a 150 % display emulating DPR 1 and 2, and Chrome snaps `border-width` to the real grid (0.667 css px), so wallet height became 85.333 and shifted every child. Hairline edges are now inset `box-shadow` rings, never borders (GlassPanel, ToastStack, WakingOverlay, bench controls).
3. Half-pixel centring: the hairline grid centred 1 px lines in a 10 px row (y 352.5 / 366.5). Now a flex stack on an 8 css px pitch.
4. Raster grid: on that same machine a 1-device-px line is only crisp when its offset is a whole physical pixel (even px at DPR 1, multiple of 4 at DPR 2). Pitch and all heights above the lines keep that.
5. Panel widths were text widths (wallet 414.281). Wallet, shine, readout columns, segments, compass are now rounded tokens; line-heights step by `--mc-px`; `translate` centring removed (compass, letters, caret).

Other fixes
- DPR readout prints `1`, `1.5`, `2`. "Canvas 1.00 x" replaced by "Render scale" read from `window.__mcInfo().renderScale` (read-only, no render import): 0.50 x at all three DPRs. The `readout-canvas-scale` test id is kept.
- Bench moved down one safe step so the dev text overlay (app/overlay.ts, not mine, `display:none` unless `showOverlay`) clears the Lumens caption. Confirmed in `after/S12-...@1-floor.png`. Production visibility of the overlay: NOT checked (flag lives in app/boot config).

Evidence (`hud10.mjs`, own Vite on 5231, headed Chrome, webgpu, preset low, scale floor; `docs/visual-reviews/M0/checks/hud-snap/{before,after}/hud10.json`, crops, S12 frames)
| | DPR 1 before | after | DPR 1.5 before | after | DPR 2 before | after |
| panelsOffDevicePx | 7 | 0 | 2 | 0 | 7 | 0 |
| hairline rows over half peak | 2,2,1 | 1,1,1 | 1,1,1 | 1,1,1 | 2,2,1 | 1,1,1 |
| hairline y (device px) | 352.5, 366.5, 380 | 374, 382, 390 | 529, 550, 570 | 561, 573, 585 | 705.5, 733.5, 760 | 748, 764, 780 |
| DPR readout | 1.0000000298 | 1 | 1.5 | 1.5 | 2.00000006 | 2 |
| render-scale readout | 1.00 x | 0.50 x | 0.67 x | 0.50 x | 0.50 x | 0.50 x |
Transforms at rest 0, console errors 0 in all six runs. Bench top before 129.333 px, after on whole px (list empty).
Checks: `tsc -p apps/client` 0; `eslint src/ui` 0; `vitest run src/ui` 12/12 (new `normalizeDpr`/`formatDpr` test). Viewed DPR 1 and DPR 2 frames and the DPR 1 hairline crop.

Caveats (labelled)
- At DPR 1 and 2 each line still shows one faint trailing row (luma ~97-101 vs 247 peak, about a third coverage). It also appeared on the one line that passed before. Cause not proven; consistent with the 150 %-display capture resample. Passes the "rows over half peak = 1" bar. Next step: capture on a true DPR 1 and DPR 2 display (Tier A/B hardware, BLOCKED here) to confirm it vanishes.
- Intrinsic-width things still have fractional right edges and centred text starts: toasts, chip buttons, centred labels. Hairlines, panels and left-aligned text starts are exact. Not covered by the gate; no JS snapper added.
- The hairline offsets rely on spacing staying multiples of 4 css px above them; if the bench layout changes, re-run the driver.
- Not run: DPR 1.25 / 3, browser zoom 110-200 % via UI, Vitest browser mode. `?hudscale` > 1 not captured. Headless probe at 1.5 differs from headed (emulated layout) and was not used for numbers.
- A toast caught mid-exit overlaps the "Show a notice" button (popLayout exit, pre-existing, timing of the 4 s capture).

Blockers: none. Commit suggestion: fix(ui): snap HUD panels and hairlines to whole device pixels
Files: apps/client/src/ui/tokens/display-metrics.ts, tokens/tokens.css, components/{GlassPanel,ToastStack}.module.css, screens/WakingOverlay.module.css, hud-test/HudTestPage.{tsx,module.css}, strings.ts, ui.test.ts, docs/agent-reports/M0-hud-snap.md, docs/visual-reviews/M0/checks/hud-snap/**
Stopped: my Vite (5231) and all my Playwright browsers. 15 chrome processes remain that I did not start (not touched).
