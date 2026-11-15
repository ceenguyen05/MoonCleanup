# M0 close-out VT-M0-10 (HUD hairline second row)

Task M0-closeout-vt10 / status: in-review (fix applied and measured; reviewer re-check pending) / 2026-11-14 / ui-ux-motion-designer, Sonnet 5.5. No git, STATUS and task rows untouched.

Done: hairlines are exactly 1 device px with no second row at DPR 1, 1.5 and 2.

**Cause (confirmed by construction probe).** Two hairline boxes in `ui/hud-test/HudTestPage.module.css` (`.hairH`, `.divider`) were a solid `background` on a box whose height or width is `--mc-px`. When the page DPR is emulated (Playwright, DevTools, or this laptop's 150 % display emulating DPR 1 or 2) Chrome snaps that background rect to whole CSS px: a 0.5 css px box paints 1 css px (2 device rows at DPR 2), a 0.667 css px box paints 1 css px (1.5 rows at DPR 1.5). Layout was exact (box top 374.0, height 1 device px, panels 0 off, 0 transforms), so it was not fractional layout, a border or box-shadow, or the glass blur. Ruled out by toggling in-page: backdrop-filter off, canvas hidden, panel box-shadow off, white fill (all unchanged). `border-top`/`border-left` and solid boxes fail the same way; a box-shadow ring and a gradient hard stop at `--mc-px` are crisp on every config.

**Fix (look unchanged, crispness only).** `.hairH` and `.divider` now paint `linear-gradient(color 0 var(--mc-px), transparent var(--mc-px))` (rasterised on the device grid). Layout sizes unchanged. Rule documented in `tokens/tokens.css`. New guard `ui/hairline-rule.test.ts` fails on any solid-background box sized by `--mc-px` or `--mc-hairline` in `ui/**/*.css`.

**Measured device-row luma** (column mean across the middle half of each hairline; rows y-2..y+4; hud10, production build of current source, headed Chrome, port 5185 = offset 12, `?scene=hud-test&preset=low&scale=floor`). Background about 22-30.

| DPR | Before (hairline row, next row) | After |
| --- | --- | --- |
| 1 (rows 374/382/390) | 246.8, **96.4 / 96.9 / 97.2** | 246.8, 22.2 / 22.3 / 22.9 (background) |
| 1.5 (561/573/585) | 246.8, 30.2 (clean) | 246.8, 30.2 |
| 2 (748/764/780) | 246.8, **101.0 / 101.3 / 101.7** | 246.8, 28.9 / 29.5 / 29.9 (background) |

Unchanged: panels off whole device px 0, transforms at rest 0, canvas 0.50, 0 console errors at all three DPRs. Also probed 5 hairline constructions on headed 150 % display, headed 100 % display and headless at DPR 1/1.5/2: `grad` and horizontal `inset` shadow crisp everywhere; `box` and `border` leave a second row whenever DPR is emulated.

Caveat: DPR 1/2 here are emulated; a real 200 % display uses the native path where the old box was probably already clean, and the gradient is correct on both paths. Not verified on real DPR 2 or 3 hardware.

Tests: `vitest run src/ui` 15/15 pass (incl. new rule test), `tsc` and `eslint src/ui` clean (Node 26.13.1). No servers or browsers left running (5185 closed, 0 playwright Chrome).

Files: `apps/client/src/ui/hud-test/HudTestPage.module.css`, `apps/client/src/ui/tokens/tokens.css`, `apps/client/src/ui/hairline-rule.test.ts`. Evidence: `docs/visual-reviews/M0/checks/final-vt10/{before,after}/hud10.json` and `crop-hairlines-dpr{1,1.5,2}-x4.png`, `construction-probe.mjs`.
Next: visual-qa-reviewer re-runs hud10 on the shipped build (rebuild `apps/client/dist` first; I built to a scratch dir only); DPR 3 and zoom 200 % unrun.
Blockers: none.
Commit suggestion: fix(ui): paint hairlines as gradient hard stops so emulated DPR shows no second row (VT-M0-10)
