# M1-W6-T07 visual review: save-conflict prompt, sync indicator, backup restore (VT-M1-24/25)

Reviewer: visual-qa-reviewer. Source read-only; no fixes made. Server: apps/client Vite on port 5391 (stopped after capture).
Page: `/src/ui/dev/preview.html?uihud=1&save=conflict` (also `&save=backup&menu=settings`, `&save=<state>`, `&savefail=1`, `&hudpct=130`).
Chromium headless, viewport 1280x720 CSS, DPR 1 / 1.25 / 1.5 / 2 / 3, native-resolution PNGs. Tier: sandbox 2D canvas, so no Tier A/B GPU claim.
Evidence: `docs/agent-reports/M1-W6-T07-evidence/` (PNGs plus `capture-log.txt`, which has the raw metrics). Every PNG cited below was viewed.

## Verdict: FAIL (2 V2 defects at the canonical 1280x720 size; everything else PASS)

| # | Item | Result | Evidence / observation |
|---|---|---|---|
| 1 | Text crispness DPR 1/1.25/1.5/2/3 (VT-M1-24, §2.3) | PASS | 33 text nodes, 0 off-grid at every DPR; min font 14 CSS px; hairlines and rings are crisp at DPR 1.5 and 2 (`card-edge-crop-dpr1.5.png`, `conflict-focus-crop-dpr2.png`); icons (monitor, cloud) are SVG and sharp (`conflict-dpr2.png`, `conflict-dpr3.png`). |
| 2 | Layout fits 1280x720 CSS without clipping (§2.3, DPR 3 row) | **FAIL (V2)** | The panel is 656 px tall but its content is 719 px. "Decide later" ends at y=691, past the panel bottom at 688, so its lower border is cut off, visible in every `conflict-dpr*.png`. The key-hint line (`S.footer[device]`, bottom y=727) is below the 720 px viewport and can only be reached by scrolling. No scrollbar or fade is shown (scrollbar width 0), so nothing tells the player more content exists. An empty status row also reserves about 24 px. Cause: `.panel` has `max-height: calc(100vh - 2*safe)` with `overflow-y: auto`, but the content is taller. |
| 3 | Same at UI size 130% and small viewports | **FAIL (V2)** | `conflict-1280x720-ui130.png`: the backup banner, "Decide later" and the key line are all off-screen (panel scrollHeight 934 against 636). `conflict-720x540.png`: single column, so only "Keep this device" is visible; the second choice is below the fold with no cue. `conflict-1024x600.png` has the same clip as item 2. The scrolled-off controls are reachable by Tab and arrows, and Esc works. |
| 4 | Text clipping inside cards | PASS | No horizontal overflow at any size. The "Saved" value wraps to 2 lines ("(4 min / ago)"), which is awkward but not clipped. Suggest a shorter relative time or putting "ago" on the value's second line. |
| 5 | Focus ring on buttons | PASS | Teal double ring (2 px border plus 2 px outline at offset 2), crisp at DPR 1 and 2, clear against the dark card (`conflict-focus-crop-dpr1.png`, `conflict-focus-crop-dpr2.png`, `conflict-focus-local-dpr*.png`). |
| 6 | Heading focus on open | **FAIL (V2, low)** | `conflict-dpr1.png`, `conflict-dpr2.png`, `conflict-dpr3.png`, `conflict-1280x720-ui130.png`: a full-width teal box is drawn tight around "Which copy?" with the text touching the ring. `SaveConflictPrompt.module.css` intends `.title:focus-visible { outline: none }`, but the global `#mc-ui :focus-visible` rule (tokens.css:175) has ID specificity and wins. Fix: raise the `.title` selector's specificity (as `Menus.module.css` does with `.stage .title:focus-visible`; check that it works there too) or use `:focus:not(...)`. Settings has the same ring on its title (`settings-backup-dpr1.png`). |
| 7 | Modal over HUD | PASS | The scrim dims the HUD heavily while keeping it as faint context, `hud-wallet` stays mounted, and the dialog sits above it (`conflict-dpr1.png`). Behind the Settings glass the HUD chips ghost faintly through the header (`settings-backup-dpr1.png`), a minor legibility smudge in existing Settings glass, not the new prompt. |
| 8 | No default choice | PASS | Both buttons are styled identically. "Newer" is a plain outlined tag, and focus starts on the heading. Enter on the heading did nothing (prompt stayed, status empty). |
| 9 | Keyboard | PASS | Initial focus is H2. Tab order: Keep > Use server > Decide later > wraps, and Shift+Tab wraps the other way (trapped). Arrows move spatially (Right: server, Down: later, Up: keep, Left: later). Esc sets "decide later": the prompt closes and the indicator reads "Choose a copy in Settings" (`decide-later-hud-dpr1.png`). Keydowns (W, Space) never reached `window` while the dialog had focus (0). No page errors. |
| 10 | Pad nav | PARTIAL | The sandbox does not expose `UiModule.navigate`, so it was not driven end to end. The same `moveFocus` it calls was exercised in-page (right, down, up, left all returned true with sensible targets). Back, confirm and the `SAVE_PROMPT_ATTR` routing were verified by reading `module.tsx:233-247` only. Needs an input-module integration test or a real-pad pass. |
| 11 | Choice flow | PASS | Choosing shows "Working on it" (`conflict-working-dpr1.png`), then the prompt closes and the indicator shows "Saved to cloud" (`after-resolve-dpr1.png`). `savefail=1` shows an amber "That did not go through. Nothing changed. Try again." and frees the buttons (`conflict-failed-dpr1.png`). |
| 12 | Sync indicator states | PASS | synced, pending, uploading, offline, error and local_only are all legible, with icon plus text (not colour alone), at 14 px. See `indicator-*-dpr1.png`. Contrast was judged on the dark sky strip and the pill's own dark fill; it was not measured over bright regolith. |
| 13 | Backup restore in Settings (DPR 1-3) | PASS | The save status card, "Backup copy ... kept until Nov 22" and "Restore backup" render cleanly (`settings-backup-dpr1.png` through `settings-backup-dpr3.png`). The confirm step uses a dashed amber box with the safe action first and filled ("Keep current progress"), and "Restore now" is outlined, so the destructive action is not the default. Focus lands on Cancel (`settings-restore-confirm-dpr1.png`, `settings-restore-confirm-dpr2.png`). Nit: the confirm box nearly touches the footer divider, and the footer key line "Enter: choose Arrow keys: move Esc: close" has no separators. |
| 14 | VT-M1-25 motion / reduced motion | NOT EVALUATED | No frame-stepped 60 FPS capture was taken. Code reads as compliant (reduced-motion removes the y-slide and uses fade presets), but nothing here confirms it visually. |

## Defects for the owner (not fixed)
1. **V2 prompt overflow at 1280x720 (items 2, 3).** Make the dialog fit: drop the reserved empty status row, tighten the gaps, merge or shrink the safety banner, or make the foot sticky. Add a visible scroll affordance if scrolling remains. Re-check at DPR 3 and at UI size 130%.
2. **V2 heading focus box (item 6).** CSS specificity bug described above.
3. **Pad nav (item 10)** needs an integration test or a real-pad pass.
4. Minor: "Saved ... (4 min ago)" wraps; the footer key hint has no separators.

## Known, not a defect here
Local-store and install failures map to the "rejected" message ("The server did not accept this copy.", `strings.ts` line 374). This is already a known contracts follow-up. The `error` indicator state seeded with `rejected` renders as "Cloud save paused" (`indicator-error-dpr1.png`), so the HUD wording is fine; only the Settings detail text would be misleading for local failures.

## Approval
Not approved until defects 1 and 2 are fixed and re-captured at DPR 1 / 1.5 / 2 / 3. Prompt layout is otherwise strong: clear hierarchy, no default choice, honest failure copy.
